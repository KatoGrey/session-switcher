'use strict';
// Companion's window: a see-through panel over whatever you're doing, brought up by a key from anywhere.
// It's kept loaded and out of sight, so it's there the moment you press the key. It starts centered, stays
// where you move it (per screen), and hands the keyboard back to your game when it's put away.
const { BrowserWindow, desktopCapturer, screen, systemPreferences, ipcMain } = require('electron');
const { createFront } = require('./foreground');
const { createRegionPicker } = require('./aide-region');

const IS_MAC = process.platform === 'darwin';
const WIDTH = 720, MIN_W = 440, MAX_W = 1400, MIN_H = 96;
const SNAP = 18;      // how close to an edge a dragged panel is drawn to it
const SHOT_EDGE = 1568;   // the long side of a screenshot: as much as the assistants can make use of

function createAideWindow({ url, preload, icon, settings, saveSettings, log = () => {}, guard = () => {}, ours = () => false, openInApp = () => {} }) {
  let win = null, pageReady = false, waiting = null, pinned = false, returnTo = null;
  let shown = null;      // the display it's showing on
  const front = createFront({ log });
  const regionPicker = createRegionPicker({ BrowserWindow, ipcMain, screen });
  let captureBusy = false, captureGeneration = 0;
  const opts = () => settings() || {};
  const save = patch => saveSettings({ ...opts(), ...patch });

  function create() {
    if (win && !win.isDestroyed()) return win;
    pageReady = false;
    win = new BrowserWindow({
      width: opts().width || WIDTH, height: MIN_H, minWidth: MIN_W, minHeight: 60, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false,
      alwaysOnTop: true, skipTaskbar: true, minimizable: false, maximizable: false, fullscreenable: false, title: 'Companion', icon, autoHideMenuBar: true,
      ...(IS_MAC ? { type: 'panel', vibrancy: 'hud', visualEffectState: 'active' } : {}),
      webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true, preload, backgroundThrottling: false },
    });
    // Above a game in a borderless window; on a Mac, over a full-screen one too.
    win.setAlwaysOnTop(true, 'screen-saver');
    if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    guard(win.webContents, true);
    win.webContents.on('will-prevent-unload', e => e.preventDefault());
    win.on('moved', onMoved);
    const me = win;
    win.on('closed', () => { if (win === me) { ++captureGeneration; regionPicker.cancel(); win = null; pageReady = false; pinned = false; } });
    win.loadURL(url);
    return win;
  }
  function destroy() { ++captureGeneration; regionPicker.cancel(); if (win && !win.isDestroyed()) win.destroy(); win = null; pageReady = false; }

  // The screen with what you're looking at: the window in front's, else the pointer's.
  function displayFor(f) {
    try {
      if (f && Number.isFinite(f.x) && Number.isFinite(f.y)) {
        const p = process.platform === 'win32' ? screen.screenToDipPoint({ x: f.x, y: f.y }) : { x: f.x, y: f.y };
        return screen.getDisplayNearestPoint({ x: Math.round(p.x), y: Math.round(p.y) });
      }
    } catch { /* below */ }
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  }
  const keyOf = d => String(d.id);
  // Where it goes on a screen: where you left it there, if that's still on it, or centered, a little high,
  // so an answer has room to grow down.
  function place(d) {
    const a = d.workArea, o = opts(), w = Math.min(o.width || WIDTH, a.width - 24), saved = (o.pos || {})[keyOf(d)];
    const h = win.getBounds().height;
    let x = Math.round(a.x + (a.width - w) / 2), y = Math.round(a.y + a.height * 0.2);
    if (saved && saved.x >= a.x - 40 && saved.x + 80 <= a.x + a.width && saved.y >= a.y - 20 && saved.y + 40 <= a.y + a.height) { x = saved.x; y = saved.y; }
    win.setBounds({ x, y, width: w, height: h });
    shown = d;
    return !!saved;
  }
  // Dragged: drawn to the edges when it's close to them, and remembered for this screen.
  function onMoved() {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const b = win.getBounds(), d = screen.getDisplayMatching(b), a = d.workArea;
    let { x, y } = b;
    if (Math.abs(x - a.x) < SNAP) x = a.x; else if (Math.abs(x + b.width - (a.x + a.width)) < SNAP) x = a.x + a.width - b.width;
    if (Math.abs(y - a.y) < SNAP) y = a.y;
    if (x !== b.x || y !== b.y) win.setPosition(x, y);
    shown = d;
    save({ pos: { ...(opts().pos || {}), [keyOf(d)]: { x, y } } });
    send('aide:moved', true);
  }
  const send = (ch, v) => { if (win && !win.isDestroyed()) win.webContents.send(ch, v); };

  // A picture of the screen, without this panel in it.
  async function capture(d, region = false) {
    if (captureBusy) return null;
    if (IS_MAC && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
      return { error: 'Session Switcher needs permission to see the screen: System Settings, Privacy & Security, Screen Recording. Then open it again.' };
    }
    captureBusy = true;
    const generation = captureGeneration;
    const s = d.size, scale = region ? 1 : Math.min(1, SHOT_EDGE / Math.max(s.width * d.scaleFactor, s.height * d.scaleFactor));
    const size = { width: Math.round(s.width * d.scaleFactor * scale), height: Math.round(s.height * d.scaleFactor * scale) };
    const visible = !!(win && !win.isDestroyed() && win.isVisible());
    try {
      if (visible) { win.setOpacity(0); await new Promise(r => setTimeout(r, 70)); }
      if (generation !== captureGeneration) return null;
      const list = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size, fetchWindowIcons: false });
      if (generation !== captureGeneration) return null;
      const src = list.find(x => x.display_id === keyOf(d)) || (list.length === 1 && screen.getAllDisplays().length === 1 && !list[0].display_id ? list[0] : null);
      if (!src || src.thumbnail.isEmpty()) return { error: 'The screen couldn’t be captured.' };
      // All black: true fullscreen, or a game that blocks being captured.
      const small = src.thumbnail.resize({ width: 48 }).toBitmap();
      let top = 0; for (let i = 0; i < small.length; i += 4) top = Math.max(top, small[i], small[i + 1], small[i + 2]);
      if (top < 10) return { black: true };
      let picture = src.thumbnail;
      if (region) {
        const selected = await regionPicker.pick(picture, d);
        if (!selected || generation !== captureGeneration) return null;
        if (selected.error) return selected;
        picture = selected.image;
        const sz = picture.getSize(), ratio = Math.min(1, SHOT_EDGE / Math.max(sz.width, sz.height));
        if (ratio < 1) picture = picture.resize({ width: Math.round(sz.width * ratio), height: Math.round(sz.height * ratio), quality: 'best' });
      }
      return { mediaType: 'image/jpeg', data: picture.toJPEG(82).toString('base64') };
    } catch (err) { log(`Companion couldn’t capture the screen: ${err.message}`); return { error: 'The screen couldn’t be captured.' }; }
    finally {
      captureBusy = false;
      if (visible && win && !win.isDestroyed()) { win.setOpacity(1); if (region && win.isVisible()) win.focus(); }
    }
  }

  function hide() {
    ++captureGeneration; regionPicker.cancel();
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    win.hide();
    send('aide:hidden', true);
    // Back to what you were doing (Windows usually does this by itself; a game shouldn't have to wait for a click).
    if (returnTo) front.focus(returnTo);
  }
  function setPin(on) {
    pinned = !!on;
    if (!win || win.isDestroyed()) return;
    win.setIgnoreMouseEvents(pinned);
    win.setFocusable(!pinned);
    send('aide:pinned', pinned);
    if (pinned && returnTo) front.focus(returnTo);
    if (!pinned) { win.show(); win.focus(); }
  }
  // The key. Up and in front: put away. Up but you've gone back to the game: the keyboard comes back here.
  async function toggle(look = false) {
    create();
    if (captureBusy) { ++captureGeneration; regionPicker.cancel(); return; }
    if (pinned) { setPin(false); return; }
    const up = win.isVisible();
    if (up && win.isFocused() && !look) { hide(); return; }
    if (up) {
      if (look) send('aide:shot', await capture(shown || displayFor(null)));
      win.focus();
      return;
    }
    const f = await front.now(150);
    if (f && f.hwnd) returnTo = f.hwnd;
    const d = displayFor(f);
    const moved = place(d);
    const show = { app: f ? { title: f.title, process: f.process, path: f.path, fullscreen: f.fullscreen } : null, moved };
    // The keyboard comes here straight away. For a picture it's up but invisible until that's been taken,
    // which is about half a second, so you can start typing and the picture doesn't have the panel in it.
    if (look) win.setOpacity(0);
    win.show(); win.moveTop(); win.focus();
    if (pageReady) send('aide:show', show); else waiting = show;
    if (look) send('aide:shot', await capture(d));
  }

  // What its page asks. Only from its own window.
  const handlers = {
    ready() { pageReady = true; if (waiting) { send('aide:show', waiting); waiting = null; } },
    hide,
    pin: setPin,
    // The panel's height, for what's in it: never off the bottom of the screen.
    size(h) {
      if (!win || win.isDestroyed()) return;
      const b = win.getBounds(), a = (shown || screen.getDisplayMatching(b)).workArea, most = Math.min(opts().maxH || Infinity, a.y + a.height - b.y - 8);
      const height = Math.round(Math.max(MIN_H, Math.min(Number(h) || MIN_H, Math.max(MIN_H, most))));
      if (height !== b.height) win.setBounds({ x: b.x, y: b.y, width: b.width, height });
    },
    // Its edges, dragged: wider or narrower, from either side, and how tall an answer may make it.
    resize({ x, width, maxH } = {}) {
      if (!win || win.isDestroyed()) return;
      const b = win.getBounds(), w = Number.isFinite(width) ? Math.max(MIN_W, Math.min(MAX_W, Math.round(width))) : b.width;
      const nx = Number.isFinite(x) ? Math.round(x) : b.x;
      if (w !== b.width || nx !== b.x) win.setBounds({ x: nx, y: b.y, width: w, height: b.height });
      save({ width: w, ...(Number.isFinite(maxH) ? { maxH: Math.max(200, Math.round(maxH)) } : {}) });
    },
    bounds: () => (win && !win.isDestroyed() ? win.getBounds() : null),
    // Back to the middle of this screen.
    center() {
      if (!win || win.isDestroyed()) return;
      const d = shown || screen.getDisplayMatching(win.getBounds()), pos = { ...(opts().pos || {}) };
      delete pos[keyOf(d)];
      save({ pos });
      place(d);
      send('aide:moved', false);
    },
    look: async () => capture(shown || displayFor(null)),
    region: async () => capture(shown || displayFor(null), true),
    openInApp(id) { hide(); openInApp(id); },
  };
  return { create, destroy, toggle, hide, handlers, sender: () => (win && !win.isDestroyed() ? win.webContents : null), prepare: () => front.start(), stop() { front.stop(); destroy(); } };
}

module.exports = { createAideWindow };
