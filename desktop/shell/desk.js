'use strict';
// What makes it a desktop app beyond a window: right-click menus and keys that a browser has, the
// tray and taskbar saying what's waiting, keeping the PC awake while chats work, taskbar shortcuts
// and a key to bring it up from anywhere.
const { app, Menu, MenuItem, clipboard, shell, nativeImage, powerSaveBlocker, globalShortcut } = require('electron');

const IS_MAC = process.platform === 'darwin';
const DEFAULTS = { keepAwake: true, hotkey: 'CommandOrControl+Shift+Space', hotkeyOn: true };

// Right-click: spelling suggestions, cut/copy/paste in a text box, copy for a selection, a link or a
// picture. (The app's own right-click menus, on chats and the like, still win where they're shown.)
function contextMenu(wc) {
  wc.on('context-menu', (_e, p) => {
    const m = new Menu();
    const add = o => m.append(new MenuItem(o));
    if (p.misspelledWord) {
      for (const s of p.dictionarySuggestions.slice(0, 5)) add({ label: s, click: () => wc.replaceMisspelling(s) });
      if (!p.dictionarySuggestions.length) add({ label: 'No suggestions', enabled: false });
      add({ label: 'Add to dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
      add({ type: 'separator' });
    }
    if (p.linkURL && !p.isEditable) {
      add({ label: 'Open link', click: () => shell.openExternal(p.linkURL) });
      add({ label: 'Copy link', click: () => clipboard.writeText(p.linkURL) });
      add({ type: 'separator' });
    }
    if (p.mediaType === 'image' && p.srcURL) {
      add({ label: 'Copy picture', click: () => wc.copyImageAt(p.x, p.y) });
      add({ label: 'Save picture as…', click: () => wc.downloadURL(p.srcURL) });
      add({ type: 'separator' });
    }
    if (p.isEditable) {
      add({ role: 'undo', enabled: p.editFlags.canUndo }); add({ role: 'redo', enabled: p.editFlags.canRedo }); add({ type: 'separator' });
      add({ role: 'cut', enabled: p.editFlags.canCut }); add({ role: 'copy', enabled: p.editFlags.canCopy }); add({ role: 'paste', enabled: p.editFlags.canPaste });
      add({ role: 'selectAll' });
    } else if (p.selectionText && p.selectionText.trim()) add({ role: 'copy' });
    while (m.items.length && m.items[m.items.length - 1].type === 'separator') m.items.pop();
    if (m.items.length) m.popup();
  });
}

// Keys a browser has: reload, developer tools, zoom.
function keys(wc) {
  wc.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    const mod = IS_MAC ? i.meta : i.control;
    const k = i.key.toLowerCase();
    if (i.key === 'F5' || (mod && !i.shift && k === 'r')) { e.preventDefault(); wc.reload(); }
    else if (i.key === 'F12' || (mod && i.shift && k === 'i')) { e.preventDefault(); wc.toggleDevTools(); }
    else if (mod && !i.alt && (k === '=' || k === '+')) { e.preventDefault(); wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 4)); }
    else if (mod && !i.alt && k === '-') { e.preventDefault(); wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3)); }
    else if (mod && !i.alt && k === '0') { e.preventDefault(); wc.setZoomLevel(0); }
  });
}

function createDesk({ show, send, tray, window, settings, saveSettings, log = () => {} }) {
  const st = { needs: 0, working: 0, list: [], badge: null };
  let awake = null;
  const opt = () => ({ ...DEFAULTS, ...(settings() || {}) });

  // While a chat works, the PC doesn't go to sleep (the screen still may).
  function keepAwake() {
    const want = opt().keepAwake && st.working > 0;
    if (want && awake === null) { awake = powerSaveBlocker.start('prevent-app-suspension'); log('Keeping the PC awake while chats work.'); }
    if (!want && awake !== null) { powerSaveBlocker.stop(awake); awake = null; }
  }
  // What's waiting, from the page.
  function status(s) {
    const was = st.needs;
    Object.assign(st, { needs: Math.max(0, Number(s.needs) || 0), working: Math.max(0, Number(s.working) || 0), list: Array.isArray(s.list) ? s.list.slice(0, 8) : [], badge: s.badge || null });
    const t = tray();
    if (t) t.setToolTip(['Session Switcher', st.needs ? `${st.needs} need${st.needs === 1 ? 's' : ''} you` : '', st.working ? `${st.working} working` : ''].filter(Boolean).join(' · '));
    const w = window();
    if (IS_MAC) app.dock.setBadge(st.needs ? String(st.needs) : '');
    else if (w) w.setOverlayIcon(st.needs && st.badge ? nativeImage.createFromDataURL(st.badge) : null, st.needs ? `${st.needs} need you` : '');
    // Something new needs you while you're elsewhere: the taskbar button (or the Dock) asks for attention.
    if (st.needs > was && w && !w.isFocused()) { if (IS_MAC) app.dock.bounce('informational'); else w.flashFrame(true); }
    if (!st.needs && w && !IS_MAC) w.flashFrame(false);
    keepAwake();
    if (t) t.setContextMenu(trayMenu());
  }
  let trayMenu = () => Menu.buildFromTemplate([]);
  function setTrayMenu(f) { trayMenu = f; }
  const waitingItems = () => (st.list.length
    ? [{ label: `${st.needs} need${st.needs === 1 ? 's' : ''} you`, enabled: false }, ...st.list.map(x => ({ label: `   ${String(x.t || 'A chat').slice(0, 48)}`, click: () => { show(); send('desktop:open', x.k); } })), { type: 'separator' }]
    : []);

  // Right-click the taskbar button (Windows): straight to a new chat, search or a queued task.
  function jumpList() {
    if (IS_MAC || !app.isPackaged) return;
    const task = (title, what, description) => ({ program: process.execPath, arguments: `--do=${what}`, iconPath: process.execPath, iconIndex: 0, title, description });
    try {
      app.setUserTasks([
        task('New chat', 'new-chat', 'Start a chat in one of your projects'),
        task('Search every chat', 'search', 'Find any chat, setting or action'),
        task('Queue a task', 'task', 'Line work up for later'),
      ]);
    } catch (err) { log(`Couldn’t set the taskbar shortcuts: ${err.message}`); }
  }
  // From anywhere: the key brings it up (or puts it away when it's in front).
  function hotkey() {
    globalShortcut.unregisterAll();
    const o = opt();
    if (!o.hotkeyOn || !o.hotkey) return { ok: true, off: true };
    try {
      const ok = globalShortcut.register(o.hotkey, () => { const w = window(); if (w && w.isVisible() && w.isFocused()) w.hide(); else show(); });
      if (!ok) log(`The key ${o.hotkey} is taken by another program.`);
      return { ok };
    } catch (err) { log(`Couldn’t set the key ${o.hotkey}: ${err.message}`); return { ok: false }; }
  }
  function set(patch) {
    const next = { ...opt() };
    for (const k of ['keepAwake', 'hotkeyOn']) if (typeof patch[k] === 'boolean') next[k] = patch[k];
    if (patch.channel === 'beta' || patch.channel === 'stable') next.channel = patch.channel;
    if (typeof patch.hotkey === 'string' && /^[\w+]{3,60}$/.test(patch.hotkey)) next.hotkey = patch.hotkey;
    saveSettings(next);
    keepAwake();
    const hk = hotkey();
    return { ...next, hotkeyOk: hk.ok !== false };
  }
  function stop() { if (awake !== null) powerSaveBlocker.stop(awake); globalShortcut.unregisterAll(); }
  return { status, setTrayMenu, waitingItems, jumpList, hotkey, set, opt, stop, state: st };
}

module.exports = { contextMenu, keys, createDesk, DEFAULTS };
