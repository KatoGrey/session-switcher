'use strict';
/* The top of a project's page: what's running here, what's in the way, and where its files stand in git.
   Not in Imperial and Rebel, whose project page stays as it is. */

const Now = {};   // cwd -> { at, r }
const NOW_TTL = 20e3;
function loadNow(p) {
  const had = Now[p.cwd];
  if (!p.exists || (had && Date.now() - had.at < NOW_TTL)) return;
  Now[p.cwd] = { at: Date.now(), r: had && had.r };
  api(`/api/project/now?cwd=${encodeURIComponent(p.cwd)}`).then(r => {
    Now[p.cwd] = { at: Date.now(), r };
    if (S.view === 'folder' && S.folder === p.cwd) renderProjectNow();
  }).catch(() => {});
}
function nowGitLine(g) {
  const sync = [g.ahead ? `${g.ahead} to push` : '', g.behind ? `${g.behind} to pull` : ''].filter(Boolean).join(', ');
  const last = g.commits[0];
  const bits = [
    `<span class="wn-branch"><span class="glyph" aria-hidden="true">⎇</span>${esc(g.branch || 'No branch')}</span>`,
    sync ? `<span>${esc(sync)}</span>` : '',
    last ? `<span class="wn-last" title="${esc(last.subject)}">Last commit <span data-ago="${last.at}">${esc(agoL(last.at))}</span>: ${esc(last.subject)}</span>` : '<span>No commits yet</span>',
  ].filter(Boolean);
  return bits.join('<span class="wn-dot" aria-hidden="true">·</span>');
}
function nowDetails(cwd, g) {
  const open = S.nowOpen && S.nowOpen.has(cwd);
  const STATUS = { changed: '', added: 'added', new: 'new', deleted: 'deleted', renamed: 'renamed', copied: 'copied', 'in conflict': 'in conflict' };
  const files = g.files.map(f => {
    const tag = STATUS[f.status] ? `<span class="wn-st ${f.status === 'in conflict' ? 'hot' : ''}">${esc(STATUS[f.status])}</span>` : '';
    return `<li>${f.status === 'deleted' ? `<span class="wn-f gone">${esc(f.rel)}</span>` : `<button class="linkish wn-f" data-now-file="${esc(f.file)}">${esc(f.rel)}</button>`}${tag}</li>`;
  }).join('');
  const more = g.changed > g.files.length ? `<li class="wn-more">And ${g.changed - g.files.length} more.</li>` : '';
  const commits = g.commits.map(c => `<li><code>${esc(c.hash)}</code><span class="wn-subj" title="${esc(c.subject)}">${esc(c.subject)}</span><span class="wn-ago" data-ago="${c.at}">${esc(agoL(c.at))}</span></li>`).join('');
  return `<details class="wn-more-box" data-now-fold ${open ? 'open' : ''}><summary>${g.changed ? plural(g.changed, 'file') : 'Nothing'} not committed${g.commits.length ? ` · last ${plural(g.commits.length, 'commit')}` : ''}</summary>
    <div class="wn-cols">
      ${g.changed ? `<div><p class="wn-h">Not committed</p><ul class="wn-list">${files}${more}</ul><p class="wn-do"><button class="linkish" data-now-diff>See the changes</button><button class="linkish" data-now-commit>Have a chat look through these and commit them…</button></p></div>` : ''}
      ${g.commits.length ? `<div><p class="wn-h">Latest commits</p><ul class="wn-list wn-commits">${commits}</ul></div>` : ''}
    </div>
  </details>`;
}
function projectNowHtml(p) {
  if (sagaLook()) return '';
  const here = p.cwd.toLowerCase(), inside = `${here.replace(/\\/g, '/').replace(/\/+$/, '')}/`;
  const open = S.activity.filter(x => !x.parentKey && x.cwd && x.cwd.toLowerCase() === here && !isCommander(x.sessionId));
  const chats = open.map(x => { const s = chatState(x); return `<button class="wn-chat" data-now-open="${esc(keyOf(x))}" title="${esc(x.title || 'New chat')}"><span class="${s.dot}" aria-hidden="true"></span><span class="wn-t">${esc(x.title || 'New chat')}</span><span class="wn-s">${esc(s.word)}</span></button>`; }).join('');
  const clash = typeof clashList === 'function' ? clashList().filter(r => r.file.toLowerCase().replace(/\\/g, '/').startsWith(inside)) : [];
  const n = Now[p.cwd] && Now[p.cwd].r, g = n && n.git;
  if (!chats && !clash.length && !g) return '';
  return `<div class="wn-in">
    ${chats ? `<div class="wn-chats" role="group" aria-label="Open in this project">${chats}</div>` : ''}
    ${clash.length ? clashCard(clash) : ''}
    ${g ? `<div class="wn-git">${nowGitLine(g)}</div>${g.changed || g.commits.length ? nowDetails(p.cwd, g) : ''}` : ''}
  </div>`;
}
function renderProjectNow() {
  const el = $('wpNow'); if (!el) return;
  const p = S.projects.find(x => x.cwd === S.folder); if (!p) return;
  loadNow(p);
  if (!sagaLook()) loadChanges(p.cwd);
  const h = projectNowHtml(p);
  if (el._h !== h) {
    // Redrawn only if something changed, and a fold you've opened stays open.
    el.innerHTML = h; el._h = h;
  }
}
/* ---------- the Documents tab: words in the project's files ---------- */
function docDeepOffer(q) {
  const b = $('docDeep'), hits = $('docHits'), lists = $('docLists'); if (!b) return;
  b.hidden = q.length < 2;
  b.textContent = q.length < 2 ? '' : `Look inside every file for “${q.length > 30 ? `${q.slice(0, 30)}…` : q}”`;
  if (hits && !hits.hidden) { hits.hidden = true; hits.innerHTML = ''; if (lists) lists.hidden = false; }
}
async function docDeepSearch() {
  const q = (S.docFilter || '').trim(), cwd = S.folder, hits = $('docHits'), lists = $('docLists');
  if (q.length < 2 || !hits) return;
  lists.hidden = true; hits.hidden = false;
  hits.innerHTML = '<p class="loading">Looking…</p>';
  const r = await api(`/api/project/find?${new URLSearchParams({ cwd, q })}`);
  if (S.folder !== cwd || (S.docFilter || '').trim() !== q || !$('docHits')) return;
  const row = h => `<li><button class="fh-file" data-find-open="${esc(h.path)}"><span class="fh-n" title="${esc(h.rel)}">${esc(h.rel)}</span><span class="count">${h.count}</span>${h.lines.map(l => `<span class="fh-line"><i>${l.n}</i>${esc(l.text)}</span>`).join('')}</button></li>`;
  $('docHits').innerHTML = `<p class="wb-note fh-note">${r.hits.length ? `${plural(r.hits.length, 'file')} with “${esc(q)}”` : `No file here has “${esc(q)}” in it`}, of ${plural(r.files, 'file')} of words.${r.cut ? ' It stopped early: there’s a lot here, so this isn’t all of them.' : ''}</p><ul class="fh-list">${r.hits.map(row).join('')}</ul>`;
  announce(`${plural(r.hits.length, 'file')} found.`);
}

/* ---------- the Memory tab: what Claude keeps for itself about this project ---------- */
const Memory = {};   // cwd -> { at, r }
const MEM_TYPES = { project: 'About the project', feedback: 'How you like things done', user: 'About you', reference: 'Where things are' };
function loadMemory(cwd, fresh = false) {
  const had = Memory[cwd];
  if (had && !fresh && Date.now() - had.at < 15e3) return;
  Memory[cwd] = { at: Date.now(), r: had && had.r };
  const done = r => { Memory[cwd] = { at: Date.now(), r }; if (S.view === 'folder' && S.folder === cwd && S.worldTab === 'memory') renderProjectMemory(); };
  api(`/api/project/memory?cwd=${encodeURIComponent(cwd)}`).then(done, () => done((had && had.r) || { notes: [] }));
}
function renderProjectMemory() {
  const box = $('wpBody'); if (!box || S.worldTab !== 'memory') return;
  const cwd = S.folder, had = Memory[cwd], r = had && had.r;
  loadMemory(cwd);
  if (!r) { box.innerHTML = '<p class="loading">Reading what Claude remembers…</p>'; box._h = null; return; }
  if (!$('memList')) {
    box._h = null;
    box.innerHTML = `<div class="wb-top"><label class="wb-filter"><span class="sr">Filter notes</span><input type="search" id="memFilter" placeholder="Filter notes" autocomplete="off" spellcheck="false" value="${esc(S.memFilter || '')}"></label><span class="wb-note">What Claude has noted for itself here. It reads these at the start of each chat.</span></div><div id="memList"></div>`;
  }
  drawMemory(r);
}
function drawMemory(r) {
  const q = (S.memFilter || '').trim().toLowerCase();
  const list = r.notes.filter(n => !q || `${n.title} ${n.description} ${n.file}`.toLowerCase().includes(q));
  const groups = new Map();
  for (const n of list) { const k = n.type && MEM_TYPES[n.type] ? n.type : ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
  const order = [...Object.keys(MEM_TYPES), ''].filter(k => groups.has(k));
  const row = n => `<li class="mem-row"><button class="mem-open" data-mem-open="${esc(n.path)}"><span class="mem-t">${esc(n.title)}</span>${n.description ? `<span class="mem-d">${esc(n.description)}</span>` : ''}</button><span class="mem-w" data-ago="${n.mtime}">${esc(agoL(n.mtime))}</span><button class="btn quiet sm" data-mem-forget="${esc(n.file)}" aria-label="Forget ${esc(n.title)}">Forget</button></li>`;
  const out = !r.notes.length ? '<p class="empty-line">Claude hasn’t noted anything for itself here yet.</p>'
    : !list.length ? '<p class="empty-line">No note has that in it.</p>'
      : order.map(k => `<div class="docgroup"><p class="dg-h">${esc(MEM_TYPES[k] || 'Other notes')}<span class="count">${groups.get(k).length}</span></p><ul class="mem-list">${groups.get(k).map(row).join('')}</ul></div>`).join('');
  const el = $('memList');
  if (el && el._h !== out) { el.innerHTML = out; el._h = out; }
}
async function forgetNote(file) {
  const cwd = S.folder, r = Memory[cwd] && Memory[cwd].r, n = r && r.notes.find(x => x.file === file); if (!n) return;
  if (!(await window.appConfirm(`Forget “${n.title}”?\n\nClaude won’t read it in its next chats. It’s set aside, not deleted.`, { ok: 'Forget it' }))) return;
  const done = await api('/api/project/memory/forget', { cwd, file });
  r.notes = r.notes.filter(x => x !== n);
  drawMemory(r);
  toast(`“${n.title}” is forgotten.`, 8000, { label: 'Bring it back', run: async () => {
    await api('/api/project/memory/forget', { cwd, file, kept: done.kept, line: done.line });
    await new Promise(res => { Memory[cwd].at = 0; api(`/api/project/memory?cwd=${encodeURIComponent(cwd)}`).then(x => { Memory[cwd] = { at: Date.now(), r: x }; res(); }, res); });
    if (S.view === 'folder' && S.folder === cwd && S.worldTab === 'memory' && Memory[cwd].r) drawMemory(Memory[cwd].r);
  } });
}

/* ---------- the Changes tab: what the chats here have changed, newest first ---------- */
const Changes = {};   // cwd -> { at, list }
function loadChanges(cwd, fresh = false) {
  const had = Changes[cwd];
  if (had && !fresh && Date.now() - had.at < 15e3) return;
  Changes[cwd] = { at: Date.now(), list: had && had.list };
  const done = list => {
    Changes[cwd] = { at: Date.now(), list };
    // The tab's count, and the list if it's what's showing.
    if (S.view === 'folder' && S.folder === cwd && !(window.ChatUI && ChatUI.isOpen())) renderFolder();
  };
  api(`/api/project/changes?cwd=${encodeURIComponent(cwd)}`).then(r => done(r.changes), () => done((had && had.list) || []));
}
function changeRow(c, i) {
  const [s] = sessionById(c.chat);
  const title = s ? s.title : 'A chat that’s gone', who = PROV_NAME[c.by] || 'Claude';
  const line = c.files.slice(0, 6).map(f => `<span class="pc-f" title="${esc(f.path)}">${esc(base(f.path))}${f.status === 'added' ? ' <small>new</small>' : f.status === 'deleted' ? ' <small>deleted</small>' : ''}</span>`).join('');
  const n = c.files.length + c.more;
  return `<li class="pc-row ${c.undone ? 'undone' : ''}">
    <span class="pc-time" title="${esc(new Date(c.at).toLocaleString())}">${esc(new Date(c.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</span>
    <div class="pc-main"><p class="pc-who"><button class="linkish pc-chat" data-pc-open="${esc(c.chat)}" title="Open this chat">${esc(title)}</button> <span class="pc-by">${esc(who)}</span>${c.undone ? ' <span class="pc-by">undone</span>' : ''}</p>
      <p class="pc-files">${line}${n > 6 ? `<span class="pc-f more">and ${n - 6} more</span>` : ''}</p></div>
    <span class="pc-n">${c.add || c.del ? `<i class="d-add">+${c.add}</i> <i class="d-del">−${c.del}</i>` : plural(n, 'file')}</span>
    <button class="btn quiet sm" data-pc-view="${i}">See the changes</button>
  </li>`;
}
function renderProjectChanges() {
  const box = $('wpBody'); if (!box || S.worldTab !== 'changes') return;
  const cwd = S.folder, had = Changes[cwd], list = had && had.list;
  loadChanges(cwd);
  if (!list) { box.innerHTML = '<p class="loading">Reading what’s changed…</p>'; box._h = null; return; }
  const titleOf = c => { const [s] = sessionById(c.chat); return s ? s.title || '' : ''; };
  const kinds = [...new Set(list.map(c => c.by))];
  const by = kinds.includes(S.changeBy) ? S.changeBy : 'all', q = (S.changeFilter || '').trim().toLowerCase();
  const matches = (c, i) => (by === 'all' || c.by === by) && (!q || c.files.some(f => f.path.toLowerCase().includes(q)) || titleOf(c).toLowerCase().includes(q));
  const day = t => new Date(t).toDateString(), today = day(Date.now()), yest = day(Date.now() - 864e5);
  const label = t => { const d = day(t); return d === today ? 'Today' : d === yest ? 'Yesterday' : new Date(t).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }); };
  let h = '', last = null;
  list.forEach((c, i) => {
    if (!matches(c, i)) return;
    const d = day(c.at);
    if (d !== last) { if (last) h += '</ul></div>'; h += `<div class="docgroup"><p class="dg-h">${esc(label(c.at))}</p><ul class="pc-list">`; last = d; }
    h += changeRow(c, i);
  });
  if (last) h += '</ul></div>';
  const out = !list.length ? '<p class="empty-line">Nothing recorded yet. Each reply’s changes show here as chats make them.</p>'
    : h ? `<p class="wb-note pc-note">What each reply changed, in every chat here. Open a chat to undo one of its replies.</p>${h}`
    : '<p class="empty-line">No change here matches that.</p>';
  // The box stays as it is while you type: only what's under it is drawn again.
  if (!$('pcList')) { box.innerHTML = '<div class="wb-top" id="pcTop"><span id="pcSeg"></span><label class="wb-filter" id="pcBox"><span class="sr">Filter changes</span><input type="search" id="pcFilter" placeholder="Filter by file or chat" autocomplete="off" spellcheck="false"></label></div><div id="pcList"></div>'; box._h = null; }
  const seg = kinds.length > 1 ? `<div class="seg provseg" role="group" aria-label="Show">${[['all', 'All', list.length], ...kinds.map(k => [k, PROV_TITLE[k] || PROV_NAME[k] || k, list.filter(c => c.by === k).length])].map(([v, l, n]) => `<button class="${by === v ? 'on' : ''}" data-pc-by="${esc(v)}" aria-pressed="${by === v}">${esc(l)} <span class="count">${n}</span></button>`).join('')}</div>` : '';
  if ($('pcSeg')._h !== seg) { $('pcSeg').innerHTML = seg; $('pcSeg')._h = seg; }
  // A few are easy enough to read.
  $('pcBox').hidden = list.length < 6 && !q && !window.__pcBoxAlways;
  $('pcTop').hidden = !seg && $('pcBox').hidden;
  if ($('pcFilter').value !== (S.changeFilter || '') && document.activeElement !== $('pcFilter')) $('pcFilter').value = S.changeFilter || '';
  const lb = $('pcList');
  if (lb._h !== out) { lb.innerHTML = out; lb._h = out; }
}
(function startNow() {
  $('page').addEventListener('click', wrap(async e => {
    const t = e.target; if (!(t instanceof Element)) return;
    if (t.closest('[data-doc-deep]')) return docDeepSearch();
    const fo = t.closest('[data-find-open]');
    if (fo) {
      const q = (S.docFilter || '').trim();
      await Viewer.open({ path: fo.dataset.findOpen, cwd: S.folder });
      if (q) DocFind.search(q);
      return;
    }
    const memOpen = t.closest('[data-mem-open]');
    if (memOpen) return Viewer.open({ path: memOpen.dataset.memOpen, cwd: S.folder });
    const memForget = t.closest('[data-mem-forget]');
    if (memForget) return forgetNote(memForget.dataset.memForget);
    const pcBy = t.closest('[data-pc-by]');
    if (pcBy) { S.changeBy = pcBy.dataset.pcBy; return renderProjectChanges(); }
    const pcOpen = t.closest('[data-pc-open]');
    if (pcOpen) return ChatUI.open({ sessionId: pcOpen.dataset.pcOpen });
    const pcView = t.closest('[data-pc-view]');
    if (pcView) {
      const c = (Changes[S.folder] && Changes[S.folder].list || [])[Number(pcView.dataset.pcView)]; if (!c) return;
      const [s] = sessionById(c.chat);
      return viewChanges({ _ev: { files: c.files }, dataset: {} }, `/api/project/change-diff?${new URLSearchParams({ id: c.id, turn: String(c.turn) })}`, s ? s.title : 'What it changed');
    }
    if (!t.closest('#wpNow')) return;
    const o = t.closest('[data-now-open]');
    if (o) { const x = findActivity(o.dataset.nowOpen); if (x) return openActivity(x); return; }
    const f = t.closest('[data-now-file]');
    if (f) return Viewer.open({ path: f.dataset.nowFile, cwd: S.folder });
    if (t.closest('[data-now-diff]')) {
      const g = Now[S.folder] && Now[S.folder].r && Now[S.folder].r.git; if (!g) return;
      const files = g.files.filter(f => !f.dir).map(f => ({ path: f.rel, status: f.status === 'new' || f.status === 'added' ? 'added' : f.status === 'deleted' ? 'deleted' : 'changed', add: null, del: null }));
      return viewChanges({ _ev: { files }, dataset: {} }, `/api/project/diff?cwd=${encodeURIComponent(S.folder)}`, 'Not committed');
    }
    if (t.closest('[data-now-commit]')) return ChatUI.open({ cwd: S.folder, mode: 'new', initialText: 'Look through what isn’t committed in this project. Group it into sensible commits with clear messages, tell me the plan, and commit once I’ve said so. Don’t push.' });
  }));
  $('page').addEventListener('input', e => {
    if (e.target.id !== 'memFilter') return;
    S.memFilter = e.target.value;
    const r = Memory[S.folder] && Memory[S.folder].r;
    if (r) drawMemory(r);
  });
  $('page').addEventListener('toggle', e => {
    if (!(e.target instanceof Element) || !e.target.matches('[data-now-fold]')) return;
    const set = S.nowOpen || (S.nowOpen = new Set());
    if (e.target.open) set.add(S.folder); else set.delete(S.folder);
    const el = $('wpNow'); if (el) el._h = null;   // what's in the html no longer says what's open
  }, true);
}());
