'use strict';
/* Toasts: short messages at the bottom of the window (ui/toasts.css).
   Up to three show at once, the newest in front and the older ones peeking out behind it. Pointing at
   them, or the keyboard reaching them (F6, or Tab), spreads them into a list, and their clocks stop
   while you do, and while the window is hidden. Swipe one down, or press its ✕, to put it away. The
   same words again while they still show bring that toast back to the front instead of a copy.
   The newest always carries id="toast" (and the class "show" while it's up), as the one toast did
   before there could be more: what was said last can still be read back from it. */
const Toaster = (() => {
  const MAX = 3, KEEP = 6, PEEK = 14, GAP = 10;
  const root = $('toaster'), ol = root.querySelector('ol');
  const live = [];   // the toasts still up, oldest first
  const st = { hover: false, focus: false, swipe: false, back: null, n: 0, rz: 0 };
  const motion = () => document.body.classList.contains('motion');
  const paused = () => st.hover || st.focus || st.swipe || document.hidden;
  const spread = () => st.hover || st.focus;

  function show(msg, ms = 5000, action = null, opts = null) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const text = String(msg ?? ''), tone = ['error', 'success', 'loading'].includes(o.tone) ? o.tone : '';
    const label = action ? String(action.label) : '';
    // A name (o.id) updates that toast where it is; otherwise the same words still showing are that toast again.
    let t = o.id != null ? live.find(x => x.id === o.id) : null;
    if (!t) t = live.find(x => x.text === text && x.tone === tone && x.label === label);
    const focused = t && t.el.contains(document.activeElement);
    if (t) live.splice(live.indexOf(t), 1);
    else t = make();
    if (o.id != null) t.id = o.id;
    let d = Number(ms);
    if (!(d > 0)) d = 5000;
    if (action) d = Math.max(d, 6000);   // time to reach its button
    if (tone === 'loading' || d > 2147483647) d = Infinity;
    Object.assign(t, { text, tone, label, action, ms: d });
    live.push(t);
    while (live.length > KEEP) dismiss(live[0]);
    paint(t);
    claim(t);
    if (focused) t.el.focus({ preventScroll: true });
    stop(t); t.left = t.ms; arm(t);
    layout();
    speak(t);
  }

  function make() {
    const t = { id: `t${++st.n}`, el: document.createElement('li'), left: 0, timer: 0, started: 0, w: 0, h: 0, sw: null };
    t.el.tabIndex = -1;
    t.el.addEventListener('pointerdown', e => swipeStart(t, e));
    t.el.addEventListener('pointermove', e => swipeMove(t, e));
    t.el.addEventListener('pointerup', e => swipeEnd(t, e));
    t.el.addEventListener('pointercancel', e => swipeEnd(t, e));
    return t;
  }

  // Its words, a button for its action (still .toast-act), and a ✕ that adds no words of its own.
  function paint(t) {
    const el = t.el;
    el.replaceChildren();
    el.className = `toast show${t.action ? ' has-act' : ''}`;
    el.hidden = false; el.inert = false; el.style.zIndex = '';
    el.style.removeProperty('--swipe');
    if (t.tone) el.dataset.tone = t.tone; else delete el.dataset.tone;
    if (t.tone) {
      const i = document.createElement('span');
      i.className = t.tone === 'loading' ? 'toast-ic gen-spin' : 'toast-ic';
      i.setAttribute('aria-hidden', 'true');
      el.append(i);
    }
    const m = document.createElement('span');
    m.className = 'toast-msg'; m.textContent = t.text;
    el.append(m);
    if (t.action) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'toast-act'; b.textContent = t.label;
      b.onclick = () => { const run = t.action && t.action.run; dismiss(t); if (run) wrap(run)(); };
      el.append(' ', b);
    }
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'toast-x'; x.title = 'Dismiss'; x.setAttribute('aria-label', 'Dismiss');
    x.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3l-6 6"/></svg>';
    x.onclick = () => dismiss(t);
    el.append(x);
  }

  // The newest goes first in the list (Tab and a screen reader meet it first) and takes id="toast".
  function claim(t) {
    const prev = document.getElementById('toast');
    if (prev && prev !== t.el) {
      prev.removeAttribute('id');
      if (!live.some(x => x.el === prev) && !prev.classList.contains('leaving')) prev.remove();
    }
    t.el.id = 'toast';
    if (ol.firstElementChild !== t.el) ol.prepend(t.el);
  }

  function layout() {
    const list = live.slice().reverse(), open = spread(), front = list[0];
    root.toggleAttribute('data-expanded', open && list.length > 0);
    // Their own sizes, read fresh each time (a font arriving late changes them): spread out, each
    // keeps its own; stacked, only the newest does, and the ones behind take its size.
    list.forEach((t, i) => { if (open || i === 0) { t.el.style.width = ''; t.el.style.height = ''; } });
    for (const t of open ? list : list.slice(0, 1)) { t.w = t.el.offsetWidth; t.h = t.el.offsetHeight; }
    let y = 0, lastY = 0;
    list.forEach((t, i) => {
      const el = t.el, s = el.style, shown = i < MAX;
      el.toggleAttribute('data-front', i === 0);
      el.toggleAttribute('data-behind', !shown);
      el.inert = !shown;
      s.zIndex = String(KEEP + 1 - i);
      if (open) {
        if (shown) { lastY = y; y += t.h + GAP; }
        s.setProperty('--y', `${-lastY}px`); s.setProperty('--s', '1');
      } else {
        // Behind the newest: as wide and tall as it, a little smaller, its top edge showing.
        const k = Math.min(i, MAX - 1);
        s.setProperty('--y', `${-k * PEEK}px`); s.setProperty('--s', String(1 - k * 0.05));
        if (i) { s.width = `${front.w}px`; s.height = `${front.h}px`; }
      }
    });
    const shown = list.slice(0, MAX);
    ol.style.height = !shown.length ? '0px' : `${open ? shown.reduce((a, t) => a + t.h, 0) + GAP * (shown.length - 1) : front.h + (shown.length - 1) * PEEK}px`;
    if (!list.length) { st.hover = false; st.swipe = false; if (!root.contains(document.activeElement)) st.focus = false; }
  }

  function arm(t) {
    if (t.timer || !Number.isFinite(t.left) || paused()) return;
    t.started = Date.now();
    t.timer = setTimeout(() => { t.timer = 0; dismiss(t); }, Math.max(0, t.left));
  }
  function stop(t) {
    if (!t.timer) return;
    clearTimeout(t.timer); t.timer = 0;
    t.left -= Date.now() - t.started;
  }
  function sync() {
    const p = paused();
    for (const t of live) { if (p) stop(t); else arm(t); }
    layout();
  }

  function dismiss(t) {
    const i = live.indexOf(t);
    if (i < 0) return;
    live.splice(i, 1);
    stop(t);
    const el = t.el, had = el.contains(document.activeElement);
    el.classList.remove('show'); el.classList.add('leaving');
    el.removeAttribute('data-front');
    el.style.zIndex = '0';
    if (had) refocus();
    el.inert = true;
    layout();
    // The last one said keeps its words (hidden) until the next, as the single toast did.
    const done = () => { el.classList.remove('leaving', 'swiped'); if (el.id === 'toast') el.hidden = true; else el.remove(); };
    if (motion()) setTimeout(done, 260); else done();
  }

  // A toast with the keyboard on it went away: the next one has it, or it goes back where it was.
  function refocus() {
    const a = document.activeElement, keys = a && a.matches(':focus-visible');
    const next = live[live.length - 1];
    if (keys && next) { next.el.focus({ preventScroll: true }); return; }
    goBack();
  }
  function goBack() {
    const b = st.back;
    st.back = null;
    if (b && b.isConnected && !b.closest('[inert]') && b.getClientRects().length) b.focus({ preventScroll: true });
    if (root.contains(document.activeElement)) document.activeElement.blur();
  }

  // Said once to a screen reader: errors at once, the rest when it's free. The list itself isn't a live
  // region, so nothing is read twice.
  function speak(t) {
    const el = $(t.tone === 'error' ? 'toastAlarm' : 'toastSay');
    if (!el) return;
    const words = t.label ? `${t.text} (F6: ${t.label})` : t.text;
    el.textContent = '';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.textContent = words; }, 60);
  }

  /* ---------- swipe down to put it away ---------- */
  function swipeStart(t, e) {
    if (e.button !== 0 || !t.el.classList.contains('show') || (e.target instanceof Element && e.target.closest('button, a'))) return;
    t.sw = { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now(), dy: 0, on: false };
  }
  function swipeMove(t, e) {
    const s = t.sw;
    if (!s || e.pointerId !== s.id) return;
    const dy = e.clientY - s.y, dx = e.clientX - s.x;
    if (!s.on) {
      if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
      if (Math.abs(dy) < Math.abs(dx) * 1.5) { t.sw = null; return; }   // across: selecting its words
      s.on = true;
      try { t.el.setPointerCapture(e.pointerId); } catch { /* already let go */ }
      t.el.classList.add('swiping');
      const sel = document.getSelection(); if (sel) sel.removeAllRanges();
      st.swipe = true; sync();
    }
    s.dy = dy;
    t.el.style.setProperty('--swipe', `${dy > 0 ? dy : Math.max(-12, dy / 4)}px`);
    e.preventDefault();
  }
  function swipeEnd(t, e) {
    const s = t.sw;
    if (!s || e.pointerId !== s.id) return;
    t.sw = null;
    if (!s.on) return;
    t.el.classList.remove('swiping');
    st.swipe = false;
    const fast = s.dy > 12 && s.dy / Math.max(1, performance.now() - s.at) > 0.11;
    if (e.type === 'pointerup' && (s.dy > 45 || fast)) { t.el.classList.add('swiped'); dismiss(t); }
    else t.el.style.setProperty('--swipe', '0px');
    sync();
  }

  /* ---------- pointing, the keyboard, the window ---------- */
  // Only a pointer that really moves over them spreads them: one resting where a toast appears doesn't.
  root.addEventListener('pointermove', e => {
    if (st.hover || (e.pointerType === 'mouse' && !e.movementX && !e.movementY)) return;
    st.hover = true; sync();
  });
  root.addEventListener('pointerdown', () => { if (!st.hover) { st.hover = true; sync(); } });
  root.addEventListener('pointerleave', () => { if (st.hover) { st.hover = false; sync(); } });
  document.addEventListener('pointermove', e => { if (st.hover && !st.swipe && !root.contains(e.target)) { st.hover = false; sync(); } }, { passive: true });
  root.addEventListener('focusin', e => {
    if (e.relatedTarget instanceof Element && !root.contains(e.relatedTarget)) st.back = e.relatedTarget;
    if (!st.focus) { st.focus = true; sync(); }
  });
  root.addEventListener('focusout', e => {
    if (e.relatedTarget instanceof Element && root.contains(e.relatedTarget)) return;
    if (e.relatedTarget instanceof Element) st.back = null;   // the keyboard went somewhere else itself
    st.focus = false; sync();
  });
  document.addEventListener('visibilitychange', sync);
  // F6 goes to the newest toast (its button, if it has one); F6 again, or Esc, goes back.
  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const inside = root.contains(document.activeElement);
    if (e.key === 'F6') {
      if (inside) { e.preventDefault(); goBack(); return; }
      const t = live[live.length - 1];
      if (!t) return;
      const was = document.activeElement;
      (t.el.querySelector('.toast-act') || t.el).focus({ preventScroll: true });
      if (!root.contains(document.activeElement)) return;   // behind an open dialog: out of reach
      st.back = was && was !== document.body ? was : null;
      e.preventDefault();
    } else if (e.key === 'Escape' && inside) {
      e.preventDefault(); e.stopPropagation(); goBack();
    }
  }, true);
  // Sizes change with the window, the look, and fonts that arrive late.
  const remeasure = () => { clearTimeout(st.rz); st.rz = setTimeout(() => { if (live.length) layout(); }, 100); };
  window.addEventListener('resize', remeasure);
  document.addEventListener('lookchange', remeasure);
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', remeasure);

  // A slow job: "loading" while it runs, then what came of it. Returns the job, so it can be awaited.
  function promise(job, { loading = 'Working on it…', success = null, error = null, ms = 5000 } = {}) {
    const id = `p${++st.n}`, p = Promise.resolve(job);
    show(loading, Infinity, null, { id, tone: 'loading' });
    p.then(v => {
      const m = typeof success === 'function' ? success(v) : success;
      if (m) show(m, ms, null, { id, tone: 'success' }); else close(id);
    }, err => {
      const raw = err && err.message ? err.message : String(err ?? '');
      const m = typeof error === 'function' ? error(err) : error || raw;
      if (m && raw !== 'Reloading…') show(m, 9000, null, { id, tone: 'error' }); else close(id);
    });
    return job;
  }
  function close(id) {
    if (id == null) { for (const t of live.slice()) dismiss(t); return; }
    const t = live.find(x => x.id === id);
    if (t) dismiss(t);
  }

  return { show, promise, dismiss: close, live };
})();
// A short message at the bottom. With an action ({ label, run }), it carries a button, like Undo.
// opts: { tone: 'error' | 'success' | 'loading', id } (an id updates that toast in place).
function toast(msg, ms = 5000, action = null, opts = null) { Toaster.show(msg, ms, action, opts); }
toast.promise = (job, o) => Toaster.promise(job, o);
toast.dismiss = id => Toaster.dismiss(id);
