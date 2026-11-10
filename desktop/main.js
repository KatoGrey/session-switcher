'use strict';
// Session Switcher as a desktop app: its own window and tray icon, the app's server running inside
// it, your data in the app's data folder, and updates from GitHub Releases.
const { app, BrowserWindow, Tray, Menu, shell, dialog, nativeImage, Notification, ipcMain } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createServer, URL_BASE, PORT, post } = require('./shell/server');
const { createHome } = require('./shell/home');
const { offerImport, notes, setNotes } = require('./shell/data');
const { createUpdates } = require('./shell/updates');
const { contextMenu, keys, createDesk } = require('./shell/desk');
const { createAideWindow } = require('./shell/aide');

const APP_ID = 'com.katogrey.sessionswitcher';
const IS_MAC = process.platform === 'darwin';
// The app's files: packed beside it when installed, the repository's when run from source.
const APP_FILES = app.isPackaged ? path.join(process.resourcesPath, 'app-files') : path.join(__dirname, '..');
const DATA_DIR = process.env.SWITCHER_DATA_DIR || app.getPath('userData');
// A copy with a data folder of its own (a test, say) is a separate app: its own browser profile and
// its own "one copy at a time", so it never reaches into the copy you're using.
if (process.env.SWITCHER_DATA_DIR) app.setPath('userData', path.resolve(DATA_DIR));
const LOG = path.join(DATA_DIR, 'desktop.log');
// Your home PC, when this is a laptop paired with it: the window reaches it through this relay (lib/homepc.js).
const HOME_PORT = Number(process.env.SWITCHER_HOME_PORT) || PORT + 13;
// Set up as a home PC (Setup → Your home PC → This is my home PC): it may be on by itself with nobody
// there to answer a box, so trouble with its server is logged and told as a notification, and it keeps
// trying. Any other computer gets the box, as it always has.
const unattended = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'accounts.json'), 'utf8')).prefs.homePcShare === true; } catch { return false; } };

function log(msg) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch { /* read-only */ }
}

// One copy: opening it again brings the window up.
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId(APP_ID);

// A Mac app opened from Finder doesn't get your terminal's PATH, so claude, codex and node wouldn't be
// found. Ask your login shell for it once.
function shellPath() {
  if (!IS_MAC) return {};
  try {
    const sh = process.env.SHELL || '/bin/zsh';
    const out = execFileSync(sh, ['-ilc', 'printf "__SSP__%s__SSP__" "$PATH"'], { encoding: 'utf8', timeout: 8000 });
    const m = out.match(/__SSP__(.*)__SSP__/s);
    if (m && m[1]) return { PATH: [...new Set([...m[1].split(':'), ...String(process.env.PATH || '').split(':'), '/opt/homebrew/bin', '/usr/local/bin'])].filter(Boolean).join(':') };
  } catch (err) { log(`Couldn’t read the shell’s PATH: ${err.message}`); }
  return { PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin` };
}

let win = null, tray = null, quitting = false, updates = null, started = false, showLater = false, mini = null;
const desk = createDesk({
  show, tray: () => tray, window: () => win, log,
  send: (ch, v) => { if (win && !win.isDestroyed()) win.webContents.send(ch, v); },
  settings: () => notes(DATA_DIR).desk, saveSettings: v => setNotes(DATA_DIR, { desk: v }),
  onAide: look => { if (aide) aide.toggle(look).catch(err => log(`Companion: ${err.message}`)); },
});
let aide = null;
// What the page asks of the app (shell/preload.js). Only the app's own page is listened to.
// Your home PC's page, shown here through the relay, counts as the app's own (it's your own PC's app).
// (Only while this computer is paired with a PC: otherwise nothing of ours is at that address.)
const fromUs = e => { try { const o = new URL(e.senderFrame.url).origin; return o === URL_BASE.slice(0, -1) || (o === `http://127.0.0.1:${HOME_PORT}` && home.paired()); } catch { return false; } };
ipcMain.on('desktop:show', e => { if (fromUs(e)) show(); });
ipcMain.on('desktop:status', (e, st) => { if (fromUs(e) && st && typeof st === 'object') desk.status(st); });
ipcMain.on('desktop:ready', e => {
  if (!fromUs(e) || !win || e.sender !== win.webContents) return;
  pageReady = true;
  if (pending) { const p = pending; pending = null; win.webContents.send('desktop:do', p); }
});
ipcMain.handle('desktop:update-state', e => (fromUs(e) && updates ? { ...updates.state } : null));
ipcMain.handle('desktop:check-updates', async e => { if (fromUs(e) && updates) await updates.check(true, { silent: true }); return updates ? { ...updates.state } : null; });
ipcMain.handle('desktop:install-update', e => (fromUs(e) && updates ? updates.install() : null));
// Read with the same arguments it's set with: on Windows, anything else says it's off.
const loginItem = () => app.getLoginItemSettings(IS_MAC ? {} : { args: ['--hidden'] });
ipcMain.handle('desktop:settings', e => (fromUs(e) ? { ...desk.opt(), ...desk.keys(), openAtLogin: loginItem().openAtLogin, dataDir: DATA_DIR, version: app.getVersion(), home: home ? home.state() : null } : null));
// Companion's panel asks: only from its own window.
ipcMain.handle('aide:ask', (e, what, v) => {
  if (!fromUs(e) || !aide || e.sender !== aide.sender()) return null;
  const f = aide.handlers[what];
  return typeof f === 'function' ? f(v) : null;
});
ipcMain.handle('desktop:set', (e, patch) => {
  if (!fromUs(e) || !patch || typeof patch !== 'object') return null;
  if (typeof patch.openAtLogin === 'boolean') app.setLoginItemSettings({ openAtLogin: patch.openAtLogin, ...(IS_MAC ? {} : { args: ['--hidden'] }) });
  if (patch.openData) { shell.openPath(DATA_DIR); return null; }
  // Your home PC or this laptop, in the window.
  if (patch.home === 'pc' || patch.home === 'laptop') return home ? home.switchTo(patch.home) : null;
  const r = desk.set(patch);
  // Turned on: its panel is loaded and waiting, so the key is instant. Off: gone, and nothing's kept running.
  if (typeof patch.aideOn === 'boolean') syncAide();
  // A different channel: look again now (a test version may be waiting, or no longer apply).
  if (patch.channel && updates) { updates.setChannel(); updates.check(false, { silent: true }); }
  return { ...r, openAtLogin: loginItem().openAtLogin };
});
function syncAide() {
  if (!aide) return;
  if (desk.opt().aideOn) { aide.prepare(); aide.create(); } else aide.stop();
}
const server = createServer({
  appFiles: APP_FILES, dataDir: DATA_DIR, env: { ...shellPath(), SWITCHER_HOME_PORT: String(HOME_PORT) }, log,
  onQuit: () => { quitting = true; app.quit(); },   // Quit in the app quits the app
  // A home PC says so and keeps trying (true: try again); anywhere else, a box, and the app closes.
  onTrouble: err => {
    if (unattended()) {
      log(`The server stopped three times in a minute; trying again in 30 s. ${err}`);
      notify('Session Switcher is having trouble', `Its server stopped three times in a minute. It keeps trying; the details are in ${path.join(DATA_DIR, 'switcher.log')}.`);
      return true;
    }
    dialog.showErrorBox('Session Switcher stopped', `Its server stopped three times in a minute.\n\n${err}\n\nThe details are in ${path.join(DATA_DIR, 'switcher.log')}.`);
    quitting = true; app.quit();
    return false;
  },
});
function notify(title, body) {
  try { const n = new Notification({ title, body }); n.on('click', show); n.show(); } catch (err) { log(`Couldn’t notify: ${err.message}`); }
}
const home = createHome({
  dataDir: DATA_DIR, relayPort: HOME_PORT, localUrl: URL_BASE, window: () => win, log, notify, post,
  onState: () => { if (tray) desk.status(desk.state); if (win && !win.isDestroyed()) win.setTitle(win.webContents.getTitle() ? titled(win.webContents.getTitle()) : 'Session Switcher'); },
});
const titled = t => (home && home.state().on === 'pc' ? `${t} · your home PC` : t);

// Where the window was, kept between runs.
const bounds = () => notes(DATA_DIR).window || { width: 1320, height: 920 };
function saveBounds() {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  setNotes(DATA_DIR, { window: { ...win.getNormalBounds(), maximized: win.isMaximized() || !!win._maxOnShow } });
}

// Any of the app's windows: links that go elsewhere open in your browser, never inside the app.
// popout: a popped-out chat, which may itself pop out nothing but the browser.
function guard(wc, popout = false) {
  if (popout) wc.setWindowOpenHandler(({ url }) => { if (/^(https?|mailto):/i.test(url) && !ours(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => { if (!ours(url) && !url.startsWith('data:')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
}
const ours = u => u.startsWith(URL_BASE) || u.startsWith(`http://localhost:${PORT}/`) || (u.startsWith(`http://127.0.0.1:${HOME_PORT}/`) && home.paired());
const iconFile = () => path.join(APP_FILES, IS_MAC ? 'macos/icon.icns' : 'icon.ico');
const LOADING = `data:text/html;charset=utf-8,${encodeURIComponent('<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0a090c;color:#cfc6b6;font:16px Georgia,serif"><div style="text-align:center"><div style="letter-spacing:.3em;font-size:13px;color:#a5463f">SESSION SWITCHER</div><p>Starting…</p></div></body></html>')}`;

// hidden: started with the PC. The page still loads, out of sight: it's what notifies you and counts
// what's working (the tray, keeping the PC awake).
function createWindow(hidden = false) {
  const b = bounds();
  win = new BrowserWindow({
    width: b.width, height: b.height, x: b.x, y: b.y, minWidth: 420, minHeight: 500,
    title: 'Session Switcher', backgroundColor: '#0a090c', icon: iconFile(), show: false, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true, preload: path.join(__dirname, 'shell', 'preload.js'), backgroundThrottling: false },
  });
  contextMenu(win.webContents);
  keys(win.webContents);
  if (b.maximized && !hidden) win.maximize(); else if (b.maximized) win._maxOnShow = true;   // maximizing a window shows it
  win.once('ready-to-show', () => { if (!hidden) win.show(); });
  win.loadURL(LOADING);
  for (const e of ['resize', 'move']) win.on(e, () => { clearTimeout(win._save); win._save = setTimeout(saveBounds, 500); });
  // Closing the window keeps it running in the tray, so chats keep going and notifications come.
  win.on('close', e => {
    if (quitting) return;
    e.preventDefault();
    saveBounds();
    win.hide();
    if (!notes(DATA_DIR).trayTold && !IS_MAC) {
      setNotes(DATA_DIR, { trayTold: true });
      new Notification({ title: 'Session Switcher is still running', body: 'Your chats keep going. Open it from the tray icon; Quit is there too.' }).show();
    }
  });
  // A chat popped out opens in a window of its own; links elsewhere open in your browser.
  guard(win.webContents);
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    // The mini window: a small card that stays on top of other apps (the page fills it in).
    if (frameName === 'ss-mini' && (url === 'about:blank' || url === '')) {
      const m = notes(DATA_DIR).mini || {};
      return { action: 'allow', overrideBrowserWindowOptions: { width: m.width || 340, height: m.height || 320, x: m.x, y: m.y, minWidth: 260, minHeight: 180, alwaysOnTop: true, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, title: 'Session Switcher', backgroundColor: '#0a090c', autoHideMenuBar: true, icon: iconFile() } };
    }
    if (ours(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 900, height: 860, backgroundColor: '#0a090c', autoHideMenuBar: true, icon: iconFile(), webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true, preload: path.join(__dirname, 'shell', 'preload.js') } } };
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // The page asks before it's closed while something is unsaved; the desktop window just goes to the tray.
  win.webContents.on('will-prevent-unload', e => e.preventDefault());
  win.webContents.on('did-create-window', (w, details) => {
    contextMenu(w.webContents); keys(w.webContents);
    if (!(details && details.frameName === 'ss-mini')) guard(w.webContents, true);
    if (details && details.frameName === 'ss-mini') {
      mini = w; w.on('closed', () => { if (mini === w) mini = null; });
      w.setAlwaysOnTop(true, 'floating');
      if (IS_MAC) w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      const keep = () => { if (!w.isDestroyed()) setNotes(DATA_DIR, { mini: w.getBounds() }); };
      w.on('moved', keep); w.on('resized', keep); w.on('close', keep);
    }
  });
  // A new page load (a reload, or after a restart) says again when it's ready.
  win.webContents.on('did-start-navigation', (_e, _u, inPlace, main) => { if (main && !inPlace) { pageReady = false; if (mini && !mini.isDestroyed()) mini.close(); } });
  win.on('focus', () => { if (!IS_MAC) win.flashFrame(false); });
  // On your home PC: the title says so, and a PC that stops answering hands over to this laptop at once.
  win.on('page-title-updated', (e, t) => { if (home.state().on === 'pc') { e.preventDefault(); win.setTitle(titled(t)); } });
  win.webContents.on('did-navigate', (_e, url, code) => home.pageLoaded(url, code));
  const me = win;
  win.on('closed', () => { if (win === me) { win = null; pageReady = false; } });
}
function show() {
  // Opened again while it's still starting (the first start's question is up): once it's ready.
  if (!started) { showLater = true; return; }
  if (!win || win.isDestroyed()) { createWindow(); win.loadURL(home.currentUrl()); }
  if (win.isMinimized()) win.restore();
  if (win._maxOnShow) { win._maxOnShow = false; win.maximize(); }
  win.show(); win.focus();
}

function createTray() {
  let img = nativeImage.createFromPath(path.join(APP_FILES, 'icon.ico'));
  if (IS_MAC || img.isEmpty()) img = nativeImage.createFromPath(path.join(APP_FILES, 'macos/icon.icns'));
  if (!img.isEmpty()) img = img.resize({ width: IS_MAC ? 18 : 16, height: IS_MAC ? 18 : 16 });
  tray = new Tray(img);
  tray.setToolTip('Session Switcher');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Open Session Switcher', click: show },
    { type: 'separator' },
    ...desk.waitingItems(),
    { label: 'New chat…', click: () => doIt('new-chat') },
    { label: 'Search every chat…', click: () => doIt('search') },
    ...(home.paired() ? [{ type: 'separator' },
      { label: 'Use my home PC', type: 'radio', checked: home.state().on === 'pc', click: () => { home.switchTo('pc'); show(); } },
      { label: 'Use this laptop', type: 'radio', checked: home.state().on !== 'pc', click: () => { home.switchTo('laptop'); show(); } }] : []),
    { label: 'Ask Companion…', visible: desk.opt().aideOn, click: () => desk.aideNow() },
    { type: 'separator' },
    { label: 'Start with Windows', visible: !IS_MAC, type: 'checkbox', checked: loginItem().openAtLogin, click: i => app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--hidden'] }) },
    { label: 'Open at login', visible: IS_MAC, type: 'checkbox', checked: loginItem().openAtLogin, click: i => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    (u => ({ label: u.status === 'ready' ? `Restart to update to ${u.next}` : u.status === 'available' ? `Download ${u.next}` : u.status === 'downloading' ? `Downloading ${u.next || 'the update'}… ${u.percent || 0}%` : 'Check for updates', enabled: u.status !== 'downloading' && u.status !== 'checking', click: () => (u.status === 'ready' || u.status === 'available' ? updates.install() : updates.check(true)) }))(updates ? updates.state : {}),
    { label: 'Show its files', click: () => shell.openPath(DATA_DIR) },
    { label: `Version ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Quit Session Switcher', click: () => { quitting = true; app.quit(); } },
  ]);
  if (!IS_MAC) tray.on('click', show);   // on a Mac a click opens the menu
  desk.setTrayMenu(menu);
  tray.setContextMenu(menu());
  setInterval(() => tray.setContextMenu(menu()), 60000).unref();
}

// A Mac app's menu: the standard one, so copy, paste and the rest work.
function macMenu() {
  if (!IS_MAC) { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]));
}

// Something for the page to do (a taskbar shortcut, the tray): now, or once the page has loaded.
let pageReady = false, pending = null;
function doIt(what) { show(); if (pageReady && win) win.webContents.send('desktop:do', what); else pending = what; }
const doArg = argv => { const a = (argv || []).find(x => /^--do=/.test(x)); return a ? a.slice(5) : null; };
app.on('second-instance', (_e, argv) => { const what = doArg(argv); if (what) doIt(what); else show(); });
app.on('activate', show);   // the Dock icon
app.on('window-all-closed', e => e.preventDefault());
app.on('before-quit', e => {
  quitting = true;
  desk.stop();
  if (aide) aide.stop();
  if (!server.running()) return;
  e.preventDefault();
  saveBounds();
  server.stop().finally(() => app.exit(0));
});

app.whenReady().then(async () => {
  log(`Starting ${app.getVersion()} (${app.isPackaged ? 'installed' : 'from source'}), data in ${DATA_DIR}`);
  macMenu();
  // The first time: bring in accounts and settings from a folder copy, if there is one.
  await offerImport({
    dataDir: DATA_DIR, port: PORT, log,
    ask: async from => (await dialog.showMessageBox({
      type: 'question', buttons: ['Bring them in', 'Start fresh'], defaultId: 0, cancelId: 1,
      title: 'Session Switcher', message: 'Use your accounts and settings from your other copy?',
      detail: `Found in ${from}.\n\nThey're copied, so that copy keeps working as it is.`,
    })).response === 0,
  }).catch(err => log(`Couldn’t bring them in: ${err.message}`));
  const hidden = process.argv.includes('--hidden') || loginItem().wasOpenedAsHidden;
  if (!win) createWindow(hidden && !showLater);
  started = true;
  createTray();
  server.start();
  updates = createUpdates({
    window: () => win, log,
    beforeInstall: () => { quitting = true; saveBounds(); desk.stop(); return server.stop({ forUpdate: true }); },
    // While the window is open and its page loaded, the page says it (Setup and a card); else a dialog.
    pageShows: () => !!(pageReady && win && win.isVisible()),
    channel: () => (desk.opt().channel === 'beta' ? 'beta' : 'stable'),
    onState: st => { if (win && !win.isDestroyed()) win.webContents.send('desktop:update', st); desk.status(desk.state); },   // the tray's menu shows it too
  });
  desk.jumpList();
  aide = createAideWindow({
    url: `${URL_BASE}?solo=1&aide=1`, preload: path.join(__dirname, 'shell', 'preload.js'), icon: iconFile(), log,
    settings: () => notes(DATA_DIR).aide, saveSettings: v => setNotes(DATA_DIR, { aide: v }),
    guard: (wc, popout) => { contextMenu(wc); keys(wc); guard(wc, popout); },
    openInApp: id => doIt(id ? `aide:${id}` : 'aide'),
  });
  desk.hotkey();
  const first = doArg(process.argv); if (first) pending = first;
  updates.begin();
  // A home PC started with nobody there: a server slow to come up gets more time, not a box. Anywhere else,
  // a box says so after a minute, and the app closes.
  for (let i = 0; !(await server.ready(i ? 30000 : 60000)); i++) {
    if (quitting) return;
    if (!unattended()) {
      dialog.showErrorBox('Session Switcher didn’t start', `Its server didn’t answer on port ${PORT}. The details are in ${path.join(DATA_DIR, 'switcher.log')}.`);
      quitting = true; app.quit();
      return;
    }
    if (!i) { log(`The server didn’t answer on port ${PORT}; still trying.`); notify('Session Switcher is slow to start', `Its server hasn’t answered yet. It keeps trying; the details are in ${path.join(DATA_DIR, 'switcher.log')}.`); }
    if (!server.running()) server.start();
  }
  if (win) win.loadURL(await home.startUrl());
  syncAide();
  home.begin();
});
