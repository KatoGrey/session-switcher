'use strict';
/* Chapters: a long chat divides itself where you came back after a break (or after every 40 of your
   messages), each chapter named after the first thing you said in it. A quiet heading marks each one
   in the conversation and on the map. Once a chat is long, chapters well behind you fold to a one-line
   card and their messages are set aside, so the page stays light however long the day; Show brings
   one back (and it stays open). Nothing is lost: folding only moves messages out of the page. */

const CHAPTER_GAP = 45 * 60 * 1000;   // a break this long starts a new chapter
const CHAPTER_MAX = 40;               // your messages in one chapter at most
const FOLD_AFTER = 300;               // turns on the page before old chapters fold
const FOLD_TO = 200;                  // ...and they fold, oldest first, until about this many are left
const KEEP_OPEN = 2;                  // the newest chapters never fold
const Chap = { timer: 0 };

function chaptersSoon(ms = 1800) { clearTimeout(Chap.timer); Chap.timer = setTimeout(chapters, ms); }
const chapterTitle = el => (RAW.get(el) || el.innerText || '').trim().split('\n').find(Boolean)?.replace(/\s+/g, ' ').slice(0, 64) || 'A new start';
const chapterWhen = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// The chapters as the feed has them now: folded cards stand for theirs.
function chapterList() {
  const list = [];
  let cur = null, lastAt = 0;
  for (const el of $c('cFeed').children) {
    if (el.classList.contains('chapter-fold')) { cur = null; list.push({ fold: el, title: el._title, at: el._at }); lastAt = el._end || lastAt; continue; }
    if (el.classList.contains('chapter')) continue;
    if (el.classList.contains('umsg') && el._at) {
      const brk = !cur || el._at - lastAt > CHAPTER_GAP;
      if (brk || cur.msgs >= CHAPTER_MAX) {
        // A chapter that only reached the length limit carries on the same subject: same name, next part.
        const topic = brk ? chapterTitle(el) : cur.topic, part = brk ? 1 : cur.part + 1;
        cur = { start: el, at: el._at, topic, part, title: part > 1 ? `${topic} (part ${part})` : topic, msgs: 0, nodes: [], end: el._at };
        list.push(cur);
      }
      cur.msgs++; lastAt = el._at; cur.end = el._at;
    }
    if (cur) cur.nodes.push(el);
  }
  return list;
}

function chapters() {
  const feed = $c('cFeed');
  if (!feed || $c('chat').hidden) return;
  const list = chapterList();
  const many = list.length >= 2;
  // Headings: one before each chapter's first message (when there's more than one chapter).
  const want = new Set();
  list.forEach((c, i) => {
    if (c.fold || !many) return;
    let h = c.start._chapHead;
    if (!h || !h.isConnected || h.nextElementSibling !== c.start) {
      h = document.createElement('div');
      h.className = 'chapter'; h.setAttribute('role', 'separator');
      c.start.before(h); c.start._chapHead = h;
    }
    const text = `<span class="ch-n">Chapter ${i + 1}</span><span class="ch-t">${esc(c.title)}</span><span class="ch-at">${esc(chapterWhen(c.at))}</span>`;
    if (h._text !== text) { h.innerHTML = text; h._text = text; h.setAttribute('aria-label', `Chapter ${i + 1}: ${c.title}`); }
    want.add(h);
  });
  for (const h of [...feed.querySelectorAll(':scope > .chapter')]) if (!want.has(h)) h.remove();
  // Folding: in a long chat, older chapters out of sight become a card.
  const turns = feed.querySelectorAll(':scope > .turn').length;
  if (turns <= FOLD_AFTER) return;
  const sc = $c('cScroll'), top = sc ? sc.getBoundingClientRect().top : 0;
  let left = turns;
  list.slice(0, -KEEP_OPEN).forEach((c, i) => {
    if (left <= FOLD_TO || c.fold || c.start.dataset.open) return;
    const lastNode = c.nodes[c.nodes.length - 1];
    if (!lastNode || lastNode.getBoundingClientRect().bottom > top - 200) return;   // in sight, or nearly
    if (c.nodes.some(n => n.querySelector('.perm, .review .gen-spin, .gen-wait'))) return;   // something still live
    foldChapter(c, i + 1);
    left -= c.nodes.filter(x => x.classList.contains('turn')).length;
  });
}

function foldChapter(c, n) {
  const card = document.createElement('div');
  card.className = 'chapter-fold';
  const turns = c.nodes.filter(x => x.classList.contains('turn')).length;
  card.innerHTML = `<span class="ch-n">Chapter ${n}</span><span class="ch-t">${esc(c.title)}</span>
    <span class="ch-at">${esc(chapterWhen(c.at))}${c.end && c.end - c.at > 60000 ? ` – ${esc(new Date(c.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}` : ''} · ${c.msgs} message${c.msgs === 1 ? '' : 's'}${turns ? `, ${turns} repl${turns === 1 ? 'y' : 'ies'}` : ''}</span>
    <button type="button" class="ta" data-chapopen>Show</button>`;
  Object.assign(card, { _title: c.title, _at: c.at, _end: c.end, _nodes: document.createDocumentFragment() });
  const head = c.start._chapHead;
  (head && head.isConnected ? head : c.start).before(card);
  if (head && head.isConnected) head.remove();
  for (const node of c.nodes) card._nodes.appendChild(node);
}

function openChapter(card) {
  const first = card._nodes.firstElementChild;
  if (first) first.dataset.open = '1';   // opened by you: it stays open
  card.replaceWith(card._nodes);
  chaptersSoon(50);
}

(function startChapters() {
  const feed = $c('cFeed');
  new MutationObserver(muts => { if (muts.some(m => [...m.addedNodes].some(n => n.nodeType === 1 && (n.classList.contains('umsg') || n.classList.contains('turn'))))) chaptersSoon(); }).observe(feed, { childList: true });
  feed.addEventListener('click', e => { const b = e.target.closest('[data-chapopen]'); if (b) openChapter(b.closest('.chapter-fold')); });
})();
