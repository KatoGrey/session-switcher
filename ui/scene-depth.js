'use strict';
// Two planes: the complete painting and all its live lights move together; a transparent foreground
// moves a little further. Pointer driven only: no perpetual render loop and no work on touch devices.
(() => {
  const fine = matchMedia('(hover: hover) and (pointer: fine)'), reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const active = new Set();
  document.head.insertAdjacentHTML('beforeend', `<style id="sceneDepthStyle">
    .an-depth-wrap{position:absolute;inset:0;overflow:hidden;pointer-events:none}
    .an-depth-wrap>.an-scene{transform:translate3d(0,0,0) scale(1.025);transform-origin:center}
    .an-depth-front{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;transform:translate3d(0,0,0) scale(1.055);opacity:.78;-webkit-mask:linear-gradient(90deg,transparent,#000 18%);mask:linear-gradient(90deg,transparent,#000 18%)}
    [data-theme=isekai] .an-depth-front{top:auto;height:66%;object-fit:fill;opacity:.58}
    [data-mode=light][data-theme=isekai] .an-depth-front{opacity:.34}
    [data-theme=dungeon] .an-depth-front{opacity:.65}
    .an-depth-moving>.an-scene,.an-depth-moving>.an-depth-front{will-change:transform;transition:transform .32s cubic-bezier(.2,.7,.2,1)}
    @media(max-width:760px){[data-theme=isekai] .hero-art.status.painted .an-depth-wrap{position:relative;aspect-ratio:3/2}[data-theme=isekai] .an-depth-wrap>.an-scene{position:absolute;height:100%}.an-depth-front{-webkit-mask:none;mask:none}}
    @media(prefers-reduced-motion:reduce){.an-depth-wrap>.an-scene,.an-depth-front{transform:none!important;transition:none!important}}
    body:not(.motion) .an-depth-wrap>.an-scene,body:not(.motion) .an-depth-front{transform:none!important;transition:none!important}
  </style>`);
  const allowed = el => fine.matches && motionOk() && !document.hidden && !document.body.classList.contains('chat-open') && !el.closest('.hero-off');
  function attach(art) {
    if (art.querySelector('.an-depth-wrap')) return;
    const svg = art.querySelector(':scope > .an-scene'); if (!svg) return;
    const theme = art.classList.contains('status') ? 'isekai' : art.classList.contains('citadel') ? 'highfantasy' : art.classList.contains('delve') ? 'dungeon' : null;
    if (!theme) return;
    const front = new Image(); front.className = 'an-depth-front'; front.alt = ''; front.decoding = 'async';
    // Only alter the layout when the optional image loads. Broken or absent art keeps the base scene.
    front.onload = () => {
      if (!art.isConnected || art.querySelector('.an-depth-wrap')) return;
      const wrap = document.createElement('div'); wrap.className = 'an-depth-wrap';
      svg.before(wrap); wrap.append(svg, front);
      const hero = art.closest('.hero') || art;
      let frame = 0, point = null, cleanup = 0;
      function reset() {
        if (frame) cancelAnimationFrame(frame); frame = 0; point = null;
        if (!allowed(art) || !art.isConnected) wrap.classList.remove('an-depth-moving');
        svg.style.transform = ''; front.style.transform = '';
        clearTimeout(cleanup); cleanup = setTimeout(() => wrap.classList.remove('an-depth-moving'), 350);
      }
      const state = { art, reset }; active.add(state);
      hero.addEventListener('pointermove', e => {
        if (e.pointerType !== 'mouse' || !allowed(art)) return;
        point = [e.clientX, e.clientY];
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0; if (!point || !allowed(art)) return reset();
          const r = hero.getBoundingClientRect();
          const x = Math.max(-1, Math.min(1, (point[0] - r.left) / r.width * 2 - 1));
          const y = Math.max(-1, Math.min(1, (point[1] - r.top) / r.height * 2 - 1));
          clearTimeout(cleanup); wrap.classList.add('an-depth-moving');
          svg.style.transform = `translate3d(${(x * -2).toFixed(2)}px,${(y * -1.5).toFixed(2)}px,0) scale(1.025)`;
          front.style.transform = `translate3d(${(x * -6).toFixed(2)}px,${(y * -4).toFixed(2)}px,0) scale(1.055)`;
        });
      }, { passive: true });
      hero.addEventListener('pointerleave', reset, { passive: true });
    };
    front.src = `/art/${theme}-depth.webp`;
  }
  function scan() {
    for (const state of active) if (!state.art.isConnected) { state.reset(); active.delete(state); }
    document.querySelectorAll('#heroSlot .hero-art.painted').forEach(attach);
  }
  // Observe the page, not the conversation feed. Ordinary streamed text never triggers this scan.
  new MutationObserver(records => { if (records.some(r => [...r.addedNodes].some(n => n.nodeType === 1 && (n.matches?.('.hero-art.painted') || n.querySelector?.('.hero-art.painted'))))) scan(); }).observe($('page'), { childList: true, subtree: true });
  const resetAll = () => { for (const s of active) s.reset(); };
  document.addEventListener('visibilitychange', resetAll); reduced.addEventListener('change', resetAll); fine.addEventListener('change', resetAll);
  new MutationObserver(resetAll).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  scan();
})();
