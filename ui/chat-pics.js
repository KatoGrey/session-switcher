'use strict';
/* Pictures in the chat. Each reply shows its pictures where you can see them, under the reply (not
   folded away inside its steps): the ones it looked at, the ones it made or changed (a screenshot it
   took, a sprite it drew), and the ones it mentions by path. One picture shows large; several make a
   grid. Clicking any picture in the chat opens the viewer: step through every picture in the chat,
   zoom in, open it, show it in its folder, copy it, or attach it to your next message. */

const PIC_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const PIC_HOW = { looked: 'Looked at', made: 'Made', changed: 'Changed', mentioned: '' };
const PIC_MAX = 6;   // shown in a reply's grid; the rest are a "+N" tile

// A reply's pictures: kept on the turn, drawn as one strip.
function picsOf(turn) {
  if (!turn._pics) turn._pics = { list: [], seen: new Set() };
  return turn._pics;
}
const picKey = p => String(p).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
// im: { path } or { src } (a picture sent inline, as Claude's Read returns it); how: looked | made | changed | mentioned.
function addPic(turn, im, how, label) {
  if (!turn || !im || (!im.path && !im.src)) return;
  // A picture sent inline: known by its length and its end (two screenshots of one size differ there).
  const k = im.path ? picKey(im.path) : `${im.src.length}:${im.src.slice(-160)}`;
  const st = picsOf(turn);
  // The same file by another path ("art/x.png" and its full path) is the same picture.
  const same = x => x === k || x.endsWith(`/${k}`) || k.endsWith(`/${x}`);
  if (st.seen.has(k) || (im.path && [...st.seen].some(same))) {
    // Seen before as "mentioned": what it did with it says more.
    const was = st.list.find(x => same(x.k));
    if (was && was.how === 'mentioned' && how !== 'mentioned') { was.how = how; picStripSoon(turn); }
    return;
  }
  st.seen.add(k);
  st.list.push({ k, path: im.path || null, src: im.path ? imageUrl(im.path) : im.src, how, label: label || (im.path ? base(im.path) : '') });
  picStripSoon(turn);
}
// A picture shown in the reply already (one Codex drew, one written as ![…](…)) isn't repeated.
function picShown(turn, p) { if (turn && p) picsOf(turn).seen.add(picKey(p)); }

function picStripSoon(turn) {
  if (turn._picT) return;
  turn._picT = requestAnimationFrame(() => { turn._picT = 0; renderPicStrip(turn); });
}
function renderPicStrip(turn) {
  const st = picsOf(turn);
  let el = turn.querySelector(':scope > .pics');
  if (!st.list.length) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.className = 'pics'; turn.appendChild(el); }
  const n = st.list.length, shown = st.list.slice(0, n > PIC_MAX ? PIC_MAX - 1 : PIC_MAX);
  el.className = `pics n${Math.min(n, 4)}`;
  el.setAttribute('aria-label', `${n} picture${n === 1 ? '' : 's'} in this reply`);
  const tile = x => `<figure class="pic" data-how="${x.how}"><button type="button" class="pic-b" data-full="${esc(x.src)}" data-cap="${esc(x.label)}"${x.path ? ` data-path="${esc(x.path)}"` : ''} aria-label="Show ${esc(x.label || 'the picture')} larger"><img src="${esc(x.src)}" alt="${esc(x.label || 'A picture')}" loading="lazy" decoding="async" onerror="picGone(this)"></button><figcaption>${PIC_HOW[x.how] ? `<i>${PIC_HOW[x.how]}</i> ` : ''}${esc(x.label)}</figcaption></figure>`;
  const more = n > shown.length ? `<button type="button" class="pic-more" data-pic-more="${shown.length}">+${n - shown.length}<small>more</small></button>` : '';
  withStick(() => { el.innerHTML = shown.map(tile).join('') + more; });
}
// A picture that can't load (moved, or never there: a path in a sentence) leaves quietly.
function picGone(img) {
  const fig = img.closest('.pic'), turn = img.closest('.turn');
  if (!fig || !turn) return;
  const st = picsOf(turn), src = img.getAttribute('src');
  st.list = st.list.filter(x => x.src !== src);
  fig.remove();
  if (!st.list.length) turn.querySelector(':scope > .pics')?.remove();
  else picStripSoon(turn);
}

// From a reply's text: pictures it mentions by path (`shots/home.png`, art/hero.webp).
function picsFromText(turn, el) {
  for (const a of el.querySelectorAll('.flink[data-path]')) if (PIC_RE.test(a.dataset.path) && !/^https?:/i.test(a.dataset.path)) addPic(turn, { path: a.dataset.path }, 'mentioned');
  for (const im of el.querySelectorAll('.mdimg [data-path]')) picShown(turn, im.dataset.path);
}
// From a step: what it looked at (a picture it read, or a screenshot a tool returned).
function picsFromTool(turn, b, result) {
  const r = result || b.result; if (!r || !r.images || !r.images.length) return;
  const p = (b.meta && b.meta.path) || (b.name === 'Read' ? b.summary : null);
  r.images.forEach((im, i) => {
    if (im.path) addPic(turn, { path: im.path }, 'looked');
    else if (im.src && p && PIC_RE.test(p) && i === 0) addPic(turn, { path: p }, 'looked');
    else if (im.src) addPic(turn, { src: im.src }, 'looked', b.summary && !/\s/.test(b.summary) ? base(b.summary) : 'A screenshot');
  });
}
// From a reply's changes: pictures it made or changed.
function picsFromChanges(turn, ev) {
  // Their paths are from the top of the git repository, which may be above the project's folder.
  const top = ev.top ? String(ev.top).replace(/[\\/]+$/, '') : '';
  for (const f of ev.files || []) if (PIC_RE.test(f.path) && f.status !== 'deleted' && !f.meanwhile) addPic(turn, { path: top ? `${top}/${f.path}` : f.path }, f.status === 'added' ? 'made' : 'changed', base(f.path));
}

/* ---------- the viewer ---------- */
const Gallery = { list: [], i: 0, zoom: false, drag: null, touch: null };
// Every picture in the chat, in order (each once).
function galleryList() {
  const seen = new Set(), out = [];
  const add = x => { if (x.src && !seen.has(x.src)) { seen.add(x.src); out.push(x); } };
  // In order down the chat; a reply's strip counts all its pictures, the ones behind "+N" too.
  for (const el of $c('cFeed').querySelectorAll('[data-full], .pics')) {
    if (el.classList.contains('pics')) {
      const turn = el.closest('.turn');
      for (const x of (turn && turn._pics ? turn._pics.list : [])) add({ src: x.src, path: x.path, cap: x.label || '' });
      continue;
    }
    if (el.closest('.pics') || el.closest('.gone')) continue;
    const img = el.querySelector('img');
    add({ src: el.dataset.full, path: el.dataset.path || el.closest('.gen')?.querySelector('[data-file]')?.dataset.file || null, cap: el.dataset.cap || (img && img.alt !== 'Image' ? img.alt : '') || '' });
  }
  return out;
}
function openGallery(src, from) {
  Gallery.back = document.activeElement;   // focus goes back there when it closes
  Gallery.list = galleryList();
  let i = Gallery.list.findIndex(x => x.src === src);
  if (i < 0) { Gallery.list.unshift({ src, path: (from && from.dataset.path) || null, cap: (from && from.dataset.cap) || '' }); i = 0; }
  Gallery.i = i;
  const lb = $c('cLight');
  lb.hidden = false;
  galleryShow();
  lb.focus();
}
function galleryShow() {
  const lb = $c('cLight'), x = Gallery.list[Gallery.i]; if (!x) return;
  Gallery.zoom = false;
  lb.classList.remove('zoomed');
  lb.querySelector('[data-lb="zoom"]').textContent = 'Actual size';
  const img = lb.querySelector('.lb-stage img');
  img.src = x.src; img.alt = x.cap || 'A picture from this chat';
  const n = Gallery.list.length;
  lb.querySelector('.lb-cap').textContent = x.cap || (x.path ? base(x.path) : 'A picture from this chat');
  lb.querySelector('.lb-n').textContent = n > 1 ? `${Gallery.i + 1} of ${n}` : '';
  for (const b of lb.querySelectorAll('.lb-nav')) b.hidden = n < 2;
  for (const b of lb.querySelectorAll('[data-lb="open"], [data-lb="reveal"]')) b.hidden = !x.path || !!window.REMOTE && b.dataset.lb === 'reveal';
  lb.querySelector('[data-lb="attach"]').hidden = !!C.watch || !C.key;
}
function galleryStep(d) {
  if (Gallery.list.length < 2) return;
  Gallery.i = (Gallery.i + d + Gallery.list.length) % Gallery.list.length;
  galleryShow();
}
// Actual size (scroll or drag around it) or fitted to the screen.
function galleryZoom(on = !Gallery.zoom, at = null) {
  const lb = $c('cLight'), stage = lb.querySelector('.lb-stage'), img = stage.querySelector('img');
  if (on && img.naturalWidth <= stage.clientWidth && img.naturalHeight <= stage.clientHeight) { toast('That’s its actual size.', 1500); return; }
  Gallery.zoom = on;
  lb.classList.toggle('zoomed', on);
  lb.querySelector('[data-lb="zoom"]').textContent = on ? 'Fit to screen' : 'Actual size';
  if (on && at) {
    const r = img.getBoundingClientRect();
    const fx = (at.x - r.left) / r.width, fy = (at.y - r.top) / r.height;
    requestAnimationFrame(() => { stage.scrollLeft = fx * img.naturalWidth - stage.clientWidth / 2; stage.scrollTop = fy * img.naturalHeight - stage.clientHeight / 2; });
  }
}
function galleryClose() { $c('cLight').hidden = true; Gallery.list = []; const back = Gallery.back; Gallery.back = null; if (back && back.isConnected) back.focus({ preventScroll: true }); }
function closeLightbox() { if ($c('cLight').hidden) return false; galleryClose(); return true; }
async function galleryAct(what) {
  const x = Gallery.list[Gallery.i]; if (!x) return;
  if (what === 'open' && x.path) { galleryClose(); return openFile(x.path); }
  if (what === 'reveal' && x.path) { const r = await api('/api/reveal', { path: x.path, key: C.key, session: C.sessionId }); if (r.dryRun) toast(`Would run: ${r.script}`); return; }
  if (what === 'copy') return copyImage(x.src);
  if (what === 'attach') {
    const blob = await (await fetch(x.src)).blob();
    if (!/^image\/(png|jpeg|gif|webp)$/.test(blob.type)) { toast('That picture’s format can’t be attached.'); return; }
    if (blob.size > 5 * 1024 * 1024) { toast('That picture is over 5 MB, so it can’t be attached. Mention its path instead.', 6000); return; }
    const data = await new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(blob); });
    C.attachments.push({ mediaType: blob.type, data: data.slice(data.indexOf(',') + 1) });
    renderAttachments();
    galleryClose();
    if (x.path) placeText(`(This is \`${x.path}\`.) `, false);
    toast('Attached to your next message.', 2000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const lb = $c('cLight'); if (!lb) return;
  // Over everything, the top bar too (inside the chat it would sit under it).
  document.body.appendChild(lb);
  const stage = lb.querySelector('.lb-stage');
  lb.addEventListener('click', e => {
    const b = e.target.closest('[data-lb]');
    if (b) { e.stopPropagation(); const w = b.dataset.lb; if (w === 'prev') return galleryStep(-1); if (w === 'next') return galleryStep(1); if (w === 'close') return galleryClose(); if (w === 'zoom') return galleryZoom(); return wrap(galleryAct)(w); }
    if (e.target.tagName === 'IMG') { if (Gallery.dragged) { Gallery.dragged = false; return undefined; } return galleryZoom(undefined, { x: e.clientX, y: e.clientY }); }
    // Anywhere else (the dark around it) closes it.
    if (!e.target.closest('.lb-bar')) galleryClose();
    return undefined;
  });
  lb.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { galleryStep(-1); e.preventDefault(); } else if (e.key === 'ArrowRight') { galleryStep(1); e.preventDefault(); }
    else if (e.key === '+' || e.key === '=') galleryZoom(true); else if (e.key === '-' || e.key === '0') galleryZoom(false);
  });
  // Zoomed in: drag to look around.
  stage.addEventListener('pointerdown', e => { if (!Gallery.zoom || e.pointerType === 'touch') return; Gallery.drag = { x: e.clientX, y: e.clientY, l: stage.scrollLeft, t: stage.scrollTop, moved: 0 }; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', e => { const d = Gallery.drag; if (!d) return; d.moved = Math.max(d.moved, Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y)); stage.scrollLeft = d.l - (e.clientX - d.x); stage.scrollTop = d.t - (e.clientY - d.y); });
  stage.addEventListener('pointerup', () => { if (Gallery.drag && Gallery.drag.moved > 4) Gallery.dragged = true; Gallery.drag = null; });
  // On a phone: swipe to the next one; a double tap zooms.
  stage.addEventListener('touchstart', e => { if (e.touches.length === 1) Gallery.touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }; }, { passive: true });
  stage.addEventListener('touchend', e => {
    const s = Gallery.touch; Gallery.touch = null; if (!s || Gallery.zoom) return;
    const t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - s.t < 600) { galleryStep(dx < 0 ? 1 : -1); Gallery.dragged = true; setTimeout(() => { Gallery.dragged = false; }, 350); }
  }, { passive: true });
  // The "+N more" tile opens the viewer at the first one not shown.
  $c('cFeed').addEventListener('click', e => {
    const m = e.target.closest('[data-pic-more]'); if (!m) return;
    const turn = m.closest('.turn'), x = picsOf(turn).list[Number(m.dataset.picMore)];
    if (x) openGallery(x.src);
  });
});
