/* ---------- your home PC, from a laptop (lib/homepc.js, lib/mirror.js) ---------- */
// Setup → Your home PC. Both halves are off until you turn them on:
//  - on the computer you leave at home, "This is my home PC" lets a paired laptop copy your work from it;
//  - on the laptop, pairing with the PC shows the PC in this window, copies your projects, chats and
//    settings here for when the PC is off, and sends back what you did here.
// And the line at the top of the window while you're on this laptop because the PC stopped answering.
const HomePc = { st: null, timer: null, found: null, finding: false, busy: false, bannerTimer: null, hidden: false, open: false };
const hpBytes = n => (n >= 1e9 ? `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round((n || 0) / 1e3))} KB`);
const hpNum = n => Number(n || 0).toLocaleString();
const hpFiles = (n, w = 'file') => `${hpNum(n)} ${Number(n) === 1 ? w : `${w}s`}`;

function homeSetupHtml() {
  if (window.REMOTE) return '';
  return '<p class="d-h" id="st-home">Your home PC</p><div class="prefs" id="homeBox"><p class="loading">Checking…</p></div>';
}
async function loadHomeBox() {
  if (window.REMOTE || !$('homeBox')) return;
  try { HomePc.st = await api('/api/homepc'); renderHomeBox(); } catch (err) { $('homeBox').innerHTML = `<p class="loading">${esc(err.message)}</p>`; }
}
function homeJobLine(j) {
  if (!j) return '';
  const what = j.dir === 'up' ? 'Sending to your PC' : 'Copying from your PC';
  if (j.state === 'running') {
    return `<p class="hp-job"><b>${what}…</b> ${esc(j.root || '')} · ${hpFiles(j.done)}${j.doneBytes ? `, ${hpBytes(j.doneBytes)}` : ''} so far · ${hpNum(j.listed)} looked at<br><small>${esc(String(j.current || '').slice(-90))}</small></p>
      <p class="pb-act"><button class="btn quiet sm" data-hp="stop">Stop</button></p>`;
  }
  // Things to know before a first copy; "Copy anyway" goes on.
  if (j.state === 'blocked' && j.warn) {
    const w = j.warn;
    return `${w.homes ? `<p class="gm-st bad"><b>Your user folder has a different name on the two computers</b> (${esc(w.homes.pc)} on the PC, ${esc(w.homes.here)} here). Your projects are copied to the same place under your folder here, but chats made on the PC are kept under the PC’s folder names, so they won’t open on this laptop. Everything works when both computers use the same user name.</p>` : ''}
      ${w.oneDrive ? `<p class="gm-st bad"><b>OneDrive on this laptop would upload your projects to the cloud as they arrive</b> (${esc(w.oneDrive.join(', '))}). Pause OneDrive, or turn off its Desktop backup, then copy again.</p>` : ''}
      <p class="pb-act"><button class="btn sm" data-hp="down" data-force="1" data-all="1">Copy anyway</button></p>`;
  }
  // It never got going (copying is off on the PC, say): the PC's own words.
  if (j.state === 'failed' && !j.done && j.errorCount === 1 && !j.errors[0].p) return `<p class="gm-st bad"><b>${j.dir === 'up' ? 'Couldn’t send' : 'Couldn’t copy'}.</b> ${esc(j.errors[0].error)}</p>`;
  const done = j.state === 'done' ? `${j.dir === 'up' ? 'Sent' : 'Copied'} ${hpFiles(j.done)}${j.doneBytes ? ` (${hpBytes(j.doneBytes)})` : ''}` : j.state === 'stopped' ? `Stopped after ${hpFiles(j.done)}` : 'Couldn’t finish';
  const notes = [
    j.same ? `${hpNum(j.same)} ${j.same === 1 ? 'was' : 'were'} already the same` : '',
    j.conflicts ? `${hpNum(j.conflicts)} changed in both places, so both versions were kept` : '',
    j.keptHere ? `${hpNum(j.keptHere)} you changed here stay as they are (send them with “Send my work”)` : '',
    j.bigLater ? `${hpFiles(j.bigLater, 'big file')} that changed (${hpBytes(j.bigLaterBytes)}) wait for a full copy at home` : '',
  ].filter(Boolean);
  return `<p class="hp-job ${j.state === 'done' && !j.errorCount ? 'ok' : ''}"><b>${done}.</b> ${esc(notes.join('; '))}${notes.length ? '.' : ''}</p>
    ${j.errorCount ? `<details class="hp-errs"><summary>${hpNum(j.errorCount)} couldn’t be copied</summary><ul>${j.errors.map(e => `<li><code>${esc(e.p || 'the copy')}</code> ${esc(e.error)}</li>`).join('')}</ul></details>` : ''}
    ${j.dir === 'down' && j.needsRestart && j.state !== 'running' ? '<p class="gm-st"><b>Restart Session Switcher to finish:</b> its own settings from the PC go in place when it starts. <button class="btn prime sm" data-fix="restart">Restart</button></p>' : ''}`;
}
// On the computer you leave at home. Off until you turn it on, and only changed at the computer itself.
const homeShareToggle = st => `<label class="toggle"><input type="checkbox" data-hp="share" ${st.share ? 'checked' : ''}><span><b>This is my home PC</b><span>Lets a laptop of yours copy your work from this computer, and send back what it changed: your projects, and your Claude, Codex and Gemini chats and settings. Never your sign-ins, and nothing is ever deleted. Any device paired through Phone access can do this while it’s on.${st.share && !st.phoneOn ? ' <b>Phone access is off</b>, so no laptop can reach this computer yet: turn it on below.' : ''}</span></span></label>`;
function renderHomeBox() {
  const box = $('homeBox'), st = HomePc.st;
  if (!box || !st) return;
  clearTimeout(HomePc.timer);
  if (!st.paired) {
    const found = HomePc.found;
    box.innerHTML = `<p class="ph-note">Use your home PC’s Session Switcher from your laptop, wherever you are, and keep a copy of your work on the laptop for when the PC is off. Over your Wi-Fi at home, and Tailscale when you’re away. Nothing here is on until you turn it on.</p>
      ${homeShareToggle(st)}
      <details class="hp-connect" ${HomePc.open ? 'open' : ''}><summary>This is my laptop: connect it to my home PC</summary>
      <p class="rd-hint">First, on the PC: turn on Phone access in its Setup. The PC can be a Windows PC or a Mac. Copying your work here needs both computers to be the same kind; using the PC in this window works either way.</p>
      <p class="pb-act"><button class="btn prime sm" data-hp="find" ${HomePc.finding ? 'disabled' : ''}>${HomePc.finding ? 'Looking…' : 'Find my PC'}</button></p>
      ${found ? (found.found.length ? `<p class="hp-found">${found.found.map(f => `<button class="btn sm" data-hp="pick" data-addr="${esc(f.address)}:${f.port}">${esc(f.name)} <small>${esc(f.address)}</small></button>`).join(' ')}</p>` : `<p class="gm-st bad">${found.tailscale ? 'No PC with Session Switcher answered on Tailscale. Is it on, with phone access turned on in its Setup?' : 'Tailscale isn’t installed on this laptop, or isn’t signed in. Install it and sign in with the same account as your PC, or type the PC’s address below.'}</p>`) : ''}
      <div class="field"><label for="hpAddr">Your PC’s address</label><input id="hpAddr" placeholder="100.101.102.103" spellcheck="false" autocomplete="off"></div>
      <div class="field"><label for="hpCode">Pairing code</label><div class="row2"><input id="hpCode" maxlength="9" placeholder="On the PC: Setup → Phone access → Show a pairing code" spellcheck="false" autocomplete="off" style="text-transform:uppercase"><button class="btn prime" data-hp="pair">Pair</button></div></div>
      </details>`;
    return;
  }
  const j = st.job, running = j && j.state === 'running';
  const pcName = st.pcName || st.address;
  const health = st.up === true ? '<span class="hp-dot ok"></span>answering' : st.up === false ? '<span class="hp-dot bad"></span>not answering' : 'checking…';
  const showing = st.showing && st.showing.on === 'pc';
  // A Windows PC and a Mac: the window works, the folders can't be copied as they are.
  const otherKind = !!(st.pcPlatform && st.platform && st.pcPlatform !== st.platform);
  box.innerHTML = `
    ${st.tailscale || /^(127\.|localhost)/.test(st.address || '') ? '' : '<p class="gm-st bad"><b>This address only works on your home Wi-Fi.</b> To reach the PC from anywhere, install Tailscale on this laptop (signed in as on the PC), then <b>Forget this PC</b> and pair again with <b>Find my PC</b>.</p>'}
    <p class="gm-st ok">✓ Paired with <b>${esc(pcName)}</b> <small>${esc(st.address)}:${st.port}</small> · ${health}${st.stillPaired === false && st.up ? ' · <b>it doesn’t know this laptop any more: pair again</b>' : ''}</p>
    ${window.desktop ? `<label class="toggle"><input type="checkbox" data-hp="use" ${st.use === 'pc' ? 'checked' : ''}><span><b>Open my home PC in this window</b><span>Your chats, projects and accounts as they are on the PC, run there with its storage. If the PC stops answering, this window switches to this laptop’s own copy by itself.</span></span></label>
      <p class="pb-act">${showing ? '<button class="btn sm" data-hp="show-laptop">Use this laptop now</button>' : `<button class="btn sm" data-hp="show-pc" ${st.up === false ? 'disabled' : ''}>Use my home PC now</button>`}</p>`
      : `<p class="pb-act"><a class="btn sm" href="${esc(st.relay)}" target="_blank" rel="noopener">Open my home PC</a></p>`}
    <p class="hp-h">A copy on this laptop</p>
    ${otherKind ? '<p class="rd-hint">Your home PC and this computer aren’t the same kind (one is Windows, the other a Mac), so its folders can’t be copied here as they are. Using the PC in this window works all the same.</p>' : `
    <p class="rd-hint">Your projects, your Claude, Codex and Gemini chats and settings, and Session Switcher’s own, at the same folders as on the PC. On the PC, <b>This is my home PC</b> must be on in its Setup. Sign-ins stay on each computer: sign in here once. Copying again only brings what changed.</p>
    ${homeJobLine(j)}
    ${running ? '' : `<p class="pb-act">
      <button class="btn ${st.lastDown ? '' : 'prime'} sm" data-hp="down" ${st.lastDown ? '' : 'data-all="1"'}>${st.lastDown ? 'Bring what’s changed' : 'Copy everything from my PC'}</button>
      ${st.lastDown ? '<button class="btn quiet sm" data-hp="down" data-all="1" title="Big files that changed too (Codex’s history is tens of GB): best at home">Full copy</button>' : ''}
      ${st.lastDown ? '<button class="btn sm" data-hp="up" title="New and changed projects and chats from this laptop go to the PC. Nothing is deleted there, and a file the PC changed too keeps both versions.">Send my work to the PC</button>' : ''}</p>`}
    <p class="rd-hint">${st.lastDown ? `Last copied ${esc(agoL(st.lastDown.at))}${st.lastDown.files ? `: ${hpFiles(st.lastDown.files)}` : ''}.` : 'Nothing copied yet. The first copy is big: best over your home Wi-Fi.'}${st.lastUp ? ` Last sent ${esc(agoL(st.lastUp.at))}.` : ''}${Object.keys(st.drives || {}).length ? ` Your PC’s ${Object.keys(st.drives).map(d => `${d}:`).join(' and ')} ${Object.keys(st.drives).length > 1 ? 'are' : 'is'} kept in a folder here under the same letter.` : ''}</p>`}
    <p class="pb-act"><button class="btn quiet sm" data-hp="forget">Forget this PC</button></p>
    ${st.share ? homeShareToggle(st) : ''}`;
  if (running && $('setup').open) HomePc.timer = setTimeout(() => loadHomeBox(), 1500);
}
// The laptop's half stays folded away until it's wanted, and stays open while you're in it.
document.addEventListener('toggle', e => { if (e.target.matches && e.target.matches('#homeBox .hp-connect')) HomePc.open = e.target.open; }, true);
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-hp]');
  if (!b || !$('homeBox') || !$('homeBox').contains(b) || b.tagName === 'INPUT') return;
  const what = b.dataset.hp;
  try {
    if (what === 'find') {
      HomePc.finding = true; renderHomeBox();
      try { HomePc.found = await api('/api/homepc/find', {}); } finally { HomePc.finding = false; }
      if (HomePc.found.found.length === 1) { renderHomeBox(); $('hpAddr').value = `${HomePc.found.found[0].address}:${HomePc.found.found[0].port}`; $('hpCode').focus(); return; }
    } else if (what === 'pick') { $('hpAddr').value = b.dataset.addr; $('hpCode').focus(); return; }
    else if (what === 'pair') {
      const address = $('hpAddr').value.trim(), code = $('hpCode').value.trim();
      if (!address) { toast('Type your PC’s address, or use Find my PC.'); return; }
      if (!code) { toast('On the PC, open Setup → Phone access → Show a pairing code, and type it here.'); return; }
      b.disabled = true;
      HomePc.st = await api('/api/homepc/pair', { address, code });
      toast('Paired. Next: copy your work here, so this laptop can carry on when the PC is off.', 8000);
      homeBanner();   // a paired laptop keeps an eye on its PC from now on
    } else if (what === 'down' || what === 'up') {
      HomePc.st = await api('/api/homepc/copy', { dir: what, all: b.dataset.all === '1', force: b.dataset.force === '1' });
    } else if (what === 'stop') HomePc.st = await api('/api/homepc/stop', {});
    else if (what === 'forget') {
      if (!confirm('Forget your home PC on this laptop? The copies here stay. To use the PC again, pair again.')) return;
      HomePc.st = await api('/api/homepc/forget', {});
    } else if (what === 'show-pc' || what === 'show-laptop') { if (window.desktop) await window.desktop.set({ home: what === 'show-pc' ? 'pc' : 'laptop' }); return; }
    renderHomeBox();
  } catch (err) { toast(err.message, 8000); loadHomeBox(); }
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (!t.matches) return;
  if (t.matches('#homeBox [data-hp="share"]')) {
    try {
      if (t.checked && !(await appConfirm('Let a laptop of yours copy your work from this computer?\n\nAny device you’ve paired through Phone access can then copy your projects and your Claude, Codex and Gemini chats and settings from here, and put changed files back. Your sign-ins are never copied. Turn it on only on the computer you leave at home; you can turn it off again here at any time.', { ok: 'Turn it on' }))) { t.checked = false; return; }
      HomePc.st = await api('/api/homepc/share', { on: t.checked });
      renderHomeBox();
    } catch (err) { toast(err.message); loadHomeBox(); }
    return;
  }
  if (!t.matches('#homeBox [data-hp="use"]')) return;
  try {
    HomePc.st = await api('/api/homepc/use', { use: t.checked ? 'pc' : 'laptop' });
    if (window.desktop) await window.desktop.set({ home: t.checked ? 'pc' : 'laptop' });
  } catch (err) { toast(err.message); }
});

// The line at the top while this laptop stands in for a PC that stopped answering. Only a laptop paired
// with a PC keeps checking: anyone else is asked once, and again if that changes (the server says so).
async function homeBanner() {
  clearTimeout(HomePc.bannerTimer);
  if (window.REMOTE || SOLO) return;
  let st = null, failed = false;
  try { st = await api('/api/homepc'); } catch { failed = true; /* offline: try later */ }
  if (failed || (st && st.paired)) HomePc.bannerTimer = setTimeout(homeBanner, failed ? 120000 : 20000);
  let el = $('homeBanner');
  const down = st && st.paired && st.showing && st.showing.on === 'laptop' && st.showing.reason === 'pc-down';
  if (!down || HomePc.hidden) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'homeBanner'; el.className = 'hp-banner'; el.setAttribute('role', 'status'); document.body.prepend(el); }
  const copied = st.lastDown ? ` (copied ${esc(agoL(st.lastDown.at))})` : '';
  el.innerHTML = st.up
    ? `<span><b>Your home PC is back.</b> Send what you did here to it, then carry on there.</span><button class="btn prime sm" data-hb="send">Send my work and switch</button><button class="btn sm" data-hb="switch">Just switch</button><button class="btn quiet sm" data-hb="hide" aria-label="Hide">✕</button>`
    : `<span><b>Your home PC isn’t answering</b>, so you’re on this laptop’s own copy${copied}. Your chats on the PC are safe there.</span><button class="btn quiet sm" data-hb="hide" aria-label="Hide">✕</button>`;
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-hb]');
  if (!b) return;
  if (b.dataset.hb === 'hide') { HomePc.hidden = true; $('homeBanner')?.remove(); return; }
  try {
    if (b.dataset.hb === 'send') {
      b.disabled = true; b.textContent = 'Sending…';
      await api('/api/homepc/copy', { dir: 'up' });
      for (let i = 0; i < 7200; i++) {
        const st = await api('/api/homepc');
        if (!st.job || st.job.state !== 'running') {
          if (st.job && st.job.state !== 'done') { toast('Sending stopped partway. Open Setup → Your home PC to see why.', 9000); return; }
          break;
        }
        b.textContent = `Sending… ${hpFiles(st.job.done)}`;
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    if (window.desktop) await window.desktop.set({ home: 'pc' });
  } catch (err) { toast(err.message, 8000); }
});
if (!window.REMOTE) setTimeout(homeBanner, 4000);
