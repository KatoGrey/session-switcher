'use strict';
/* The sidebar (pages, bucket switcher, status labels with quiet folding), routing (with real browser
   history, so back and forward work), redraws, and every click and drag on the page. */

const VIEWS = ['triage', 'now', 'home', 'hack', 'bugs', 'automation', 'routines', 'routine', 'recent', 'project', 'search', 'side', 'chat', 'newchat', 'archived', 'cleanup', 'images', 'alerts'];
const small = () => matchMedia('(max-width: 760px)').matches;

// A chat's pull request, as one small icon: draft, open, checks failing, changes asked for,
// approved or merged (from the pipeline for your PRs; from the waiting check for others').
const PR_ICON = '<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="3.5" r="1.7"/><circle cx="4" cy="12.5" r="1.7"/><circle cx="12" cy="12.5" r="1.7"/><path d="M4 5.2v5.6M12 10.8V7a2.8 2.8 0 0 0-2.8-2.8H7.2M8.8 2.4 7 4.2l1.8 1.8"/></g></svg>';
const MERGED_ICON = '<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="4" cy="3.5" r="1.7"/><circle cx="4" cy="12.5" r="1.7"/><circle cx="12" cy="8" r="1.7"/><path d="M4 5.2v5.6M4 5.2c0 2.2 2.2 2.8 6.3 2.8"/></g></svg>';
function prMark(c) {
  const it = S.pipeline && S.pipeline.byChat && S.pipeline.byChat.get(c.id);
  let st = null, n = null;
  if (it && it.pr) {
    const pr = it.pr; n = pr.number;
    st = it.stage === 'merged' ? 'merged' : pr.draft ? 'draft' : pr.ci && pr.ci.state === 'failing' ? 'failing' : pr.review === 'CHANGES_REQUESTED' ? 'changes' : pr.review === 'APPROVED' ? 'approved' : 'open';
  } else if (c.waitPrs && c.waitPrs[0]) {
    const w = c.waitPrs[0]; n = w.n;
    st = { Merged: 'merged', Closed: null, 'Still a draft': 'draft', Approved: 'approved', 'Changes requested': 'changes' }[w.standing];
    if (st === undefined) st = 'open';
  }
  if (!st) return '';
  const say = { merged: 'merged', draft: 'a draft', failing: 'open, checks failing', changes: 'open, changes requested', approved: 'approved', open: 'open, waiting for review' }[st];
  return `<span class="pr-g pr-${st}" title="PR #${n}: ${say}">${st === 'merged' ? MERGED_ICON : PR_ICON}</span>`;
}
function sideChat(c, depth = 0) {
  // Its sub-chats: a count at the side that opens them in place (with a mark if one needs you).
  const desc = descOf(c.id), fo = famOpen(c.id);
  const fam = desc.length ? `<span class="fam-n" role="button" tabindex="0" data-fam="${esc(c.id)}" aria-expanded="${fo}" title="${fo ? 'Hide' : 'Show'} ${desc.length} sub-chat${desc.length === 1 ? '' : 's'}">${!fo && desc.some(needs) ? '<span class="dot needs-dot"></span>' : !fo && desc.some(running) ? '<span class="live-dot"></span>' : ''}${desc.length}<span class="fam-caret">›</span></span>` : '';
  const marks = (isBug(c) ? '' : kindTag(c)) + waitTag(c) + prMark(c) + (needs(c) ? '<span class="dot needs-dot" title="Needs you"></span>' : running(c) ? '<span class="live-dot" title="Running"></span>' : '') + fam;
  return `<button class="nav-i chat-i${depth ? ' kid' : ''}" ${depth ? `style="--d:${depth}"` : ''} draggable="true" data-chat="${esc(c.id)}" aria-current="${S.view === 'chat' && String(CV.id).toLowerCase() === String(c.id).toLowerCase()}" title="${esc(c.title)} · ${esc(projOf(c).name)}">${focusStar(c)}<span class="lbl">${esc(isBug(c) ? c.title.replace(/\s*\(from [^)]+\)\s*$/, '') : c.title)}</span>${marks}</button>`;
}
// Under a top-level chat in the sidebar: one line for its sub-chats, opened in place.
function sideFam(t, depth = 1) {
  const kids = kidsOf(t.id); if (!kids.length || !famOpen(t.id)) return '';
  return kids.map(k => sideChat(k, depth) + sideFam(k, depth + 1)).join('');
}
function renderSide() {
  famMemo = null;
  renderChip();
  $('brand').textContent = L('Switcher');
  $('q').placeholder = L('Search chats');
  const b = buckets().find(x => x.id === S.bucket);
  const chats = allChats().filter(inBucket).sort((x, y) => y.updated - x.updated);
  const nNeed = S.live.filter(needsLive).length;
  const nav = (view, icon, label, extra = '') => `<button class="nav-i" data-go="${view}" aria-current="${S.view === view}"><span class="ic">${icon}</span><span class="lbl">${label}</span>${extra}</button>`;
  const top = `<div class="group">
      ${nav('newchat', IC.pen, L('New chat'), '<kbd class="nav-k">c</kbd>')}
      ${nav('now', IC.pulse, L('Now'), nNeed ? `<span class="badge">${nNeed}</span>` : '')}
      ${nav('home', IC.grid, L('Projects'))}
      ${nav('hack', IC.flag, 'Hackathon', `<span class="n">${esc(hackLabel())}</span>`)}
      ${nav('routines', IC.clock, 'Routines', (n => (n ? `<span class="badge">${n}</span>` : ''))(rtEventsOpen().filter(e => e.kind !== 'ran').length))}
      ${nav('bugs', IC.bug, 'Bugs', (n => (n ? `<span class="n">${n}</span>` : ''))(bugList().filter(c => statusOf(c) !== 'done').length))}
      ${nav('automation', IC.clock, 'Automation', (n => (n ? `<span class="n">${n}</span>` : ''))(automationList().filter(c => Date.now() - c.updated < 864e5).length))}
    </div>
    <button class="bucket-pick" data-pickbucket="1" aria-haspopup="menu"><span class="lbl">${esc(S.bucket === 'all' ? 'All buckets' : S.bucket === 'unsorted' ? 'Unsorted' : b ? b.name : 'All buckets')}</span><span style="color:var(--muted)">▾</span></button>`;
  const focusSt = { id: 'focus', name: 'Focus', c: 'var(--st-priority)' };
  const waitSt = { id: 'waiting', name: 'Waiting on others', c: 'var(--muted)' };
  const folders = [focusSt, ...STATUSES.filter(x => x.id !== 'done'), waitSt, ...STATUSES.filter(x => x.id === 'done')].map(st => {
    const all = chats.filter(c => (st.id === 'focus' ? c.focus && statusOf(c) !== 'done' : st.id === 'waiting' ? isTop(c) && c.waiting && !c.focus && statusOf(c) !== 'done' : isTop(c) && statusOf(c) === st.id && !(c.focus && st.id !== 'done') && !(c.waiting && st.id !== 'done')));
    const act = all.filter(c => !famQuiet(c)), quiet = all.filter(famQuiet);
    const open = all.length && !S.folded[st.id];
    const showQuiet = S.more[st.id];
    const shown = act.slice(0, S.more['all-' + st.id] ? 400 : 12);
    return `<div class="group folder ${act.length ? '' : 'empty'}" data-folded="${!open}">
      <button class="nav-i folder-btn" data-fold="${st.id}" ${st.id === 'focus' ? 'data-drop-focus="1"' : `data-drop-stage="${st.id}"`} aria-expanded="${!!open}"><span class="ic"><span class="label-dot" style="background:${st.c}"></span></span><span class="lbl">${st.name}</span><span class="n">${act.length || ''}</span></button>
      <div class="folder-items">${shown.map(c => sideChat(c) + (st.id === 'focus' ? '' : sideFam(c))).join('')}${act.length > shown.length ? `<button class="nav-i chat-i quiet-toggle" data-more-all="${st.id}"><span class="lbl">${act.length - shown.length} more</span></button>` : ''}${quiet.length ? (showQuiet ? `<div class="quiet-chats">${quiet.slice(0, 60).map(sideChat).join('')}</div>` : '') + `<button class="nav-i chat-i quiet-toggle" data-more-st="${st.id}"><span class="lbl">${showQuiet ? 'Hide quiet' : `${quiet.length} quiet`}</span></button>` : ''}</div>
    </div>`;
  }).join('');
  const nArch = S.chats.filter(c => c.archived).length + S.projects.filter(p => p.archived).length;
  const mode = S.sideMode || 'projects';
  const modeSeg = `<span class="side-seg" role="group" aria-label="Sidebar shows"><button data-sidemode="projects" aria-pressed="${mode === 'projects'}">Projects</button><button data-sidemode="stages" aria-pressed="${mode === 'stages'}">Status</button></span>`;
  swapHtml($('sideScroll'), top + `<div class="group"><div class="side-h side-h-row">${modeSeg}</div>${mode === 'stages' ? folders : sideProjects(chats)}</div>`
    + `<div class="group">${nav('recent', IC.history, L('Recents'))}${nav('images', IC.image, 'Images')}${nav('archived', IC.box, 'Archived', nArch ? `<span class="n">${nArch}</span>` : '')}${nav('cleanup', IC.broom, 'Clean up')}</div>`);
}

// Open bugs, together above the projects (their own group, whatever project they're in), under
// their stage: Exploring, Working, Finish line.
const WAIT_LABEL = { id: 'waiting', name: 'Waiting on others', c: 'var(--muted)' };
function sideBugs(chats, key = 'all') {
  if (typeof loadPipeline === 'function') loadPipeline();
  const open = chats.filter(c => isBug(c) && isTop(c) && bugStage(c) !== 'done');
  if (!open.length) return '';
  const fk = 'p:__bugs:' + key, folded = !!S.folded[fk];
  // Up to five per stage, so every stage shows; "N more" opens them all.
  const per = S.more['all-bugs-' + key] ? 400 : 5;
  let n = 0, inner = '';
  for (const st of [...BUG_STAGES.filter(x => x.id !== 'done'), WAIT_LABEL]) {
    const list = open.filter(c => (st === WAIT_LABEL ? c.waiting : !c.waiting && bugStage(c) === st.id)); if (!list.length) continue;
    const take = list.slice(0, per); n += take.length;
    inner += `<div class="side-stage"><span class="label-dot" style="background:${st.c}"></span>${st.name}</div>${take.map(c => sideChat(c)).join('')}`;
  }
  if (open.length > n) inner += `<button class="nav-i chat-i quiet-toggle" data-more-all="bugs-${esc(key)}"><span class="lbl">${open.length - n} more</span></button>`;
  const nd = open.some(needs), rn = open.some(running);
  return `<div class="group folder" data-folded="${folded}"><div class="proj-row"><button class="nav-i folder-btn proj-btn" data-go="bugs"><span class="ic">${IC.bug}</span><span class="lbl">Bugs</span>${nd ? '<span class="dot needs-dot"></span>' : rn ? '<span class="live-dot"></span>' : ''}<span class="n">${open.length}</span></button><button class="proj-chev" data-foldproj="__bugs:${esc(key)}" aria-expanded="${!folded}" aria-label="${folded ? 'Show' : 'Hide'} bugs" title="${folded ? 'Show' : 'Hide'} bugs"></button></div><div class="folder-items">${inner}</div></div>`;
}

// The sidebar by project (the default): each project with its chats, Focus first. In buckets where
// status matters (Latitude…), chats sit under small status labels; elsewhere it's a plain recent
// list. Quiet projects fold to one line at the end.
S.sideMode = local.get('sideMode', 'projects');
const bucketStages = id => { const b = buckets().find(x => x.id === id); return !b || b.stages !== false; };
function sideProjects(all) {
  if (typeof loadPipeline === 'function') loadPipeline();
  const chats = all.filter(c => !isBug(c));
  const bugsIn = bid => all.filter(c => isBug(c) && (projOf(c).bucket || null) === bid);
  const byProj = new Map();
  for (const c of chats) { const k = c.project; if (!byProj.has(k)) byProj.set(k, []); byProj.get(k).push(c); }
  const groups = [...byProj].map(([k, cs]) => ({ p: projBy.get(k) || { key: k, name: 'Unknown' }, cs })).filter(g => !g.p.archived);
  const activeOf = g => g.cs.filter(c => isTop(c) && statusOf(c) !== 'done' && !famQuiet(c));
  const hot = g => g.cs.some(c => needs(c) || running(c)) ? 1 : 0;
  const ord = g => (typeof g.p.order === 'number' ? g.p.order : 1e9);
  const act = groups.filter(g => activeOf(g).length).sort((a, b) => ord(a) - ord(b) || hot(b) - hot(a) || Math.max(...b.cs.map(c => c.updated)) - Math.max(...a.cs.map(c => c.updated)));
  const quiet = groups.filter(g => !activeOf(g).length);
  const projRow = g => {
    const lv = activeOf(g), q = g.cs.filter(c => isTop(c) && famQuiet(c) && statusOf(c) !== 'done');
    // Projects in buckets without stages (Games, Apps…) start folded to one line; Latitude's open.
    const stageless = !bucketStages(g.p.bucket);
    const open = stageless ? S.folded['p:' + g.p.key] === false : !S.folded['p:' + g.p.key];
    const nd = g.cs.some(needs), rn = g.cs.some(running);
    let inner = '';
    if (open) {
      const limit = S.more['pall:' + g.p.key] ? 200 : 8;
      const foc = lv.filter(c => c.focus), rest = lv.filter(c => !c.focus && !c.waiting), waits = lv.filter(c => !c.focus && c.waiting);
      let n = foc.length;
      inner = foc.map(c => sideChatDot(c) + sideFam(c)).join('');
      if (bucketStages(g.p.bucket)) {
        for (const st of STATUSES.filter(x => x.id !== 'done')) {
          const list = rest.filter(c => statusOf(c) === st.id); if (!list.length || n >= limit) continue;
          const take = list.slice(0, limit - n); n += take.length;
          inner += `<div class="side-stage" data-drop-stage="${st.id}"><span class="label-dot" style="background:${st.c}"></span>${st.name}</div>${take.map(c => sideChat(c) + sideFam(c)).join('')}`;
        }
      } else { const take = rest.slice(0, Math.max(0, limit - n)); n += take.length; inner += take.map(c => sideChatDot(c) + sideFam(c)).join(''); }
      // Waiting on someone else: out of the way at the end, whatever its status.
      if (waits.length) inner += `<div class="side-stage"><span class="label-dot" style="background:${WAIT_LABEL.c}"></span>${WAIT_LABEL.name}</div>${waits.map(c => sideChatDot(c) + sideFam(c)).join('')}`;
      // "N more" and "N quiet" open in place and close again.
      if (lv.length > 8) inner += `<button class="nav-i chat-i quiet-toggle" data-more-proj="${esc(g.p.key)}" aria-expanded="${lv.length <= limit}"><span class="lbl">${lv.length > limit ? `${lv.length - limit} more` : 'Show fewer'}</span></button>`;
      if (q.length) {
        const qo = !!S.more['pq:' + g.p.key];
        if (qo) inner += `<div class="quiet-chats">${q.map(c => sideChatDot(c) + sideFam(c)).join('')}</div>`;
        inner += `<button class="nav-i chat-i quiet-toggle" data-side-quiet="${esc(g.p.key)}" aria-expanded="${qo}"><span class="lbl">${qo ? 'Hide quiet' : `${q.length} quiet`}</span></button>`;
      }
    }
    // The name opens the project; the chevron beside it folds its chats away.
    const here = S.view === 'project' && S.project === g.p.key;
    // Games, Apps, Personal: one line per project saying where it's at. The line opens its latest
    // chat; a project with a few open chats has a count that shows them.
    if (stageless) {
      const lead = [...lv].sort((x, y) => y.updated - x.updated)[0];
      const st = statusById(statusOf(lead));
      const cur = S.view === 'chat' && g.cs.some(c => low(c.id) === low(CV.id));
      const many = lv.length > 1;
      return `<div class="group folder flat-proj" data-folded="${!(open && many)}"><div class="proj-row"><button class="nav-i chat-i flat-btn" data-chat="${esc(lead.id)}" aria-current="${cur}" title="${esc(g.p.name)}: ${esc(lead.title)}"><span class="st-dot" style="background:${st.c}"></span><span class="lbl">${esc(g.p.name)}</span><span class="flat-st">${st.name}</span>${nd ? '<span class="dot needs-dot"></span>' : rn ? '<span class="live-dot"></span>' : ''}</button>${many ? `<button class="proj-chev flat-n" data-foldproj="${esc(g.p.key)}" data-stageless="1" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} its ${lv.length} chats" title="${lv.length} open chats">${lv.length}</button>` : ''}</div>${many ? `<div class="folder-items">${inner}</div>` : ''}</div>`;
    }
    return `<div class="group folder" data-folded="${!open}"><div class="proj-row"><button class="nav-i folder-btn proj-btn" data-project="${esc(g.p.key)}" draggable="true" aria-current="${here}"><span class="thumb-xs" style="${artStyle(g.p)}"></span><span class="lbl">${esc(g.p.name)}</span>${nd ? '<span class="dot needs-dot"></span>' : rn ? '<span class="live-dot"></span>' : ''}<span class="n">${lv.length || ''}</span></button><button class="proj-chev" data-foldproj="${esc(g.p.key)}" ${stageless ? 'data-stageless="1"' : ''} aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} ${esc(g.p.name)} chats" title="${open ? 'Hide' : 'Show'} chats"></button></div><div class="folder-items">${inner}</div></div>`;
  };
  // With every bucket showing, projects sit under their bucket's name.
  let html = '';
  if (S.bucket === 'all') {
    for (const b of [...buckets(), { id: null, name: 'Unsorted' }]) {
      const gs = act.filter(g => (g.p.bucket || null) === b.id);
      const bugs = sideBugs(bugsIn(b.id), b.id || 'unsorted');
      if (gs.length || bugs) html += `<div class="side-bucket">${esc(b.name)}</div>${bugs}${gs.map(projRow).join('')}`;
    }
  } else html = sideBugs(all.filter(isBug), S.bucket) + act.map(projRow).join('');
  if (quiet.length) html += S.more.quietProj ? `<div class="side-bucket">Quiet</div>${quiet.map(g => `<button class="nav-i chat-i" data-project="${esc(g.p.key)}"><span class="lbl">${esc(g.p.name)}</span></button>`).join('')}<button class="nav-i chat-i quiet-toggle" data-quietproj="1"><span class="lbl">Hide quiet</span></button>` : `<button class="nav-i quiet-toggle" data-quietproj="1"><span class="lbl">${quiet.length} quiet project${quiet.length === 1 ? '' : 's'}</span></button>`;
  return html || '<p class="side-empty">No chats here yet.</p>';
}
// In a project without status labels (and for Focus chats), each chat carries its status as a small dot.
function sideChatDot(c) {
  if (c.focus) return sideChat(c);
  const st = statusById(statusOf(c));
  return sideChat(c).replace('<span class="lbl">', `<span class="st-dot" style="background:${st.c}" title="${st.name}"></span><span class="lbl">`);
}

const VIEW_FN = { triage: () => triageView(), now: () => now(), home: () => home(), hack: () => hackView(), bugs: () => bugsView(), automation: () => automationView(), routines: () => routinesView(), routine: () => routineEditorView(), recent: () => listView('recent'), search: () => listView('search'), project: () => project(), archived: () => archivedView(), cleanup: () => cleanupView(), images: () => imagesView(), alerts: () => alertsView() };
function render() {
  famMemo = null;
  applyLook();
  if (!S.loaded) { $('main').innerHTML = '<div class="wrap"><p class="empty-note">Loading your chats…</p></div>'; return; }
  if (S.view === 'side' && !small()) { S.view = 'now'; document.body.classList.add('in-main'); }
  renderSide(); renderSel(); updateBadge();
  if (typeof paintViewer === 'function') paintViewer();
  if (S.view === 'side') return;
  const m = $('main');
  // The chat and New chat pages are drawn once; after that only their parts change.
  if (S.view === 'chat') { if (!$('chatView') || m.dataset.shownChat !== String(CV.id)) { m.innerHTML = chatView(); m.dataset.shownChat = String(CV.id); paintChat(); restoreDraft(); } else paintHead(); return; }
  if (S.view === 'newchat') {
    if (!m.querySelector('.newchat')) { m.innerHTML = newChatView(); delete m.dataset.shownChat; paintNewChat(); $('msgBox').focus(); } else paintNewChat();
    if (NC.prefill) { $('msgBox').value = NC.prefill; autosize($('msgBox')); NC.prefill = null; }
    return;
  }
  delete m.dataset.shownChat;
  const keep = m.scrollTop;
  const typed = [...m.querySelectorAll('[data-qr], #cmdInput, #genPrompt')].map(i => [i.dataset.qr || i.id, i.value, document.activeElement === i]).filter(x => x[1] || x[2]);
  m.innerHTML = (VIEW_FN[S.view] || VIEW_FN.now)();
  for (const [k, v, f] of typed) { const i = m.querySelector(`[data-qr="${CSS.escape(k)}"]`) || $(k); if (i) { i.value = v; if (i.tagName === 'TEXTAREA') autosize(i); if (f) i.focus(); } }
  m.scrollTop = keep;
  keepCur();
  if (S.view === 'images') watchGallery();
}
// Live events redraw only what moves: the sidebar marks, Now's Needs you and Running, and the count.
let markSig = '';
function renderLive() {
  if (typeof sendBackgroundQueues === 'function') sendBackgroundQueues();
  if (!S.loaded) return;
  renderSide(); updateBadge();
  if (S.view === 'triage') { if (!document.activeElement || document.activeElement.id !== 'trBox') render(); return; }
  if (S.view === 'now' && $('nowLive')) {
    $('nowLead').innerHTML = leadHtml();
    swapHtml($('nowLive'), nowLiveHtml(), (el, html) => {
      const typed = [...el.querySelectorAll('[data-qr]')].map(i => [i.dataset.qr, i.value, document.activeElement === i]).filter(x => x[1] || x[2]);
      el.innerHTML = html;
      for (const [k, v, f] of typed) { const i = el.querySelector(`[data-qr="${CSS.escape(k)}"]`); if (i) { i.value = v; if (i.tagName === 'TEXTAREA') autosize(i); if (f) i.focus(); } }
      keepCur();
    });
    return;
  }
  const sig = S.live.map(x => `${x.sessionId}:${x.working ? 1 : 0}${needsLive(x) ? 1 : 0}`).join('|');
  if (sig !== markSig && ['home', 'project', 'recent', 'search', 'hack'].includes(S.view)) { markSig = sig; renderWhenIdle(); }
}
function renderPlansOnly() {
  renderChip();
  if (S.view === 'now' && $('planBox')) $('planBox').innerHTML = plansBoxHtml();
  else if (S.view === 'hack') render();
}

/* ---------- going places (browser history included) ---------- */
function go(view, extra = {}, { push = true } = {}) {
  if (view === 'back') { if (S.hist > 0) { history.back(); return; } view = 'now'; }
  if (view === 'side' && !small()) view = 'now';
  const prev = S.view;
  if (view !== 'chat' && CV.es) { CV.es.close(); CV.es = null; }
  if (view === 'newchat' || view === 'chat') loadModels();
  if (view === 'newchat') { NC.project = extra.ncProject || (prev === 'project' ? S.project : NC.project); if (prev !== 'newchat') resetComposer(); NC.prefill = extra.prefill || null; }
  S.view = view;
  if (extra.project !== undefined) S.project = extra.project;
  S.sel.clear(); cur = -1;
  if (!['side', 'search', 'project', 'chat', 'newchat'].includes(view)) local.set('view', view);
  document.body.classList.toggle('in-main', view !== 'side');
  if (push) {
    const st = { view, project: S.project, chat: extra.chat || null };
    history.pushState(st, '', view === 'chat' && extra.chat ? `/lite?chat=${encodeURIComponent(extra.chat)}` : `/lite${view === 'now' ? '' : `?view=${view}`}`);
    S.hist = (S.hist || 0) + 1;
  }
  const doIt = () => {
    if (view === 'chat' && extra.draft) { $('main').innerHTML = ''; render(); }
    else if (view === 'chat') { $('main').innerHTML = ''; CV.id = extra.chat || null; render(); openChatView(extra.chat, { key: extra.chatKey || null, provider: extra.provider || null }); }
    else render();
    $('main').scrollTop = 0;
  };
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches && prev !== view && !small() && !document.hidden) document.startViewTransition(doIt); else doIt();
  if (view === 'now' || view === 'routines') loadRoutines().then(() => { if (S.view === view) renderWhenIdle(); }).catch(() => {});
  if (view === 'now' || view === 'hack' || view === 'newchat') loadPlans(false).then(() => (S.view === 'newchat' ? paintNewChat() : renderPlansOnly())).catch(() => {});
  if (view === 'cleanup') loadSpace().then(render).catch(err => toast(err.message));
  if (view === 'images') loadGallery().then(() => { render(); if (extra.genOpen) $('genPrompt')?.focus(); }).catch(err => toast(err.message));
  if (view === 'alerts') loadPush().then(render).catch(err => toast(err.message));
}
addEventListener('popstate', e => {
  const st = e.state || { view: 'now' };
  S.hist = Math.max(0, (S.hist || 0) - 1);
  if (st.view === 'chat' && st.chat) go('chat', { chat: st.chat }, { push: false });
  else go(st.view || 'now', { project: st.project }, { push: false });
});

/* ---------- clicks ---------- */
document.addEventListener('click', e => {
  const t = e.target;
  const el = sel => t.closest(sel);
  let b;
  if (el('#palRoot')) return undefined;
  if ((b = el('[data-go]'))) { if (b.tagName === 'A') return undefined; e.preventDefault(); return go(b.dataset.go); }
  if ((b = el('[data-newchat]'))) { e.preventDefault(); return go('newchat', { ncProject: b.dataset.newchat || null }); }
  if ((b = el('[data-perm]'))) {
    e.stopPropagation(); b.disabled = true;
    return wrap(async () => { await api('/api/chat/permission', { key: b.dataset.key, requestId: b.dataset.req, decision: b.dataset.perm }); sfx(b.dataset.perm === 'deny' ? 'shove' : 'chip'); toast(b.dataset.perm === 'deny' ? 'Denied.' : 'Allowed.'); await loadLive(); })();
  }
  if ((b = el('[data-perm-c]'))) { e.preventDefault(); return answerInChat(b.dataset.req, b.dataset.permC); }
  if ((b = el('[data-answer]'))) {
    e.preventDefault();
    const p = CV.pending.get(b.dataset.answer); if (!p) return undefined;
    const q = p.questions[Number(b.dataset.q)];
    return answerInChat(p.requestId, 'allow', { [q.question]: q.options[Number(b.dataset.o)].label });
  }
  if ((b = el('[data-sendanswers]'))) {
    e.preventDefault();
    const p = CV.pending.get(b.dataset.sendanswers), card = b.closest('.ask-card'); if (!p || !card) return undefined;
    const answers = answersFrom(card, p); if (answers) return answerInChat(p.requestId, 'allow', answers);
    return undefined;
  }
  if ((b = el('[data-qmore]'))) { toggleMore(b.dataset.qmore); return undefined; }
  if ((b = el('[data-qreply]'))) { openQuickReply(b.dataset.qreply); return undefined; }
  if ((b = el('[data-send]'))) return sendQuick(b.dataset.send);
  if ((b = el('[data-dismiss]'))) { e.stopPropagation(); markSeen(b.dataset.dismiss); return renderLive(); }
  if ((b = el('[data-earlier]'))) return wrap(loadEarlier)();
  if ((b = el('[data-addimg]'))) return wrap(addImageFromUrl)(b.dataset.addimg);
  if ((b = el('[data-chatpics]'))) return picturesMenu(b);
  if ((b = el('[data-chatlinks]'))) return linksMenu(b);
  if ((b = el('[data-steerq]'))) { steerQueued(Number(b.dataset.steerq)); return undefined; }
  if ((b = el('[data-unqueue]'))) { CV.queue.splice(Number(b.dataset.unqueue), 1); paintQueue(); return undefined; }
  if ((b = el('[data-rtnew]'))) return newRoutine(b.dataset.rtnew);
  if ((b = el('[data-rtmenu]'))) { e.stopPropagation(); return routineMenu(b, b.dataset.rtmenu); }
  if ((b = el('[data-inrepo]'))) { CV.inRepo = true; COMP.perm = 'read-only'; const g = $('folderGone'); if (g) g.outerHTML = folderNotice(); if (typeof paintBar === 'function') paintBar(); $('msgBox')?.focus(); return undefined; }
  if ((b = el('[data-evseen]'))) { e.stopPropagation(); return wrap(seeEvents)(b.dataset.evseen === 'all' ? 'all' : b.dataset.evseen.split(',')); }
  if ((b = el('[data-rtrun]'))) { e.stopPropagation(); return openChat(b.dataset.rtrun, { provider: b.dataset.prov === 'codex' ? 'codex' : null }); }
  if ((b = el('[data-rtproj]'))) { readRoutineForm(); return pickProject(b, k => { const p = projBy.get(k); if (p && p.cwd) { S.rtEdit.cwd = p.cwd; render(); } }); }
  if ((b = el('[data-rtchat]'))) { readRoutineForm(); S.rtEdit.chat.mode = b.dataset.rtchat; return render(); }
  if ((b = el('[data-rt]'))) { S.more[`rt:${b.dataset.rt}`] = !S.more[`rt:${b.dataset.rt}`]; return render(); }
  if ((b = el('[data-fam]'))) { e.stopPropagation(); toggleFam(b.dataset.fam); sfx('card'); return render(); }
  if ((b = el('[data-pipe-refresh]'))) { e.stopPropagation(); return loadPipeline(true); }
  if ((b = el('[data-chatmenu]'))) return chatMenu(b);
  if ((b = el('[data-renamechat]'))) return editTitleInline();
  if ((b = el('[data-barmodel]'))) return modelMenu(b);
  if ((b = el('[data-bareffort]'))) return effortMenu(b);
  if ((b = el('[data-chatsettings]'))) return settingsMenu(b);
  if ((b = el('[data-attach]'))) { $('attIn')?.click(); return undefined; }
  if ((b = el('[data-rmimg]'))) { const [im] = COMP.images.splice(Number(b.dataset.rmimg), 1); if (im && im.url) URL.revokeObjectURL(im.url); return paintAttachments(); }
  if ((b = el('[data-rmfile]'))) { COMP.files.splice(Number(b.dataset.rmfile), 1); return paintAttachments(); }
  if ((b = el('[data-zoom]'))) return showPicture(b.src);
  if ((b = el('[data-stopchat]'))) { sfx('close'); return wrap(() => api('/api/chat/interrupt', { key: CV.key }))(); }
  if ((b = el('[data-ncproject]'))) return pickProject(b, k => { NC.project = k; paintNewChat(); $('msgBox').focus(); });
  if ((b = el('[data-ncwho]'))) return accountMenu(b);
  if ((b = el('[data-triage]'))) return startTriage();
  if ((b = el('[data-tr]'))) { b.disabled = true; return wrap(triageAct)(b.dataset.tr); }
  // A suggestion only fills the box (easy to brush past on a phone); Ask or Enter sends it.
  if ((b = el('[data-cmd]'))) { const i = $('cmdInput'); if (i) { i.value = b.dataset.cmd; i.focus(); } return undefined; }
  if ((b = el('[data-floor]'))) return wrap(setLook)({ floor: Number(b.dataset.floor) });
  if ((b = el('[data-quietdays]'))) return wrap(setLook)({ quietDays: Number(b.dataset.quietdays) });
  if ((b = el('[data-refreshplans]'))) { S.plansRefreshing = true; renderPlansOnly(); return loadPlans(true).catch(err => toast(err.message)).finally(() => { S.plansRefreshing = false; renderPlansOnly(); }); }
  if ((b = el('[data-usereset]'))) return wrap(useReset)(b.dataset.usereset);
  if ((b = el('[data-signin]'))) return signInFlow(b.dataset.signin);
  if ((b = el('[data-plan]'))) return planDetails(b, b.dataset.plan);
  if ((b = el('[data-addreset]'))) return addReset(b.dataset.addreset, b);
  if ((b = el('[data-delreset]'))) return wrap(async () => { await api('/api/lite/reset/remove', { id: b.dataset.delreset }); await loadPlans(false); renderPlansOnly(); })();
  if ((b = el('[data-hackdates]'))) return editHackDates();
  if ((b = el('[data-delidea]'))) return wrap(saveIdeas)((S.lite.ideas || []).filter(i => i.id !== b.dataset.delidea));
  if ((b = el('[data-unarch]'))) { e.stopPropagation(); return wrap(unarchiveChats)([b.dataset.unarch]); }
  if ((b = el('[data-unarch-p]'))) return wrap(archiveProject)(b.dataset.unarchP, false);
  if ((b = el('[data-recreate]'))) {
    b.disabled = true;
    return wrap(async () => {
      try { await api('/api/lite/folder/recreate', { id: b.dataset.recreate }); } finally { b.disabled = false; }
      const c = chatBy.get(b.dataset.recreate); if (c) c.folderExists = true;
      $('folderGone')?.remove(); sfx('slide'); toast('The folder is back (empty). Send your message and the chat carries on.'); $('msgBox')?.focus();
      loadState().catch(() => {});
    })();
  }
  if ((b = el('[data-rebuild]'))) { e.stopPropagation(); b.disabled = true; b.textContent = 'Rebuilding…'; return wrap(async () => { const r = await api('/api/lite/worktree/rebuild', { id: b.dataset.rebuild }); toast(r.installing ? 'Worktree is back; dependencies are installing in the background.' : 'Worktree is back.'); await loadState(); render(); })(); }
  if ((b = el('[data-clean]'))) return wrap(cleanAction)(b.dataset.clean, b);
  if ((b = el('[data-free]'))) { e.stopPropagation(); return wrap(freePaths)([b.dataset.free], b); }
  if ((b = el('[data-rescan]'))) return wrap(async () => { await loadSpace(true); render(); })();
  if ((b = el('[data-gimg]'))) return showImage(b.dataset.gimg);
  if ((b = el('[data-gmore]'))) { S.galleryN = (S.galleryN || 120) + 120; return render(); }
  if ((b = el('[data-gen-n]'))) { S.genN = Number(b.dataset.genN); return render(); }
  if ((b = el('[data-push]'))) return wrap(async () => { if (b.dataset.push === 'on') await pushOn(); else if (b.dataset.push === 'off') await pushOff(); else { const r = await api('/api/push/test', {}); toast(r.ok ? 'Sent. It should show on this phone in a moment.' : r.why || 'It didn’t go.'); } render(); })();
  if ((b = el('[data-selstage]'))) return pop(b, STATUSES.map(s => `<button data-v="${s.id}"><span class="dot" style="background:${s.c}"></span>${s.name}<kbd>${s.key}</kbd></button>`).join('') + `<hr>${KINDS.map(k => `<button data-v="k:${k.id}">${k.name}</button>`).join('')}<hr><button data-v="focus">Focus<kbd>f</kbd></button>`, v => (v === 'focus' ? wrap(toggleFocus)([...S.sel]) : wrap(setChats)([...S.sel], v.startsWith('k:') ? { kind: v.slice(2) } : { status: v })));
  if ((b = el('[data-selwait]'))) return askWaiting([...S.sel]);
  if ((b = el('[data-selarch]'))) return wrap(archiveChats)([...S.sel]);
  if ((b = el('[data-selclear]'))) { S.sel.clear(); return render(); }
  if ((b = el('[data-rowmenu]'))) { e.stopPropagation(); return rowMenu(b, b.dataset.rowmenu); }
  if ((b = el('[data-projmenu]'))) return projMenu(b, b.dataset.projmenu);
  if ((b = el('[data-bstages]'))) return wrap(async () => { const list = buckets().map(x => (x.id === b.dataset.bstages ? { ...x, stages: !bucketStages(x.id) } : x)); S.lite.buckets = (await api('/api/lite/buckets', { buckets: list })).buckets; render(); })();
  if ((b = el('[data-sidemode]'))) { S.sideMode = b.dataset.sidemode; local.set('sideMode', S.sideMode); return renderSide(); }
  if ((b = el('[data-foldproj]'))) { const k = 'p:' + b.dataset.foldproj; if (b.dataset.stageless) { if (S.folded[k] === false) delete S.folded[k]; else S.folded[k] = false; } else if (S.folded[k]) delete S.folded[k]; else S.folded[k] = true; local.set('folded', S.folded); return renderSide(); }
  if ((b = el('[data-more-proj]'))) { const k = 'pall:' + b.dataset.moreProj; S.more[k] = !S.more[k]; return renderSide(); }
  if ((b = el('[data-side-quiet]'))) { const k = 'pq:' + b.dataset.sideQuiet; S.more[k] = !S.more[k]; return renderSide(); }
  if ((b = el('[data-quietproj]'))) { S.more.quietProj = !S.more.quietProj; return renderSide(); }
  if ((b = el('[data-fold]'))) { S.folded[b.dataset.fold] = b.getAttribute('aria-expanded') === 'true'; local.set('folded', S.folded); return renderSide(); }
  if ((b = el('[data-more-st]'))) { S.more[b.dataset.moreSt] = !S.more[b.dataset.moreSt]; return renderSide(); }
  if ((b = el('[data-automore]'))) { S.more['auto-all'] = true; return render(); }
  if ((b = el('[data-more-all]'))) { S.more['all-' + b.dataset.moreAll] = true; return renderSide(); }
  if ((b = el('[data-pfold]'))) { S.more['p-done'] = !S.more['p-done']; return render(); }
  if ((b = el('[data-bfold]'))) { S.more['b-done'] = !S.more['b-done']; return render(); }
  if ((b = el('[data-pq]'))) { S.more['pq-' + b.dataset.pq] = !S.more['pq-' + b.dataset.pq]; return render(); }
  if ((b = el('[data-pickbucket]'))) return pop(b, `${[['all', 'All buckets'], ...buckets().map(x => [x.id, x.name]), ['unsorted', 'Unsorted']].map(([id, n]) => `<button data-v="${esc(id)}" role="menuitemradio" aria-checked="${S.bucket === id}">${esc(n)}</button>`).join('')}`, v => { S.bucket = v; local.set('bucket', v); render(); });
  if ((b = el('#lookBtn'))) return lookMenu(b);
  if ((b = el('#muteBtn'))) return toggleSound();
  if ((b = el('[data-open]'))) { if (el('input') || el('a[href]') || (el('button') && !el('button').dataset.open)) return undefined; return b.dataset.open ? openChat(b.dataset.open) : toast('That chat hasn’t started yet.'); }
  if ((b = el('[data-project]'))) return go('project', { project: b.dataset.project });
  if ((b = el('[data-chat]'))) {
    const id = b.dataset.chat;
    if (e.metaKey || e.ctrlKey) { if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id); S.selAnchor = id; return render(); }
    if (e.shiftKey && S.selAnchor) {
      const list = [...document.querySelectorAll('#main [data-chat]')].map(x => x.dataset.chat);
      const a = list.indexOf(S.selAnchor), z = list.indexOf(id);
      if (a >= 0 && z >= 0) { for (const x of list.slice(Math.min(a, z), Math.max(a, z) + 1)) S.sel.add(x); return render(); }
    }
    return openChat(id);
  }
  return undefined;
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.follow) return wrap(async () => { await setLook({ routinesFollow: t.checked }); toast(t.checked ? 'Routines now run on the use-next plan of their family.' : 'Routines run on the plan each one names.'); })();
  if (t.dataset.pref === 'sound') return setSound(t.checked);
  if (t.dataset.pref === 'notify') return setNotify(t.checked).then(render);
  if (t.dataset.pushpref) return wrap(setPushPref)(t.dataset.pushpref, t.checked);
  return undefined;
});
document.addEventListener('contextmenu', e => {
  const r = e.target.closest('[data-chat]'), p = e.target.closest('[data-project]');
  const at = { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY };
  if (r) { e.preventDefault(); rowMenu(r, r.dataset.chat, at); } else if (p) { e.preventDefault(); projMenu(p, p.dataset.project, at); }
});
document.addEventListener('submit', e => {
  if (e.target.id === 'trForm') { e.preventDefault(); return triageReply(); }
  if (e.target.id === 'cmdForm') { e.preventDefault(); const v = $('cmdInput').value; $('cmdInput').value = ''; return askCommander(v); }
  if (e.target.id === 'composer') { e.preventDefault(); return S.view === 'newchat' ? startNewChat() : sendInChat(); }
  if (e.target.id === 'genForm') { e.preventDefault(); const v = $('genPrompt').value.trim(); if (!v) return undefined; $('genPrompt').value = ''; return wrap(startGenerate)(v, S.genN || 1); }
  if (e.target.id === 'rtForm') { e.preventDefault(); return wrap(saveRoutine)(); }
  if (e.target.dataset.olread) {
    e.preventDefault();
    const pct = Number(String(e.target.pct.value).replace('%', '').trim());
    if (!(pct >= 0 && pct <= 100) || e.target.pct.value.trim() === '') { e.target.pct.focus(); return toast('Type the weekly % used from Ollama’s page, like 22.3.'); }
    return wrap(async () => { closePop(); await api('/api/lite/ollama/reading', { pct }); await loadPlans(false); renderPlansOnly(); toast(`Saved: ${pct}% used. The estimate starts from here.`); })();
  }
  if (e.target.dataset.addidea) { e.preventDefault(); const text = e.target.idea.value.trim(); if (!text) return undefined; return wrap(saveIdeas)([...(S.lite.ideas || []), { text }]); }
  return undefined;
});
document.addEventListener('keydown', e => {
  if (e.target.id === 'msgBox' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); COMP.steerNow = e.altKey; $('composer').requestSubmit(); return; }
  if (e.target.id === 'trBox' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); triageReply(); return; }
  if (e.target.id === 'msgBox' && e.key.toLowerCase() === 'p' && (e.metaKey || e.ctrlKey) && S.view === 'newchat') { e.preventDefault(); document.querySelector('[data-ncproject]')?.click(); return; }
  if (e.target.dataset && e.target.dataset.qr && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendQuick(e.target.dataset.qr); }
}, true);
document.addEventListener('input', e => { if (e.target.id === 'msgBox') autosize(e.target); });
// Pictures and files: paste (several at once), drop anywhere on a chat, or pick with +.
// The routine form redraws when what it asks for changes (the trigger, the plan, triage on or off).
document.addEventListener('change', e => { if (e.target.form && e.target.form.id === 'rtForm' && ['kind', 'account', 'triage'].includes(e.target.name)) { readRoutineForm(); render(); } });
document.addEventListener('change', e => { if (e.target.id === 'attIn' && e.target.files.length) { addFiles([...e.target.files]); e.target.value = ''; } });
document.addEventListener('paste', e => {
  if (S.view !== 'chat' && S.view !== 'newchat') return;
  const files = [...(e.clipboardData ? e.clipboardData.files : [])];
  if (!files.length) return;
  e.preventDefault(); addFiles(files);
});
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
document.addEventListener('dragover', e => { if ((S.view === 'chat' || S.view === 'newchat') && hasFiles(e)) { e.preventDefault(); document.body.classList.add('dropping'); } });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
document.addEventListener('drop', e => { document.body.classList.remove('dropping'); if ((S.view === 'chat' || S.view === 'newchat') && hasFiles(e)) { e.preventDefault(); addFiles([...e.dataTransfer.files]); } });
function showPicture(src) {
  const root = $('modalRoot');
  root.innerHTML = `<div class="modal-back lightbox"><figure><img src="${src}" alt=""></figure></div>`;
  root.querySelector('.modal-back').addEventListener('click', () => { root.innerHTML = ''; });
}
$('q').addEventListener('input', e => { S.q = e.target.value.trim(); if (S.q) { if (S.view !== 'search') go('search', {}, { push: false }); else render(); } else if (S.view === 'search') go('now', {}, { push: false }); });
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') { const r = document.querySelector('#main [data-cur]'); if (r) { e.preventDefault(); r.click(); } } if (e.key === 'ArrowDown') { e.preventDefault(); e.target.blur(); setCur(0); } });

async function sendQuick(key) {
  const input = document.querySelector(`[data-qr="${CSS.escape(key)}"]`);
  const text = input && input.value.trim();
  if (!text) return;
  input.disabled = true;
  try { await api('/api/chat/send', { key, text }); NW.replying.delete(key); markSeen(input.dataset.id); sfx('slide'); toast('Sent.'); await loadLive(); }
  catch (err) { toast(err.message); input.disabled = false; return; }
  renderLive();
}

function lookMenu(anchor) {
  const look = S.lite.look;
  pop(anchor, `<div class="ph">Skin</div>${[['plain', 'Plain'], ['imperial', 'Imperial'], ['rebel', 'Rebel']].map(([v, n]) => `<button data-v="skin:${v}" role="menuitemradio" aria-checked="${look.skin === v}">${n}</button>`).join('')}
    <hr><div class="ph">Light or dark</div>${[['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, n]) => `<button data-v="mode:${v}" role="menuitemradio" aria-checked="${look.mode === v}">${n}</button>`).join('')}
    <hr><div class="ph">Icon</div><div class="kind-seg">${[['look', 'Match the look'], ...Object.entries(ICONS).map(([k, v]) => [k, v.name])].map(([k, n]) => `<button data-v="icon:${k}" role="menuitemradio" aria-checked="${iconChoice() === k}">${k === 'look' ? '' : `<img src="${iconUrl(k)}" alt="" width="16" height="16" style="border-radius:4px;margin-right:6px;vertical-align:-3px">`}${n}</button>`).join('')}</div>
    <hr><div class="ph">Drain each plan to (then the next takes over)</div><div class="kind-seg">${[10, 15, 20].map(d => `<button data-v="floor:${d}" role="menuitemradio" aria-checked="${floor() === d}">${d}%</button>`).join('')}</div>
    <hr><button data-v="sound" role="menuitemcheckbox" aria-checked="${prefs.sound}">Sounds</button><button data-v="autoweeks" role="menuitemcheckbox" aria-checked="${S.lite.autoStartWeeks !== false}">Start idle weeks for me<small>one tiny message</small></button><button data-v="openLite" role="menuitemcheckbox" aria-checked="${!!S.lite.openLite}">Open Lite when the app starts</button><button data-v="alerts">Alerts…</button><button data-v="keys">Keyboard shortcuts<kbd>?</kbd></button>`,
  v => {
    if (v === 'sound') return setSound(!prefs.sound);
    if (v === 'autoweeks') return wrap(setLook)({ autoStartWeeks: S.lite.autoStartWeeks === false }).then(() => toast(S.lite.autoStartWeeks !== false ? 'A plan whose week hasn’t started gets one tiny message to start it.' : 'Idle weeks are left alone.'));
    if (v === 'openLite') return wrap(setLook)({ openLite: !S.lite.openLite }).then(() => toast(S.lite.openLite ? 'The app opens on Lite from now on.' : 'The app opens on the full Switcher from now on.'));
    if (v === 'alerts') return go('alerts');
    if (v === 'keys') return showShortcuts();
    const [k, x] = v.split(':');
    if (k === 'icon') { local.set('icon', x); shownIcon = null; applyLook(); return toast(x === 'look' ? 'The icon follows the look.' : `${ICONS[x].name} icon. On a phone, add Lite to the Home Screen again to see it there.`); }
    if (k === 'floor') return wrap(setLook)({ floor: Number(x) }).then(() => toast(`Plans drain to ${x}% before the next one takes over.`));
    return wrap(setLook)(k === 'skin' ? { skin: x } : { mode: x });
  });
}

/* ---------- dragging: chats onto a status (or Focus), projects onto a bucket ---------- */
let drag = null;
document.addEventListener('dragstart', e => {
  const c = e.target.closest && e.target.closest('[data-chat]');
  const p = !c && e.target.closest && e.target.closest('[data-project]');
  const idea = e.target.closest && e.target.closest('[data-idea]');
  if (idea) drag = { idea: idea.dataset.idea };
  else if (c) drag = { chats: S.sel.has(c.dataset.chat) && S.sel.size > 1 ? [...S.sel] : [c.dataset.chat] };
  else if (p) drag = { project: p.dataset.project };
  else return;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', drag.chats ? drag.chats.join(',') : drag.project || drag.idea);
});
// Dropped on a chat in the same status (or the sidebar), a chat goes under it; dropped anywhere in
// another status's section or column (on a card or not), it moves to that status.
const nestTarget = t => {
  const r = t.closest('[data-chat]'); if (!r || !drag || !drag.chats || drag.chats.some(id => low(id) === low(r.dataset.chat))) return null;
  const me = chatBy.get(drag.chats[0]) || {};
  const zone = r.closest('[data-drop-stage]'); if (zone && (zone.dataset.dropStage === 'waiting' ? !me.waiting : zone.dataset.dropStage !== statusOf(me))) return zone;
  const fz = r.closest('[data-drop-focus]'); if (fz && !me.focus) return fz;
  return r;
};
// A project dropped on another one goes just above it, in that one's bucket; the bucket's order is saved.
async function placeProject(key, before) {
  const target = projBy.get(before); if (!target) return;
  const keys = [...document.querySelectorAll('#sideScroll .proj-row [data-project]')].map(b => b.dataset.project)
    .filter(k => k !== key && (projBy.get(k) || {}).bucket === target.bucket);
  keys.splice(keys.indexOf(before), 0, key);
  for (const [i, k] of keys.entries()) await api('/api/lite/project', { key: k, patch: { order: i + 1, ...(k === key ? { bucket: target.bucket || null } : {}) } });
  sfx('card'); await loadState(); render();
}
const dropZone = t => (!t.closest ? null : drag && drag.idea ? t.closest('[data-drop-stage], [data-idea-drop]') : drag && drag.chats ? nestTarget(t) || t.closest('[data-drop-stage], [data-drop-focus]') : drag && drag.project ? t.closest('.proj-row [data-project]:not(.drop-self)') || t.closest('[data-drop-bucket]') : null);
document.addEventListener('dragover', e => {
  const z = dropZone(e.target); if (!z) return;
  e.preventDefault();
  document.querySelectorAll('.drop-hot').forEach(x => x !== z && x.classList.remove('drop-hot'));
  z.classList.add('drop-hot');
});
document.addEventListener('dragleave', e => { const z = dropZone(e.target); if (z && !z.contains(e.relatedTarget)) z.classList.remove('drop-hot'); });
document.addEventListener('drop', e => {
  const z = dropZone(e.target);
  document.querySelectorAll('.drop-hot').forEach(x => x.classList.remove('drop-hot'));
  if (!z) return;
  e.preventDefault();
  const d = drag; drag = null;
  if (d.idea) { if (z.dataset.ideaDrop) { const over = e.target.closest('[data-idea]'); wrap(moveIdea)(d.idea, over && over.dataset.idea !== d.idea ? over.dataset.idea : null); } else wrap(startIdea)(d.idea); }
  else if (d.chats && z.dataset.chat) wrap(nestChats)(d.chats, z.dataset.chat);
  else if (d.chats) wrap(setChats)(d.chats, z.dataset.dropFocus ? { focus: true } : z.dataset.dropStage === 'waiting' ? { waiting: true } : { status: z.dataset.dropStage, waiting: false });
  else if (z.dataset.project) { if (z.dataset.project !== d.project) wrap(placeProject)(d.project, z.dataset.project); }
  else wrap(setBucket)(d.project, z.dataset.dropBucket || null);
});
document.addEventListener('dragend', () => { drag = null; document.querySelectorAll('.drop-hot').forEach(x => x.classList.remove('drop-hot')); });
addEventListener('resize', () => { if (S.view === 'side' && !small()) render(); });

/* ---------- start ---------- */
(async () => {
  applyLook();
  const args = new URLSearchParams(location.search);
  const v = args.get('view'), chatArg = args.get('chat');
  S.view = chatArg ? 'chat' : v && VIEWS.includes(v) && !['project', 'search', 'chat'].includes(v) ? v : small() ? 'side' : (VIEWS.includes(S.view) && !['project', 'search', 'chat', 'newchat'].includes(S.view) ? S.view : 'now');
  document.body.classList.toggle('in-main', S.view !== 'side');
  history.replaceState({ view: S.view, chat: chatArg || null }, '', location.href);
  render();
  connect();
  try { await loadState(); } catch (err) { $('main').innerHTML = `<div class="wrap"><p class="empty-note">${esc(err.message)}</p></div>`; return; }
  if (chatArg) go('chat', { chat: chatArg }, { push: false }); else go(S.view, {}, { push: false });
  loadPlans(false).then(renderPlansOnly).catch(err => toast(err.message));
  api('/api/commander').then(c => { if (c.live && c.live.key) { S.cmd.sessionId = c.live.sessionId; cmdListen(c.live.key); } }).catch(() => {});
  if ('serviceWorker' in navigator && window.isSecureContext && location.hostname !== '127.0.0.1') navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  // A tapped notification, with Lite already open: go to its chat.
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { const o = e.data && e.data.open; if (o && o.sessionId) openChat(o.sessionId); });
})();

/* ---------- sidebar width: drag its edge, or ← → on it; remembered on this device ---------- */
const SIDE_W = { min: 220, max: 480, def: 288 };
function setSideW(w, save = true) {
  const v = Math.round(Math.min(SIDE_W.max, Math.max(SIDE_W.min, Number(w) || SIDE_W.def)));
  document.documentElement.style.setProperty('--side-w', `${v}px`);
  if (save) local.set('sideW', v);
  return v;
}
setSideW(local.get('sideW', SIDE_W.def), false);
(() => {
  const g = $('sideGrip'); if (!g) return;
  const now = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--side-w'), 10) || SIDE_W.def;
  g.addEventListener('pointerdown', e => {
    if (small() || e.button !== 0) return;
    e.preventDefault();
    const left = g.parentElement.getBoundingClientRect().left;
    g.setPointerCapture(e.pointerId); document.body.classList.add('resizing');
    const move = ev => setSideW(ev.clientX - left, false);
    const up = ev => { document.body.classList.remove('resizing'); g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); setSideW(ev.clientX - left); };
    g.addEventListener('pointermove', move); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
  });
  g.addEventListener('dblclick', () => { setSideW(SIDE_W.def); toast('Sidebar back to its usual width.'); });
  g.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault(); e.stopPropagation();
    setSideW(now() + (e.key === 'ArrowRight' ? 16 : -16));
  });
})();

/* ---------- phones: the app fits the space above the keyboard ---------- */
// iOS keeps the layout viewport full height when the keyboard opens and scrolls the page instead;
// sizing the app to the visible area keeps the input bar just above the keyboard, nothing pulled.
if (window.visualViewport && matchMedia('(hover: none) and (pointer: coarse)').matches) {
  // Once a frame at most (the keyboard fires these many times as it slides), and a conversation
  // that was at its end stays at its end.
  let frame = 0;
  const fit = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const f = $('feed'), pinned = f && f.scrollHeight - f.scrollTop - f.clientHeight < 80;
      const r = document.documentElement.style;
      const k = Math.round(innerHeight - visualViewport.height);
      if (k > 150) { kbH = k; try { localStorage.setItem('lite.kb', String(k)); } catch { /* fine */ } }
      document.documentElement.classList.toggle('kb-up', k > 150);
      r.setProperty('--app-h', `${Math.round(visualViewport.height)}px`);
      r.setProperty('--vv-top', `${Math.round(visualViewport.offsetTop)}px`);
      if (pinned) f.scrollTop = f.scrollHeight;
    });
  };
  // iOS says how tall the keyboard is only once it has finished sliding, so the page would snap after
  // it. Lite remembers the height and slides the page with the keyboard; the real size then settles it.
  let kbH = 0; try { kbH = Number(localStorage.getItem('lite.kb')) || 0; } catch { /* fine */ }
  const TYPE = 'textarea, input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range])';
  let glideT = 0;
  const glide = h => {
    const root = document.documentElement;
    root.classList.add('kb-glide'); root.style.setProperty('--app-h', `${Math.round(h)}px`); root.style.setProperty('--vv-top', '0px');
    clearTimeout(glideT); glideT = setTimeout(() => root.classList.remove('kb-glide'), 450);
  };
  document.addEventListener('focusin', e => { if (kbH && e.target.matches && e.target.matches(TYPE)) { document.documentElement.classList.add('kb-up'); const f = $('feed'), pinned = f && f.scrollHeight - f.scrollTop - f.clientHeight < 80; glide(innerHeight - kbH); if (pinned) setTimeout(() => { f.scrollTop = f.scrollHeight; }, 320); } });
  document.addEventListener('focusout', e => { if (e.target.matches && e.target.matches(TYPE)) setTimeout(() => { const a = document.activeElement; if (!(a && a.matches && a.matches(TYPE))) { document.documentElement.classList.remove('kb-up'); glide(innerHeight); } }, 0); });
  // Like Messages: with the keyboard up, dragging the conversation down (or tapping it) puts the keyboard away.
  let drag = null;
  document.addEventListener('touchstart', e => { const f = e.target.closest && e.target.closest('#feed'); drag = f && e.touches[0] ? { y: e.touches[0].clientY, x: e.touches[0].clientX } : null; }, { passive: true });
  document.addEventListener('touchmove', e => {
    const a = document.activeElement;
    if (!drag || !a || !a.matches('textarea, input') || !e.touches[0]) return;
    if (e.touches[0].clientY - drag.y > 24) { a.blur(); drag = null; }
  }, { passive: true });
  document.addEventListener('touchend', e => {
    const a = document.activeElement, t = e.changedTouches[0];
    if (!drag || !a || !a.matches('textarea, input') || !t) return;
    const still = Math.hypot(t.clientX - drag.x, t.clientY - drag.y) < 8;
    if (still && !e.target.closest('a, button, input, textarea, [data-open], [data-viewfile], details, summary, img')) a.blur();
    drag = null;
  }, { passive: true });
  visualViewport.addEventListener('resize', fit); visualViewport.addEventListener('scroll', fit); fit();
}

// Quick-reply boxes grow as you type.
document.addEventListener('input', e => { if (e.target.matches && e.target.matches('textarea[data-qr]')) autosize(e.target); });
