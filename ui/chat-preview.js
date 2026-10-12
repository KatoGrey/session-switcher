'use strict';
/* The preview beside the chat: a file Claude or Codex changed (that change, line by line, with line
   numbers) or a picture one of them made, at the top of the ledger, so the work is in view while the
   conversation is. From the ledger's lists, or a file named in a reply's "Changed N files" bar. */

const Preview = { path: null, src: null, comments: [] };
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
    // Each line can take a comment (click it, or Enter): data-ln is its line in the new file (or the old one, for a removed line).
    const row = (cls, a, b, ln) => `<div class="pv-r${cls}" tabindex="0" role="button" data-ln="${ln}" aria-label="Comment on line ${ln}"><i>${a}</i><i>${b}</i><code>${esc(l.slice(1)) || ' '}</code></div>`;
    if (l.startsWith('+')) { rows.push(row(' add', '', n, n)); n++; }
    else if (l.startsWith('-')) { rows.push(row(' del', o, '', `${o} (removed)`)); o++; }
    else if (l.startsWith(' ')) { rows.push(row('', o, n, n)); o++; n++; }
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
        Preview.src = ch.src;
        if (d) { d.removeAttribute('aria-busy'); d.innerHTML = diffRows(r.diff) || '<p class="pv-note">No text changes (a binary or empty file).</p>'; showComments(); }
      } catch (err) { const d = box.querySelector('.pv-diff'); if (d) d.innerHTML = `<p class="pv-note">${esc(err.message)}</p>`; }
    }
  }
  if (fresh && motionOk()) box.firstElementChild?.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
}
function closePreview() { Preview.path = null; const box = $c('cPreview'); if (box) box.innerHTML = ''; }

/* ---------- comments on lines ---------- */
// Comments you leave on lines of a change (any number, across files), shown under each line and sent
// together when you choose who gets them: the one who made the change first.
function showComments() {
  const box = $c('cPreview'), diff = box && box.querySelector('.pv-diff'); if (!diff) return;
  for (const n of diff.querySelectorAll('.pv-cm')) n.remove();
  for (const c of Preview.comments.filter(x => x.path === Preview.path)) {
    const row = diff.querySelector(`.pv-r[data-ln="${CSS.escape(String(c.line))}"]`);
    if (row) row.insertAdjacentHTML('afterend', `<div class="pv-cm"><p>${esc(c.text)}</p><button type="button" class="linkish" data-pvc-del="${c.id}">Remove</button></div>`);
  }
  let bar = box.querySelector('.pv-cbar');
  const n = Preview.comments.length;
  if (!n) { if (bar) bar.remove(); return; }
  if (!bar) { bar = document.createElement('div'); bar.className = 'pv-cbar'; box.querySelector('.pv').appendChild(bar); }
  const author = Preview.src || 'main', other = author === 'main' ? 'comp' : 'main';
  bar.innerHTML = `<span>${n} comment${n === 1 ? '' : 's'}</span><button type="button" class="btn sm gilt" data-pvsend="${author}">Send to ${PROV_NAME[provFor(author)]}</button>${duo() ? `<button type="button" class="btn sm" data-pvsend="${other}">Send to ${PROV_NAME[provFor(other)]}</button>` : ''}<button type="button" class="btn quiet sm" data-pvc-clear>Clear</button>`;
}
function commentOn(row) {
  if (!row || row.classList.contains('hunk') || row.nextElementSibling?.classList.contains('pv-ce')) return;
  row.insertAdjacentHTML('afterend', '<div class="pv-ce"><textarea rows="2" placeholder="Your note on this line…" aria-label="Comment on this line"></textarea><div><button type="button" class="btn sm" data-pvc-add>Add comment</button><button type="button" class="btn quiet sm" data-pvc-cancel>Cancel</button></div></div>');
  row.nextElementSibling.querySelector('textarea').focus();
}
function addComment(ed) {
  const text = ed.querySelector('textarea').value.trim(), row = ed.previousElementSibling;
  ed.remove();
  if (!text || !row) return;
  Preview.comments.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), path: Preview.path, line: row.dataset.ln, code: row.querySelector('code').textContent, text });
  showComments();
}
function sendComments(to) {
  const byFile = new Map();
  for (const c of Preview.comments) { if (!byFile.has(c.path)) byFile.set(c.path, []); byFile.get(c.path).push(c); }
  const text = `Comments on the changes:\n\n${[...byFile].map(([p, list]) => list.map(c => `${base(p)}, line ${c.line}:\n> ${c.code.trim()}\n${c.text}`).join('\n\n')).join('\n\n')}\n\nPlease make these changes (or say why not).`;
  Preview.comments = [];
  showComments();
  putInBox(text, to);
}
(function startComments() {
  const box = $c('cPreview'); if (!box) return;
  box.addEventListener('click', e => {
    const t = e.target;
    if (t.closest('[data-pvc-add]')) return addComment(t.closest('.pv-ce'));
    if (t.closest('[data-pvc-cancel]')) return t.closest('.pv-ce').remove();
    const del = t.closest('[data-pvc-del]'); if (del) { Preview.comments = Preview.comments.filter(c => c.id !== del.dataset.pvcDel); return showComments(); }
    if (t.closest('[data-pvc-clear]')) { Preview.comments = []; return showComments(); }
    const send = t.closest('[data-pvsend]'); if (send) return sendComments(send.dataset.pvsend);
    const row = t.closest('.pv-r[data-ln]'); if (row) commentOn(row);
  });
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('.pv-r[data-ln]')) { e.preventDefault(); commentOn(e.target); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.closest('.pv-ce')) { e.preventDefault(); addComment(e.target.closest('.pv-ce')); }
    if (e.key === 'Escape' && e.target.closest('.pv-ce')) { e.stopPropagation(); e.target.closest('.pv-ce').remove(); }
  });
})();
