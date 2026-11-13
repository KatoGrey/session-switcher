'use strict';
/* Your work: one page to work from. Your Linear issues (assigned to you, by the Linear person you are) and your pull
   requests on GitHub (yours, the ones linked to your issues whoever made them, and the ones waiting on your review),
   in columns from To do to merged, each with what's next and the button for it: start an issue in a chat, fix a
   PR's comments or checks, mark it ready, ask for reviewers or a preview, merge it. The chats follow the repo's own
   PR workflow. (lib/linear.js, lib/prs.js; server.js workBoard.) */

const Work = (() => {
  const W = { data: null, loading: false, err: null, at: 0, open: null, team: null, usersQ: '', users: null, query: '', filter: 'all', repo: 'all', layout: 'list', details: new Map(), external: new Map(), files: new Map(), detailTab: 'overview', wide: true, trail: [] };
  // Runs with: the model and effort each assistant uses for the chats started here (empty: its own default).
  W.run = { claude: { model: '', effort: '' }, codex: { model: '', effort: '' }, gemini: { model: '', effort: '' } }; W.models = null; W.modelsLoading = false;
  W.setup = null; W.setupLoading = false; W.setupOpen = false;
  try { const r = JSON.parse(localStorage.getItem('work-run') || 'null'); if (r) for (const p of ['claude', 'codex', 'gemini']) if (r[p]) W.run[p] = { model: String(r[p].model || ''), effort: String(r[p].effort || '') }; } catch { /* the defaults */ }
  try { W.layout = localStorage.getItem('work-layout') === 'board' ? 'board' : 'list'; W.repo = localStorage.getItem('work-repo') || 'all'; W.wide = localStorage.getItem('work-detail-width') !== 'narrow'; } catch {}

  const kOf = p => `${String(p.repo).toLowerCase()}#${p.number}`;
  const page = () => $('page');
  const showing = () => S.view === 'work' && !(window.ChatUI && ChatUI.isOpen());

  async function load(fresh = false) {
    if (W.loading) return;
    W.loading = true; if (showing()) render();
    try { W.data = await api(`/api/work${fresh ? '?fresh=1' : ''}`); W.err = null;
      if (fresh) { const selected = W.open && item(W.open); W.details.clear(); W.files.clear(); if (selected) W.details.set(W.open, selected); }
      W.at = Date.now(); } catch (err) { W.err = err.message; }
    W.loading = false;
    if (showing()) { render(); if (W.open) detailLoad(W.open); }
    if (typeof renderNav === 'function') renderNav();
  }
  // Kept current while you're looking at it.
  setInterval(() => { if (showing() && document.visibilityState === 'visible' && !document.activeElement?.closest('#page input, #page textarea, #page select') && Date.now() - W.at > 120000) load(false); }, 30000);

  /* ---------- the page ---------- */

  function setupHtml(d) {
    const lin = d.linear || {};
    const out = [];
    if (!d.gh.signedIn) out.push(`<div class="wk-setup"><p><b>GitHub isn’t signed in${d.gh.installed === false ? ' (gh isn’t installed)' : ''}.</b> Sign in to see your pull requests here.</p><button type="button" class="btn sm gilt" data-wk="connections">Open Connections</button></div>`);
    if (!lin.connected) {
      out.push(`<div class="wk-setup"><p><b>Linear isn’t connected${lin.error ? `: ${esc(lin.error)}` : ''}.</b> Paste a Linear API key of your own (Linear → Settings → Security &amp; access → Personal API keys) to see the issues assigned to you.</p>
        <div class="mcp-paste-row"><input type="password" id="wkKey" placeholder="lin_api_…" autocomplete="off" aria-label="Your Linear API key"><button type="button" class="btn sm" data-wk="savekey">Save</button></div></div>`);
    } else if (!lin.me) {
      out.push(`<div class="wk-setup"><p><b>Which Linear person are you?</b> Linear is connected through ${lin.source === 'repo' ? 'the agents’ key in Latitude’s repo' : 'a shared key'} (${esc(lin.keyOwner || 'shared')}), so it doesn’t know. Type your name:</p>
        <div class="mcp-paste-row"><input type="search" id="wkWho" placeholder="Your name in Linear" autocomplete="off" aria-label="Your name in Linear" value="${esc(W.usersQ)}"><button type="button" class="btn sm" data-wk="who">Find</button></div>
        ${W.users ? (W.users.length ? `<div class="wk-users">${W.users.map(u => `<button type="button" class="btn sm" data-wk="me" data-id="${esc(u.id)}">${esc(u.name)} <small>${esc(u.displayName)}</small></button>`).join('')}</div>` : '<p class="rd-note">Nobody by that name.</p>') : ''}</div>`);
    }
    return out.join('');
  }
  const icon = (kind, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({ pr: '<circle cx="5" cy="4" r="2"/><circle cx="5" cy="16" r="2"/><circle cx="15" cy="16" r="2"/><path d="M5 6v8m10 0V8a4 4 0 0 0-4-4h-1m2-2-2 2 2 2"/>', issue: '<circle cx="10" cy="10" r="7" stroke-dasharray="3 3"/>', done: '<circle cx="10" cy="10" r="7"/><path d="m6 10 3 3 5-6"/>', search: '<circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/>', list: '<path d="M7 5h10M7 10h10M7 15h10M3 5h.1M3 10h.1M3 15h.1"/>', board: '<rect x="2" y="3" width="6" height="14" rx="1.5"/><rect x="12" y="3" width="6" height="10" rx="1.5"/>' })[kind] || ''}</svg>`;
  const rowKey = x => x.identifier || kOf(x);
  const match = x => !W.query.trim() || W.query.toLowerCase().trim().split(/\s+/).every(q => `${x.title} ${x.identifier || ''} ${x.number ? '#' + x.number : ''} ${x.repo || ''} ${x.issue || ''} ${x.author || ''} ${x.priorityLabel || ''} ${x.state?.name || ''}`.toLowerCase().includes(q));
  const scoped = () => W.repo === 'all' ? W.data || {} : { ...W.data, prs: (W.data?.prs || []).filter(p => p.repo.toLowerCase() === W.repo), issues: W.repo === 'latitudegames/latitude' ? W.data?.issues || [] : [] };
  const item = key => (W.data?.issues || []).find(i => i.identifier === key) || (W.data?.prs || []).find(p => kOf(p) === key) || W.external.get(key) || W.details.get(key);
  function row(x) {
    const issue = !!x.identifier, key = rowKey(x), selected = key === W.open;
    const s = issue ? { label: x.state?.name || 'To do', tone: x.priority === 1 ? 'warn' : 'muted' } : WorkModel.status(x);
    return `<button type="button" class="wk-row${selected ? ' selected' : ''}" data-wk="select" data-key="${esc(key)}" aria-expanded="${selected}" aria-controls="wkInspector">
      <span class="wk-row-icon ${s.tone}">${icon(issue ? 'issue' : x.state === 'MERGED' ? 'done' : 'pr')}</span>
      <span class="wk-row-main"><span class="wk-row-title">${esc(x.title)}</span><span class="wk-row-meta"><b>${esc(issue ? x.identifier : '#' + x.number)}</b>${x.issue ? ` <span>${esc(x.issue)}</span>` : ''}<span title="${esc(issue ? x.team?.name || 'Linear' : x.repo)}">${esc(issue ? x.team?.name || 'Linear' : x.repo.split('/').pop())}</span>${!issue && x.author ? `<span>${esc(x.author)}</span>` : ''}</span></span>
      <span class="wk-status ${s.tone}"><i aria-hidden="true"></i>${esc(s.label)}</span><span class="wk-row-time">${esc(agoL(Date.parse(x.updatedAt || x.mergedAt) || W.at))}</span><span class="wk-row-arrow" aria-hidden="true">›</span></button>`;
  }
  function filteredGroups() {
    const g = WorkModel.group(scoped());
    const groups = W.filter === 'attention' ? [['attention', 'Needs your attention', g.attention]] : W.filter === 'merged' ? [['merged', 'Merged this week', g.merged]] : [
      ['review', 'In review', g.review], ['waiting', 'Waiting on you', g.waiting], ['doing', 'In progress', g.doing], ['todo', 'To do', g.todo],
    ].filter(([id]) => W.filter === 'prs' ? ['review', 'waiting'].includes(id) : W.filter === 'issues' ? ['doing', 'todo'].includes(id) : true);
    return groups.map(([id, title, xs]) => [id, title, xs.filter(match)]);
  }
  function resultsHtml() {
    const groups = filteredGroups(), total = groups.reduce((n, g) => n + g[2].length, 0);
    if (!total) return `<div class="wk-no-results">${icon('done', 30)}<h3>${W.query ? 'No matches' : W.filter === 'attention' ? 'You’re all caught up' : 'Nothing here yet'}</h3><p>${W.query ? 'Try a title, PR number, person, or Linear ID.' : W.filter === 'attention' ? 'No pull requests currently need your action.' : 'Your assigned issues and pull requests appear here.'}</p>${W.query || W.filter !== 'all' ? '<button class="btn" data-wk="reset">Show all work</button>' : ''}</div>`;
    return `<div class="wk-results-heading"><span role="status">${W.query ? 'Search results' : 'Work queue'}<b>${total}</b></span><span class="wk-list-hint">↑ ↓ to move · Enter to open</span></div><div class="wk-results ${W.layout === 'board' ? 'as-board' : ''}">${groups.filter(g => g[2].length || W.layout === 'board').map(([id, title, xs]) => `<section class="wk-group" data-group="${id}"><h2><span class="wk-group-dot" data-kind="${id}"></span>${title}<span>${xs.length}</span></h2>${xs.length ? xs.map(row).join('') : '<p class="wk-empty">All clear.</p>'}</section>`).join('')}</div>`;
  }
  const queue = () => filteredGroups().flatMap(g => g[2]);
  function focusSelector(el) {
    if (el?.id) return '#' + CSS.escape(el.id);
    if (el?.dataset.wkm) return `[data-wkm="${CSS.escape(el.dataset.wkm)}"]`;
    if (!el?.dataset.wk) return null;
    return `[data-wk="${CSS.escape(el.dataset.wk)}"]` + ['value', 'key', 'path'].filter(k => el.dataset[k]).map(k => `[data-${k}="${CSS.escape(el.dataset[k])}"]`).join('');
  }
  function renderResults() {
    const box = $('wkResults'), target = box?.contains(document.activeElement) && focusSelector(document.activeElement);
    if (box) { box.innerHTML = resultsHtml(); if (target) box.querySelector(target)?.focus({ preventScroll: true }); }
    renderInspector();
  }
  function rememberInspector() {
    const panel = $('wkInspector');
    if (!panel || panel.dataset.key !== W.open) return null;
    const patch = panel.querySelector('.wk-patch');
    return { key: W.open, scroll: panel.scrollTop, tree: panel.querySelector('.wk-file-tree')?.scrollTop || 0,
      expanded: [...panel.querySelectorAll('details[data-preserve][open]')].map(el => el.dataset.preserve),
      patch: patch && { label: patch.getAttribute('aria-label'), top: patch.scrollTop, left: patch.scrollLeft } };
  }
  function restoreInspector(saved) {
    const panel = $('wkInspector'); if (!saved || !panel || saved.key !== W.open) return;
    for (const el of panel.querySelectorAll('details[data-preserve]')) el.open = saved.expanded.includes(el.dataset.preserve);
    const tree = panel.querySelector('.wk-file-tree'), patch = panel.querySelector('.wk-patch');
    if (tree) tree.scrollTop = saved.tree;
    if (patch && patch.getAttribute('aria-label') === saved.patch?.label) { patch.scrollTop = saved.patch.top; patch.scrollLeft = saved.patch.left; }
    panel.scrollTop = saved.scroll;
    panel.classList.toggle('scrolled', panel.scrollTop > 90);
  }
  function renderInspector() {
    const panel = $('wkInspector'); if (!panel) return;
    const focused = panel.contains(document.activeElement) ? document.activeElement : null;
    const target = focusSelector(focused), saved = rememberInspector();
    panel.innerHTML = inspectorHtml();
    restoreInspector(saved);
    if (target) panel.querySelector(target)?.focus({ preventScroll: true });
  }
  function render() {
    const focused = document.activeElement, focusTarget = page().contains(focused) ? focusSelector(focused) : null;
    const inspector = rememberInspector();
    const caret = focused?.selectionStart;
    const pg = page(); pg.dataset.page = 'work'; delete pg.dataset.worldPage;
    const d = W.data, g = WorkModel.group(scoped()), lin = d?.linear, gh = d?.gh;
    const name = lin?.me?.displayName || lin?.me?.name;
    const total = (scoped().prs || []).filter(p => p.state === 'OPEN').length;
    pg.innerHTML = `<div class="wk-workspace">
      <header class="wk-header"><div><p class="wk-eyebrow"><span class="wk-emblem" aria-hidden="true">↗</span> WORKSPACE</p><h1>Your work</h1><p class="wk-subtitle">Issues, pull requests, and the next step.</p></div><div class="wk-header-actions"><button class="btn quiet" data-wk="refresh" ${W.loading ? 'disabled' : ''}>${W.loading ? 'Refreshing…' : '↻ Refresh'}</button><button class="btn" data-wk="open-pr">Open a PR</button><button class="btn prime" data-wk="cross-review">Cross-model review <span aria-hidden="true">↗</span></button></div></header>
      <div class="wk-identities"><span class="wk-identity"><i class="${lin?.me ? 'connected' : ''}"></i>Linear <b>${esc(name || 'Not connected')}</b></span><span class="wk-identity"><i class="${gh?.signedIn ? 'connected' : ''}"></i>GitHub <b>${esc(gh?.login || 'Not connected')}</b></span><button class="wk-manage" data-wk="connections">Manage connections ↗</button><span class="wk-updated">${W.at ? 'Updated ' + esc(agoL(W.at)) : 'Connecting…'}</span></div>
      ${runRow()}
      ${setupRow()}
      ${d ? setupHtml(d) : ''}
      ${[W.err, d?.issuesError && 'Linear: ' + d.issuesError, d?.prsError && 'GitHub: ' + d.prsError].filter(Boolean).map(e => `<p class="wk-error" role="alert">${esc(e)} <button class="linkish" data-wk="refresh">Try again</button></p>`).join('')}
      ${d ? `<div class="wk-overview" aria-label="Work overview">
        <button class="wk-metric focus" data-wk="filter" data-value="attention" aria-pressed="${W.filter === 'attention'}"><span>Needs you</span><strong>${g.attention.length.toString().padStart(2, '0')}</strong><small>${g.attention.length ? 'Review, fix, or merge' : 'All caught up'}</small></button>
        <button class="wk-metric" data-wk="filter" data-value="prs" aria-pressed="${W.filter === 'prs'}"><span>Open PRs</span><strong>${total.toString().padStart(2, '0')}</strong><small>Yours · linked · to review</small></button>
        <button class="wk-metric" data-wk="filter" data-value="issues" aria-pressed="${W.filter === 'issues'}"><span>Your issues</span><strong>${(g.todo.length + g.doing.length).toString().padStart(2, '0')}</strong><small>${g.doing.length} in progress · ${g.todo.length} to do</small></button>
        <button class="wk-metric" data-wk="filter" data-value="merged" aria-pressed="${W.filter === 'merged'}"><span>Merged</span><strong>${g.merged.length.toString().padStart(2, '0')}</strong><small>This week</small></button>
      </div>
      <div class="wk-toolbar"><div class="wk-filters" aria-label="Filter work">${[['all', 'All work'], ['attention', 'Needs you'], ['prs', 'Pull requests'], ['issues', 'Issues'], ['merged', 'Merged']].map(([v, t]) => `<button data-wk="filter" data-value="${v}" aria-pressed="${W.filter === v}">${t}</button>`).join('')}</div><div class="wk-tools"><select id="wkRepo" aria-label="Repository"><option value="all">All repositories</option>${[...new Set([...(d.issues?.length ? ['latitudegames/latitude'] : []), ...(d.prs || []).map(p => p.repo.toLowerCase())])].sort().map(r => `<option value="${esc(r)}"${W.repo === r ? ' selected' : ''}>${esc(r.split('/')[1])}</option>`).join('')}</select><label class="wk-search">${icon('search', 15)}<input type="search" id="wkSearch" placeholder="Search work…" aria-label="Search work" value="${esc(W.query)}"><kbd>/</kbd></label><div class="wk-layout" aria-label="View layout">${['list', 'board'].map(v => `<button data-wk="layout" data-value="${v}" aria-pressed="${W.layout === v}" title="${v === 'list' ? 'List' : 'Board'} view" aria-label="${v === 'list' ? 'List' : 'Board'} view">${icon(v, 16)}</button>`).join('')}</div></div></div>
      <div class="wk-content${W.open ? ' has-selection' : ''}${W.open && W.wide ? ' detail-focus' : ''}"><div id="wkResults">${resultsHtml()}</div><aside id="wkInspector" class="wk-inspector" data-key="${esc(W.open || '')}" aria-label="Work details">${inspectorHtml()}</aside></div>
      <footer class="wk-footer"><button class="wk-manage" data-wk="home" aria-pressed="${store('start-page') === 'work'}">${store('start-page') === 'work' ? 'Your start page · Undo' : 'Make this my start page'}</button><span><kbd>/</kbd> Search work <span class="wk-foot-sep">·</span> <kbd>Ctrl K</kbd> All commands</span></footer>` : `<div class="wk-loading" role="status"><span class="gen-spin"></span><h2>${W.err ? 'Couldn’t load your work' : 'Bringing your work together'}</h2><p>${W.err ? 'Try refreshing to reconnect.' : 'Reading your issues and pull requests…'}</p></div>`}
    </div>`;
    const repoSelect = $('wkRepo');
    if (repoSelect && W.repo !== 'all' && ![...repoSelect.options].some(o => o.value === W.repo)) repoSelect.add(new Option(W.repo.split('/').pop(), W.repo, true, true));
    restoreInspector(inspector);
    if (focusTarget) { const el = pg.querySelector(focusTarget); if (el) { el.focus({ preventScroll: true }); if (caret != null) try { el.setSelectionRange(caret, caret); } catch {} } }
    if (!d && !W.loading && !W.err) load(false);
  }
  const count = () => WorkModel.group(W.data || {}).attention.length;
  function inspectorHtml() {
    const x = W.open && item(W.open);
    if (!x) {
      const attention = new Set(WorkModel.group(scoped()).attention.map(rowKey));
      const next = queue().find(i => attention.has(rowKey(i)));
      return `<div class="wk-inspector-top"><span>QUICK START</span>${icon('pr', 16)}</div><div class="wk-inspector-empty">${next ? `<p class="wk-eyebrow">NEEDS YOU</p><h2>${esc(next.title)}</h2><p>#${next.number} · ${esc(WorkModel.status(next).label)}</p><button class="btn prime" data-wk="select" data-key="${esc(rowKey(next))}">Open details <span aria-hidden="true">→</span></button>` : '<h2>Choose your next step</h2><p>Select an issue or PR to read its details and take action here.</p>'}<div class="wk-quick-tools"><h3>TOOLS</h3><button class="wk-tool" data-wk="open-pr"><span>Open a pull request</span><small>Paste any GitHub PR URL</small><span aria-hidden="true">→</span></button><button class="wk-tool" data-wk="cross-review"><span>Cross-model review</span><small>Claude reviews · Codex checks and fixes</small><span aria-hidden="true">→</span></button><button class="wk-tool" data-wk="connections"><span>Connections</span><small>GitHub, Linear, and model sign-ins</small><span aria-hidden="true">→</span></button></div></div>`;
    }
    const items = queue(), index = items.findIndex(i => rowKey(i) === W.open);
    const issue = !!x.identifier, full = W.details.get(W.open), p = full && !full.error ? { ...x, ...full } : x;
    const state = issue ? { label: p.state?.name || 'To do', tone: 'muted' } : WorkModel.status(p);
    const attrs = issue ? `data-id="${esc(p.identifier)}"` : `data-repo="${esc(p.repo)}" data-n="${p.number}"`;
    const button = (a, text, cls = '') => `<button class="btn sm ${cls}" data-wk="${a}" ${attrs}>${text}</button>`;
    const actions = [];
    if (issue) { actions.push(button('plan', 'Plan this issue', 'prime'), button('start', 'Start & draft PR…')); }
    else if (p.state === 'OPEN') {
      const primary = { 'fix-comments': 'Fix the comments…', 'fix-checks': 'Fix the checks…', update: 'Update branch…', ready: 'Ready for review', merge: 'Merge…', review: 'Review…', validate: 'Validate changes…' };
      if (state.action) actions.push(button(state.action, primary[state.action], 'prime'));
      actions.push(button('cross-review', 'Cross-model review ↗'), button('prchat', 'New chat…'), button('more', 'More…'));
    }
    if (p.chat) actions.push(issue ? `<button class="btn quiet sm" data-wk="issuechat" data-key="${esc(p.chat.key || '')}" data-id="${esc(p.chat.sessionId || '')}">Continue its chat ↗</button>` : `<button class="btn quiet sm" data-wk="chat" data-id="${esc(p.chat.sessionId)}">Continue its chat ↗</button>`);
    const body = !issue && W.detailTab === 'threads' ? threadsHtml(p) : !issue && W.detailTab === 'checks' ? WorkDetail.checks(p) : !issue && W.detailTab === 'files' ? WorkDetail.files(p, W.files.get(W.open)) : !issue && W.detailTab === 'record' ? WorkRecord.render(p) : overviewHtml(p, issue, full);
    const tabs = [['overview', 'Overview'], ['threads', 'Feedback' + (p.open ? ' · ' + p.open : '')], ['checks', 'Checks'], ['files', 'Files' + (p.changedFiles != null ? ' · ' + p.changedFiles : '')], ['record', 'Journal']];
    return `<div class="wk-inspector-top"><span class="wk-inspector-context">${W.trail.length ? '<button class="icon" data-wk="back-detail" aria-label="Back to previous item" title="Back to previous item">←</button>' : ''}<span>${esc(issue ? p.identifier : '#' + p.number)}</span><b>${esc(p.title)}</b></span>
      <div class="wk-detail-nav">${index >= 0 ? `<span>${index + 1} / ${items.length}</span><button class="icon" data-wk="previous" aria-label="Previous item" title="Previous item" ${index === 0 ? 'disabled' : ''}>↑</button><button class="icon" data-wk="next" aria-label="Next item" title="Next item" ${index === items.length - 1 ? 'disabled' : ''}>↓</button>` : ''}<button class="icon wk-expand" data-wk="expand-detail" aria-label="${W.wide ? 'Narrow' : 'Expand'} details" title="${W.wide ? 'Narrow' : 'Expand'} details" aria-pressed="${W.wide}">${W.wide ? '⊟' : '⤢'}</button><button class="icon" data-wk="close-detail" aria-label="Close details" title="Close details (Esc)">✕</button></div></div>
      <div class="wk-inspector-body"><span class="wk-status ${state.tone}"><i></i>${esc(state.label)}</span><h2 tabindex="-1" id="wkDetailTitle">${esc(p.title)}</h2><p class="wk-detail-repo">${esc(issue ? p.team?.name || 'Linear' : p.repo)}${!issue && p.author ? ` · ${esc(p.author)}` : ''}</p>
      ${!issue ? `<div class="wk-revision"><button data-wk="copy" data-text="${esc(p.head || '')}" title="Copy branch name">${esc(p.head || 'Branch not reported')}</button><span>→ ${esc(p.base || 'base')}</span>${p.headSha ? `<a href="${esc('https://github.com/' + p.repo + '/commit/' + p.headSha)}" target="_blank" rel="noopener noreferrer" title="Revision being reviewed">${esc(p.headSha.slice(0, 7))}</a>` : ''}<button data-wk="refresh-detail" title="Refresh this PR" aria-label="Refresh this PR">↻</button></div>` : ''}
      <div class="wk-detail-actions">${actions.join('')}</div><div class="wk-detail-links"><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Open in ${issue ? 'Linear' : 'GitHub'} ↗</a><button class="linkish" data-wk="copy" data-text="${esc(p.url)}">Copy link</button>${p.preview ? `<a href="${esc(p.preview)}" target="_blank" rel="noopener noreferrer">Preview ↗</a>` : ''}</div>
      ${issue ? '<p class="wk-action-note">Plan investigates first. Start makes a branch, implements the issue, and opens a draft PR.</p>' : `<div class="wk-detail-tabs" aria-label="PR details">${tabs.map(([v, t]) => `<button data-wk="detail-tab" data-value="${v}" aria-pressed="${W.detailTab === v}">${t}</button>`).join('')}</div>`}
      <div class="wk-tab-body" data-tab="${issue ? 'overview' : W.detailTab}">${full?.error ? `<p class="wk-error" role="alert">${esc(full.error)} <button class="linkish" data-wk="retry-detail">Try again</button></p>` : body}</div></div>`;
  }
  function overviewHtml(p, issue, full) {
    const props = issue ? [['Priority', p.priorityLabel || 'Not set'], ['Team', p.team?.name || '—'], ...(p.project ? [['Project', p.project]] : [])] : [['Reviewers', (p.reviewers || []).join(', ') || 'None requested'], ['Changes', p.changedFiles == null ? '—' : `${p.changedFiles} files · +${p.additions} −${p.deletions}`]];
    if (!issue) {
      const body = p.body || '', long = body.length > 650;
      return `${WorkDetail.route(p)}<div class="wk-brief-grid"><div class="wk-brief-main"><section class="wk-brief-description"><p class="wk-eyebrow">THE CHANGE</p><h3>Review brief</h3>${body ? `<div class="wk-prose wk-brief-excerpt">${esc(long ? body.slice(0, 600).trimEnd() + '…' : body)}</div>${long ? `<details data-preserve="pr-description"><summary>Read the full description</summary><div class="wk-prose">${esc(body)}</div></details>` : ''}` : `<p class="wk-muted">${full ? 'No description added.' : 'Loading the description…'}</p>`}</section>
        <dl class="wk-properties">${props.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${WorkDetail.evidence(p)}
        ${(p.reviews || []).map(r => `<p class="wk-review-line"><b>${esc(r.author)}</b> ${esc({ APPROVED: 'approved', CHANGES_REQUESTED: 'requested changes', COMMENTED: 'commented', DISMISSED: 'review dismissed' }[r.state] || r.state)}</p>`).join('')}</div><div class="wk-brief-aside">${WorkDetail.summary(p, !!full)}</div></div>`;
    }
    return `<div class="wk-detail-section"><h3>Issue</h3>${p.description ? `<div class="wk-prose">${esc(p.description)}</div>` : !full ? '<p class="wk-muted">Loading details…</p>' : '<p class="wk-muted">No description added.</p>'}</div>
      <dl class="wk-properties">${props.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      ${(p.prs || []).length ? `<div class="wk-detail-section"><h3>Linked pull requests</h3>${p.prs.map(l => `<button class="wk-linked" data-wk="linked" data-url="${esc(l.url)}">${icon('pr', 15)} ${esc(l.repo)} #${l.number} →</button>`).join('')}</div>` : ''}${(p.comments || []).map(c => `<article class="wk-thread"><b>${esc(c.by)}</b><p>${esc(c.body)}</p></article>`).join('')}`;
  }
  function threadsHtml(p) {
    if (!p.threads) return '<p class="wk-muted">Loading review threads…</p>';
    const open = p.threads.filter(t => !t.resolved), resolved = p.threads.filter(t => t.resolved);
    const thread = t => `<article class="wk-thread"><p class="wk-thread-path">${esc(t.path || 'General feedback')}${t.line ? ':' + t.line : ''}${t.outdated ? ' · outdated' : ''}</p>${(t.comments || []).map(c => `<div><b>${esc(c.author)}</b><p>${esc(c.body)}</p>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">View thread ↗</a>` : ''}</div>`).join('')}</article>`;
    return `<div class="wk-detail-section"><h3>Open threads · ${open.length}</h3>${p.threadsComplete === false ? `<p class="wk-action-note">This is a partial thread list. <a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Read all feedback on GitHub ↗</a></p>` : ''}${open.length ? open.map(thread).join('') : '<p class="wk-muted">No unresolved review threads in this list.</p>'}${resolved.length ? `<details data-preserve="resolved-threads"><summary>${resolved.length} resolved thread${resolved.length === 1 ? '' : 's'}</summary>${resolved.map(thread).join('')}</details>` : ''}</div>`;
  }
  async function detailLoad(key) {
    const x = item(key); if (!x) return;
    try {
      const d = await api(x.identifier ? `/api/linear/issue?id=${encodeURIComponent(x.identifier)}` : `/api/prs/detail?repo=${encodeURIComponent(x.repo)}&n=${x.number}&fresh=1`);
      if (!x.identifier) d.issue = d.issue || x.issue;
      W.details.set(key, d); Object.assign(x, d);
      if (W.files.has(key) && W.files.get(key).head !== d.headSha) W.files.delete(key);
    }
    catch (e) { W.details.set(key, { error: e.message }); }
    if (showing() && W.open === key) { renderResults(); if (W.detailTab === 'files' && !W.details.get(key)?.error && !W.files.has(key)) filesLoad(key); }
  }
  async function filesLoad(key = W.open) {
    const p = item(key), full = W.details.get(key); if (!p || p.identifier) return;
    if (!full) { await detailLoad(key); return; }
    if (full.error || !full.headSha) { W.files.set(key, { files: [], error: full.error || 'GitHub did not return a revision. Refresh this PR to try again.', stale: true }); renderInspector(); return; }
    let state = W.files.get(key);
    if (state?.loading || (state && !state.error && !state.hasMore)) return;
    if (!state || state.head !== full.headSha) { state = { files: [], head: full.headSha, page: 0, lines: 600, total: p.changedFiles, hasMore: true }; W.files.set(key, state); }
    state.loading = true; state.error = null;
    if (W.open === key) renderInspector();
    try {
      const data = await api(`/api/prs/files?${new URLSearchParams({ repo: p.repo, n: p.number, head: state.head, page: state.page + 1 })}`);
      if (W.files.get(key) !== state) return;
      state.files.push(...data.files); Object.assign(state, { page: data.page, total: data.total, hasMore: data.hasMore, limited: data.limited });
    } catch (e) { state.error = e.message; state.stale = /new commits/.test(e.message); }
    finally { state.loading = false; if (showing() && W.open === key) renderInspector(); }
  }
  async function select(key) {
    W.open = key; W.detailTab = 'overview'; render();
    if (window.innerWidth <= 1100) $('wkInspector')?.scrollIntoView({ block: 'start', behavior: 'instant' });
    else if (W.wide) page().querySelector('.wk-content')?.scrollIntoView({ block: 'start', behavior: 'instant' });
    $('wkDetailTitle')?.focus({ preventScroll: true });
    if (!W.details.has(key)) await detailLoad(key);
  }
  async function openUrl(url) {
    const m = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d{0,8})(?:[/?#].*)?$/i.exec(String(url || '').trim());
    if (!m) { toast('Paste a GitHub pull request URL.'); return; }
    const d = await api(`/api/prs/detail?repo=${encodeURIComponent(m[1])}&n=${m[2]}`);
    if (!W.data) await load();
    const key = kOf(d); W.external.set(key, d); W.details.set(key, d); await select(key);
  }

  /* ---------- this PC's setup (lib/winrepo.js) ---------- */

  function loadSetup(fresh = false) {
    if (W.setupLoading) return;
    W.setupLoading = true;
    api(`/api/work/setup${fresh ? '?fresh=1' : ''}`).then(r => { W.setup = r; }).catch(() => { W.setup = W.setup || { root: null, checks: [] }; })
      .finally(() => { W.setupLoading = false; if (showing()) render(); });
  }
  // Is this PC's Latitude clone set up the way Latitude's guide asks? A line when it's fine; what to fix when not.
  function setupRow() {
    if (!W.setup && !W.setupLoading) loadSetup();
    const st = W.setup; if (!st || !st.root) return '';
    const fix = st.checks.filter(c => c.state === 'fix'), info = st.checks.filter(c => c.state === 'info');
    const summary = fix.length ? `${fix.length} thing${fix.length === 1 ? '' : 's'} to fix` : 'Set up';
    const label = { here: 'Fix', chat: 'Fix in a chat…', open: 'Open .env.local' };
    const row = c => `<li class="wk-setup-row" data-state="${esc(c.state)}"><span class="wk-setup-dot" aria-hidden="true"></span><span class="wk-setup-text"><b>${esc(c.label)}</b><span>${esc(c.detail)}</span></span>${c.fix && !(window.REMOTE && c.fix !== 'chat') ? `<button type="button" class="btn sm ${c.state === 'fix' ? '' : 'quiet'}" data-wk="setup-fix" data-id="${esc(c.id)}" data-how="${esc(c.fix)}"${c.fix === 'chat' ? ' aria-haspopup="menu"' : ''}>${label[c.fix]}</button>` : ''}</li>`;
    return `<details class="wk-setup-box${fix.length ? ' has-fix' : ''}"${W.setupOpen ? ' open' : ''}><summary data-wk="setup-toggle"><span class="wk-run-label">This PC</span><span class="wk-setup-sum" data-state="${fix.length ? 'fix' : 'ok'}">${esc(summary)}</span>${info.length ? `<span class="wk-setup-note">${info.length} note${info.length === 1 ? '' : 's'}</span>` : ''}<span class="wk-setup-where">${esc(st.root)}</span></summary>
      <ul class="wk-setup-list">${[...fix, ...info, ...st.checks.filter(c => c.state === 'ok')].map(row).join('')}</ul>
      <p class="wk-setup-foot">From Latitude’s guide, docs/developer-setup/local-windows-setup.md. <button type="button" class="linkish" data-wk="setup-recheck">Check again</button></p></details>`;
  }
  async function setupFix(b) {
    const id = b.dataset.id, how = b.dataset.how;
    if (how === 'chat') {
      return showMenu(b, whoItems(async (provider, account) => {
        const r = await api('/api/work/setup-fix', { id, root: W.setup && W.setup.root, provider, account, ...runFor(provider) });
        await ChatUI.openKey(r.key);
      }, { review: true }));
    }
    b.disabled = true;
    try { const r = await api('/api/work/setup-fix', { id, root: W.setup && W.setup.root }); toast(r.done || 'Done.', 6000); } finally { b.disabled = false; }
    return loadSetup(true);
  }

  /* ---------- runs with ---------- */

  const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
  function loadModels(fresh = false) {
    if (W.modelsLoading) return;
    W.modelsLoading = true;
    api(`/api/work/models${fresh ? '?fresh=1' : ''}`).then(m => { W.models = m || {}; }).catch(() => { W.models = W.models || {}; })
      .finally(() => { W.modelsLoading = false; if (showing()) render(); });
  }
  const listOf = prov => (W.models && W.models[prov]) || null;
  // The efforts a model offers (or the assistant's usual ones).
  function effortsFor(prov) {
    const list = listOf(prov); if (!list) return [];
    const m = list.models.find(x => x.value === W.run[prov].model);
    return m && m.efforts.length ? m.efforts : list.efforts || [];
  }
  function runRow() {
    if (!W.models && !W.modelsLoading) loadModels();
    const group = (prov, name, glyph) => {
      const list = listOf(prov), cur = W.run[prov];
      if (!list && ((prov === 'codex' && !codexOK()) || (prov === 'gemini' && !geminiReady()))) return '';
      const noEffort = prov === 'gemini';   // (its models carry their effort in their names)
      const models = list ? list.models : [];
      const known = !cur.model || models.some(x => x.value === cur.model);
      const efforts = effortsFor(prov);
      const dm = list && list.defaultModel ? `Default (${list.defaultModel})` : 'Default model';
      const de = list && list.defaultEffort ? `Default (${list.defaultEffort})` : 'Default effort';
      return `<span class="wk-run${noEffort ? ' solo' : ''}" role="group" aria-label="${name}: ${noEffort ? 'model' : 'model and effort'}"><span class="wk-run-who">${glyph} ${name}</span>
        <select data-wkm="${prov}-model" aria-label="${name} model"${list || cur.model ? '' : ' disabled'}><option value="">${esc(dm)}</option>${models.map(x => `<option value="${esc(x.value)}"${x.value === cur.model ? ' selected' : ''} title="${esc(x.note)}">${esc(x.label)}</option>`).join('')}${known ? '' : `<option value="${esc(cur.model)}" selected>${esc(cur.model)}</option>`}</select>
        ${noEffort ? '' : `<select data-wkm="${prov}-effort" aria-label="${name} effort"${efforts.length || cur.effort ? '' : ' disabled'}><option value="">${esc(de)}</option>${efforts.map(e => `<option value="${esc(e)}"${e === cur.effort ? ' selected' : ''}>${esc(cap(e))}</option>`).join('')}</select>`}</span>`;
    };
    return `<div class="wk-runwith" aria-label="Default model for each assistant"><span class="wk-run-label" title="Used by every chat started from Your work">Defaults</span>${group('claude', 'Claude', '✦')}${group('codex', 'Codex', '◆')}${group('gemini', 'Gemini', '✧')}<span class="wk-run-note">${W.models ? 'every chat started from here' : 'Asking for the models…'}</span></div>`;
  }
  // What a chat started now is given, for the assistant chosen.
  const runFor = prov => { const r = W.run[prov] || {}; return { ...(r.model ? { model: r.model } : {}), ...(r.effort ? { effort: r.effort } : {}) }; };
  function runLabel(prov) {
    const r = W.run[prov] || {}, list = listOf(prov);
    if (!r.model && !r.effort) return 'its default model';
    const m = r.model ? ((list && list.models.find(x => x.value === r.model)) || { label: r.model }).label : 'default model';
    return r.effort ? `${m}, ${r.effort} effort` : m;
  }

  /* ---------- buttons ---------- */

  const find = (repo, n) => { const k = kOf({ repo, number: n }); const p = item(k); return p ? { ...p, ...(W.details.get(k)?.error ? {} : W.details.get(k)) } : null; };
  function whoItems(run, { chat = null, review = false } = {}) {
    const items = (S.accounts || []).filter(a => canLaunch(a)).map(a => ({ glyph: '✦', label: `Claude · ${a.name}`, hint: `${chat && !review ? `in “${chat.title || 'its chat'}”` : 'a new chat'} · ${runLabel('claude')}`, run: () => run('claude', a.id, false) }));
    if (chat && !review) items.push({ glyph: '✦', label: 'Claude, in a new chat', hint: `as ${current().name} · ${runLabel('claude')}`, run: () => run('claude', current().id, true) });
    if (codexOK()) items.push({ glyph: '◆', label: 'Codex', hint: `a new chat · ${runLabel('codex')}`, run: () => run('codex', (S.codex && S.codex.id) || 'codex', true) });
    if (typeof geminiReady === 'function' && geminiReady()) items.push({ glyph: '✧', label: 'Gemini', hint: `a new chat · ${runLabel('gemini')}`, run: () => run('gemini', 'gemini', true) });
    return items;
  }
  async function prChat(p, action, provider, account, fresh) {
    toast(action === 'review' ? `Fetching #${p.number} and starting the review…` : 'Starting…', 4000);
    const r = await api('/api/prs/act', { action, repo: p.repo, n: p.number, provider, account, fresh, ...runFor(provider) });
    await ChatUI.openKey(r.key);
    if (r.recordWarning) toast(r.recordWarning, 7000);
    if (r.resumed) toast('It carries on in the chat that made the pull request, which knows the work.', 6000);
  }
  // A new chat about a pull request, with nothing asked yet: it opens with the defaults, and the PR's details in
  // the box for you to add what you want.
  async function freeChat(p, provider, account) {
    toast('Opening a new chat…', 3000);
    const r = await api('/api/prs/open-chat', { repo: p.repo, n: p.number, provider, account, ...runFor(provider) });
    await ChatUI.openKey(r.key, { initialText: r.text });
  }
  function commands() {
    const selected = showing() && W.open && item(W.open);
    if (!selected || selected.identifier) return [];
    const p = find(selected.repo, selected.number);
    return [{ glyph: '❝', t: `New chat about #${p.number}`, s: `${p.repo} · free-form, with its details ready in the box`, alias: 'chat talk ask discuss free form pr', run: () => showMenu($('wkDetailTitle'), whoItems((pv, acct) => freeChat(p, pv, acct), { review: true })) },
      ...[['validate', 'Validate changes', 'focused checks for the changed packages'], ['handoff', 'Prepare handoff', 'draft review notes and verification evidence']].map(([action, title, hint]) => ({
      glyph: action === 'validate' ? '✓' : '↗', t: `${title} for #${p.number}`, s: `${p.repo} · ${hint}`, alias: 'pr workflow',
      run: () => showMenu($('wkDetailTitle'), whoItems((provider, account) => prChat(p, action, provider, account, true), { review: true })),
    })), { glyph: '≡', t: `Review journal for #${p.number}`, s: 'results and chats, grouped by revision', alias: 'evidence record validation history', run: () => act('detail-tab', { dataset: { value: 'record' } }) }];
  }
  function setRecord(p, entries) {
    const key = kOf(p), x = item(key), detail = W.details.get(key);
    if (x) x.record = entries;
    if (detail && !detail.error) detail.record = entries;
    if (showing() && W.open === key) renderInspector();
  }
  async function recordChanged({ repo, n }) {
    if (!repo || !n) return;
    const p = find(repo, n); if (!p) return;
    const result = await api(`/api/prs/record?${new URLSearchParams({ repo, n })}`);
    setRecord(p, result.entries);
  }
  async function pickReviewers(p) {
    if (!W.team || W.team.repo !== p.repo) W.team = { repo: p.repo, list: (await api(`/api/prs/team?repo=${encodeURIComponent(p.repo)}`)).team };
    const list = W.team.list;
    let users;
    if (list.length) {
      const pick = await new Promise(resolve => {
        const d = document.createElement('dialog');
        d.className = 'wide wk-rev-dlg';
        d.innerHTML = `<div class="setup-head"><h3>Who should review #${p.number}?</h3><button class="icon" value="" aria-label="Close" data-x>✕</button></div><div class="rd-body"><input type="search" class="wk-rev-q" placeholder="Filter by name or team" aria-label="Filter"><div class="wk-rev-list">${list.map(m => `<label class="wk-rev"><input type="checkbox" value="${esc(m.login)}"><span><b>${esc(m.name)}</b> <small>${esc(m.login)}${m.teams.length ? ` · ${esc(m.teams.join(', '))}` : ''}</small></span></label>`).join('')}</div><div class="d-row"><button class="btn quiet" data-x>Cancel</button><button class="btn prime" data-go>Ask them</button></div></div>`;
        document.body.appendChild(d);
        const done = v => { resolve(v); d.close(); d.remove(); };
        d.querySelector('.wk-rev-q').addEventListener('input', e => { const q = e.target.value.toLowerCase(); d.querySelectorAll('.wk-rev').forEach(l => { l.hidden = !!q && !l.textContent.toLowerCase().includes(q); }); });
        d.addEventListener('click', e => { if (e.target.closest('[data-x]')) done(null); else if (e.target.closest('[data-go]')) done([...d.querySelectorAll('.wk-rev input:checked')].map(x => x.value)); });
        d.addEventListener('cancel', e => { e.preventDefault(); done(null); });
        d.showModal();
      });
      users = pick;
    } else {
      const typed = await ask('Ask for a review', `GitHub names of who should review #${p.number}, separated by commas.`, '', 'Ask them', { maxLength: 200 });
      users = typed ? typed.split(/[\s,]+/).filter(Boolean) : null;
    }
    if (!users || !users.length) return;
    await api('/api/prs/reviewers', { repo: p.repo, n: p.number, users });
    toast(`Asked ${users.join(', ')} to review #${p.number}.`, 5000);
    load(true);
  }
  async function merge(p) {
    if (!p.headSha || W.details.get(kOf(p))?.error) { toast('Refresh this PR before merging so its revision can be checked.'); return; }
    const how = await appChoice(`Merge #${p.number}?\n\n“${p.title}” is squashed into ${p.base || 'its base'}. GitHub still checks that it’s approved, its required checks pass and every review thread is resolved. “When it’s ready” lets GitHub merge it as soon as all of that is true.`, [{ v: 'now', label: 'Merge now', kind: 'prime' }, { v: 'auto', label: 'When it’s ready' }, { v: '', label: 'Cancel', kind: 'quiet' }]);
    if (!how) return;
    await api('/api/prs/merge', { repo: p.repo, n: p.number, auto: how === 'auto', head: p.headSha });
    toast(how === 'auto' ? `#${p.number} merges by itself once it’s ready.` : `Merged #${p.number}.`, 5000);
    load(true);
  }
  function more(b, p) {
    const items = [
      { glyph: '❝', label: 'New chat about it…', hint: 'free-form, with its details ready in the box', run: () => showMenu(b, whoItems((pv, acct) => freeChat(p, pv, acct), { review: true })) },
      { glyph: '✓', label: 'Validate changes…', hint: 'focused checks for the changed packages', run: () => showMenu(b, whoItems((pv, acct) => prChat(p, 'validate', pv, acct, true), { review: true })) },
      { glyph: '↗', label: 'Prepare handoff…', hint: 'draft review notes without posting', run: () => showMenu(b, whoItems((pv, acct) => prChat(p, 'handoff', pv, acct, true), { review: true })) },
      '-',
    ];
    if (p.mine && !p.isDraft && !p.reviewDecision) items.push({ glyph: '☺', label: 'Ask for a review…', hint: 'from your team', run: () => pickReviewers(p) });
    if (p.mine && !p.isDraft) items.push({ glyph: '☺', label: 'Ask someone else to review…', run: () => pickReviewers(p) });
    items.push({ glyph: '⇣', label: 'Bring it up to date…', hint: `merge in ${p.base || 'its base'}, in a chat`, run: () => showMenu(b, whoItems((pv, acct, fresh) => prChat(p, 'update', pv, acct, fresh), { chat: p.chat })) });
    if (p.mine && p.open) items.push({ glyph: '✎', label: `Fix ${p.open} comment${p.open === 1 ? '' : 's'}…`, run: () => showMenu(b, whoItems((pv, acct, fresh) => prChat(p, 'fix-comments', pv, acct, fresh), { chat: p.chat })) });
    if (p.mine) items.push({ glyph: '◇', label: 'Review it…', hint: 'a second opinion', run: () => showMenu(b, whoItems((pv, acct, fresh) => prChat(p, 'review', pv, acct, fresh), { review: true })) });
    if (p.mine && p.isDraft) items.push({ glyph: '✓', label: 'Ready for review', run: () => readyNow(p) });
    if (p.mine && !p.isDraft && !p.autoMerge) items.push({ glyph: '⇒', label: 'Merge…', hint: 'now, or when it’s ready', run: () => merge(p) });
    if (p.autoMerge) items.push({ glyph: '⇒', label: 'Stop merging it by itself', run: async () => { await api('/api/prs/merge-cancel', { repo: p.repo, n: p.number }); load(true); } });
    if (p.repo.toLowerCase() === 'latitudegames/latitude' && !p.preview && !(p.labels || []).includes('preview')) items.push({ glyph: '◎', label: 'Ask for a preview', hint: 'a live copy, shared resources', run: () => askPreview(p) });
    items.push('-');
    items.push({ glyph: '↗', label: 'Open on GitHub', run: () => window.open(p.url, '_blank', 'noopener') });
    return showMenu(b, items);
  }
  async function readyNow(p) {
    if (!(await appConfirm(`Mark #${p.number} ready for review?\n\nIt leaves draft, and its reviewers are asked to look.`, { ok: 'Ready for review' }))) return;
    await api('/api/prs/ready', { repo: p.repo, n: p.number });
    toast(`#${p.number} is ready for review.`, 4000);
    load(true);
  }
  async function askPreview(p) {
    if (!(await appConfirm(`Ask for a preview of #${p.number}?\n\nThis adds the preview label, which builds a live copy at pr-${p.number}.preview.voyage.io. Previews use shared resources, so Latitude asks that a person decides.`, { ok: 'Ask for a preview' }))) return;
    await api('/api/prs/preview', { repo: p.repo, n: p.number });
    toast(`Asked for a preview of #${p.number}. It shows up on the card once it’s building.`, 6000);
    load(true);
  }
  async function act(a, b) {
    if (a === 'setup-toggle') { W.setupOpen = !W.setupOpen; return undefined; }
    if (a === 'setup-recheck') return loadSetup(true);
    if (a === 'setup-fix') return setupFix(b);
    if (a === 'home') { try { localStorage.setItem('start-page', localStorage.getItem('start-page') === 'work' ? 'hub' : 'work'); } catch {} render(); return; }
    if (a === 'select') { W.trail = []; return select(b.dataset.key); }
    if (a === 'back-detail') { const key = W.trail.pop(); if (key) return select(key); return; }
    if (a === 'expand-detail') { W.wide = !W.wide; store('work-detail-width', W.wide ? 'wide' : 'narrow'); render(); if (W.wide) page().querySelector('.wk-content')?.scrollIntoView({ block: 'start', behavior: 'instant' }); return; }
    if (a === 'refresh-detail') { W.files.delete(W.open); return detailLoad(W.open); }
    if (a === 'load-files') return filesLoad();
    if (a === 'file') { const state = W.files.get(W.open); if (state) { state.selected = b.dataset.path; state.lines = 600; renderInspector(); } return; }
    if (a === 'more-lines') { const state = W.files.get(W.open); if (state) { state.lines += 600; renderInspector(); } return; }
    if (a === 'previous' || a === 'next') {
      const items = queue(), index = items.findIndex(i => rowKey(i) === W.open);
      const next = index >= 0 && items[index + (a === 'next' ? 1 : -1)];
      if (next) { W.trail = []; await select(rowKey(next)); $('wkInspector')?.querySelector(`[data-wk="${a}"]:not(:disabled)`)?.focus({ preventScroll: true }); }
      return;
    }
    if (a === 'filter') { W.filter = b.dataset.value; render(); return; }
    if (a === 'layout') { W.layout = b.dataset.value; try { localStorage.setItem('work-layout', W.layout); } catch {} render(); return; }
    if (a === 'reset') { W.filter = 'all'; W.query = ''; W.repo = 'all'; store('work-repo', 'all'); render(); return; }
    if (a === 'close-detail') { const key = W.open; W.open = null; render(); [...page().querySelectorAll('.wk-row')].find(e => e.dataset.key === key)?.focus({ preventScroll: true }); return; }
    if (a === 'detail-tab') {
      W.detailTab = b.dataset.value;
      if (W.detailTab === 'files' || W.detailTab === 'record') { W.wide = true; render(); page().querySelector('.wk-content')?.scrollIntoView({ block: 'start', behavior: 'instant' }); } else renderInspector();
      $('wkInspector').querySelector(`.wk-detail-tabs [data-value="${W.detailTab}"]`)?.focus({ preventScroll: true });
      const panel = $('wkInspector'), tabs = panel.querySelector('.wk-detail-tabs');
      if (window.innerWidth > 1100) {
        panel.scrollTop = W.detailTab === 'overview' ? 0 : panel.scrollTop + tabs.getBoundingClientRect().top - panel.getBoundingClientRect().top - panel.querySelector('.wk-inspector-top').offsetHeight;
        panel.classList.toggle('scrolled', panel.scrollTop > 90);
      } else if (W.detailTab !== 'overview') tabs.scrollIntoView({ block: 'start', behavior: 'instant' });
      if (W.detailTab === 'files' && !W.files.has(W.open)) await filesLoad();
      return;
    }
    if (a === 'retry-detail') return detailLoad(W.open);
    if (a === 'copy') { if (await copyText(b.dataset.text, null)) toast(b.dataset.text.startsWith('https://') ? 'Link copied.' : 'Branch copied.'); return; }
    if (a === 'cross-review') return openCrossReview(b.dataset.repo ? find(b.dataset.repo, b.dataset.n) || {} : {});
    if (a === 'open-pr') { const url = await ask('Open a pull request', 'Paste its GitHub URL. Its checks, feedback, and actions open here.', '', 'Open PR'); if (url) await openUrl(url); return; }
    if (a === 'linked') { if (W.open) W.trail.push(W.open); return openUrl(b.dataset.url); }
    if (a === 'issue-link') { const id = b.dataset.id; if (!item(id)) W.external.set(id, await api(`/api/linear/issue?id=${encodeURIComponent(id)}`)); if (W.open) W.trail.push(W.open); return select(id); }
    if (a === 'plan') return showMenu(b, whoItems((pv, acct) => startIssue(b.dataset.id, pv, acct, 'plan'), { review: true }));
    if (a === 'refresh') { loadSetup(true); return load(true); }
    if (a === 'prchat') { const p = find(b.dataset.repo, b.dataset.n); if (!p) return undefined; return showMenu(b, whoItems((pv, acct) => freeChat(p, pv, acct), { review: true })); }
    if (a === 'connections') return openConnections(null);
    if (a === 'savekey') { await api('/api/linear/key', { key: $('wkKey').value }); return load(true); }
    if (a === 'who') { W.usersQ = $('wkWho').value.trim(); W.users = W.usersQ ? (await api(`/api/linear/users?q=${encodeURIComponent(W.usersQ)}`)).users : null; return render(); }
    if (a === 'me') { await api('/api/linear/me', { id: b.dataset.id }); W.users = null; return load(true); }
    if (a === 'start') return showMenu(b, whoItems((pv, acct) => startIssue(b.dataset.id, pv, acct), { review: true }));
    if (a === 'issuechat') return b.dataset.key ? ChatUI.openKey(b.dataset.key).catch(() => (b.dataset.id ? ChatUI.open({ sessionId: b.dataset.id }) : null)) : ChatUI.open({ sessionId: b.dataset.id });
    if (a === 'chat') return ChatUI.open({ sessionId: b.dataset.id });
    if (a.startsWith('record-')) {
      const x = W.open && item(W.open); if (!x || x.identifier) return;
      const p = find(x.repo, x.number), entry = (p.record || []).find(e => e.id === b.dataset.id);
      if (a === 'record-add' || (a === 'record-edit' && entry)) return WorkRecord.edit(p, entry, saved => setRecord(p, [saved, ...(find(p.repo, p.number)?.record || []).filter(e => e.id !== saved.id)].sort((a, b) => b.at - a.at)));
      if (a === 'record-chat' && entry?.chat) {
        try { return await ChatUI.openKey(entry.chat.key); }
        catch (err) { if (entry.chat.sessionId) return ChatUI.open({ sessionId: entry.chat.sessionId }); throw err; }
      }
      if (a === 'record-remove' && entry && await appConfirm('Remove this journal entry from this PC?', { ok: 'Remove entry' })) {
        await api('/api/prs/record-remove', { repo: p.repo, n: p.number, id: entry.id });
        setRecord(p, (find(p.repo, p.number)?.record || []).filter(e => e.id !== entry.id)); $('wkRecordTitle')?.focus({ preventScroll: true });
      }
      return;
    }
    const p = find(b.dataset.repo, b.dataset.n); if (!p) return undefined;
    if (a === 'validate' || a === 'handoff') return showMenu(b, whoItems((pv, acct) => prChat(p, a, pv, acct, true), { review: true }));
    if (a === 'fix-comments' || a === 'fix-checks') return showMenu(b, whoItems((pv, acct, fresh) => prChat(p, a, pv, acct, fresh), { chat: p.chat }));
    if (a === 'review') return showMenu(b, whoItems((pv, acct, fresh) => prChat(p, 'review', pv, acct, fresh), { review: true }));
    if (a === 'update') return showMenu(b, whoItems((pv, acct, fresh) => prChat(p, 'update', pv, acct, fresh), { chat: p.chat }));
    if (a === 'ready') return readyNow(p);
    if (a === 'merge') return merge(p);
    if (a === 'more') return more(b, p);
    return undefined;
  }
  async function startIssue(id, provider, account, mode = 'start') {
    toast(`Starting ${id}…`, 4000);
    const r = await api('/api/work/start', { identifier: id, provider, account, mode, ...runFor(provider) });
    await ChatUI.openKey(r.key);
    load(true);
  }
  document.addEventListener('click', wrap(async e => {
    if (!showing()) return undefined;
    const b = e.target.closest('#page [data-wk]'); if (!b) return undefined;
    return act(b.dataset.wk, b);
  }));
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || document.body.classList.contains('nav-open')) return;
    if (showing() && $('menu').hidden && $('palette').hidden && !document.querySelector('dialog[open]') && !e.target.closest('input,textarea,select,[contenteditable="true"]')) {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); $('wkSearch')?.focus(); return; }
      if (e.key === 'Escape' && W.open) { e.preventDefault(); wrap(() => act('close-detail'))(); return; }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.target.closest('.wk-row') && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        const rows = [...page().querySelectorAll('.wk-row')], index = rows.indexOf(e.target.closest('.wk-row'));
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : index + (e.key === 'ArrowDown' ? 1 : -1);
        e.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, next))]?.focus(); return;
      }
    }
    if (!showing() || e.key !== 'Enter') return;
    if (e.target.id === 'wkWho') { e.preventDefault(); wrap(() => act('who'))(); }
    if (e.target.id === 'wkKey') { e.preventDefault(); wrap(() => act('savekey'))(); }
  });
  document.addEventListener('change', e => {
    if (!showing()) return;
    if (e.target.id === 'wkRepo') { W.repo = e.target.value; store('work-repo', W.repo); render(); }
    const wkm = e.target.dataset && e.target.dataset.wkm;
    if (wkm) {
      const [prov, what] = wkm.split('-');
      if (!W.run[prov] || !['model', 'effort'].includes(what)) return;
      W.run[prov][what] = e.target.value;
      // A model that doesn't offer the chosen effort goes back to its default effort.
      if (what === 'model' && W.run[prov].effort && !effortsFor(prov).includes(W.run[prov].effort)) W.run[prov].effort = '';
      try { localStorage.setItem('work-run', JSON.stringify(W.run)); } catch { /* this session only */ }
      render();
    }
    if (e.target.id === 'wkFileSelect') act('file', { dataset: { path: e.target.value } });
  });
  document.addEventListener('input', e => { if (showing() && e.target.id === 'wkSearch') { W.query = e.target.value; renderResults(); } });
  document.addEventListener('scroll', e => { if (e.target.id === 'wkInspector') e.target.classList.toggle('scrolled', e.target.scrollTop > 90); }, true);

  return { render: () => { render(); if (!W.loading && (!W.data || Date.now() - W.at > 60000)) load(false); }, changed: () => { if (showing()) load(true); else W.at = 0; }, count, load, openPr: url => { W.trail = []; return openUrl(url); },
    showPrs: () => { W.filter = 'prs'; W.query = ''; render(); }, commands, recordChanged,
    runPrefs: () => JSON.parse(JSON.stringify(W.run)),
    modelsFor: prov => (W.models && W.models[prov]) || null,
    openIssue: async id => { if (!item(id)) W.external.set(id, await api(`/api/linear/issue?id=${encodeURIComponent(id)}`)); await select(id); } };
})();

// The sidebar's entry (the standard layout; the saga themes keep theirs and reach it with Ctrl+K).
function workNav() {
  const n = Work.count();
  return `<button class="nav-i" data-view="work" aria-current="${S.view === 'work'}"><span class="glyph" aria-hidden="true">⇄</span><span class="ni-t">${esc(voice('Your work'))}</span>${n ? `<span class="tag gilt">${n}</span>` : ''}</button>`;
}
async function openWorkPr(url) {
  if (!url) url = await ask('Open a pull request', 'Paste its GitHub URL to view checks, feedback, and actions in your workspace.', '', 'Open PR');
  if (!url) return;
  await go('work'); await Work.openPr(url);
}
