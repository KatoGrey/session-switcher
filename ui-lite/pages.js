'use strict';
/* Projects (cards by bucket; quiet ones fold into chips), a project's page (Focus, then chats by
   status), Bugs (every bug, by status), lists,
   Archived, Clean up, Images, Alerts, and the menus for a chat or a project. */

// Grouped views (a project's status sections) leave the status pill out: the heading says it.
// Mixed lists (Recents, search, Focus) show it.
function rowHtml(c, { showProject = false, showStage = false, depth = 0 } = {}) {
  const p = projOf(c), par = parentOn(c);
  const inParent = par && !depth ? ` · in “${esc(par.title.slice(0, 40))}”` : '';
  const sub = showProject ? `${esc(p.name)}${p.bucket ? ` · ${esc(bucketName(p.bucket))}` : ''}${inParent}` : (c.waiting && c.note ? esc(c.note) : inParent.replace(/^ · /, ''));
  const st = statusById(statusOf(c));
  // In a family, a sub-chat that belongs to another project says which.
  const ranTag = depth && par && par.project !== c.project ? `<span class="tag" title="Lives in ${esc(p.name)}">${esc(p.name)}</span>` : '';
  return `<div class="row ${depth ? 'sub kid' : par ? 'sub' : ''} ${isQuiet(c) ? 'is-quiet' : ''}" ${depth ? `style="--d:${depth}"` : ''} role="button" tabindex="-1" draggable="true" data-chat="${esc(c.id)}" data-cur="${esc(c.id)}" aria-selected="${S.sel.has(c.id)}">
    ${needs(c) ? '<span class="dot needs-dot" title="Needs you"></span>' : running(c) ? '<span class="live-dot" title="Running"></span>' : '<span></span>'}
    <span class="t"><b>${focusStar(c)}${esc(c.title)}</b>${sub ? `<small>${sub}</small>` : ''}</span>
    <span class="side-tags">${c.fromRoutine ? `<span class="tag" title="Started by the routine “${esc(c.fromRoutine)}”">from ${esc(c.fromRoutine.slice(0, 24))}</span>` : ''}${ranTag}${kindTag(c)}${waitTag(c)}${c.provider === 'codex' ? '<span class="tag">Codex</span>' : ''}${showStage ? `<button class="stage" data-rowmenu="${esc(c.id)}" aria-haspopup="menu"><span class="dot" style="background:${st.c}"></span>${st.name}</button>` : ''}</span>
    <span class="when">${ago(c.updated)}</span>
    <button class="iconbtn rmenu" data-rowmenu="${esc(c.id)}" aria-haspopup="menu" aria-label="Move or change">${IC.dots}</button>
  </div>`;
}
// A list with families: each top-level chat, then one line for its sub-chats ("3 sub-chats · 1
// running"); opened (click it, or → on the parent), the sub-chats follow, indented.
function famRowsHtml(list, opts = {}) {
  return list.filter(isTop).sort((a, b) => famUpdated(b) - famUpdated(a)).map(t => rowHtml(t, opts) + famBlock(t, opts, 1)).join('');
}
function famBlock(t, opts, depth) {
  const kids = kidsOf(t.id); if (!kids.length) return '';
  const all = descOf(t.id), open = famOpen(t.id);
  const run = all.filter(running).length, nd = all.filter(needs).length;
  const line = `<div class="row fam-line" role="button" tabindex="-1" data-fam="${esc(t.id)}" data-cur="f:${esc(t.id)}" aria-expanded="${open}" style="--d:${depth}"><span>${nd ? '<span class="dot needs-dot"></span>' : run ? '<span class="live-dot"></span>' : ''}</span><span class="t"><small><span class="fam-caret">›</span>${all.length} sub-chat${all.length === 1 ? '' : 's'}${run ? ` · ${run} running` : ''}${nd ? ` · ${nd} need${nd === 1 ? 's' : ''} you` : ''}</small></span><span class="side-tags"></span><span class="when">${ago(Math.max(...all.map(k => k.updated)))}</span><span></span></div>`;
  return open ? line + kids.map(k => rowHtml(k, { ...opts, showProject: false, showStage: statusOf(k) !== statusOf(t), depth }) + famBlock(k, opts, depth + 1)).join('') : line;
}
const selHint = () => '<p class="hint-line"><kbd>j</kbd> <kbd>k</kbd> to move, <kbd>↵</kbd> to open, <kbd>1</kbd>–<kbd>4</kbd> for status, <kbd>f</kbd> for Focus, <kbd>e</kbd> to archive, <kbd>x</kbd> to select. <kbd>?</kbd> shows them all.</p>';
const BACK = '<button class="iconbtn back" data-go="side" aria-label="Back">‹</button>';

function stageBar(cs) {
  const lv = live(cs); if (!lv.length) return '<div class="stagebar"></div>';
  return `<div class="stagebar">${STATUSES.filter(s => s.id !== 'done').map(s => { const n = lv.filter(c => statusOf(c) === s.id).length; return n ? `<i style="width:${100 * n / lv.length}%;background:${s.c}" title="${s.name}: ${n}"></i>` : ''; }).join('')}</div>`;
}
function cardHtml(p) {
  const cs = chatsOfProject(p.key), lv = live(cs);
  const w = lv.filter(c => c.waiting).length;
  const nd = cs.some(needs);
  const making = S.gen && S.gen[p.key];
  return `<button class="card ${nd ? 'needs' : ''}" draggable="true" data-project="${esc(p.key)}" data-cur="p:${esc(p.key)}">
    <span class="art ${making ? 'making' : ''}" style="${artStyle(p)}">${making ? '' : artInner(p)}</span>
    <span class="body"><span class="name">${esc(p.name)}</span>${stageBar(cs)}
      <span class="meta">${nd ? '<span class="dot needs-dot"></span>' : ''}<span>${lv.length} active${w ? ` · ${w} waiting` : ''}</span></span></span></button>`;
}
const projectsIn = b => S.projects.filter(p => !p.archived && (b === null ? !p.bucket : p.bucket === b));
const hasChats = p => chatsOfProject(p.key).length > 0;
function home() {
  const groups = [...buckets().map(b => ({ id: b.id, name: b.name })), { id: null, name: 'Unsorted' }];
  const sections = groups.map(b => {
    const ps = projectsIn(b.id).filter(p => b.id !== null || hasChats(p)).sort((x, y) => y.updated - x.updated);
    if (b.id === null && !ps.length) return '';
    const act = ps.filter(p => live(chatsOfProject(p.key)).length);
    const quiet = ps.filter(p => !live(chatsOfProject(p.key)).length);
    return `<section class="section" data-drop-bucket="${esc(b.id || '')}">
      <div class="sec-h"><h2>${esc(b.name)}</h2><span class="n">${ps.length || ''}</span>${b.id === null ? '<span class="hint">Drag one onto a bucket, or right-click it</span>' : `<button class="hint" data-bstages="${esc(b.id)}" title="Whether chats in these projects are grouped by status in the sidebar">${bucketStages(b.id) ? 'By status' : 'Plain list'}</button>`}</div>
      ${act.length ? `<div class="cards">${act.map(cardHtml).join('')}</div>` : ''}
      ${!ps.length ? '<div class="dropzone">Drag projects here</div>' : ''}
      ${quiet.length ? `<div class="quiet-line"><span class="why" title="No chat here has moved in ${quietDays()} days, or every chat is Done. A new chat or message brings it back up.">Quiet:</span>${quiet.map(p => `<button data-project="${esc(p.key)}" draggable="true" data-cur="p:${esc(p.key)}"><span class="thumb-xs" style="${artStyle(p)}"></span>${esc(p.name)}</button>`).join('')}</div>` : ''}
    </section>`;
  }).join('');
  const setup = !buckets().length ? '<p class="lead">No buckets yet. Buckets say what a project is for (a product, games, personal apps). They live in lite.json in your data folder.</p>' : '';
  return `<div class="wrap"><div class="page-h"><div class="proj-h">${BACK}<h1>${L('Projects')}</h1></div><button class="btn" data-go="cleanup">Clean up…</button></div>${setup}${sections}
    <p class="hint-line">Drag a project (card or quiet chip) onto another bucket to move it. Right-click one for its picture, bucket or archive.</p></div>`;
}

function listView(kind) {
  const all = allChats();
  let list, title;
  if (kind === 'search') {
    const q = S.q.toLowerCase();
    list = all.filter(c => c.title.toLowerCase().includes(q) || projOf(c).name.toLowerCase().includes(q) || (c.firstPrompt || '').toLowerCase().includes(q)).sort((a, b) => b.updated - a.updated).slice(0, 80);
    title = `Search: ${S.q}`;
  } else { list = all.filter(inBucket).sort((a, b) => b.updated - a.updated).slice(0, 60); title = L('Recents'); }
  return `<div class="wrap"><div class="page-h"><div class="proj-h">${BACK}<h1>${esc(title)}</h1></div></div>
    <div class="rows">${list.map(c => rowHtml(c, { showProject: true, showStage: true })).join('') || '<p class="empty-note">Nothing here.</p>'}</div>${selHint()}</div>`;
}

function project() {
  const p = projBy.get(S.project);
  if (!p) return `<div class="wrap"><p class="empty-note">That project isn’t in the list any more.</p></div>`;
  const cs = chatsOfProject(p.key).sort((x, y) => y.updated - x.updated);
  const foc = cs.filter(c => c.focus && statusOf(c) !== 'done');
  const focusSec = foc.length ? `<section class="section" data-drop-focus="1"><div class="sec-h"><h2><span class="focus-star">★</span>Focus</h2><span class="n">${foc.length}</span></div><div class="rows">${foc.map(c => rowHtml(c, { showStage: true })).join('')}</div></section>` : '';
  const sections = focusSec + STATUSES.map(s => {
    const all = cs.filter(c => isTop(c) && statusOf(c) === s.id && !(c.focus && s.id !== 'done'));
    if (!all.length) return '';
    const folded = s.id === 'done' ? !S.more['p-done'] : false;
    const act = s.id === 'done' ? all : all.filter(c => !famQuiet(c)), quiet = s.id === 'done' ? [] : all.filter(famQuiet);
    const showQ = S.more['pq-' + s.id];
    const shown = showQ ? [...act, ...quiet] : act;
    return `<section class="section" data-drop-stage="${s.id}">
      <div class="sec-h">${s.id === 'done' ? `<button class="fold" data-pfold="1"><h2>${s.name}</h2><span class="n">${all.length}</span><span class="n">${folded ? 'Show' : 'Hide'}</span></button>` : `<h2><span class="dot" style="background:${s.c}"></span>${s.name}</h2><span class="n">${act.length}</span>`}
        ${quiet.length ? `<button class="hint" data-pq="${s.id}">${showQ ? 'Hide quiet' : `${quiet.length} quiet`}</button>` : ''}</div>
      ${folded || !shown.length ? '' : `<div class="rows">${famRowsHtml(shown)}</div>`}
    </section>`;
  }).join('');
  const autoN = S.chats.filter(c => c.project === p.key && c.auto).length;
  return `<div class="wrap">
    <div class="page-h">
      <div class="proj-h">${BACK}<span class="art-s" style="${artStyle(p)}">${artInner(p)}</span>
        <div style="min-width:0"><div class="crumb"><button data-go="home">${esc(bucketName(p.bucket))}</button><span>·</span><span class="mono">${esc((p.cwd || 'No folder').replace(/^\/Users\/[^/]+/, '~'))}${p.mono ? ` (${esc(p.name)} chats)` : ''}</span></div><h1>${esc(p.name)}</h1></div></div>
      <div style="display:flex;gap:6px">${p.cwd ? `<button class="btn prime" data-newchat="${esc(p.key)}">${L('New chat')} <kbd>c</kbd></button>` : ''}<button class="iconbtn" data-projmenu="${esc(p.key)}" aria-haspopup="menu" aria-label="Project options">${IC.dots}</button></div>
    </div>
    ${sections || '<p class="empty-note">No chats here yet.</p>'}
    ${autoN ? `<p class="hint-line">${autoN} automated Codex run${autoN === 1 ? '' : 's'} (started by scripts or other agents) are left out here.</p>` : ''}
    ${selHint()}
  </div>`;
}

/* ---------- Bugs: every bug across projects, by status ---------- */
/* ---------- Bugs: one list, by stage (Exploring, Working, Finish line; Done folded) ---------- */
let pipeLoading = null;
// Each bug chat's pull request (from the pipeline route: PR, checks, preview, testers), by chat id.
function loadPipeline(force = false) {
  const p = S.pipeline;
  if (pipeLoading || (!force && p && Date.now() - p.fetched < 60e3)) return;
  pipeLoading = api(`/api/lite/pipeline${force ? '?refresh=1' : ''}`)
    .then(j => { S.pipeline = { ...j, fetched: Date.now(), byChat: new Map((j.items || []).map(i => [i.chat, i])) }; },
      () => { S.pipeline = { items: [], fetched: Date.now(), byChat: new Map() }; })
    .finally(() => { pipeLoading = null; render(); });
}
// A preview link for repos whose pull requests get one (Latitude's: pr-<n>.preview.voyage.io).
const previewUrl = pr => (/github\.com\/latitudegames\/latitude\/pull\//.test(pr.url) ? `https://pr-${pr.number}.preview.voyage.io/` : null);
// One bug, one line: the title, then small marks for what matters (needs you or running, its PR,
// on a preview or with testers, checks).
function bugRow(c) {
  const it = pipeItem(c), pr = it && it.pr;
  const marks = [];
  if (needs(c)) marks.push('<span class="dot needs-dot" title="Needs you"></span>');
  else if (running(c)) marks.push('<span class="live-dot" title="Working now"></span>');
  // What its last report said, and whether it has gone quiet.
  const rep = it && it.report, stage = bugStage(c);
  if (rep === 'NEEDS-RYAN' || rep === 'READY-FOR-RYAN') marks.push(`<span class="bug-tag you" title="Its last report: ${rep}">${rep === 'READY-FOR-RYAN' ? 'ready for you' : 'your call'}</span>`);
  else if (rep === 'BLOCKED') marks.push('<span class="bug-tag blocked" title="Its last report: BLOCKED">blocked</span>');
  const quiet = Math.floor((Date.now() - (c.updated || 0)) / 864e5);
  if (stage !== 'done' && !running(c) && quiet >= 2) marks.push(`<span class="bug-tag" title="No activity for ${quiet} days">quiet ${quiet}d</span>`);
  if (pr) {
    if (it.stage === 'testers' || it.stage === 'preview') {
      const prev = previewUrl(pr);
      const ic = it.stage === 'testers' ? IC.people : IC.eye, tip = it.stage === 'testers' ? 'With testers' : 'On a preview';
      marks.push(prev ? `<a class="bug-ic" href="${esc(prev)}" target="_blank" rel="noopener noreferrer" title="${tip} (open the preview)">${ic}</a>` : `<span class="bug-ic" title="${tip}">${ic}</span>`);
    }
    if (pr.ci && pr.ci.state === 'failing') marks.push(`<span class="ci ci-failing" title="Failing: ${esc(pr.ci.failing.join(', '))}"></span>`);
    marks.push(`<a class="bug-pr" href="${esc(pr.url)}" target="_blank" rel="noopener noreferrer" title="${esc(pr.title)}${pr.draft ? ' (draft)' : ''}">${IC.pr}<span>${pr.number}</span></a>`);
  }
  return `<div class="row bug-row" role="button" tabindex="-1" draggable="true" data-chat="${esc(c.id)}" data-cur="${esc(c.id)}" aria-selected="${S.sel.has(c.id)}">
    <span class="t"><b>${esc(c.title.replace(/\s*\(from [^)]+\)\s*$/, ''))}</b></span>
    <span class="bug-marks">${marks.join('')}</span>
    <button class="iconbtn rmenu" data-rowmenu="${esc(c.id)}" aria-haspopup="menu" aria-label="Move or change">${IC.dots}</button>
  </div>`;
}
function bugsView() {
  loadPipeline();
  const all = bugList().filter(isTop).sort((x, y) => y.updated - x.updated);
  const sections = BUG_STAGES.map(s => {
    const list = all.filter(c => bugStage(c) === s.id);
    if (!list.length) return '';
    const folded = s.id === 'done' && !S.more['b-done'];
    return `<section class="section" data-drop-stage="${s.id}"><div class="sec-h">${s.id === 'done' ? `<button class="fold" data-bfold="1"><h2>${s.name}</h2><span class="n">${list.length}</span><span class="n">${folded ? 'Show' : 'Hide'}</span></button>` : `<h2><span class="dot" style="background:${s.c}"></span>${s.name}</h2><span class="n">${list.length}</span>`}${s.id === 'finishing' ? `<button class="iconbtn" data-pipe-refresh="1" title="Check GitHub again" aria-label="Check GitHub again">${IC.refresh}</button>` : ''}</div>
      ${folded ? '' : `<div class="rows">${list.map(bugRow).join('')}</div>`}</section>`;
  }).join('');
  return `<div class="wrap"><div class="page-h"><div class="proj-h">${BACK}<h1>Bugs</h1></div></div>
    ${sections || '<p class="empty-note">No bugs. A chat becomes one from its menu (Kind → Bug), and new chats about fixing something are guessed as bugs.</p>'}${selHint()}</div>`;
}

/* ---------- Automation: runs started by routines, scripts and other agents ---------- */
const AUTO_GROUPS = [
  ['routine', 'Routine runs', 'Each scheduled run of a routine.'],
  ['helper', 'Helper runs', 'Codex runs other chats started (codex exec), like GPT Sol doing research or a fix for an Opus chat.'],
  ['script', 'Script runs', 'Claude Code runs started from a script (claude -p), like GLM gathering for a sweep.'],
  ['starter', 'Starter chats', 'Chats Lite started on its own, like starting a plan\'s week.'],
];
function automationView() {
  const all = automationList();
  const kindOfRun = c => c.autoKind || (c.routineRun ? 'routine' : 'helper');
  const shown = S.more['auto-all'] ? 400 : 25;
  const sections = AUTO_GROUPS.map(([k, name, hint]) => {
    const list = all.filter(c => kindOfRun(c) === k);
    if (!list.length) return '';
    return `<section class="section"><div class="sec-h"><h2>${name}</h2><span class="n">${list.length}</span></div><p class="hint-line">${hint}</p>
      <div class="rows">${list.slice(0, shown).map(c => rowHtml(c, { showProject: true })).join('')}</div>${list.length > shown ? `<button class="linkish" data-automore="1">Show all ${list.length}</button>` : ''}</section>`;
  }).join('');
  return `<div class="wrap"><div class="page-h"><div class="proj-h">${BACK}<h1>Automation</h1></div></div>
    <p class="hint-line" style="margin-top:-12px">Runs started by routines, scripts and other agents. They stay out of your projects so they don't crowd your own chats; open any of them here, or archive the ones you're done with.</p>
    ${sections || '<p class="empty-note">Nothing yet. Routine runs, helper runs and script runs show up here.</p>'}</div>`;
}

/* ---------- Archived: out of every list, never deleted ---------- */
function archivedView() {
  const recs = S.lite.archived.chats || {};
  const chats = S.chats.filter(c => c.archived).sort((a, b) => (ms((recs[b.id] || {}).at) || 0) - (ms((recs[a.id] || {}).at) || 0));
  const projs = S.projects.filter(p => p.archived);
  const wtLine = c => { const r = recs[c.id] || {}; if (!c.worktree && !r.worktree) return 'no worktree'; if (r.worktreeRemoved) return `worktree removed · branch ${r.branch || 'kept'}`; return c.worktreeExists === false ? 'worktree gone' : 'worktree on disk'; };
  return `<div class="wrap"><div class="page-h"><div class="proj-h">${BACK}<h1>Archived</h1></div><button class="btn" data-go="cleanup">Clean up…</button></div>
    <p class="hint-line" style="margin-top:-12px">Out of every list, never deleted. Each keeps its project, status, kind, branch and worktree, so <b>Bring back</b> puts it where it was. A removed worktree can be rebuilt from its branch.</p>
    ${projs.length ? `<section class="section"><div class="sec-h"><h2>Projects</h2><span class="n">${projs.length}</span></div><div class="rows">${projs.map(p => `<div class="row acts" data-cur="p:${esc(p.key)}"><span class="thumb-xs" style="${artStyle(p)};width:18px;height:18px;border-radius:4px"></span><span class="t"><b>${esc(p.name)}</b><small>${esc(p.cwd || '')}</small></span><span class="side-tags"></span><span></span><button class="btn" data-unarch-p="${esc(p.key)}">Bring back</button></div>`).join('')}</div></section>` : ''}
    <section class="section"><div class="sec-h"><h2>Chats</h2><span class="n">${chats.length}</span></div>
      <div class="rows">${chats.map(c => { const r = recs[c.id] || {}; return `<div class="row acts" data-cur="${esc(c.id)}" data-open="${esc(c.id)}"><span></span><span class="t"><b>${esc(c.title)}</b><small>${esc(projOf(c).name)} · ${esc(statusById(r.status || c.status).name)}${(r.kind || c.kind) && (r.kind || c.kind) !== 'feature' ? ` · ${esc(kindById(r.kind || c.kind).name)}` : ''} · ${esc(wtLine(c))}</small></span>
        <span class="side-tags">${r.worktreeRemoved ? `<button class="btn sm" data-rebuild="${esc(c.id)}">Rebuild worktree</button>` : ''}</span><span class="when">${r.at ? ago(ms(r.at)) : ''}</span><button class="btn" data-unarch="${esc(c.id)}">Bring back</button></div>`; }).join('') || '<p class="empty-note">Nothing archived. Press <kbd>e</kbd> on a chat to archive it.</p>'}</div></section></div>`;
}

/* ---------- Clean up ---------- */
const gb = kb => (kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(kb > 10 * 1024 * 1024 ? 0 : 1)} GB` : `${Math.round(kb / 1024)} MB`);
const slimmable = sp => { const arch = new Set(S.chats.filter(c => c.archived).map(c => c.id)); return sp.worktrees.filter(w => w.worktree && w.heavyKB > 0 && w.chats.every(id => { const c = chatBy.get(id); return !c || arch.has(id) || isQuiet(c); })); };
const removableWts = sp => { const arch = new Set(S.chats.filter(c => c.archived).map(c => c.id)); return sp.worktrees.filter(w => w.worktree && w.chats.every(id => arch.has(id))); };
function cleanupView() {
  const sp = S.space || { worktrees: [], scanning: true };
  const slim = slimmable(sp), slimKB = slim.reduce((n, w) => n + w.heavyKB, 0);
  const removable = removableWts(sp);
  const quiet = allChats().filter(isQuiet);
  const top = sp.worktrees.filter(w => w.worktree).sort((a, b) => (b.kb || 0) - (a.kb || 0)).slice(0, 12);
  return `<div class="wrap"><div class="page-h"><div class="proj-h">${BACK}<h1>Clean up</h1></div>
      <span class="crumb">Go quiet after <span class="seg" role="group" aria-label="Days before a chat goes quiet">${[2, 4, 7].map(d => `<button data-quietdays="${d}" aria-pressed="${quietDays() === d}">${d} days</button>`).join('')}</span></span></div>
    <div class="plans" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">
      <div class="plan"><small>Chats’ worktrees on disk</small><span class="big-number">${sp.at ? gb(sp.totalKB) : '…'}</span><small>${sp.worktrees.filter(w => w.worktree).length} worktrees${sp.scanning ? ' · measuring…' : ''}</small></div>
      <div class="plan"><small>Dependencies and build output</small><span class="big-number">${sp.at ? gb(sp.heavyKB) : '…'}</span><small>node_modules, .next, dist, build, caches (git-ignored only)</small></div>
      <div class="plan"><small>From quiet or archived chats</small><span class="big-number">${sp.at ? gb(slimKB) : '…'}</span><small>${slim.length} worktrees can be slimmed</small></div>
    </div>
    <div class="rows clean">
      <div class="clean-row"><span><b>Free space in ${slim.length} worktrees of quiet or archived chats</b><small>Removes git-ignored dependencies and build output only. Code, uncommitted changes, the branch and the chat all stay; reinstall dependencies when you pick it up again.</small></span><button class="btn prime" data-clean="slim" ${slim.length ? '' : 'disabled'}>Free ${sp.at ? gb(slimKB) : 'space'}</button></div>
      <div class="clean-row"><span><b>Remove ${removable.length} worktrees of archived chats</b><small>Only ones with nothing uncommitted; any with changes are left. The branch stays, so Archived can rebuild it.</small></span><button class="btn" data-clean="wt" ${removable.length ? '' : 'disabled'}>Remove ${removable.length}</button></div>
      <div class="clean-row"><span><b>Archive ${quiet.length} quiet chats</b><small>Chats that haven’t moved in ${quietDays()} days. They go to Archived with their record; nothing is deleted.</small></span><button class="btn" data-clean="quiet" ${quiet.length ? '' : 'disabled'}>Archive ${quiet.length}</button></div>
    </div>
    ${top.length ? `<section class="section"><div class="sec-h"><h2>Biggest worktrees</h2><button class="hint" data-rescan="1">${sp.scanning ? 'Measuring…' : 'Measure again'}</button></div><div class="rows">${top.map(w => { const c = chatBy.get(w.chats[0]); return `<div class="row acts" data-cur="w:${esc(w.path)}" ${c ? `data-open="${esc(c.id)}"` : ''}><span></span><span class="t"><b>${esc(c ? c.title : w.path.split('/').pop())}</b><small class="mono">${esc(w.path.replace(/^\/Users\/[^/]+/, '~'))}${w.branch ? ` · ${esc(w.branch)}` : ''}</small></span><span class="side-tags">${w.heavyKB ? `<span class="tag">${gb(w.heavyKB)} removable</span>` : ''}</span><span class="when">${gb(w.kb || 0)}</span>${w.heavyKB ? `<button class="btn sm" data-free="${esc(w.path)}">Free</button>` : '<span></span>'}</div>`; }).join('')}</div></section>` : sp.scanning ? '<p class="empty-note">Measuring worktrees… this takes a minute the first time.</p>' : ''}
    <p class="hint-line">Nothing here runs on its own.</p></div>`;
}
async function loadSpace(fresh = false) {
  S.space = await api(`/api/lite/space${fresh ? '?fresh=1' : ''}`);
  if (S.space.scanning) setTimeout(() => { if (S.view === 'cleanup') loadSpace().then(render).catch(() => {}); }, 4000);
}
async function cleanAction(kind, b) {
  const sp = S.space || { worktrees: [] };
  if (kind === 'quiet') {
    const ids = allChats().filter(isQuiet).map(c => c.id);
    if (await confirmBox({ title: `Archive ${ids.length} quiet chats?`, body: 'They leave every list and go to Archived, with their record. Nothing is deleted, and Bring back puts each one where it was.', yes: 'Archive' })) await archiveChats(ids);
    return;
  }
  if (kind === 'slim') {
    const paths = slimmable(sp).map(w => w.path);
    if (await confirmBox({ title: `Free space in ${paths.length} worktrees?`, body: 'Removes only git-ignored node_modules, build output and caches inside each worktree. Code, uncommitted changes, branches and chats stay.', yes: 'Free space' })) await freePaths(paths, b);
    return;
  }
  if (kind === 'wt') {
    const list = removableWts(sp);
    if (!await confirmBox({ title: `Remove ${list.length} worktrees?`, body: 'Each is removed only if it has nothing uncommitted. Branches stay, and Archived can rebuild any of them.', yes: 'Remove' })) return;
    b.disabled = true; let ok = 0, kept = 0;
    for (const w of list) { try { await api('/api/lite/worktree/remove', { id: w.chats[0], path: w.path }); ok++; } catch { kept++; } }
    sfx('shove'); toast(`Removed ${ok} worktree${ok === 1 ? '' : 's'}${kept ? `; kept ${kept} with changes` : ''}.`);
    await loadState(); await loadSpace(); render();
  }
}
async function freePaths(paths, b) {
  if (b) { b.disabled = true; b.textContent = 'Freeing…'; }
  const j = await api('/api/lite/free', { paths });
  const kb = j.freed.reduce((n, x) => n + (x.kb || 0), 0);
  sfx('shove'); toast(`Freed ${gb(kb)}.`);
  await loadSpace(); render();
}

/* ---------- Images: everything Codex has drawn, and asking for more ---------- */
function imagesView() {
  const g = S.gallery || { images: [], jobs: [] };
  const byThread = new Map(S.chats.map(c => [String(c.id).toLowerCase(), c]));
  const working = g.jobs.filter(j => j.state === 'working');
  const daysMap = new Map();
  for (const im of g.images.slice(0, S.galleryN || 120)) { const d = new Date(im.at).toDateString(); if (!daysMap.has(d)) daysMap.set(d, []); daysMap.get(d).push(im); }
  const tile = im => { const c = byThread.get(im.thread.toLowerCase()); return `<button class="gi" data-gimg="${esc(im.thread)}/${esc(im.file)}" data-cur="g:${esc(im.thread)}/${esc(im.file)}" title="${esc(c ? c.title : 'Codex')}"><img loading="lazy" decoding="async" alt="" src="/api/lite/gimg?token=${TOKEN}&thumb=1&thread=${encodeURIComponent(im.thread)}&file=${encodeURIComponent(im.file)}"><small>${esc(c ? (projOf(c).loose ? c.title : projOf(c).name) : clock(im.at))}</small></button>`; };
  return `<div class="wrap" style="max-width:1180px"><div class="page-h"><div class="proj-h">${BACK}<h1>Images</h1></div><span class="n" style="color:var(--muted)">${g.images.length} drawn by Codex</span></div>
    <form class="cmd gen-bar" id="genForm" autocomplete="off"><span class="cmd-ic">${IC.spark}</span><input id="genPrompt" placeholder="Describe a picture for Codex to draw…" aria-label="What to draw">
      <span class="seg" role="group" aria-label="How many">${[1, 2, 4].map(n => `<button type="button" data-gen-n="${n}" aria-pressed="${(S.genN || 1) === n}">${n}</button>`).join('')}</span><button class="btn prime" type="submit">Draw</button>
      <div class="cmd-chips"><small style="color:var(--muted)">GPT Image, on the use-next ChatGPT plan. Any chat can ask too: <code>node ~/Repos/GitHub/session-switcher/bin/switcher-image.js "…" --n 2 --out ./art</code></small></div></form>
    ${working.map(j => `<div class="gen-job"><span class="live-dot"></span><span>Drawing ${j.n > 1 ? `${j.n} pictures` : 'a picture'}: “${esc(j.prompt.slice(0, 90))}” on ${esc(j.account)} · ${since(j.startedAt)}</span></div>`).join('')}
    ${g.jobs.filter(j => j.state === 'failed' && S.now - (j.doneAt || 0) < 600e3).map(j => `<div class="gen-job err">Couldn’t draw “${esc(j.prompt.slice(0, 60))}”: ${esc(j.error || 'unknown')}</div>`).join('')}
    ${[...daysMap].map(([d, list]) => `<section class="section"><div class="sec-h"><h2>${esc(new Date(d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }))}</h2><span class="n">${list.length}</span></div><div class="gallery">${list.map(tile).join('')}</div></section>`).join('') || '<p class="empty-note">No pictures yet.</p>'}
    ${g.images.length > (S.galleryN || 120) ? '<div id="gMore" class="g-more" aria-hidden="true"></div>' : ''}</div>`;
}
async function loadGallery() { S.gallery = await api('/api/lite/images'); }
// More pictures load as you scroll near the end.
let gObs = null;
function watchGallery() {
  if (gObs) gObs.disconnect();
  const el = $('gMore'); if (!el || !('IntersectionObserver' in window)) return;
  gObs = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { gObs.disconnect(); S.galleryN = (S.galleryN || 120) + 120; render(); } }, { root: $('main'), rootMargin: '800px' });
  gObs.observe(el);
}
function showImage(key) {
  const list = (S.gallery ? S.gallery.images : []).slice(0, S.galleryN || 120).map(im => `${im.thread}/${im.file}`);
  showImage.list = list; showImage.i = list.indexOf(key);
  const [thread, file] = key.split('/');
  const c = S.chats.find(x => String(x.id).toLowerCase() === thread.toLowerCase());
  const src = `/api/lite/gimg?token=${TOKEN}&thread=${encodeURIComponent(thread)}&file=${encodeURIComponent(file)}`;
  const root = $('modalRoot');
  const at = (S.gallery.images.find(im => im.thread === thread && im.file === file) || {}).at;
  root.innerHTML = `<div class="modal-back lightbox" data-lightbox="1"><button class="lb-nav prev" data-lb="-1" aria-label="Previous (←)" ${showImage.i > 0 ? '' : 'disabled'}>‹</button><figure><img src="${src}" alt=""><figcaption>${c ? `<button class="linkish" data-open="${esc(c.id)}">${esc(c.title)}</button> · ${esc(projOf(c).name)}` : 'Drawn by Codex'}${at ? ` · ${esc(dayName(at))}` : ''} · <a class="linkish" href="${src}" target="_blank" rel="noopener">Full size</a> · <button class="linkish" data-useimg="${esc(src)}">Use in a chat…</button> · ${showImage.i + 1} of ${list.length}</figcaption></figure><button class="lb-nav next" data-lb="1" aria-label="Next (→)" ${showImage.i < list.length - 1 ? '' : 'disabled'}>›</button></div>`;
  root.querySelector('.modal-back').addEventListener('click', e => {
    const nav = e.target.closest('[data-lb]');
    if (nav) { e.stopPropagation(); return stepImage(Number(nav.dataset.lb)); }
    const use = e.target.closest('[data-useimg]');
    if (use) { e.stopPropagation(); return pickChatFor(use, use.dataset.useimg); }
    if (!e.target.closest('figcaption') || e.target.closest('[data-open]')) root.innerHTML = '';
    return undefined;
  });
}
function stepImage(d) {
  const list = showImage.list || []; const i = showImage.i + d;
  if (i < 0 || i >= list.length) return;
  showImage(list[i]);
}
addEventListener('keydown', e => {
  if (!document.querySelector('[data-lightbox]')) return;
  if (e.key === 'ArrowRight' || e.key === 'l') { e.preventDefault(); stepImage(1); }
  if (e.key === 'ArrowLeft' || e.key === 'h') { e.preventDefault(); stepImage(-1); }
}, true);
// A picture from the gallery into a chat: pick the chat (or New chat), it opens with the picture in its message.
function pickChatFor(anchor, src) {
  const list = allChats().sort((a, b) => b.updated - a.updated);
  const rowsFor = q => `<button data-v="__new">New chat<small>start one with it</small></button>${list.filter(c => !q || c.title.toLowerCase().includes(q)).slice(0, 30).map(c => `<button data-v="${esc(c.id)}">${esc(c.title.slice(0, 56))}<small>${esc(projOf(c).name)}</small></button>`).join('')}`;
  pop(anchor, `<div class="ph">Put it in…</div><input class="pop-q" id="ucQ" placeholder="Type to filter" aria-label="Filter chats"><div id="ucList">${rowsFor('')}</div>`, v => wrap(async () => {
    $('modalRoot').innerHTML = '';
    if (v === '__new') go('newchat'); else openChat(v);
    await new Promise(r => setTimeout(r, 900));
    await addImageFromUrl(src);
  })());
  const q = $('ucQ'); if (q) { q.focus(); q.addEventListener('input', () => { $('ucList').innerHTML = rowsFor(q.value.trim().toLowerCase()); }); }
}
async function startGenerate(prompt, n) {
  const j = await api('/api/lite/images/generate', { prompt, n });
  S.gallery = S.gallery || { images: [], jobs: [] };
  S.gallery.jobs.unshift(j.job); sfx('fan'); render();
  const poll = async () => { await loadGallery(); if (S.view === 'images') render(); if (S.gallery.jobs.some(x => x.state === 'working')) setTimeout(poll, 4000); else sfx('card'); };
  setTimeout(poll, 4000);
}

/* ---------- Alerts ---------- */
const ALERTS = [
  ['needs', 'Needs you', 'A chat wants your OK or asks a question.'],
  ['reply', 'Finished a reply', 'A chat is done and waiting for you.'],
  ['floor', 'Plan hit the floor', 'A plan drops to your floor; says which one is next.'],
  ['reset', 'Manual reset about to lapse', 'A ChatGPT reset credit expires within two days.'],
  ['routine', 'Routines', 'A routine escalates, fails or needs you (each routine’s “Tell me” decides).'],
  ['quiet', 'Quiet hours', '10 PM to 7 AM, nothing comes through.'],
];
// Phone alerts are the app's notifications (its /api/push and /sw.js): one sign-up per phone, with
// which kinds it hears about, quiet hours, and app: 'lite' so a tap opens Lite.
const PUSH_ON = { needs: true, reply: true, floor: true, reset: true, routine: true, hack: false };
function alertsView() {
  const pu = S.push || { on: PUSH_ON, quiet: false };
  const can = 'serviceWorker' in navigator && 'PushManager' in window;
  const secure = window.isSecureContext;
  return `<div class="wrap"><div class="page-h"><div class="proj-h">${BACK}<h1>Alerts</h1></div></div>
    <section class="section"><div class="sec-h"><h2>Here</h2></div><div class="toggles">
      <label class="toggle"><span><b>Sounds</b><small>A knock when a chat needs you, a card on the table when one replies, cards sliding as you sort.</small></span><input type="checkbox" data-pref="sound" ${prefs.sound ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label>
      <label class="toggle"><span><b>Desktop notifications</b><small>Only while this window is in the background.</small></span><input type="checkbox" data-pref="notify" ${prefs.notify ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label></div></section>
    <section class="section"><div class="sec-h"><h2>On your phone</h2><span class="n">${pu.phones ? `${pu.phones} phone${pu.phones === 1 ? '' : 's'} signed up` : ''}</span></div>
      <p class="hint-line" style="margin:0">Open <b>/lite</b> on your iPhone through the Tailscale address, add it to the Home Screen (Share → Add to Home Screen), pair it, and turn alerts on from that app. iPhone delivers web push only to Home Screen apps on a secure address.</p>
      <div class="clean-row" style="border:1px solid var(--line);border-radius:var(--r)"><span><b>${pu.subscribed ? 'This device gets alerts' : 'This device doesn’t get alerts yet'}</b><small>${!pu.phone ? 'Alerts are for a paired phone: open Lite there.' : !can ? 'This browser can’t receive web push.' : !secure ? 'Needs the secure (https) address.' : pu.subscribed ? 'Turn off to stop them here.' : 'Asks for permission once.'}</small></span>
        <span style="display:flex;gap:6px">${pu.subscribed ? '<button class="btn" data-push="test">Send a test</button>' : ''}${pu.phone && can && secure ? (pu.subscribed ? '<button class="btn" data-push="off">Turn off</button>' : '<button class="btn prime" data-push="on">Turn on</button>') : ''}</span></div>
      <div class="toggles">${ALERTS.map(([k, t, d]) => `<label class="toggle"><span><b>${esc(t)}</b><small>${esc(d)}</small></span><input type="checkbox" data-pushpref="${k}" ${(k === 'quiet' ? pu.quiet : pu.on[k]) ? 'checked' : ''} ${pu.subscribed ? '' : 'disabled'}><span class="switch" aria-hidden="true"></span></label>`).join('')}</div></section>
  </div>`;
}
async function loadPush() {
  const j = await api('/api/push');
  const p = j.prefs || {};
  S.push = { ...j, levels: p.levels || {}, on: { ...PUSH_ON, ...(p.kinds || {}) }, quiet: !!(p.quiet && p.quiet.on) };
}
const pushPrefs = () => ({ app: 'lite', levels: S.push.levels || {}, kinds: S.push.on, quiet: S.push.quiet ? { on: true, from: '22:00', to: '07:00' } : null, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
const pushSub = async () => { const reg = await navigator.serviceWorker.getRegistration('/'); return reg && reg.pushManager.getSubscription(); };
async function pushOn() {
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications weren’t allowed. Allow them in Settings → Notifications for this app.');
  const k = S.push.key;
  const key = Uint8Array.from(atob(k.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - k.length % 4) % 4)), ch => ch.charCodeAt(0));
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api('/api/push/subscribe', { subscription: sub.toJSON(), prefs: pushPrefs() });
  await loadPush();
  toast('Alerts are on for this phone.');
}
async function pushOff() {
  const sub = await pushSub();
  if (sub) { await api('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
  await loadPush();
}
async function setPushPref(k, v) {
  if (k === 'quiet') S.push.quiet = v; else S.push.on = { ...S.push.on, [k]: v };
  const sub = await pushSub();
  if (sub) await api('/api/push/prefs', { endpoint: sub.endpoint, prefs: pushPrefs() });
}

/* ---------- menus ---------- */
function rowMenu(anchor, id, at) {
  const c = chatBy.get(id); if (!c) return;
  const ids = S.sel.has(id) && S.sel.size > 1 ? [...S.sel] : [id];
  pop(anchor, `<div class="ph">${ids.length > 1 ? `${ids.length} chats` : esc(c.title.slice(0, 60))}</div>
    <button data-v="open">Open<kbd>↵</kbd></button><button data-v="full">Open in the full app</button><hr><div class="ph">Status</div>
    ${STATUSES.map(s => `<button data-v="s:${s.id}" role="menuitemradio" aria-checked="${ids.length === 1 && statusOf(c) === s.id}"><span class="dot" style="background:${s.c}"></span>${s.name}<kbd>${s.key}</kbd></button>`).join('')}
    <div class="ph">Kind</div><div class="kind-seg">${KINDS.map(k => `<button data-v="k:${k.id}" role="menuitemradio" aria-checked="${ids.length === 1 && c.kind === k.id}">${k.name}</button>`).join('')}</div>
    <hr><button data-v="routine">Make this a routine…</button><button data-v="nest">Put under another chat…</button>${parentOn(c) ? '<button data-v="top">Make it top-level</button>' : ''}
    <button data-v="focus" role="menuitemcheckbox" aria-checked="${ids.every(i => (chatBy.get(i) || {}).focus)}">Focus<kbd>f</kbd></button><button data-v="wait">${c.waiting ? 'Waiting on ' + esc(c.waitingOn || 'someone') + '…' : 'Waiting on…'}<kbd>w</kbd></button><button data-v="rename">Rename…</button><button data-v="proj">Move to project…</button><button data-v="arch">Archive<kbd>e</kbd></button>`, v => {
    if (v === 'open') return openChat(id);
    if (v === 'rename') return askRename(id);
    if (v === 'nest') return pickParent(anchor, ids);
    if (v === 'routine') return routineFromChat(c);
    if (v === 'top') return wrap(nestChats)(ids, null);
    if (v === 'full') return openChat(id, { full: true });
    if (v.startsWith('s:')) return wrap(setChats)(ids, { status: v.slice(2) });
    if (v.startsWith('k:')) return wrap(setChats)(ids, { kind: v.slice(2) });
    if (v === 'focus') return wrap(toggleFocus)(ids);
    if (v === 'wait') return askWaiting(ids);
    if (v === 'arch') return wrap(archiveChats)(ids);
    if (v === 'proj') return pickProject(anchor, k => wrap(async () => { await setChats(ids, { project: k }, `Moved to ${(projBy.get(k) || {}).name || 'the project'}`); await loadState(); render(); })());
    return undefined;
  }, at);
}
function projMenu(anchor, k, at) {
  const p = projBy.get(k); if (!p) return;
  pop(anchor, `<div class="ph">${esc(p.name)}</div><button data-v="open">Open</button>${p.cwd ? '<button data-v="new">New chat here<kbd>c</kbd></button><button data-v="img">Change picture…</button>' : ''}<hr><div class="ph">Bucket</div>${buckets().map(b => `<button data-v="b:${esc(b.id)}" role="menuitemradio" aria-checked="${b.id === p.bucket}">${esc(b.name)}</button>`).join('')}<button data-v="b:" role="menuitemradio" aria-checked="${!p.bucket}">Unsorted</button><hr><button data-v="rename">Rename…</button><button data-v="merge">Merge into another project…</button>${p.cwd && !REMOTE ? '<button data-v="finder">Show in Finder</button>' : ''}<button data-v="arch">${p.archived ? 'Bring back' : 'Archive project'}</button>`,
    v => {
      if (v === 'open') return go('project', { project: k });
      if (v === 'new') return go('newchat', { ncProject: k });
      if (v.startsWith('b:')) return wrap(setBucket)(k, v.slice(2) || null);
      if (v === 'arch') return wrap(archiveProject)(k, !p.archived);
      if (v === 'finder') return wrap(() => api('/api/reveal', { path: p.cwd }))();
      if (v === 'img') return wrap(pictureMenu)(anchor, p, at);
      if (v === 'rename') return renameProject(p);
      if (v === 'merge') return pickProject(anchor, t => wrap(async () => {
        if (t === k) return;
        await api('/api/lite/project', { key: k, patch: { into: t } });
        sfx('slide'); await loadState(); if (S.view === 'project' && S.project === k) go('project', { project: t }); else render();
        toast(`Merged ${p.name} into ${(projBy.get(t) || {}).name || 'the project'}`, async () => { await api('/api/lite/project', { key: k, patch: { into: null } }); await loadState(); render(); });
      })());
      return undefined;
    }, at);
}
function renameProject(p) {
  const root = $('modalRoot');
  root.innerHTML = `<div class="modal-back"><form class="modal" id="rnForm"><h3>Rename ${esc(p.name)}</h3><input name="n" class="field" value="${esc(p.name)}" aria-label="Name"><div class="acts"><button class="btn" type="button" data-m="no">Cancel</button><button class="btn prime" type="submit">Rename</button></div></form></div>`;
  const f = root.querySelector('#rnForm');
  root.querySelector('[data-m="no"]').onclick = () => { root.innerHTML = ''; };
  f.onsubmit = wrap(async e => { e.preventDefault(); const n = f.n.value.trim(); root.innerHTML = ''; await api('/api/lite/project', { key: p.key, patch: { name: n } }); await loadState(); render(); });
  f.n.focus(); f.n.select();
}
async function setBucket(k, b) {
  const p = projBy.get(k); const prev = p.bucket;
  if (prev === b) return;
  await api('/api/lite/project', { key: k, patch: { bucket: b } });
  p.bucket = b; sfx('slide'); render();
  toast(`Moved ${p.name} to ${bucketName(b)}`, async () => { await api('/api/lite/project', { key: k, patch: { bucket: prev } }); p.bucket = prev; sfx('undo'); render(); });
}
// Pictures found in the folder, a plain tile, or one drawn by Codex for it.
async function pictureMenu(anchor, p, at) {
  const info = await api(`/api/project/info?cwd=${encodeURIComponent(p.cwd)}`);
  const imgs = (info.images || []).slice(0, 12);
  const src = f => `/api/image?token=${TOKEN}&cwd=${encodeURIComponent(p.cwd)}&path=${encodeURIComponent(f)}`;
  pop(anchor, `<div class="ph">Picture for ${esc(p.name)}</div><div class="pick-art">${imgs.map((im, i) => `<button data-v="i:${i}" role="menuitemradio" aria-checked="${p.image === im.path}" style="background-image:url('${src(im.path)}')" aria-label="${esc(im.name || im.path)}"></button>`).join('')}<button data-v="none" role="menuitemradio" aria-checked="${!p.image}" style="background:linear-gradient(135deg, hsl(${hue(p.name)} 20% 42%), hsl(${(hue(p.name) + 40) % 360} 24% 28%))">Tile</button></div>${imgs.length ? '' : '<p class="ph">No pictures in this folder yet.</p>'}<hr><button data-v="gen">Draw one with Codex…<small>GPT Image</small></button>`,
    v => {
      if (v === 'gen') return genCover(anchor, p, at);
      const image = v === 'none' ? null : imgs[Number(v.slice(2))].path;
      return wrap(async () => { await api('/api/lite/project', { key: p.key, patch: { image } }); p.image = image; render(); toast(`New picture for ${p.name}`); })();
    }, at);
}
function genCover(anchor, p, at) {
  pop(anchor, `<div class="ph">Codex draws a cover for ${esc(p.name)}</div><div class="gen"><textarea id="coverPrompt" aria-label="What to draw">Key art for ${esc(p.name)}: wide 16:9, bold shapes, readable as a small thumbnail, no text.</textarea><button class="btn prime" data-v="go">Draw</button><small style="color:var(--muted)">On the use-next ChatGPT plan; saved in the project’s art/ folder and set as its picture.</small></div>`, v => {
    if (v !== 'go') return undefined;
    const prompt = ($('coverPrompt') || {}).value || `Key art for ${p.name}`;
    return wrap(async () => {
      S.gen = S.gen || {}; S.gen[p.key] = true; render(); sfx('fan');
      const { job } = await api('/api/lite/images/generate', { prompt, n: 1, cwd: p.cwd, out: `${p.cwd}/art` });
      toast(`Codex is drawing a cover for ${p.name}…`);
      const poll = async () => {
        const j = (await api(`/api/lite/images/job?id=${encodeURIComponent(job.id)}`)).job;
        if (j.state === 'working') { setTimeout(poll, 4000); return; }
        delete S.gen[p.key];
        if (j.state === 'done' && j.saved && j.saved[0]) { await api('/api/lite/project', { key: p.key, patch: { image: j.saved[0] } }); p.image = j.saved[0]; sfx('card'); toast(`New cover for ${p.name}`); }
        else toast(j.error || 'Codex didn’t draw it.');
        render();
      };
      setTimeout(poll, 4000);
    })();
  }, at);
  setTimeout(() => $('coverPrompt')?.focus(), 0);
}
function renderSel() {
  const r = $('selRoot');
  if (S.sel.size < 2) { r.innerHTML = ''; return; }
  r.innerHTML = `<div class="selbar" role="toolbar" aria-label="Selected chats"><span class="n">${S.sel.size} selected</span>
    <button data-selstage="1" aria-haspopup="menu">Stage ▾</button><button data-selwait="1">Waiting…</button><button data-selarch="1">Archive</button><button data-selclear="1">Clear</button></div>`;
}
