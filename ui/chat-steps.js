'use strict';
/* What the assistant is doing, step by step (ui/chat-feed.js draws the steps; this adds to them):
   - a running step counts its seconds ("Running · 12s"): one shared clock for every running step,
     which rewrites only those steps' timers, never the feed; a long step keeps its time once done;
   - a subagent step says which subagent, and on what model and effort ("scout · Haiku, low"), from
     the call itself or else from your subagents (Settings), read once and kept for a while;
   - the assistant's thinking shows as it streams, open, and folds once the reply moves on, unless
     you opened or shut it yourself (remembered for each one while the chat is open). */

/* ---------- step timers ---------- */
const STEP_LONG = 2000;   // a finished step shows how long it took from this long
const Steps = { running: new Set(), timer: 0 };
const stepSecs = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };
const stepTook = ms => (ms < 10000 ? `${(Math.max(0, ms) / 1000).toFixed(1)}s` : stepSecs(ms));
// One step's timer, drawn from its start. Under a second it says nothing: most steps are over by then.
function stepPaint(el) {
  if (el._wait) return;
  const ms = Date.now() - el._t0, t = el.querySelector('.t-time');
  if (!t || ms < 1000) return;
  if (!el._rs || !t.contains(el._rs)) {
    t.className = 't-time t-running';
    t.innerHTML = '<span class="t-rl">Running · </span><span class="t-rs" aria-live="off"></span>';
    el._rs = t.lastElementChild;
  }
  const s = stepSecs(ms);
  if (el._rs.textContent !== s) el._rs.textContent = s;
}
function stepTick() {
  for (const el of Steps.running) {
    if (!el.isConnected || !el.querySelector('.t-st.run')) { Steps.running.delete(el); continue; }
    stepPaint(el);
  }
  if (!Steps.running.size) { clearInterval(Steps.timer); Steps.timer = 0; }
}
function stepClock(el) {
  Steps.running.add(el);
  stepPaint(el);
  if (!Steps.timer) Steps.timer = setInterval(stepTick, 1000);
}
// A step that's started (at: when, as the PC saw it; a step replayed from earlier keeps its own time).
function stepRun(el, at) {
  const t = at ? Date.parse(at) : NaN;
  el._t0 = Number.isFinite(t) ? Math.min(Date.now(), t) : Date.now();
  stepClock(el);
}
// How long it's been going, from the assistant itself (a long command reports it).
function stepProgress(el, seconds) {
  if (!el.querySelector('.t-st.run')) return;
  el._wait = false;
  // (Its own count wins only when ours is well off: a phone's clock that isn't the PC's.)
  const t0 = Date.now() - (Number(seconds) || 0) * 1000;
  if (!el._t0 || Math.abs(el._t0 - t0) > 3000) el._t0 = t0;
  stepClock(el);
}
// Waiting for your OK: the clock waits too, and starts once you've answered.
function stepWait(el) { el._wait = true; el._rs = null; }
function stepResume(el, at) {
  if (!el._wait) return;
  const when = at ? Date.parse(at) : NaN;
  el._wait = false; el._t0 = Number.isFinite(when) ? Math.min(Date.now(), when) : Date.now();
  const t = el.querySelector('.t-time'); if (t) { t.className = 't-time'; t.textContent = ''; }
  if (el.querySelector('.t-st.run')) stepClock(el);
}
// Done: a long one keeps its time, quietly. at: when it finished; ms: how long it took, if known.
function stepDone(el, at, ms) {
  Steps.running.delete(el);
  el._wait = false; el._rs = null;
  const end = at ? Date.parse(at) : Date.now();
  const took = Number.isFinite(ms) ? ms : el._t0 && Number.isFinite(end) ? end - el._t0 : 0;
  const t = el.querySelector('.t-time'); if (!t) return;
  t.className = 't-time';
  t.textContent = '';
  if (took >= STEP_LONG) stepTookMark(t, took);
}
const stepTookMark = (t, ms) => { t.className = 't-time t-took'; t.textContent = stepTook(ms); t.title = `Took ${stepTook(ms)}`; };
// The reply ended (or the chat stopped) with steps that never said they were done: their clocks stop.
function stepsStop(root) {
  if (!root) return;
  for (const el of [...Steps.running]) if (root.contains(el)) { Steps.running.delete(el); const t = el.querySelector('.t-time'); if (t && !el._wait) { t.className = 't-time'; t.textContent = ''; } }
}

/* ---------- subagents ---------- */
// Claude's Agent (or Task) call: which subagent, and the model and effort it asked for, if it did.
function agentOf(v) {
  if (!v || (v.name !== 'Agent' && v.name !== 'Task')) return null;
  const m = v.meta || {}, raw = typeof v.detail === 'string' ? v.detail : '';
  // (From before the PC said so itself: read from the call, as it was shown.)
  const grab = k => { const r = new RegExp(`"${k}"\\s*:\\s*"([^"\\\\]{1,80})"`).exec(raw); return r ? r[1] : ''; };
  const type = m.agent || grab('subagent_type');
  return { type, name: type.replace(/^session-switcher:/, ''), model: m.model || grab('model'), effort: m.effort || grab('effort') };
}
// Your subagents (Settings → Subagents), read when a chat first shows one, and again after a while.
const Roster = { data: null, at: 0, loading: null };
function rosterSoon() {
  if (Roster.loading || (Roster.at && Date.now() - Roster.at < 5 * 60000)) return;
  Roster.loading = api('/api/subagents').then(v => { Roster.data = v && Array.isArray(v.roster) ? v : null; }).catch(() => {}).finally(() => {
    Roster.at = Date.now(); Roster.loading = null;
    // The steps already showing that didn't say their model learn it now.
    for (const chip of document.querySelectorAll('.t-agent:not([data-own])')) {
      const a = { type: chip.dataset.agent, name: chip.dataset.agent.replace(/^session-switcher:/, ''), model: '', effort: '' };
      const m = chip.querySelector('.t-am'), s = agentModel(a);
      if (m && m.textContent !== (s ? ` · ${s}` : '')) m.textContent = s ? ` · ${s}` : '';
    }
  });
}
const agentModelName = m => { const r = Roster.data && (Roster.data.models || []).find(x => x.value === m); return r && m !== 'inherit' ? r.label : m === 'inherit' ? '' : modelName(m); };
// "Haiku, low": the call's own choice, else what that subagent is set to.
function agentModel(a) {
  if (a.model || a.effort) return [a.model ? agentModelName(a.model) : '', a.effort].filter(Boolean).join(', ');
  const r = /^session-switcher:/.test(a.type) && Roster.data && Roster.data.roster.find(x => x.name === a.name);
  if (!r) return '';
  const model = r.engine === 'claude' || !r.engine ? agentModelName(r.model || '') : `${PROV_NAME[r.engine] || r.engine}${r.model ? ` ${r.model}` : ''}`;
  return [model, r.effort].filter(Boolean).join(', ');
}
function agentChip(a) {
  if (!a || !a.type) return '';
  if (!(a.model || a.effort)) rosterSoon();
  const s = agentModel(a);
  return `<span class="t-agent" data-agent="${esc(a.type)}"${a.model || a.effort ? ' data-own="1"' : ''} title="Subagent: ${esc(a.type)}"><span class="t-an">${esc(a.name)}</span><span class="t-am">${s ? ` · ${esc(s)}` : ''}</span></span>`;
}
// "delegated to scout and reviewer", for a reply's one-line summary of its steps.
function agentsLine(views) {
  const names = [...new Set(views.map(v => { const a = agentOf(v); return (a && a.name) || 'a subagent'; }))];
  return names.length ? `delegated to ${names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and ')}` : '';
}

/* ---------- thinking ---------- */
// The thinking that's open because it's the newest thing (it folds once the reply moves on), and what
// you opened or shut yourself, by where it sits in the chat.
const Think = { open: null, timer: 0, gen: null, user: new Map(), live: new Set() };
const thinkMine = () => { if (Think.gen !== C.gen) { Think.gen = C.gen; Think.user.clear(); Think.open = null; } return Think.user; };
function thinkKey(el) {
  if (el.dataset.bid) return el.dataset.bid;
  const p = el.closest('.part');
  return p && p.dataset.mid ? `${p.dataset.mid}:${[...p.querySelectorAll('.think')].indexOf(el)}` : null;
}
// A thinking block just drawn: as you left it, if you opened or shut it yourself.
function thinkAsLeft(el) {
  const k = thinkKey(el), was = k ? thinkMine().get(k) : undefined;
  if (was !== undefined) { el.open = was; el._userSet = true; }
}
// The reply moved on (it's writing, using a tool, or done): the thinking that was open folds.
function settleThink() {
  const el = Think.open; if (!el) return;
  Think.open = null;
  if (el.isConnected && !el._userSet) el.open = false;
}
// Thinking as it streams (Claude sends its words; the others only that they're thinking).
function thinkDelta(feed, mid, text) {
  if (!text) return;
  const p = part(feed, mid);
  let el = p._think;
  if (!el || !el.isConnected) {
    settleThink();
    withStick(() => p.querySelector('.final').insertAdjacentHTML('beforeend', '<details class="think" open data-live><summary>Thinking<span class="think-on" aria-hidden="true"></span></summary><div class="think-t"></div></details>'));
    el = p.querySelector('.final').lastElementChild;
    el._raw = '';
    p._think = el; thinkMine(); Think.open = el; Think.live.add(el);
    thinkAsLeft(el);
  }
  el._raw += text;
  if (!Think.timer) Think.timer = setTimeout(thinkFlush, el._raw.length > 20000 ? 600 : 150);
}
// Drawn a few times a second, not on every word.
function thinkFlush() {
  Think.timer = 0;
  for (const el of Think.live) {
    if (!el.isConnected || el._raw === undefined) { Think.live.delete(el); continue; }
    if (el._drawn === el._raw.length) continue;
    const raw = el._raw;
    withStick(() => { el.querySelector('.think-t').innerHTML = plain(raw); });
    el._drawn = raw.length;
  }
}
// The whole block arrived: the one that streamed takes it in place (still open, until the reply moves on).
function thinkBlock(p, b) {
  const el = p._think;
  if (!el || !el.isConnected || !el.hasAttribute('data-live')) return false;
  el.removeAttribute('data-live');
  el.querySelector('.think-on')?.remove();
  el.querySelector('.think-t').innerHTML = plain(b.text);
  el._raw = undefined; Think.live.delete(el);
  if (b.id) el.dataset.bid = b.id;
  p._think = null;
  return true;
}
// Opening or shutting one yourself is remembered (Enter or Space on it counts as a click too).
document.addEventListener('click', e => {
  const s = e.target instanceof Element && e.target.closest('#cFeed .think > summary');
  if (!s) return;
  const el = s.parentElement, k = thinkKey(el);
  el._userSet = true;
  if (k) thinkMine().set(k, !el.open);
});
