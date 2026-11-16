'use strict';
/* The sidebar in your order: its sections (the Commander and Routines, Pinned, Your projects, Active now, Recent,
   Groups and Sub-sessions) go where you put them, by dragging a section by its heading or from its right-click menu
   (a long press on a phone), and any you don't use can be hidden from the same menu. Kept on this device. The block at the top (New chat, the hub, Your work…) stays where it
   is, and Imperial and Rebel keep their own sidebar. */

const NAV_SECS = ['tools', 'pinned', 'projects', 'active', 'recent', 'groups', 'subs'];
const navSecName = k => ({ tools: aideOn() ? 'Commander, Routines and Companion' : 'Commander and Routines', pinned: 'Pinned', projects: voice('Your projects'), active: voice('Active now'), recent: voice('Recent'), groups: 'Groups', subs: 'Sub-sessions' }[k] || k);

// The order kept on this device, with any section it doesn't mention (a later version's) after the one before it.
function navOrder() {
  let saved = [];
  try { saved = JSON.parse(store('nav-order') || '[]'); } catch { /* the usual order */ }
  const out = (Array.isArray(saved) ? saved : []).filter((k, i, all) => NAV_SECS.includes(k) && all.indexOf(k) === i);
  for (const k of NAV_SECS) {
    if (out.includes(k)) continue;
    const before = NAV_SECS.slice(0, NAV_SECS.indexOf(k)).reverse().find(x => out.includes(x));
    out.splice(before ? out.indexOf(before) + 1 : 0, 0, k);
  }
  return out;
}
function setNavOrder(list) {
  // A later version's sections, which this one doesn't know: kept, after the section they followed.
  let raw = [];
  try { raw = JSON.parse(store('nav-order') || '[]'); } catch { /* none */ }
  const out = [...list];
  if (Array.isArray(raw)) raw.forEach((k, j) => {
    if (typeof k !== 'string' || NAV_SECS.includes(k) || out.includes(k)) return;
    const after = raw.slice(0, j).reverse().find(x => out.includes(x));
    out.splice(after ? out.indexOf(after) + 1 : 0, 0, k);
  });
  store('nav-order', JSON.stringify(out));
  renderNav();
}
// The sections you've hidden (Ctrl+K and the hub still reach what's in them).
function navHidden() {
  let h = [];
  try { h = JSON.parse(store('nav-hidden') || '[]'); } catch { /* none */ }
  return Array.isArray(h) ? h.filter(k => NAV_SECS.includes(k)) : [];
}
// The sections, each in a box of its own, in your order. parts: { tools, pinned, … } (an empty one isn't shown, nor a
// hidden one).
function navSections(parts) {
  const hidden = navHidden();
  return navOrder().map(k => (parts[k] && !hidden.includes(k) ? `<div class="nav-sec" data-navsec="${k}">${parts[k]}</div>` : '')).join('');
}
function hideNavSec(k, hide = true) {
  const h = navHidden().filter(x => x !== k);
  if (hide) h.push(k);
  store('nav-hidden', h.length ? JSON.stringify(h) : '');
  renderNav();
  if (hide) toast(`${navSecName(k)} is hidden. Right-click a heading in the sidebar to show it again.`, 7000, { label: 'Show it again', run: () => hideNavSec(k, false) });
  else announce(`${navSecName(k)} is back in the sidebar.`);
}
const navLayoutChanged = () => navOrder().join() !== NAV_SECS.join() || navHidden().length > 0 || !!navWidth();
function resetNavLayout() {
  store('nav-order', ''); store('nav-hidden', ''); store('nav-width', '');
  applyNavWidth(null);
  renderNav();
  announce('The sidebar is back as it was.');
}
// What the sidebar as a whole offers (from any heading, or its empty space): the hidden sections back, and the usual
// order and sections.
function navSidebarItems() {
  return [
    ...navHidden().map(k => ({ glyph: '+', label: `Show ${navSecName(k)} again`, run: () => hideNavSec(k, false) })),
    ...(navLayoutChanged() ? [{ label: 'Put the sidebar back as it was', hint: 'its usual order and width, with every section', run: resetNavLayout }] : []),
  ];
}
// Moves one section among those showing now (a section that's empty for now keeps its own place).
function moveNavSec(k, where) {
  const order = navOrder();
  const shown = [...$('nav').querySelectorAll('.nav-sec')].map(el => el.dataset.navsec);
  const i = shown.indexOf(k); if (i < 0) return;
  const to = where === 'up' ? i - 1 : where === 'down' ? i + 1 : where === 'top' ? 0 : where === 'bottom' ? shown.length - 1 : where;
  if (to < 0 || to >= shown.length || to === i) return;
  const moved = [...shown]; moved.splice(i, 1); moved.splice(to, 0, k);
  let n = 0;
  setNavOrder(order.map(x => (shown.includes(x) ? moved[n++] : x)));
  $('nav').querySelector(`.nav-sec[data-navsec="${k}"]`)?.scrollIntoView({ block: 'nearest' });
  announce(`${navSecName(k)} moved to ${to === 0 ? 'the top' : to === shown.length - 1 ? 'the bottom' : `place ${to + 1} of ${shown.length}`} of the sidebar.`);
}
// The right-click menu's part for a section.
function navSecItems(k) {
  const shown = [...$('nav').querySelectorAll('.nav-sec')].map(el => el.dataset.navsec), i = shown.indexOf(k), name = navSecName(k);
  if (i < 0) return [];
  return [
    ...(i > 0 ? [{ glyph: '↑', label: `Move ${name} up`, run: () => moveNavSec(k, 'up') }, { glyph: '⇡', label: `Move ${name} to the top`, run: () => moveNavSec(k, 'top') }] : []),
    ...(i < shown.length - 1 ? [{ glyph: '↓', label: `Move ${name} down`, run: () => moveNavSec(k, 'down') }, { glyph: '⇣', label: `Move ${name} to the bottom`, run: () => moveNavSec(k, 'bottom') }] : []),
    '-',
    { glyph: '−', label: `Hide ${name}`, run: () => hideNavSec(k) },
    '-',
    ...navSidebarItems(),
  ];
}

/* ---------- dragging a section by its heading ---------- */
// With a mouse or pen, as the chat window's list does (a finger scrolls; a long press gives the menu). It starts
// once the pointer has moved a few pixels, so a click still folds a section or opens a row.
const NavDrag = { d: null, dropped: 0 };
const NAV_GRIP = '.nav-sec > .nav-h, .nav-sec > .nav-hrow, .nav-sec > .nav-tools';
$('nav').addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.pointerType === 'touch' || NavDrag.d || (typeof sagaLook === 'function' && sagaLook())) return;
  const grip = e.target instanceof Element && e.target.closest(NAV_GRIP);
  if (!grip || e.target.closest('input, [draggable="true"]')) return;
  NavDrag.d = { k: grip.closest('.nav-sec').dataset.navsec, x0: e.clientX, y0: e.clientY, y: e.clientY, id: e.pointerId, on: false, t0: Date.now() };
});
// Whether the sidebar should wait to be redrawn: while a section is pressed (briefly: a press that never ends doesn't
// freeze it) or being dragged.
const navDragHolds = () => !!NavDrag.d && (NavDrag.d.on || Date.now() - NavDrag.d.t0 < 1500);
function navDragStart(d) {
  d.sec = $('nav').querySelector(`.nav-sec[data-navsec="${d.k}"]`);
  if (!d.sec) { NavDrag.d = null; return false; }
  d.items = [...d.sec.parentElement.children].filter(el => el.classList.contains('nav-sec'));
  for (const el of d.items) for (const a of el.getAnimations()) a.finish();
  d.from = d.to = d.items.indexOf(d.sec);
  d.tops = d.items.map(el => el.offsetTop); d.hs = d.items.map(el => el.offsetHeight);
  // The gap above each (its heading's margin, outside its box) and the room the dragged one takes: its height and
  // its gap. (The Commander and Routines have no heading, so no gap.)
  d.gaps = d.items.map((el, i) => (i ? d.tops[i] - d.tops[i - 1] - d.hs[i - 1] : parseFloat(getComputedStyle(el.firstElementChild || el).marginTop) || 0));
  d.slot = d.hs[d.from] + d.gaps[d.from];
  // What scrolls: the sidebar's list (the main themes) or the sidebar itself.
  d.scroller = [d.sec.closest('.nav-scroll'), $('nav')].find(el => el && /auto|scroll/.test(getComputedStyle(el).overflowY)) || null;
  d.s0 = d.scroller ? d.scroller.scrollTop : 0;
  d.top0 = d.sec.getBoundingClientRect().top;
  d.on = true;
  d.sec.classList.add('nav-sec-dragging');
  for (const el of d.items) if (el !== d.sec) el.classList.add('nav-sec-room');
  document.body.classList.add('nav-dragging');
  try { d.sec.setPointerCapture(d.id); } catch { /* fine without */ }
  d.raf = requestAnimationFrame(() => navDragScroll(d));
  return true;
}
function navDragPlace(d) {
  const scrolled = d.scroller ? d.scroller.scrollTop - d.s0 : 0, last = d.items.length - 1;
  // It follows the pointer, though not far past either end of the list.
  const moved = d.y - d.y0 + scrolled;
  const dy = Math.max(d.tops[0] - d.tops[d.from] - 12, Math.min(d.tops[last] + d.hs[last] - d.tops[d.from] - d.hs[d.from] + 12, moved));
  d.sec.style.transform = `translateY(${dy}px)`;
  // Its new place: where the pointer is (not where the section's held back to), past the middle of each section it's
  // crossed, as sections differ in height.
  const at = d.tops[d.from] + (d.y0 - d.top0) + moved;
  let to = 0;
  d.items.forEach((el, i) => { if (i !== d.from && d.tops[i] + d.hs[i] / 2 < at) to++; });
  if (to === d.to) return;
  d.to = to;
  d.items.forEach((el, i) => {
    if (i === d.from) return;
    const shift = d.from < to && i > d.from && i <= to ? -d.slot : to < d.from && i >= to && i < d.from ? d.slot : 0;
    el.style.transform = shift ? `translateY(${shift}px)` : '';
  });
}
document.addEventListener('pointermove', e => {
  const d = NavDrag.d; if (!d || e.pointerId !== d.id || d.settling) return;
  d.y = e.clientY;
  if (!d.on) { if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return; if (!navDragStart(d)) return; }
  e.preventDefault();
  navDragPlace(d);
}, { passive: false });
function navDragScroll(d) {
  if (NavDrag.d !== d || d.settling) return;
  const s = d.scroller;
  if (s && s.scrollHeight > s.clientHeight) {
    const r = s.getBoundingClientRect(), edge = 40;
    const v = d.y < r.top + edge ? -Math.ceil((r.top + edge - d.y) / 5) : d.y > r.bottom - edge ? Math.ceil((d.y - r.bottom + edge) / 5) : 0;
    if (v) { const was = s.scrollTop; s.scrollTop += v; if (s.scrollTop !== was) navDragPlace(d); }
  }
  d.raf = requestAnimationFrame(() => navDragScroll(d));
}
const navDragEnd = e => {
  if (NavDrag.escaped === e.pointerId) { NavDrag.escaped = null; NavDrag.dropped = Date.now(); }
  const d = NavDrag.d; if (!d || e.pointerId !== d.id || d.settling) return;
  if (!d.on) { NavDrag.d = null; if (NavDrag.held) { NavDrag.held = false; renderNav(); } return; }
  NavDrag.dropped = Date.now();
  navDragSettle(d, e.type === 'pointerup');
};
document.addEventListener('pointerup', navDragEnd);
document.addEventListener('pointercancel', navDragEnd);
// Esc while dragging puts it back.
document.addEventListener('keydown', e => {
  const d = NavDrag.d;
  if (e.key === 'Escape' && d && d.on && !d.settling) { e.preventDefault(); e.stopPropagation(); NavDrag.dropped = Date.now(); NavDrag.escaped = d.id; navDragSettle(d, false); }
}, true);
// The click that ends a drag doesn't also fold the section or open the row it started on.
window.addEventListener('click', e => {
  if (Date.now() - NavDrag.dropped < 400 && e.target instanceof Element && e.target.closest('#nav')) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
// Letting go: the section settles into its new place (or back into its old one), and only then does the order change.
function navDragSettle(d, keep) {
  d.settling = true;
  cancelAnimationFrame(d.raf);
  try { d.sec.releasePointerCapture(d.id); } catch { /* not captured */ }
  const to = keep ? d.to : d.from;
  const end = to > d.from ? d.tops[to] + d.hs[to] - d.tops[d.from] - d.hs[d.from] : to < d.from ? d.tops[to] - d.gaps[to] + d.gaps[d.from] - d.tops[d.from] : 0;
  d.sec.classList.add('nav-sec-settling');
  d.sec.style.transform = end ? `translateY(${end}px)` : '';
  if (!keep) for (const el of d.items) if (el !== d.sec) el.style.transform = '';
  const done = () => {
    if (d.finished) return;
    d.finished = true;
    for (const el of d.items) { el.classList.remove('nav-sec-room', 'nav-sec-dragging', 'nav-sec-settling'); el.style.transform = ''; }
    document.body.classList.remove('nav-dragging');
    NavDrag.d = null;
    if (keep && to !== d.from) moveNavSec(d.sec.dataset.navsec, to);
    else if (NavDrag.held) renderNav();   // what changed while it was being dragged
    NavDrag.held = false;
  };
  d.sec.addEventListener('transitionend', e => { if (e.target === d.sec && e.propertyName === 'transform') done(); });
  setTimeout(done, motionOk() ? 320 : 0);
}

/* ---------- the sidebar's width ---------- */
// Dragged at its right edge (or the arrow keys on that edge), on a wide screen; double-click puts it back. Kept on
// this device. Imperial and Rebel keep theirs.
const NAV_W = { min: 200, max: 480 };
const navWidthMax = () => Math.max(NAV_W.min, Math.min(NAV_W.max, Math.round((innerWidth / (typeof uiScale === 'function' ? uiScale() : 1)) * 0.45)));
function navWidth() { const w = Number(store('nav-width')); return w >= NAV_W.min && w <= NAV_W.max ? w : null; }
function applyNavWidth(w = navWidth()) {
  const root = document.documentElement;
  if (w) { root.style.setProperty('--nav-w-user', `${w}px`); root.classList.add('nav-sized'); }
  else { root.style.removeProperty('--nav-w-user'); root.classList.remove('nav-sized'); }
  const h = document.getElementById('navSize');
  if (h) { h.setAttribute('aria-valuenow', String(Math.round(w || $('nav').getBoundingClientRect().width / (typeof uiScale === 'function' ? uiScale() : 1) || 0))); h.setAttribute('aria-valuemax', String(navWidthMax())); }
}
function setNavWidth(w, say = false) {
  w = w ? Math.max(NAV_W.min, Math.min(navWidthMax(), Math.round(w))) : null;
  store('nav-width', w ? String(w) : '');
  applyNavWidth(w);
  if (say) announce(w ? `The sidebar is ${w} pixels wide.` : 'The sidebar is back to its usual width.');
}
document.body.insertAdjacentHTML('beforeend', `<div class="nav-size" id="navSize" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Sidebar width. Drag it, or use the left and right arrow keys; double-click puts it back" aria-valuemin="${NAV_W.min}" aria-valuemax="${NAV_W.max}"></div>`);
applyNavWidth();
$('navSize').addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  e.preventDefault();
  const h = e.currentTarget, scale = typeof uiScale === 'function' ? uiScale() : 1;
  let w = null, raf = 0;
  try { h.setPointerCapture(e.pointerId); } catch { /* fine without */ }
  document.body.classList.add('nav-sizing');
  const move = ev => {
    w = Math.max(NAV_W.min, Math.min(navWidthMax(), Math.round(ev.clientX / scale)));
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; applyNavWidth(w); });
  };
  const up = () => {
    h.removeEventListener('pointermove', move);
    cancelAnimationFrame(raf);
    document.body.classList.remove('nav-sizing');
    if (w !== null) setNavWidth(w, true);
  };
  h.addEventListener('pointermove', move);
  h.addEventListener('pointerup', up, { once: true });
  h.addEventListener('pointercancel', up, { once: true });
});
$('navSize').addEventListener('dblclick', () => setNavWidth(null, true));
$('navSize').addEventListener('keydown', e => {
  const now = navWidth() || Math.round($('nav').getBoundingClientRect().width / (typeof uiScale === 'function' ? uiScale() : 1));
  const step = e.shiftKey ? 48 : 16;
  const to = e.key === 'ArrowLeft' ? now - step : e.key === 'ArrowRight' ? now + step : e.key === 'Home' ? NAV_W.min : e.key === 'End' ? navWidthMax() : null;
  if (to === null) return;
  e.preventDefault();
  setNavWidth(to, true);
});
addEventListener('resize', () => { if (navWidth() && navWidth() > navWidthMax()) applyNavWidth(navWidthMax()); });
