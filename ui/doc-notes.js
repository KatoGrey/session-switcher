'use strict';
/* Notes on a document: select a passage in the file viewer, say what should change, and hand the notes to
   a chat in one go, each with what it's about. For lore, reviews and specs what the picture board is for
   pictures. They stay with the file, in this browser, until they're sent or cleared. */

const DocNotes = (() => {
  const MAX_FILES = 40, MAX_QUOTE = 1200;
  let all = {};
  try { all = JSON.parse(store('docNotes') || '{}') || {}; } catch { all = {}; }
  let cur = null, ctx = {}, writing = null, watchTimer = null, offered = null;
  const save = () => {
    const keep = Object.entries(all).filter(([, l]) => l && l.length).sort((a, b) => b[1][b[1].length - 1].at - a[1][a[1].length - 1].at).slice(0, MAX_FILES);
    all = Object.fromEntries(keep);
    store('docNotes', JSON.stringify(all));
  };
  const idOf = p => String(p).replace(/\\/g, '/').toLowerCase();
  const mine = () => (cur ? all[idOf(cur.path)] || [] : []);
  const setMine = list => { all[idOf(cur.path)] = list; save(); };
  const can = () => !!(cur && cur.kind === 'text');

  // Which project a file is in: the one whose folder is nearest. Null for anywhere else.
  function projectFor(p) {
    const f = idOf(p);
    return S.projects.filter(x => f.startsWith(`${idOf(x.cwd).replace(/\/+$/, '')}/`)).sort((a, b) => b.cwd.length - a.cwd.length)[0] || null;
  }
  const nameOf = f => {
    const p = projectFor(f.path);
    return p ? f.path.slice(p.cwd.replace(/[\\/]+$/, '').length + 1).replace(/\\/g, '/') : f.path;
  };
  function textOf(f, list) {
    const parts = list.map(n => `${n.quote ? `${n.quote.split(/\n+/).map(l => `> ${l}`).join('\n')}\n` : ''}${n.note}`);
    return `Here are my notes on ${nameOf(f)}. Please make these changes, and tell me about anything you’re not sure of.\n\n${parts.join('\n\n')}`;
  }

  /* ---------- the little popup by the selection ---------- */
  const pop = () => $('vPop');
  function hidePop() { const el = pop(); if (el) { el.hidden = true; el.innerHTML = ''; } writing = null; }
  function place(rect) {
    const el = pop(), wrapBox = el.parentElement.getBoundingClientRect(), z = uiScale();
    const w = el.offsetWidth, h = el.offsetHeight, maxW = wrapBox.width / z - w - 8, maxH = wrapBox.height / z - h - 8;
    const left = Math.max(8, Math.min(maxW, (rect.left - wrapBox.left) / z));
    const below = (rect.bottom - wrapBox.top) / z + 6;
    const top = below <= maxH ? below : Math.max(8, Math.min(maxH, (rect.top - wrapBox.top) / z - h - 6));
    el.style.left = `${left}px`; el.style.top = `${top}px`;
  }
  function selected() {
    const s = getSelection(), body = $('vBody');
    if (!s || s.isCollapsed || !body || !body.contains(s.anchorNode) || !body.contains(s.focusNode)) return null;
    const text = s.toString().trim();
    return text ? { text, rect: s.getRangeAt(0).getBoundingClientRect() } : null;
  }
  // Something's selected: offer to note it.
  function watch() {
    if (!can() || writing || !$('viewer') || !$('viewer').open) return;
    const sel = selected(), el = pop();
    // A press on the button itself can clear the selection first (on a phone it does): it stays for that moment.
    if (!sel) { if (!(offered && Date.now() - offered.pressed < 700)) { offered = null; hidePop(); } return; }
    offered = { ...sel, pressed: 0 };
    el.hidden = false;
    el.innerHTML = '<button type="button" class="btn sm prime" data-dn="write" title="Add a note on what’s selected (N)">Add a note</button>';
    place(sel.rect);
  }
  function write(quote, rect) {
    const el = pop();
    writing = { quote: String(quote || '').slice(0, MAX_QUOTE) };
    el.hidden = false;
    el.innerHTML = `${quote ? `<blockquote class="vn-quote">${esc(writing.quote.slice(0, 280))}${writing.quote.length > 280 ? '…' : ''}</blockquote>` : '<p class="vn-whole">A note on the whole file</p>'}
      <textarea id="vNoteText" rows="3" aria-label="Your note" placeholder="What should change?"></textarea>
      <div class="vn-row"><span class="vn-hint">Enter adds it, Esc leaves it</span><button type="button" class="btn sm prime" data-dn="add">Add it</button></div>`;
    place(rect || { left: el.parentElement.getBoundingClientRect().left + 24, top: 0, bottom: el.parentElement.getBoundingClientRect().top + 110 });
    $('vNoteText').focus();
  }
  function add() {
    const box = $('vNoteText'); if (!box || !writing) return;
    const note = box.value.trim();
    if (!note) { box.focus(); return; }
    setMine([...mine(), { id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, quote: writing.quote, note, at: Date.now() }]);
    hidePop();
    const s = getSelection(); if (s) s.removeAllRanges();
    draw();
    announce('Note added.');
  }

  /* ---------- the tray ---------- */
  function draw() {
    const el = $('vNotes'); if (!el) return;
    const list = can() ? mine() : [];
    el.hidden = !list.length;
    el.innerHTML = list.length ? `<div class="vn-head"><b>${plural(list.length, 'note')} on this file</b><span class="vn-acts"><button type="button" class="btn sm prime" data-dn="send" aria-haspopup="menu" aria-expanded="false">Send to a chat…</button><button type="button" class="btn quiet sm" data-dn="copy">Copy</button><button type="button" class="btn quiet sm" data-dn="clear">Clear</button></span></div>
      <ul class="vn-list">${list.map(n => `<li data-note="${esc(n.id)}">${n.quote ? `<button type="button" class="vn-q" data-dn="jump" title="Show this in the file">${esc(n.quote.slice(0, 200))}${n.quote.length > 200 ? '…' : ''}</button>` : ''}<p class="vn-t">${esc(n.note)}</p><button type="button" class="icon vn-x" data-dn="del" aria-label="Remove this note">✕</button></li>`).join('')}</ul>` : '';
    paint();
  }
  // The page's text as one string with its runs of space closed up, and places in it back to places on the page.
  function textIndex(body) {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT), nodes = [];
    let total = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push(n); total += n.nodeValue.length; }
    const nodeAt = new Int32Array(total), offAt = new Int32Array(total), chars = [];
    let len = 0, space = true;
    nodes.forEach((n, ni) => {
      const v = n.nodeValue;
      for (let i = 0; i < v.length; i++) {
        const c = v[i], ws = c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\u00a0';
        if (ws && space) continue;
        nodeAt[len] = ni; offAt[len] = i; len++;
        chars.push(ws ? ' ' : c); space = ws;
      }
    });
    return {
      flat: chars.join(''),
      range(i, n) {
        const e = i + n - 1, r = new Range();
        r.setStart(nodes[nodeAt[i]], offAt[i]);
        r.setEnd(nodes[nodeAt[e]], offAt[e] + 1);
        return r;
      },
    };
  }
  // Where the notes' passages are. Marked without touching the page's text (a highlight, not an element).
  function locate(quotes) {
    const ix = textIndex($('vBody'));
    return quotes.map(q => {
      const want = q.replace(/\s+/g, ' ').trim().slice(0, 240);
      const i = want ? ix.flat.indexOf(want) : -1;
      return i < 0 ? null : ix.range(i, want.length);
    });
  }
  function paint() {
    if (!window.Highlight || !CSS.highlights) return;
    CSS.highlights.delete('doc-note');
    const list = can() ? mine().filter(n => n.quote) : [];
    if (!list.length || !$('vBody')) return;
    const ranges = locate(list.map(n => n.quote)).filter(Boolean);
    if (ranges.length) CSS.highlights.set('doc-note', new Highlight(...ranges));
  }
  function jump(n) {
    const [r] = locate([n.quote]);
    if (!r) return toast('That passage isn’t in the file any more.', 3000);
    const body = $('vBody'), box = body.getBoundingClientRect(), at = r.getBoundingClientRect();
    body.scrollTop += at.top - box.top - box.height / 3;
    return undefined;
  }
  function menu(b) {
    const list = mine(), f = cur, text = textOf(f, list), p = projectFor(f.path);
    const cwd = (ctx && ctx.cwd) || (p && p.cwd) || f.dir;
    const clearSent = () => {
      const was = list.slice(), id = idOf(f.path);
      all[id] = []; save();
      toast('They’re in the message box. Change anything you like, then send it.', 7000, { label: 'Keep the notes', run: () => { all[id] = was; save(); } });
    };
    showMenu(b, handToChatItems(cwd, text, { before: () => Viewer.close(), after: clearSent, say: false }));
  }

  /* ---------- wiring ---------- */
  document.addEventListener('selectionchange', () => { clearTimeout(watchTimer); watchTimer = setTimeout(watch, 120); });
  document.addEventListener('pointerdown', e => {
    if (!(e.target instanceof Element) || !e.target.closest('#vPop [data-dn="write"]') || !offered) return;
    offered.pressed = Date.now();
    e.preventDefault();
  }, true);
  document.addEventListener('click', wrap(async e => {
    const t = e.target; if (!(t instanceof Element)) return;
    const head = t.closest('[data-doc-note]');
    if (head) { const sel = selected(); write(sel ? sel.text : '', sel ? sel.rect : null); return; }
    const b = t.closest('[data-dn]'); if (!b) return;
    const what = b.dataset.dn, li = b.closest('[data-note]'), n = li && mine().find(x => x.id === li.dataset.note);
    if (what === 'write') { const sel = selected() || offered; if (sel) write(sel.text, sel.rect); offered = null; }
    else if (what === 'add') add();
    else if (what === 'del') { setMine(mine().filter(x => x !== n)); draw(); }
    else if (what === 'jump' && n) jump(n);
    else if (what === 'copy') await copyText(textOf(cur, mine()), 'Your notes are copied.');
    else if (what === 'clear') {
      const was = mine(), f = cur;
      setMine([]); draw();
      toast(`${plural(was.length, 'note')} cleared.`, 7000, { label: 'Undo', run: () => { all[idOf(f.path)] = was; save(); if (cur && idOf(cur.path) === idOf(f.path)) draw(); } });
    } else if (what === 'send') menu(b);
  }));
  document.addEventListener('keydown', e => {
    if (!$('viewer') || !$('viewer').open) return;
    if (e.target.id === 'vNoteText') {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(); }
      else if (e.key === 'Escape') { e.preventDefault(); hidePop(); }
      return;
    }
    if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest('input, textarea') && can()) {
      e.preventDefault(); e.stopPropagation();
      const sel = selected();
      write(sel ? sel.text : '', sel ? sel.rect : null);
    }
  }, true);
  return {
    // The viewer's showing this file now (null: it closed).
    shown(f, c) {
      cur = f; ctx = c || {};
      hidePop();
      draw();
    },
    // Esc while writing a note closes the note, not the viewer.
    onCancel(e) { if (writing) { e.preventDefault(); hidePop(); } },
    count: p => (all[idOf(p)] || []).length,
    textIndex,
    note() { const sel = selected(); write(sel ? sel.text : '', sel ? sel.rect : null); },
  };
})();

/* ---------- Find in the file you're reading (Ctrl+F; an app window has no find of its own) ---------- */
const DocFind = (() => {
  const F = { hits: [], i: -1 };
  const bar = () => $('vFind');
  const isOpen = () => !!bar() && !bar().hidden;
  const marks = window.Highlight && CSS.highlights;
  function clear() { if (marks) { CSS.highlights.delete('doc-find'); CSS.highlights.delete('doc-find-now'); } F.hits = []; F.i = -1; }
  function show(i) {
    const n = F.hits.length;
    const count = $('vFindN');
    if (!n) { count.textContent = $('vFindQ').value.trim() ? 'None' : ''; return; }
    F.i = (i + n) % n;
    const r = F.hits[F.i];
    if (marks) CSS.highlights.set('doc-find-now', new Highlight(r));
    count.textContent = `${F.i + 1} of ${n}`;
    const body = $('vBody'), box = body.getBoundingClientRect(), at = r.getBoundingClientRect();
    if (at.top < box.top + 40 || at.bottom > box.bottom - 20) body.scrollTop += at.top - box.top - box.height / 3;
  }
  function run() {
    clear();
    const want = $('vFindQ').value.replace(/\s+/g, ' ').trim().toLowerCase();
    if (want && $('vBody')) {
      const ix = DocNotes.textIndex($('vBody')), low = ix.flat.toLowerCase();
      for (let i = low.indexOf(want); i >= 0 && F.hits.length < 2000; i = low.indexOf(want, i + want.length)) F.hits.push(ix.range(i, want.length));
      if (marks && F.hits.length) CSS.highlights.set('doc-find', new Highlight(...F.hits));
    }
    show(0);
  }
  function open() {
    bar().hidden = false;
    const q = $('vFindQ'), sel = String(getSelection() || '').trim();
    if (sel && sel.length < 120 && !sel.includes('\n')) q.value = sel;
    q.focus(); q.select();
    run();
  }
  function close() { if (!bar()) return; bar().hidden = true; clear(); }
  document.addEventListener('keydown', e => {
    if (!$('viewer') || !$('viewer').open) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && bar() && $('vBody').querySelector('.v-md, .v-raw')) { e.preventDefault(); e.stopPropagation(); open(); return; }
    if (e.target.id !== 'vFindQ') return;
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); show(F.i + (e.shiftKey ? -1 : 1)); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }, true);
  document.addEventListener('input', e => { if (e.target.id === 'vFindQ') run(); });
  document.addEventListener('click', e => {
    const t = e.target; if (!(t instanceof Element)) return;
    if (t.closest('[data-doc-find]')) return open();
    const b = t.closest('[data-vf]'); if (!b) return undefined;
    if (b.dataset.vf === 'close') return close();
    return show(F.i + (b.dataset.vf === 'prev' ? -1 : 1));
  });
  return {
    // The page was drawn again: the old places are gone.
    shown(f) { if (!f) close(); else if (isOpen()) { if (f.kind === 'text') run(); else close(); } },
    onCancel(e) { if (isOpen()) { e.preventDefault(); close(); } },
    open,
    // Opened from a search: its words, found.
    search(q) { if (!bar() || !$('vBody').querySelector('.v-md, .v-raw')) return; bar().hidden = false; $('vFindQ').value = q; run(); },
  };
})();
