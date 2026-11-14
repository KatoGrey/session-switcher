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
  // An answer from the PC that it couldn't do something is said in a toast already (and kept under What went wrong
  // lately); slips are code errors.
  if (!(r instanceof TypeError || r instanceof ReferenceError || r instanceof RangeError || r instanceof SyntaxError)) return;
  noteSlip(r.message, r.stack);
});

/* ---------- what went wrong lately: the errors toasts said, kept on this device ---------- */
// A toast fades, so every error one says is kept here too (ui/toasts.js), to be found later in Setup → Problems: the
// last 20, for a day, on this device. Only the words that were shown, and never a key or token even if one was in
// them. Try again (when whatever failed gave a way) lasts while this window stays open.
const Lately = { key: 'recent-problems', max: 20, keep: 864e5, again: new Map(), n: 0 };
function latelyList() {
  let list = [];
  try { list = JSON.parse(store(Lately.key) || '[]'); } catch { list = []; }
  const now = Date.now();
  return (Array.isArray(list) ? list : []).filter(x => x && typeof x.text === 'string' && now - x.at < Lately.keep).slice(0, Lately.max);
}
const latelySave = list => store(Lately.key, JSON.stringify(list.slice(0, Lately.max)));
const unsecret = s => String(s)
  .replace(/\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|lin_api_[A-Za-z0-9]{8,}|xox[abprs]-[A-Za-z0-9-]{8,})/g, '…')
  .replace(/\b(bearer)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, '$1 …')
  .replace(/\b(token|api[_-]?key|secret|password)(\s*[=:]\s*)[^\s,;'")\]]+/gi, '$1$2…');
// Where you were, to help place it: a chat, Setup, or the page.
function latelyWhere() {
  if ($('setup') && $('setup').open) return 'Setup';
  if (window.ChatUI && ChatUI.isOpen()) return 'A chat';
  if (S.view === 'folder') return (S.projects.find(p => p.cwd === S.folder) || {}).name || 'A project';
  return { hub: voice('The hub'), work: voice('Your work'), recent: voice('Recent chats'), routines: voice('Routines'), aide: 'Companion', search: 'Search' }[S.view] || '';
}
// Called for each error toast. The same words again are the same entry, moved to the top (and counted, unless its toast
// is still showing: then it's the same time, said twice). Returns its id.
function noteError(text, again = null, showing = false) {
  const t = unsecret(String(text || '').trim()).slice(0, 600);
  if (!t) return null;
  const list = latelyList(), old = list.find(x => x.text === t);
  const x = old || { id: `e${Date.now().toString(36)}${(++Lately.n).toString(36)}`, text: t, count: 0 };
  if (!(old && showing)) Object.assign(x, { at: Date.now(), where: latelyWhere(), count: (x.count || 0) + 1 });
  latelySave([x, ...list.filter(y => y !== x)]);
  if (again) Lately.again.set(x.id, again);
  latelyPaint();
  return x.id;
}
function forgetError(id) {
  latelySave(id === 'all' ? [] : latelyList().filter(x => x.id !== id));
  if (id === 'all') Lately.again.clear(); else Lately.again.delete(id);
  latelyPaint();
}
// On the phone it's the whole of Setup → Problems, so it says so when there's nothing.
function latelyHtml() {
  const list = latelyList(), phone = !!window.REMOTE;
  const row = x => `<li class="pb-row lately-row" data-id="${esc(x.id)}"><div class="pb-t">${x.where ? `<span class="pb-where">${esc(x.where)}</span>` : ''}<b>${esc(x.text)}</b><span class="pb-when" title="${esc(stamp(x.at))}">${esc(agoL(x.at))}${x.count > 1 ? ` · ${x.count} times` : ''}</span></div>
    <div class="pb-b">${Lately.again.has(x.id) ? `<button class="btn sm" data-lately="again" data-id="${esc(x.id)}">Try again</button>` : ''}<button class="btn quiet sm" data-lately="clear" data-id="${esc(x.id)}">Put away</button></div></li>`;
  const body = list.length ? `<ul class="pb-list">${list.map(row).join('')}</ul>${list.length > 1 ? '<p class="pb-act"><button class="btn quiet sm" data-lately="clear" data-id="all">Put them all away</button></p>' : ''}`
    : phone ? '<p class="pb-none">Nothing has gone wrong here lately. When something does, it’s listed here for a day, with Try again where it can be.</p>' : '';
  return `<div class="lately" id="latelyBox">${list.length && !phone ? '<p class="d-h sub" id="st-lately">What went wrong lately</p>' : ''}${body}</div>`;
}
function latelyPaint() { const el = $('latelyBox'); if (el) el.outerHTML = latelyHtml(); }
document.addEventListener('click', e => {
  const b = e.target.closest('[data-lately]'); if (!b) return;
  const id = b.dataset.id, rows = [...document.querySelectorAll('#latelyBox .lately-row')], i = rows.findIndex(r => r.dataset.id === id);
  if (b.dataset.lately === 'again') { const fn = Lately.again.get(id); if (fn) toast.again(fn, id); }
  else forgetError(id);
  // The keyboard goes on to the next one, or back to the section, rather than to nowhere.
  const left = [...document.querySelectorAll('#latelyBox .lately-row')];
  const next = left[Math.min(Math.max(i, 0), left.length - 1)];
  (next ? next.querySelector('button') : $('problemsBox') && $('problemsBox').querySelector('button, input'))?.focus({ preventScroll: true });
});
latelySave(latelyList());   // (anything older than a day goes)

/* ---------- Setup → Problems and speed ---------- */
async function loadProblems() {
  const box = $('problemsBox'); if (!box) return;
  // On the phone, only what went wrong here; on the PC, that first (even if the PC doesn't answer), then the rest.
  if (window.REMOTE) { box.innerHTML = latelyHtml(); return; }
  let p, sc;
  try { [p, sc] = await Promise.all([api('/api/problems'), api('/api/selfcheck')]); } catch (err) { box.innerHTML = `${latelyHtml()}<p class="loading">${esc(err.message)}</p>`; return; }
  Problems.data = p;
  const last = sc.last;
  const check = sc.running ? '<p class="pb-check">The self-check is running now (a few minutes, at low priority).</p>'
    : last ? `<p class="pb-check ${last.ok ? 'ok' : 'bad'}">${last.ok ? '✓' : '✖'} The last self-check, ${esc(agoL(Date.parse(last.at)))}: ${last.ok ? 'everything passed' : `${plural(last.failures.length, 'check')} failed`} (${esc(dur(last.ms))}).</p>`
      : '<p class="pb-check">No self-check yet: the first runs tonight at half past three, if nothing is working.</p>';
  const rows = p.problems.map(x => `<li class="pb-row"><div class="pb-t"><span class="pb-where">${esc(x.where)}</span><b>${esc(x.message)}</b><span class="pb-when">${esc(agoL(Date.parse(x.at)))}${x.count > 1 ? ` · ${x.count} times` : ''}</span></div>
    <div class="pb-b"><button class="btn sm" data-pb="fix" data-id="${esc(x.id)}">Ask Claude to fix this</button><button class="btn quiet sm" data-pb="report" data-id="${esc(x.id)}" title="Opens a GitHub issue for KatoGrey, filled in (nothing personal)">Report it</button><button class="btn quiet sm" data-pb="copy" data-id="${esc(x.id)}">Copy report</button><button class="btn quiet sm" data-pb="clear" data-id="${esc(x.id)}">Put away</button></div></li>`).join('');
  box.innerHTML = `${latelyHtml()}${check}
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
  if (what === 'report' || what === 'copy') {
    const d = Problems.data, x = d && d.problems.find(y => y.id === b.dataset.id); if (!x) return undefined;
    const body = problemReport(x, d.log);
    if (what === 'copy') { await navigator.clipboard.writeText(body); toast('Copied, with nothing personal in it. Paste it to whoever looks after Session Switcher.', 4000); return undefined; }
    const url = `https://github.com/${REPORT_REPO}/issues/new?title=${encodeURIComponent(`Problem: ${x.message.slice(0, 90)}`)}&body=${encodeURIComponent(body.slice(0, 6000))}`;
    window.open(url, '_blank', 'noopener');
    return undefined;
  }
  if (what === 'fix') {
    const d = Problems.data, x = d && d.problems.find(y => y.id === b.dataset.id); if (!x) return undefined;
    if ($('setup').open) $('setup').close();
    if (!S.projects.some(p => p.cwd.toLowerCase() === String(d.appDir).toLowerCase())) { await api('/api/project/create', { existing: d.appDir }); await loadSessions(); renderNav(); }
    return ChatUI.open({ cwd: d.appDir, mode: 'new', initialText: `Session Switcher (this folder) hit a problem. Find the cause and fix it, then run the tests (node tests/run.js).${S.shell ? ' This is the installed copy, so a change here lasts until its next update.' : ''}\n\nWhere: ${x.where}${x.count > 1 ? ` (${x.count} times)` : ''}\nWhat: ${x.message}\n${x.stack ? `\nStack:\n${x.stack}\n` : ''}${d.log ? `\nThe end of switcher.log:\n${d.log}` : ''}` });
  }
  return undefined;
}));

/* ---------- reporting a problem ---------- */
// Where reports go: the app's own repository.
const REPORT_REPO = 'KatoGrey/session-switcher';
// Nothing personal leaves: email addresses, your name in paths, keys and tokens are taken out.
function scrub(text) {
  return String(text || '')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
    .replace(/([A-Za-z]:\\+Users\\+|\/Users\/|\/home\/)[^\\/\s'"]+/gi, '$1<you>')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|[A-Fa-f0-9]{32,}|[A-Za-z0-9+/_-]{40,}={0,2})/g, '<redacted>')
    .replace(/(token|key|secret|password|authorization)(["'\s:=]+)(?:Bearer\s+|Basic\s+)?[^\s"',}]+/gi, '$1$2<redacted>');
}
function problemReport(x, log) {
  const where = [`Session Switcher ${S.appVersion}`, S.shell ? 'installed app' : 'folder copy', S.platform === 'win32' ? 'Windows' : S.platform === 'darwin' ? 'macOS' : S.platform].join(', ');
  return scrub([
    `**What happened:** ${x.message}`,
    `**Where:** ${x.where}${x.count > 1 ? ` (${x.count} times, last ${new Date(x.at).toISOString()})` : ` (${new Date(x.at).toISOString()})`}`,
    `**Version:** ${where}`,
    '',
    '**What I was doing:** (add a line here if you remember)',
    ...(x.stack ? ['', '<details><summary>Stack</summary>', '', '```', x.stack.slice(0, 2500), '```', '</details>'] : []),
    ...(log ? ['', '<details><summary>The end of switcher.log</summary>', '', '```', String(log).split('\n').slice(-25).join('\n').slice(0, 2500), '```', '</details>'] : []),
  ].join('\n'));
}

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
