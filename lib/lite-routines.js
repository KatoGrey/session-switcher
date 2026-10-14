'use strict';
// Routines, the Lite way: a cheap checker runs on a schedule (say GLM on Ollama, read-only), ends
// its reply with a verdict, and Lite reads it:
//   ALL CLEAR: <one line>          nothing to do; the run stays quiet
//   ESCALATE: <title>              Lite tells you (Now, the phone), and can start a real chat
//   <what it found>                (your use-next Claude plan) that writes it up as a bug report
// Failed runs and runs waiting on you are surfaced too. The routines themselves are the full app's
// (routines.json, lib/routines.js); what's Lite's lives in lite.json:
//   routineFlow:   { <routine id>: { triage, notify: 'important'|'always'|'never', escalate: { on, prompt, provider?, model?, effort?, permissionMode? } } }
//   routineEvents: [{ id, routine, name, run, at, kind: 'escalate'|'failed'|'needs-you'|'ran', title, text, provider, sessionId, escalation, seen }]
//   routineSeen:   { <run id>: status }   so a run is handled once (and a restart never re-fires old runs)

const crypto = require('crypto');

const MARK = '\n\n— Switcher Lite —\n';
const SUFFIX = `${MARK}When you're done, end your reply with exactly one of these as its last paragraph:\nALL CLEAR: <what you checked and found, in one short sentence>\nESCALATE: <a short title for what needs attention>\n<what you found: who, where, links, and why it matters>`;
const ESCALATE_PROMPT = 'A routine check (“{name}”) flagged something that needs attention:\n\n{findings}\n\nWrite it up as a bug report: what’s wrong, how to reproduce it, the impact, and the evidence (with links). Use your usual skills for this. Then look for the cause and propose a fix. Don’t post or send anything anywhere; write any messages as drafts.';
const MAX_EVENTS = 120;
const PER_DAY = 3;          // escalation chats per routine per day, unless the routine says otherwise
const SAME_DAYS = 7;        // the same title again within this long joins the earlier one
const DAY = 864e5;
const FINAL = new Set(['done', 'failed', 'stopped', 'skipped']);

const withSuffix = prompt => `${stripSuffix(prompt)}${SUFFIX}`;
const stripSuffix = prompt => { const s = String(prompt || ''); const i = s.indexOf(MARK); return i < 0 ? s : s.slice(0, i); };

// Every ESCALATE in a reply (a sweep can find several), each with the text up to the next one.
// Pure, for tests.
function escalationsOf(text) {
  const s = String(text || '').replace(/\r/g, '');
  const re = /^[*_#>\s]*ESCALATE\s*\**\s*:\s*\**\s*(.*)$/gim;
  const hits = []; let m;
  while ((m = re.exec(s))) hits.push({ title: m[1].replace(/[*_]+$/, '').trim().slice(0, 140), at: m.index, end: re.lastIndex });
  return hits.map((h, i) => ({ kind: 'escalate', title: h.title, details: s.slice(h.end, i + 1 < hits.length ? hits[i + 1].at : undefined).replace(/^[*_#>\s]*ALL CLEAR[\s\S]*$/im, '').trim().slice(0, 4000) }));
}
// The verdict at the end of a reply. Pure, for tests.
function verdictOf(text) {
  const s = String(text || '').replace(/\r/g, '');
  const re = /^[*_#>\s]*(ALL CLEAR|ESCALATE)\s*\**\s*:\s*\**\s*(.*)$/gim;
  let m, last = null;
  while ((m = re.exec(s))) last = { kind: m[1].toUpperCase() === 'ESCALATE' ? 'escalate' : 'clear', title: m[2].replace(/[*_]+$/, '').trim(), at: m.index, end: re.lastIndex };
  if (!last) return { kind: 'none', title: '', details: '' };
  const after = s.slice(last.end).trim(), before = s.slice(0, last.at).trim();
  return { kind: last.kind, title: last.title.slice(0, 140), details: (after || before).slice(0, 4000) };
}

function createLiteRoutines({ store, routinesList, lastReply, startEscalation, escalationAccount, notify = async () => 0, nameChat = async () => {}, log = () => {}, broadcast = () => {} }) {
  const live = new Map(); // escalation chat key -> { chat, event id }
  let timer = null, busy = false;
  const data = () => store.get();
  // A routine made in the full app isn't triaged until you turn it on here (its prompt has no verdict ask).
  const flowOf = id => ({ triage: false, notify: 'important', escalate: { on: false, prompt: '' }, ...((data().routineFlow || {})[id] || {}) });

  function addEvent(e) {
    const ev = { id: crypto.randomBytes(5).toString('hex'), at: Date.now(), seen: false, ...e };
    store.setRoutineEvents([ev, ...(data().routineEvents || [])].slice(0, MAX_EVENTS));
    return ev;
  }
  const patchEvent = (id, patch) => store.setRoutineEvents((data().routineEvents || []).map(e => (e.id === id ? { ...e, ...patch } : e)));

  async function escalate(r, h, v, text) {
    const events = data().routineEvents || [];
    const same = events.find(e => e.routine === r.id && e.kind === 'escalate' && e.startedChat && e.title.toLowerCase() === v.title.toLowerCase() && Date.now() - e.at < SAME_DAYS * DAY);
    const today = events.filter(e => e.routine === r.id && e.startedChat && Date.now() - e.at < DAY).length;
    const cap = Math.max(1, Math.min(10, Number(flowOf(r.id).maxPerDay) || PER_DAY));
    const base = { routine: r.id, name: r.name, run: h.id, kind: 'escalate', title: v.title || 'Needs attention', text: v.details || text.slice(0, 4000), provider: r.provider, sessionId: h.sessionId || null };
    const flow = flowOf(r.id);
    if (!flow.escalate.on) return addEvent(base);
    if (same) return addEvent({ ...base, note: `Same as ${new Date(same.at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}; that chat has it.`, escalation: same.escalation });
    if (today >= cap) return addEvent({ ...base, note: `Already started ${cap} bug chats for this routine today, so this one waits for you.` });
    const ev = addEvent({ ...base, startedChat: true, escalation: { state: 'starting' } });
    try {
      const prompt = (flow.escalate.prompt || ESCALATE_PROMPT).replace(/\{name\}/g, r.name).replace(/\{findings\}/g, `${v.title}\n\n${v.details || text}`.slice(0, 6000));
      const title = `${v.title} (from ${r.name})`.slice(0, 120);
      // The bug chat runs on Claude (the use-next plan) unless the routine says Codex (then the
      // use-next ChatGPT plan), with the routine's model, effort and permission mode if set.
      const e = flow.escalate || {};
      const chat = await startEscalation({ account: escalationAccount(e.provider === 'codex' ? 'codex' : 'claude'), cwd: r.cwd, title, prompt, model: e.model || null, effort: e.effort || null, permissionMode: e.permissionMode || null });
      live.set(chat.key, { chat, event: ev.id, title });
      patchEvent(ev.id, { escalation: { state: 'running', key: chat.key, sessionId: chat.sessionId || null } });
      log(`Lite: routine ${r.name} escalated “${v.title}”; bug chat started`);
    } catch (err) {
      patchEvent(ev.id, { escalation: null, startedChat: false, note: `Couldn’t start the bug chat (${err.message}).` });
      log(`Lite: escalation for ${r.name} failed (${err.message})`);
    }
    return ev;
  }

  async function handle(r, h) {
    const flow = flowOf(r.id);
    if (h.status === 'skipped') return;
    if (h.status === 'failed' || h.status === 'stopped') {
      if (flow.notify === 'never') return;
      addEvent({ routine: r.id, name: r.name, run: h.id, kind: 'failed', title: h.line || 'The run failed.', provider: r.provider, sessionId: h.sessionId || null });
      notify('routine', { title: `${r.name} didn’t finish`, body: String(h.line || '').slice(0, 180), tag: `rt-${r.id}`, url: '/lite?view=routines' }).catch(() => {});
      return;
    }
    // done
    let text = h.line || '';
    if (flow.triage && h.sessionId) { try { text = (await lastReply(h.sessionId, r.provider)) || text; } catch { /* the line will do */ } }
    const v = flow.triage ? verdictOf(text) : { kind: 'none' };
    const all = flow.triage ? escalationsOf(text) : [];
    if (all.length) {
      const evs = [];
      for (const one of all) evs.push(await escalate(r, h, one, text));
      if (flow.notify !== 'never') notify('routine', { title: evs.length === 1 ? `${r.name}: ${evs[0].title}` : `${r.name}: ${evs.length} things need attention`, body: (evs.length === 1 ? (evs[0].note || (evs[0].escalation ? 'A bug chat is writing it up.' : 'Open it to see what it found.')) : evs.map(e => e.title).join(' · ')).slice(0, 180), tag: `rt-${r.id}`, url: '/lite?view=now' }).catch(() => {});
    } else if (flow.notify === 'always') {
      addEvent({ routine: r.id, name: r.name, run: h.id, kind: 'ran', title: v.kind === 'clear' ? `All clear: ${v.title}` : String(h.line || 'Finished.').slice(0, 200), provider: r.provider, sessionId: h.sessionId || null, seen: v.kind === 'clear' });
    }
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const list = routinesList() || [];
      const seen = { ...(data().routineSeen || {}) };
      // The first time: everything already there counts as handled.
      if (!data().routineSeenInit) { for (const r of list) for (const h of r.history || []) seen[h.id] = h.status; store.setRoutineSeen(seen, true); return; }
      let changed = false;
      for (const r of list) {
        for (const h of (r.history || []).slice().reverse()) {
          if (seen[h.id] === h.status) continue;
          if (h.status === 'needs-you' && seen[h.id] !== 'needs-you') {
            addEvent({ routine: r.id, name: r.name, run: h.id, kind: 'needs-you', title: h.line || 'Waiting for you.', provider: r.provider, sessionId: h.sessionId || null });
            notify('routine', { title: `${r.name} needs you`, body: String(h.line || '').slice(0, 180), tag: `rt-${r.id}`, url: '/lite?view=now' }).catch(() => {});
            seen[h.id] = h.status; changed = true; continue;
          }
          if (!FINAL.has(h.status)) continue;
          seen[h.id] = h.status; changed = true;
          try { await handle(r, h); } catch (err) { log(`Lite: routine ${r.name} run ${h.id}: ${err.message}`); }
        }
      }
      // Escalation chats learn their id once started.
      for (const [key, x] of live) {
        if (x.chat.sessionId) {
          const ev = (data().routineEvents || []).find(e => e.id === x.event);
          if (ev && ev.escalation) patchEvent(ev.id, { escalation: { ...ev.escalation, sessionId: x.chat.sessionId, state: 'running' } });
          nameChat(x.chat, x.title).catch(err => log(`Lite: couldn’t name the bug chat (${err.message})`));
          live.delete(key);
        }
      }
      if (changed) {
        const ids = new Set(list.flatMap(r => (r.history || []).map(h => h.id)));
        for (const k of Object.keys(seen)) if (!ids.has(k)) delete seen[k];
        store.setRoutineSeen(seen, true);
        broadcast('lite', {});
      }
    } finally { busy = false; }
  }
  function start() {
    if (timer) return;
    setTimeout(() => tick().catch(() => {}), 5000).unref();
    timer = setInterval(() => tick().catch(() => {}), 15000); timer.unref();
  }
  // Chats Lite should keep out of the calm lists (each run's own chat) and ones it should mark (bug chats it started).
  function runChats() {
    const out = new Map();
    for (const r of routinesList() || []) for (const h of r.history || []) if (h.sessionId) out.set(String(h.sessionId).toLowerCase(), r.name);
    return out;
  }
  function escalationChats() {
    const out = new Map();
    for (const e of data().routineEvents || []) if (e.escalation && e.escalation.sessionId) out.set(String(e.escalation.sessionId).toLowerCase(), e.name);
    return out;
  }
  return { tick, start, runChats, escalationChats, flowOf };
}

module.exports = { createLiteRoutines, verdictOf, escalationsOf, withSuffix, stripSuffix, SUFFIX, ESCALATE_PROMPT };
