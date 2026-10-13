'use strict';
/* Keeps itself good: the problems inbox, the nightly self-check and the speed dashboard.
   Problems: a slip on this page (or on the PC) is noted, once each, with Ask Claude to fix this.
   The nightly self-check: its result, and a card on the hub when it found something.
   Speed: how long the hub, a chat and the first word of a reply take, this week against last. */

/* ---------- the page's own slips ---------- */
const Slips = { sent: new Set() };
function noteSlip(message, stack) {
  const m = String(message || '').slice(0, 400);
  // Not ours (a browser extension), or harmless (the browser's own resize notice).
  if (!m || /ResizeObserver loop|Script error\.?$/.test(m) || Slips.sent.has(m) || Slips.sent.size > 20) return;
  Slips.sent.add(m);
  api('/api/problems', { message: m, stack: String(stack || '').slice(0, 3000) }).catch(() => {});
}
window.addEventListener('error', e => {
  if (e.filename && !e.filename.startsWith(location.origin)) return;
  noteSlip(e.message, e.error && e.error.stack);
});
window.addEventListener('unhandledrejection', e => {
  const r = e.reason;
  // An answer from the PC that it couldn't do something is said in a toast already; slips are code errors.
  if (!(r instanceof TypeError || r instanceof ReferenceError || r instanceof RangeError || r instanceof SyntaxError)) return;
  noteSlip(r.message, r.stack);
});

/* ---------- Setup → Problems and speed ---------- */
async function loadProblems() {
  const box = $('problemsBox'); if (!box) return;
  let p, sc;
  try { [p, sc] = await Promise.all([api('/api/problems'), api('/api/selfcheck')]); } catch (err) { box.innerHTML = `<p class="loading">${esc(err.message)}</p>`; return; }
  Problems.data = p;
  const last = sc.last;
  const check = sc.running ? '<p class="pb-check">The self-check is running now (a few minutes, at low priority).</p>'
    : last ? `<p class="pb-check ${last.ok ? 'ok' : 'bad'}">${last.ok ? '✓' : '✖'} The last self-check, ${esc(agoL(Date.parse(last.at)))}: ${last.ok ? 'everything passed' : `${plural(last.failures.length, 'check')} failed`} (${esc(dur(last.ms))}).</p>`
      : '<p class="pb-check">No self-check yet: the first runs tonight at half past three, if nothing is working.</p>';
  const rows = p.problems.map(x => `<li class="pb-row"><div class="pb-t"><span class="pb-where">${esc(x.where)}</span><b>${esc(x.message)}</b><span class="pb-when">${esc(agoL(Date.parse(x.at)))}${x.count > 1 ? ` · ${x.count} times` : ''}</span></div>
    <div class="pb-b"><button class="btn sm" data-pb="fix" data-id="${esc(x.id)}">Ask Claude to fix this</button><button class="btn quiet sm" data-pb="clear" data-id="${esc(x.id)}">Put away</button></div></li>`).join('');
  box.innerHTML = `${check}
    <label class="toggle"><input type="checkbox" data-pref="nightlyCheck" ${S.prefs.nightlyCheck !== false ? 'checked' : ''}><span><b>Check itself every night</b><span>At half past three, when nothing is working, it runs its own tests and compares every theme with how it looked before, at low priority.</span></span></label>
    <p class="pb-act"><button class="btn sm" data-pb="run" ${sc.running ? 'disabled' : ''}>Run the self-check now</button>${p.problems.length > 1 ? '<button class="btn quiet sm" data-pb="clear" data-id="all">Put them all away</button>' : ''}</p>
    ${rows ? `<ul class="pb-list">${rows}</ul>` : '<p class="pb-none">No problems noted. Anything that goes wrong on this page or on the PC shows here, with a way to have Claude fix it.</p>'}
    <p class="d-h sub" id="st-speed">Speed</p>${speedHtml()}`;
}
const Problems = { data: null };
document.addEventListener('click', wrap(async e => {
  const b = e.target.closest('[data-pb]'); if (!b) return;
  const what = b.dataset.pb;
  if (what === 'run') { await api('/api/selfcheck', {}); toast('The self-check is running; its result shows here in a few minutes.', 4000); return loadProblems(); }
  if (what === 'clear') { await api('/api/problems', { clear: b.dataset.id }); return loadProblems(); }
  if (what === 'fix') {
    const d = Problems.data, x = d && d.problems.find(y => y.id === b.dataset.id); if (!x) return undefined;
    if ($('setup').open) $('setup').close();
    return ChatUI.open({ cwd: d.appDir, mode: 'new', initialText: `Session Switcher (this folder) hit a problem. Find the cause and fix it, then run the tests (node tests/run.js).\n\nWhere: ${x.where}${x.count > 1 ? ` (${x.count} times)` : ''}\nWhat: ${x.message}\n${x.stack ? `\nStack:\n${x.stack}\n` : ''}${d.log ? `\nThe end of switcher.log:\n${d.log}` : ''}` });
  }
  return undefined;
}));

/* ---------- the self-check card on the hub ---------- */
async function loadSelfCheckCard() {
  let sc = null;
  try { sc = await api('/api/selfcheck'); } catch { return; }
  const last = sc && sc.last;
  Problems.card = last && !last.ok && store('selfcheck-seen') !== last.at ? last : null;
  renderSelfCheckCard();
}
function renderSelfCheckCard() {
  let box = $('selfCheckCard');
  const last = Problems.card;
  if (!last || S.view !== 'hub' || !$('welcomeSlot')) { if (box) box.remove(); return; }
  if (!box) { $('welcomeSlot').insertAdjacentHTML('afterend', '<section class="whats-new pb-card" id="selfCheckCard" aria-label="Self-check"></section>'); box = $('selfCheckCard'); }
  const h = `<div class="wn-h"><p class="eyebrow">Self-check · ${esc(agoL(Date.parse(last.at)))}</p><b>${plural(last.failures.length, 'check')} failed${last.why === 'nightly' ? ' overnight' : ''}.</b></div>
    <ul class="pb-fails">${last.failures.slice(0, 3).map(f => `<li>${esc(f)}</li>`).join('')}</ul>
    <p class="wn-b"><button class="btn quiet sm" data-sc="seen">OK</button><button class="btn sm" data-sc="open">See them in Setup</button></p>`;
  if (box._h !== h) { box.innerHTML = h; box._h = h; }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-sc]'); if (!b) return;
  if (Problems.card) store('selfcheck-seen', Problems.card.at);
  Problems.card = null; renderSelfCheckCard();
  if (b.dataset.sc === 'open') openSetupAt('st-problems');
});

/* ---------- speed ---------- */
const Speed = { marks: {} };
const SPEED_WHAT = [['hub', 'The hub, from opening the app'], ['chat', 'A chat, from clicking it'], ['reply', 'A reply’s first word, from sending']];
function speedMark(what) { Speed.marks[what] = performance.now(); }
function speedDone(what) {
  const t = Speed.marks[what]; if (t === undefined) return;
  delete Speed.marks[what];
  speedNote(what, performance.now() - t);
}
function speedNote(what, ms) {
  if (!(ms > 0) || ms > 10 * 60e3) return;
  let all = {};
  try { all = JSON.parse(store('speed') || '{}') || {}; } catch { /* start again */ }
  all[what] = [...(all[what] || []), [Date.now(), Math.round(ms)]].slice(-300);
  store('speed', JSON.stringify(all));
}
function speedHtml() {
  let all = {};
  try { all = JSON.parse(store('speed') || '{}') || {}; } catch { /* nothing yet */ }
  const now = Date.now(), wk = 7 * 864e5;
  const mid = xs => { if (!xs.length) return null; const s = xs.map(x => x[1]).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const fmt = ms => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`);
  const rows = SPEED_WHAT.map(([k, label]) => {
    const xs = all[k] || [], a = mid(xs.filter(x => now - x[0] < wk)), b = mid(xs.filter(x => now - x[0] >= wk && now - x[0] < 2 * wk));
    if (a === null) return `<tr><th>${label}</th><td class="sp-n">no timings yet</td><td></td></tr>`;
    const ch = b ? Math.round((a - b) / b * 100) : null;
    const trend = ch === null ? '' : Math.abs(ch) < 10 ? '<span class="sp-same">about the same as last week</span>' : ch < 0 ? `<span class="sp-up">${-ch}% faster than last week</span>` : `<span class="sp-down">${ch}% slower than last week</span>`;
    return `<tr><th>${label}</th><td class="sp-n">${fmt(a)}</td><td>${trend}</td></tr>`;
  }).join('');
  return `<table class="speed"><tbody>${rows}</tbody></table><p class="pb-none">Typical times on this device this week (the middle of each), kept on this device.</p>`;
}
