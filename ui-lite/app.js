'use strict';
/* The sidebar (pages, bucket switcher, status labels with quiet folding), routing (with real browser
   history, so back and forward work), redraws, and every click and drag on the page. */

const VIEWS = ['triage', 'now', 'tokens', 'home', 'hack', 'bugs', 'automation', 'routines', 'routine', 'recent', 'project', 'search', 'side', 'chat', 'newchat', 'archived', 'cleanup', 'images', 'alerts'];
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
  if ($('brand').textContent !== L('Switcher')) $('brand').textContent = L('Switcher');
  if ($('q').placeholder !== L('Search chats')) $('q').placeholder = L('Search chats');
  const chats = allChats().filter(inBucket).sort((x, y) => y.updated - x.updated);
  const nNeed = S.live.filter(needsLive).length;
  // How many are working right now, beside Now (its lamp pulses while any are).
  const nRun = S.live.filter(x => x.working).length;
  const nav = (view, icon, label, extra = '') => `<button class="nav-i" data-go="${view}" aria-current="${S.view === view}"><span class="ic">${icon}</span><span class="lbl">${label}</span>${extra}</button>`;
  const top = `<div class="group">
      ${nav('newchat', IC.pen, L('New chat'), '<kbd class="nav-k">c</kbd>')}
      ${nav('now', IC.pulse, L('Now'), `${nRun ? `<span class="run-n" title="${nRun} working right now"><span class="live-dot"></span>${nRun}</span>` : ''}${nNeed ? `<span class="badge" title="${nNeed} need you">${nNeed}</span>` : ''}`)}
      ${nav('home', IC.grid, L('Projects'))}
      ${nav('hack', IC.flag, 'Hackathon', `<span class="n">${esc(hackLabel())}</span>`)}
      ${nav('routines', IC.clock, 'Routines', (n => (n ? `<span class="badge">${n}</span>` : ''))(rtEventsOpen().filter(e => e.kind !== 'ran').length))}
      ${nav('bugs', IC.bug, 'Bugs', (n => (n ? `<span class="n">${n}</span>` : ''))(bugList().filter(c => statusOf(c) !== 'done').length))}
      ${nav('automation', IC.clock, 'Automation', (n => (n ? `<span class="n">${n}</span>` : ''))(automationList().filter(c => Date.now() - c.updated < 864e5).length))}
    </div>`;
  const waitSt = { id: 'waiting', name: 'Waiting on others', c: 'var(--muted)' };
  // Later isn't a folder: like quiet, it's one small "N later" row at the end that opens in place.
  const laterAll = chats.filter(c => isTop(c) && statusOf(c) === 'later');
  const laterOpen = !!S.more['side-later'];
  const laterRow = laterAll.length ? `<div class="group">${laterOpen ? `<div class="quiet-chats">${laterAll.map(c => sideChat(c) + sideFam(c)).join('')}</div>` : ''}<button class="nav-i chat-i quiet-toggle" data-side-later="*" aria-expanded="${laterOpen}"><span class="lbl">${laterOpen ? 'Hide later' : `${laterAll.length} later`}</span></button></div>` : '';
  const focused = chats.filter(c => c.focus);
  const focusSection = `<div class="group" data-drop-focus="1"><div class="side-h">Focus</div>${focused.length ? focused.map(c => sideChat(c)).join('') : '<div class="empty-note">Star a chat or drop it here.</div>'}</div>`;
  const folders = [...statusesShown().filter(x => !parked(x.id)), waitSt, ...STATUSES.filter(x => x.id === 'done')].map(st => {
    const all = chats.filter(c => (st.id === 'waiting' ? isTop(c) && c.waiting && !c.focus && !parked(statusOf(c)) : isTop(c) && statusOf(c) === st.id && !(c.focus && !parked(st.id)) && !(c.waiting && !parked(st.id))));
    const act = st.id === 'later' ? all : all.filter(c => !famQuiet(c)), quiet = st.id === 'later' ? [] : all.filter(famQuiet);
    const open = all.length && !S.folded[st.id];
    const showQuiet = S.more[st.id];
    const shown = act.slice(0, S.more['all-' + st.id] ? 400 : 12);
    return `<div class="group folder ${act.length ? '' : 'empty'}" data-folded="${!open}">
      <button class="nav-i folder-btn" data-fold="${st.id}" data-drop-stage="${st.id}" aria-expanded="${!!open}"><span class="ic"><span class="label-dot" style="background:${st.c}"></span></span><span class="lbl">${st.name}</span><span class="n">${act.length || ''}</span></button>
      <div class="folder-items">${shown.map(c => sideChat(c) + sideFam(c)).join('')}${act.length > shown.length ? `<button class="nav-i chat-i quiet-toggle" data-more-all="${st.id}"><span class="lbl">${act.length - shown.length} more</span></button>` : ''}${quiet.length ? (showQuiet ? `<div class="quiet-chats">${quiet.slice(0, 60).map(sideChat).join('')}</div>` : '') + `<button class="nav-i chat-i quiet-toggle" data-more-st="${st.id}"><span class="lbl">${showQuiet ? 'Hide quiet' : `${quiet.length} quiet`}</span></button>` : ''}</div>
    </div>`;
  });
  // The backlog line goes just before Done.
  folders.splice(folders.length - 1, 0, laterRow);
  const nArch = S.chats.filter(c => c.archived).length + S.projects.filter(p => p.archived).length;
  const mode = S.sideMode || 'projects';
  const modeSeg = `<span class="side-seg" role="group" aria-label="Sidebar shows"><button data-sidemode="projects" aria-pressed="${mode === 'projects'}">Projects</button><button data-sidemode="stages" aria-pressed="${mode === 'stages'}">Status</button></span>`;
  if (small() && S.q) swapHtml($('sideScroll'), sideSearchHtml(), morph);
  else swapHtml($('sideScroll'), top + focusSection + `<div class="group"><div class="side-h side-h-row">${modeSeg}</div>${mode === 'stages' ? folders.join('') : sideProjects(chats)}</div>`
    + `<div class="group">${nav('recent', IC.history, L('Recents'))}${nav('images', IC.image, 'Images')}${nav('archived', IC.box, 'Archived', nArch ? `<span class="n">${nArch}</span>` : '')}${nav('cleanup', IC.broom, 'Clean up')}</div>`, morph);
}

// Each project starts as one row. Its name opens a sole main chat or the project list; the count reveals
// other main chats, or the children of a single main chat. Full status groups live on its page.
S.sideMode = local.get('sideMode', 'projects');
const bucketStages = id => { const b = buckets().find(x => x.id === id); return !b || b.stages !== false; };
function projectMain(mains) {
  return [...mains].sort((a, b) => Number(!!b.focus) - Number(!!a.focus) || b.updated - a.updated)[0];
}
function sideProjects(all) {
  if (typeof loadPipeline === 'function') loadPipeline();
  const byProj = new Map();
  for (const c of all) { const k = c.project; if (!byProj.has(k)) byProj.set(k, []); byProj.get(k).push(c); }
  const groups = [...byProj].map(([k, cs]) => ({ p: projBy.get(k) || { key: k, name: 'Unknown' }, cs })).filter(g => !g.p.archived);
  // (Quick keeps all its chats together: it's the place for odds and ends, whatever stage they're at.)
  const mainsOf = g => g.cs.filter(c => isTop(c) && !parked(statusOf(c)) && (g.p.quick || !['waiting', 'finishing'].includes(boardStage(c))));
  const active = g => mainsOf(g).some(c => !famQuiet(c));
  const act = groups.filter(g => active(g) && !g.p.quick).sort((a, b) => projectOrder(a.p, b.p));
  const quiet = groups.filter(g => !g.p.quick && !active(g) && (mainsOf(g).length || g.cs.every(c => parked(statusOf(c))))).sort((a, b) => projectOrder(a.p, b.p));
  const projRow = g => {
    const mains = mainsOf(g), lead = projectMain(mains);
    const many = mains.length > 1, children = descOf(lead.id).filter(c => c.project === g.p.key);
    const count = many ? mains.length : children.length;
    const open = S.folded['p:' + g.p.key] === false;
    const nd = g.cs.some(needs), rn = g.cs.some(running);
    let inner = '';
    if (open) {
      if (many) {
        const lv = mains.filter(c => !famQuiet(c) || c === lead).sort((a, b) => Number(b === lead) - Number(a === lead) || Number(!!b.focus) - Number(!!a.focus) || b.updated - a.updated);
        const q = mains.filter(c => famQuiet(c) && c !== lead);
        const limit = S.more['pall:' + g.p.key] ? lv.length : 8;
        inner = lv.slice(0, limit).map(c => sideChatDot(c) + sideFam(c)).join('');
        if (lv.length > 8) inner += `<button class="nav-i chat-i quiet-toggle" data-more-proj="${esc(g.p.key)}" aria-expanded="${lv.length <= limit}"><span class="lbl">${lv.length > limit ? `${lv.length - limit} more` : 'Show fewer'}</span></button>`;
        if (q.length) {
          const qo = !!S.more['pq:' + g.p.key];
          if (qo) inner += `<div class="quiet-chats">${q.map(c => sideChatDot(c) + sideFam(c)).join('')}</div>`;
          inner += `<button class="nav-i chat-i quiet-toggle" data-side-quiet="${esc(g.p.key)}" aria-expanded="${qo}"><span class="lbl">${qo ? 'Hide quiet' : `${q.length} quiet`}</span></button>`;
        }
      } else inner = kidsOf(lead.id).filter(c => c.project === g.p.key).map(c => sideChatDot(c) + sideFam(c)).join('');
    }
    const cur = S.view === 'project' && S.project === g.p.key || S.view === 'chat' && g.cs.some(c => low(c.id) === low(CV.id));
    const st = statusById(statusOf(lead));
    const label = `${count} ${many ? 'main chats' : count === 1 ? 'subchat' : 'subchats'}`;
    return `<div class="group folder compact-proj" data-folded="${!open}"><div class="proj-row"><button class="nav-i proj-btn" data-project="${esc(g.p.key)}" ${many ? '' : `data-main-chat="${esc(lead.id)}"`} draggable="true" aria-current="${cur}" title="${esc(g.p.name)}: ${many ? `${mains.length} main chats` : esc(lead.title)}"><span class="thumb-xs" style="${artStyle(g.p)}"></span><span class="lbl">${esc(g.p.name)}</span><span class="st-dot" style="background:${st.c}" title="${st.name}"></span>${nd ? '<span class="dot needs-dot" title="Needs you"></span>' : rn ? '<span class="live-dot" title="Working"></span>' : ''}</button>${count ? `<button class="proj-chev" data-foldproj="${esc(g.p.key)}" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} ${esc(g.p.name)} ${label}" title="${label}"><span>${count}</span></button>` : ''}<button class="proj-options" data-projmenu="${esc(g.p.key)}" aria-label="${esc(g.p.name)} options" title="Project options">⋯</button></div><div class="folder-items">${inner}</div></div>`;
  };
  let html = act.map(projRow).join('');
  // Then the categories, folded, one click to open: Quick (odds and ends), what's finishing, what's
  // waiting. A folded one still says when something in it needs you or is working.
  const inQuick = c => projOf(c).quick && !parked(statusOf(c));
  for (const [stage, name] of [['quick', 'Quick'], ['finishing', 'Finishing'], ['waiting', 'Waiting']]) {
    const list = all.filter(c => isTop(c) && !c.focus && (stage === 'quick' ? inQuick(c) : boardStage(c) === stage && !projOf(c).quick)).sort((a, b) => b.updated - a.updated);
    if (!list.length) continue;
    const open = S.folded[stage] === false;
    const mark = open ? '' : list.some(needs) ? '<span class="dot needs-dot" title="Needs you"></span>' : list.some(running) ? '<span class="live-dot" title="Running"></span>' : '';
    html += `<button class="side-bucket side-bucket-btn" data-fold="${stage}" ${stage === 'quick' ? 'data-drop-quick="1"' : `data-drop-stage="${stage}"`} aria-expanded="${open}">${name} <span class="n">${list.length}</span>${mark}<span class="chev">${open ? '▾' : '▸'}</span></button>`;
    if (open) html += `<div class="later-chats">${list.map(c => sideChat(c).replace('<span class="lbl">', `<span class="lbl" title="${esc(projOf(c).name || '')}">`) + sideFam(c)).join('')}</div>`;
  }
  // Later (the backlog) is a bucket of its own, after the others: folded, one click to open.
  const later = all.filter(c => isTop(c) && statusOf(c) === 'later').sort((x, y) => y.updated - x.updated);
  if (later.length) {
    const lo = !!S.more['side-later'];
    html += `<button class="side-bucket side-bucket-btn" data-side-later="*" aria-expanded="${lo}">Later <span class="n">${later.length}</span><span class="chev">${lo ? '▾' : '▸'}</span></button>`;
    if (lo) html += `<div class="later-chats">${later.map(c => sideChat(c).replace('<span class="lbl">', `<span class="lbl" title="${esc(projOf(c).name || '')}">`) + sideFam(c)).join('')}</div>`;
  }
  if (quiet.length) html += S.more.quietProj ? `<div class="side-bucket">Quiet</div>${quiet.map(g => `<button class="nav-i chat-i" draggable="true" data-project="${esc(g.p.key)}"><span class="lbl">${esc(g.p.name)}</span></button>`).join('')}<button class="nav-i chat-i quiet-toggle" data-quietproj="1"><span class="lbl">Hide quiet</span></button>` : `<button class="nav-i quiet-toggle" data-quietproj="1"><span class="lbl">${quiet.length} quiet project${quiet.length === 1 ? '' : 's'}</span></button>`;
  return html || '<p class="side-empty">No chats here yet.</p>';
}
// In a project without status labels (and for Focus chats), each chat carries its status as a small dot.
function sideChatDot(c) {
  if (c.focus) return sideChat(c);
  const st = statusById(statusOf(c));
  return sideChat(c).replace('<span class="lbl">', `<span class="st-dot" style="background:${st.c}" title="${st.name}"></span><span class="lbl">`);
}

const VIEW_FN = { triage: () => triageView(), now: () => now(), tokens: () => tokensView(), home: () => home(), hack: () => hackView(), bugs: () => bugsView(), automation: () => automationView(), routines: () => routinesView(), routine: () => routineEditorView(), recent: () => listView('recent'), search: () => listView('search'), project: () => project(), archived: () => archivedView(), cleanup: () => cleanupView(), images: () => imagesView(), alerts: () => alertsView() };
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
  keepFocused(m, () => { m.innerHTML = (VIEW_FN[S.view] || VIEW_FN.now)(); });
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
  if (document.hidden) { updateBadge(); return; }   // nothing to draw in a tab you can't see
  renderSide(); updateBadge();
  if (S.view === 'chat' && CV.readOnly !== externalChatNotice()) paintBar();
  if (S.view === 'triage') { if (!document.activeElement || document.activeElement.id !== 'trBox') render(); return; }
  if (S.view === 'now' && $('nowLive')) {
    $('nowLead').innerHTML = leadHtml();
    swapHtml($('nowLive'), nowLiveHtml(), (el, html) => {
      const typed = [...el.querySelectorAll('[data-qr]')].map(i => [i.dataset.qr, i.value, document.activeElement === i]).filter(x => x[1] || x[2]);
      keepFocused(el, () => { el.innerHTML = html; });
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
  // The chat's bar too: the To chip shows once both kinds of plan are known.
  else if (S.view === 'chat' && typeof paintBar === 'function') paintBar();
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
    // The chat is set up first (from memory if you were in it lately), then drawn, so it shows at once.
    else if (view === 'chat') { $('main').innerHTML = ''; openChatView(extra.chat, { key: extra.chatKey || null, provider: extra.provider || null }); render(); }
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
  if ((b = el('[data-side-later]'))) { const k = b.dataset.sideLater === '*' ? 'side-later' : 'pl:' + b.dataset.sideLater; S.more[k] = !S.more[k]; return renderSide(); }
  if ((b = el('[data-steerq]'))) { steerQueued(Number(b.dataset.steerq)); return undefined; }
  if ((b = el('[data-delivery]'))) return deliveryMenu(b);
  if ((b = el('[data-qedit-start]'))) return editQueued(Number(b.dataset.qeditStart), 'start');
  if ((b = el('[data-qsave]'))) return editQueued(Number(b.dataset.qsave), 'save');
  if ((b = el('[data-qcancel]'))) return editQueued(Number(b.dataset.qcancel), 'cancel');
  if ((b = el('[data-unqueue]'))) { const i = Number(b.dataset.unqueue); if (!CV.queue[i]?.sending) CV.queue.splice(i, 1); paintQueue(); return undefined; }
  if ((b = el('[data-rtnew]'))) return newRoutine(b.dataset.rtnew);
  if ((b = el('[data-rtmenu]'))) { e.stopPropagation(); return routineMenu(b, b.dataset.rtmenu); }
  if ((b = el('[data-inrepo]'))) { CV.inRepo = true; COMP.perm = CV.provider === 'codex' ? 'read-only' : 'plan'; const g = $('folderGone'); if (g) g.outerHTML = folderNotice(); if (typeof paintBar === 'function') paintBar(); $('msgBox')?.focus(); return undefined; }
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
  if ((b = el('[data-zoom]'))) return showPicture(b.src, picsNear(b));
  if ((b = el('[data-stopchat]'))) { sfx('close'); return wrap(() => api('/api/chat/interrupt', { key: replyTarget().key || CV.key }))(); }
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
  if ((b = el('[data-foldproj]'))) { const k = 'p:' + b.dataset.foldproj; if (S.folded[k] === false) delete S.folded[k]; else S.folded[k] = false; local.set('folded', S.folded); return renderSide(); }
  if ((b = el('[data-more-proj]'))) { const k = 'pall:' + b.dataset.moreProj; S.more[k] = !S.more[k]; return renderSide(); }
  if ((b = el('[data-side-quiet]'))) { const k = 'pq:' + b.dataset.sideQuiet; S.more[k] = !S.more[k]; return renderSide(); }
  if ((b = el('[data-quietproj]'))) { S.more.quietProj = !S.more.quietProj; return renderSide(); }
  if ((b = el('[data-fold]'))) { S.folded[b.dataset.fold] = b.getAttribute('aria-expanded') === 'true'; local.set('folded', S.folded); return renderSide(); }
  if ((b = el('[data-more-st]'))) { S.more[b.dataset.moreSt] = !S.more[b.dataset.moreSt]; return renderSide(); }
  if ((b = el('[data-automore]'))) { S.more['auto-all'] = true; return render(); }
  if ((b = el('[data-more-all]'))) { S.more['all-' + b.dataset.moreAll] = true; return renderSide(); }
  if ((b = el('[data-pfold]'))) { const k = 'p-' + b.dataset.pfold; S.more[k] = !S.more[k]; return render(); }
  if ((b = el('[data-bfold]'))) { S.more['b-done'] = !S.more['b-done']; return render(); }
  if ((b = el('[data-pq]'))) { S.more['pq-' + b.dataset.pq] = !S.more['pq-' + b.dataset.pq]; return render(); }
  if ((b = el('#lookBtn'))) return lookMenu(b);
  if ((b = el('#muteBtn'))) return toggleSound();
  if ((b = el('[data-open]'))) { if (el('input') || el('a[href]') || (el('button') && !el('button').dataset.open)) return undefined; return b.dataset.open ? openChat(b.dataset.open) : toast('That chat hasn’t started yet.'); }
  if ((b = el('[data-project]'))) return b.dataset.mainChat ? openChat(b.dataset.mainChat) : go('project', { project: b.dataset.project });
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
  if (e.target.id === 'composer') { e.preventDefault(); return S.view === 'newchat' ? startNewChat() : sendInChat({ delivery: followUpDelivery() }); }
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
  // On a phone, Return is a new line in a message box (the ↑ button sends); with a keyboard, Enter sends.
  if (e.key === 'Enter' && TOUCH() && !e.metaKey && !e.ctrlKey && e.target.tagName === 'TEXTAREA') return;
  if (e.target.id === 'msgBox' && e.key === 'Enter' && !e.isComposing) {
    if (e.altKey || e.repeat) return;
    const explicit = e.metaKey || e.ctrlKey;
    if (e.shiftKey && !explicit) return;
    e.preventDefault();
    if (explicit && S.view === 'chat') sendInChat({ delivery: e.shiftKey ? 'queue' : 'steer' });
    else $('composer').requestSubmit();
    return;
  }
  if (e.target.id === 'trBox' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); triageReply(); return; }
  if (e.target.id === 'msgBox' && e.key.toLowerCase() === 'p' && (e.metaKey || e.ctrlKey) && S.view === 'newchat') { e.preventDefault(); document.querySelector('[data-ncproject]')?.click(); return; }
  if (e.target.dataset && e.target.dataset.qr && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendQuick(e.target.dataset.qr); }
}, true);
document.addEventListener('input', e => {
  if (e.target.id === 'msgBox') autosize(e.target);
  if (e.target.dataset.qedit !== undefined) { const q = CV.queue[Number(e.target.dataset.qedit)]; if (q) { q.editText = e.target.value; saveQueues(); } }
});
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
// The pictures beside the one you clicked (the whole conversation in a chat, else the panel or
// page it's in), in order, so the big view can step through them.
function picsNear(img) {
  const scope = img.closest('#feed, #viewer, .modal, #main') || document;
  return [...new Set([...scope.querySelectorAll('img[data-zoom]')].map(x => x.src).filter(Boolean))];
}
// A picture, big. With others beside it: ‹ › (or ← →, or a swipe on the phone) step through them.
function showPicture(src, list = []) {
  const pics = list.length ? list : [src];
  let i = Math.max(0, pics.indexOf(src));
  const root = $('modalRoot');
  const paint = () => {
    const many = pics.length > 1;
    root.innerHTML = `<div class="modal-back lightbox" data-piclight="1">${many ? `<button class="lb-nav prev" data-pic="-1" aria-label="Previous picture (←)" ${i > 0 ? '' : 'disabled'}>‹</button>` : ''}`
      + `<figure><img src="${esc(pics[i])}" alt="">${many ? `<figcaption>${i + 1} of ${pics.length}</figcaption>` : ''}</figure>`
      + `${many ? `<button class="lb-nav next" data-pic="1" aria-label="Next picture (→)" ${i < pics.length - 1 ? '' : 'disabled'}>›</button>` : ''}</div>`;
    const back = root.querySelector('.modal-back'), img = back.querySelector('figure img');
    // Zoom: pinch (and drag while zoomed), double-tap or double-click, or a trackpad pinch. Lite's
    // phone page doesn't zoom as a whole, so the picture zooms itself.
    let z = { s: 1, x: 0, y: 0 }, g = null, lastTap = 0;
    const show = (anim = false) => { img.style.transition = anim ? 'transform .2s ease' : 'none'; img.style.transform = z.s === 1 ? '' : `translate(${z.x}px, ${z.y}px) scale(${z.s})`; back.classList.toggle('zoomed', z.s > 1); };
    const centre = () => { const r = img.getBoundingClientRect(); return { cx: r.left + r.width / 2 - z.x, cy: r.top + r.height / 2 - z.y }; };
    // Zooms to s with the point (px, py) on screen staying where it is.
    const zoomAt = (s, px, py, anim) => {
      s = Math.min(5, Math.max(1, s));
      const { cx, cy } = centre();
      z.x = px - cx - (s / z.s) * (px - cx - z.x); z.y = py - cy - (s / z.s) * (py - cy - z.y); z.s = s;
      if (s === 1) z = { s: 1, x: 0, y: 0 };
      show(anim);
    };
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = t => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    back.addEventListener('click', e => {
      const nav = e.target.closest('[data-pic]');
      if (nav) { e.stopPropagation(); step(Number(nav.dataset.pic)); return; }
      if (e.target === img || (g && g.moved)) return;   // the picture itself (or the end of a drag) doesn't close it
      close();
    });
    back.addEventListener('dblclick', e => { if (e.target !== img) return; e.preventDefault(); zoomAt(z.s > 1 ? 1 : 2.5, e.clientX, e.clientY, true); });
    back.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); zoomAt(z.s * Math.exp(-e.deltaY / 100), e.clientX, e.clientY, false); }, { passive: false });
    back.addEventListener('touchstart', e => {
      const t = e.touches;
      if (t.length === 2) { const m = mid(t); g = { kind: 'pinch', d: dist(t), s: z.s, mx: m.x, my: m.y, moved: true }; }
      else if (t.length === 1) g = { kind: z.s > 1 ? 'pan' : 'swipe', x0: t[0].clientX, y0: t[0].clientY, zx: z.x, zy: z.y, moved: false };
    }, { passive: true });
    back.addEventListener('touchmove', e => {
      if (!g) return;
      const t = e.touches;
      if (g.kind === 'pinch' && t.length === 2) {
        e.preventDefault();
        // Each step: zoom by how much the fingers spread, around where they are, then follow them.
        const m = mid(t), d = dist(t);
        zoomAt(z.s * d / g.d, m.x, m.y, false);
        if (z.s > 1) { z.x += m.x - g.mx; z.y += m.y - g.my; }
        g.mx = m.x; g.my = m.y; g.d = d;
        show();
      } else if (g.kind === 'pan' && t.length === 1) {
        e.preventDefault();
        const dx = t[0].clientX - g.x0, dy = t[0].clientY - g.y0;
        if (Math.abs(dx) + Math.abs(dy) > 6) g.moved = true;
        z.x = g.zx + dx; z.y = g.zy + dy; show();
      } else if (g.kind === 'swipe' && t.length === 1 && Math.abs(t[0].clientX - g.x0) > 6) g.moved = true;
    }, { passive: false });
    back.addEventListener('touchend', e => {
      if (!g) return;
      const was = g; if (e.touches.length) return;
      setTimeout(() => { g = null; }, 0);
      if (was.kind === 'pinch' && z.s < 1.05) { z = { s: 1, x: 0, y: 0 }; show(true); }
      if (was.kind === 'swipe') {
        const p = e.changedTouches[0], dx = p.clientX - was.x0;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(p.clientY - was.y0)) { e.preventDefault(); step(dx < 0 ? 1 : -1); return; }
        // A double-tap on the picture zooms in there (or back out).
        if (!was.moved && e.target === img) {
          const now = Date.now();
          if (now - lastTap < 300) { e.preventDefault(); lastTap = 0; zoomAt(z.s > 1 ? 1 : 2.5, p.clientX, p.clientY, true); } else lastTap = now;
        }
      } else if (was.kind === 'pan' && !was.moved && e.target === img) {
        const now = Date.now(), p = e.changedTouches[0];
        if (now - lastTap < 300) { e.preventDefault(); lastTap = 0; zoomAt(1, p.clientX, p.clientY, true); } else lastTap = now;
      }
    });
  };
  const step = d => { const j = i + d; if (j < 0 || j >= pics.length) return; i = j; paint(); };
  const onKey = e => {
    if (!root.querySelector('[data-piclight]')) return removeEventListener('keydown', onKey, true);
    if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); step(-1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  const close = () => { root.innerHTML = ''; removeEventListener('keydown', onKey, true); };
  if (showPicture.off) showPicture.off();
  showPicture.off = () => removeEventListener('keydown', onKey, true);
  addEventListener('keydown', onKey, true);
  paint();
}
$('q').addEventListener('input', e => { S.q = e.target.value.trim(); if (small()) { $('sideScroll').scrollTop = 0; return renderSide(); } if (S.q) { if (S.view !== 'search') go('search', {}, { push: false }); else render(); } else if (S.view === 'search') go('now', {}, { push: false }); });
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') { const r = document.querySelector(small() ? '#sideScroll [data-cur]' : '#main [data-cur]'); if (r) { e.preventDefault(); r.click(); } } if (e.key === 'ArrowDown') { e.preventDefault(); e.target.blur(); setCur(0); } });

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
  pop(anchor, `<div class="ph">Skin</div>${[['plain', 'Plain'], ['imperial', 'Imperial'], ['imperial-pro', 'Imperial Pro'], ['rebel', 'Rebel'], ['rebel-pro', 'Rebel Pro']].map(([v, n]) => `<button data-v="skin:${v}" role="menuitemradio" aria-checked="${skin() === v}">${n}</button>`).join('')}
    <hr><div class="ph">Light or dark</div>${[['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, n]) => `<button data-v="mode:${v}" role="menuitemradio" aria-checked="${look.mode === v}">${n}</button>`).join('')}
    <hr><div class="ph">Icon</div><div class="kind-seg">${[['look', 'Match the look'], ...Object.entries(ICONS).map(([k, v]) => [k, v.name])].map(([k, n]) => `<button data-v="icon:${k}" role="menuitemradio" aria-checked="${iconChoice() === k}">${k === 'look' ? '' : `<img src="${iconUrl(k)}" alt="" width="16" height="16" style="border-radius:4px;margin-right:6px;vertical-align:-3px">`}${n}</button>`).join('')}</div>
    <hr><div class="ph">Drain each plan to (then the next takes over)</div><div class="kind-seg">${[10, 15, 20].map(d => `<button data-v="floor:${d}" role="menuitemradio" aria-checked="${floor() === d}">${d}%</button>`).join('')}</div>
    <hr><button data-v="sound" role="menuitemcheckbox" aria-checked="${prefs.sound}">Sounds</button><button data-v="autoweeks" role="menuitemcheckbox" aria-checked="${S.lite.autoStartWeeks === true}">Start idle weeks for me<small>one tiny message</small></button><button data-v="openLite" role="menuitemcheckbox" aria-checked="${!!S.lite.openLite}">Open Lite when the app starts</button><button data-v="alerts">Alerts…</button><button data-v="keys">Keyboard shortcuts<kbd>?</kbd></button>`,
  v => {
    if (v === 'sound') return setSound(!prefs.sound);
    if (v === 'autoweeks') return wrap(setLook)({ autoStartWeeks: S.lite.autoStartWeeks !== true }).then(() => toast(S.lite.autoStartWeeks === true ? 'A plan whose week hasn’t started gets one tiny message to start it.' : 'Idle weeks are left alone.'));
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
// Save the whole destination bucket, including projects outside the current sidebar view.
async function placeProject(key, targetKey, after = false) {
  const target = projBy.get(targetKey), moving = projBy.get(key);
  if (!target || !moving || key === targetKey || target.archived || moving.archived) return;
  const keys = projectsIn().map(p => p.key).filter(k => k !== key);
  keys.splice(keys.indexOf(targetKey) + Number(after), 0, key);
  for (const [i, k] of keys.entries()) await api('/api/lite/project', { key: k, patch: { order: i + 1 } });
  sfx('card'); await loadState(); render();
}
const projectDropTarget = t => {
  const p = t.closest('[data-project]') || t.closest('.proj-row')?.querySelector('[data-project]');
  return p && p.dataset.project !== drag.project && !projBy.get(p.dataset.project)?.archived ? p : null;
};
const dropZone = t => (!t.closest ? null : drag && drag.idea ? t.closest('[data-drop-stage], [data-idea-drop]') : drag && drag.chats ? projectDropTarget(t) || nestTarget(t) || t.closest('[data-drop-stage], [data-drop-focus], [data-drop-quick]') : drag && drag.project ? projectDropTarget(t) || t.closest('[data-drop-bucket]') : null);
const projectDropAfter = (e, z) => { const r = z.getBoundingClientRect(); return e.clientY > r.top + r.height / 2; };
const clearDrop = () => document.querySelectorAll('.drop-hot').forEach(x => x.classList.remove('drop-hot', 'drop-before', 'drop-after'));
document.addEventListener('dragover', e => {
  const z = dropZone(e.target); if (!z) return;
  e.preventDefault();
  clearDrop();
  z.classList.add('drop-hot');
  if (drag.project && z.dataset.project) z.classList.add(projectDropAfter(e, z) ? 'drop-after' : 'drop-before');
});
document.addEventListener('dragleave', e => { const z = dropZone(e.target); if (z && !z.contains(e.relatedTarget)) z.classList.remove('drop-hot', 'drop-before', 'drop-after'); });
document.addEventListener('drop', e => {
  const z = dropZone(e.target);
  clearDrop();
  if (!z) return;
  e.preventDefault();
  const d = drag; drag = null;
  if (d.idea) { if (z.dataset.ideaDrop) { const over = e.target.closest('[data-idea]'); wrap(moveIdea)(d.idea, over && over.dataset.idea !== d.idea ? over.dataset.idea : null); } else wrap(startIdea)(d.idea); }
  else if (d.chats && z.dataset.project) wrap(async () => { await setChats(d.chats, z.dataset.project === '~quick' ? { quick: true } : { project: z.dataset.project, quick: false }, `Moved to ${projBy.get(z.dataset.project)?.name || 'project'}`); await loadState(); render(); })();
  else if (d.chats && z.dataset.chat) wrap(nestChats)(d.chats, z.dataset.chat);
  else if (d.chats) wrap(setChats)(d.chats, z.dataset.dropFocus ? { focus: true } : z.dataset.dropQuick ? { quick: true, waiting: false } : z.dataset.dropStage === 'waiting' ? { waiting: true } : { status: z.dataset.dropStage, waiting: false, quick: false }).then(() => loadState()).then(render);
  else if (z.dataset.project) { if (z.dataset.project !== d.project) wrap(placeProject)(d.project, z.dataset.project, projectDropAfter(e, z)); }
  else wrap(setBucket)(d.project, z.dataset.dropBucket || null);
});
document.addEventListener('dragend', () => { drag = null; clearDrop(); });
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
  let frame = 0, fitSig = '';
  const fit = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const f = $('feed'), pinned = f && f.scrollHeight - f.scrollTop - f.clientHeight < 80;
      const r = document.documentElement.style;
      const k = Math.round(innerHeight - visualViewport.height);
      const up = k > 150;
      // iOS sends these while you type too. With nothing changed, nothing moves.
      const sig = `${k}:${Math.round(visualViewport.height)}:${Math.round(visualViewport.offsetTop)}:${scrollY}`;
      if (sig === fitSig) return;
      const sized = sig.split(':')[1] !== fitSig.split(':')[1];
      fitSig = sig;
      if (up) { kbH = k; try { localStorage.setItem('lite.kb', String(k)); } catch { /* fine */ } }
      document.documentElement.classList.toggle('kb-up', up);
      // With the keyboard away, iOS can leave the page scrolled by the keyboard's push (40-60px, the
      // bottom of the app cut off until a restart). Scrolled back here, and the pane sits at the top.
      if (!up && (visualViewport.offsetTop > 0 || scrollY > 0 || pageYOffset > 0)) { try { scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0; } catch { /* fine */ } }
      r.setProperty('--app-h', `${Math.round(visualViewport.height)}px`);
      r.setProperty('--vv-top', `${up ? Math.round(visualViewport.offsetTop) : 0}px`);
      if (pinned && sized) f.scrollTop = f.scrollHeight;
    });
  };
  // iOS says how tall the keyboard is only once it has finished sliding, so the page would snap after
  // it. Lite remembers the height and slides the page with the keyboard; the real size then settles it.
  let kbH = 0; try { kbH = Number(localStorage.getItem('lite.kb')) || 0; } catch { /* fine */ }
  const TYPE = 'textarea, input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range])';
  let glideT = 0;
  const glide = h => {
    const root = document.documentElement;
    fitSig = '';   // the next real measurement always applies
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
  // Back to the app (from the Home Screen, another app, or a lock): the keyboard is gone whatever the
  // page last saw, so the layout is measured again rather than kept from before.
  const back = () => { if (document.hidden) return; const a = document.activeElement; if (!(a && a.matches && a.matches(TYPE))) document.documentElement.classList.remove('kb-up', 'kb-glide'); fit(); setTimeout(fit, 350); };
  document.addEventListener('visibilitychange', back);
  addEventListener('pageshow', back);
  addEventListener('orientationchange', () => setTimeout(fit, 300));
}

// Quick-reply boxes grow as you type.
document.addEventListener('input', e => { if (e.target.matches && e.target.matches('textarea[data-qr]')) autosize(e.target); });
