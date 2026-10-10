'use strict';
/* Back, the way phones do it. Swipe in from the left edge: an arrow follows your finger and lights up
   once you've gone far enough; let go to go back (a quick flick counts too). The phone's own Back
   button and back gesture, and the browser's Back on a touch device, do the same. Back closes what's on
   top (a picture, a menu, a dialog, the chat, the menu panel), then returns to the page you came from
   (window.__mobileBack, ui/events.js). */

const EDGE = 26, GO = 72;
let swipe = null;
const noSwipe = t => !(t instanceof Element) || !!t.closest('input, textarea, select, [contenteditable="true"], pre, .code, .tbl, .pv-diff, .td-track, [data-noswipe]');
document.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) { swipe = null; return; }
  const t = e.touches[0];
  swipe = t.clientX <= EDGE && !noSwipe(e.target) ? { x: t.clientX, y: t.clientY, dx: 0, at: Date.now(), el: null } : null;
}, { passive: true });
document.addEventListener('touchmove', e => {
  const s = swipe; if (!s || e.touches.length !== 1) return;
  const t = e.touches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
  if (!s.el) {
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }   // that's a scroll
    if (dx < 10) return;
    s.el = document.createElement('div');
    s.el.className = 'swipe-back';
    s.el.setAttribute('aria-hidden', 'true');
    s.el.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20"><path d="M12.5 4.5L7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    s.el.style.top = `${Math.round(Math.max(80, Math.min(innerHeight - 80, s.y)))}px`;
    document.body.appendChild(s.el);
  }
  s.dx = Math.max(0, dx);
  const p = Math.min(1, s.dx / GO);
  s.el.style.transform = `translate(${(Math.min(s.dx, GO + 30) * 0.6 - 34).toFixed(1)}px, -50%) scale(${(0.6 + 0.4 * p).toFixed(3)})`;
  s.el.classList.toggle('ready', p >= 1);
}, { passive: true });
function endSwipe() {
  const s = swipe; swipe = null;
  if (!s || !s.el) return;
  const back = s.dx >= GO || (s.dx > 36 && s.dx / Math.max(1, Date.now() - s.at) > 0.55);
  const el = s.el;
  el.classList.add(back ? 'went' : 'gone');
  setTimeout(() => el.remove(), 280);
  if (back) goBack();
}
document.addEventListener('touchend', endSwipe, { passive: true });
document.addEventListener('touchcancel', endSwipe, { passive: true });

/* The browser's Back on a touch device (and Safari's own edge swipe): each page or chat you open is a
   step it can undo. A swipe here goes through the same history, so the two never disagree. */
const touchy = () => matchMedia('(pointer: coarse)').matches;
let depth = 0;
function noteStep() {
  if (!touchy() || !window.history || !history.pushState) return;
  depth += 1;
  try { history.pushState({ ss: depth }, ''); } catch { depth -= 1; }
}
function goBack() {
  if (depth > 0 && history.state && history.state.ss === depth) history.back();
  else window.__mobileBack();
}
window.addEventListener('popstate', e => {
  const d = (e.state && e.state.ss) || 0;
  const was = depth; depth = d;
  if (d < was) window.__mobileBack();
});
