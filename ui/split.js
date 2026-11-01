'use strict';
/* Split view: another chat beside the one you're in, in the same window, with all it can do. Each side
   is the whole chat (a frame of the page a popped-out chat has), so its message box, pictures, approvals
   and ledger all work. One beside it, or two on a wide screen. Open from a chat's right-click menu, the
   ◫ button in a chat's header, or Ctrl+click in the side list. They stay while you go back to the hub. */

const Split = {
  panes: [],   // { id, key, sessionId, title, frame }
  max: () => (window.innerWidth / uiScale() >= 1900 ? 2 : 1),
  can: () => !window.REMOTE && !window.Android && !SOLO && window.innerWidth / uiScale() >= 1100,
  // Is this chat showing in a frame right now?
  shows(x) {
    if (!x || !$('chat') || $('chat').hidden) return false;
    return Split.panes.some(p => (x.key && p.key === x.key) || (x.sessionId && p.sessionId && p.sessionId.toLowerCase() === String(x.sessionId).toLowerCase()));
  },
};
window.Split = Split;

const splitSave = () => { try { sessionStorage.setItem('split', JSON.stringify(Split.panes.map(({ key, sessionId, title, url }) => ({ key, sessionId, title, url })))); } catch { /* fine */ } };
function splitSync() {
  const on = Split.panes.length > 0 && Split.can();
  $('chat').classList.toggle('split', on);
  $('cSplit').hidden = !on; $('cSplitBar').hidden = !on;
  $('cSplit').dataset.n = String(Split.panes.length);
  if (window.ChatUI && ChatUI.renderRail) ChatUI.renderRail();
}
// target: { sessionId } or an open chat ({ key, sessionId, title }).
function openBeside(target) {
  if (!Split.can()) return toast('There’s no room for two chats side by side here. A window at least 1100 wide has it.', 4500);
  if (!ChatUI.isOpen()) return target.key ? ChatUI.openKey(target.key) : ChatUI.open({ sessionId: target.sessionId });
  if (ChatUI.isViewing(target)) return toast('That’s the chat you’re in.', 2500);
  if (Split.shows(target)) return splitFocus(target);
  const [s] = target.sessionId ? sessionById(target.sessionId) : [null];
  const q = new URLSearchParams({ solo: '1', pane: '1' });
  if (target.sessionId) q.set('chat', target.sessionId); else q.set('key', target.key);
  const frame = document.createElement('iframe');
  frame.src = `/?${q}`;
  frame.title = `Chat: ${target.title || (s && s.title) || 'another chat'}`;
  const pane = { id: `p${Date.now().toString(36)}`, key: target.key || null, sessionId: target.sessionId || null, title: target.title || (s && s.title) || '', frame };
  // No room for another: it takes the place of the last one.
  if (Split.panes.length >= Split.max()) closePane(Split.panes[Split.panes.length - 1], true);
  Split.panes.push(pane);
  $('cSplit').appendChild(frame);
  splitSync(); splitSave();
  announce(`${pane.title || 'The other chat'} opened beside this one.`);
  return undefined;
}
/* the site you're building, beside the chat: its local address in a frame that can't touch the app, reloaded
   when a reply changes something (a dev server with hot reload has already done it, and a reload does no harm). */
const SITE_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i;
const siteUrl = u => String(u || '').trim().replace('[::1]', 'localhost').replace('0.0.0.0', 'localhost');
const sitePane = () => Split.panes.find(p => p.url);
const siteShown = u => String(u).replace(/([?&])k=[a-f0-9]+(&|$)/, (m, a, b) => (b ? a : '')).replace(/[?&]$/, '');
function openSiteBeside(raw) {
  const url = siteUrl(raw);
  if (!SITE_RE.test(url)) return toast('Only an address on this computer opens here (http://localhost:…). Others open in your browser.', 5000);
  if (!Split.can()) return toast('There’s no room for a site beside the chat here. A window at least 1100 wide has it.', 4500);
  // Beside the chat the side panel is a drawer, and it'd sit on top of the site (Run the project opens it).
  $c('chat').classList.remove('show-ledger');
  const had = sitePane();
  if (had) { siteGo(had, url); return undefined; }
  const box = document.createElement('div');
  box.className = 'c-site';
  box.innerHTML = `<form class="cs-bar"><button type="button" class="icon" data-site="reload" aria-label="Reload the site" title="Reload">↻</button>
    <label class="sr" for="csUrl">The site’s address</label><input id="csUrl" class="cs-url" spellcheck="false" autocomplete="off" value="${esc(url)}">
    <div class="seg cs-seg" role="group" aria-label="Width"><button type="button" class="on" data-site="full" aria-pressed="true">Full</button><button type="button" data-site="phone" aria-pressed="false">Phone</button></div>
    <button type="button" class="icon" data-site="open" aria-label="Open in your browser" title="Open in your browser">↗</button>
    <button type="button" class="icon" data-site="close" aria-label="Close the site" title="Close">✕</button></form>
    <div class="cs-view"><iframe title="Your site" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"></iframe></div>`;
  box.querySelector('iframe').src = url;
  const pane = { id: `s${Date.now().toString(36)}`, key: null, sessionId: null, title: 'Your site', url, frame: box };
  box.querySelector('.cs-url').value = siteShown(url);
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-site]'); if (!b) return;
    const what = b.dataset.site;
    if (what === 'reload') siteReload(pane);
    else if (what === 'close') closePane(pane);
    else if (what === 'open') window.open(pane.url, '_blank', 'noopener');
    else {
      box.classList.toggle('phone', what === 'phone');
      for (const x of box.querySelectorAll('.cs-seg button')) { const on = x.dataset.site === what; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); }
    }
  });
  box.querySelector('form').addEventListener('submit', e => {
    e.preventDefault();
    const next = siteUrl(box.querySelector('.cs-url').value);
    if (SITE_RE.test(next)) siteGo(pane, next);
    else toast('Only an address on this computer opens here (http://localhost:…). Others open in your browser.', 5000);
  });
  if (Split.panes.length >= Split.max()) closePane(Split.panes[Split.panes.length - 1], true);
  Split.panes.push(pane);
  $('cSplit').appendChild(box);
  splitSync(); splitSave();
  announce('Your site opened beside this chat.');
  return undefined;
}
function siteGo(pane, url) {
  pane.url = url;
  pane.frame.querySelector('.cs-url').value = siteShown(url);
  pane.frame.querySelector('iframe').src = url;
  splitSave();
}
// A frame's address can't be read from here once the site has moved on, so reloading goes back to where it was opened.
function siteReload(pane) { const f = pane.frame.querySelector('iframe'); const u = f.src; f.src = 'about:blank'; requestAnimationFrame(() => { f.src = u; }); }
let siteTimer = null;
function siteChanged() {
  const p = sitePane(); if (!p) return;
  clearTimeout(siteTimer);
  siteTimer = setTimeout(() => { const now = sitePane(); if (now) siteReload(now); }, 700);
}
function splitFocus(target) {
  const p = Split.panes.find(x => (target.key && x.key === target.key) || (target.sessionId && x.sessionId && x.sessionId.toLowerCase() === String(target.sessionId).toLowerCase()));
  if (p && p.frame.contentWindow) p.frame.contentWindow.focus();
}
function closePane(pane, quiet = false) {
  const i = Split.panes.indexOf(pane);
  if (i < 0) return;
  Split.panes.splice(i, 1);
  pane.frame.remove();
  splitSync(); splitSave();
  if (!quiet) { const box = $('cText'); if (box && !box.closest('[hidden]')) box.focus({ preventScroll: true }); }
}
function closeSplit() { for (const p of [...Split.panes]) closePane(p, true); splitSync(); splitSave(); }
const paneOfWindow = win => Split.panes.find(p => p.frame.contentWindow === win) || null;
// A frame asks: close me, or swap with the chat in the main place.
window.splitFromPane = (win, what) => {
  const p = paneOfWindow(win); if (!p) return;
  if (what === 'close') return closePane(p);
  if (what === 'swap') {
    // What's in the main place goes beside, and this one comes to the main place.
    const main = { key: ChatUI.key() || null, sessionId: ChatUI.sessionId() || null, title: ($('cTitle') || {}).textContent || '' };
    closePane(p, true);
    (p.sessionId ? ChatUI.open({ sessionId: p.sessionId }) : ChatUI.openKey(p.key)).then(() => { if (main.key || main.sessionId) openBeside(main); }).catch(err => toast(err.message));
  }
  return undefined;
};
// The chats to offer: what's open, then the latest.
function splitChoices() {
  const open = navLists().active.filter(x => !ChatUI.isViewing(x) && !Split.shows(x));
  const seen = new Set(open.flatMap(x => [x.sessionId, x.startedAs]).filter(Boolean).map(s => s.toLowerCase()));
  const here = ChatUI.sessionId() ? ChatUI.sessionId().toLowerCase() : null;
  const recent = allSessions().filter(([c]) => !seen.has(c.id.toLowerCase()) && c.id.toLowerCase() !== here && !Split.shows({ sessionId: c.id })).sort((a, b) => b[0].updated - a[0].updated).slice(0, 6);
  return [
    ...open.map(x => ({ glyph: '◉', label: x.title || 'New chat', hint: `${chatState(x).word}${x.folder ? ` · ${x.folder}` : ''}`, run: () => openBeside({ key: x.key, sessionId: x.sessionId, title: x.title }) })),
    ...(open.length && recent.length ? ['-'] : []),
    ...recent.map(([c, p]) => ({ glyph: '❝', label: c.title, hint: `${p.name} · ${agoL(c.updated)}`, run: () => openBeside({ sessionId: c.id, title: c.title }) })),
    ...(Split.panes.length ? ['-', { glyph: '✕', label: 'Close the chat beside this one', run: closeSplit }] : []),
  ];
}
function splitMenu(anchor) {
  const items = splitChoices();
  if (!items.length) return toast('There’s no other chat to open beside this one yet.', 3000);
  return showMenu(anchor, items);
}

/* the divider: drag it, or arrow keys on it */
function splitRatio(r) {
  const v = Math.max(0.25, Math.min(0.75, r));
  $('chat').style.setProperty('--sa', `${v}fr`); $('chat').style.setProperty('--sb', `${1 - v}fr`);
  $('cSplitBar').setAttribute('aria-valuenow', String(Math.round(v * 100)));
  store('splitRatio', String(v));
}
(function startSplit() {
  if (SOLO) return;
  const bar = $('cSplitBar');
  const saved = Number(store('splitRatio'));
  if (saved) splitRatio(saved);
  bar.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); bar.setPointerCapture(e.pointerId);
    document.body.classList.add('split-dragging');   // the frames don't take the pointer while it's dragged
    const main = document.querySelector('#chat .c-main').getBoundingClientRect();
    const total = main.width + $('cSplit').getBoundingClientRect().width;
    const move = ev => splitRatio((ev.clientX - main.left) / total);
    const up = () => { bar.removeEventListener('pointermove', move); document.body.classList.remove('split-dragging'); };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up, { once: true });
    bar.addEventListener('pointercancel', up, { once: true });
  });
  bar.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    splitRatio((Number(bar.getAttribute('aria-valuenow')) || 50) / 100 + (e.key === 'ArrowRight' ? 0.04 : -0.04));
  });
  window.addEventListener('resize', splitSync);
  // Back after a reload: what was beside it is beside it again, the next time a chat opens.
  let was = [];
  try { was = JSON.parse(sessionStorage.getItem('split') || '[]') || []; } catch { was = []; }
  Split.restore = () => { const list = was; was = []; for (const t of list) { if (t.url) openSiteBeside(t.url); else if (t.sessionId) openBeside(t); } };
}());
if (PANE) {
  document.body.classList.add('pane');
  for (const b of document.querySelectorAll('.c-panebtn')) b.hidden = false;
}
