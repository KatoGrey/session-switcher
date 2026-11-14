'use strict';
/* Numbers that roll to a new value, in the spirit of NumberFlow, and the dials' rings and the usage bars
   that sweep to theirs. Pages are drawn as HTML strings and redrawn when usage comes in, so a render
   writes Roll.num(key, value) (or Roll.attrs(…) on a ring or bar) and, once it's on the page, each one
   carries on from what was last shown for its key. The first time a key is shown, with motion turned
   off (here or by the system), in Ryan's saga themes, or with the window hidden, it's simply set.
   While a number rolls its digits are still its text, so it reads (and copies) as the new value. */
const Roll = (() => {
  const DUR = 700, EASE = 'cubic-bezier(.22, 1, .36, 1)';
  const shown = new Map();   // kind|key → { v, from, t0 }: what was shown last, and a roll under way
  const marked = document.getElementsByClassName('nf-k');   // live, so finding new ones costs next to nothing
  let queued = false;
  const ok = () => typeof motionOk === 'function' && motionOk() && !document.hidden && !(typeof sagaLook === 'function' && sagaLook());
  // After the render that wrote it is on the page (a microtask runs once the current script is done).
  const soon = () => { if (!queued) { queued = true; queueMicrotask(run); } };
  function attrs(as, key, value, cls = '') {
    soon();
    return ` class="nf-k${cls ? ` ${cls}` : ''}" data-nf="${esc(key)}" data-nf-as="${as}" data-v="${esc(String(value))}"`;
  }
  // A whole number that rolls: "42" in "42% left".
  const num = (key, value) => `<span${attrs('roll', key, value, 'nf')}>${esc(String(value))}</span>`;
  // The same inside an SVG's <text>, where it counts to the new value instead.
  const count = (key, value) => `<tspan${attrs('count', key, value)}>${esc(String(value))}</tspan>`;
  function run() {
    queued = false;
    const now = performance.now(), go = ok();
    for (const el of [...marked]) {
      if (el._nf) continue;
      el._nf = true;
      const as = el.getAttribute('data-nf-as'), v = el.getAttribute('data-v');
      const id = `${as === 'count' ? 'roll' : as}|${el.getAttribute('data-nf')}`, was = shown.get(id);
      let from = null, at = 0;
      if (!was) shown.set(id, { v, from: null, t0: 0 });
      else if (was.v !== v) { from = was.v; shown.set(id, { v, from, t0: now }); }
      // Drawn again mid-roll with the same value (the bar redraws often): it carries on where it was.
      else if (was.from !== null && now - was.t0 < DUR) { from = was.from; at = now - was.t0; }
      if (from === null || !go) continue;
      try {
        if (as === 'roll') roll(el, from, v, at);
        else if (as === 'count') countUp(el, from, v, at);
        else if (as === 'arc') sweep(el, from, v, at);
        else if (as === 'width') widen(el, from, v, at);
      } catch { /* an older browser: the value is already set */ }
    }
  }
  const timed = (anim, at) => { if (at) anim.currentTime = at; return anim; };
  // Each digit that changes is a column of 0–9 twice, sliding the way the number moved (up when it
  // grew), so 19 → 20 turns over like an odometer. A digit that comes or goes opens or closes its space.
  function roll(el, from, to, at) {
    if (!/^\d{1,6}$/.test(from) || !/^\d{1,6}$/.test(to)) return;
    const up = Number(to) > Number(from), len = Math.max(from.length, to.length);
    const a = from.padStart(len, ' '), b = to.padStart(len, ' ');
    let html = '';
    for (let i = 0; i < len; i++) {
      if (a[i] === b[i]) html += b[i];
      else if (b[i] === ' ') html += '<span class="nf-d out" aria-hidden="true"><span class="nf-s"></span></span>';
      else html += `<span class="nf-d${a[i] === ' ' ? ' in' : ''}"><span class="nf-g">${b[i]}</span><span class="nf-s" aria-hidden="true"></span></span>`;
    }
    const token = (el._roll = (el._roll || 0) + 1);
    el.innerHTML = html;
    el.classList.add('rolling');
    const cols = [...el.querySelectorAll('.nf-d')], ref = cols.find(d => !d.classList.contains('out'));
    const box = (ref || el).getBoundingClientRect(), H = box.height, W = ref ? box.width : el.getBoundingClientRect().width / Math.max(1, to.length);
    const done = () => { if (el._roll === token) { el.textContent = to; el.classList.remove('rolling'); } };
    if (!H) { done(); return; }   // not on screen: nothing to see
    const anims = [];
    let k = 0;
    for (let i = 0; i < len; i++) {
      if (a[i] === b[i]) continue;
      const d = cols[k++], strip = d.lastElementChild, x = a[i] === ' ' ? null : Number(a[i]), y = b[i] === ' ' ? null : Number(b[i]);
      const opts = { duration: DUR, easing: EASE, fill: 'both' };
      if (x === null || y === null) {
        strip.style.transform = `translateY(${-(x === null ? y : x) * H}px)`;
        if (y === null) d.style.width = `${W}px`;
        const open = [{ width: '0px', opacity: 0 }, { width: `${W}px`, opacity: 1 }];
        anims.push(timed(d.animate(y === null ? open.reverse() : open, opts), at));
        continue;
      }
      const f = up ? x : x >= y ? x : x + 10, t = up ? (y >= x ? y : y + 10) : y;
      anims.push(timed(strip.animate([{ transform: `translateY(${-f * H}px)` }, { transform: `translateY(${-t * H}px)` }], opts), at));
    }
    Promise.all(anims.map(x => x.finished)).then(done, done);
  }
  function countUp(el, from, to, at) {
    const a = Number(from), b = Number(to);
    if (!isFinite(a) || !isFinite(b)) return;
    const token = (el._roll = (el._roll || 0) + 1), t0 = performance.now() - at;
    const step = now => {
      if (el._roll !== token || !el.isConnected) return;
      const p = Math.min(1, Math.max(0, (now - t0) / DUR));
      el.textContent = p >= 1 ? to : String(Math.round(a + (b - a) * (1 - Math.pow(1 - p, 4))));
      if (p < 1) requestAnimationFrame(step);
    };
    step(performance.now());
  }
  // A ring: from what it showed to what it shows now (its drawn value stays in its attributes).
  function sweep(el, from, to, at) {
    const c = parseFloat(el.getAttribute('stroke-dasharray')), f = Number(from), t = Number(to);
    if (!(c > 0) || !isFinite(f) || !isFinite(t)) return;
    const off = x => `${(c * (1 - Math.max(0, Math.min(1, x)))).toFixed(2)}px`;
    timed(el.animate([{ strokeDashoffset: off(f) }, { strokeDashoffset: off(t) }], { duration: DUR, easing: EASE }), at);
  }
  // A bar: its width, in percent.
  function widen(el, from, to, at) {
    const f = Number(from), t = Number(to);
    if (!isFinite(f) || !isFinite(t)) return;
    const pc = x => `${Math.max(0, Math.min(100, x))}%`;
    timed(el.animate([{ width: pc(f) }, { width: pc(t) }], { duration: DUR, easing: EASE }), at);
  }
  return { num, count, attrs };
})();
