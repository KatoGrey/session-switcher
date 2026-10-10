'use strict';
/* The preview beside the chat: a file Claude or Codex changed (that change, line by line, with line
   numbers) or a picture one of them made, at the top of the ledger, so the work is in view while the
   conversation is. From the ledger's lists, or a file named in a reply's "Changed N files" bar. */

const Preview = { path: null };
const normPath = p => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
// Which reply last changed each file (from the "Changed N files" bars), so its diff can be fetched.
function noteChanges(ev, src) {
  if (!C.changedBy) C.changedBy = new Map();
  for (const f of ev.files) C.changedBy.set(normPath(f.path), { turn: ev.turn, src, path: f.path, add: f.add, del: f.del, status: f.status });
}
function changeFor(p) {
  if (!C.changedBy) return null;
  const n = normPath(p);
  if (C.changedBy.has(n)) return C.changedBy.get(n);
  for (const [k, v] of C.changedBy) if (n.endsWith(`/${k}`) || k.endsWith(`/${n}`)) return v;
  return null;
}
// A unified diff as rows: the old and new line numbers, then the line, marked added or removed.
function diffRows(text) {
  let o = 0, n = 0;
  const rows = [];
  for (const l of String(text || '').split('\n')) {
    if (/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|\\ No newline)/.test(l)) continue;
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(l);
    if (h) { o = +h[1]; n = +h[2]; rows.push(`<div class="pv-r hunk"><i></i><i></i><code>${esc(h[3].trim() || '⋯')}</code></div>`); continue; }
    if (!rows.length) continue;
    if (l.startsWith('+')) rows.push(`<div class="pv-r add"><i></i><i>${n++}</i><code>${esc(l.slice(1)) || ' '}</code></div>`);
    else if (l.startsWith('-')) rows.push(`<div class="pv-r del"><i>${o++}</i><i></i><code>${esc(l.slice(1)) || ' '}</code></div>`);
    else if (l.startsWith(' ')) rows.push(`<div class="pv-r"><i>${o++}</i><i>${n++}</i><code>${esc(l.slice(1)) || ' '}</code></div>`);
  }
  return rows.join('');
}
// The ledger is shown if it was hidden (or, in a narrow window, slides in).
function revealLedger() {
  const chat = $c('chat');
  if (chat.classList.contains('no-ledger')) { chat.classList.remove('no-ledger'); try { localStorage.setItem('ledger', 'on'); } catch { /* fine */ } }
  if (getComputedStyle($c('cLedger')).display === 'none') chat.classList.add('show-ledger');
}
async function showPreview(p, kind, at = null) {
  const box = $c('cPreview'); if (!box || !p) return;
  Preview.path = p;
  revealLedger();
  const name = base(p);
  const head = sub => `<header class="pv-h"><span class="pv-ico" aria-hidden="true">${kind === 'image' ? '❖' : '◈'}</span><span class="pv-t"><b title="${esc(p)}">${esc(name)}</b><small>${sub}</small></span><button type="button" class="ta" data-pvopen="${esc(p)}">Open</button><button type="button" class="icon pv-x" data-pvclose aria-label="Close the preview" title="Close">✕</button></header>`;
  const fresh = !box.firstElementChild;
  if (kind === 'image') {
    const src = imageUrl(p);
    box.innerHTML = `<section class="pv" aria-label="Preview of ${esc(name)}">${head('A picture from this chat')}<button type="button" class="pv-img thumb" data-full="${esc(src)}" aria-label="Show it full size"><img src="${esc(src)}" alt="" onerror="this.parentNode.classList.add('broken')"></button><p class="pv-note pv-gone">The picture can’t be shown here (it may have moved). <button type="button" class="linkish" data-pvopen="${esc(p)}">Try opening it</button>.</p></section>`;
  } else {
    const ch = at || changeFor(p);
    if (!ch) {
      box.innerHTML = `<section class="pv" aria-label="${esc(name)}">${head('Changed in this chat')}<p class="pv-note">Its changes can be shown line by line in a git project. <button type="button" class="linkish" data-pvopen="${esc(p)}">Open the file</button> to see it as it is now.</p></section>`;
    } else {
      const counts = ch.status === 'added' ? 'New file' : ch.status === 'deleted' ? 'Deleted' : ch.add !== null && ch.add !== undefined ? `<i class="d-add">+${ch.add}</i> <i class="d-del">−${ch.del}</i>` : 'Changed';
      box.innerHTML = `<section class="pv" aria-label="Changes to ${esc(name)}">${head(`${counts} · ${esc(PROV_NAME[provFor(ch.src)])}’s ${at ? '' : 'latest '}change`)}<div class="pv-diff" aria-busy="true"><p class="pv-note">Loading…</p></div></section>`;
      try {
        const r = await api(`/api/chat/diff?key=${encodeURIComponent(keyFor(ch.src))}&turn=${ch.turn}&path=${encodeURIComponent(ch.path)}`);
        if (Preview.path !== p) return;
        const d = box.querySelector('.pv-diff');
        if (d) { d.removeAttribute('aria-busy'); d.innerHTML = diffRows(r.diff) || '<p class="pv-note">No text changes (a binary or empty file).</p>'; }
      } catch (err) { const d = box.querySelector('.pv-diff'); if (d) d.innerHTML = `<p class="pv-note">${esc(err.message)}</p>`; }
    }
  }
  if (fresh && motionOk()) box.firstElementChild?.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
}
function closePreview() { Preview.path = null; const box = $c('cPreview'); if (box) box.innerHTML = ''; }
