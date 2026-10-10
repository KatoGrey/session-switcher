'use strict';
/* Setup: health checks, phone access, Appearance, this PC’s settings, alerts and the live pill. */

/* ---------- setup ---------- */
async function loadHealth(showIn) {
  const j = await api('/api/health');
  const worst = j.checks.some(c => c.state === 'error') ? 'error' : j.checks.some(c => c.state === 'warn') ? 'warn' : 'ok';
  $('hdot').className = `hdot ${worst}`;
  $('setupBtn').title = worst === 'ok' ? 'Setup: everything looks good' : 'Setup: something needs attention';
  if (showIn) renderSetup(j);
  return j;
}
function renderSetup(j) {
  const p = j.prefs;
  const t = (k, label, text, local) => `<label class="toggle"><input type="checkbox" ${local ? `data-local="${k}"` : `data-pref="${k}"`} ${(local ? Local[k] : p[k]) ? 'checked' : ''}><span><b>${label}</b><span>${text}</span></span></label>`;
  $('setupBody').innerHTML = `
    <nav class="setup-toc" aria-label="Sections"><a href="#st-health">Health</a><a href="#st-alerts">Alerts</a><a href="#st-prefs">Preferences</a><a href="#st-codex">Codex</a><a href="#st-phone">Phone</a><a href="#st-app">App</a></nav>
    <ul class="checks" id="st-health">${j.checks.map(c => `<li class="check ${c.state}"><span class="st" aria-label="${c.state}"></span><span><b>${esc(c.label)}</b><span class="dt">${esc(c.detail)}</span></span>
      ${c.fix ? `<button class="btn sm" data-fix="${esc(c.fix.action)}" data-account="${esc(c.fix.account || '')}">${esc(c.fix.label)}</button>` : '<span></span>'}</li>`).join('')}</ul>
    <p class="d-h" id="st-alerts">Alerts and looks</p>
    <div class="prefs">
      ${t('sound', 'Chime when a chat needs you or replies', 'A soft bell. It doesn’t play for the chat you’re looking at.', true)}
      ${t('notify', 'Desktop notifications', `Shows a ${S.platform === 'darwin' ? 'macOS' : 'Windows'} notification when a chat needs you or replies while this window is in the background.`, true)}
      ${t('petals', esc(voice('Drifting petals')), `${esc(voice('A few slow petals behind the hub.'))} ${esc(voice('Turned off automatically if Windows is set to reduce motion.'))}`, true)}
      ${t('motion', 'Animations', 'World banners that open into their pages, cards that rise in, dials that draw themselves. Turned off automatically if Windows is set to reduce motion.', true)}
    </div>
    <p class="d-h" id="st-prefs">Preferences</p>
    <div class="prefs">
      <div class="field"><label for="prefOpenIn">When you click Open on a chat</label>
        <select id="prefOpenIn" data-pref="openIn">
          <option value="app" ${p.openIn !== 'terminal' ? 'selected' : ''}>Open it in Session Switcher’s chat window</option>
          <option value="terminal" ${p.openIn === 'terminal' ? 'selected' : ''}>Resume it in a terminal</option>
        </select></div>
      <div class="field"><label for="prefTerminal">Terminal chats open in</label>
        <select id="prefTerminal" data-pref="terminal">
          ${(S.platform === 'darwin' ? [['auto', 'Terminal'], ['iterm', 'iTerm']] : [['auto', 'Windows Terminal tab when available, otherwise a console window'], ['wt-tab', 'Windows Terminal, new tab'], ['wt-window', 'Windows Terminal, new window'], ['console', 'Classic console window']]).map(([v, l]) => `<option value="${v}" ${p.terminal === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></div>
      ${t('syncSettings', 'Keep extra accounts’ settings in step', 'Copies your main settings.json, CLAUDE.md and keybindings to extra accounts whenever the main copy is newer.')}
      ${t('syncState', 'Carry over MCP servers and folder trust', 'Before a chat opens with an extra account, adds any MCP servers, approved tools and trusted folders from your main account that it doesn’t have yet.')}
      ${t('cleanEnv', 'Use only account sign-ins', 'Ignores ANTHROPIC_API_KEY and similar settings on this PC, so the account you pick is always the one used.')}
      ${t('appWindow', 'Open as its own window', `Uses ${S.platform === 'darwin' ? 'Chrome (or Edge or Brave)' : 'Chrome or Edge'} to show Session Switcher without browser tabs or an address bar.`)}
      <div class="field"><label for="prefClaude">Claude Code command</label>
        <div class="row2"><input id="prefClaude" value="${esc(j.claudeCommand)}" spellcheck="false"><button class="btn" id="saveClaude">Save</button></div>
        <small>Leave as “claude” unless Setup can’t find Claude Code; then paste the full path to ${S.platform === 'darwin' ? 'claude (try <code>which claude</code> in Terminal)' : 'claude.exe'}.</small></div>
    </div>
    <p class="d-h" id="st-codex">Codex</p>
    <div class="prefs">
      <label class="toggle"><input type="checkbox" data-codex="enabled" ${j.codex && j.codex.enabled ? 'checked' : ''}><span><b>Use Codex too</b><span>Shows your Codex (OpenAI) chats next to Claude’s, with its own sign-in and usage.</span></span></label>
      <div class="field"><label for="prefCodex">Codex command</label>
        <div class="row2"><input id="prefCodex" value="${esc(j.codex ? j.codex.command : 'codex')}" spellcheck="false"><button class="btn" id="saveCodex">Save</button></div>
        <small>Leave as “codex” unless Setup can’t find it; then paste the full path to codex.cmd.</small></div>
      <div class="field"><label>Rules and tools</label><div class="row2"><span class="rd-hint">Write rules once for both (CLAUDE.md and AGENTS.md), and give each one the other’s MCP tools.</span><button class="btn" data-fix="rules">Rules and tools…</button></div></div>
    </div>
    ${window.REMOTE ? `<p class="d-h" id="st-phone">This phone</p><div class="prefs"><p class="ph-note">You’re using Session Switcher on your PC from this phone.</p>
      ${window.Android ? '<button class="btn" data-fix="phone-disconnect">Disconnect this phone</button>' : ''}</div>` : `<p class="d-h" id="st-phone">Phone access</p><div class="prefs" id="phoneBox"><p class="loading">Checking…</p></div>`}
    <p class="d-h" id="st-app">App</p>
    <div class="app-actions">
      <button class="btn" data-fix="shortcut">${S.platform === 'darwin' ? 'Add to Applications' : 'Create desktop shortcut'}</button>
      <button class="btn" data-fix="share-copy" title="A zip of the app for someone else, without your accounts, chats or settings">Make a copy to share</button>
      <button class="btn" data-fix="update-claude">Update Claude Code</button>
      <button class="btn" data-fix="tour">Show the tour</button>
      <button class="btn" data-fix="restart">Restart</button><button class="btn danger" data-fix="quit">Quit Session Switcher</button>
    </div>
    <p class="ver">Session Switcher ${esc(j.appVersion)}. Your chats are read from your own .claude folder and never leave this PC.</p>`;
}
/* ---------- phone access: use this PC's Session Switcher from the Android app ---------- */
let phoneTimer = null;
async function loadPhone() {
  if (window.REMOTE || !$('phoneBox')) return;
  try { renderPhone(await api('/api/phone')); } catch (err) { $('phoneBox').innerHTML = `<p class="loading">${esc(err.message)}</p>`; }
}
function renderPhone(st) {
  const box = $('phoneBox'); if (!box) return;
  clearInterval(phoneTimer);
  const host = a => `${a.address}:${st.port}`;
  const lan = st.addresses.filter(a => !a.tailscale), ts = st.addresses.filter(a => a.tailscale);
  const left = st.pairing ? Math.max(0, Math.round((st.pairing.expiresAt - Date.now()) / 1000)) : 0;
  box.innerHTML = `
    <label class="toggle"><input type="checkbox" data-phone="enabled" ${st.enabled ? 'checked' : ''}><span><b>Let my phone use Session Switcher</b><span>Your phone (iPhone or Android) can see your chats, answer Claude and Codex, approve steps and switch models, over your Wi-Fi. Only phones you pair can connect. ${st.error ? `<b class="warn">${esc(st.error)}</b>` : ''}</span></span></label>
    ${st.enabled ? `
    <div class="ph-grid">
      <div class="ph-step"><span class="ph-n">1</span><div><b>Get the app</b><p><b>iPhone:</b> in Safari, open <code>http://${esc(lan[0] ? host(lan[0]) : `this-pc:${st.port}`)}/</code>, tap Share → <b>Add to Home Screen</b>, then open it from the Home Screen.<br><b>Android:</b> ${st.apk ? `open <code>http://${esc(lan[0] ? host(lan[0]) : `this-pc:${st.port}`)}/get</code> and install it.` : 'build it first with <code>mobile/android/build.cmd</code>.'}</p></div></div>
      <div class="ph-step"><span class="ph-n">2</span><div><b>This computer’s address</b><p>${lan.map(a => `<code class="ph-addr">${esc(host(a))}</code>`).join(' ') || '<i>No network found.</i>'}${ts.length ? `<br><small>Away from home with Tailscale: ${ts.map(a => `<code class="ph-addr">${esc(host(a))}</code>`).join(' ')}</small>` : ''}</p></div></div>
      <div class="ph-step"><span class="ph-n">3</span><div><b>Pair it</b>${st.pairing ? `<p class="ph-code" aria-label="Pairing code">${esc(st.pairing.code.slice(0, 4))}<span>·</span>${esc(st.pairing.code.slice(4))}</p><p><small id="phLeft">Works once, for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}.</small> <button class="btn quiet sm" data-phone="cancel">Cancel</button></p>` : '<p><button class="btn prime sm" data-phone="pair">Show a pairing code</button></p>'}</div></div>
    </div>
    ${st.devices.length ? `<p class="ph-h">Paired phones</p><ul class="ph-dev">${st.devices.map(d => `<li><span class="glyph" aria-hidden="true">◈</span><span><b>${esc(d.name)}</b><small>paired ${esc(agoL(d.created))}${d.lastSeen ? ` · last used ${esc(agoL(d.lastSeen))}` : ''}</small></span><button class="btn quiet sm" data-phone="forget" data-id="${esc(d.id)}">Remove</button></li>`).join('')}</ul>` : ''}
    <p class="ph-warn">A paired phone can do anything you can do here, including letting Claude run commands on this PC. Pair only your own phones, and remove one you lose. ${S.platform === 'darwin' ? 'macOS may ask to let Node accept incoming connections; allow it.' : 'Windows may ask to let Node.js through the firewall; allow it on private networks.'}</p>` : ''}`;
  if (st.pairing) phoneTimer = setInterval(() => {
    const l = Math.max(0, Math.round((st.pairing.expiresAt - Date.now()) / 1000));
    const el = $('phLeft'); if (!el || !$('setup').open) { clearInterval(phoneTimer); return; }
    if (!l) { clearInterval(phoneTimer); loadPhone(); return; }
    el.textContent = `Works once, for ${Math.floor(l / 60)}:${String(l % 60).padStart(2, '0')}.`;
    if (l % 5 === 0) api('/api/phone').then(n => { if (!n.pairing && $('setup').open) renderPhone(n); }).catch(() => {});
  }, 1000);
}
async function openSetup(tab = 'health') {
  setupTab(tab);
  if (!$('setup').open) $('setup').showModal();
  if (tab === 'look') return renderLook();
  $('setupBody').innerHTML = '<p class="loading">Checking Claude Code, your accounts and shared data…</p>';
  try { await loadHealth(true); loadPhone(); } catch (err) { $('setupBody').innerHTML = `<p class="loading">${esc(err.message)}</p>`; }
  return undefined;
}
function setupTab(tab) {
  S.setupTab = tab;
  for (const b of document.querySelectorAll('[data-stab]')) b.setAttribute('aria-selected', String(b.dataset.stab === tab));
  $('setup').classList.toggle('look-tab', tab === 'look');
}
document.querySelector('.stabs').addEventListener('click', e => { const b = e.target.closest('[data-stab]'); if (b && b.dataset.stab !== S.setupTab) openSetup(b.dataset.stab); });

/* ---------- Appearance: themes, light/dark, text and interface size, font ---------- */
function renderLook() {
  const o = Look.get(), light = Look.isLight();
  const seg = (k, opts) => `<div class="lk-seg" role="radiogroup">${opts.map(([v, l, sub]) => `<button type="button" role="radio" aria-checked="${String(o[k]) === String(v)}" data-look="${k}" data-v="${v}">${l}${sub ? `<small>${sub}</small>` : ''}</button>`).join('')}</div>`;
  const card = t => {
    const c = Look.swatch(t.id, light);
    return `<button type="button" class="lk-theme${t.family ? ` lk-${t.family}` : ''}" role="radio" aria-checked="${o.theme === t.id}" data-look="theme" data-v="${t.id}" style="--sw-bg:${c.bg};--sw-card:${c.card};--sw-line:${c.line};--sw-ink:${c.ink};--sw-ash:${c.ash};--sw-acc:${c.accent};--sw-emb:${c.ember};--sw-gold:${c.gold};--sw-cx:${c.codex}${t.fonts ? `;--sw-font:${esc(t.fonts.display)}` : ''}">
      <span class="sw" aria-hidden="true"${t.sky ? ` data-sky="${t.sky}"` : ''}><span class="sw-bar"><i></i><i></i><i></i></span><span class="sw-card"><b></b><em></em><em class="s"></em><span class="sw-btn"></span><span class="sw-dot"></span></span></span>
      <span class="lk-tn"><b>${esc(t.name)}</b><small>${esc(t.note)}</small></span></button>`;
  };
  $('setupBody').innerHTML = `
    <p class="d-h">Light or dark</p>
    ${seg('mode', [['dark', '☾ Dark'], ['light', '☀ Light'], ['system', '◐ Match device']])}
    <p class="d-h">Theme</p>
    <div class="lk-themes" role="radiogroup" aria-label="Theme">${Look.THEMES.filter(t => !t.family).map(card).join('')}</div>
    <p class="d-h">Space saga</p>
    <p class="lk-saga-note">Command your chats like a fleet. These bring their own lettering, a sky behind the hub, short sound cues and a few words of their own.</p>
    <div class="lk-themes" role="radiogroup" aria-label="Space saga themes">${Look.THEMES.filter(t => t.family === 'saga').map(card).join('')}</div>
    <p class="d-h">Glam</p>
    <p class="lk-saga-note">Sunshine, sparkles and a little pink. Brings its own lettering, sparkles behind the hub, sweet chimes and a few words of its own.</p>
    <div class="lk-themes" role="radiogroup" aria-label="Glam themes">${Look.THEMES.filter(t => t.family === 'glam').map(card).join('')}</div>
    <p class="d-h">Anime</p>
    <p class="lk-saga-note">Step into another world. Made for dark mode: each brings a painted scene in the hub that lights up with your chats, its own lettering, a living sky behind the hub, chimes and a few words of its own.</p>
    <div class="lk-themes" role="radiogroup" aria-label="Anime themes">${Look.THEMES.filter(t => t.family === 'anime').map(card).join('')}</div>
    <p class="d-h">Text</p>
    <div class="lk-row"><label for="lkText"><b>Text size</b><small>Messages, documents and the message box</small></label>
      <div class="lk-range"><span class="a-sm" aria-hidden="true">A</span><input type="range" id="lkText" min="80" max="150" step="5" value="${o.text}" data-look="text"><span class="a-lg" aria-hidden="true">A</span><output id="lkTextV">${o.text}%</output></div></div>
    <div class="lk-row"><span><b>Reading font</b><small>Classic is the bookish serif; Modern and Clean are easier on small screens</small></span>
      ${seg('font', [['classic', '<span class="fs-classic">Aa</span> Classic'], ['modern', '<span class="fs-modern">Aa</span> Modern'], ['clean', '<span class="fs-modern">Aa</span> Clean', 'sans headings too']])}</div>
    <label class="toggle"><input type="checkbox" data-look="bold" ${o.bold ? 'checked' : ''}><span><b>Bold text</b><span>Heavier letters everywhere, easier to read at a glance.</span></span></label>
    <label class="toggle"><input type="checkbox" data-look="contrast" ${o.contrast ? 'checked' : ''}><span><b>Higher contrast</b><span>Brighter text and stronger accents.</span></span></label>
    <p class="d-h">Interface</p>
    <div class="lk-row"><label for="lkUi"><b>Interface size</b><small>Scales everything: bars, buttons, cards and text</small></label>
      <div class="lk-range"><span class="a-sm" aria-hidden="true">▢</span><input type="range" id="lkUi" min="80" max="130" step="5" value="${o.ui}" data-look="ui"><span class="a-lg" aria-hidden="true">▢</span><output id="lkUiV">${o.ui}%</output></div></div>
    <div class="lk-preview" aria-hidden="true">
      <div class="turn" data-prov="claude"><div class="who"><span class="who-n">Claude</span><span class="who-m">Preview</span></div><div class="part"><div class="final"><div class="md"><p>This is how replies read. <strong>Bold words</strong>, <code>code</code> and <a href="#">links</a> follow your theme.</p></div></div></div></div>
      <div class="umsg"><div class="ububble"><div class="utext">And this is how your messages look.</div></div></div>
    </div>
    <div class="app-actions"><button class="btn" data-look-reset>Back to the original look</button></div>
    <p class="ver">Appearance is saved on this device, so your phone and your PC can each look their own way.</p>`;
}
$('setupBody').addEventListener('input', e => {
  const r = e.target.closest('input[type="range"][data-look]'); if (!r) return;
  Look.set({ [r.dataset.look]: Number(r.value) });
  const out = $(r.id === 'lkText' ? 'lkTextV' : 'lkUiV'); if (out) out.textContent = `${r.value}%`;
});
$('setupBody').addEventListener('click', e => {
  const b = e.target.closest('button[data-look]');
  if (b) {
    const engage = b.dataset.look === 'theme' && b.dataset.v !== Look.get().theme;
    const change = () => { Look.set({ [b.dataset.look]: b.dataset.v }); renderLook(); };
    // A new theme, or light and dark, fades in over the old look instead of snapping.
    if ((b.dataset.look === 'theme' || b.dataset.look === 'mode') && b.dataset.v !== String(Look.get()[b.dataset.look]) && document.startViewTransition && motionOk()) {
      const root = document.documentElement;
      root.classList.add('look-fade');
      const t = document.startViewTransition(change);
      t.finished.catch(() => {}).finally(() => root.classList.remove('look-fade'));
    } else change();
    if (engage && Local.sound) chime('engage');
    return;
  }
  if (e.target.closest('[data-look-reset]')) { Look.reset(); renderLook(); toast('Back to the original look.', 2000); }
});
$('setupBody').addEventListener('change', e => {
  const c = e.target.closest('input[type="checkbox"][data-look]');
  if (c) { Look.set({ [c.dataset.look]: c.checked }); e.stopImmediatePropagation(); }
}, true);
$('setupClose').addEventListener('click', () => $('setup').close());
$('setupBody').addEventListener('click', e => {
  const a = e.target.closest('.setup-toc a'); if (!a) return;
  e.preventDefault(); document.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}, true);
$('setupBody').addEventListener('change', wrap(async e => {
  // The command boxes save when you leave them, like the switches do.
  if (e.target.id === 'prefClaude') { await api('/api/prefs', { claudeCommand: e.target.value }); toast('Saved. Checking again…', 2000); return loadHealth(true); }
  if (e.target.id === 'prefCodex') { await api('/api/codex/settings', { command: e.target.value }); toast('Saved. Checking again…', 2000); return loadHealth(true); }
  const ph = e.target.closest('[data-phone="enabled"]');
  if (ph) { renderPhone(await api('/api/phone', { enabled: ph.checked })); toast(ph.checked ? 'Phone access is on.' : 'Phone access is off. Paired phones can’t connect until you turn it on again.', 3500); return; }
  const loc = e.target.closest('[data-local]');
  if (loc) return setLocal(loc.dataset.local, loc.checked);
  const cxp = e.target.closest('[data-codex]');
  if (cxp) { await api('/api/codex/settings', { enabled: cxp.checked }); toast(cxp.checked ? 'Codex is on.' : 'Codex is off.', 2000); await reload(); return loadHealth(true); }
  const el = e.target.closest('[data-pref]'); if (!el) return;
  const k = el.dataset.pref;
  const r = await api('/api/prefs', { [k]: el.type === 'checkbox' ? el.checked : el.value });
  S.prefs = r.prefs; toast('Saved.', 1500); renderPage();
}));
$('setupBody').addEventListener('click', wrap(async e => {
  const ph = e.target.closest('button[data-phone]');
  if (ph) {
    const act = ph.dataset.phone;
    if (act === 'pair') { const r = await api('/api/phone/pair', {}); return renderPhone(r.status); }
    if (act === 'cancel') return renderPhone(await api('/api/phone/pair-cancel', {}));
    if (act === 'forget') { if (!(await appConfirm('Remove this phone?\n\nIt won’t be able to connect until you pair it again.', { ok: 'Remove', danger: true }))) return undefined; return renderPhone(await api('/api/phone/forget', { id: ph.dataset.id })); }
  }
  if (e.target.closest('[data-fix="phone-disconnect"]')) { if (await appConfirm('Disconnect this phone from your PC?\n\nYou can pair it again any time.', { ok: 'Disconnect', danger: true })) window.Android.disconnect(); return undefined; }
  if (e.target.id === 'saveCodex') { await api('/api/codex/settings', { command: $('prefCodex').value }); toast('Saved. Checking again…'); return loadHealth(true); }
  if (e.target.id === 'saveClaude') { await api('/api/prefs', { claudeCommand: $('prefClaude').value }); toast('Saved. Checking again…'); return loadHealth(true); }
  const b = e.target.closest('[data-fix]'); if (!b) return;
  const what = b.dataset.fix, account = b.dataset.account;
  if (what === 'signin') { $('setup').close(); S.acct = account; store('acct', account); renderAll(); return accountAction(current().expectEmail ? 'signin-direct' : 'signin', account); }
  if (what === 'set-claude-path') { $('prefClaude').focus(); return; }
  if (what === 'rules') { $('setup').close(); return openRules(null); }
  if (what === 'tour') { $('setup').close(); return startTour(); }
  if (what === 'install-codex') return codexInstall();
  if (what === 'codex-signin') { $('setup').close(); return codexSignIn(); }
  if (what === 'fix-sharing') {
    const r = await api('/api/fix-sharing', { account });
    toast(r.errors.length ? `Some folders couldn’t be fixed: ${r.errors.join('; ')}` : `Done. Shared ${r.linked.length ? r.linked.join(', ') : 'everything'}${r.moved ? `, moved ${r.moved} item${r.moved === 1 ? '' : 's'} into your main folder` : ''}${r.conflicts ? `; ${r.conflicts} duplicate${r.conflicts === 1 ? ' was' : 's were'} kept aside, not deleted` : ''}.`, 9000);
    await reload(); return loadHealth(true);
  }
  if (what === 'update-claude') { const r = await api('/api/update-claude', {}); return r.dryRun ? reportLaunch(r) : toast(`Updating Claude Code in a ${r.how}. Close it when it finishes, then reopen Setup.`, 8000); }
  if (what === 'share-copy') return shareCopy();
  if (what === 'shortcut') { const r = await api('/api/shortcut', {}); return toast(r.dryRun ? 'Would create a desktop shortcut.' : S.platform === 'darwin' ? 'Added “Session Switcher” to Applications in your home folder. Find it with Spotlight or Launchpad.' : 'Added “Claude Session Switcher” to your desktop.'); }
  if (what === 'restart') { $('setup').close(); return restartApp(); }
  if (what === 'quit') return quitApp();
}));

/* ---------- this PC's own settings: alerts and petals ---------- */
const Local = {
  sound: store('sound') !== 'off',
  notify: store('notify') === 'on' && 'Notification' in window && Notification.permission === 'granted',
  petals: store('petals') !== 'off',
  motion: store('motion') !== 'off',
};
async function setLocal(k, on) {
  if (k === 'notify' && on) {
    if (!('Notification' in window)) { toast('This browser can’t show desktop notifications.'); on = false; }
    else if (Notification.permission !== 'granted') {
      const r = await Notification.requestPermission().catch(() => 'denied');
      if (r !== 'granted') { toast('Notifications are blocked for this window. Allow them in the browser’s site settings to turn this on.', 8000); on = false; }
    }
  }
  Local[k] = on; store(k, on ? 'on' : 'off');
  if (k === 'petals') petals();
  if (k === 'motion') applyMotion();
  if (k === 'sound' && on) chime('reply');
  renderLivePill();
  const box = document.querySelector(`[data-local="${k}"]`); if (box) box.checked = on;
}
function applyMotion() { document.body.classList.toggle('motion', motionOk()); }
matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => { applyMotion(); petals(); });
// Behind the hub: drifting petals, or a theme's own sky (still stars, sparkles, motes, fireflies, embers).
// A sky only moves when motion is on, so it still shows (holding still) when the device asks for less.
function petals() {
  const box = $('petals'), sky = Look.theme().sky || '';
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const on = Local.petals && (!still || !!sky);
  document.body.classList.toggle('no-petals', !on);
  if (!on) { box.innerHTML = ''; delete box.dataset.kind; return; }
  if (box.children.length && box.dataset.kind === (sky || 'petals')) return;
  box.dataset.kind = sky || 'petals';
  if (sky) { box.innerHTML = skyHtml(sky); return; }
  let h = '';
  for (let i = 0; i < 9; i++) {
    const r = n => ((hash(`petal${i}${n}`) % 1000) / 1000);
    h += `<i class="petal" style="--x0:${Math.round(r('x') * 95)}vw;--s:${8 + Math.round(r('s') * 8)}px;--o:${(0.06 + r('o') * 0.12).toFixed(2)};--d:${32 + Math.round(r('d') * 30)}s;--delay:-${Math.round(r('t') * 60)}s"></i>`;
  }
  box.innerHTML = h;
}
// The same scatter every time for a given seed (so the sky doesn't jump between visits).
function seeded(seed) {
  let a = hash(seed);
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// A tile of stars as one background (no element per star), repeated across a layer.
function starTile(seed, size, n, big) {
  const r = seeded(`stars${seed}`), dots = [];
  for (let i = 0; i < n; i++) {
    const x = Math.round(r() * size), y = Math.round(r() * size), tint = r(), d = 0.5 + r() * big * 0.6;
    const col = tint > 0.9 ? 'var(--gilt)' : tint > 0.8 ? 'var(--ember-soft)' : 'var(--parch)';
    dots.push(`radial-gradient(circle at ${x}px ${y}px, ${col} 0 ${d.toFixed(2)}px, transparent ${(d + 0.9).toFixed(2)}px)`);
  }
  return `--tile:${size}px;background-image:${dots.join(',')};background-size:${size}px ${size}px`;
}
function skyHtml(kind) {
  // The anime skies drift: mana motes and embers rise (each layer is one tile taller than the page and
  // slides up by exactly a tile, so it loops without a seam); fireflies wander and blink.
  const layer = (cls, id, size, n, tints, r, dur) => `<svg class="sky-layer ${cls}" style="--tile:${size}px;--dur:${dur}s" width="100%" aria-hidden="true"><defs>${glowTile(id, size, n, tints, r)}</defs><rect width="100%" height="100%" fill="url(#${id})"/></svg>`;
  if (kind === 'motes') return `<div class="sky-glow motes">${layer('rise a', 'ieSkyA', 560, 18, ['c', 'c', 'c', 'p', 'g'], [0.8, 1.8], 70)}${layer('rise b', 'ieSkyB', 760, 12, ['c', 'p', 'v'], [1.2, 2.4], 110)}</div>`;
  if (kind === 'fireflies') return `<div class="sky-glow fireflies">${layer('drift a', 'hfSkyA', 520, 14, ['f', 'f', 'g'], [0.9, 1.7], 0)}${layer('drift b', 'hfSkyB', 700, 10, ['f', 'g'], [1.2, 2.2], 0)}</div>`;
  if (kind === 'embers') return `<div class="sky-glow embers">${layer('rise a', 'dgSkyA', 480, 16, ['e', 'e', 'o', 'g'], [0.7, 1.5], 42)}${layer('rise b', 'dgSkyB', 640, 10, ['e', 'o'], [1, 1.9], 64)}</div>`;
  if (kind === 'sparkles') return `<svg class="sky-sparkles" width="100%" height="100%" aria-hidden="true"><defs>${sparkleTile('mbSkyA', 520, 16)}${sparkleTile('mbSkyB', 700, 11)}</defs><rect class="a" width="100%" height="100%" fill="url(#mbSkyA)"/><rect class="b" width="100%" height="100%" fill="url(#mbSkyB)"/></svg>`;
  return `<div class="sky-stars" style="${starTile('a', 487, 18, 1)}"></div><div class="sky-stars far" style="${starTile('b', 613, 10, 1.4)}"></div>`;
}
// A tile of glowing specks (a soft halo and a bright core each), tinted by class.
function glowTile(id, size, n, tints, [r0, r1]) {
  const r = seeded(id);
  let dots = '';
  for (let i = 0; i < n; i++) {
    const x = (r() * size).toFixed(1), y = (r() * size).toFixed(1), cls = tints[Math.floor(r() * tints.length)], d = r0 + r() * (r1 - r0);
    dots += `<circle class="${cls} h" cx="${x}" cy="${y}" r="${(d * 3.2).toFixed(2)}"/><circle class="${cls}" cx="${x}" cy="${y}" r="${d.toFixed(2)}"/>`;
  }
  return `<pattern id="${id}" width="${size}" height="${size}" patternUnits="userSpaceOnUse">${dots}</pattern>`;
}
// Malibu's sky: four-point sparkles and the odd heart, in pink, sunshine and pool blue, as one tile.
function sparkleTile(id, size, n) {
  const r = seeded(id);
  let shapes = '';
  for (let i = 0; i < n; i++) {
    const x = (r() * size).toFixed(1), y = (r() * size).toFixed(1), tint = r(), d = 3 + r() * 5;
    const cls = tint > 0.72 ? 'sun' : tint > 0.3 ? 'pink' : 'pool';
    if (r() > 0.82) shapes += `<path class="${cls}" transform="translate(${x} ${y}) scale(${(d / 16).toFixed(3)})" d="M0 9C-5-.5-10-1-10-5.8-10-9 -7.6-11-5-11c2 0 3.6 1 5 3 1.4-2 3-3 5-3 2.6 0 5 2 5 5.2C10-1 5-.5 0 9z"/>`;
    else shapes += `<path class="${cls}" d="M${x} ${(y - d).toFixed(1)}q${(d * 0.18).toFixed(2)} ${(d * 0.82).toFixed(2)} ${d.toFixed(2)} ${d.toFixed(2)}q${(-d * 0.82).toFixed(2)} ${(d * 0.18).toFixed(2)} ${(-d).toFixed(2)} ${d.toFixed(2)}q${(-d * 0.18).toFixed(2)} ${(-d * 0.82).toFixed(2)} ${(-d).toFixed(2)} ${(-d).toFixed(2)}q${(d * 0.82).toFixed(2)} ${(-d * 0.18).toFixed(2)} ${d.toFixed(2)} ${(-d).toFixed(2)}z"/>`;
  }
  return `<pattern id="${id}" width="${size}" height="${size}" patternUnits="userSpaceOnUse">${shapes}</pattern>`;
}
// Text written into the page itself (index.html) that a saga theme rewords.
function sayStatic() {
  for (const el of document.querySelectorAll('.wordmark small, .seek .s-t')) {
    if (el.dataset.say === undefined) el.dataset.say = el.textContent;
    el.textContent = voice(el.dataset.say);
  }
}
let lookTheme = Look.get().theme, lookMode = document.documentElement.dataset.mode;
document.addEventListener('lookchange', () => {
  const th = Look.get().theme, mode = document.documentElement.dataset.mode;
  // Light and dark can each have their own painting in the hub's scene.
  if (th === lookTheme) {
    if (mode !== lookMode) { lookMode = mode; if (Look.theme().paint && S.view === 'hub' && $('heroSlot')) renderLive(true); }
    return;
  }
  lookTheme = th; lookMode = mode;
  sayStatic(); petals(); renderLivePill(); renderAll();
});

/* ---------- alerts: chime, notification, title ---------- */
let actx = null;
document.addEventListener('pointerdown', () => { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch { /* no audio */ } }, { once: true });
// A saga theme plays its own short clips (sounds/, Kenney CC0) instead of the bell.
const Clips = new Map();
function clip(url) {
  let p = Clips.get(url);
  if (!p) { p = fetch(url).then(r => r.arrayBuffer()).then(b => actx.decodeAudioData(b)); Clips.set(url, p); p.catch(() => Clips.delete(url)); }
  p.then(buf => {
    const src = actx.createBufferSource(), g = actx.createGain();
    src.buffer = buf; src.playbackRate.value = 0.97 + Math.random() * 0.06; g.gain.value = 0.32;
    src.connect(g); g.connect(actx.destination); src.start();
  }).catch(() => { /* no audio */ });
}
function chime(kind) {
  if (!actx) return;
  const fx = Look.theme().sfx, tones = Look.theme().tones;
  if (fx) { if (fx[kind]) { if (actx.state === 'suspended') actx.resume(); clip(fx[kind]); } return; }
  // A theme can bring its own notes (Malibu's twinkles); otherwise the bell.
  if (tones && !tones[kind]) return;
  if (kind === 'engage' && !tones) return;
  try {
    if (actx.state === 'suspended') actx.resume();
    const t0 = actx.currentTime + 0.02;
    const notes = tones ? tones[kind] : kind === 'needs' ? [[1318.5, 0, 0.06], [987.8, 0.17, 0.05]] : [[880, 0, 0.035], [1174.7, 0.11, 0.025]];
    for (const [f, dt, vol] of notes) {
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(vol, t0 + dt + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 1.5);
      g.connect(actx.destination);
      for (const [mult, amp] of [[1, 1], [2.76, 0.28], [5.4, 0.08]]) {
        const o = actx.createOscillator(), og = actx.createGain();
        o.type = 'sine'; o.frequency.value = f * mult; og.gain.value = amp;
        o.connect(og); og.connect(g); o.start(t0 + dt); o.stop(t0 + dt + 1.6);
      }
    }
  } catch { /* no audio */ }
}
const Alerts = { seen: new Map(), primed: false };
function watchActivity() {
  const next = new Map();
  for (const x of S.activity) {
    const k = keyOf(x), st = statusOf(x), was = Alerts.seen.get(k);
    const pend = (x.pending || []).map(p => p.requestId).join(',');
    next.set(k, { st, pend, fin: x.finishedAt });
    // Looking at it right now counts as reading it.
    const viewing = window.ChatUI && ChatUI.isViewing && ChatUI.isViewing(x) && document.hasFocus() && !document.hidden;
    if (viewing && st === 'reply') { markSeen(x); continue; }
    if (!Alerts.primed || viewing) continue;
    if (NEEDS.has(st) && (!was || !NEEDS.has(was.st) || (pend && pend !== was.pend))) notify('needs', x);
    else if (st === 'reply' && (!was || was.fin !== x.finishedAt) && (!was || was.st !== 'reply' || was.fin !== x.finishedAt)) { if (was) notify('reply', x); }
  }
  Alerts.seen = next; Alerts.primed = true;
}
function notify(kind, x) {
  if (Local.sound) chime(kind);
  if (Local.notify && 'Notification' in window && Notification.permission === 'granted' && (document.hidden || !document.hasFocus())) {
    try {
      const p = (x.pending || [])[0];
      const body = kind === 'needs' ? (p ? `${wantsTo(p)}${p.detail || p.summary ? `: ${p.detail || p.summary}` : ''}` : 'Waiting for you.') : (plainMd(lastLine(x.lastText)).slice(0, 160) || 'Finished its turn.');
      const n = new Notification(kind === 'needs' ? `${x.title || 'A chat'} needs you` : `${x.title || 'A chat'} replied`, { body, tag: keyOf(x), silent: true });
      n.onclick = () => { window.focus(); openActivity(findActivity(keyOf(x)) || x); n.close(); };
    } catch { /* notifications unavailable */ }
  }
}

/* ---------- the live pill ---------- */
function renderLivePill() {
  const p = $('livepill');
  p.classList.toggle('off', !S.connected);
  $('lpText').textContent = S.connected ? voice('Live') : 'Reconnecting';
  const b = $('lpBell');
  b.textContent = Local.sound || Local.notify ? 'Alerts on' : 'Alerts off';
  b.className = `lp-bell ${Local.sound || Local.notify ? 'on' : ''}`;
}
$('livepill').addEventListener('click', e => showMenu(e.currentTarget, [
  { label: Local.sound ? 'Turn the chime off' : 'Turn the chime on', hint: 'when a chat needs you or replies', run: () => setLocal('sound', !Local.sound) },
  { label: Local.notify ? 'Turn desktop notifications off' : 'Turn desktop notifications on', hint: 'while this window is in the background', run: () => setLocal('notify', !Local.notify) },
  { label: voice(Local.petals ? 'Hide the drifting petals' : 'Show the drifting petals'), run: () => setLocal('petals', !Local.petals) },
]));
