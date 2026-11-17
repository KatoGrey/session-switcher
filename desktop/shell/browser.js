'use strict';
// The browser built into the app. Its tabs draw off screen (Electron's offscreen rendering), so they keep
// working, and can be looked at, whatever the window is doing: hidden in the tray, minimized, or showing
// something else. (A normal view stops drawing when it's hidden, and its screenshots hang.)
//
// - The page shows a tab by asking for its frames (pictures of what changed, as JPEG) and sends back your
//   mouse and keys (shell/preload.js → desktop.browser).
// - The chats' browser tools (lib/browser.js on the server, reached through the server's IPC channel) drive
//   tabs with Chrome's own input, screenshot and script commands (the DevTools protocol).
// - Each tab belongs to a chat (owner: its session id) or to you ('you'). Sign-ins are kept in a profile of
//   their own (persist:ss-browser): apart from the app's own pages and from your Chrome.
// - Pages can't pop up boxes of their own (they'd be native windows over everything): alerts are noted,
//   and a confirm or prompt is answered the way the tab is set to (Cancel, unless told otherwise).

const { BrowserWindow, Menu, MenuItem, app, clipboard, session: electronSession } = require('electron');
const fs = require('fs');
const path = require('path');

const PARTITION = 'persist:ss-browser';
const SIZES = { desktop: [1280, 800], laptop: [1440, 900], wide: [1920, 1080], tablet: [820, 1180], phone: [390, 844] };
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{v} Mobile Safari/537.36';
const MAX_TABS = 40, MAX_PER_OWNER = 10;
const LOG_MAX = 400, NET_MAX = 400;
// What pages may ask for: nothing that reaches beyond the tab (no notifications, camera, location…).
const ALLOW = new Set(['clipboard-sanitized-write', 'fullscreen', 'pointerLock', 'keyboardLock', 'idle-detection', 'window-management', 'speaker-selection', 'storage-access', 'top-level-storage-access']);
const ID = /^t\d{1,6}$/;
const IDLE_CLOSE = 45 * 60e3;   // a tab nobody has looked at or used for this long is closed
const OWNER = /^[\w:.-]{1,80}$/;

// The page's own boxes, kept inside the page: alert is noted, confirm and prompt answered per the tab's
// setting (window.__ssDialog: 'dismiss' or 'accept', with __ssPrompt for a prompt's answer).
const DIALOG_SHIM = nonce => `(() => {
  const say = console.debug.bind(console);
  const note = (type, message, answer) => { try { say('\u2063ss:${nonce}:dialog:' + JSON.stringify({ type, message: String(message == null ? '' : message).slice(0, 2000), answer })); } catch (e) {} };
  const mode = () => (window.__ssDialog === 'accept' ? 'accept' : 'dismiss');
  Object.defineProperty(window, 'alert', { configurable: true, writable: true, value: function (m) { note('alert', m, 'ok'); } });
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: function (m) { const a = mode() === 'accept'; note('confirm', m, a ? 'ok' : 'cancel'); return a; } });
  Object.defineProperty(window, 'prompt', { configurable: true, writable: true, value: function (m, d) { const a = mode() === 'accept'; const v = a ? (typeof window.__ssPrompt === 'string' ? window.__ssPrompt : (d == null ? '' : String(d))) : null; note('prompt', m, a ? 'ok: ' + v : 'cancel'); return v; } });
})();`;

// A native <select> list doesn't draw off screen, so a click on one (yours, from the page) opens the app's own
// list instead: the page is told the options and where the select is, and picks with selectOption.
// (Both shims report on a console line of their own, marked \u2063ss:<a secret of this run>:, which never reaches the
// console log, and which a page can't fake.)
const SELECT_SHIM = nonce => `(() => {
  if (window.__ssSelectShim) return; window.__ssSelectShim = 1;
  const say = console.debug.bind(console);
  document.addEventListener('mousedown', e => {
    const s = e.target && e.target.closest && e.target.closest('select');
    if (!s || s.multiple || s.size > 1 || s.disabled || !e.isTrusted || e.button !== 0) return;
    e.preventDefault(); s.focus();
    window.__ssSel = s;
    const r = s.getBoundingClientRect();
    try { say('\u2063ss:${nonce}:select:' + JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height, selected: s.selectedIndex, options: [...s.options].slice(0, 500).map(o => ({ label: o.label || o.text, disabled: o.disabled, group: o.parentElement && o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : '' })) })); } catch (err) {}
  }, true);
})();`;

const cleanUA = ua => String(ua || '').replace(/\s+Electron\/\S+/i, '').replace(/\s+session-switcher\/\S+/i, '').replace(/\s+Session Switcher\/\S+/i, '');
const within = (p, ms, what) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error(`${what} took longer than ${Math.round(ms / 1000)} s`)), ms))]);
const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const union = (a, b) => {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};
function uniquePath(dir, name) {
  const safe = String(name || 'download').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 150) || 'download';
  const ext = path.extname(safe), base = safe.slice(0, safe.length - ext.length);
  let f = path.join(dir, safe);
  for (let i = 2; fs.existsSync(f) && i < 1000; i++) f = path.join(dir, `${base} (${i})${ext}`);
  return f;
}

// blocked(url): an address tabs may not open (the app's own server: its pages belong in the app's window).
function createBrowserHost({ log = () => {}, blocked = () => false } = {}) {
  const tabs = new Map();          // id -> tab
  const current = new Map();       // owner -> id: the tab its tools use when they don't name one
  const pages = new Map();         // webContents id -> { wc, viewing: Set(tab id) }: the app's pages that listen
  let seq = 0, ses = null, tabsTimer = null;
  const NONCE = require('crypto').randomBytes(9).toString('hex');
  const SHIM_LINE = new RegExp(`^\\u2063ss:${NONCE}:(dialog|select):(.*)$`, 's');

  function sess() {
    if (ses) return ses;
    ses = electronSession.fromPartition(PARTITION);
    ses.setUserAgent(cleanUA(ses.getUserAgent()));
    ses.setPermissionRequestHandler((_wc, perm, cb) => cb(ALLOW.has(perm)));
    ses.setPermissionCheckHandler((_wc, perm) => ALLOW.has(perm));
    // The app's own server, never: not by a redirect, a frame, a fetch or a socket either (its page holds the app's key).
    ses.webRequest.onBeforeRequest({ urls: ['*://127.0.0.1/*', '*://localhost/*', '*://[::1]/*'] }, (d, cb) => cb({ cancel: !!blocked(d.url) }));
    // Downloads go to your Downloads folder without a box (a box would come up over everything).
    ses.on('will-download', (_e, item, wc) => {
      let dir; try { dir = app.getPath('downloads'); } catch { dir = app.getPath('temp'); }
      const f = uniquePath(dir, item.getFilename());
      item.setSavePath(f);
      const t = byWc(wc);
      item.once('done', (_ev, state) => { if (t) note(t, state === 'completed' ? `Downloaded ${path.basename(f)} to your Downloads folder.` : `The download of ${path.basename(f)} ${state === 'cancelled' ? 'was cancelled' : 'failed'}.`); });
    });
    return ses;
  }
  const byWc = wc => { for (const t of tabs.values()) if (t.wc === wc) return t; return null; };
  const get = id => { const t = ID.test(String(id)) && tabs.get(id); if (!t) throw new Error(`There’s no tab ${id || ''} (it may have been closed).`.replace('  ', ' ')); return t; };

  // ---------- what the app's pages hear ----------
  const info = t => ({
    id: t.id, owner: t.owner, title: t.title || '', url: t.url || '', loading: t.loading, crashed: t.crashed || false,
    canBack: safe(() => t.wc.navigationHistory.canGoBack(), false), canForward: safe(() => t.wc.navigationHistory.canGoForward(), false),
    muted: safe(() => t.wc.isAudioMuted(), false), audible: safe(() => t.wc.isCurrentlyAudible(), false),
    size: { w: t.w, h: t.h, preset: t.preset, mobile: t.mobile }, favicon: t.favicon || null, dialogs: t.dialogMode,
    lastAgent: t.lastAgent || 0, lastNote: t.lastNote || null, created: t.created, current: current.get(t.owner) === t.id,
  });
  function safe(f, d) { try { return f(); } catch { return d; } }
  const list = owner => [...tabs.values()].filter(t => !owner || t.owner === owner).map(info);
  function toPages(ch, v, only = null) {
    for (const [k, p] of pages) {
      if (p.wc.isDestroyed()) { pages.delete(k); continue; }
      if (only && !only(p)) continue;
      try { p.wc.send(ch, v); } catch { /* going */ }
    }
  }
  function tabsChanged() { clearTimeout(tabsTimer); tabsTimer = setTimeout(() => toPages('browser:tabs', list()), 60); }
  function note(t, text) { t.lastNote = { text: String(text).slice(0, 400), at: Date.now() }; t.notes.push(t.lastNote); if (t.notes.length > 50) t.notes.shift(); tabsChanged(); }
  function listen(wc) {
    if (pages.has(wc.id)) return pages.get(wc.id);
    const p = { wc, viewing: new Set() };
    pages.set(wc.id, p);
    // (Once per page: a reload ends what it was watching, and it starts listening again when it asks.)
    if (!wc.__ssBrowser) {
      wc.__ssBrowser = true;
      const drop = () => { const q = pages.get(wc.id); if (!q) return; for (const id of q.viewing) unwatch(tabs.get(id), wc.id); pages.delete(wc.id); };
      wc.once('destroyed', drop);
      wc.on('did-start-navigation', (_e, _u, inPlace, main) => { if (main && !inPlace) drop(); });
    }
    return p;
  }
  function unwatch(t, wcId) {
    if (!t) return;
    t.viewers.delete(wcId);
    t.lastViewed = Date.now();
    if (!t.viewers.size) t.latest = null;   // (no frame kept for nobody)
    rate(t);
  }

  // ---------- frames, for the pages showing a tab ----------
  // Frames drawn while someone watches go out at most ~30 a second: the part that changed, or the whole
  // frame when most of it did (or someone just started watching).
  function rate(t) {
    if (!t || t.wc.isDestroyed()) return;
    const busy = Date.now() - (t.lastAgent || 0) < 20000;
    try { t.wc.setFrameRate(t.viewers.size ? 30 : busy ? 15 : 5); } catch { /* gone */ }
    clearTimeout(t.rateTimer);
    if (busy && !t.viewers.size) t.rateTimer = setTimeout(() => rate(t), 20500);
  }
  function onPaint(t, dirty, image) {
    if (!t.viewers.size) return;
    t.dirty = union(t.dirty, dirty);
    t.latest = image;
    if (t.frameTimer) return;
    const wait = Math.max(0, 33 - (Date.now() - (t.lastSent || 0)));
    t.frameTimer = setTimeout(() => { t.frameTimer = null; sendFrame(t); }, wait);
  }
  function sendFrame(t, img = t.latest) {
    if (!img || !t.viewers.size || t.wc.isDestroyed()) return;
    const size = img.getSize();
    if (!size.width || !size.height) return;
    let r = t.dirty || { x: 0, y: 0, width: size.width, height: size.height };
    r = { x: Math.max(0, Math.floor(r.x)), y: Math.max(0, Math.floor(r.y)) };
    r.width = Math.min(size.width - r.x, Math.ceil((t.dirty ? t.dirty.width : size.width)) + 1);
    r.height = Math.min(size.height - r.y, Math.ceil((t.dirty ? t.dirty.height : size.height)) + 1);
    const full = t.needFull || r.width * r.height > size.width * size.height * 0.55 || r.width <= 0 || r.height <= 0;
    if (full) r = { x: 0, y: 0, width: size.width, height: size.height };
    t.dirty = null; t.needFull = false; t.lastSent = Date.now();
    let data;
    try { data = (full ? img : img.crop(r)).toJPEG(84); } catch (err) { log(`Browser: a frame couldn’t be made (${err.message})`); return; }
    const frame = { id: t.id, x: r.x, y: r.y, w: r.width, h: r.height, fw: size.width, fh: size.height, full, data };
    for (const k of t.viewers) { const p = pages.get(k); if (!p || p.wc.isDestroyed()) { t.viewers.delete(k); continue; } try { p.wc.send('browser:frame', frame); } catch { /* going */ } }
  }
  async function fullFrame(t) {
    try { const img = await within(t.wc.capturePage(), 5000, 'A picture of the page'); t.needFull = true; t.dirty = null; sendFrame(t, img); } catch { /* the next paint brings it */ }
  }

  // ---------- making tabs ----------
  function windowOptions(w, h) {
    return { show: false, width: w, height: h, useContentSize: true, skipTaskbar: true, frame: false,
      webPreferences: { offscreen: true, partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: true, disableDialogs: true, safeDialogs: true } };
  }
  function create({ owner = 'you', url = '', size = 'desktop', win = null } = {}) {
    owner = OWNER.test(String(owner)) ? String(owner) : 'you';
    if (tabs.size >= MAX_TABS) throw new Error(`There are ${tabs.size} tabs open in the app’s browser. Close some first.`);
    const mine = [...tabs.values()].filter(t => t.owner === owner);
    if (mine.length >= MAX_PER_OWNER) throw new Error(`This chat has ${mine.length} tabs open. Close one first (close_tab).`);
    sess();
    const preset = SIZES[size] ? size : 'desktop';
    const [w, h] = SIZES[preset];
    const bw = win || new BrowserWindow(windowOptions(w, h));
    const t = { id: `t${++seq}`, owner, win: bw, wc: bw.webContents, title: '', url: '', loading: false, w, h, preset, mobile: false, viewers: new Set(), logs: [], net: [], netById: new Map(), notes: [], dialogMode: 'dismiss', created: Date.now(), lastAgent: 0 };
    tabs.set(t.id, t);
    current.set(owner, t.id);
    wire(t, !!win);
    if (win) { const s = bw.getContentSize(); t.w = s[0] || w; t.h = s[1] || h; t.url = safe(() => bw.webContents.getURL(), ''); t.title = safe(() => bw.webContents.getTitle(), ''); }
    if (url) Promise.resolve(t.ready).then(() => go(t, url)).catch(() => {});
    tabsChanged();
    return info(t);
  }
  function wire(t, adopted = false) {
    const wc = t.wc;
    try { wc.setUserAgent(cleanUA(wc.getUserAgent())); } catch { /* fine */ }
    wc.setFrameRate(5);
    wc.on('paint', (_e, dirty, image) => onPaint(t, dirty, image));
    wc.on('page-title-updated', (_e, title) => { t.title = title; tabsChanged(); });
    wc.on('page-favicon-updated', (_e, icons) => { t.favicon = (icons || []).find(u => /^https:/.test(u)) || null; tabsChanged(); });
    wc.on('did-start-loading', () => { t.loading = true; tabsChanged(); });
    wc.on('did-stop-loading', () => { t.loading = false; tabsChanged(); });
    const moved = (_e, url) => { t.url = url; tabsChanged(); };
    wc.on('did-navigate', moved); wc.on('did-navigate-in-page', (e, url, main) => { if (main) moved(e, url); });
    wc.on('did-fail-load', (_e, code, desc, url, main) => { if (main && code !== -3) { t.lastError = `${desc} (${code}) loading ${url}`; note(t, `Couldn’t load ${url}: ${desc}.`); } });
    wc.on('render-process-gone', (_e, d) => { t.crashed = true; note(t, `The page stopped (${d.reason}). Reload it.`); });
    wc.on('did-start-navigation', (_e, _u, inPlace, main) => { if (main && !inPlace) t.crashed = false; });
    wc.on('will-prevent-unload', e => e.preventDefault());   // "Leave this page?": leave
    wc.on('console-message', e => {
      const m = SHIM_LINE.exec(String(e.message || ''));
      if (m) { shimSaid(t, m[1], m[2]); return; }
      if (/^\u2063ss:/.test(String(e.message || ''))) return;   // (one that claims to be ours but isn't)
      const lvl = e.level || 'info';
      t.logs.push({ level: lvl, text: String(e.message || '').slice(0, 4000), source: e.sourceId ? `${e.sourceId}:${e.lineNumber}` : '', at: Date.now() });
      if (t.logs.length > LOG_MAX) t.logs.splice(0, t.logs.length - LOG_MAX);
    });
    wc.on('cursor-changed', (_e, type) => toPages('browser:cursor', { id: t.id, cursor: type }, p => p.viewing.has(t.id)));
    wc.on('context-menu', (_e, p) => menuFor(t, p));
    // Links that open a new tab open one here, for the same chat. A pop-up window (a sign-in, say) is a tab
    // too, and keeps its link to the page that opened it.
    wc.setWindowOpenHandler(d => {
      if (blocked(d.url)) return { action: 'deny' };
      if (d.disposition === 'new-window') {
        const [w, h] = [clampInt(/width=(\d+)/.exec(d.features || '')?.[1], 320, 1600, 600), clampInt(/height=(\d+)/.exec(d.features || '')?.[1], 320, 1200, 700)];
        return { action: 'allow', overrideBrowserWindowOptions: windowOptions(w, h) };
      }
      try { create({ owner: t.owner, url: d.url, size: t.preset }); } catch (err) { note(t, err.message); }
      return { action: 'deny' };
    });
    wc.on('did-create-window', win => { try { const n = create({ owner: t.owner, win }); note(tabs.get(n.id), 'Opened as a pop-up by another tab.'); } catch (err) { log(`Browser: ${err.message}`); win.destroy(); } });
    wc.on('will-navigate', (e, url) => { if (blocked(url)) { e.preventDefault(); note(t, 'That address belongs to the app itself, so it isn’t opened in its browser.'); } });
    wc.on('destroyed', () => { if (tabs.get(t.id) === t) gone(t); });
    // A new tab answers the protocol only once it has a page: a blank one first (a pop-up already has its own).
    const first = adopted ? Promise.resolve() : wc.loadURL('about:blank').catch(() => {});
    t.ready = first.then(() => attach(t)).catch(err => log(`Browser: couldn’t attach to tab ${t.id}: ${err.message}`));
  }
  // The DevTools protocol, for the tools: dialogs and selects kept inside the page, focus as if the tab had it
  // (it never has the system's focus), and the network log.
  // (Sent together: the protocol takes them in order, and a page opened straight away waits for them, t.ready.)
  function attach(t) {
    const d = t.wc.debugger;
    if (!d.isAttached()) d.attach('1.3');
    if (t.attached) return t.ready;
    t.attached = true;
    if (!t.listening) {
      t.listening = true;
      d.on('detach', () => { t.attached = false; });
      d.on('message', (_e, method, p) => cdpEvent(t, method, p));
    }
    const send = (m, p) => d.sendCommand(m, p).catch(err => log(`Browser: ${m} failed (${err.message})`));
    t.ready = Promise.all([
      send('Page.enable'),
      send('Page.addScriptToEvaluateOnNewDocument', { source: DIALOG_SHIM(NONCE), runImmediately: true }),
      send('Page.addScriptToEvaluateOnNewDocument', { source: SELECT_SHIM(NONCE), runImmediately: true }),
      send('Emulation.setFocusEmulationEnabled', { enabled: true }),
      send('Network.enable', { maxTotalBufferSize: 10e6, maxResourceBufferSize: 2e6 }),
    ]).then(() => dialogMode(t, t.dialogMode, t.promptText)).catch(() => {});
    return t.ready;
  }
  // How the page's confirm and prompt boxes are answered, for this page and the ones after it.
  async function dialogMode(t, mode, text = null) {
    t.dialogMode = mode === 'accept' ? 'accept' : 'dismiss';
    t.promptText = typeof text === 'string' ? text.slice(0, 2000) : null;
    const set = `window.__ssDialog = ${JSON.stringify(t.dialogMode)}; window.__ssPrompt = ${JSON.stringify(t.promptText)};`;
    if (t.dialogScript) { await cdp(t, 'Page.removeScriptToEvaluateOnNewDocument', { identifier: t.dialogScript }).catch(() => {}); t.dialogScript = null; }
    if (t.dialogMode === 'accept') t.dialogScript = (await cdp(t, 'Page.addScriptToEvaluateOnNewDocument', { source: set }).catch(() => ({}))).identifier || null;
    await cdp(t, 'Runtime.evaluate', { expression: set }).catch(() => {});
    tabsChanged();
  }
  function shimSaid(t, kind, json) {
    let v = null; try { v = JSON.parse(json); } catch { return; }
    if (!v || typeof v !== 'object') return;
    if (kind === 'dialog') { note(t, `The page showed ${v.type === 'alert' ? 'a message' : `a ${v.type}`}: “${String(v.message).slice(0, 300)}” (answered ${v.answer}).`); toPages('browser:dialog', { id: t.id, ...v }, pp => pp.viewing.has(t.id)); }
    if (kind === 'select') toPages('browser:select', { id: t.id, ...v }, pp => pp.viewing.has(t.id));
  }
  function cdpEvent(t, method, p) {
    switch (method) {
      case 'Network.requestWillBeSent': {
        if (p.type === 'Image' || p.type === 'Font' || p.type === 'Stylesheet' || p.type === 'Media') return;
        const e = { n: (t.netSeq = (t.netSeq || 0) + 1), rid: p.requestId, method: p.request.method, url: p.request.url, type: p.type || '', at: Date.now(), status: null, failed: null, ms: null };
        t.net.push(e); t.netById.set(p.requestId, e);
        if (t.net.length > NET_MAX) { const old = t.net.splice(0, t.net.length - NET_MAX); for (const o of old) t.netById.delete(o.rid); }
        return;
      }
      case 'Network.responseReceived': { const e = t.netById.get(p.requestId); if (e) { e.status = p.response.status; e.mime = p.response.mimeType; e.ms = Date.now() - e.at; } return; }
      case 'Network.loadingFailed': { const e = t.netById.get(p.requestId); if (e) { e.failed = p.errorText || 'failed'; e.ms = Date.now() - e.at; } return; }
      default: return;
    }
  }
  function cdp(t, method, params = {}, ms = 30000) {
    if (t.wc.isDestroyed()) throw new Error('That tab was closed.');
    if (!t.wc.debugger.isAttached()) { t.attached = false; try { attach(t); } catch { /* DevTools has it */ } }
    return within(t.wc.debugger.sendCommand(method, params), ms, method);
  }
  function close(t) { if (t.wc.isDestroyed()) { gone(t); return; } t.win.destroy(); gone(t); }
  function gone(t) {
    if (!tabs.has(t.id)) return;
    clearTimeout(t.frameTimer); clearTimeout(t.rateTimer);
    tabs.delete(t.id);
    if (current.get(t.owner) === t.id) {
      const next = [...tabs.values()].filter(x => x.owner === t.owner).pop();
      if (next) current.set(t.owner, next.id); else current.delete(t.owner);
    }
    tabsChanged();
  }

  // ---------- going places ----------
  function address(raw) {
    let u = String(raw || '').trim();
    if (!u) throw new Error('Give an address to open.');
    if (/^(about:blank)$/i.test(u)) return u;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(u) ? 'http://' : 'https://') + u;
    let p; try { p = new URL(u); } catch { throw new Error(`“${raw}” isn’t an address.`); }
    if (p.protocol !== 'http:' && p.protocol !== 'https:') throw new Error('Only http and https addresses open in the app’s browser.');
    if (blocked(p.href)) throw new Error('That address is the app itself, which isn’t opened in its browser.');
    return p.href;
  }
  // Opens an address, back, forward or reload, and waits for the page (or 30 s; a page still busy after that is fine).
  function go(t, where, ms = 30000) {
    const wc = t.wc, nav = wc.navigationHistory;
    return new Promise((resolve, reject) => {
      let done = false, timer = null;
      const finish = r => {
        if (done) return; done = true; clearTimeout(timer);
        if (wc.isDestroyed()) { resolve({ url: t.url, title: t.title, ok: false, error: 'The tab was closed.' }); return; }
        wc.off('did-finish-load', ok); wc.off('did-fail-load', fail); wc.off('did-navigate-in-page', inPage);
        resolve({ url: wc.getURL(), title: wc.getTitle(), ...r });
      };
      const ok = () => finish({ ok: true });
      const inPage = () => setTimeout(() => finish({ ok: true }), 300);
      const fail = (_e, code, desc, _u, main) => { if (main && code !== -3) finish({ ok: false, error: `${desc} (${code})` }); };
      wc.on('did-finish-load', ok); wc.on('did-fail-load', fail); wc.on('did-navigate-in-page', inPage);
      timer = setTimeout(() => finish({ ok: true, slow: true }), ms);
      try {
        if (where === 'back') { if (!nav.canGoBack()) return finish({ ok: false, error: 'There’s nothing to go back to.' }); nav.goBack(); }
        else if (where === 'forward') { if (!nav.canGoForward()) return finish({ ok: false, error: 'There’s nothing to go forward to.' }); nav.goForward(); }
        else if (where === 'reload') wc.reload();
        else if (where === 'stop') { wc.stop(); finish({ ok: true }); }
        else wc.loadURL(address(where)).catch(() => {});
      } catch (err) { done = true; clearTimeout(timer); wc.off('did-finish-load', ok); wc.off('did-fail-load', fail); wc.off('did-navigate-in-page', inPage); reject(err); }
      return undefined;
    });
  }

  // ---------- size ----------
  async function resize(t, { preset, w, h } = {}) {
    let mobile = false;
    if (preset && SIZES[preset]) { [w, h] = SIZES[preset]; mobile = preset === 'phone' || preset === 'tablet'; }
    else { preset = 'custom'; w = clampInt(w, 320, 2560, t.w); h = clampInt(h, 320, 2560, t.h); }
    t.w = w; t.h = h; t.preset = preset;
    t.win.setContentSize(w, h);
    if (mobile || t.mobile) {
      const chrome = (/Chrome\/([\d.]+)/.exec(t.wc.getUserAgent()) || [])[1] || '152.0.0.0';
      await cdp(t, 'Emulation.setDeviceMetricsOverride', mobile ? { width: w, height: h, deviceScaleFactor: 1, mobile: true } : { width: 0, height: 0, deviceScaleFactor: 0, mobile: false }).catch(() => {});
      await cdp(t, 'Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 }).catch(() => {});
      await cdp(t, 'Emulation.setEmitTouchEventsForMouse', { enabled: mobile, configuration: mobile ? 'mobile' : 'desktop' }).catch(() => {});
      await cdp(t, 'Emulation.setUserAgentOverride', { userAgent: mobile ? MOBILE_UA.replace('{v}', chrome) : cleanUA(t.wc.getUserAgent()) }).catch(() => {});
      if (mobile !== t.mobile) { t.mobile = mobile; t.wc.reload(); }
    }
    t.needFull = true;
    tabsChanged();
    return info(t);
  }

  // ---------- a right-click in a tab: the app's own menu, where you clicked ----------
  function menuFor(t, p) {
    const viewer = [...t.viewers].map(k => pages.get(k)).find(x => x && !x.wc.isDestroyed());
    if (!viewer) return;
    const win = BrowserWindow.fromWebContents(viewer.wc.hostWebContents || viewer.wc);
    if (!win) return;
    const m = new Menu();
    const live = f => () => { if (!t.wc.isDestroyed()) { try { f(); } catch (err) { log(`Browser: ${err.message}`); } } };
    const add = o => m.append(new MenuItem(o.click ? { ...o, click: live(o.click) } : o));
    const wc = t.wc;
    if (p.linkURL) {
      add({ label: 'Open link in a new tab', click: () => { try { create({ owner: t.owner, url: p.linkURL, size: t.preset }); } catch (err) { note(t, err.message); } } });
      add({ label: 'Copy link', click: () => clipboard.writeText(p.linkURL) });
      add({ type: 'separator' });
    }
    if (p.mediaType === 'image' && p.srcURL) { add({ label: 'Copy picture', click: () => wc.copyImageAt(p.x, p.y) }); add({ label: 'Copy picture address', click: () => clipboard.writeText(p.srcURL) }); add({ type: 'separator' }); }
    if (p.isEditable) {
      add({ label: 'Undo', enabled: p.editFlags.canUndo, click: () => wc.undo() }); add({ label: 'Redo', enabled: p.editFlags.canRedo, click: () => wc.redo() }); add({ type: 'separator' });
      add({ label: 'Cut', enabled: p.editFlags.canCut, click: () => wc.cut() }); add({ label: 'Copy', enabled: p.editFlags.canCopy, click: () => wc.copy() }); add({ label: 'Paste', enabled: p.editFlags.canPaste, click: () => wc.paste() });
      add({ label: 'Select all', click: () => wc.selectAll() }); add({ type: 'separator' });
    } else if (p.selectionText && p.selectionText.trim()) { add({ label: 'Copy', click: () => wc.copy() }); add({ type: 'separator' }); }
    add({ label: 'Back', enabled: safe(() => wc.navigationHistory.canGoBack(), false), click: () => go(t, 'back').catch(() => {}) });
    add({ label: 'Forward', enabled: safe(() => wc.navigationHistory.canGoForward(), false), click: () => go(t, 'forward').catch(() => {}) });
    add({ label: 'Reload', click: () => go(t, 'reload').catch(() => {}) });
    add({ type: 'separator' });
    add({ label: 'Copy page address', click: () => clipboard.writeText(wc.getURL()) });
    add({ label: 'Inspect', click: () => { try { wc.openDevTools({ mode: 'detach' }); } catch (err) { log(`Browser: ${err.message}`); } } });
    m.popup({ window: win });
  }

  // ---------- what the page sends: your mouse and keys ----------
  const MOUSE = new Set(['mouseDown', 'mouseUp', 'mouseMove', 'mouseEnter', 'mouseLeave', 'mouseWheel']);
  const KEYS = new Set(['keyDown', 'keyUp', 'char']);
  const MODS = new Set(['shift', 'control', 'ctrl', 'alt', 'meta', 'cmd', 'isAutoRepeat', 'leftButtonDown', 'middleButtonDown', 'rightButtonDown', 'capsLock', 'numLock']);
  function input(id, ev) {
    const t = tabs.get(id);
    if (!t || t.wc.isDestroyed() || !ev || typeof ev !== 'object') return;
    const mods = Array.isArray(ev.modifiers) ? ev.modifiers.filter(m => MODS.has(m)).slice(0, 6) : [];
    if (MOUSE.has(ev.type)) {
      const e = { type: ev.type, x: clampInt(ev.x, -10, t.w + 10, 0), y: clampInt(ev.y, -10, t.h + 10, 0), modifiers: mods };
      if (ev.type === 'mouseDown' || ev.type === 'mouseUp') { e.button = ['left', 'middle', 'right'].includes(ev.button) ? ev.button : 'left'; e.clickCount = clampInt(ev.clickCount, 1, 3, 1); }
      if (ev.type === 'mouseWheel') { e.deltaX = clampInt(ev.deltaX, -5000, 5000, 0); e.deltaY = clampInt(ev.deltaY, -5000, 5000, 0); e.canScroll = true; }
      t.wc.sendInputEvent(e);
      return;
    }
    if (KEYS.has(ev.type) && typeof ev.keyCode === 'string' && ev.keyCode.length && ev.keyCode.length <= 24) t.wc.sendInputEvent({ type: ev.type, keyCode: ev.keyCode, modifiers: mods });
  }

  // ---------- what the page asks ----------
  // The app's pages: everything but driving a tab with scripts (that's the chats' tools, through the server).
  async function forPage(wc, op, a = {}) {
    const p = listen(wc);
    switch (op) {
      case 'list': return list();
      case 'create': return create({ owner: a.owner, url: a.url, size: a.size });
      case 'close': close(get(a.id)); return true;
      case 'navigate': { const t = get(a.id); go(t, a.where).catch(err => note(t, err.message)); return true; }
      case 'resize': return resize(get(a.id), a);
      case 'mute': { const t = get(a.id); t.wc.setAudioMuted(!!a.muted); tabsChanged(); return true; }
      case 'dialogs': await dialogMode(get(a.id), a.mode); return true;
      case 'current': { const t = get(a.id); current.set(t.owner, t.id); tabsChanged(); return true; }
      case 'move': { const t = get(a.id); if (!OWNER.test(String(a.owner))) throw new Error('No such chat.'); if (current.get(t.owner) === t.id) current.delete(t.owner); t.owner = String(a.owner); current.set(t.owner, t.id); tabsChanged(); return true; }
      case 'view': {
        const t = get(a.id);
        p.viewing.add(t.id); t.viewers.add(wc.id); t.lastViewed = Date.now(); rate(t);
        await fullFrame(t);
        return info(t);
      }
      case 'unview': { const t = tabs.get(a.id); p.viewing.delete(a.id); unwatch(t, wc.id); return true; }
      case 'refresh': { const t = get(a.id); await fullFrame(t); return true; }
      case 'edit': {
        const t = get(a.id), f = { copy: 'copy', cut: 'cut', paste: 'paste', selectAll: 'selectAll', undo: 'undo', redo: 'redo' }[a.what];
        if (f) t.wc[f]();
        return true;
      }
      case 'select': {
        const t = get(a.id), i = clampInt(a.index, -1, 10000, -1);
        await cdp(t, 'Runtime.evaluate', { expression: `(() => { const s = window.__ssSel; if (!s || !s.isConnected) return false; if (${i} >= 0) { s.selectedIndex = ${i}; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); } window.__ssSel = null; return true; })()`, returnByValue: true });
        return true;
      }
      case 'devtools': { const t = get(a.id); t.wc.openDevTools({ mode: 'detach' }); return true; }
      default: throw new Error(`The browser can’t ${op}.`);
    }
  }

  // The server (the chats' tools, lib/browser.js): the page's ops, plus driving a tab.
  async function forServer(op, a = {}) {
    switch (op) {
      case 'list': return list(a.owner);
      case 'create': return create({ owner: a.owner, url: a.url, size: a.size });
      case 'close': close(get(a.id)); return true;
      case 'current': {
        if (a.id) { const t = get(a.id); if (a.owner && t.owner !== a.owner) throw new Error(`Tab ${t.id} belongs to another chat.`); current.set(t.owner, t.id); tabsChanged(); return info(t); }
        const id = current.get(a.owner); const t = id && tabs.get(id);
        return t ? info(t) : null;
      }
      case 'navigate': { const t = get(a.id); t.lastAgent = Date.now(); rate(t); await t.ready; const r = await go(t, a.where, clampInt(a.timeout, 1000, 60000, 30000)); tabsChanged(); return r; }
      case 'resize': return resize(get(a.id), a);
      case 'capture': {
        const t = get(a.id);
        let img = await within(t.wc.capturePage(a.clip && a.clip.width > 0 ? { x: clampInt(a.clip.x, 0, t.w, 0), y: clampInt(a.clip.y, 0, t.h, 0), width: clampInt(a.clip.width, 1, t.w, t.w), height: clampInt(a.clip.height, 1, t.h, t.h) } : undefined), 10000, 'A picture of the page');
        const s = img.getSize();
        if (!s.width) throw new Error('The page hasn’t drawn anything yet.');
        const want = clampInt(a.width, 100, 2560, s.width);
        if (want !== s.width) img = img.resize({ width: want, quality: 'good' });
        const out = img.getSize();
        return { data: img.toJPEG(clampInt(a.quality, 30, 95, 75)).toString('base64'), width: out.width, height: out.height, viewport: { w: t.w, h: t.h } };
      }
      case 'cdp': { const t = get(a.id); if (a.agent !== false) { t.lastAgent = Date.now(); rate(t); } return cdp(t, String(a.method), a.params || {}, clampInt(a.timeout, 500, 120000, 30000)); }
      case 'isolated': {
        // A script in a world of its own (the page's scripts can't see or change it), kept between calls.
        const t = get(a.id);
        return within(t.wc.executeJavaScriptInIsolatedWorld(4242, [{ code: String(a.code) }], !!a.gesture), clampInt(a.timeout, 500, 120000, 20000), 'The script');
      }
      case 'logs': {
        const t = get(a.id);
        const pick = a.kind === 'network' ? t.net : a.kind === 'notes' ? t.notes : t.logs;
        const outl = pick.filter(e => !a.since || e.at > a.since).map(e => ({ ...e }));
        if (a.clear) pick.length = 0;
        return outl;
      }
      case 'body': { const t = get(a.id); return cdp(t, 'Network.getResponseBody', { requestId: String(a.rid) }, 10000); }
      case 'activity': {
        const t = get(a.id); t.lastAgent = Date.now(); rate(t);
        toPages('browser:activity', { id: t.id, owner: t.owner, kind: String(a.kind || ''), x: a.x, y: a.y, label: String(a.label || '').slice(0, 200), at: Date.now() });
        tabsChanged();
        return true;
      }
      case 'dialogs': await dialogMode(get(a.id), a.mode, a.text); return true;
      case 'mute': { const t = get(a.id); t.wc.setAudioMuted(!!a.muted); tabsChanged(); return true; }
      case 'show': { toPages('browser:show', { id: a.id ? get(a.id).id : null, owner: a.owner || null }); return true; }
      case 'closeOwner': { for (const t of [...tabs.values()]) if (t.owner === a.owner) close(t); return true; }
      default: throw new Error(`The browser can’t ${op}.`);
    }
  }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const t of [...tabs.values()]) {
      if (t.viewers.size || now - Math.max(t.created, t.lastAgent || 0, t.lastViewed || 0) < IDLE_CLOSE) continue;
      log(`Browser: closing ${t.id} (${t.url}), unused for ${Math.round(IDLE_CLOSE / 60e3)} minutes.`);
      close(t);
    }
  }, 5 * 60e3);
  if (sweep.unref) sweep.unref();
  function stop() { clearInterval(sweep); for (const t of [...tabs.values()]) { try { t.win.destroy(); } catch { /* gone */ } } tabs.clear(); }
  return { forPage, forServer, input, stop, list, PARTITION, SIZES };
}

module.exports = { createBrowserHost, cleanUA, PARTITION, SIZES };
