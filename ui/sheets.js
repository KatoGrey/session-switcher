'use strict';
/* Sheets you can drag shut on a phone, in the spirit of Vaul. On a screen 760px wide or less, the menus,
   the model picker, the Together picker and a chat's details follow your finger down, the dimmed backdrop
   fading as they go. Let go past about 30% of the sheet's height, or flick it down, and it closes;
   otherwise it springs back. Pulling up past the top gives a little and no more. A sheet whose content is
   scrolled down scrolls instead, and a touch on a text box types. With a mouse (a narrow window on a PC)
   only the handle at the top drags. On a wider screen nothing here does anything. */

const SHEET_PHONE = matchMedia('(max-width: 760px)');
const SHEET_CLOSE_AT = 0.3;    // of the sheet's height
const SHEET_FLICK = 0.4;       // px per ms, downwards, as you let go
const SHEET_EASE = 'cubic-bezier(.32,.72,0,1)';
const SHEET_TYPING = 'input, textarea, select, [contenteditable="true"], [data-nodrag]';

// el: the sheet. onClose: closes it as its own Close would. backdrop: the dimmed layer behind it (or a
// function giving it). head: parts of it that never scroll (a header), where a touch always drags.
function makeDraggableSheet(el, { onClose, backdrop = null, head = '' } = {}) {
  if (!el || el._sheet) return;
  el._sheet = true;
  let g = null, eatClick = 0, settle = 0, closing = false;
  const back = () => (typeof backdrop === 'function' ? backdrop() : backdrop);
  const zoom = () => (typeof uiScale === 'function' ? uiScale() : 1);
  const still = () => !(typeof motionOk === 'function' ? motionOk() : !matchMedia('(prefers-reduced-motion: reduce)').matches);
  // Anything between the touch and the sheet that's scrolled down (or can scroll at all).
  const within = (t, test) => { for (let n = t; n && n.nodeType === 1; n = n.parentElement) { if (test(n)) return true; if (n === el) break; } return false; };
  const scrolled = t => within(t, n => n.scrollTop > 0);
  const scrolls = t => within(t, n => n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY));
  // Past the top it gives, less and less.
  const give = d => 14 * Math.log1p(d / 14);
  const place = (y, h) => {
    el.style.transform = y ? `translateY(${(y / zoom()).toFixed(1)}px)` : '';
    const b = back(); if (b) b.style.opacity = y > 0 ? String(Math.max(0, 1 - y / h).toFixed(3)) : '';
  };
  const ease = ms => { const b = back(); el.style.transition = ms ? `transform ${ms}ms ${SHEET_EASE}` : 'none'; if (b) b.style.transition = ms ? `opacity ${ms}ms ${SHEET_EASE}` : 'none'; };
  // Everything put back as the stylesheet has it, once the sheet has gone (or before a drag that never was).
  const reset = () => {
    clearTimeout(settle); closing = false;
    el.classList.remove('sheet-dragging');
    for (const p of ['transform', 'transition', 'animation']) el.style.removeProperty(p);
    const b = back(); if (b) { b.style.removeProperty('opacity'); b.style.removeProperty('transition'); }
  };
  // (Closed, or closed and opened again by something else while it was sliding away: that one stands.)
  new MutationObserver(() => { if (el.hidden || closing) reset(); }).observe(el, { attributes: true, attributeFilter: ['hidden'] });

  el.addEventListener('pointerdown', e => {
    g = null;
    if (!SHEET_PHONE.matches || el.hidden || closing || !e.isPrimary || e.button > 0) return;
    if (e.target instanceof Element && e.target.closest(SHEET_TYPING)) return;
    // The handle: the strip along its top (while it's scrolled to the top, where the handle shows).
    const z = zoom(), top = e.clientY - el.getBoundingClientRect().top;
    const grab = (top >= 0 && top < 28 * z && el.scrollTop <= 0) || !!(e.target instanceof Element && e.target.closest('.sheet-grab, .mp-grab'));
    const onHead = grab || !!(head && e.target instanceof Element && e.target.closest(head));
    if (e.pointerType === 'mouse' && !grab) return;
    g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, on: false, onHead, y: 0, h: Math.max(1, el.offsetHeight * z), trail: [] };
  });
  el.addEventListener('pointermove', e => {
    if (!g || e.pointerId !== g.id) return;
    if (el.hidden) { g = null; return; }   // closed meanwhile (Escape, say)
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (!g.on) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { g = null; return; }   // sideways: not ours
      if (Math.abs(dy) < 6) return;
      // Down: only from the top of what's scrolled. Up: only when there's nothing to scroll.
      if (!g.onHead && (dy > 0 ? scrolled(e.target) : scrolls(e.target))) { g = null; return; }
      g.on = true; g.y0 = e.clientY;
      clearTimeout(settle);
      el.classList.add('sheet-dragging');
      el.style.animation = 'none';
      ease(0);
      try { el.setPointerCapture(e.pointerId); } catch { /* a touch is held by its target already */ }
    }
    const y = e.clientY - g.y0;
    g.y = y >= 0 ? y : -give(-y);
    g.trail.push([e.timeStamp, e.clientY]);
    if (g.trail.length > 8) g.trail.shift();
    place(g.y, g.h);
  });
  // While it's being dragged the page mustn't scroll under the finger (a touch's own scrolling would
  // otherwise take the gesture over).
  el.addEventListener('touchmove', e => { if (g && g.on && e.cancelable) e.preventDefault(); }, { passive: false });
  const end = (e, cancelled) => {
    if (!g || e.pointerId !== g.id) return;
    const d = g; g = null;
    if (!d.on) return;
    eatClick = performance.now();
    try { el.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    // How fast it was going as it was let go: over the last tenth of a second or so (held still
    // before letting go, it wasn't going anywhere).
    const last = d.trail[d.trail.length - 1], first = last && d.trail.find(p => last[0] - p[0] <= 120);
    const v = last && e.timeStamp - last[0] < 100 && last[0] > first[0] ? (last[1] - first[1]) / (last[0] - first[0]) : 0;
    const close = !cancelled && d.y > 0 && (d.y > d.h * SHEET_CLOSE_AT || (v > SHEET_FLICK && d.y > 12));
    if (close) {
      if (still()) { onClose(); reset(); return; }
      closing = true;
      ease(220); place(d.h + 24 * zoom(), d.h);
      settle = setTimeout(() => { onClose(); reset(); }, 230);
      return;
    }
    if (still()) { place(0, d.h); el.style.removeProperty('transition'); el.classList.remove('sheet-dragging'); return; }
    ease(300); place(0, d.h);
    settle = setTimeout(() => { el.style.removeProperty('transition'); const b = back(); if (b) b.style.removeProperty('transition'); el.classList.remove('sheet-dragging'); }, 320);
  };
  el.addEventListener('pointerup', e => end(e, false));
  el.addEventListener('pointercancel', e => end(e, true));
  // A drag that started on a button doesn't press it as it's let go.
  el.addEventListener('click', e => { if (performance.now() - eatClick < 350) { e.preventDefault(); e.stopPropagation(); } }, true);
}

// The phone's sheets.
makeDraggableSheet($('menu'), { onClose: () => closeMenu(true), backdrop: () => $('menuBack') });
makeDraggableSheet($('drawer'), { onClose: () => closeDrawer(), head: '.d-top' });
makeDraggableSheet($c('cPick'), { onClose: () => closePick(), backdrop: () => $c('pickBack'), head: '.mp-top' });
makeDraggableSheet($c('cTogether'), { onClose: () => closeTogether(true) });
