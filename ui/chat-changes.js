'use strict';
/* What each reply changed (in a git project): a bar under the reply ("Changed 3 files"), a look at the
   changes, and Undo, which puts those files back as they were before it. The one whose changes were
   undone hears about it with your next message (in its catch-up), so it doesn't build on them. */

const fileLine = f => `${esc(base(f.path))}${f.status === 'added' ? ' <small>new</small>' : f.status === 'deleted' ? ' <small>deleted</small>' : f.add !== null ? ` <small><i class="d-add">+${f.add}</i> <i class="d-del">−${f.del}</i></small>` : ''}`;

function changesBar(ev, src) {
  const n = ev.files.length + (ev.more || 0);
  return `<div class="chg" data-src="${src}" data-turn="${ev.turn}">
    <span class="chg-h">Changed ${n} file${n === 1 ? '' : 's'}</span>
    <span class="chg-f">${ev.files.slice(0, 4).map(fileLine).join(' · ')}${n > 4 ? ` · and ${n - 4} more` : ''}</span>
    <span class="chg-b"><button type="button" class="ta" data-c="chgview">See the changes</button><button type="button" class="ta" data-c="chgundo" title="Puts these files back as they were before this reply">Undo</button></span></div>`;
}
function renderChanges(ev, src) {
  const prov = provFor(src);
  const turn = [...$c('cFeed').querySelectorAll('.turn')].filter(t => (t.dataset.prov || C.provider) === prov).pop();
  if (!turn || turn.querySelector(`.chg[data-turn="${ev.turn}"][data-src="${src}"]`)) return;
  withStick(() => turn.insertAdjacentHTML('beforeend', changesBar(ev, src)));
  const bar = turn.lastElementChild;
  bar._ev = ev;
}
function renderUndone(ev, src) {
  const bar = $c('cFeed').querySelector(`.chg[data-turn="${ev.turn}"][data-src="${src}"]`);
  const r = ev.restored.length, kept = ev.skipped.filter(x => x.why === 'changed since');
  if (bar) {
    bar.classList.add('undone');
    bar.querySelector('.chg-h').textContent = r ? `Undone: ${r} file${r === 1 ? '' : 's'} put back` : 'Nothing was undone';
    if (!kept.length) bar.querySelector('[data-c="chgundo"]')?.remove();
  }
  // Its next message says so, so it doesn't build on what isn't there any more.
  if (r) (C.undoNotes[src] = C.undoNotes[src] || []).push(ev.restored);
}

async function undoChanges(bar, force = false) {
  const ev = bar && bar._ev; if (!ev) return;
  const src = bar.dataset.src, key = keyFor(src), name = PROV_NAME[provFor(src)];
  const n = ev.files.length;
  if (!force && !(await window.appConfirm(`Undo the changes from this reply?\n\nPuts ${n === 1 ? base(ev.files[0].path) : `these ${n} files`} back as they were before ${name} replied. A file that’s changed since is left as it is.`, { ok: 'Undo them' }))) return;
  const r = await api('/api/chat/undo', { key, turn: ev.turn, force });
  const kept = r.skipped.filter(x => x.why === 'changed since');
  if (!force && kept.length) {
    if (await window.appConfirm(`${kept.length === 1 ? `${base(kept[0].path)} has` : `${kept.length} files have`} changed since this reply, so ${kept.length === 1 ? 'it was' : 'they were'} left as ${kept.length === 1 ? 'it is' : 'they are'}.\n\nUndo ${kept.length === 1 ? 'it' : 'them'} anyway? Whatever changed since is lost: ${kept.map(x => base(x.path)).join(', ')}.`, { ok: 'Undo anyway', danger: true })) return undoChanges(bar, true);
  }
  toast(r.restored.length ? `Put back ${r.restored.length} file${r.restored.length === 1 ? '' : 's'}. ${name} hears about it with your next message.` : 'Nothing was undone.', 5000);
  return undefined;
}

// The changes, file by file, in a dialog. (diffUrl and title: for a race's copy instead of a reply.)
async function viewChanges(bar, diffUrl = null, title = null) {
  const ev = bar && bar._ev; if (!ev) return;
  const key = diffUrl ? null : keyFor(bar.dataset.src);
  let d = $c('chgDlg');
  if (!d) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="chgDlg" class="wide chg-dlg" aria-labelledby="chgTitle"><div class="setup-head"><h3 id="chgTitle">Changes</h3><button class="icon" data-chgclose aria-label="Close">✕</button></div><div class="chg-body" id="chgBody"></div></dialog>`);
    d = $c('chgDlg');
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-chgclose]')) d.close(); });
  }
  $c('chgTitle').textContent = `${title || `What ${PROV_NAME[provFor(bar.dataset.src)]} changed`} (${ev.files.length} file${ev.files.length === 1 ? '' : 's'})`;
  $c('chgBody').innerHTML = ev.files.slice(0, 40).map((f, i) => `<section class="chg-file"><p class="chg-fh"><b>${esc(f.path)}</b> ${f.status === 'added' ? '<small>new file</small>' : f.status === 'deleted' ? '<small>deleted</small>' : ''}</p><pre class="chg-diff" data-i="${i}">Loading…</pre></section>`).join('')
    + (ev.files.length > 40 ? `<p class="rd-intro">And ${ev.files.length - 40} more.</p>` : '');
  d.showModal();
  for (const [i, f] of ev.files.slice(0, 40).entries()) {
    const pre = $c('chgBody').querySelector(`.chg-diff[data-i="${i}"]`);
    try {
      const r = await api(diffUrl ? `${diffUrl}&path=${encodeURIComponent(f.path)}` : `/api/chat/diff?key=${encodeURIComponent(key)}&turn=${ev.turn}&path=${encodeURIComponent(f.path)}`);
      pre.innerHTML = diffHtml(r.diff) || '<span class="dl">(no text changes: a binary or empty file)</span>';
    } catch (err) { pre.textContent = err.message; }
    if (!d.open) return;
  }
}
// A unified diff with its added and removed lines marked (the file headers left out).
function diffHtml(text) {
  return String(text || '').split('\n').filter(l => !/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode)/.test(l))
    .map(l => `<span class="dl ${l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}">${esc(l) || ' '}</span>`).join('');
}
