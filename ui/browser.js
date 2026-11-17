'use strict';
/* The built-in browser, beside the chat. Its tabs are the desktop app's (desktop/shell/browser.js): they draw off
   screen and this shows the open chat's tabs as a live picture, sending your mouse and keys back, so you can watch
   Claude or Codex use a site and take over at any time (sign in, click around, type). A chat's tabs belong to it,
   and they're its tools' "current tab": the one you pick here is the one it uses next.
   Desktop app only (window.desktop.browser); elsewhere the button isn't there. */

const BR = (window.desktop && window.desktop.browser) || null;
const Browser = { pane: null, box: null, tabs: [], tabId: null, owner: null, gen: 0, chain: Promise.resolve(), fw: 0, fh: 0, closed: new Set(), autoOpened: new Set(), pressed: 0 };
window.Browser = Browser;
const BR_SIZES = [['desktop', 'Desktop', '1280 × 800'], ['laptop', 'Laptop', '1440 × 900'], ['wide', 'Wide', '1920 × 1080'], ['tablet', 'Tablet', '820 × 1180, touch'], ['phone', 'Phone', '390 × 844, touch']];
const BR_CURSOR = { hand: 'pointer', ibeam: 'text', 'vertical-text': 'vertical-text', crosshair: 'crosshair', wait: 'wait', progress: 'progress', help: 'help', 'not-allowed': 'not-allowed', 'no-drop': 'no-drop', grab: 'grab', grabbing: 'grabbing', move: 'move', 'east-resize': 'e-resize', 'west-resize': 'w-resize', 'north-resize': 'n-resize', 'south-resize': 's-resize', 'north-east-resize': 'ne-resize', 'north-west-resize': 'nw-resize', 'south-east-resize': 'se-resize', 'south-west-resize': 'sw-resize', 'ns-resize': 'ns-resize', 'ew-resize': 'ew-resize', 'nesw-resize': 'nesw-resize', 'nwse-resize': 'nwse-resize', 'col-resize': 'col-resize', 'row-resize': 'row-resize', 'context-menu': 'context-menu', 'zoom-in': 'zoom-in', 'zoom-out': 'zoom-out', none: 'none', copy: 'copy', alias: 'alias', cell: 'cell', 'all-scroll': 'all-scroll' };
// DOM key names → the names the desktop app's input takes.
const BR_KEY = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ' ': 'Space', Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Shift: 'Shift', Control: 'Control', Alt: 'Alt', Meta: 'Meta', CapsLock: 'CapsLock', ContextMenu: 'Apps' };
for (let i = 1; i <= 12; i++) BR_KEY[`F${i}`] = `F${i}`;

const brCan = () => !!BR && !window.REMOTE && !window.Android && !PANE;
const brOwnerNow = () => {
  if (!window.ChatUI || !ChatUI.isOpen()) return null;
  const s = ChatUI.sessionId();
  return s ? String(s).toLowerCase() : ChatUI.key() ? `key:${ChatUI.key()}` : null;
};
const brWho = () => (typeof C !== 'undefined' && C.provider === 'codex' ? 'Codex' : 'Claude');
const brMine = () => Browser.tabs.filter(t => t.owner === Browser.owner);
const brTab = () => Browser.tabs.find(t => t.id === Browser.tabId) || null;
const brCall = (op, args = {}) => BR.call(op, args).catch(err => { toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 6000, null, { tone: 'error' }); throw err; });
const brHost = u => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };

// ---------- the pane ----------
function brPaneHtml() {
  return `<div class="cb-tabs" role="tablist" aria-label="This chat’s tabs"></div>
    <form class="cb-bar" autocomplete="off">
      <button type="button" class="icon" data-br="back" aria-label="Back" title="Back">←</button>
      <button type="button" class="icon" data-br="forward" aria-label="Forward" title="Forward">→</button>
      <button type="button" class="icon" data-br="reload" aria-label="Reload" title="Reload">↻</button>
      <label class="sr" for="cbUrl">Address</label><input id="cbUrl" class="cb-url" spellcheck="false" placeholder="Type an address, like voyage.io">
      <button type="button" class="btn quiet sm cb-size" data-br="size" aria-haspopup="menu" aria-expanded="false" title="Page size">Desktop</button>
      <button type="button" class="icon" data-br="more" aria-haspopup="menu" aria-expanded="false" aria-label="More browser actions" title="More">⋯</button>
      <button type="button" class="icon" data-br="close" aria-label="Close the browser" title="Close the browser (the tabs stay open)">✕</button>
    </form>
    <div class="cb-act" role="status" aria-live="polite" hidden></div>
    <div class="cb-view">
      <canvas class="cb-canvas" tabindex="0" aria-label="The page. Click it to use it; keys you press go to it. Ctrl+L goes to the address bar." hidden></canvas>
      <div class="cb-ripple" aria-hidden="true"></div>
      <div class="cb-pick" role="listbox" hidden></div>
      <div class="cb-empty"></div>
    </div>`;
}
function brOpen({ quiet = false } = {}) {
  if (!brCan()) return;
  const owner = brOwnerNow();
  if (!owner) { if (!quiet) toast('Open a chat first: the browser’s tabs belong to a chat.', 3500); return; }
  if (Browser.pane && Browser.box.isConnected) { if (!quiet) Browser.box.querySelector('.cb-url').focus(); return; }
  Browser.closed.delete(owner);
  const box = document.createElement('div');
  box.className = 'c-browser';
  box.innerHTML = brPaneHtml();
  Browser.box = box;
  const float = !(window.Split && Split.can());
  if (float) {
    // No room beside the chat (a narrow window, a chat popped out): over it, with the same close button.
    box.classList.add('float');
    $('chat').appendChild(box);
    Browser.pane = { float: true, frame: box };
  } else {
    $('chat').classList.remove('show-ledger');
    const pane = { id: `b${Date.now().toString(36)}`, key: null, sessionId: null, title: 'Browser', browser: true, frame: box };
    if (Split.panes.length >= Split.max()) closePane(Split.panes[Split.panes.length - 1], true);
    Split.panes.push(pane);
    $('cSplit').appendChild(box);
    splitSync(); splitSave();
    Browser.pane = pane;
  }
  try { sessionStorage.setItem('browserPane', '1'); } catch { /* fine */ }
  brWire(box);
  Browser.owner = owner;
  brTabsChanged(Browser.tabs, true);
  brSyncButton();
  if (!quiet) announce('The browser opened beside the chat.');
}
function brClose({ byUser = true } = {}) {
  if (!Browser.pane) return;
  const { pane, box } = Browser;
  brShow(null);
  Browser.pane = null; Browser.box = null;
  if (pane.float) box.remove(); else closePane(pane, true);
  if (byUser && Browser.owner) Browser.closed.add(Browser.owner);
  if (byUser) { try { sessionStorage.removeItem('browserPane'); } catch { /* fine */ } }
  brSyncButton();
}
const brIsOpen = () => !!(Browser.pane && Browser.box && Browser.box.isConnected);

// The tab shown: its frames come here, your input goes to it.
function brShow(id) {
  const was = Browser.tabId;
  if (was && was !== id) BR.call('unview', { id: was }).catch(() => {});
  Browser.tabId = id;
  Browser.gen++;
  const cv = Browser.box && Browser.box.querySelector('.cb-canvas');
  if (!cv) return;
  cv.hidden = !id;
  if (!id) return;
  if (was !== id) { Browser.fw = 0; Browser.fh = 0; }
  BR.call('view', { id }).then(() => { if (id !== Browser.tabId) BR.call('unview', { id }).catch(() => {}); }).catch(() => {});
}

// ---------- what the desktop app says ----------
function brTabsChanged(list, force = false) {
  Browser.tabs = Array.isArray(list) ? list : [];
  brSyncButton();
  if (!brIsOpen()) return;
  const mine = brMine();
  const cur = mine.find(t => t.current) || mine[mine.length - 1] || null;
  if (force || !cur || cur.id !== Browser.tabId) brShow(cur ? cur.id : null);
  brRender();
}
function brRender() {
  const box = Browser.box; if (!box) return;
  const mine = brMine(), t = brTab();
  const now = Date.now();
  box.querySelector('.cb-tabs').innerHTML = `${mine.map(x => `<div class="cb-tab${x.id === Browser.tabId ? ' on' : ''}${now - (x.lastAgent || 0) < 8000 ? ' busy' : ''}" role="tab" aria-selected="${x.id === Browser.tabId}" data-tab="${esc(x.id)}" title="${esc(`${x.title || 'Untitled'}\n${x.url || ''}`)}">
      <span class="cb-dot${x.loading ? ' loading' : ''}" aria-hidden="true"></span><span class="cb-tt">${esc(x.title || brHost(x.url) || 'New tab')}</span>${x.audible && !x.muted ? '<span class="cb-snd" title="Playing sound">♪</span>' : ''}
      <button type="button" class="cb-x" data-br="closetab" data-tab="${esc(x.id)}" aria-label="Close ${esc(x.title || 'this tab')}">×</button></div>`).join('')}
    <button type="button" class="cb-new" data-br="new" aria-label="New tab" title="New tab">+</button>`;
  const url = box.querySelector('.cb-url');
  if (document.activeElement !== url) url.value = t ? (t.url === 'about:blank' ? '' : t.url) : '';
  box.querySelector('[data-br="back"]').disabled = !(t && t.canBack);
  box.querySelector('[data-br="forward"]').disabled = !(t && t.canForward);
  box.querySelector('[data-br="reload"]').disabled = !t;
  const sz = box.querySelector('.cb-size');
  sz.textContent = t ? (BR_SIZES.find(s => s[0] === t.size.preset) || [0, `${t.size.w} × ${t.size.h}`])[1] : 'Desktop';
  sz.disabled = !t;
  const empty = box.querySelector('.cb-empty');
  empty.hidden = !!t;
  if (!t) {
    empty.innerHTML = `<p class="cb-eh">No pages open in this chat</p>
      <p>Type an address above, or ask ${esc(brWho())} to open one. It can see and use these tabs, and so can you. Sign-ins you make here are kept for every chat, apart from your Chrome.</p>
      <div class="cb-quick">${[['https://voyage.io', 'Voyage'], ['https://play.aidungeon.com', 'AI Dungeon']].map(([u, l]) => `<button type="button" class="btn sm" data-br="go" data-url="${esc(u)}">${esc(l)}</button>`).join('')}</div>`;
  }
  if (t && t.crashed) brNote('The page stopped. Reload it.', 0);
  brSyncButton();
}
function brNote(text, ms = 6000) {
  const el = Browser.box && Browser.box.querySelector('.cb-act'); if (!el) return;
  el.hidden = !text; el.textContent = text || '';
  clearTimeout(el._t);
  if (text && ms) el._t = setTimeout(() => { el.hidden = true; }, ms);
}
function brFrame(f) {
  if (!Browser.box || f.id !== Browser.tabId) return;
  const gen = Browser.gen;
  Browser.chain = Browser.chain.then(async () => {
    if (gen !== Browser.gen || !Browser.box) return;
    const cv = Browser.box.querySelector('.cb-canvas');
    if (f.fw !== cv.width || f.fh !== cv.height) {
      if (!f.full) { BR.call('refresh', { id: f.id }).catch(() => {}); return; }
      cv.width = f.fw; cv.height = f.fh; Browser.fw = f.fw; Browser.fh = f.fh; brFit();
    }
    const bmp = await createImageBitmap(new Blob([f.data], { type: 'image/jpeg' }));
    if (gen === Browser.gen) cv.getContext('2d').drawImage(bmp, f.x, f.y);
    bmp.close();
  }).catch(() => {});
}
// The page fits the pane: shown smaller when there isn't room, never bigger than it is.
function brFit() {
  const box = Browser.box; if (!box || !Browser.fw) return;
  const view = box.querySelector('.cb-view'), cv = box.querySelector('.cb-canvas');
  const w = view.clientWidth - 12, h = view.clientHeight - 12;
  if (w <= 0 || h <= 0) return;
  const s = Math.min(1, w / Browser.fw, h / Browser.fh);
  cv.style.width = `${Math.floor(Browser.fw * s)}px`; cv.style.height = `${Math.floor(Browser.fh * s)}px`;
}
// What the chat's assistant just did in its tab: a ring where it clicked, and a line saying what.
function brActivity(a) {
  const mine = Browser.tabs.find(t => t.id === a.id);
  const owner = mine ? mine.owner : a.owner;
  if (owner !== brOwnerNow()) return;
  if (!brIsOpen() && !Browser.closed.has(owner) && window.Split && (Split.can() ? !Split.panes.length : true) && !Browser.autoOpened.has(owner)) {
    Browser.autoOpened.add(owner);
    brOpen({ quiet: true });
    toast(`${brWho()} is using the browser: it’s beside the chat. You can use it too.`, 4500);
  }
  brSyncButton(true);
  if (!brIsOpen()) return;
  if (a.id !== Browser.tabId) { brShow(a.id); brRender(); }
  brNote(`${brWho()}: ${a.label || a.kind}`, 8000);
  if (Number.isFinite(a.x) && Number.isFinite(a.y) && Browser.fw) {
    const cv = Browser.box.querySelector('.cb-canvas'), r = cv.getBoundingClientRect(), v = Browser.box.querySelector('.cb-view').getBoundingClientRect();
    const ring = Browser.box.querySelector('.cb-ripple');
    ring.style.left = `${r.left - v.left + (a.x * r.width) / Browser.fw}px`; ring.style.top = `${r.top - v.top + (a.y * r.height) / Browser.fh}px`;
    ring.classList.remove('go'); void ring.offsetWidth; ring.classList.add('go');
  }
}
// A <select> on the page: its list, drawn here (native ones don't draw off screen).
function brSelect(s) {
  if (!Browser.box || s.id !== Browser.tabId || Date.now() - Browser.pressed > 1500) return;
  const pick = Browser.box.querySelector('.cb-pick'), cv = Browser.box.querySelector('.cb-canvas');
  const r = cv.getBoundingClientRect(), v = Browser.box.querySelector('.cb-view').getBoundingClientRect(), k = r.width / Browser.fw;
  pick.style.left = `${r.left - v.left + s.x * k}px`; pick.style.top = `${r.top - v.top + (s.y + s.h) * k}px`; pick.style.minWidth = `${Math.max(120, s.w * k)}px`;
  pick.innerHTML = s.options.map((o, i) => `${o.group && (i === 0 || s.options[i - 1].group !== o.group) ? `<div class="cb-pg">${esc(o.group)}</div>` : ''}<button type="button" role="option" data-i="${i}"${o.disabled ? ' disabled' : ''} aria-selected="${i === s.selected}" class="${i === s.selected ? 'on' : ''}">${esc(o.label)}</button>`).join('');
  pick.hidden = false;
  const sel = pick.querySelector('.on') || pick.querySelector('button:not([disabled])');
  if (sel) sel.focus();
  pick._id = s.id;
}
function brPickDone(i) {
  const pick = Browser.box && Browser.box.querySelector('.cb-pick'); if (!pick || pick.hidden) return;
  pick.hidden = true;
  BR.call('select', { id: pick._id, index: i }).catch(() => {});
  Browser.box.querySelector('.cb-canvas').focus({ preventScroll: true });
}

// ---------- you, using it ----------
function brWire(box) {
  const cv = box.querySelector('.cb-canvas'), view = box.querySelector('.cb-view');
  new ResizeObserver(brFit).observe(view);
  const at = e => { const r = cv.getBoundingClientRect(); return { x: Math.round(((e.clientX - r.left) * cv.width) / r.width), y: Math.round(((e.clientY - r.top) * cv.height) / r.height) }; };
  const mods = e => [e.shiftKey && 'shift', e.ctrlKey && 'control', e.altKey && 'alt', e.metaKey && 'meta'].filter(Boolean);
  const BTN = ['left', 'middle', 'right'];
  let moveQ = null, down = 0;
  const send = ev => { if (Browser.tabId) BR.input(Browser.tabId, ev); };
  cv.addEventListener('pointermove', e => {
    if (!Browser.tabId) return;
    const was = !!moveQ;
    moveQ = { type: 'mouseMove', ...at(e), modifiers: [...mods(e), ...(down & 1 ? ['leftButtonDown'] : []), ...(down & 4 ? ['rightButtonDown'] : [])] };
    if (!was) requestAnimationFrame(() => { if (moveQ) send(moveQ); moveQ = null; });
  });
  cv.addEventListener('pointerdown', e => {
    if (!Browser.tabId) return;
    e.preventDefault();
    cv.focus({ preventScroll: true });
    cv.setPointerCapture(e.pointerId);
    Browser.pressed = Date.now();
    down |= 1 << e.button;
    send({ type: 'mouseDown', ...at(e), button: BTN[e.button] || 'left', clickCount: Math.min(3, e.detail || 1), modifiers: mods(e) });
    // What you pick here is the tab the chat's tools use next.
    const t = brTab(); if (t && !t.current) BR.call('current', { id: t.id }).catch(() => {});
  });
  const up = e => {
    if (!(down & (1 << e.button))) return;
    down &= ~(1 << e.button);
    send({ type: 'mouseUp', ...at(e), button: BTN[e.button] || 'left', clickCount: Math.min(3, e.detail || 1), modifiers: mods(e) });
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', e => { if (!down) send({ type: 'mouseLeave', ...at(e) }); });
  cv.addEventListener('contextmenu', e => e.preventDefault());   // the page's own menu comes from the app, where you clicked
  cv.addEventListener('wheel', e => {
    if (!Browser.tabId) return;
    e.preventDefault();
    const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1;
    send({ type: 'mouseWheel', ...at(e), deltaX: -Math.round(e.deltaX * k), deltaY: -Math.round(e.deltaY * k), modifiers: mods(e) });
  }, { passive: false });
  cv.addEventListener('keydown', e => {
    if (!Browser.tabId || e.isComposing) return;
    const altGr = !!(e.getModifierState && e.getModifierState('AltGraph'));
    const c = (e.ctrlKey || e.metaKey) && !altGr;
    // The address bar, as in any browser (and the way out of the page with the keyboard).
    if ((c && !e.altKey && e.key.toLowerCase() === 'l') || (e.altKey && !c && e.key.toLowerCase() === 'd') || e.key === 'F6') {
      e.preventDefault(); const u = box.querySelector('.cb-url'); u.focus(); u.select(); return;
    }
    // Copy, paste and the like: done by the page itself, with your clipboard.
    const edit = c && !e.altKey ? { c: 'copy', v: 'paste', x: 'cut', a: 'selectAll', z: e.shiftKey ? 'redo' : 'undo', y: 'redo' }[e.key.toLowerCase()] : null;
    e.preventDefault(); e.stopPropagation();
    if (edit) { BR.call('edit', { id: Browser.tabId, what: edit }).catch(() => {}); return; }
    const code = BR_KEY[e.key] || (e.key.length === 1 ? e.key : null);
    if (!code) return;
    send({ type: 'keyDown', keyCode: code, modifiers: mods(e) });
    if (e.key.length === 1 && !c && (!e.altKey || altGr)) send({ type: 'char', keyCode: e.key, modifiers: altGr ? [] : mods(e) });
    else if (e.key === 'Enter') send({ type: 'char', keyCode: '\r', modifiers: mods(e) });
  });
  cv.addEventListener('keyup', e => {
    if (!Browser.tabId) return;
    const code = BR_KEY[e.key] || (e.key.length === 1 ? e.key : null);
    e.preventDefault(); e.stopPropagation();
    if (code) send({ type: 'keyUp', keyCode: code, modifiers: mods(e) });
  });
  // Text pasted in by the system (a paste from the context menu goes through the page): nothing else to do.
  box.querySelector('form').addEventListener('submit', e => {
    e.preventDefault();
    const u = box.querySelector('.cb-url').value.trim();
    if (u) brGo(u);
  });
  box.addEventListener('click', e => {
    const tabEl = e.target.closest('.cb-tab');
    const b = e.target.closest('[data-br]');
    if (b && b.dataset.br === 'closetab') { e.stopPropagation(); brCall('close', { id: b.dataset.tab }).catch(() => {}); return; }
    if (tabEl && !b) { BR.call('current', { id: tabEl.dataset.tab }).catch(() => {}); brShow(tabEl.dataset.tab); brRender(); return; }
    if (!b) return;
    const t = brTab();
    switch (b.dataset.br) {
      case 'back': case 'forward': case 'reload': if (t) brCall('navigate', { id: t.id, where: b.dataset.br }).catch(() => {}); break;
      case 'close': brClose(); break;
      case 'new': brCall('create', { owner: Browser.owner }).then(n => { brShow(n.id); brRender(); box.querySelector('.cb-url').focus(); }).catch(() => {}); break;
      case 'go': brGo(b.dataset.url); break;
      case 'size': brSizeMenu(b); break;
      case 'more': brMoreMenu(b); break;
      default: break;
    }
  });
  const pick = box.querySelector('.cb-pick');
  pick.addEventListener('click', e => { const o = e.target.closest('[data-i]'); if (o) brPickDone(Number(o.dataset.i)); });
  pick.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); brPickDone(-1); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const all = [...pick.querySelectorAll('button:not([disabled])')], i = all.indexOf(document.activeElement);
      const n = all[Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]; if (n) n.focus();
    }
  });
  pick.addEventListener('focusout', () => setTimeout(() => { if (!pick.hidden && !pick.contains(document.activeElement)) brPickDone(-1); }, 0));
}
async function brGo(raw) {
  const t = brTab();
  try {
    if (t) await brCall('navigate', { id: t.id, where: raw });
    else { const n = await brCall('create', { owner: Browser.owner, url: raw }); brShow(n.id); }
    if (Browser.box) Browser.box.querySelector('.cb-canvas').focus({ preventScroll: true });
  } catch { /* said */ }
}
function brSizeMenu(anchor) {
  const t = brTab(); if (!t) return;
  showMenu(anchor, BR_SIZES.map(([k, l, h]) => ({ glyph: t.size.preset === k ? '✓' : '', label: l, hint: h, run: () => brCall('resize', { id: t.id, preset: k }).then(() => { Browser.fw = 0; }).catch(() => {}) })));
}
function brMoreMenu(anchor) {
  const t = brTab();
  const others = Browser.tabs.filter(x => x.owner !== Browser.owner);
  showMenu(anchor, [
    ...(t ? [
      { glyph: t.muted ? '♪' : '∅', label: t.muted ? 'Unmute this tab' : 'Mute this tab', run: () => brCall('mute', { id: t.id, muted: !t.muted }).catch(() => {}) },
      { glyph: t.dialogs === 'accept' ? '✓' : '', label: 'Answer the page’s boxes with OK', hint: t.dialogs === 'accept' ? 'on: confirm and prompt boxes get OK' : 'off: they get Cancel', run: () => brCall('dialogs', { id: t.id, mode: t.dialogs === 'accept' ? 'dismiss' : 'accept' }).catch(() => {}) },
      { glyph: '⧉', label: 'Copy the address', run: () => navigator.clipboard.writeText(t.url).then(() => toast('Copied.', 1500)).catch(() => {}) },
      { glyph: '↗', label: 'Open in your own browser', run: () => window.open(t.url, '_blank', 'noopener') },
      { glyph: '⚙', label: 'Developer tools', hint: 'for this tab', run: () => brCall('devtools', { id: t.id }).catch(() => {}) },
      '-',
    ] : []),
    ...(brMine().length ? [{ glyph: '✕', label: 'Close all of this chat’s tabs', run: () => Promise.all(brMine().map(x => BR.call('close', { id: x.id }))).catch(() => {}) }] : []),
    ...(others.length ? ['-', ...others.slice(0, 8).map(x => ({ glyph: '⇥', label: `Bring here: ${x.title || brHost(x.url) || 'a tab'}`, hint: `another chat’s tab · ${brHost(x.url)}`, run: () => brCall('move', { id: x.id, owner: Browser.owner }).catch(() => {}) }))] : []),
  ]);
}

// ---------- the header button ----------
function brSyncButton(active = false) {
  const btn = document.getElementById('cBrowserBtn'); if (!btn) return;
  const owner = brOwnerNow();
  btn.hidden = !brCan() || !owner || (typeof C !== 'undefined' && (C.watch || C.provider === 'gemini'));
  const n = owner ? Browser.tabs.filter(t => t.owner === owner).length : 0;
  btn.classList.toggle('has', n > 0);
  btn.setAttribute('aria-pressed', String(brIsOpen()));
  btn.title = brIsOpen() ? 'Hide the browser (its tabs stay open)' : n ? `The browser: this chat has ${n} tab${n === 1 ? '' : 's'}` : 'The built-in browser: pages this chat (and you) can use';
  const busy = owner && Browser.tabs.some(t => t.owner === owner && Date.now() - (t.lastAgent || 0) < 8000);
  btn.classList.toggle('busy', !!busy || active);
}

(function startBrowser() {
  if (!brCan()) return;
  const head = document.querySelector('#chat .c-icons');
  if (head && !document.getElementById('cBrowserBtn')) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'icon c-browserbtn'; b.id = 'cBrowserBtn'; b.hidden = true; b.setAttribute('aria-label', 'Browser');
    b.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><rect x="2" y="3" width="14" height="12" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2 6.5h14" stroke="currentColor" stroke-width="1.5"/><circle cx="4.3" cy="4.8" r=".6" fill="currentColor"/><circle cx="6.2" cy="4.8" r=".6" fill="currentColor"/></svg><span class="cb-badge" aria-hidden="true"></span>';
    b.addEventListener('click', () => (brIsOpen() ? brClose() : brOpen()));
    const split = head.querySelector('.c-splitbtn');
    head.insertBefore(b, split || head.firstChild);
  }
  BR.on('tabs', list => brTabsChanged(list));
  BR.on('frame', brFrame);
  BR.on('cursor', c => { if (Browser.box && c.id === Browser.tabId) Browser.box.querySelector('.cb-canvas').style.cursor = BR_CURSOR[c.cursor] || 'default'; });
  BR.on('activity', brActivity);
  BR.on('select', brSelect);
  BR.on('dialog', d => { if (Browser.box && d.id === Browser.tabId) brNote(`The page said: “${String(d.message).slice(0, 200)}” (answered ${d.answer}).`, 9000); });
  BR.on('show', s => { if (!s.owner || s.owner === brOwnerNow()) { brOpen({ quiet: true }); if (s.id) { BR.call('current', { id: s.id }).catch(() => {}); brShow(s.id); brRender(); } } });
  BR.call('list').then(l => brTabsChanged(l)).catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (!Browser.tabId) return;
    if (document.hidden) BR.call('unview', { id: Browser.tabId }).catch(() => {});
    else if (brIsOpen()) brShow(Browser.tabId);
  });
  // The chat in view changes (another chat opened, a new one got its id): the pane follows it.
  let shownFor = null, busyWas = '';
  setInterval(() => {
    const owner = brOwnerNow();
    if (Browser.pane && !Browser.box.isConnected) { brShow(null); Browser.pane = null; Browser.box = null; brSyncButton(); }   // closed from the split menu
    if (owner === shownFor) {
      // A tab's "in use" dot goes out a few seconds after the chat's last step: drawn again only then.
      const busy = Browser.tabs.filter(t => Date.now() - (t.lastAgent || 0) < 8000).map(t => t.id).join(',');
      if (busy !== busyWas) { busyWas = busy; if (Browser.pane) brRender(); else brSyncButton(); }
      return;
    }
    // A new chat's tabs were made before it had its id: they move to it.
    if (shownFor && shownFor === `key:${ChatUI.key()}` && owner && !owner.startsWith('key:')) for (const t of Browser.tabs.filter(x => x.owner === shownFor)) BR.call('move', { id: t.id, owner }).catch(() => {});
    shownFor = owner;
    Browser.owner = owner;
    if (brIsOpen()) { if (!owner) brClose({ byUser: false }); else brTabsChanged(Browser.tabs, true); }
    else if (owner) { let again = false; try { again = sessionStorage.getItem('browserPane') === '1'; } catch { /* fine */ } if (again && Browser.tabs.some(t => t.owner === owner) && !Browser.closed.has(owner)) brOpen({ quiet: true }); }
    brSyncButton();
  }, 600);
}());
