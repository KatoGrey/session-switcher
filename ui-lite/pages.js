'use strict';
/* Projects (cards by bucket; quiet projects fold into chips), a project's page (chats by stage),
   lists (Recents, search), and the menus for a chat or a project. */

// Grouped views (a project's stage sections) leave the stage pill out: the heading says it.
// Mixed lists (Recents, search) show it.
function rowHtml(c, { showProject = false, showStage = false } = {}) {
  const p = projOf(c);
  const waitingNow = stageOf(c) === 'waiting' && c.waitingOn;
  const sub = showProject ? `${esc(p.name)}${p.bucket ? ` · ${esc(bucketName(p.bucket))}` : ''}` : (stageOf(c) === 'waiting' && c.note ? esc(c.note) : '');
  const st = stageById(stageOf(c));
  return `<div class="row ${c.parent && !showProject ? 'sub' : ''} ${isQuiet(c) ? 'is-quiet' : ''}" role="button" tabindex="0" draggable="true" data-chat="${esc(c.id)}" aria-selected="${S.sel.has(c.id)}">
    ${needs(c) ? '<span class="dot needs-dot" title="Needs you"></span>' : running(c) ? '<span class="live-dot" title="Running"></span>' : '<span></span>'}
    <span class="t"><b>${esc(c.title)}</b>${sub ? `<small>${sub}</small>` : ''}</span>
    <span class="side-tags">${waitingNow ? `<span class="tag wait-tag">${esc(c.waitingOn)}</span>` : ''}${c.provider === 'codex' ? '<span class="tag">Codex</span>' : ''}${showStage ? `<button class="stage" data-rowmenu="${esc(c.id)}" aria-haspopup="menu"><span class="dot" style="background:${st.c}"></span>${st.name}</button>` : ''}</span>
    <span class="when">${ago(c.updated)}</span>
    <button class="iconbtn rmenu" data-rowmenu="${esc(c.id)}" aria-haspopup="menu" aria-label="Move or change">${IC.dots}</button>
  </div>`;
}
const selHint = () => '<p class="hint-line">Right-click a chat (or its ⋯) to set its stage, say who it’s waiting on, or move it.</p>';

function stageBar(cs) {
  const lv = live(cs); if (!lv.length) return '<div class="stagebar"></div>';
  return `<div class="stagebar">${STAGES.filter(s => s.id !== 'done').map(s => { const n = lv.filter(c => stageOf(c) === s.id).length; return n ? `<i style="width:${100 * n / lv.length}%;background:${s.c}" title="${s.name}: ${n}"></i>` : ''; }).join('')}</div>`;
}
function cardHtml(p) {
  const cs = chatsOfProject(p.key), lv = live(cs);
  const w = lv.filter(c => stageOf(c) === 'waiting').length;
  const nd = cs.some(needs);
  return `<button class="card ${nd ? 'needs' : ''}" data-project="${esc(p.key)}">
    <span class="art" style="${artStyle(p)}">${artInner(p)}</span>
    <span class="body"><span class="name">${esc(p.name)}</span>${stageBar(cs)}
      <span class="meta">${nd ? '<span class="dot needs-dot"></span>' : ''}<span>${lv.length} active${w ? ` · ${w} waiting` : ''}</span></span></span></button>`;
}
const projectsIn = b => S.projects.filter(p => !p.archived && (b === null ? !p.bucket : p.bucket === b));
// A project with nothing active is quiet; one with no chats you'd see at all stays out of the way.
const hasChats = p => chatsOfProject(p.key).length > 0;
function home() {
  const groups = [...buckets().map(b => ({ id: b.id, name: b.name })), { id: null, name: 'Unsorted' }];
  const sections = groups.map(b => {
    const ps = projectsIn(b.id).filter(p => b.id !== null || hasChats(p)).sort((x, y) => y.updated - x.updated);
    if (b.id === null && !ps.length) return '';
    const act = ps.filter(p => live(chatsOfProject(p.key)).length);
    const quiet = ps.filter(p => !live(chatsOfProject(p.key)).length);
    return `<section class="section" data-drop-bucket="${esc(b.id || '')}">
      <div class="sec-h"><h2>${esc(b.name)}</h2><span class="n">${ps.length || ''}</span>${b.id === null ? '<span class="hint">Right-click a project to give it a bucket</span>' : ''}</div>
      ${act.length ? `<div class="cards">${act.map(cardHtml).join('')}</div>` : ''}
      ${!ps.length ? '<div class="dropzone">Move projects here from their menu</div>' : ''}
      ${quiet.length ? `<div class="quiet-line"><span class="why" title="No chat here has moved in ${quietDays()} days, or every chat is Done. A new chat or message brings it back up.">Quiet:</span>${quiet.map(p => `<button data-project="${esc(p.key)}"><span class="thumb-xs" style="${artStyle(p)}"></span>${esc(p.name)}</button>`).join('')}</div>` : ''}
    </section>`;
  }).join('');
  const setup = !buckets().length ? '<p class="lead">No buckets yet. Buckets say what a project is for (a product, games, personal apps). They live in lite.json in your data folder.</p>' : '';
  return `<div class="wrap"><div class="page-h"><div class="proj-h"><button class="iconbtn back" data-go="side" aria-label="Back">‹</button><h1>${L('Projects')}</h1></div></div>${setup}${sections}
    <p class="hint-line">Right-click a project, card or quiet chip, to move it to another bucket.</p></div>`;
}

function listView(kind) {
  const all = allChats();
  let list, title;
  if (kind === 'search') {
    const q = S.q.toLowerCase();
    list = all.filter(c => c.title.toLowerCase().includes(q) || projOf(c).name.toLowerCase().includes(q) || (c.firstPrompt || '').toLowerCase().includes(q)).sort((a, b) => b.updated - a.updated).slice(0, 80);
    title = `Search: ${S.q}`;
  } else { list = all.filter(inBucket).sort((a, b) => b.updated - a.updated).slice(0, 60); title = L('Recents'); }
  return `<div class="wrap"><div class="page-h"><div class="proj-h"><button class="iconbtn back" data-go="side" aria-label="Back">‹</button><h1>${esc(title)}</h1></div></div>
    <div class="rows">${list.map(c => rowHtml(c, { showProject: true, showStage: true })).join('') || '<p class="empty-note">Nothing here.</p>'}</div>${selHint()}</div>`;
}

function project() {
  const p = projBy.get(S.project);
  if (!p) return `<div class="wrap"><p class="empty-note">That project isn’t in the list any more.</p></div>`;
  const cs = chatsOfProject(p.key).sort((x, y) => y.updated - x.updated);
  const sections = STAGES.map(s => {
    const all = cs.filter(c => stageOf(c) === s.id);
    if (!all.length) return '';
    const folded = s.id === 'done' ? !S.more['p-done'] : false;
    const act = s.id === 'done' ? all : all.filter(c => !isQuiet(c)), quiet = s.id === 'done' ? [] : all.filter(isQuiet);
    const showQ = S.more['pq-' + s.id];
    const shown = showQ ? [...act, ...quiet] : act;
    return `<section class="section" data-drop-stage="${s.id}">
      <div class="sec-h">${s.id === 'done' ? `<button class="fold" data-pfold="1"><h2>${s.name}</h2><span class="n">${all.length}</span><span class="n">${folded ? 'Show' : 'Hide'}</span></button>` : `<h2><span class="dot" style="background:${s.c}"></span>${s.name}</h2><span class="n">${act.length}</span>`}
        ${quiet.length ? `<button class="hint" data-pq="${s.id}">${showQ ? 'Hide quiet' : `${quiet.length} quiet`}</button>` : ''}</div>
      ${folded || !shown.length ? '' : `<div class="rows">${shown.map(c => rowHtml(c)).join('')}</div>`}
    </section>`;
  }).join('');
  const autoN = S.chats.filter(c => c.project === p.key && c.auto).length;
  return `<div class="wrap">
    <div class="page-h">
      <div class="proj-h"><button class="iconbtn back" data-go="side" aria-label="Back">‹</button><span class="art-s" style="${artStyle(p)}">${artInner(p)}</span>
        <div style="min-width:0"><div class="crumb"><button data-go="home">${esc(bucketName(p.bucket))}</button><span>·</span><span class="mono">${esc((p.cwd || 'No folder').replace(/^\/Users\/[^/]+/, '~'))}${p.mono ? ` (${esc(p.name)} chats)` : ''}</span></div><h1>${esc(p.name)}</h1></div></div>
      <div style="display:flex;gap:6px"><button class="btn prime" data-newchat="${esc(p.key)}">${L('New chat')}</button><button class="iconbtn" data-projmenu="${esc(p.key)}" aria-haspopup="menu" aria-label="Project options">${IC.dots}</button></div>
    </div>
    ${sections || '<p class="empty-note">No chats here yet.</p>'}
    ${autoN ? `<p class="hint-line">${autoN} automated Codex run${autoN === 1 ? '' : 's'} (started by scripts or other agents) are left out here.</p>` : ''}
    ${selHint()}
  </div>`;
}

/* ---------- menus ---------- */
function rowMenu(anchor, id, at) {
  const c = chatBy.get(id); if (!c) return;
  const ids = S.sel.has(id) && S.sel.size > 1 ? [...S.sel] : [id];
  pop(anchor, `<div class="ph">${ids.length > 1 ? `${ids.length} chats` : esc(c.title.slice(0, 60))}</div>
    <button data-v="open">Open<small>↵</small></button><hr><div class="ph">Stage</div>
    ${STAGES.map(s => `<button data-v="s:${s.id}" role="menuitemradio" aria-checked="${ids.length === 1 && stageOf(c) === s.id}"><span class="dot" style="background:${s.c}"></span>${s.name}<kbd>${s.key}</kbd></button>`).join('')}
    <hr><button data-v="wait">Waiting on…</button>`, v => {
    if (v === 'open') return openChat(id);
    if (v.startsWith('s:')) return wrap(setChats)(ids, { stage: v.slice(2) });
    if (v === 'wait') {
      const who = prompt('Who is it waiting on? (CQA, a dev, …)', c.waitingOn || '');
      if (who === null) return undefined;
      return wrap(setChats)(ids, { stage: 'waiting', waitingOn: who.trim() }, `Waiting on ${who.trim() || 'someone'}. A reminder comes after two days.`);
    }
    return undefined;
  }, at);
}
function projMenu(anchor, k, at) {
  const p = projBy.get(k); if (!p) return;
  pop(anchor, `<div class="ph">${esc(p.name)}</div><button data-v="open">Open</button><hr><div class="ph">Bucket</div>${buckets().map(b => `<button data-v="b:${esc(b.id)}" role="menuitemradio" aria-checked="${b.id === p.bucket}">${esc(b.name)}</button>`).join('')}<button data-v="b:" role="menuitemradio" aria-checked="${!p.bucket}">Unsorted</button>`,
    v => {
      if (v === 'open') return go('project', { project: k });
      if (v.startsWith('b:')) return wrap(setBucket)(k, v.slice(2) || null);
      return undefined;
    }, at);
}
async function setBucket(k, b) {
  const p = projBy.get(k); const prev = p.bucket;
  await api('/api/lite/project', { key: k, patch: { bucket: b } });
  p.bucket = b; render();
  toast(`Moved ${p.name} to ${bucketName(b)}`, async () => { await api('/api/lite/project', { key: k, patch: { bucket: prev } }); p.bucket = prev; render(); });
}
