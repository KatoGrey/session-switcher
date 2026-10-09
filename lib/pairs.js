'use strict';
// Claude and Codex in one chat. Each chat can have a partner working in the same folder and the same
// chat: Codex in a Claude chat, or Claude in a Codex chat. One partner per chat, remembered across
// restarts (chat-prefs.json), and never two processes on one conversation: a partner that's already
// running (opened from a list, or left over from an earlier run of its chat) is paired again rather
// than started a second time. Before each message one of the two gets, it's caught up on what the
// other said and did (lib/duo.js works out the words). "Both" has them take turns.
//
// What it needs from the app:
//   chats         the running chats (get, bySession)
//   prefs         chat-prefs (companionOf, parentOf, link, heard, setHeard)
//   transcript    (provider, id, until) → a conversation's items before `until`, from its transcript
//   lastChanged   (provider, id) → when a conversation last changed (ms), or 0 if unknown
//   startPartner  (lead, { remembered, accountId }) → the partner chat, started (resuming `remembered`)
//   onPaired      () → called when a chat gets its partner

const duo = require('./duo');
const { notice } = require('./chat');

function createPairs({ chats, prefs, transcript, lastChanged = () => 0, startPartner, onPaired = () => {}, log = () => {} }) {
  const provOf = chat => chat.provider || 'claude';
  const nameOf = chat => duo.NAME[provOf(chat)];

  // A chat and its partner remember each other once both have ids.
  function link(chat) {
    let lead = null, partner = null;
    try { if (chat.parentKey) { lead = chats.get(chat.parentKey); partner = chat; } else if (chat.companionKey) { lead = chat; partner = chats.get(chat.companionKey); } } catch { return; }
    if (lead && partner && lead.sessionId && partner.sessionId) prefs.link(lead.sessionId, partner.sessionId);
  }
  function partnerOf(chat) { const k = chat && (chat.companionKey || chat.parentKey); if (!k) return null; try { return chats.get(k); } catch { return null; } }
  function leadOf(chat) { if (!chat.parentKey) return chat; try { return chats.get(chat.parentKey); } catch { return chat; } }
  function pairUp(lead, partner) {
    partner.parentKey = lead.key; lead.companionKey = partner.key;
    link(lead);
    onPaired();
  }
  // A running chat that's this chat's remembered partner, free to pair (no other chat running it).
  function runningMate(lead) {
    const id = lead.sessionId && prefs.companionOf(lead.sessionId), live = id && chats.bySession(id);
    if (!live || live === lead) return null;
    let owner = null; try { owner = live.parentKey && chats.get(live.parentKey); } catch { /* gone */ }
    return !owner || owner.state === 'ended' || owner === lead ? live : null;
  }
  // When a chat opens: its partner from an earlier run, if that's still running, is its partner again.
  function adopt(chat) {
    if (chat.parentKey || (chat.companionKey && partnerOf(chat) && partnerOf(chat).state !== 'ended')) return false;
    const live = runningMate(chat);
    if (live) pairUp(chat, live);
    return !!live;
  }

  // The partner, running: the paired one, else the remembered one if it's running, else started
  // (resuming its conversation). Two messages at once start one partner.
  const opening = new Map();
  function ensure(lead, { accountId } = {}) {
    const cur = partnerOf(lead);
    if (cur && cur.state !== 'ended' && cur.parentKey === lead.key) return Promise.resolve(cur);
    if (!opening.has(lead.key)) {
      const p = open(lead, { accountId });
      opening.set(lead.key, p);
      p.then(() => opening.delete(lead.key), () => opening.delete(lead.key));
    }
    return opening.get(lead.key);
  }
  async function open(lead, { accountId = null, fresh = false } = {}) {
    if (!fresh) { const live = runningMate(lead); if (live) { pairUp(lead, live); return live; } }
    const remembered = !fresh && lead.sessionId ? prefs.companionOf(lead.sessionId) : null;
    const partner = await startPartner(lead, { remembered, accountId });
    pairUp(lead, partner);
    log(`${nameOf(partner)} partner for ${lead.sessionId || lead.key}: ${remembered ? `resume ${remembered}` : 'new'}`);
    // If its earlier conversation can't be picked up, it starts a new one (caught up on this chat),
    // and whatever was waiting for it goes there.
    if (remembered) {
      partner.exited.then(() => {
        if (partner.stopping || partner.buffer.some(e => e.kind === 'init' || e.kind === 'result' || e.kind === 'assistant') || lead.state === 'ended' || lead.companionKey !== partner.key) return;
        const waiting = partner.waitingSends || [];
        lead.emit(notice('info', `${nameOf(partner)} couldn’t pick up its earlier conversation here, so it started a new one, caught up on this chat.`));
        open(lead, { accountId, fresh: true })
          .then(np => { for (const w of waiting) send(np, w.text, w.images, w.opts).catch(err => lead.emit(notice('warning', `Couldn’t pass that on: ${err.message}`))); })
          .catch(err => lead.emit(notice('warning', `${nameOf(partner)} couldn’t start: ${err.message}`)));
      });
    }
    return partner;
  }

  // The other one in a chat (running or not): its kind, its conversation's id, and its running chat.
  function mateOf(chat) {
    const live = partnerOf(chat);
    if (live) return { provider: provOf(live), sessionId: live.sessionId, live };
    const id = chat.sessionId && (prefs.companionOf(chat.sessionId) || prefs.parentOf(chat.sessionId));
    return id ? { provider: duo.other(provOf(chat)), sessionId: id, live: chats.bySession(id) } : null;
  }
  // A conversation's messages and replies: the running chat's own (as they happened), and before it
  // started, its transcript (not read at all when it hasn't changed since `since`).
  async function itemsOf(who, since) {
    const live = who.live, from = live ? Date.parse(live.info().bufferFrom) || 0 : Infinity;
    let items = [];
    const changed = !live && since ? lastChanged(who.provider, who.sessionId) : 0;
    const quiet = changed && changed <= Date.parse(since);
    if (who.sessionId && !quiet && (!since || Date.parse(since) < from)) {
      try { items = await transcript(who.provider, who.sessionId, live ? live.info().bufferFrom : null); } catch { /* nothing written yet */ }
    }
    if (live) items = items.concat(live.buffer.filter(e => e.kind === 'user' || e.kind === 'assistant'));
    return items;
  }
  const heardSince = chat => chat.heardUntil || (chat.sessionId && prefs.heard(chat.sessionId)) || null;
  // What a chat is told before your message: what its partner said and did since it last caught up,
  // and files you put back from its own last reply.
  async function catchUpFor(chat, text, { relay = false } = {}) {
    const undone = chat.undoneFiles ? chat.undoneFiles.splice(0) : [];
    const mate = mateOf(chat);
    let theirs = [], heard = [String(text).trim()], busy = false;
    if (mate && mate.sessionId) {
      const since = heardSince(chat);
      try {
        theirs = duo.entries(await itemsOf(mate, since), mate.provider, since);
        // What it was itself told meanwhile, so that isn't repeated back (only looked up when needed).
        if (theirs.some(e => e.from === 'you')) heard = heard.concat(duo.entries(await itemsOf({ provider: provOf(chat), sessionId: chat.sessionId, live: chat }, since), provOf(chat), since).filter(e => e.from === 'you').map(e => e.text));
        busy = !!(mate.live && ['busy', 'waiting'].includes(mate.live.state));
      } catch (err) { log(`Couldn’t gather what ${nameOf(chat)} missed: ${err.message}`); }
    }
    return duo.catchUp({ to: provOf(chat), theirs, heard, undone, busy, relay });
  }
  // Sends to one of the two, caught up first. A partner still starting keeps what's waiting for it, in
  // case it has to start over.
  async function send(chat, text, images = [], opts = {}) {
    const block = await catchUpFor(chat, text, opts);
    await chat.beforeTurn();   // a snapshot first, so its reply's changes can be shown and undone
    if (chat.state === 'starting' && chat.parentKey) (chat.waitingSends || (chat.waitingSends = [])).push({ text, images, opts });
    chat.send(block + text, images, opts);
    if (mateOf(chat)) { chat.heardUntil = new Date().toISOString(); if (chat.sessionId) prefs.setHeard(chat.sessionId, chat.heardUntil); }
    return chat;
  }
  // "Both": they take turns. The chat's own assistant answers first; then the other picks the same
  // message up, already knowing that answer, so it builds on it instead of starting over (and the two
  // never edit files at the same time). Stopping the first one skips the hand-over.
  async function sendBoth(lead, text, images = [], { accountId } = {}) {
    const warm = ensure(lead, { accountId });
    warm.catch(() => {});
    await send(lead, text, images);
    const sentAt = Date.now(), to = duo.other(provOf(lead));
    lead.emit({ kind: 'handoff', to, state: 'waiting' });
    const done = lead.turnDone().then(async ev => {
      if (ev.kind === 'ended' || (lead.interruptedAt && lead.interruptedAt >= sentAt)) { lead.emit({ kind: 'handoff', to, state: 'skipped' }); return null; }
      let partner;
      try { partner = await warm; } catch (err) { lead.emit({ kind: 'handoff', to, state: 'skipped' }); lead.emit(notice('warning', `${duo.NAME[to]} couldn’t pick this up: ${err.message}`)); return null; }
      await send(partner, text, images, { relay: true });
      lead.emit({ kind: 'handoff', to, state: 'sent' });
      return partner;
    }).catch(err => { log(`Hand-over: ${err.message}`); lead.emit({ kind: 'handoff', to, state: 'skipped' }); return null; });
    return { handedOver: done };
  }

  return { link, partnerOf, leadOf, adopt, ensure, mateOf, catchUpFor, send, sendBoth };
}

module.exports = { createPairs };
