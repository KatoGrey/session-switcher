'use strict';
// A crew in one chat. Each chat can have other assistants working in the same folder and the same
// chat: Codex and Gemini in a Claude chat, Claude and Gemini in a Codex chat, Claude and Codex in a
// Gemini chat. One of each kind at most, remembered across restarts (chat-prefs.json), and never two
// processes on one conversation: a partner that's already running (opened from a list, or left over
// from an earlier run of its chat) is paired again rather than started a second time. Before each
// message one of them gets, it's caught up on what the others said and did (lib/duo.js works out the
// words). "Both" (one partner) and "All" (the whole crew) have them take turns.
//
// "The partner" (for the older one-partner calls) is the one you last wrote to or brought in.
//
// What it needs from the app:
//   chats         the running chats (get, bySession)
//   prefs         chat-prefs (companionOf, crewOf, parentOf, link, heard, setHeard)
//   transcript    (provider, id, until) → a conversation's items before `until`, from its transcript
//   lastChanged   (provider, id) → when a conversation last changed (ms), or 0 if unknown
//   startPartner  (lead, { remembered, accountId, kind }) → the partner chat, started (resuming `remembered`)
//   kindOf        (id) → which assistant a conversation is ('claude', 'codex' or 'gemini'), or null
//   onPaired      () → called when a chat gets a partner

const duo = require('./duo');
const { notice } = require('./chat');

const KINDS = ['claude', 'codex', 'gemini'];

function createPairs({ chats, prefs, transcript, lastChanged = () => 0, startPartner, kindOf = () => null, onPaired = () => {}, log = () => {} }) {
  const provOf = chat => chat.provider || 'claude';
  const nameOf = chat => duo.NAME[provOf(chat)];
  const get = key => { if (!key) return null; try { return chats.get(key); } catch { return null; } };
  const alive = c => !!c && c.state !== 'ended';

  // The crew that's running: the lead's partners (each still pointing back at it).
  function crewOf(lead) {
    const out = [];
    for (const key of (lead.crew || new Map()).values()) { const c = get(key); if (c && c.parentKey === lead.key && !out.includes(c)) out.push(c); }
    const cur = get(lead.companionKey);
    if (cur && cur.parentKey === lead.key && !out.includes(cur)) out.push(cur);
    return out;
  }
  const memberOf = (lead, kind) => crewOf(lead).find(c => provOf(c) === kind && alive(c)) || null;
  // Its crew from before, by kind ('_' for one whose kind isn't known).
  function rememberedCrew(lead) {
    if (!lead.sessionId) return {};
    const crew = { ...(prefs.crewOf ? prefs.crewOf(lead.sessionId) : {}) };
    const one = prefs.companionOf(lead.sessionId);
    if (one && !Object.values(crew).some(x => String(x).toLowerCase() === String(one).toLowerCase())) { const k = kindOf(one); if (k && !crew[k]) crew[k] = one; else if (!k) crew._ = one; }
    return crew;
  }
  // The kinds in this chat (running, or from before), in the order they came in.
  function kindsIn(lead) {
    const ks = crewOf(lead).filter(alive).map(provOf);
    for (const k of Object.keys(rememberedCrew(lead))) if (k !== '_' && !ks.includes(k)) ks.push(k);
    return ks.filter(k => k !== provOf(lead));
  }
  // "The partner": the one last written to or brought in, else the one picked, else the one it had
  // before, else its usual partner.
  function kindFor(lead) {
    const cur = get(lead.companionKey);
    if (alive(cur) && cur.parentKey === lead.key) return provOf(cur);
    if (lead.mateKind && lead.mateKind !== provOf(lead)) return lead.mateKind;
    const one = lead.sessionId && prefs.companionOf(lead.sessionId);
    const was = one && kindOf(one);
    if (was && was !== provOf(lead)) return was;
    return duo.other(provOf(lead));
  }

  // A chat and its partners remember each other once both have ids.
  function link(chat) {
    if (!chat.parentKey) { for (const p of crewOf(chat)) link(p); return; }
    const lead = get(chat.parentKey);
    if (!lead || !lead.sessionId || !chat.sessionId) return;
    const crew = prefs.crewOf ? prefs.crewOf(lead.sessionId) : {};
    if (crew[provOf(chat)] !== chat.sessionId || prefs.companionOf(lead.sessionId) !== chat.sessionId) {
      prefs.link(lead.sessionId, chat.sessionId, provOf(chat));
      log(`Paired ${lead.sessionId} with ${nameOf(chat)} ${chat.sessionId}`);
    }
  }
  // The older one-partner view: a lead's current partner, or a partner's lead.
  function partnerOf(chat) { return chat && chat.parentKey ? get(chat.parentKey) : get(chat && chat.companionKey); }
  function leadOf(chat) { if (!chat.parentKey) return chat; return get(chat.parentKey) || chat; }
  function pairUp(lead, partner) {
    partner.parentKey = lead.key;
    (lead.crew || (lead.crew = new Map())).set(provOf(partner), partner.key);
    lead.companionKey = partner.key;
    link(partner);
    onPaired();
  }
  // A running chat that's this chat's partner of that kind from before, free to pair (no other chat
  // running it).
  function runningMate(lead, kind) {
    const crew = rememberedCrew(lead);
    const id = crew[kind] || (crew._ && kind === duo.other(provOf(lead)) ? crew._ : null), live = id && chats.bySession(id);
    if (!live || live === lead || (kindOf(id) && provOf(live) !== kind)) return null;
    const owner = live.parentKey && get(live.parentKey);
    return !owner || owner.state === 'ended' || owner === lead ? live : null;
  }
  // When a chat opens: its crew from an earlier run, those still running, are its crew again.
  function adopt(chat) {
    if (chat.parentKey) return false;
    let any = false;
    for (const k of [...Object.keys(rememberedCrew(chat)).filter(x => x !== '_'), duo.other(provOf(chat))]) {
      if (memberOf(chat, k)) continue;
      const live = runningMate(chat, k);
      if (live) { pairUp(chat, live); any = true; }
    }
    return any;
  }

  // A partner of that kind (the chat's partner, unless said), running: the one in the crew, else the
  // remembered one if it's running, else started (resuming its conversation). Two messages at once
  // start one. It becomes "the partner".
  const opening = new Map();
  function ensure(lead, { accountId, kind } = {}) {
    if (kind && kind !== provOf(lead) && duo.NAME[kind]) lead.mateKind = kind;
    const want = kind && duo.NAME[kind] && kind !== provOf(lead) ? kind : kindFor(lead);
    const cur = memberOf(lead, want);
    if (cur) { lead.companionKey = cur.key; return Promise.resolve(cur); }
    const k = `${lead.key}:${want}`;
    if (!opening.has(k)) {
      const p = open(lead, { accountId, kind: want });
      opening.set(k, p);
      p.then(() => opening.delete(k), () => opening.delete(k));
    }
    return opening.get(k);
  }
  async function open(lead, { accountId = null, fresh = false, tries = 0, kind = kindFor(lead) } = {}) {
    if (!fresh) { const live = runningMate(lead, kind); if (live) { pairUp(lead, live); return live; } }
    const crew = !fresh ? rememberedCrew(lead) : {};
    const remembered = crew[kind] || (crew._ && kind === duo.other(provOf(lead)) ? crew._ : null);
    const partner = await startPartner(lead, { remembered, accountId, kind });
    // Codex says at once whether it could pick its conversation up. Still in use (by a copy of the app
    // that's just quitting, say) is waited out; otherwise, or if it stays in use, a new one starts now,
    // caught up on the chat, before anything is sent to it.
    if (remembered && provOf(partner) === 'codex' && !(await settled(partner))) {
      const why = (partner.buffer.filter(e => e.kind === 'notice').pop() || {}).text || '';
      const inUse = /active writer|in use|locked/i.test(why);
      if (inUse && tries < 8) { await new Promise(r => setTimeout(r, 1500)); return open(lead, { accountId, tries: tries + 1, kind }); }
      lead.emit(notice('info', inUse
        ? `${nameOf(partner)}’s earlier conversation is open somewhere else (another Codex window?), so it started a new one here, caught up on this chat.`
        : `${nameOf(partner)} couldn’t pick up its earlier conversation here, so it started a new one, caught up on this chat.`));
      return open(lead, { accountId, fresh: true, kind });
    }
    pairUp(lead, partner);
    log(`${nameOf(partner)} partner for ${lead.sessionId || lead.key}: ${remembered ? `resume ${remembered}` : 'new'}`);
    // If its earlier conversation can't be picked up, it starts a new one (caught up on this chat),
    // and whatever was waiting for it goes there.
    if (remembered) {
      partner.exited.then(() => {
        if (partner.stopping || partner.buffer.some(e => e.kind === 'init' || e.kind === 'result' || e.kind === 'assistant') || lead.state === 'ended' || partner.parentKey !== lead.key) return;
        const waiting = partner.waitingSends || [];
        lead.emit(notice('info', `${nameOf(partner)} couldn’t pick up its earlier conversation here, so it started a new one, caught up on this chat.`));
        open(lead, { accountId, fresh: true, kind })
          .then(np => { for (const w of waiting) send(np, w.text, w.images, w.opts).catch(err => lead.emit(notice('warning', `Couldn’t pass that on: ${err.message}`))); })
          .catch(err => lead.emit(notice('warning', `${nameOf(partner)} couldn’t start: ${err.message}`)));
      });
    }
    return partner;
  }

  // Whether a chat that's starting got going (true; also after a while with no word either way) or
  // stopped first (false).
  function settled(chat, ms = 30000) {
    const until = Date.now() + ms;
    return new Promise(resolve => {
      const tick = () => {
        if (chat.state === 'ended') return resolve(false);
        if (chat.state !== 'starting' || chat.buffer.some(e => e.kind === 'init') || Date.now() > until) return resolve(true);
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  // The others in a chat (running or not): each one's kind, conversation id, and running chat.
  function matesOf(chat) {
    const out = [];
    const add = (provider, sessionId, live) => { if (provider === provOf(chat) && (!live || live === chat)) return; if (out.some(m => (live && m.live === live) || (sessionId && m.sessionId && m.sessionId.toLowerCase() === String(sessionId).toLowerCase()))) return; out.push({ provider, sessionId, live: live || null }); };
    const lead = chat.parentKey ? get(chat.parentKey) : chat;
    if (chat.parentKey && lead) add(provOf(lead), lead.sessionId, lead);
    if (lead) for (const p of crewOf(lead)) if (p !== chat) add(provOf(p), p.sessionId, p);
    if (lead && lead.sessionId) {
      for (const [k, id] of Object.entries(rememberedCrew(lead))) {
        const live = chats.bySession(id);
        if (live === chat || (chat.sessionId && String(id).toLowerCase() === chat.sessionId.toLowerCase())) continue;
        add(k === '_' ? (kindOf(id) || duo.other(provOf(lead))) : k, id, live);
      }
    }
    // A partner whose lead isn't running: the lead, from what's remembered.
    if (chat.parentKey && !lead && chat.sessionId) { const id = prefs.parentOf(chat.sessionId); if (id) add(kindOf(id) || duo.other(provOf(chat)), id, chats.bySession(id)); }
    if (!chat.parentKey && !lead && chat.sessionId) { const id = prefs.parentOf(chat.sessionId); if (id) add(kindOf(id) || duo.other(provOf(chat)), id, chats.bySession(id)); }
    if (!out.length && chat.sessionId) {
      const id = prefs.companionOf(chat.sessionId) || prefs.parentOf(chat.sessionId);
      if (id) add(kindOf(id) || duo.other(provOf(chat)), id, chats.bySession(id));
    }
    return out;
  }
  // The older one-partner view of the others: the first of them.
  function mateOf(chat) { return matesOf(chat)[0] || null; }
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
  // What a chat is told before your message: what the others said and did since it last caught up,
  // and files you put back from its own last reply.
  // crew: the kinds this message goes round to (All), known before they've all started.
  // group: the round you picked (Together), in order, this one among them: who it comes after.
  async function catchUpFor(chat, text, { relay = false, first = false, crew = null, group = null, together = false } = {}) {
    const undone = chat.undoneFiles ? chat.undoneFiles.splice(0) : [];
    const theirUndone = chat.partnerUndone ? chat.partnerUndone.splice(0) : [];
    const mates = matesOf(chat);
    let theirs = [], heard = [String(text).trim()], busy = false;
    if (mates.length) {
      const since = heardSince(chat);
      try {
        for (const m of mates) if (m.sessionId || m.live) theirs = theirs.concat(duo.entries(await itemsOf(m, since), m.provider, since));
        // In time order, the others' words together (a crew of three).
        if (mates.length > 1) theirs.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
        // What it was itself told meanwhile, so that isn't repeated back (only looked up when needed).
        if (theirs.some(e => e.from === 'you')) heard = heard.concat(duo.entries(await itemsOf({ provider: provOf(chat), sessionId: chat.sessionId, live: chat }, since), provOf(chat), since).filter(e => e.from === 'you').map(e => e.text));
        busy = mates.some(m => m.live && ['busy', 'waiting'].includes(m.live.state));
      } catch (err) { log(`Couldn’t gather what ${nameOf(chat)} missed: ${err.message}`); }
    }
    // Another one's task list, when it changed since this one last caught up: the crew plan.
    let plan = null, planBy = null;
    const since = Date.parse(heardSince(chat) || 0) || 0;
    for (const m of mates) {
      if (!m.live || plan) continue;
      for (let i = m.live.buffer.length - 1; i >= 0 && !plan; i--) {
        const e = m.live.buffer[i];
        if ((Date.parse(e.at) || 0) <= since) break;
        if (e.kind === 'plan' && e.steps) { plan = e.steps; planBy = m.provider; }
        else if (e.kind === 'assistant') for (const b of e.blocks || []) if (b.type === 'tool' && b.name === 'TodoWrite' && b.meta && b.meta.todos) { plan = b.meta.todos; planBy = m.provider; }
      }
    }
    // Who the others are, even before one has started (Both: this one answers first).
    let kinds = [...new Set([...mates.map(m => m.provider), ...(Array.isArray(crew) ? crew : [])])].filter(k => k !== provOf(chat));
    if (!kinds.length && !chat.parentKey) kinds = [kindFor(chat)];
    // Told once that it's in a crew (Codex partnering Claude hears it when its thread starts).
    const intro = !!mates.length && !heardSince(chat) && !(provOf(chat) === 'codex' && chat.parentKey && kinds.length === 1 && kinds[0] === 'claude');
    return duo.catchUp({ to: provOf(chat), mate: kinds.length > 1 ? kinds : kinds[0], planBy, theirs, heard, undone, theirUndone, busy, relay, intro, first, plan, group, together });
  }
  // Sends to one of them, caught up first. A partner still starting keeps what's waiting for it, in
  // case it has to start over.
  async function send(chat, text, images = [], opts = {}) {
    // A partner that stopped (it couldn't start, say): the chat's partner of that kind now, started if need be.
    if (chat.state === 'ended' && chat.parentKey) { const lead = leadOf(chat); if (lead !== chat && lead.state !== 'ended') chat = await ensure(lead, { kind: provOf(chat) }); }
    // The cut-off is taken before reading, so whatever the others say during the snapshot below is
    // passed on next time instead of falling between them.
    const cutoff = new Date().toISOString();
    const block = await catchUpFor(chat, text, opts);
    await chat.beforeTurn();   // a snapshot first, so its reply's changes can be shown and undone
    if (chat.state === 'starting' && chat.parentKey) (chat.waitingSends || (chat.waitingSends = [])).push({ text, images, opts });
    chat.send(block + text, images, opts);
    if (matesOf(chat).length) { chat.heardUntil = cutoff; if (chat.sessionId) prefs.setHeard(chat.sessionId, chat.heardUntil); }
    return chat;
  }
  // "Both" (one partner) or "All" (several): they take turns. The chat's own assistant answers first;
  // then each of the others picks the same message up in turn, already knowing the answers before
  // theirs, so they build on them instead of starting over (and never edit files at the same time).
  // Stopping the one answering skips the rest.
  async function sendBoth(lead, text, images = [], { accountId, kind, kinds } = {}) {
    const list = [...new Set((Array.isArray(kinds) && kinds.length ? kinds : [kind || kindFor(lead)]).filter(k => KINDS.includes(k) && k !== provOf(lead)))];
    if (!list.length) list.push(kindFor(lead));
    return takeTurns(lead, [provOf(lead), ...list], text, images, { accountId });
  }
  // The ones you picked, in the order they answer (Together): the chat's own assistant may be any
  // of them, or not one of them at all (Gemini, then Codex, in a Claude chat). Each is told who the
  // round is and where it comes in it.
  async function sendGroup(lead, text, images = [], { accountId, kinds } = {}) {
    const group = [...new Set((Array.isArray(kinds) ? kinds : []).filter(k => KINDS.includes(k)))];
    if (group.length < 2) throw Object.assign(new Error('Pick at least two of them to work together.'), { status: 400 });
    return takeTurns(lead, group, text, images, { accountId, named: true });
  }
  // At the same time: the ones you picked all get your message at once, each told who else is on it
  // and to do only its own part (you say who does what: "Claude: the save code. Codex: the icons.").
  async function sendTogether(lead, text, images = [], { accountId, kinds } = {}) {
    const group = [...new Set((Array.isArray(kinds) ? kinds : []).filter(k => KINDS.includes(k)))];
    if (group.length < 2) throw Object.assign(new Error('Pick at least two of them to work at the same time.'), { status: 400 });
    const me = provOf(lead);
    const sent = await Promise.all(group.map(async k => {
      let chat;
      try { chat = k === me ? lead : await ensure(lead, { accountId, kind: k }); } catch (err) { lead.emit(notice('warning', `${duo.NAME[k]} couldn’t start: ${err.message}`)); return null; }
      // A chat can stop after opening, or fail while preparing the send. Keep the other deliveries
      // successful so the user isn't invited to retry a message those assistants already received.
      try { return await send(chat, text, images, { together: true, group }); } catch (err) { lead.emit(notice('warning', `${duo.NAME[k]} couldn’t receive your message: ${err.message}`)); return null; }
    }));
    if (!sent.some(Boolean)) throw Object.assign(new Error('None of them could start.'), { status: 500 });
    return sent.filter(Boolean);
  }
  async function takeTurns(lead, group, text, images, { accountId, named = false }) {
    const me = provOf(lead);
    // Each one's chat: this one, or its partner of that kind (started now, so it's ready in time).
    const warm = group.map(k => { const p = k === me ? Promise.resolve(lead) : ensure(lead, { accountId, kind: k }); p.catch(() => {}); return p; });
    const told = named ? { group } : {};
    let first;
    try { first = await warm[0]; } catch (err) { lead.emit(notice('warning', `${duo.NAME[group[0]]} couldn’t start: ${err.message}`)); throw err; }
    await send(first, text, images, { first: true, crew: group.filter(k => k !== group[0]), ...told });
    const sentAt = Date.now();
    const rest = group.slice(1);
    lead.emit({ kind: 'handoff', to: rest[0], state: 'waiting', ...(group[0] !== me ? { after: group[0] } : {}), ...(rest.length > 1 ? { order: rest } : {}) });
    const done = (async () => {
      let prev = first, finished = prev.turnDone();
      const answered = [group[0]];
      for (let i = 1; i < group.length; i++) {
        const to = group[i];
        // If one couldn't start, the previous reply has already finished. Reuse that completion
        // when moving to the next assistant instead of waiting for a second reply that won't come.
        const ev = await finished;
        if (ev.kind === 'ended' || (prev.interruptedAt && prev.interruptedAt >= sentAt)) { lead.emit({ kind: 'handoff', to, state: 'skipped' }); return null; }
        let next;
        try { next = await warm[i]; } catch (err) { lead.emit({ kind: 'handoff', to, state: 'skipped' }); lead.emit(notice('warning', `${duo.NAME[to]} couldn’t pick this up: ${err.message}`)); continue; }
        // Don't tell it that an unavailable assistant already answered.
        await send(next, text, images, { relay: true, ...(named ? { group: [...answered, ...group.slice(i)] } : {}) });
        answered.push(to);
        lead.emit({ kind: 'handoff', to, state: 'sent' });
        if (group[i + 1]) lead.emit({ kind: 'handoff', to: group[i + 1], state: 'waiting', after: to });
        prev = next;
        if (group[i + 1]) finished = prev.turnDone();
      }
      return prev;
    })().catch(err => { log(`Hand-over: ${err.message}`); lead.emit({ kind: 'handoff', to: rest[0], state: 'skipped' }); return null; });
    return { handedOver: done };
  }

  // "Plan first": the chat's own assistant drafts a plan (no changes yet), the other checks it, and the
  // chat then shows a card for you to pick who builds it. Each step arrives as a 'planfirst' event.
  // by: who drafts it (the chat's own assistant, unless you picked another); kind: who checks it.
  async function planFirst(lead, text, images = [], { accountId, kind, by = null } = {}) {
    const me = provOf(lead);
    const who = by && KINDS.includes(by) ? by : me;
    const to = kind && kind !== who && KINDS.includes(kind) ? kind : who === me ? kindFor(lead) : me;
    const chatOf = k => (k === me ? Promise.resolve(lead) : ensure(lead, { accountId, kind: k }));
    const drafter = chatOf(who), checker = chatOf(to);
    drafter.catch(() => {}); checker.catch(() => {});
    lead.emit({ kind: 'planfirst', state: 'drafting', who, to, ask: String(text).slice(0, 300) });
    const sentAt = Date.now();
    const d = await drafter;
    await send(d, `${text}\n\n(Plan first: reply with a short numbered plan for this, the files it would touch and any risks. Don't change any files yet: ${duo.NAME[to]} checks the plan next, then the user picks who builds it.)`, images);
    d.turnDone().then(async ev => {
      if (ev.kind === 'ended' || (d.interruptedAt && d.interruptedAt >= sentAt)) return lead.emit({ kind: 'planfirst', state: 'stopped' });
      let c;
      try { c = await checker; } catch { return lead.emit({ kind: 'planfirst', state: 'ready', checked: false }); }
      lead.emit({ kind: 'planfirst', state: 'checking', who, to });
      await send(c, `(Plan first) Check ${duo.NAME[who]}'s plan above for this request: what's missing, wrong or risky, and what you'd change. Be brief and concrete, and don't change any files yet; the user picks who builds it next.\n\nThe request: ${text}`);
      const done = await c.turnDone();
      lead.emit({ kind: 'planfirst', state: done.kind === 'ended' ? 'stopped' : 'ready', checked: true });
    }).catch(err => lead.emit(notice('warning', `Plan first stopped: ${err.message}`)));
    return lead;
  }

  // Sends once the others have finished what they're doing, so they never edit files at the same
  // time; at once if none is busy. The chat says it's waiting meanwhile.
  function sendAfter(chat, text, images = []) {
    const busy = matesOf(chat).map(m => m.live).filter(o => o && ['busy', 'waiting'].includes(o.state));
    if (!busy.length) return send(chat, text, images);
    chat.emit(notice('info', `Your message goes to ${nameOf(chat)} once ${busy.map(nameOf).join(' and ')} finish${busy.length === 1 ? 'es' : ''}.`));
    Promise.all(busy.map(o => o.turnDone())).then(() => (chat.state === 'ended' ? null : send(chat, text, images)))
      .catch(err => chat.emit(notice('warning', `Couldn’t send that to ${nameOf(chat)}: ${err.message}`)));
    return Promise.resolve(chat);
  }

  return { link, partnerOf, crewOf, kindsIn, leadOf, adopt, ensure, kindFor, mateOf, matesOf, catchUpFor, send, sendBoth, sendGroup, sendTogether, sendAfter, planFirst };
}

module.exports = { createPairs, KINDS };
