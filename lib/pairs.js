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

function createPairs({ chats, prefs, transcript, lastChanged = () => 0, startPartner, kindOf = () => null, contextFor = () => '', onPaired = () => {}, log = () => {} }) {
  const provOf = chat => chat.provider || 'claude';
  const nameOf = chat => duo.NAME[provOf(chat)];
  const checkSend = signal => {
    if (signal && signal.aborted) throw Object.assign(new Error('This send was cancelled.'), { name: 'AbortError', code: 'ABORT_ERR', status: 409 });
  };
  // Cancelling future handoffs must not cancel the accepted reply's real completion. The crew
  // queue still owns that reply until its final snapshot is safe, even when its handoff is off.
  const untilCancelled = (promise, signal) => {
    if (!promise || !signal) return promise;
    return new Promise((resolve, reject) => {
      const finish = (fn, value) => { signal.removeEventListener('abort', cancel); fn(value); };
      const cancel = () => finish(resolve, { kind: 'cancelled' });
      if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
      promise.then(value => finish(resolve, value), err => finish(reject, err));
    });
  };
  const get = key => { if (!key) return null; try { return chats.get(key); } catch { return null; } };
  const alive = c => !!c && c.state !== 'ended';
  const hasStarted = c => !!c.startedEvents || c.buffer.some(e => e.kind === 'init' || e.kind === 'result' || e.kind === 'assistant');

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
  // (A copy that hasn't got its own id yet still has the original's: their crew isn't its crew.)
  const stillOriginal = chat => !!chat.fork && chat.sessionId === chat.startedAs;
  function rememberedCrew(lead) {
    if (!lead.sessionId || stillOriginal(lead)) return {};
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
    if (!lead || !lead.sessionId || !chat.sessionId || stillOriginal(lead) || stillOriginal(chat)) return;
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
      partner.resumeFallback = true;
      partner.exited.then(async () => {
        const waiting = (partner.waitingSends || []).splice(0);
        const cancelled = () => partner.stopping || lead.state === 'ended' || partner.parentKey !== lead.key;
        let needsReplay = false;
        try {
          if (hasStarted(partner)) return;
          needsReplay = true;
          if (cancelled()) return;
          lead.emit(notice('info', `${nameOf(partner)} couldn’t pick up its earlier conversation here, so it started a new one, caught up on this chat.`));
          const np = await open(lead, { accountId, fresh: true, kind });
          // Each original completion follows its retry. In particular, Take turns must not treat
          // the failed process exiting as this assistant's answer and start the next one early.
          for (const w of waiting) {
            if (cancelled() || partner.interruptedAt !== w.interruptedAt) {
              w.recover('The assistant stopped before receiving this message.'); continue;
            }
            try {
              const sent = await sendTurn(np, w.text, w.images, w.opts);
              w.delivered = true;
              w.resolveRetry(sent);
              const ev = await (sent.settled || sent.finished);
              if (ev.kind === 'ended' || np.stopping || np.interruptedAt) break;
            } catch (err) { w.recover(`Couldn’t pass that on: ${err.message}`); }
          }
        } catch (err) {
          lead.emit(notice('warning', `${nameOf(partner)} couldn’t start: ${err.message}`));
          for (const w of waiting) w.recover(`The assistant couldn’t restart: ${err.message}`);
        } finally {
          partner.resumeFallback = false;
          for (const w of waiting) {
            if (needsReplay && !w.delivered) w.recover('The assistant stopped before receiving this message.');
            w.resolveRetry(null);
          }
        }
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
        if (chat.state !== 'starting' || chat.initialized || chat.buffer.some(e => e.kind === 'init') || Date.now() > until) return resolve(true);
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
    if (!out.length && chat.sessionId && !stillOriginal(chat)) {
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
  const heardSince = chat => chat.heardUntil || (chat.sessionId && !stillOriginal(chat) && prefs.heard(chat.sessionId)) || null;
  // What a chat is told before your message: what the others said and did since it last caught up,
  // and files you put back from its own last reply.
  // crew: the kinds this message goes round to (All), known before they've all started.
  // group: the round you picked (Together), in order, this one among them: who it comes after.
  async function catchUpFor(chat, text, { relay = false, first = false, crew = null, group = null, together = false } = {}) {
    const undone = chat.undoneFiles ? chat.undoneFiles.slice() : [];
    const theirUndone = chat.partnerUndone ? chat.partnerUndone.slice() : [];
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
  async function prepareSend(chat, text, images, opts, snapshots) {
    checkSend(opts.signal);
    // A partner that stopped (it couldn't start, say): the chat's partner of that kind now, started if need be.
    if (chat.state === 'ended' && chat.parentKey) { const lead = leadOf(chat); if (lead !== chat && lead.state !== 'ended') chat = await ensure(lead, { kind: provOf(chat) }); }
    checkSend(opts.signal);
    const interruptedAt = chat.interruptedAt;
    // The cut-off is taken before reading, so whatever the others say during the snapshot below is
    // passed on next time instead of falling between them.
    const cutoff = new Date().toISOString();
    const undone = (chat.undoneFiles || []).length, theirUndone = (chat.partnerUndone || []).length;
    const block = contextFor(chat) + await catchUpFor(chat, text, opts);
    checkSend(opts.signal);
    const previousBaseline = chat.snap && chat.snap.pending;
    await chat.beforeTurn({ snapshots });   // every baseline is ready before a parallel group starts
    const baseline = chat.snap && chat.snap.pending !== previousBaseline ? chat.snap.pending : null;
    return { chat, text, images, opts, block, cutoff, undone, theirUndone, interruptedAt, baseline };
  }
  function deliver(prepared, watch = false) {
    const { chat, text, images, opts, block, cutoff, undone, theirUndone } = prepared;
    // Subscribe immediately before the send: a provider can report a failure or completion inside
    // send itself. If it throws instead, release the listener rather than waiting for another turn.
    const resumable = chat.resumeFallback && !hasStarted(chat);
    const controller = watch || resumable ? new AbortController() : null;
    const rawFinished = controller ? chat.turnDone(controller.signal) : null;
    const lead = leadOf(chat);
    const onUnsent = opts.onUnsent || (reason => keepUnsent(lead, text, images, { to: lead === chat ? 'me' : 'other', kind: provOf(chat) }, reason));
    let ticket;
    if (resumable) {
      let resolveRetry, recovered = false;
      const retry = new Promise(resolve => { resolveRetry = resolve; });
      ticket = { text, images, opts, interruptedAt: chat.interruptedAt, retry, resolveRetry,
        recover: reason => { if (!recovered) { recovered = true; onUnsent(reason); } } };
      (chat.waitingSends || (chat.waitingSends = [])).push(ticket);
    }
    const settled = rawFinished && rawFinished.then(async ev => {
      if (ticket) {
        if (ev.kind === 'ended') {
          const retried = await ticket.retry;
          if (retried) return { ...await (retried.settled || retried.finished), sourceChat: retried.chat };
        } else {
          const index = chat.waitingSends.indexOf(ticket);
          if (index >= 0) chat.waitingSends.splice(index, 1);
          ticket.resolveRetry(null);
        }
      }
      return ev;
    });
    const finished = untilCancelled(settled, opts.signal);
    try {
      checkSend(opts.signal);
      if (chat.stopping || chat.interruptedAt !== prepared.interruptedAt) throw Object.assign(new Error(`${nameOf(chat)} stopped before receiving this message.`), { status: 409 });
      chat.send(block + text, images, { ...opts, onUnsent });
      if (prepared.baseline) prepared.baseline.delivered = true;
      const overlapping = matesOf(chat).map(m => m.live).filter(c => c && (['busy', 'waiting'].includes(c.state) || (c.snap && c.snap.finishing)));
      if (overlapping.length && chat.markSharedWith) {
        chat.markSharedWith(overlapping);
        for (const peer of overlapping) if (peer.markSharedWith) peer.markSharedWith([chat]);
      }
    } catch (err) {
      if (controller) controller.abort();
      if (ticket) { const index = chat.waitingSends.indexOf(ticket); if (index >= 0) chat.waitingSends.splice(index, 1); ticket.resolveRetry(null); }
      if (prepared.baseline && !prepared.baseline.delivered && chat.snap.pending === prepared.baseline) {
        if (chat.clearPendingSnapshot) chat.clearPendingSnapshot(); else chat.snap.pending = null;
      }
      throw err;
    }
    if (chat.undoneFiles) chat.undoneFiles.splice(0, undone);
    if (chat.partnerUndone) chat.partnerUndone.splice(0, theirUndone);
    if (matesOf(chat).length) {
      chat.heardUntil = cutoff;
      if (chat.sessionId && !stillOriginal(chat)) {
        try { prefs.setHeard(chat.sessionId, cutoff); } catch (err) { log(`Couldn’t save ${nameOf(chat)}’s shared-context checkpoint: ${err.message}`); }
      }
    }
    return { chat, finished, settled };
  }
  async function send(chat, text, images = [], opts = {}) {
    return deliver(await prepareSend(chat, text, images, opts)).chat;
  }
  async function sendTurn(chat, text, images = [], opts = {}) {
    return deliver(await prepareSend(chat, text, images, opts), true);
  }
  // "Both" (one partner) or "All" (several): they take turns. The chat's own assistant answers first;
  // then each of the others picks the same message up in turn, already knowing the answers before
  // theirs, so they build on them instead of starting over (and never edit files at the same time).
  // Stopping the one answering skips the rest.
  async function sendBoth(lead, text, images = [], { accountId, kind, kinds, signal } = {}) {
    checkSend(signal);
    const list = [...new Set((Array.isArray(kinds) && kinds.length ? kinds : [kind || kindFor(lead)]).filter(k => KINDS.includes(k) && k !== provOf(lead)))];
    if (!list.length) list.push(kindFor(lead));
    const accepted = [];
    const work = await takeTurns(lead, [provOf(lead), ...list], text, images, { accountId, signal, accepted });
    return { ...work, delivered: accepted };
  }
  // The ones you picked, in the order they answer (Together): the chat's own assistant may be any
  // of them, or not one of them at all (Gemini, then Codex, in a Claude chat). Each is told who the
  // round is and where it comes in it.
  async function sendGroup(lead, text, images = [], { accountId, kinds, signal } = {}) {
    checkSend(signal);
    const group = [...new Set((Array.isArray(kinds) ? kinds : []).filter(k => KINDS.includes(k)))];
    if (group.length < 2) throw Object.assign(new Error('Pick at least two of them to work together.'), { status: 400 });
    const accepted = [];
    const work = await takeTurns(lead, group, text, images, { accountId, named: true, signal, accepted });
    return { ...work, delivered: accepted };
  }
  // At the same time: the ones you picked all get your message at once, each told who else is on it
  // and to do only its own part (you say who does what: "Claude: the save code. Codex: the icons.").
  async function sendTogether(lead, text, images = [], { accountId, kinds, signal } = {}) {
    checkSend(signal);
    const group = [...new Set((Array.isArray(kinds) ? kinds : []).filter(k => KINDS.includes(k)))];
    if (group.length < 2) throw Object.assign(new Error('Pick at least two of them to work at the same time.'), { status: 400 });
    const me = provOf(lead);
    const snapshots = new Map();
    const prepared = await Promise.all(group.map(async k => {
      let chat;
      try { chat = k === me ? lead : await ensure(lead, { accountId, kind: k }); } catch (err) { lead.emit(notice('warning', `${duo.NAME[k]} couldn’t start: ${err.message}`)); return null; }
      // A chat can stop after opening, or fail while preparing the send. Keep the other deliveries
      // successful so the user isn't invited to retry a message those assistants already received.
      try { return await prepareSend(chat, text, images, { together: true, group, signal }, snapshots); } catch (err) { if (err.name !== 'AbortError') lead.emit(notice('warning', `${duo.NAME[k]} couldn’t receive your message: ${err.message}`)); return null; }
    }));
    const sent = prepared.filter(Boolean).map(p => {
      try { return deliver(p).chat; } catch (err) { if (err.name !== 'AbortError') lead.emit(notice('warning', `${nameOf(p.chat)} couldn’t receive your message: ${err.message}`)); return null; }
    });
    if (!sent.some(Boolean)) { checkSend(signal); throw Object.assign(new Error('None of them could start.'), { status: 500 }); }
    return sent.filter(Boolean);
  }
  const midReply = chat => ['busy', 'waiting'].includes(chat.state);
  const stoppedWork = () => ({ handedOver: Promise.resolve(null), finished: Promise.resolve(null) });
  const pendingWork = promise => ({ handedOver: promise.then(work => work.handedOver), finished: promise.then(work => work.finished) });
  const keepUnsent = (lead, text, images, request, reason) => lead.emit({ kind: 'unsent', text, images, request, reason });
  // A held request owns the whole round, through the last reply, not merely its first send. Otherwise
  // two requests released by the same completion both start, each mistaking the other's results.
  // Plan first shares this queue; explicitly parallel sends remain independent.
  const rounds = new WeakMap();
  function serializeCrew(lead, kinds, start, recover) {
    const previous = rounds.get(lead);
    let release;
    const slot = new Promise(resolve => { release = resolve; });
    rounds.set(lead, slot);
    const finish = () => { if (rounds.get(lead) === slot) rounds.delete(lead); release(); };
    const markers = [lead, ...crewOf(lead)].filter(c => kinds.includes(provOf(c))).map(c => ({ chat: c, interruptedAt: c.interruptedAt, stopping: !!c.stopping }));
    const queuedAt = Date.now();
    const cancelled = () => markers.some(m => (!!m.chat.stopping && !m.stopping) || (m.chat.interruptedAt && m.chat.interruptedAt !== m.interruptedAt)) ||
      crewOf(lead).some(c => kinds.includes(provOf(c)) && !markers.some(m => m.chat === c) && (c.stopping || c.interruptedAt >= queuedAt));
    if (previous) {
      lead.emit(notice('info', 'Your next request waits for the current Together task to finish.'));
      const pending = previous.then(() => {
        if (cancelled()) { recover('You stopped the crew while this request was waiting.'); return stoppedWork(); }
        return start();
      }).catch(err => { recover(`The queued request couldn’t start: ${err.message}`); return stoppedWork(); });
      const work = pendingWork(pending);
      work.finished.then(finish, finish);
      return Promise.resolve({ handedOver: work.handedOver });
    }
    return Promise.resolve().then(start).then(work => {
      work.finished.then(finish, finish);
      return { handedOver: work.handedOver };
    }, err => { finish(); throw err; });
  }
  async function takeTurns(lead, group, text, images, { accountId, named = false, signal, accepted }) {
    const target = { to: 'group', kinds: group, how: 'turns' };
    return serializeCrew(lead, group, () => {
      if (signal && signal.aborted) return stoppedWork();
      return takeTurnsNow(lead, group, text, images, { accountId, named, signal, accepted });
    }, reason => { if (!(signal && signal.aborted)) keepUnsent(lead, text, images, target, reason); });
  }
  async function takeTurnsNow(lead, group, text, images, { accountId, named = false, signal, accepted }) {
    checkSend(signal);
    const recover = reason => { if (!(signal && signal.aborted)) keepUnsent(lead, text, images, { to: 'group', kinds: group, how: 'turns' }, reason); };
    const me = provOf(lead);
    // Each one's chat: this one, or its partner of that kind (started now, so it's ready in time).
    const warm = group.map(k => { const p = k === me ? Promise.resolve(lead) : ensure(lead, { accountId, kind: k }); p.catch(() => {}); return p; });
    const told = named ? { group } : {};
    let first;
    try { first = await warm[0]; } catch (err) { lead.emit(notice('warning', `${duo.NAME[group[0]]} couldn’t start: ${err.message}`)); throw err; }
    checkSend(signal);
    // Still on what it was doing: the round starts when that's done. (Its "done" would otherwise be
    // taken for its answer to this message, and the next one would start before it had read it.)
    if (midReply(first)) {
      const asked = Date.now();
      lead.emit(notice('info', `${duo.NAME[group[0]]} is still working. Your message goes to ${group.map(k => duo.NAME[k]).join(', then ')} once it’s done.`));
      const pending = first.turnDone(signal).then(ev => {
        if (signal && signal.aborted) return stoppedWork();
        if (first.stopping || (first.interruptedAt && first.interruptedAt >= asked)) {
          const reason = `${duo.NAME[group[0]]} stopped, so your message didn’t go out: “${String(text).trim().slice(0, 80)}…”`;
          lead.emit(notice('warning', reason)); recover(reason); return stoppedWork();
        }
        if (ev.kind === 'ended') {
          if (group.length > 1) { lead.emit(notice('warning', `${duo.NAME[group[0]]} stopped before receiving the request, so the remaining assistants pick it up.`)); return takeTurnsNow(lead, group.slice(1), text, images, { accountId, named, signal, accepted }); }
          recover(`${duo.NAME[group[0]]} stopped before receiving your message.`); return stoppedWork();
        }
        return runRound();
      }).catch(err => { if (err.name !== 'AbortError') { const reason = `Your message couldn’t go out: ${err.message}`; lead.emit(notice('warning', reason)); recover(reason); } return stoppedWork(); });
      return pendingWork(pending);
    }
    return runRound();
    async function runRound() {
      const sentAt = Date.now();
      const initial = await sendTurn(first, text, images, { first: group.length > 1, crew: group.filter(k => k !== group[0]), ...told, onUnsent: recover, signal });
      first = initial.chat;
      accepted.push(first);
      const rest = group.slice(1);
      if (rest.length) lead.emit({ kind: 'handoff', to: rest[0], state: 'waiting', ...(group[0] !== me ? { after: group[0] } : {}), ...(rest.length > 1 ? { order: rest } : {}) });
      let lastFinished = initial.settled;
      const done = (async () => {
        let prev = first, finished = initial.finished;
        const answered = [group[0]];
        for (let i = 1; i < group.length; i++) {
          const to = group[i];
          // If one couldn't start, the previous reply has already finished. Reuse that completion
          // when moving to the next assistant instead of waiting for a second reply that won't come.
          const ev = await finished;
          if (ev.sourceChat) prev = ev.sourceChat;
          // Stopped by you, that's the round. If it failed by itself, the others still get your message.
          if ((signal && signal.aborted) || prev.stopping || (prev.interruptedAt && prev.interruptedAt >= sentAt)) { lead.emit({ kind: 'handoff', to, state: 'skipped' }); return null; }
          if (ev.kind === 'ended' && answered.length) { const gone = answered.pop(); lead.emit(notice('warning', `${duo.NAME[gone]} stopped before it finished, so ${duo.NAME[to]} picks this up without its answer.`)); }
          let next;
          try { next = await warm[i]; } catch (err) { lead.emit({ kind: 'handoff', to, state: 'skipped' }); lead.emit(notice('warning', `${duo.NAME[to]} couldn’t pick this up: ${err.message}`)); continue; }
          if ((signal && signal.aborted) || next.stopping || next.interruptedAt >= sentAt || prev.stopping || prev.interruptedAt >= sentAt) { lead.emit({ kind: 'handoff', to, state: 'skipped' }); return null; }
          // On something of its own: it finishes that first, so its "done" below is for this message.
          if (midReply(next)) {
            const waitingSince = Date.now();
            await next.turnDone(signal);
            if ((signal && signal.aborted) || next.stopping || (next.interruptedAt && next.interruptedAt >= waitingSince) || prev.stopping || (prev.interruptedAt && prev.interruptedAt >= sentAt)) { lead.emit({ kind: 'handoff', to, state: 'skipped' }); return null; }
          }
          // Don't tell it that an unavailable assistant already answered.
          let delivered;
          try { delivered = await sendTurn(next, text, images, { relay: true, signal, ...(named ? { group: [...answered, ...group.slice(i)] } : {}) }); } catch (err) { lead.emit({ kind: 'handoff', to, state: 'skipped' }); if (err.name === 'AbortError') return null; lead.emit(notice('warning', `${duo.NAME[to]} couldn’t pick this up: ${err.message}`)); continue; }
          answered.push(to);
          accepted.push(delivered.chat);
          lead.emit({ kind: 'handoff', to, state: 'sent' });
          if (group[i + 1]) lead.emit({ kind: 'handoff', to: group[i + 1], state: 'waiting', after: to });
          prev = delivered.chat;
          finished = delivered.finished; lastFinished = delivered.settled;
        }
        return prev;
      })().catch(err => { log(`Hand-over: ${err.message}`); lead.emit({ kind: 'handoff', to: rest[0], state: 'skipped' }); return null; });
      return { handedOver: done, finished: done.then(() => lastFinished) };
    }
  }

  // "Plan first": the chat's own assistant drafts a plan (no changes yet), the other checks it, and the
  // chat then shows a card for you to pick who builds it. Each step arrives as a 'planfirst' event.
  // by: who drafts it (the chat's own assistant, unless you picked another); kind: who checks it.
  async function planFirst(lead, text, images = [], { accountId, kind, by = null } = {}) {
    const me = provOf(lead), who = by && KINDS.includes(by) ? by : me;
    const to = kind && kind !== who && KINDS.includes(kind) ? kind : who === me ? kindFor(lead) : me;
    await serializeCrew(lead, [who, to], () => planFirstNow(lead, text, images, { accountId, kind: to, by: who }), reason => keepUnsent(lead, text, images, { to: 'plan', by: who, kind: to }, reason));
    return lead;
  }
  async function planFirstNow(lead, text, images, { accountId, kind, by }) {
    const me = provOf(lead);
    const who = by && KINDS.includes(by) ? by : me;
    const to = kind && kind !== who && KINDS.includes(kind) ? kind : who === me ? kindFor(lead) : me;
    const chatOf = k => (k === me ? Promise.resolve(lead) : ensure(lead, { accountId, kind: k }));
    const drafter = chatOf(who), checker = chatOf(to);
    drafter.catch(() => {}); checker.catch(() => {});
    lead.emit({ kind: 'planfirst', state: 'drafting', who, to, ask: String(text).slice(0, 300) });
    let d;
    try { d = await drafter; } catch (err) { lead.emit({ kind: 'planfirst', state: 'stopped' }); throw err; }
    const draft = async () => {
      const sentAt = Date.now();
      const drafting = await sendTurn(d, `${text}\n\n(Plan first: reply with a short numbered plan for this, the files it would touch and any risks. Don't change any files yet: ${duo.NAME[to]} checks the plan next, then the user picks who builds it.)`, images, { onUnsent: reason => keepUnsent(lead, text, images, { to: 'plan', by: who, kind: to }, reason) });
      d = drafting.chat;
      const finished = drafting.finished.then(async ev => {
        if (ev.sourceChat) d = ev.sourceChat;
        if (ev.kind === 'ended' || (d.interruptedAt && d.interruptedAt >= sentAt)) return lead.emit({ kind: 'planfirst', state: 'stopped' });
        let c;
        try { c = await checker; } catch { return lead.emit({ kind: 'planfirst', state: 'ready', checked: false }); }
        if (c.stopping || c.interruptedAt >= sentAt || d.stopping || d.interruptedAt >= sentAt) return lead.emit({ kind: 'planfirst', state: 'stopped' });
        lead.emit({ kind: 'planfirst', state: 'checking', who, to });
        if (midReply(c)) {
          const waitingSince = Date.now();
          await c.turnDone();
          if (c.stopping || (c.interruptedAt && c.interruptedAt >= waitingSince) || d.stopping || (d.interruptedAt && d.interruptedAt >= sentAt)) return lead.emit({ kind: 'planfirst', state: 'stopped' });
        }
        let checking;
        const checkingAt = Date.now();
        try { checking = await sendTurn(c, `(Plan first) Check ${duo.NAME[who]}'s plan above for this request: what's missing, wrong or risky, and what you'd change. Be brief and concrete, and don't change any files yet; the user picks who builds it next.\n\nThe request: ${text}`); } catch (err) {
          lead.emit(notice('warning', `${duo.NAME[to]} couldn’t check the plan: ${err.message}`));
          return lead.emit({ kind: 'planfirst', state: 'ready', checked: false });
        }
        c = checking.chat;
        const done = await checking.finished;
        if (done.sourceChat) c = done.sourceChat;
        const stopped = done.kind === 'ended' || c.stopping || (c.interruptedAt && c.interruptedAt >= checkingAt);
        lead.emit({ kind: 'planfirst', state: stopped ? 'stopped' : 'ready', checked: !stopped });
      }).catch(err => { lead.emit(notice('warning', `Plan first stopped: ${err.message}`)); lead.emit({ kind: 'planfirst', state: 'stopped' }); });
      return { handedOver: Promise.resolve(d), finished };
    };
    // Still on what it was doing: the plan starts when that's done (see takeTurns).
    if (midReply(d)) {
      const asked = Date.now();
      lead.emit(notice('info', `${duo.NAME[who]} is still working. It drafts the plan once it’s done.`));
      const pending = d.turnDone().then(ev => {
        if (ev.kind === 'ended' || d.stopping || (d.interruptedAt && d.interruptedAt >= asked)) {
          lead.emit({ kind: 'planfirst', state: 'stopped' });
          keepUnsent(lead, text, images, { to: 'plan', by: who, kind: to }, `${duo.NAME[who]} stopped before receiving the plan request.`);
          return stoppedWork();
        }
        return draft();
      }).catch(err => {
        lead.emit(notice('warning', `Plan first stopped: ${err.message}`)); lead.emit({ kind: 'planfirst', state: 'stopped' });
        keepUnsent(lead, text, images, { to: 'plan', by: who, kind: to }, `The plan request couldn’t start: ${err.message}`);
        return stoppedWork();
      });
      return pendingWork(pending);
    }
    try { return await draft(); } catch (err) { lead.emit({ kind: 'planfirst', state: 'stopped' }); throw err; }
  }

  // Sends once the others have finished what they're doing, so they never edit files at the same
  // time; at once if none is busy. The chat says it's waiting meanwhile.
  function sendAfter(chat, text, images = []) {
    const busy = matesOf(chat).map(m => m.live).filter(o => o && ['busy', 'waiting'].includes(o.state));
    if (!busy.length) return send(chat, text, images);
    const lead = leadOf(chat), request = { to: lead === chat ? 'me' : 'other', kind: provOf(chat) };
    const recover = reason => keepUnsent(lead, text, images, request, reason);
    const asked = Date.now();
    const initialStops = [chat, ...busy].map(c => ({ chat: c, interruptedAt: c.interruptedAt }));
    chat.emit(notice('info', `Your message goes to ${nameOf(chat)} once ${busy.map(nameOf).join(' and ')} finish${busy.length === 1 ? 'es' : ''}.`));
    // Observe the work that is busy now before entering the shared queue. Waiting until a previous
    // request finishes could miss this completion and wait for a result that will never arrive.
    const ready = Promise.all(busy.map(o => o.turnDone()));
    return serializeCrew(lead, [provOf(chat), ...busy.map(provOf)], () => pendingWork(ready.then(async () => {
      if (chat.state === 'ended' || initialStops.some(m => m.chat.stopping || m.chat.interruptedAt !== m.interruptedAt)) {
        recover('A chat stopped while this request was waiting.'); return stoppedWork();
      }
      if (midReply(chat)) {
        await chat.turnDone();
        if (chat.stopping || chat.interruptedAt >= asked) { recover('The recipient stopped while this request was waiting.'); return stoppedWork(); }
      }
      const sent = await sendTurn(chat, text, images);
      return { handedOver: Promise.resolve(sent.chat), finished: sent.finished };
    }).catch(err => { recover(`Couldn’t send that to ${nameOf(chat)}: ${err.message}`); return stoppedWork(); })), recover).then(() => chat);
  }

  return { link, partnerOf, crewOf, kindsIn, leadOf, adopt, ensure, kindFor, mateOf, matesOf, catchUpFor, send, sendBoth, sendGroup, sendTogether, sendAfter, planFirst };
}

module.exports = { createPairs, KINDS };
