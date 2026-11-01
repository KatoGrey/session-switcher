'use strict';
/* The picture board: a project's Gallery tab, for going through what an agent drew. Its folders down the
   side, newest first, each with how far you've got; the pictures as small copies made here and kept in the
   browser, so a folder of big files scrolls; K keep, R redo with a note, one by one at full size in the
   picture viewer or right on the grid; the same name in another folder side by side; and the redo list
   handed to a chat in one go. A picture that's been made again comes back to review by itself. */

const BD_CHUNK = 240;
const Board = {
  cwd: null, dir: null, dirs: [], items: [], byRel: new Map(), totals: { keep: 0, redo: 0, again: 0 },
  filter: 'all', sort: store('boardSort') || 'name', size: Number(store('boardSize')) || 190,
  find: '', picQ: '', backDir: null, allDirs: false, shown: 0, seq: 0, loading: false, error: null, missing: false, capped: false, cursor: null,
};
const boardSrc = x => `${imageSrc(x.path, Board.cwd)}&v=${Math.round(x.mtime)}`;
const boardWord = { keep: 'Keep', redo: 'Redo', again: 'Made again' };
const boardState = x => x.mark || (x.was ? 'again' : '');
const boardMemo = cwd => `boardDir:${cwd}`;

function boardView() {
  const f = Board.filter;
  const list = Board.items.filter(x => f === 'all' || (f === 'todo' ? !x.mark : x.mark === f));
  return Board.dir !== ':new' && Board.sort === 'new' ? list.sort((a, b) => b.mtime - a.mtime) : list;
}
function boardCounts() {
  const c = { all: Board.items.length, todo: 0, keep: 0, redo: 0 };
  for (const x of Board.items) { if (!x.mark) c.todo++; else c[x.mark]++; }
  return c;
}

/* ---------- the small copies ---------- */
// The PC has nothing to shrink a picture with, so the page does it: read it, draw it small, keep the result
// in the browser under the file's path, time and size. A few at a time, nearest what you're looking at first.
const Thumbs = (() => {
  const WIDTH = 400, JOBS = 3, KEEP = 8000, SMALL = 150 * 1024;
  const urls = new Map();   // what's been shown since the folder opened
  const queue = [];
  let busy = 0, opening = null, stored = 0;
  const db = () => opening || (opening = new Promise(res => {
    try {
      const r = indexedDB.open('board-thumbs', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('t').createIndex('at', 'at');
      r.onsuccess = () => res(r.result);
      r.onerror = r.onblocked = () => res(null);
    } catch { res(null); }
  }));
  const keyOf = x => `${x.path}|${Math.round(x.mtime)}|${x.size}`;
  const read = async key => {
    const d = await db(); if (!d) return null;
    return new Promise(res => { try { const q = d.transaction('t').objectStore('t').get(key); q.onsuccess = () => res(q.result ? q.result.blob : null); q.onerror = () => res(null); } catch { res(null); } });
  };
  // At most so many: the ones looked at longest ago go.
  const trim = d => {
    try {
      const s = d.transaction('t', 'readwrite').objectStore('t'), n = s.count();
      n.onsuccess = () => {
        let over = n.result - KEEP; if (over <= 0) return;
        over += 400;
        s.index('at').openCursor().onsuccess = e => { const c = e.target.result; if (c && over-- > 0) { c.delete(); c.continue(); } };
      };
    } catch { /* next time */ }
  };
  const write = async (key, blob) => {
    const d = await db(); if (!d) return;
    try { d.transaction('t', 'readwrite').objectStore('t').put({ blob, at: Date.now() }, key); } catch { return; }
    if (++stored % 200 === 0) trim(d);
  };
  async function make(x) {
    const r = await fetch(boardSrc(x));
    if (!r.ok) throw new Error('unreadable');
    const blob = await r.blob();
    if (x.size <= SMALL || typeof OffscreenCanvas === 'undefined') return { blob, small: true };
    let bmp;
    try { bmp = await createImageBitmap(blob, { resizeWidth: WIDTH, resizeQuality: 'high' }); } catch (err) { if (err.name === 'TypeError') return { blob, small: true }; throw err; }
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext('2d').drawImage(bmp, 0, 0); bmp.close();
    return { blob: await c.convertToBlob({ type: 'image/webp', quality: 0.82 }) };
  }
  function show(tile, url) {
    const img = tile.querySelector('.bd-pic img'); if (!img) return;
    img.onload = () => boardShape(img);
    img.src = url; img.hidden = false;
    tile.classList.remove('broke');
  }
  async function load(tile) {
    const x = Board.byRel.get(tile.dataset.rel); if (!x) return;
    const key = keyOf(x);
    try {
      if (!urls.has(key)) {
        let blob = await read(key);
        if (!blob) { const made = await make(x); blob = made.blob; if (!made.small) write(key, blob); }
        urls.set(key, URL.createObjectURL(blob));
      }
      if (tile.isConnected) show(tile, urls.get(key));
    } catch { tile.classList.add('broke'); }
  }
  function pump() {
    while (busy < JOBS && queue.length) {
      const tile = queue.pop();   // the last one asked for is the one on screen
      if (!tile.isConnected || !tile._near) { tile._asked = false; continue; }
      busy++;
      load(tile).finally(() => { busy--; pump(); });
    }
  }
  const io = new IntersectionObserver(es => {
    for (const e of es) {
      e.target._near = e.isIntersecting;
      if (e.isIntersecting && !e.target._asked) { e.target._asked = true; queue.push(e.target); }
    }
    pump();
  }, { rootMargin: '500px' });
  return {
    // A small copy of this picture, from the browser's keeping if it's there.
    async blobOf(x) {
      const key = keyOf(x);
      let blob = await read(key);
      if (!blob) { const made = await make(x); blob = made.blob; if (!made.small) write(key, blob); }
      return blob;
    },
    attach(tile, x) {
      const u = urls.get(keyOf(x));
      if (u) show(tile, u); else io.observe(tile);
    },
    // The folder's closed: what it held goes.
    reset() { queue.length = 0; io.disconnect(); for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); },
  };
})();

// Tiles take the shape of what's in this project, tall or wide, so the pictures fill them.
function boardShape(img) {
  if (!img.naturalWidth || !img.naturalHeight || !$('bdRoot')) return;
  const seen = Board.shapes || (Board.shapes = []);
  if (seen.length >= 60) return;
  seen.push(img.naturalWidth / img.naturalHeight);
  if (seen.length !== 4 && seen.length !== 20 && seen.length !== 60) return;
  const mid = [...seen].sort((a, b) => a - b)[seen.length >> 1];
  const r = Math.round(Math.max(0.66, Math.min(1.6, mid)) * 100) / 100;
  store(`boardShape:${Board.cwd}`, String(r));
  $('bdRoot').style.setProperty('--bd-shape', String(r));
}

/* ---------- reading ---------- */
async function boardLoad({ fresh = false, quiet = false } = {}) {
  const cwd = Board.cwd, seq = ++Board.seq;
  if (!quiet) { Board.loading = true; boardDraw(); }
  let r;
  try {
    r = await api(`/api/board?${new URLSearchParams({ cwd, dir: Board.dir, ...(fresh ? { fresh: '1' } : {}), ...(Board.dir === ':find' ? { q: Board.picQ } : {}), ...(Board.scanAt && Board.dirs.length ? { have: String(Board.scanAt) } : {}) })}`);
  } catch (err) {
    if (seq !== Board.seq) return;
    Board.loading = false;
    if (!quiet) { Board.error = err.message; boardDraw(); }
    return;
  }
  if (seq !== Board.seq || cwd !== Board.cwd) return;
  const before = Board.dirs.length;
  const dirs = r.dirs || Board.dirs;
  if (!r.dirs) { const d = dirs.find(y => y.rel === r.dir); if (d) d.n = r.items.length; }
  Object.assign(Board, { loading: false, error: null, dir: r.dir, dirs, scanAt: r.scanAt, items: r.items, totals: r.totals, capped: !!r.capped, missing: !!r.missing, reading: !!r.reading, byRel: new Map(r.items.map(x => [x.rel, x])) });
  boardDraw();
  // A huge project's folders are still being read: back soon for them.
  if (r.reading) setTimeout(() => { if ($('bdRoot') && Board.cwd === cwd && $('cLight').hidden) boardLoad({ quiet: true }); }, 2500);
  // The tab can say how many there really are now.
  if (!before && S.view === 'folder' && S.folder === cwd) renderFolder();
}
// A picture by its name, in any folder. Clearing the box goes back to where you were.
let boardPicTimer = null;
function boardFindPicture(q) {
  Board.picQ = q;
  clearTimeout(boardPicTimer);
  boardPicTimer = setTimeout(() => {
    const words = Board.picQ.trim();
    if (!words) { const back = Board.backDir || ':new'; Board.backDir = null; if (Board.dir === ':find') boardOpenDir(back); return; }
    if (Board.dir !== ':find') { Board.backDir = Board.dir; boardOpenDir(':find'); } else boardLoad();
  }, 220);
}
function boardOpenDir(rel) {
  if (rel === Board.dir) return;
  if (rel !== ':find') { Board.backDir = null; if (Board.picQ) { Board.picQ = ''; const box = $('bdPicQ'); if (box) box.value = ''; } }
  Board.dir = rel; if (rel !== ':find') store(boardMemo(Board.cwd), rel);
  Board.items = []; Board.byRel = new Map(); Board.shown = 0; Board.cursor = null; Board.filter = 'all'; Board.shapes = [];
  const g = $('bdGrid'); if (g) { g.innerHTML = ''; g._sig = null; }
  Thumbs.reset();
  const root = $('bdRoot');
  if (!root) return;   // not on the page yet: it reads this folder when it's drawn
  const top = root.getBoundingClientRect().top;
  if (top < 0) scrollBy(0, top - 70);
  boardLoad();
}
let boardSoonTimer = null;
const boardLoadSoon = () => { clearTimeout(boardSoonTimer); boardSoonTimer = setTimeout(() => { if ($('bdRoot') && $('cLight').hidden) boardLoad({ quiet: true }); }, 800); };

/* ---------- marking ---------- */
// Shows at once; if the PC says no, it goes back and says why.
async function boardMark(rels, mark, note) {
  const hit = rels.map(r => Board.byRel.get(r)).filter(Boolean);
  const back = hit.map(x => ({ x, mark: x.mark, note: x.note, was: x.was }));
  for (const x of hit) { x.mark = mark; x.note = note !== undefined ? note : mark === 'redo' ? x.note || '' : ''; delete x.was; }
  Board.seq++;   // a reading already on its way predates this
  const d = Board.dirs.find(y => y.rel === Board.dir);
  if (d) { const c = boardCounts(); d.keep = c.keep; d.redo = c.redo; }
  boardDraw();
  try {
    const r = await api('/api/board/mark', { cwd: Board.cwd, rels, mark, note: hit.length === 1 ? hit[0].note : '' });
    if (r.totals) { Board.totals = r.totals; boardDrawSide(); }
    if (Board.dir.startsWith(':')) boardLoadSoon();
  } catch (err) {
    for (const b of back) Object.assign(b.x, { mark: b.mark, note: b.note }, b.was ? { was: b.was } : {});
    boardDraw();
    throw err;
  }
}
// Every mark in this list, put back as it was (for Undo).
function boardUndoOf(list) {
  const was = list.map(x => ({ rel: x.rel, mark: x.mark, note: x.note }));
  return async () => { for (const w of was) await boardMark([w.rel], w.mark, w.note); };
}
async function boardMarkMany(list, mark, say) {
  const undo = boardUndoOf(list);
  await boardMark(list.map(x => x.rel), mark);
  toast(say, 7000, { label: 'Undo', run: undo });
}

/* ---------- the page ---------- */
function boardShell() {
  return `<div class="bd" id="bdRoot" style="--bd-size:${Board.size}px;--bd-shape:${Number(store(`boardShape:${Board.cwd}`)) || 1}">
    <aside class="bd-side" aria-label="Folders with pictures">
      <label class="wb-filter bd-find"><span class="sr">Find a folder</span><input type="search" id="bdFind" placeholder="Find a folder" autocomplete="off" spellcheck="false" value="${esc(Board.find)}"></label>
      <ul class="bd-dirs" id="bdDirs"></ul>
    </aside>
    <div class="bd-main">
      <div class="bd-head"><div class="bd-title" id="bdTitle"></div><div class="bd-acts" id="bdActs"></div></div>
      <div class="bd-tools">
        <label class="wb-filter bd-picq"><span class="sr">Find a picture by name, in any folder</span><input type="search" id="bdPicQ" placeholder="Find a picture by name" autocomplete="off" spellcheck="false" value="${esc(Board.picQ)}"></label>
        <div id="bdFilters"></div>
        <label class="bd-tune" id="bdSortWrap">Order
          <select id="bdSort"><option value="name" ${Board.sort === 'name' ? 'selected' : ''}>By name</option><option value="new" ${Board.sort === 'new' ? 'selected' : ''}>Newest first</option></select></label>
        <label class="bd-tune">Size <input type="range" id="bdSize" min="110" max="420" step="10" value="${Board.size}" aria-label="Size of the pictures"></label>
      </div>
      <ul class="bd-grid" id="bdGrid" aria-label="Pictures"></ul>
      <div class="bd-more" id="bdMore" aria-hidden="true"></div>
      <p class="bd-keys">Arrow keys move, Enter opens, <span class="kbd">K</span> keep, <span class="kbd">R</span> redo, <span class="kbd">U</span> take it back.</p>
    </div>
  </div>`;
}
// A project's Gallery tab. Called whenever the page redraws, so it only builds once.
function renderBoard(box, p, w, fresh) {
  const moved = Board.cwd !== p.cwd;
  if (moved) {
    Object.assign(Board, { cwd: p.cwd, dir: store(boardMemo(p.cwd)) || ':new', dirs: [], scanAt: null, items: [], byRel: new Map(), totals: { keep: 0, redo: 0, again: 0 }, filter: 'all', find: '', picQ: '', backDir: null, allDirs: false, shown: 0, cursor: null, error: null, missing: false, shapes: [] });
    Thumbs.reset();
  }
  if (moved || fresh || !$('bdRoot')) {
    box._h = null;
    box.innerHTML = boardShell();
    boardWatchMore();
    boardLoad();
    return;
  }
  boardDraw();
}
function boardDraw() {
  if (!$('bdRoot')) return;
  boardDrawSide(); boardDrawBar(); boardDrawGrid();
}
const boardPut = (id, h) => { const el = $(id); if (el && el._h !== h) { el.innerHTML = h; el._h = h; } };
function boardDrawSide() {
  const box = $('bdDirs'); if (!box) return;
  const q = Board.find.trim().toLowerCase(), t = Board.totals;
  const smart = q ? [] : [
    { rel: ':new', name: 'Newest', sub: 'wherever they are' },
    { rel: ':redo', name: 'To redo', n: t.redo + t.again, sub: t.again ? `${t.again} made again` : '' },
    { rel: ':keep', name: 'Kept', n: t.keep },
  ];
  const all = q ? Board.dirs.filter(d => d.rel.toLowerCase().includes(q)) : Board.dirs;
  const sorted = [...all].sort((a, b) => b.mtime - a.mtime);
  const cut = sorted.slice(0, Board.allDirs || q ? 3000 : 120);
  const rows = [
    ...smart.map(d => ({ ...d, kind: 'smart' })),
    ...(!q && Board.dirs.length ? [{ rel: ':sep', kind: 'sep' }] : []),
    ...(Board.reading ? [{ rel: ':reading', kind: 'reading' }] : []),
    ...cut.map(d => ({ ...d, kind: 'dir' })),
    ...(cut.length < sorted.length ? [{ rel: ':all', kind: 'all', n: sorted.length }] : []),
  ];
  patch(box, rows, d => d.rel, d => {
    if (d.kind === 'sep') return '<li class="bd-sep" role="presentation">Folders</li>';
    if (d.kind === 'reading') return '<li class="bd-none">Reading its folders…</li>';
    if (d.kind === 'all') return Board.allDirs || q ? `<li class="bd-none">And ${d.n - 3000} more. Find a folder narrows them.</li>` : `<li><button class="linkish bd-showall" data-bd-all>Show all ${d.n} folders</button></li>`;
    const on = d.rel === Board.dir;
    const count = d.n === undefined || (d.kind === 'smart' && !d.n) ? '' : `<span class="count">${d.n}</span>`;
    if (d.kind === 'smart') return `<li><button class="bd-dir smart ${on ? 'on' : ''}" data-bd-dir="${esc(d.rel)}" ${on ? 'aria-current="true"' : ''}><span class="bd-dt"><span class="bd-dl">${esc(d.name)}</span></span>${count}${d.sub ? `<span class="bd-dsub">${esc(d.sub)}</span>` : ''}</button></li>`;
    const cutAt = d.rel.lastIndexOf('/'), parent = cutAt >= 0 ? d.rel.slice(0, cutAt + 1) : '', leaf = d.rel === '.' ? 'The project’s own folder' : d.rel.slice(cutAt + 1);
    const done = (d.keep || 0) + (d.redo || 0);
    return `<li><button class="bd-dir ${on ? 'on' : ''}" data-bd-dir="${esc(d.rel)}" title="${esc(d.rel)}" ${on ? 'aria-current="true"' : ''}><span class="bd-dt">${parent ? `<span class="bd-dp">${esc(parent)}</span>` : ''}<span class="bd-dl">${esc(leaf)}</span></span>${count}${done ? `<span class="bd-prog" role="img" aria-label="${done} of ${d.n} reviewed"><i class="k" style="width:${(d.keep || 0) / d.n * 100}%"></i><i class="r" style="width:${(d.redo || 0) / d.n * 100}%"></i></span>` : ''}</button></li>`;
  }, `<li class="bd-none">${Board.loading ? 'Reading its folders…' : q ? 'No folder by that name.' : ''}</li>`);
}
function boardDrawBar() {
  const c = boardCounts(), d = Board.dir;
  const name = d === ':find' ? `Named like “${Board.picQ.trim()}”` : d === ':new' ? 'Newest pictures' : d === ':redo' ? 'To redo' : d === ':keep' ? 'Kept' : d === '.' ? 'The project’s own folder' : d;
  const note = Board.loading && !c.all ? 'Reading…' : Board.error ? '' : d === ':redo' ? 'What you’ve marked redo in any folder, and what’s been made again since.' : d === ':new' ? `${plural(c.all, 'picture')}, in any folder.` : plural(c.all, 'picture');
  boardPut('bdTitle', `<h2 class="bd-h">${esc(name)}</h2><p class="bd-sub">${esc(note)}${Board.capped ? ' This project is very big, so some folders weren’t read.' : ''}</p>`);
  const seg = [['all', 'All', c.all], ['todo', 'To review', c.todo], ['keep', 'Keep', c.keep], ['redo', 'Redo', c.redo]];
  boardPut('bdFilters', `<div class="seg bd-seg" role="group" aria-label="Show">${seg.map(([v, l, n]) => `<button class="${Board.filter === v ? 'on' : ''}" data-bd-filter="${v}" aria-pressed="${Board.filter === v}">${l} <span class="count">${n}</span></button>`).join('')}</div>`);
  boardPut('bdActs', `<button class="btn prime sm" data-bd-review ${boardView().length ? '' : 'disabled'}>${c.todo ? `Review ${c.todo} one by one` : 'Go through them'}</button>${c.redo ? `<button class="btn sm" data-bd-send aria-haspopup="menu" aria-expanded="false">Send the redo list (${c.redo})…</button>` : ''}<button class="icon" data-bd-more aria-haspopup="menu" aria-expanded="false" aria-label="More for these pictures">${ICON.more}</button>`);
  const wrapSort = $('bdSortWrap'); if (wrapSort) wrapSort.hidden = d === ':new';
}
function boardTile(x) {
  return `<li class="bd-t" data-rel="${esc(x.rel)}">
    <button class="bd-pic" data-bd-open tabindex="-1" aria-label="${esc(x.name)}"><img alt="" hidden decoding="async"><span class="bd-noimg">Can’t show this one</span></button>
    <span class="bd-flag" hidden></span><span class="bd-flag banner" hidden>Banner</span>
    <span class="bd-q"><button class="k" data-bd-mark="keep" tabindex="-1" aria-pressed="false" aria-label="Keep ${esc(x.name)}" title="Keep (K)">✓</button><button class="r" data-bd-mark="redo" tabindex="-1" aria-pressed="false" aria-label="Redo ${esc(x.name)}" title="Redo (R)">↻</button><button data-banner="${esc(x.path)}" tabindex="-1" aria-label="Use ${esc(x.name)} as this project’s banner" title="Use as this project’s banner">⚑</button></span>
    <div class="bd-cap"><span class="bd-n" title="${esc(x.rel)}">${esc(Board.dir.startsWith(':') ? x.rel : x.name)}</span><span class="bd-w" data-ago="${x.mtime}">${esc(agoL(x.mtime))}</span></div>
    <p class="bd-note" hidden></p>
  </li>`;
}
// What changes with a mark is set on the tile, not drawn again: the picture stays and so does the focus.
function boardPaint(t, x, banner) {
  const st = boardState(x);
  for (const c of ['keep', 'redo', 'again']) t.classList.toggle(c, st === c);
  const [flag, flagB] = t.querySelectorAll('.bd-flag');
  flag.textContent = boardWord[st] || ''; flag.hidden = !st;
  flagB.hidden = x.path !== banner;
  for (const b of t.querySelectorAll('[data-bd-mark]')) { const on = x.mark === b.dataset.bdMark; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  const useB = t.querySelector('[data-banner]'); useB.hidden = x.path === banner;
  const note = t.querySelector('.bd-note'); note.textContent = x.note || ''; note.title = x.note || ''; note.hidden = !x.note;
  t.querySelector('.bd-pic').setAttribute('aria-label', `${x.name}${st ? `, ${boardWord[st]}` : ''}${x.note ? `: ${x.note}` : ''}`);
}
function boardDrawGrid() {
  const g = $('bdGrid'); if (!g) return;
  const list = boardView();
  Board.shown = Math.min(list.length, Math.max(Board.shown, BD_CHUNK));
  const empty = Board.error ? `<li class="bd-empty">${esc(Board.error)}</li>`
    : Board.loading ? '<li class="bd-empty">Reading this folder…</li>'
      : Board.dir === ':find' && !Board.items.length ? '<li class="bd-empty">No picture here has that in its name.</li>'
      : Board.items.length ? `<li class="bd-empty">${Board.filter === 'todo' ? 'Nothing left to review here.' : `Nothing marked ${Board.filter === 'keep' ? 'keep' : 'redo'} here.`}</li>`
        : Board.dir === ':redo' ? '<li class="bd-empty">Nothing marked redo yet. Press R on a picture and it’s listed here, whichever folder it’s in.</li>'
          : Board.dir === ':keep' ? '<li class="bd-empty">Nothing marked keep yet. Press K on a picture and it’s listed here, whichever folder it’s in.</li>'
            : `<li class="bd-empty">No pictures here yet. Cover art, screenshots and anything Codex makes in this folder show up here.${codexReady() && coverPrompt() ? ` <button class="linkish" data-prompt="${esc(coverPrompt().id)}">Make a cover image with Codex</button>` : ''}</li>`;
  const shown = list.slice(0, Board.shown);
  patch(g, shown, x => `${x.rel}|${Math.round(x.mtime)}|${x.size}`, boardTile, empty);
  const w = S.worlds[Board.cwd], banner = w && w.banner;
  if (!shown.some(x => x.rel === Board.cursor)) Board.cursor = shown.length ? shown[0].rel : null;
  for (const t of g.children) {
    const x = t.dataset.rel && Board.byRel.get(t.dataset.rel); if (!x) continue;
    boardPaint(t, x, banner);
    t.querySelector('.bd-pic').tabIndex = x.rel === Board.cursor ? 0 : -1;
    if (!t._on) { t._on = true; Thumbs.attach(t, x); }
  }
  const more = $('bdMore'); if (more) { more.hidden = shown.length >= list.length; if (!more.hidden && Board.moreIO) { Board.moreIO.unobserve(more); Board.moreIO.observe(more); } }
}
// More of the folder as you get near the end of what's drawn.
function boardWatchMore() {
  if (Board.moreIO) Board.moreIO.disconnect();
  Board.moreIO = new IntersectionObserver(es => {
    if (es.some(e => e.isIntersecting) && Board.shown < boardView().length) { Board.shown += BD_CHUNK; boardDrawGrid(); }
  }, { rootMargin: '900px' });
  Board.moreIO.observe($('bdMore'));
}

/* ---------- one by one, in the picture viewer ---------- */
function boardReview(rel = null) {
  const list = boardView(); if (!list.length) return;
  const at = rel ? list.findIndex(x => x.rel === rel) : list.findIndex(x => !x.mark);
  const pics = list.map(x => ({ src: boardSrc(x), path: x.path, cwd: Board.cwd, cap: x.rel, noAttach: true, item: x }));
  openGallery(pics[Math.max(0, at)].src, null, pics, BoardReview);
}
const boardHere = () => { const p = Gallery.list[Gallery.i]; return p && p.item; };
function boardReviewNext() {
  if (Gallery.i < Gallery.list.length - 1) return galleryStep(1);
  const left = boardCounts().todo;
  $('lbRevLeft').textContent = left ? `That’s the last one here. ${left} still to review.` : 'That’s the last one. All reviewed.';
  return announce($('lbRevLeft').textContent);
}
function boardRevMark(what) {
  const x = boardHere(); if (!x) return;
  const was = { mark: x.mark, note: x.note };
  wrap(boardMark)([x.rel], what, what === 'keep' ? '' : x.note || '');
  BoardReview.show(Gallery.list[Gallery.i], true);
  if (what === 'keep') boardReviewNext();
  else { const n = $('lbRevNote'); n.focus(); n.select(); }
  return was;
}
function boardCompare(which) {
  const stage = $('cLight').querySelector('.lb-stage'), x = boardHere();
  let other = stage.querySelector('.lb-other');
  if (which === null || !x || !x.others || !x.others[which]) {
    Gallery.two = null;
    stage.classList.remove('two');
    if (other) other.remove();
    if (x) { const cap = $('cLight').querySelector('.lb-cap'); cap.textContent = x.rel; cap.title = ''; }
    return;
  }
  galleryScaleTo(0);
  Gallery.two = which;
  stage.classList.add('two');
  if (!other) { other = new Image(); other.className = 'lb-other'; other.alt = 'The other version'; stage.append(other); }
  other.src = imageSrc(`${Board.cwd}/${x.others[which]}`, Board.cwd);
  // Their name, and where each is: only the folders where they differ.
  const a = x.rel.split('/').slice(0, -1), b = x.others[which].split('/').slice(0, -1);
  let same = 0;
  while (same < a.length && same < b.length && a[same].toLowerCase() === b[same].toLowerCase()) same++;
  const cap = $('cLight').querySelector('.lb-cap');
  const otherName = x.others[which].split('/').pop();
  cap.textContent = otherName === x.name ? `${x.name}: ${a.slice(same).join('/') || 'here'}  ⟷  ${b.slice(same).join('/') || 'here'}` : `${x.name}  ⟷  ${otherName}`;
  cap.title = `${x.rel}  ⟷  ${x.others[which]}`;
}
const BoardReview = {
  show(p, same = false) {
    const x = p.item, st = boardState(x);
    $('lbRev').hidden = false;
    const s = $('lbRevState');
    s.textContent = boardWord[st] || 'To review'; s.className = `lb-st ${st}`;
    const n = $('lbRevNote');
    if (document.activeElement !== n || !same) n.value = x.note || '';
    n.placeholder = x.was === 'redo' && x.note ? 'What you’d asked for' : 'What should change? (N)';
    for (const b of document.querySelectorAll('#lbRev [data-rev="keep"], #lbRev [data-rev="redo"]')) { const on = x.mark === b.dataset.rev; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    $('lbRevCompare').hidden = !(x.others && x.others.length);
    const left = boardCounts().todo;
    $('lbRevLeft').textContent = left ? `${left} to review` : 'All reviewed';
    if (same) return;
    boardCompare(null);
    // The next ones are ready when you get there.
    for (const j of [Gallery.i + 1, Gallery.i + 2]) if (Gallery.list[j]) new Image().src = Gallery.list[j].src;
  },
  key(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key.toLowerCase();
    if (k === 'k') { boardRevMark('keep'); return true; }
    if (k === 'r') { boardRevMark('redo'); return true; }
    if (k === 'u') { const x = boardHere(); if (x) { wrap(boardMark)([x.rel], null, ''); BoardReview.show(Gallery.list[Gallery.i], true); } return true; }
    if (k === 'n') { const n = $('lbRevNote'); n.focus(); n.select(); return true; }
    if (k === 'c') { BoardReview.flip(); return true; }
    return false;
  },
  // Side by side with the same name in another folder; again for the next one, and then back.
  flip() {
    const x = boardHere(); if (!x || !x.others) return;
    const next = Gallery.two === null || Gallery.two === undefined ? 0 : Gallery.two + 1;
    boardCompare(next < x.others.length ? next : null);
  },
  closed(last) {
    boardCompare(null);
    $('lbRev').hidden = true;
    Gallery.back = null;
    if (!$('bdRoot')) return;
    boardDraw();
    if (!last) return;
    const list = boardView(), at = list.findIndex(x => x.rel === last.rel);
    if (at >= Board.shown) { Board.shown = at + 1; boardDrawGrid(); }
    Board.cursor = last.rel; boardDrawGrid();
    const t = [...$('bdGrid').children].find(y => y.dataset.rel === last.rel);
    if (t) { const b = t.querySelector('.bd-pic'); b.focus({ preventScroll: true }); t.scrollIntoView({ block: 'nearest' }); }
    boardLoadSoon();
  },
};
document.addEventListener('DOMContentLoaded', () => {
  const rev = $('lbRev'); if (!rev) return;
  rev.addEventListener('click', e => {
    e.stopPropagation();
    const b = e.target.closest('[data-rev]'); if (!b) return;
    const what = b.dataset.rev;
    if (what === 'keep' || what === 'redo') boardRevMark(what);
    else if (what === 'clear') { const x = boardHere(); if (x) { wrap(boardMark)([x.rel], null, ''); BoardReview.show(Gallery.list[Gallery.i], true); } }
    else if (what === 'compare') BoardReview.flip();
  });
  const n = $('lbRevNote');
  // A note means redo unless you've said keep. Enter: on to the next one.
  const save = () => {
    const x = boardHere(); if (!x || n.value.trim() === (x.note || '').trim()) return;
    wrap(boardMark)([x.rel], x.mark || 'redo', n.value.trim());
    BoardReview.show(Gallery.list[Gallery.i], true);
  };
  n.addEventListener('change', save);
  n.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); save(); $('cLight').focus(); boardReviewNext(); }
    else if (e.key === 'Escape') { const x = boardHere(); n.value = (x && x.note) || ''; $('cLight').focus(); }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !n.value) { $('cLight').focus(); galleryStep(e.key === 'ArrowLeft' ? -1 : 1); }
  });
});

/* ---------- several pictures as one, to share ---------- */
// What's showing, as one picture: a contact sheet with their names, to paste anywhere.
const SHEET_MAX = 60;
async function boardSheet(list) {
  const shown = list.slice(0, SHEET_MAX), n = shown.length;
  const cols = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(n)))), rows = Math.ceil(n / cols);
  const tile = Number(store('boardSheetSize')) || 360, ratio = Number($('bdRoot').style.getPropertyValue('--bd-shape')) || 1;
  const w = tile, h = Math.round(tile / ratio), pad = 8, cap = 26;
  const canvas = document.createElement('canvas');
  canvas.width = cols * (w + pad) + pad; canvas.height = rows * (h + cap + pad) + pad;
  const g = canvas.getContext('2d');
  g.fillStyle = '#111014'; g.fillRect(0, 0, canvas.width, canvas.height);
  g.font = '14px system-ui, sans-serif'; g.textBaseline = 'middle';
  let drawn = 0;
  for (let i = 0; i < n; i += 4) {
    await Promise.all(shown.slice(i, i + 4).map(async (x, k) => {
      const at = i + k, cx = pad + (at % cols) * (w + pad), cy = pad + Math.floor(at / cols) * (h + cap + pad);
      try {
        const bmp = await createImageBitmap(await Thumbs.blobOf(x));
        const s = Math.min(w / bmp.width, h / bmp.height), dw = bmp.width * s, dh = bmp.height * s;
        g.drawImage(bmp, cx + (w - dw) / 2, cy + (h - dh) / 2, dw, dh);
        bmp.close();
        drawn++;
      } catch { /* one that can't be read leaves a gap, with its name */ }
      g.fillStyle = '#d9d4cc';
      let label = x.name.replace(/\.[^.]+$/, '');
      while (label.length > 3 && g.measureText(label).width > w - 8) label = `${label.slice(0, -2)}…`;
      g.fillText(label, cx + 4, cy + h + cap / 2);
    }));
  }
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  return { blob, drawn, cut: list.length - n, width: canvas.width, height: canvas.height };
}
async function boardCopySheet(list) {
  toast('Putting them together…', 3000);
  const r = await boardSheet(list);
  const more = r.cut ? ` The first ${SHEET_MAX}; ${r.cut} more didn’t fit.` : '';
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': r.blob })]);
    toast(`${plural(r.drawn, 'picture')} copied as one, to paste anywhere.${more}`, 5000);
  } catch {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(r.blob); a.download = 'pictures.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    toast(`This window can’t copy it, so it’s saved as pictures.png.${more}`, 6000);
  }
}

/* ---------- handing the list to a chat ---------- */
function boardRedoText(list) {
  const lines = list.map(x => `- ${x.rel}${x.note ? `: ${x.note}` : ''}`);
  return `Please redo ${list.length === 1 ? 'this picture' : `these ${list.length} pictures`}${list.some(x => x.note) ? ', going by my notes' : ''}, and save each new one under the same name in the same folder, so the review board picks it up.\n\n${lines.join('\n')}`;
}
// A chat you saw open a moment ago. If it's ended since, it opens again from its conversation.
const openStillThere = x => (x.key ? ChatUI.openKey(x.key).catch(err => { if (err.status === 404 && x.sessionId) return ChatUI.open({ sessionId: x.sessionId }); throw err; }) : ChatUI.open({ sessionId: x.sessionId }));
// Some words for a chat: one that's open in this folder, one of its latest, or a new one. They land in its
// message box, to change and send; nothing goes by itself.
function handToChatItems(cwd, text, { before = () => {}, after = null, say = true } = {}) {
  const put = open => async () => {
    before();
    await open();
    placeText(text, false);
    if (after) after();
    if (say) toast('It’s in the message box. Change anything you like, then send it.', 4000);
  };
  const fresh = provider => async () => {
    before();
    // A folder that isn't a project yet joins them, as "Work here" does.
    if (!S.projects.some(x => x.cwd.toLowerCase() === cwd.toLowerCase())) { await api('/api/project/create', { existing: cwd }); await loadSessions(); renderNav(); }
    await ChatUI.open({ cwd, mode: 'new', ...(provider ? { provider } : {}), initialText: text });
    if (after) after();
  };
  const here = low => String(low || '').toLowerCase() === cwd.toLowerCase();
  const open = navLists().active.filter(x => here(x.cwd) && !isCommander(x.sessionId));
  const seen = new Set(open.flatMap(x => [x.sessionId, x.startedAs]).filter(Boolean).map(s => s.toLowerCase()));
  const p = S.projects.find(x => x.cwd.toLowerCase() === cwd.toLowerCase());
  const recent = (p ? p.sessions : []).filter(s => !seen.has(s.id.toLowerCase())).slice(0, 5);
  const a = current();
  return [
    ...open.map(x => ({ glyph: '◉', label: x.title || 'New chat', hint: chatState(x).word, run: put(() => openStillThere(x)) })),
    ...(open.length && recent.length ? ['-'] : []),
    ...recent.map(s => ({ glyph: '❝', label: s.title, hint: agoL(s.updated), run: put(() => ChatUI.open({ sessionId: s.id })) })),
    '-',
    ...(S.codex && S.codex.enabled ? [{ glyph: '◆', label: 'A new Codex chat', disabled: !codexReady(), why: 'Sign in to Codex first', run: fresh('codex') }] : []),
    { glyph: '✦', label: 'A new Claude chat', hint: `as ${a.name}`, disabled: !canLaunch(a), why: a.lockMessage || 'Sign in first', run: fresh(null) },
    ...(S.gemini && S.gemini.enabled ? [{ glyph: '✷', label: 'A new Gemini chat', disabled: !geminiReady(), why: 'Sign in to Gemini first', run: fresh('gemini') }] : []),
    '-',
    { glyph: '⧉', label: 'Copy it instead', run: () => copyText(text, 'Copied.') },
  ];
}
function boardSendItems() {
  return handToChatItems(Board.cwd, boardRedoText(Board.items.filter(x => x.mark === 'redo')));
}
function boardMoreItems(more = null) {
  const w = S.worlds[Board.cwd], view = boardView(), todo = view.filter(x => !x.mark), marked = view.filter(x => x.mark), keep = Board.items.filter(x => x.mark === 'keep');
  const real = Board.dir && !Board.dir.startsWith(':');
  return [
    { glyph: '✓', label: todo.length ? `Keep the ${todo.length === 1 ? 'one' : todo.length} still to review` : 'Keep the rest', disabled: !todo.length, run: () => boardMarkMany(todo, 'keep', `${plural(todo.length, 'picture')} kept.`) },
    { glyph: '⌫', label: 'Take back the marks shown here', disabled: !marked.length, run: () => boardMarkMany(marked, null, `Marks taken back from ${plural(marked.length, 'picture')}.`) },
    { glyph: '⧉', label: 'Copy the list of what’s kept', disabled: !keep.length, run: () => copyText(keep.map(x => x.rel).join('\n'), 'The list is copied.') },
    { glyph: '▦', label: 'Copy what’s showing as one picture', hint: 'a sheet with their names, to paste anywhere', disabled: !view.length, run: () => boardCopySheet(view) },
    { glyph: '▤', label: 'Put copies of what’s kept in a folder', hint: 'to share them; the originals stay', disabled: !keep.length, run: async () => {
      const r = await api('/api/board/export', { cwd: Board.cwd, rels: keep.map(x => x.rel) });
      const run = async () => { const rv = await api('/api/reveal', { path: r.folder, cwd: Board.cwd }); if (rv.dryRun) toast(`Would run: ${rv.script}`); };
      toast(`${plural(r.copied, 'picture')} copied to ${r.rel}.${r.failed.length ? ` ${plural(r.failed.length, 'other')} couldn’t be copied.` : ''}`, 9000, window.REMOTE ? null : { label: 'Show the folder', run });
    } },
    '-',
    ...(real && !window.REMOTE ? [{ glyph: '❖', label: 'Show this folder', run: async () => { const r = await api('/api/reveal', { path: `${Board.cwd}/${Board.dir}`, cwd: Board.cwd }); if (r.dryRun) toast(`Would run: ${r.script}`); } }] : []),
    { glyph: '✦', label: 'Ask a chat to make pictures here…', run: () => showMenu(more || Ctx.at, handToChatItems(Board.cwd, `Make {what to make}${real ? ` and save the pictures in ${Board.dir === '.' ? 'this folder' : Board.dir}` : ''}.`)) },
    { glyph: '↻', label: 'Look for new pictures', run: async () => { await boardLoad({ fresh: true }); toast('Up to date.', 1500); } },
    ...(w && w.bannerPicked ? [{ glyph: '⚑', label: 'Use the automatic banner', run: async () => { S.worlds[Board.cwd] = { ...(await api('/api/project/banner', { cwd: Board.cwd, path: null })), at: Date.now() }; renderFolder(); toast('Banner reset to the automatic pick.', 2000); } }] : []),
    ...(sagaLook() ? [{ glyph: '▤', label: 'Back to the gallery', run: () => { S.boardOn = false; renderWorldBody(); } }] : []),
  ];
}
// A right click (or a long press) on a picture.
function boardTileItems(rel) {
  const x = Board.byRel.get(rel); if (!x) return [];
  const src = boardSrc(x);
  return [
    { glyph: '⤢', label: 'Open full size', run: () => boardReview(rel) },
    { glyph: '✓', label: x.mark === 'keep' ? 'Keep (take it back)' : 'Keep', hint: 'K', run: () => boardMark([rel], x.mark === 'keep' ? null : 'keep', '') },
    { glyph: '↻', label: x.mark === 'redo' ? 'Redo (take it back)' : 'Redo', hint: 'R', run: () => boardMark([rel], x.mark === 'redo' ? null : 'redo', x.mark === 'redo' ? '' : x.note || '') },
    { glyph: '✎', label: x.note ? 'Change the note…' : 'Add a note…', run: () => { boardReview(rel); const n = $('lbRevNote'); n.focus(); n.select(); } },
    '-',
    { glyph: '❝', label: 'Ask a chat about it…', run: () => showMenu(Ctx.at, handToChatItems(Board.cwd, `Have a look at ${rel}. `)) },
    { glyph: '✦', label: 'Ask a chat for more like it…', run: () => showMenu(Ctx.at, handToChatItems(Board.cwd, `Make 3 variations of ${rel}, keeping the same character and style. Save them beside it, with -v2, -v3 and -v4 on the end of the name.`)) },
    '-',
    { glyph: '⧉', label: 'Copy picture', run: () => copyImage(src) },
    { glyph: '⧉', label: 'Copy its path', run: () => copyText(x.path, 'Path copied.') },
    ...(window.REMOTE ? [] : [{ glyph: '❖', label: 'Show in folder', run: async () => { const r = await api('/api/reveal', { path: x.path, cwd: Board.cwd }); if (r.dryRun) toast(`Would run: ${r.script}`); } }]),
    { glyph: '⚑', label: 'Use as this project’s banner', run: async () => { S.worlds[Board.cwd] = { ...(await api('/api/project/banner', { cwd: Board.cwd, path: x.path })), at: Date.now() }; renderFolder(); toast('Banner updated.', 2000); } },
  ];
}
// From anywhere: this project's board, open on what's newest (or on one of its folders).
function openBoard(cwd, dir = null) {
  go('folder', cwd);
  S.worldTab = 'gallery'; S.boardOn = true;
  if (dir) store(boardMemo(cwd), dir);
  if (dir && Board.cwd === cwd) boardOpenDir(dir);
  renderWorldBody();
}

/* ---------- on the hub: what you asked to redo is back ---------- */
const Back = { list: [], at: 0, hidden: {} };
try { Back.hidden = JSON.parse(store('picsBackHidden') || '{}') || {}; } catch { Back.hidden = {}; }
function renderPicturesBack() {
  if (S.view !== 'hub' || !$('backSlot')) return;
  if (Date.now() - Back.at > 30e3) {
    Back.at = Date.now();
    api('/api/board/waiting').then(r => { Back.list = r.waiting || []; renderPicturesBack(); }).catch(() => {});
  }
  const rows = Back.list.map(w => ({ ...w, p: S.projects.find(x => x.cwd.toLowerCase() === w.root.toLowerCase()) })).filter(w => w.p && Back.hidden[w.root] !== w.again);
  const h = rows.length ? `<div class="pics-back" role="status">${rows.map(w => `<p><b>${esc(w.p.name)}:</b> ${w.again === 1 ? 'a picture you asked to redo is back' : `${w.again} pictures you asked to redo are back`}.<span class="spacer"></span><button class="btn sm" data-back-open="${esc(w.p.cwd)}">Review ${w.again === 1 ? 'it' : 'them'}</button><button class="btn quiet sm" data-back-hide="${esc(w.root)}" data-n="${w.again}">Hide</button></p>`).join('')}</div>` : '';
  const slot = $('backSlot');
  if (slot._h !== h) { slot.innerHTML = h; slot._h = h; }
}

/* ---------- clicks and keys ---------- */
(function startBoard() {
  const page = $('page');
  page.addEventListener('click', wrap(async e => {
    const t = e.target; if (!(t instanceof Element)) return;
    if (t.closest('[data-bd-on]')) { S.boardOn = true; return renderWorldBody(); }
    const bo = t.closest('[data-back-open]');
    if (bo) { Board.filter = 'all'; return openBoard(bo.dataset.backOpen, ':redo'); }
    const bh = t.closest('[data-back-hide]');
    if (bh) { Back.hidden[bh.dataset.backHide] = Number(bh.dataset.n); store('picsBackHidden', JSON.stringify(Back.hidden)); return renderPicturesBack(); }
    if (!t.closest('#bdRoot')) return;
    const dir = t.closest('[data-bd-dir]'); if (dir) return boardOpenDir(dir.dataset.bdDir);
    if (t.closest('[data-bd-all]')) { Board.allDirs = true; return boardDrawSide(); }
    const f = t.closest('[data-bd-filter]');
    if (f) { Board.filter = f.dataset.bdFilter; Board.shown = 0; Board.cursor = null; return boardDraw(); }
    if (t.closest('[data-bd-review]')) return boardReview();
    const send = t.closest('[data-bd-send]'); if (send) return send.getAttribute('aria-expanded') === 'true' ? closeMenu() : showMenu(send, boardSendItems());
    const more = t.closest('[data-bd-more]'); if (more) return more.getAttribute('aria-expanded') === 'true' ? closeMenu() : showMenu(more, boardMoreItems(more));
    const tile = t.closest('.bd-t'); if (!tile) return;
    const m = t.closest('[data-bd-mark]');
    if (m) {
      const x = Board.byRel.get(tile.dataset.rel), what = m.dataset.bdMark;
      if (x) await boardMark([x.rel], x.mark === what ? null : what, what === 'redo' && x.mark !== what ? x.note || '' : '');
      return;
    }
    if (t.closest('[data-bd-open]')) { Board.cursor = tile.dataset.rel; boardReview(tile.dataset.rel); }
  }));
  page.addEventListener('input', e => {
    if (e.target.id === 'bdFind') { Board.find = e.target.value; boardDrawSide(); }
    else if (e.target.id === 'bdPicQ') boardFindPicture(e.target.value);
    else if (e.target.id === 'bdSize') { Board.size = Number(e.target.value); store('boardSize', String(Board.size)); $('bdRoot').style.setProperty('--bd-size', `${Board.size}px`); }
  });
  page.addEventListener('change', e => {
    if (e.target.id === 'bdSort') { Board.sort = e.target.value; store('boardSort', Board.sort); boardDrawGrid(); }
  });
  page.addEventListener('keydown', e => {
    // The folders: ↑ and ↓ go through them, from the box above them too.
    if (e.target instanceof Element && (e.target.id === 'bdFind' || e.target.closest('#bdDirs')) && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const rows = [...document.querySelectorAll('#bdDirs [data-bd-dir]')], i = rows.indexOf(e.target), to = i < 0 ? (e.key === 'ArrowDown' ? rows[0] : null) : rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (to) { e.preventDefault(); to.focus(); to.scrollIntoView({ block: 'nearest' }); }
      else if (i === 0 && e.key === 'ArrowUp') { e.preventDefault(); $('bdFind').focus(); }
      return;
    }
    const t = e.target; if (!(t instanceof Element) || !t.closest('#bdGrid') || e.ctrlKey || e.metaKey || e.altKey) return;
    const tile = t.closest('.bd-t'); if (!tile) return;
    const tiles = [...$('bdGrid').children].filter(y => y.dataset.rel);
    const at = tiles.indexOf(tile);
    const k = e.key.toLowerCase(), x = Board.byRel.get(tile.dataset.rel);
    const go = j => {
      const to = tiles[Math.max(0, Math.min(tiles.length - 1, j))]; if (!to) return;
      Board.cursor = to.dataset.rel;
      for (const y of tiles) y.querySelector('.bd-pic').tabIndex = y === to ? 0 : -1;
      to.querySelector('.bd-pic').focus({ preventScroll: true });
      to.scrollIntoView({ block: 'nearest' });
    };
    const across = tiles.filter(y => y.offsetTop === tile.offsetTop).length || 1;
    let done = true;
    if (k === 'arrowright') go(at + 1);
    else if (k === 'arrowleft') go(at - 1);
    else if (k === 'arrowdown') go(at + across);
    else if (k === 'arrowup') go(at - across);
    else if (k === 'home') go(0);
    else if (k === 'end') go(tiles.length - 1);
    else if (k === 'k' && x) wrap(boardMark)([x.rel], x.mark === 'keep' ? null : 'keep', '');
    else if (k === 'r' && x) wrap(boardMark)([x.rel], x.mark === 'redo' ? null : 'redo', x.mark === 'redo' ? '' : x.note || '');
    else if (k === 'u' && x) wrap(boardMark)([x.rel], null, '');
    else if (k === 'n' && x) { boardReview(x.rel); const n = $('lbRevNote'); n.focus(); n.select(); }
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); }
  });
  // Pictures arriving while you watch; nothing asked for while it can't be seen.
  const watching = () => $('bdRoot') && !document.hidden && $('cLight').hidden && !(window.ChatUI && ChatUI.isOpen());
  setInterval(() => { if (watching()) boardLoad({ quiet: true }); }, 15000);
  window.addEventListener('focus', () => { if (watching()) boardLoad({ quiet: true }); });
}());
