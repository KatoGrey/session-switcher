'use strict';
// Session Switcher as a desktop app: its own window and tray icon, the app's server running inside
// it, your data in the app's data folder, and updates from GitHub Releases.
const { app, BrowserWindow, Tray, Menu, shell, dialog, nativeImage, Notification } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createServer, URL_BASE, PORT } = require('./shell/server');
const { offerImport, notes, setNotes } = require('./shell/data');
const { createUpdates } = require('./shell/updates');

const APP_ID = 'com.katogrey.sessionswitcher';
const IS_MAC = process.platform === 'darwin';
// The app's files: packed beside it when installed, the repository's when run from source.
const APP_FILES = app.isPackaged ? path.join(process.resourcesPath, 'app-files') : path.join(__dirname, '..');
const DATA_DIR = process.env.SWITCHER_DATA_DIR || app.getPath('userData');
const LOG = path.join(DATA_DIR, 'desktop.log');

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

let win = null, tray = null, quitting = false, updates = null;
const server = createServer({
  appFiles: APP_FILES, dataDir: DATA_DIR, env: shellPath(), log,
  onQuit: () => { quitting = true; app.quit(); },   // Quit in the app quits the app
  onTrouble: err => {
    dialog.showErrorBox('Session Switcher stopped', `Its server stopped three times in a minute.\n\n${err}\n\nThe details are in ${path.join(DATA_DIR, 'switcher.log')}.`);
    quitting = true; app.quit();
  },
});

// Where the window was, kept between runs.
const bounds = () => notes(DATA_DIR).window || { width: 1320, height: 920 };
function saveBounds() {
  if (!win || win.isMinimized()) return;
  setNotes(DATA_DIR, { window: { ...win.getNormalBounds(), maximized: win.isMaximized() } });
}

const iconFile = () => path.join(APP_FILES, IS_MAC ? 'macos/icon.icns' : 'icon.ico');
const LOADING = `data:text/html;charset=utf-8,${encodeURIComponent('<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0a090c;color:#cfc6b6;font:16px Georgia,serif"><div style="text-align:center"><div style="letter-spacing:.3em;font-size:13px;color:#a5463f">SESSION SWITCHER</div><p>Starting…</p></div></body></html>')}`;

function createWindow() {
  const b = bounds();
  win = new BrowserWindow({
    width: b.width, height: b.height, x: b.x, y: b.y, minWidth: 420, minHeight: 500,
    title: 'Session Switcher', backgroundColor: '#0a090c', icon: iconFile(), show: false, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true },
  });
  if (b.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
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
  const ours = u => u.startsWith(URL_BASE) || u.startsWith(`http://localhost:${PORT}/`);
  // A chat popped out opens in a window of its own; links elsewhere open in your browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (ours(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 900, height: 860, backgroundColor: '#0a090c', autoHideMenuBar: true, icon: iconFile() } };
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!ours(url) && !url.startsWith('data:')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  // The page asks before it's closed while something is unsaved; the desktop window just goes to the tray.
  win.webContents.on('will-prevent-unload', e => e.preventDefault());
}
function show() {
  if (!win) { createWindow(); win.loadURL(URL_BASE); }
  if (win.isMinimized()) win.restore();
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
    { label: 'Start with Windows', visible: !IS_MAC, type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: i => app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--hidden'] }) },
    { label: 'Open at login', visible: IS_MAC, type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: i => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { label: updates && updates.state.ready ? `Restart to update to ${updates.state.ready}` : 'Check for updates', click: () => (updates.state.ready ? updates.install() : updates.check(true)) },
    { label: 'Show its files', click: () => shell.openPath(DATA_DIR) },
    { label: `Version ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Quit Session Switcher', click: () => { quitting = true; app.quit(); } },
  ]);
  if (!IS_MAC) tray.on('click', show);   // on a Mac a click opens the menu
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

app.on('second-instance', show);
app.on('activate', show);   // the Dock icon
app.on('window-all-closed', e => e.preventDefault());
app.on('before-quit', e => {
  quitting = true;
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
  const hidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAsHidden;
  if (!hidden) createWindow();
  createTray();
  server.start();
  updates = createUpdates({ window: () => win, beforeInstall: () => server.stop({ forUpdate: true }), log });
  updates.begin();
  if (await server.ready()) { if (win) win.loadURL(URL_BASE); }
  else {
    dialog.showErrorBox('Session Switcher didn’t start', `Its server didn’t answer on port ${PORT}. The details are in ${path.join(DATA_DIR, 'switcher.log')}.`);
    quitting = true; app.quit();
  }
});
