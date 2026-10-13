'use strict';
/* The installed desktop app (desktop/): what this page tells it and asks of it, when it's there
   (window.desktop, from desktop/shell/preload.js). It says what's waiting (the tray, the taskbar
   count, keeping the PC awake while chats work), opens what a notification or the tray points at,
   does what a taskbar shortcut asks, and shows its updates and settings in Setup → App. */

const Desk = { last: '', badges: {}, update: null, told: null, opts: null };
const deskOn = () => !!window.desktop;

// The count on the taskbar button: a small round badge, drawn here (the app has no way to draw).
function deskBadge(n) {
  if (!n) return null;
  if (Desk.badges[n]) return Desk.badges[n];
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#c0392b'; g.beginPath(); g.arc(16, 16, 15, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff'; g.font = `bold ${n > 9 ? 17 : 20}px Segoe UI, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(n > 99 ? '99' : String(n), 16, 17);
  return (Desk.badges[n] = c.toDataURL('image/png'));
}
// What's waiting, sent when it changes.
function deskStatus() {
  if (!deskOn() || !S.activity) return;
  const A = awaiting(), W = atWork();
  const list = A.slice(0, 8).map(x => ({ k: keyOf(x), t: x.title || 'Untitled chat' }));
  const sig = JSON.stringify([A.length, W.length, list]);
  if (sig === Desk.last) return;
  Desk.last = sig;
  try { window.desktop.status({ needs: A.length, working: W.length, list, badge: deskBadge(A.length) }); } catch { /* the app is closing */ }
}

if (deskOn()) {
  // The tray (or a notification) points at a chat.
  window.desktop.onOpen(k => { const x = findActivity(k); if (x) openActivity(x); });
  // A taskbar shortcut or the tray's own items. Taken once the projects have loaded (a shortcut that
  // started the app waits for that), so the palette has them.
  const deskDo = what => {
    if (what === 'search') return openPalette('');
    if (what === 'new-chat') return openPalette('claude chat in ');
    if (what === 'task') return openTaskDialog(S.view === 'folder' ? S.folder : null);
    return undefined;
  };
  const t0 = Date.now();
  const deskReady = () => { if ((S.projects && S.projects.length) || Date.now() - t0 > 15000) window.desktop.onDo(deskDo); else setTimeout(deskReady, 300); };
  deskReady();
  // Updates: a card on the hub once one's ready (or out, on a Mac), and in Setup.
  window.desktop.onUpdate(st => { Desk.update = st; renderDeskBox(); renderDeskUpdateCard(); });
  window.desktop.update().then(st => { if (st) { Desk.update = st; renderDeskUpdateCard(); } }).catch(() => {});
  setInterval(deskStatus, 5000);
}

/* ---------- the update card on the hub ---------- */
function renderDeskUpdateCard() {
  let box = $('deskUpdate');
  const u = Desk.update;
  const show = deskOn() && u && (u.status === 'ready' || u.status === 'available') && store('desk-update-seen') !== u.next && S.view === 'hub' && $('welcomeSlot');
  if (!show) { if (box) box.remove(); return; }
  if (!box) { $('welcomeSlot').insertAdjacentHTML('afterend', '<section class="whats-new" id="deskUpdate" aria-label="Update"></section>'); box = $('deskUpdate'); }
  const ready = u.status === 'ready', mac = window.desktop.platform === 'darwin';
  const h = `<div class="wn-h"><p class="eyebrow">Update</p><b>Session Switcher ${esc(u.next)} is ${ready ? 'ready' : 'out'}.</b><button type="button" class="icon wn-x" data-desk="later" aria-label="Later">✕</button></div>
    <p class="wn-sub">${ready ? 'Restart to use it. Open chats come back where they were. (Or it updates the next time you quit.)' : mac ? 'Download it, open it, and drag Session Switcher into Applications. Your accounts and settings stay.' : 'Download and run the installer. Your accounts and settings stay.'}</p>
    <p class="wn-b"><button type="button" class="btn quiet sm" data-desk="later">Later</button><button type="button" class="btn sm" data-desk="install">${ready ? 'Restart to update' : 'Download it'}</button></p>`;
  if (box._h !== h) { box.innerHTML = h; box._h = h; }
}

/* ---------- Setup → Desktop app ---------- */
async function loadDeskBox() {
  if (!deskOn() || !$('deskBox')) return;
  try { [Desk.opts, Desk.update] = await Promise.all([window.desktop.settings(), window.desktop.update()]); } catch { return; }
  renderDeskBox();
}
function deskUpdateLine() {
  const u = Desk.update;
  if (!u) return '';
  const when = u.checkedAt ? `, checked ${agoL(u.checkedAt)}` : '';
  const line = u.status === 'checking' ? 'Checking for updates…'
    : u.status === 'downloading' ? `Downloading ${esc(u.next || 'the update')}… ${u.percent || 0}%`
    : u.status === 'ready' ? `<b>${esc(u.next)}</b> is ready.`
    : u.status === 'available' ? `<b>${esc(u.next)}</b> is out.`
    : u.status === 'current' ? `Up to date${when}.`
    : u.status === 'error' ? `Couldn’t check: ${esc(u.error || 'no answer')}${when}.`
    : u.auto ? 'Updates itself: it checks every few hours.' : 'Checks for new versions every few hours.';
  const btn = u.status === 'ready' ? '<button class="btn prime sm" data-desk="install">Restart to update</button>'
    : u.status === 'available' ? '<button class="btn prime sm" data-desk="install">Download it</button>'
    : `<button class="btn sm" data-desk="check" ${u.status === 'checking' || u.status === 'downloading' ? 'disabled' : ''}>Check for updates</button>`;
  return `<div class="desk-up"><p>${line}</p>${btn}</div>`;
}
function renderDeskBox() {
  const box = $('deskBox'); if (!box || !Desk.opts) return;
  const o = Desk.opts, mac = window.desktop.platform === 'darwin';
  const key = String(o.hotkey || '').replace('CommandOrControl', mac ? '⌘' : 'Ctrl').replace(/\+/g, ' + ');
  box.innerHTML = `<p class="desk-v">Session Switcher <b>${esc(o.version)}</b>, the installed app.</p>
    ${deskUpdateLine()}
    <label class="toggle"><input type="checkbox" data-deskset="openAtLogin" ${o.openAtLogin ? 'checked' : ''}><span><b>${mac ? 'Open at login' : 'Start with Windows'}</b><span>Starts in the ${mac ? 'menu bar' : 'tray'}, quietly, so notifications come and queued tasks run.</span></span></label>
    <label class="toggle"><input type="checkbox" data-deskset="keepAwake" ${o.keepAwake ? 'checked' : ''}><span><b>Keep the ${mac ? 'Mac' : 'PC'} awake while chats work</b><span>A long reply isn’t cut off by sleep. The screen can still turn off; once nothing is working, sleep is up to ${mac ? 'macOS' : 'Windows'} again.</span></span></label>
    <label class="toggle"><input type="checkbox" data-deskset="hotkeyOn" ${o.hotkeyOn ? 'checked' : ''}><span><b>Bring it up from anywhere: ${esc(key)}</b><span>Shows Session Switcher over whatever you’re doing; again puts it away.</span></span></label>
    <p class="pb-act"><button class="btn quiet sm" data-desk="files">Show its files</button></p>
    <p class="pb-none">Closing the window keeps it running in the ${mac ? 'menu bar' : 'tray'}, so chats keep going. Quit is in the ${mac ? 'menu bar' : 'tray'} menu, and below.</p>`;
}
document.addEventListener('click', wrap(async e => {
  const b = e.target.closest('[data-desk]'); if (!b || !deskOn()) return;
  const what = b.dataset.desk;
  if (what === 'check') { b.disabled = true; Desk.update = await window.desktop.checkUpdates(); renderDeskBox(); return; }
  if (what === 'install') { await window.desktop.installUpdate(); return; }
  if (what === 'later') { if (Desk.update) store('desk-update-seen', Desk.update.next); renderDeskUpdateCard(); return; }
  if (what === 'files') await window.desktop.set({ openData: true });
}));
document.addEventListener('change', wrap(async e => {
  const b = e.target.closest('[data-deskset]'); if (!b || !deskOn()) return;
  const r = await window.desktop.set({ [b.dataset.deskset]: b.checked });
  if (r) Desk.opts = { ...Desk.opts, ...r };
  if (b.dataset.deskset === 'hotkeyOn' && b.checked && r && r.hotkeyOk === false) toast('Another program already uses that key, so it can’t be used here.', 5000);
  else toast('Saved.', 1500);
  renderDeskBox();
}));
