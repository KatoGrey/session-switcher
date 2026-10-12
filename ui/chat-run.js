'use strict';
/* Run the project, from the chat: its dev server or start script (lib/runner.js on the PC), with
   its output, the address it serves on, Open, Stop and Restart, and "Show Claude the output" when
   something goes wrong. At the top of the chat's side panel; the ⋯ menu or Ctrl+K starts it. */

const Run = { cwd: null, st: null, timer: 0, open: false };

function runBox() {
  let box = $c('cRun');
  if (!box) { $c('cPreview').insertAdjacentHTML('beforebegin', '<div class="lg-run" id="cRun" hidden></div>'); box = $c('cRun'); box.addEventListener('click', e => { const b = e.target.closest('[data-run]'); if (b) wrap(runAction)(b.dataset.run); }); }
  return box;
}
const runCwd = () => (C.info && C.info.cwd) || null;
// Another chat: the panel goes (it was about the other chat's project); the run itself carries on.
function resetRun() {
  clearTimeout(Run.timer);
  Object.assign(Run, { cwd: null, st: null, open: false });
  const box = $c('cRun'); if (box) { box.hidden = true; box.innerHTML = ''; box._h = ''; }
}
async function openRun(start = true) {
  const cwd = runCwd(); if (!cwd) { toast('Open a chat in a project first.'); return; }
  Run.cwd = cwd; Run.open = true;
  $c('chat').classList.add('show-ledger');
  runBox().hidden = false;
  Run.st = await api(`/api/run?cwd=${encodeURIComponent(cwd)}`);
  if (start && !Run.st.running) {
    if (!Run.st.cmd) { await setRunCommand(); if (!Run.st.cmd) { renderRun(); return; } }   // no command yet: the panel says so
    Run.st = await api('/api/run', { cwd, action: 'start' });
  }
  renderRun();
}
async function setRunCommand() {
  const cmd = await ask('How to run this project', 'The command that starts it, run in the project’s folder (like npm run dev). Leave it empty to go back to what the project says.', (Run.st && Run.st.custom ? Run.st.cmd : '') || '', 'Save', { maxLength: 400, allowEmpty: true });
  if (cmd === null || cmd === undefined) return;
  Run.st = await api('/api/run', { cwd: Run.cwd, command: cmd });
  renderRun();
}
async function runAction(what) {
  if (!Run.cwd) return;
  if (what === 'open' && runUrl()) { const u = runUrl(); if (window.Android && window.Android.openExternal) window.Android.openExternal(u); else window.open(u, '_blank', 'noopener'); return; }
  if (what === 'close') { Run.open = false; runBox().hidden = true; return; }
  if (what === 'cmd') return setRunCommand();
  if (what === 'tell') {
    const lines = (Run.st.lines || []).slice(-60).join('\n').trim();
    if (!lines) return;
    placeText(`Here’s what \`${Run.st.cmd}\` printed${Run.st.running ? '' : ` (it stopped${Run.st.exit !== null ? ` with code ${Run.st.exit}` : ''})`}:\n\n\`\`\`\n${lines}\n\`\`\`\n\n`, false);
    return;
  }
  Run.st = await api('/api/run', { cwd: Run.cwd, action: what });
  renderRun();
}
// Where to open it: on the PC its local address; on the phone the network address it printed (a
// server that only listens on the PC can't be reached from the phone).
const runUrl = () => (!Run.st ? null : window.REMOTE ? Run.st.lanUrl : Run.st.url);
function renderRun() {
  const box = $c('cRun'); if (!box || !Run.open || !Run.st) return;
  const st = Run.st;
  const state = st.running ? (st.url ? 'Running' : 'Starting…') : st.exit === null || st.exit === undefined ? 'Not running' : `Stopped${st.exit ? ` (code ${st.exit})` : ''}`;
  const log = (st.lines || []).slice(-150).join('\n');
  const h = `<div class="rn-h"><span class="rn-dot ${st.running ? 'on' : st.exit ? 'err' : ''}" aria-hidden="true"></span><b>${esc(state)}</b><code title="${esc(st.cmd || '')}">${esc(st.cmd || 'No command yet')}</code><button type="button" class="icon rn-x" data-run="close" aria-label="Hide">✕</button></div>
    ${window.REMOTE && st.running && st.url && !st.lanUrl ? `<p class="rn-note">It’s running on the PC at ${esc(st.url.replace(/^https?:\/\//, ''))}, which only the PC can open. To see it on this phone, have it listen on your network too (for Vite: <code>--host</code>), then restart it.</p>` : ''}
    <p class="rn-b">${runUrl() ? `<button type="button" class="btn gilt sm" data-run="open" title="${esc(runUrl())}">Open ${esc(runUrl().replace(/^https?:\/\//, ''))}</button>` : ''}${st.running ? '<button type="button" class="btn quiet sm" data-run="restart">Restart</button><button type="button" class="btn quiet sm" data-run="stop">Stop</button>' : `<button type="button" class="btn sm" data-run="start" ${st.cmd ? '' : 'disabled'}>Run</button>`}<button type="button" class="btn quiet sm" data-run="cmd">Command…</button>${log && !C.watch ? `<button type="button" class="btn quiet sm" data-run="tell" title="Puts the latest output in your message">Show ${PROV_NAME[C.provider]} the output</button>` : ''}</p>
    ${log ? `<pre class="rn-log" tabindex="0">${esc(log)}</pre>` : ''}`;
  if (box._h === h) return;
  const pre = box.querySelector('.rn-log'), atEnd = !pre || pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8;
  box.innerHTML = h; box._h = h;
  const p2 = box.querySelector('.rn-log'); if (p2 && atEnd) p2.scrollTop = p2.scrollHeight;
}
// The PC says the run's output changed: fetched again (only while it's on screen).
function runChanged(cwd) {
  if (!Run.open || !Run.cwd || String(cwd).toLowerCase() !== Run.cwd.toLowerCase()) return;
  clearTimeout(Run.timer);
  Run.timer = setTimeout(async () => { try { Run.st = await api(`/api/run?cwd=${encodeURIComponent(Run.cwd)}`); renderRun(); } catch { /* next time */ } }, 250);
}
