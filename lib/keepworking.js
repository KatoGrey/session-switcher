'use strict';
// "Keep it working until…": for the long job you leave running. An assistant finishes a turn and stops, and
// without you nothing happens until morning. With this on, a chat that's gone quiet gets a short message to
// carry on, until the time you chose. In a crew working at the same time each is looked after by itself, so one
// on a long job doesn't hold up the others; a crew taking turns goes round when they've all finished.
// It's your usage, so it's careful:
//   - nothing to one that's working, or waiting on you (a permission, a question);
//   - out of usage, it carries on as your account with the most room, or waits for the limit to reset (the others
//     in a crew carry on meanwhile);
//   - one that's said it's finished (ALL DONE), or got nothing done for two check-ins running, is left alone (until
//     someone else gets something done, or you write);
//   - one that's gone completely silent mid-reply for a long time is stopped, and told to carry on (a few times at
//     most; a long command normally says it's still going);
//   - it stops at the time, when none of them has anything left, after trouble that doesn't clear, and when you
//     press Stop.
// It looks at each chat's own record of events, so nothing about a chat has to know it's being kept at it. Kept
// in keep-working.json: a restart carries on, and a chat that stopped opens again when its next check-in is due.
// How each one ended stays there too, a little while, for the welcome-back card in the morning.
//
// What it needs from the app:
//   live       (id) → the running chat for a conversation, or null
//   crewOf     (lead) → its partners that are running
//   open       (id) → starts the conversation; rejects with status 409 while it can't yet
//   sendOne    (lead, kind, text, { signal }) → sends to that one, and returns its chat
//   sendAll    (lead, kinds, text, { signal, how }) → sends to them all: at the same time, or how: 'turns'
//   moveAccount (lead) → moves it to an account with room and returns that account's name, or null if there's none
//   onEnded    (chat, words) → it ended by itself (you know about the times you stopped it)

const path = require('path');
const store = require('./store');
const { notice } = require('./chat');
const { ownText } = require('./shared');

const MINUTE = 60e3;
const QUIET = { least: MINUTE, usual: 5 * MINUTE, most: 2 * 60 * MINUTE };
const LONGEST = 14 * 24 * 60 * MINUTE;
const MAX_NOTE = 2000;
const BACKOFF = 60 * MINUTE;   // the longest wait after trouble
const GIVE_UP = 6;             // this many failures running, and it stops
const NOTHING = 2;             // this many check-ins running with nothing done, and that one's left alone
const GRACE = 2 * MINUTE;      // how long a check-in gets to go in and get going, before it's judged
const SILENT = 40 * MINUTE;    // this long without a word mid-reply, and it's taken to be hung
const MAX_HUNG = 3;            // this many times, for each one of a crew
const MISSES = 3;              // this many check-ins that couldn't reach one of a crew, and it sits out a while
const NO_RESET_WAIT = 30 * MINUTE;
const RESET_MARGIN = MINUTE;
const KEEP_ENDED = 20;
const PREFIX = 'From Session Switcher: keep working';
const DONE = /(^|\n)[\s*_`#>-]*ALL DONE[\s*_`.!]*($|\n)/;

const provOf = chat => chat.provider || 'claude';
// The conversation a chat is on. A copy has its original's id until its first reply: it isn't that one yet.
const ownId = chat => (chat.fork && chat.sessionId === chat.startedAs ? null : chat.sessionId || null);
const clock = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function leftWords(ms) {
  const m = Math.max(1, Math.round(ms / MINUTE)), h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
}

function createKeepWorking({ dataDir, live, crewOf, open, sendOne, sendAll, moveAccount = null, log = () => {}, onChange = () => {}, onEnded = () => {}, now = () => Date.now() }) {
  const file = dataDir ? path.join(dataDir, 'keep-working.json') : null;
  const runs = new Map();   // conversation id (lower case) -> what you chose, and how it's going
  const notes = new Map();  // the same -> what's only true of this run of the app
  let ended = [];           // how the latest ones ended, by themselves
  const endedRecord = new WeakMap();   // a run's own line in that list
  const idOf = id => String(id || '').toLowerCase();

  function save() {
    if (!file) return;
    try { store.writeJsonAtomic(file, { runs: [...runs.values()], ended }); } catch (err) { log(`Couldn’t save keep-working.json: ${err.message}`); }
  }
  function load() {
    if (!file) return;
    const saved = store.loadOwnJson(file, {}, log) || {};
    ended = (Array.isArray(saved.ended) ? saved.ended : []).filter(e => e && typeof e.id === 'string' && Number.isFinite(e.at)).slice(-KEEP_ENDED);
    for (const r of Array.isArray(saved.runs) ? saved.runs : []) {
      if (r && typeof r.id === 'string' && Number.isFinite(r.until) && r.until > now()) runs.set(idOf(r.id), { nudges: 0, fails: 0, how: 'parallel', ...r, done: r.done || {}, out: r.out || {}, misses: r.misses || {}, rest: r.rest || {}, hung: r.hung || {} });
    }
  }
  const noteOf = run => {
    const k = idOf(run.id);
    if (!notes.has(k)) notes.set(k, { seen: new Map(), who: new Map(), closedSince: null, going: false, justOpened: false, state: 'working', error: null, nextAt: null });
    return notes.get(k);
  };
  // How each one of the crew is doing, by kind.
  const whoOf = (n, kind) => {
    if (!n.who.has(kind)) n.who.set(kind, { quietSince: null, sent: false, at: 0, replied: false, tools: 0, limited: false, failed: false });
    return n.who.get(kind);
  };
  const say = (chat, text, level = 'info') => { if (chat) { try { chat.emit(notice(level, text)); } catch { /* it's gone */ } } };
  const count = n => `${n} check-in${n === 1 ? '' : 's'}`;

  // The team as it is now: the chat itself, and those working in it.
  const teamOf = lead => [lead, ...crewOf(lead).filter(c => c.state !== 'ended')];

  function start({ id, until, quietMinutes, note, how }) {
    if (!id) throw Object.assign(new Error('Send it a message first: there’s nothing to keep going yet.'), { status: 400 });
    const when = Number(until);
    if (!Number.isFinite(when) || when <= now() + MINUTE) throw Object.assign(new Error('Pick a time that’s still to come.'), { status: 400 });
    if (when > now() + LONGEST) throw Object.assign(new Error('That’s further off than it can keep going (two weeks).'), { status: 400 });
    const quiet = Math.max(QUIET.least, Math.min(QUIET.most, (Number(quietMinutes) || QUIET.usual / MINUTE) * MINUTE));
    const had = runs.get(idOf(id));
    if (had) { const old = notes.get(idOf(id)); if (old && old.abort) old.abort.abort(); notes.delete(idOf(id)); }
    // Those working in it now: not everyone it ever had in, who'd come back on their own usage.
    const chat = live(id);
    const run = { nudges: had ? had.nudges : 0, fails: 0, done: {}, out: {}, misses: {}, rest: {}, hung: {}, kinds: chat ? teamOf(chat).map(provOf) : [], how: how === 'turns' ? 'turns' : 'parallel', startedAt: had ? had.startedAt : now(), id: String(id), until: when, quiet, note: String(note || '').trim().slice(0, MAX_NOTE) };
    runs.set(idOf(id), run);
    save();
    onChange();
    say(live(id), `Keep working is on, until ${clock(when)}. When it’s been quiet for ${leftWords(quiet)}, it gets a short message to carry on.`);
    log(`Keep working: ${id} until ${new Date(when).toISOString()}`);
    return view(id);
  }

  const ENDINGS = {
    time: run => `Keep working: that’s the time you set. It sent ${count(run.nudges)}.`,
    done: run => `Keep working: they say everything’s finished, so no more check-ins (${count(run.nudges)} sent).`,
    nothing: run => `Keep working: nothing more got done after ${NOTHING} check-ins running, so it’s stopped checking in (${count(run.nudges)} sent).`,
    trouble: (run, why) => `Keep working stopped: ${why || 'it kept failing'}. It sent ${count(run.nudges)}.`,
    stop: () => 'Keep working is off, because you pressed Stop. Turn it on again from the chat’s menu.',
    off: () => 'Keep working is off.',
  };
  function end(run, why, detail) {
    const k = idOf(run.id);
    if (runs.get(k) !== run) return;
    const n = notes.get(k);
    if (n && n.abort) n.abort.abort();   // a check-in on its way doesn't go
    runs.delete(k); notes.delete(k);
    // You know about the ones you stopped.
    if (why !== 'stop' && why !== 'off') {
      const record = { id: run.id, at: now(), why, detail: detail || null, nudges: run.nudges, startedAt: run.startedAt || null };
      endedRecord.set(run, record);
      ended = [...ended.filter(e => idOf(e.id) !== k), record].slice(-KEEP_ENDED);
    }
    save();
    const chat = live(run.id);
    if (chat) {
      // Nothing of ours is holding it open now.
      for (const c of teamOf(chat)) c.keepWorkingUntil = 0;
      say(chat, ENDINGS[why](run, detail), why === 'trouble' ? 'warning' : 'info');
      if (why !== 'stop' && why !== 'off') { try { onEnded(chat, ENDINGS[why](run, detail)); } catch (err) { log(`Keep working: ${err.message}`); } }
    }
    log(`Keep working: ${run.id} ended (${why})${detail ? `: ${detail}` : ''}`);
    onChange();
  }
  function stop(id, why = 'off') { const run = runs.get(idOf(id)); if (run) end(run, why); return !!run; }

  function textFor(run, at) {
    const note = run.note ? ` ${run.note}` : '';
    return `${PREFIX} until ${clock(run.until)} (${leftWords(run.until - at)} left; it’s ${clock(at)}).${note} Look at what’s changed and what anyone working here with you has said, then carry on with the next most useful thing. If everything is truly finished, reply with only: ALL DONE`;
  }

  // What's happened in a chat since the last look. Events carry their own numbers, and a chat keeps its recent ones.
  function scan(run, n, chat, at) {
    const kind = provOf(chat), m = whoOf(n, kind);
    const from = n.seen.has(chat.key) ? n.seen.get(chat.key) : (m.sent ? 0 : chat.seq || 0);
    for (const ev of chat.buffer || []) {
      if (ev.seq <= from) continue;
      if (ev.kind === 'user') {
        // Someone wrote to it, so there's more to do than they thought.
        if (!String(ownText(ev.text) || ev.text || '').includes(PREFIX)) { run.done = {}; run.rest = {}; m.tools = 0; m.sent = false; m.limited = false; }
      } else if (ev.kind === 'assistant') {
        for (const blk of ev.blocks || []) {
          if (blk.type !== 'text' && blk.type !== 'thinking') m.tools++;
          if (blk.type === 'text' && m.sent && DONE.test(blk.text || '')) run.done[kind] = true;
        }
      } else if (ev.kind === 'limit') {
        const back = Date.parse(ev.resetsAt);
        run.out[kind] = { until: Number.isFinite(back) ? back + RESET_MARGIN : at + NO_RESET_WAIT, account: chat.account ? chat.account.id : null };
        m.limited = true; m.failed = false;
      } else if (ev.kind === 'result') {
        m.replied = true;
        // Out of usage is its own wait, not trouble.
        if (ev.ok === false && !run.out[kind] && ev.subtype !== 'interrupted' && !ev.interrupted && !ev.cancelled) m.failed = true;
        else if (ev.ok) { run.fails = 0; delete run.out[kind]; }
      }
    }
    n.seen.set(chat.key, chat.seq || 0);
  }
  // Somebody got something done: the ones who'd run out of things to do get one more look.
  function progress(run, kind) {
    run.rest[kind] = 0;
    for (const k of Object.keys(run.rest)) if (k !== kind && run.rest[k] >= NOTHING) run.rest[k] = NOTHING - 1;
  }
  // Out of usage still? Carrying on as another account (the chat's autopilot) counts as back.
  function isOut(run, kind, team, at) {
    const out = run.out[kind];
    if (!out) return false;
    const c = team.find(x => provOf(x) === kind);
    if (at >= out.until || (c && out.account && c.account && c.account.id !== out.account)) { delete run.out[kind]; return false; }
    return true;
  }
  const waitOf = run => Math.min(BACKOFF, run.quiet * 2 ** run.fails);
  // One of the crew couldn't be reached. A few times, and it sits out a while.
  function missed(run, n, k, at) {
    run.misses[k] = (run.misses[k] || 0) + 1;
    n.error = `${k[0].toUpperCase()}${k.slice(1)} couldn’t be reached`;
    whoOf(n, k).quietSince = at;
    if (run.misses[k] >= MISSES) { delete run.misses[k]; run.out[k] = { until: at + BACKOFF, account: null, unreached: true }; }
  }
  // Still the run this was for? It can be turned off, or started again, while it's busy.
  const current = run => runs.get(idOf(run.id)) === run;

  // Silent for so long mid-reply that it's taken to be hung: stopped, and it's told to carry on like any other.
  function unstick(run, team, at) {
    for (const c of team) {
      const k = provOf(c);
      if (c.state !== 'busy' || (c.pending && c.pending.size) || !c.lastAt || at - c.lastAt < SILENT || (run.hung[k] || 0) >= MAX_HUNG) continue;
      run.hung[k] = (run.hung[k] || 0) + 1;
      c.lastAt = at;
      say(c, `Keep working: it’s said nothing for ${Math.round(SILENT / MINUTE)} minutes, so it was stopped, and it’ll be told to carry on.`, 'warning');
      log(`Keep working: ${run.id}: ${k} had gone silent; stopping it (${run.hung[k]})`);
      save();
      Promise.resolve().then(() => c.interrupt()).catch(err => log(`Keep working: couldn’t stop it: ${err.message}`));
    }
  }
  async function step(run, at) {
    const n = noteOf(run);
    if (at >= run.until) return end(run, 'time');   // first: whatever's still on its way is called off
    let lead = live(run.id);
    if (lead) unstick(run, teamOf(lead), at);       // and a round taking turns can't wait for one that's hung
    if (n.going) return;
    // Its id can change as it starts: the run goes with it.
    if (lead && ownId(lead) && idOf(ownId(lead)) !== idOf(run.id)) {
      const was = idOf(run.id), kept = noteOf(run);
      runs.delete(was); notes.delete(was);
      run.id = ownId(lead);
      runs.set(idOf(run.id), run); notes.set(idOf(run.id), kept);
      save();
    }
    if (!lead) {
      // Not running (it stopped, or the app restarted): it opens when a check-in is due.
      n.state = 'closed';
      if (n.closedSince === null) n.closedSince = at;
      n.nextAt = n.closedSince + waitOf(run);
      if (at < n.nextAt) return;
      n.going = true;
      n.state = 'opening';
      try {
        lead = await open(run.id);
        if (!current(run)) return;
        n.seen.clear(); n.who.clear(); n.justOpened = true; n.closedSince = null; run.fails = 0; n.error = null;
      } catch (err) {
        if (!current(run)) return;
        n.closedSince = at;
        // 409: it can't be opened just now (running in a terminal, or finishing from before a restart): not trouble.
        if (err.status !== 409 && ++run.fails >= GIVE_UP) { n.going = false; return end(run, 'trouble', err.message); }
        n.error = err.message;
      } finally { n.going = false; }
      return;
    }
    n.closedSince = null;
    const team = teamOf(lead);
    // An idle chat is let go after a while, but not this one.
    for (const c of team) c.keepWorkingUntil = run.until + MINUTE;
    // (What a look finds is kept straight away: a restart mustn't forget it's waiting for usage.)
    const wasFound = JSON.stringify([run.out, run.done]);
    for (const c of team) scan(run, n, c, at);
    if (JSON.stringify([run.out, run.done]) !== wasFound) save();
    // The chat itself first; anyone who's joined since counts too. One who's stopped is started again for its check-in.
    const kinds = [...new Set([provOf(lead), ...(run.kinds || []), ...team.map(provOf)])];
    run.kinds = kinds;
    const chatOf = k => team.find(c => provOf(c) === k) || null;
    const asks = c => !!(c && c.pending && c.pending.size);
    // (Work it started that's still going in the background is work too.)
    const busy = c => !!c && (c.state !== 'ready' || !!(c.background && c.background.length));
    const anyAsks = team.some(asks), anyBusy = team.some(busy);
    // Taking turns, it's a round: nothing until they've all finished.
    const together = run.how !== 'turns';
    if (!together && (anyAsks || anyBusy)) {
      for (const k of kinds) whoOf(n, k).quietSince = null;
      n.state = anyAsks ? 'asking' : 'working'; n.nextAt = null;
      return;
    }
    // How did each one's last check-in go? (It can take a moment to go in, and get going.)
    let judged = false;
    for (const k of kinds) {
      const c = chatOf(k), m = whoOf(n, k);
      if (busy(c) || asks(c)) { m.quietSince = null; continue; }
      if (m.sent) {
        if (!m.replied && at - m.at < GRACE) continue;
        m.sent = false; judged = true;
        if (m.failed) {
          m.failed = false;
          if (++run.fails >= GIVE_UP) return end(run, 'trouble', 'its replies kept failing');
        } else if (m.tools) progress(run, k);
        // Refused for usage says nothing about whether there's anything left to do.
        else if (!m.limited) run.rest[k] = (run.rest[k] || 0) + 1;
        m.tools = 0; m.limited = false;
      } else if (m.failed) { m.failed = false; run.fails++; } else if (m.tools) { progress(run, k); m.tools = 0; }
      if (m.quietSince === null) m.quietSince = at;
    }
    if (judged) save();
    if (kinds.every(k => run.done[k])) return end(run, 'done');
    const resting = k => (run.rest[k] || 0) >= NOTHING;
    if (!anyAsks && !anyBusy && !kinds.some(k => whoOf(n, k).sent) && kinds.every(k => run.done[k] || resting(k))) return end(run, 'nothing');
    // Out of usage, with another of your accounts to go to. Everyone's finished their turn, so nothing's cut short.
    if (moveAccount && !anyAsks && !anyBusy && !run.done[kinds[0]] && isOut(run, kinds[0], team, at) && !run.out[kinds[0]].unreached) {
      n.going = true;
      let name = null;
      try { name = await moveAccount(lead); } catch (err) { log(`Keep working: couldn’t move ${run.id}: ${err.message}`); } finally { n.going = false; }
      if (!current(run)) return;
      if (name) {
        delete run.out[kinds[0]];
        n.seen.clear(); n.who.clear(); n.justOpened = true;
        say(live(run.id), `Keep working: it was out of usage, so it carries on as ${name}.`);
        log(`Keep working: ${run.id} moved to ${name}`);
        save();
        return;
      }
    }
    // Who could be told now, and who's due.
    const free = kinds.filter(k => !run.done[k] && !resting(k) && !whoOf(n, k).sent && !busy(chatOf(k)) && !asks(chatOf(k)) && !isOut(run, k, team, at));
    const dueAt = k => (n.justOpened ? at : (whoOf(n, k).quietSince === null ? at : whoOf(n, k).quietSince) + waitOf(run));
    const outs = kinds.filter(k => run.out[k]);
    n.state = anyAsks ? 'asking' : anyBusy || kinds.some(k => whoOf(n, k).sent) ? 'working' : free.length ? 'waiting' : outs.length ? 'out' : 'waiting';
    n.nextAt = free.length ? Math.min(...free.map(dueAt)) : outs.length ? Math.min(...outs.map(k => run.out[k].until)) : null;
    const due = free.filter(k => at >= dueAt(k));
    if (!due.length) return;
    const going = together ? due : free;
    n.going = true;
    try {
      const text = textFor(run, at);
      n.abort = new AbortController();
      const { signal } = n.abort;
      // It counts from when someone has it: taking turns, the time can come while the first one's still replying.
      let counted = false;
      const count = () => {
        if (counted) return;
        counted = true;
        run.nudges++; run.lastNudgeAt = at;
        const record = endedRecord.get(run);
        if (record) record.nudges = run.nudges;
        save();
      };
      const got = going.length > 1 ? await sendAll(lead, going, text, { signal, how: run.how, onReached: count }) : [await sendOne(lead, going[0], text, { signal })];
      // Only those it reached have a reply to wait for. One it can't reach sits out a while, and says so.
      const reached = Array.isArray(got) && got.every(Boolean) ? got.map(provOf) : going;
      if (reached.length) count();
      if (!current(run)) return;
      n.error = null;
      for (const k of going) {
        const m = whoOf(n, k);
        if (reached.includes(k)) {
          delete run.misses[k];
          Object.assign(m, { sent: true, at, replied: false, tools: 0, limited: false, failed: false, quietSince: null });
        } else missed(run, n, k, at);
      }
      n.justOpened = false;
      n.state = anyAsks ? 'asking' : 'working'; n.nextAt = null;
      save();
      onChange();
    } catch (err) {
      if (!current(run)) return;
      for (const k of going) whoOf(n, k).quietSince = at;
      // One of the crew that won't start is its own problem: the rest carry on.
      if (err.status !== 409 && going.length === 1 && going[0] !== kinds[0]) { missed(run, n, going[0], at); save(); return; }
      n.error = err.message;
      if (err.status !== 409 && ++run.fails >= GIVE_UP) { n.going = false; return end(run, 'trouble', err.message); }
    } finally { n.going = false; }   // (n.abort stays: taking turns, the ones still to come can be called off until the next round)
  }
  async function tick() {
    // Each by itself: one waiting on a long round doesn't hold up the others.
    const at = now();
    await Promise.all([...runs.values()].map(run => step(run, at).catch(err => log(`Keep working: ${run.id}: ${err.message}`))));
  }

  // What the page shows.
  function view(id) {
    const run = runs.get(idOf(id));
    if (!run) return null;
    const n = noteOf(run);
    const outs = Object.values(run.out).map(o => o.until);
    return { until: run.until, quietMinutes: Math.round(run.quiet / MINUTE), how: run.how, note: run.note, nudges: run.nudges, lastNudgeAt: run.lastNudgeAt || null, state: n.state, nextAt: n.nextAt, backAt: n.state === 'out' && outs.length ? Math.min(...outs) : null, done: Object.keys(run.done), error: n.error };
  }

  load();
  return { start, stop, tick, view, list: () => [...runs.values()].map(r => r.id), has: id => runs.has(idOf(id)), endedSince: t => ended.filter(e => e.at >= t), QUIET, PREFIX };
}

module.exports = { createKeepWorking, ownId, QUIET, PREFIX };
