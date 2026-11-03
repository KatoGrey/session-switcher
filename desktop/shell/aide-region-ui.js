'use strict';
const image = document.getElementById('screen'), box = document.getElementById('selection'), use = document.getElementById('use');
let start = null, rect = null, loaded = false, finished = false;
const point = e => ({ x: Math.max(0, Math.min(innerWidth, e.clientX)), y: Math.max(0, Math.min(innerHeight, e.clientY)) });
function finish(value) { if (!finished) { finished = true; window.regionCapture.select(value); } }
function draw(to) {
  const x = Math.min(start.x, to.x), y = Math.min(start.y, to.y), width = Math.abs(to.x - start.x), height = Math.abs(to.y - start.y);
  rect = { x: x / innerWidth, y: y / innerHeight, width: width / innerWidth, height: height / innerHeight };
  Object.assign(box.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
  box.hidden = false;
  document.getElementById('shade').hidden = true;
  use.disabled = width < 4 || height < 4;
  document.getElementById('size').textContent = `${Math.round(width)} × ${Math.round(height)}`;
}
document.addEventListener('pointerdown', e => {
  if (!loaded || e.button !== 0 || e.target.closest('.actions')) return;
  e.preventDefault();
  start = point(e); draw(start);
  document.body.setPointerCapture(e.pointerId);
});
document.addEventListener('pointermove', e => { if (start) draw(point(e)); });
document.addEventListener('pointerup', e => {
  if (!start) return;
  draw(point(e)); start = null;
  if (document.body.hasPointerCapture(e.pointerId)) document.body.releasePointerCapture(e.pointerId);
  if (!use.disabled) { document.getElementById('instruction').textContent = 'Use this area, or drag again to change it'; use.focus(); }
});
document.addEventListener('pointercancel', () => { start = null; });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); finish(null); }
  if (e.key === 'Enter' && !use.disabled && !start) { e.preventDefault(); finish(rect); }
});
document.getElementById('cancel').onclick = () => finish(null);
use.onclick = () => { if (rect && !use.disabled) finish(rect); };
image.onload = () => { loaded = true; window.regionCapture.shown(); };
image.onerror = () => finish(null);
window.regionCapture.ready(data => { image.src = data; });
