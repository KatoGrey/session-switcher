'use strict';
/* Your work: one page to work from. Your Linear issues (assigned to you, by the Linear person you are) and your pull
   requests on GitHub (yours, the ones linked to your issues whoever made them, and the ones waiting on your review),
   in columns from To do to merged, each with what's next and the button for it: start an issue in a chat, fix a
   PR's comments or checks, mark it ready, ask for reviewers or a preview, merge it. The chats follow the repo's own
   PR workflow. (lib/linear.js, lib/prs.js; server.js workBoard.) */

const Work = (() => {
  const W = { data: null, loading: false, err: null, at: 0, open: null, team: null, usersQ: '', users: null };
  const MERGE = { CLEAN: ['Ready to merge', 'ok'], HAS_HOOKS: ['Ready to merge', 'ok'], BLOCKED: ['Blocked', ''], BEHIND: ['Behind its base', 'warn'], DIRTY: ['Has conflicts', 'bad'], UNSTABLE: ['Some checks failing', 'warn'], DRAFT: ['Draft', ''] };
  const kOf = p => `${String(p.repo).toLowerCase()}#${p.number}`;
  const page = () => $('page');
  const showing = () => S.view === 'work';

  async function load(fresh = false) {
    if (W.loading) return;
    W.loading = true; if (showing()) render();
    try { W.data = await api(`/api/work${fresh ? '?fresh=1' : ''}`); W.err = null; W.at = Date.now(); } catch (err) { W.err = err.message; }
    W.loading = false;
    if (showing()) render();
    if (typeof renderNav === 'function') renderNav();
  }
  // Kept current while you're looking at it.
  setInterval(() => { if (showing() && document.visibilityState === 'visible' && Date.now() - W.at > 120000) load(false); }, 30000);

  // What's next for a pull request, in a few words, and how it's going.
  function next(p) {
    const c = p.checks || {};
    if (p.state === 'MERGED') return ['Merged', 'ok'];
    if (p.isDraft) return ['Draft: mark it ready when it’s done', ''];
    if (p.mine && p.open) return [`${p.open} comment${p.open === 1 ? '' : 's'} to address`, 'warn'];
    if (c.failed && c.failed.length) return [`${c.failed.length} check${c.failed.length === 1 ? '' : 's'} failing`, 'bad'];
    if (p.mergeState === 'DIRTY') return ['Has conflicts: bring it up to date', 'bad'];
    if (p.reviewDecision === 'CHANGES_REQUESTED') return ['Changes requested', 'warn'];
    if (p.reviewDecision === 'APPROVED' && !p.open) return [p.autoMerge ? 'Merges by itself when its checks pass' : 'Approved: ready to merge', 'ok'];
    if (!p.mine && (p.roles || []).includes('review')) return ['Waiting on your review', 'gilt'];
    if (p.open) return [`${p.open} open review thread${p.open === 1 ? '' : 's'}`, ''];
    if (c.pending) return ['Checks running', ''];
    return [p.reviewers && p.reviewers.length ? `Waiting for ${p.reviewers.slice(0, 3).join(', ')}` : 'Waiting for review', ''];
  }
  function signals(p) {
    const c = p.checks || {};
    const checks = c.failed && c.failed.length ? `<span class="cn-bad">✗ ${c.failed.length} failing</span>` : c.pending ? `<span>⏳ ${c.pending} running</span>` : c.passed ? `<span class="cn-yes">✓ checks</span>` : '';
    const rev = p.reviewDecision === 'APPROVED' ? '<span class="cn-yes">✓ approved</span>' : p.reviewDecision === 'CHANGES_REQUESTED' ? '<span class="cn-bad">changes asked</span>' : p.reviews && p.reviews.length ? `<span>${p.reviews.length} review${p.reviews.length === 1 ? '' : 's'}</span>` : '';
    const threads = p.open ? `<span>${p.open} open thread${p.open === 1 ? '' : 's'}</span>` : '';
    const m = MERGE[p.mergeState] && p.mergeState !== 'DRAFT' && p.mergeState !== 'BLOCKED' ? `<span class="${MERGE[p.mergeState][1] === 'bad' ? 'cn-bad' : ''}">${MERGE[p.mergeState][0]}</span>` : '';
    return [checks, rev, threads, m, p.autoMerge ? '<span>auto-merge on</span>' : '', p.preview ? `<a href="${esc(p.preview)}" target="_blank" rel="noopener noreferrer">preview</a>` : ''].filter(Boolean).join('<i aria-hidden="true">·</i>');
  }

  /* ---------- cards ---------- */

  const issueUrl = id => { const i = ((W.data && W.data.issues) || []).find(x => x.identifier === id); return i ? i.url : null; };
  function prCard(p) {
    const [what, tone] = next(p);
    const issue = p.issue ? (issueUrl(p.issue) ? `<a class="wk-tag" href="${esc(issueUrl(p.issue))}" target="_blank" rel="noopener noreferrer">${esc(p.issue)}</a>` : `<span class="wk-tag">${esc(p.issue)}</span>`) : '';
    const d = `data-repo="${esc(p.repo)}" data-n="${p.number}"`;
    const acts = [];
    const c = p.checks || {};
    if (p.state === 'OPEN') {
      if (p.mine && p.open) acts.push(`<button type="button" class="btn sm gilt" data-wk="fix-comments" ${d} aria-haspopup="menu">Fix ${p.open} comment${p.open === 1 ? '' : 's'}…</button>`);
      if (p.mine && c.failed && c.failed.length) acts.push(`<button type="button" class="btn sm ${p.open ? '' : 'gilt'}" data-wk="fix-checks" ${d} aria-haspopup="menu">Fix the checks…</button>`);
      if (p.mine && p.isDraft) acts.push(`<button type="button" class="btn sm" data-wk="ready" ${d}>Ready for review</button>`);
      if (p.mine && !p.isDraft && p.reviewDecision === 'APPROVED' && !p.open && !p.autoMerge) acts.push(`<button type="button" class="btn sm gilt" data-wk="merge" ${d}>Merge…</button>`);
      if (!p.mine) acts.push(`<button type="button" class="btn sm ${(p.roles || []).includes('review') ? 'gilt' : ''}" data-wk="review" ${d} aria-haspopup="menu">Review it…</button>`);
      if (p.chat) acts.push(`<button type="button" class="btn quiet sm" data-wk="chat" data-id="${esc(p.chat.sessionId)}" title="${esc(p.chat.title || '')}">Its chat</button>`);
      acts.push(`<button type="button" class="btn quiet sm" data-wk="more" ${d} aria-haspopup="menu" aria-label="More for #${p.number}">More…</button>`);
    } else {
      acts.push(`<a class="btn quiet sm" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">GitHub</a>`);
    }
    return `<article class="wk-card wk-pr" data-key="${esc(kOf(p))}">
      <p class="wk-k"><a class="wk-id" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">#${p.number}</a>${issue}${p.isDraft ? '<span class="tag">Draft</span>' : ''}${!p.mine && p.author ? `<span class="wk-by">by ${esc(p.author)}</span>` : ''}</p>
      <h3>${esc(p.title)}</h3>
      <p class="wk-next ${tone}">${esc(what)}</p>
      ${p.state === 'OPEN' ? `<p class="wk-sig">${signals(p)}</p>` : ''}
      <div class="wk-acts">${acts.join('')}</div></article>`;
  }
  function issueCard(i) {
    const chat = i.chat && (i.chat.key || i.chat.sessionId);
    const pr = (i.prs || []).length ? ` · ${i.prs.length} PR${i.prs.length === 1 ? '' : 's'} (closed or elsewhere)` : '';
    return `<article class="wk-card wk-issue" data-issue="${esc(i.identifier)}">
      <p class="wk-k"><a class="wk-id" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(i.identifier)}</a>${i.priorityLabel && i.priority && i.priority <= 2 ? `<span class="tag ${i.priority === 1 ? 'pr-dec bad' : ''}">${esc(i.priorityLabel)}</span>` : ''}<span class="wk-by">${esc((i.state && i.state.name) || '')}</span></p>
      <h3>${esc(i.title)}</h3>
      <p class="wk-meta">${esc([i.team && i.team.name, i.project].filter(Boolean).join(' · '))}${i.updatedAt ? ` · updated ${esc(agoL(i.updatedAt))}` : ''}${esc(pr)}</p>
      <div class="wk-acts">${chat ? `<button type="button" class="btn sm" data-wk="issuechat" data-key="${esc(i.chat.key || '')}" data-id="${esc(i.chat.sessionId || '')}">Its chat</button>` : ''}<button type="button" class="btn sm ${chat ? 'quiet' : 'gilt'}" data-wk="start" data-id="${esc(i.identifier)}" aria-haspopup="menu">${chat ? 'Start again…' : 'Start…'}</button><a class="btn quiet sm" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">Linear</a></div></article>`;
  }

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
  function render() {
    const pg = page();
    pg.dataset.page = 'work'; delete pg.dataset.worldPage;
    const d = W.data;
    const who = d ? [d.gh.signedIn ? `GitHub: <b>${esc(d.gh.login)}</b>` : 'GitHub: not signed in', d.linear && d.linear.me ? `Linear: <b>${esc(d.linear.me.name || d.linear.me.displayName)}</b>` : 'Linear: not set up'].join(' · ') : '';
    const head = `<header class="f-head"><div><p class="eyebrow">⇄ ${esc(voice('Linear and GitHub'))}</p><h1>${esc(voice('Your work'))}</h1>
      <p class="f-meta">${who}${W.at ? ` · checked ${esc(agoL(W.at))}` : ''}</p></div>
      <div class="f-act"><button type="button" class="btn quiet" data-wk="refresh"${W.loading ? ' disabled' : ''}>${W.loading ? 'Checking…' : 'Check again'}</button><button type="button" class="btn quiet" data-wk="connections">Connections</button></div></header>`;
    if (!d) { pg.innerHTML = `${head}${W.err ? `<p class="rd-state warn">${esc(W.err)}</p>` : '<p class="loading">Asking Linear and GitHub…</p>'}`; if (!W.loading && !W.err) load(false); return; }
    const issues = d.issues || [], prs = d.prs || [];
    const openPr = p => p.state === 'OPEN';
    const issueHasPr = i => (i.prs || []).some(l => prs.some(p => openPr(p) && kOf(p) === `${l.repo.toLowerCase()}#${l.number}`)) || prs.some(p => openPr(p) && p.issue === i.identifier);
    // Most urgent first (Linear's 1 is urgent, 4 low, 0 none), then the newest.
    const rank = i => (i.priority ? i.priority : 5);
    const todo = issues.filter(i => !issueHasPr(i) && !(i.state && i.state.type === 'started') && !(i.chat && (i.chat.key || i.chat.sessionId)))
      .sort((a, b) => rank(a) - rank(b) || Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
    const doing = issues.filter(i => !issueHasPr(i) && !todo.includes(i));
    const review = prs.filter(p => openPr(p) && (p.mine || (p.roles || []).includes('linked')));
    const waiting = prs.filter(p => openPr(p) && !p.mine && !(p.roles || []).includes('linked') && ((p.roles || []).includes('review') || (p.roles || []).includes('assigned')));
    const merged = prs.filter(p => p.state === 'MERGED').sort((a, b) => Date.parse(b.mergedAt || 0) - Date.parse(a.mergedAt || 0));
    const col = (id, title, hint, cards, empty) => `<section class="wk-col" id="wk-${id}"><h2>${esc(title)}${cards.length ? ` <span class="count">${cards.length}</span>` : ''}</h2><p class="wk-hint">${esc(hint)}</p>${cards.length ? cards.join('') : `<p class="wk-empty">${esc(empty)}</p>`}</section>`;
    const errs = [d.issuesError && `Linear: ${d.issuesError}`, d.prsError && `GitHub: ${d.prsError}`].filter(Boolean);
    pg.innerHTML = `${head}${setupHtml(d)}${errs.map(e => `<p class="rd-state warn">${esc(e)}</p>`).join('')}
      <div class="wk-cols">
        ${col('todo', 'To do', 'Assigned to you in Linear, not started', todo.map(issueCard), d.linear && d.linear.me ? 'Nothing waiting to be started.' : 'Your Linear issues show here once Linear knows who you are.')}
        ${col('doing', 'In progress', 'Started, no pull request yet', doing.map(issueCard), 'Start an issue and it moves here.')}
        ${col('review', 'In review', 'Your pull requests, and the ones on your issues', review.map(prCard), 'No open pull requests.')}
        ${col('waiting', 'Waiting on you', 'Others’ pull requests asking for your review', waiting.map(prCard), 'Nobody is waiting on you.')}
      </div>
      ${merged.length ? `<section class="wk-merged"><h2>Merged this week <span class="count">${merged.length}</span></h2>${merged.map(p => `<p class="wk-mrow"><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">#${p.number}</a> ${esc(p.title)}${p.issue ? ` <span class="wk-tag">${esc(p.issue)}</span>` : ''} <small>${p.mergedAt ? esc(agoL(p.mergedAt)) : ''}</small></p>`).join('')}</section>` : ''}
      <p class="note wk-foot">Starting an issue opens a chat in your Latitude folder that makes a branch, fixes it and opens a draft pull request the repo’s way. Buttons that change a pull request on GitHub (ready, reviewers, preview, merge) ask first. Linear is only read here.</p>`;
  }
  const count = () => { const d = W.data; if (!d) return 0; return (d.prs || []).filter(p => p.state === 'OPEN' && ((p.mine && (p.open || (p.checks && p.checks.failed && p.checks.failed.length) || p.reviewDecision === 'APPROVED' || p.reviewDecision === 'CHANGES_REQUESTED')) || (!p.mine && (p.roles || []).includes('review')))).length; };

  /* ---------- buttons ---------- */

  const find = (repo, n) => ((W.data && W.data.prs) || []).find(p => p.repo === repo && p.number === Number(n));
  function whoItems(run, { chat = null, review = false } = {}) {
    const items = (S.accounts || []).filter(a => canLaunch(a)).map(a => ({ glyph: '✦', label: `Claude · ${a.name}`, hint: chat && !review ? `in “${chat.title || 'its chat'}”` : 'a new chat', run: () => run('claude', a.id, false) }));
    if (chat && !review) items.push({ glyph: '✦', label: 'Claude, in a new chat', hint: `as ${current().name}`, run: () => run('claude', current().id, true) });
    if (codexOK()) items.push({ glyph: '◆', label: 'Codex', hint: 'a new chat', run: () => run('codex', (S.codex && S.codex.id) || 'codex', true) });
    return items;
  }
  async function prChat(p, action, provider, account, fresh) {
    toast(action === 'review' ? `Fetching #${p.number} and starting the review…` : 'Starting…', 4000);
    const r = await api('/api/prs/act', { action, repo: p.repo, n: p.number, provider, account, fresh });
    await ChatUI.openKey(r.key);
    if (r.resumed) toast('It carries on in the chat that made the pull request, which knows the work.', 6000);
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
    const how = await appChoice(`Merge #${p.number}?\n\n“${p.title}” is squashed into ${p.base || 'its base'}. GitHub still checks that it’s approved, its required checks pass and every review thread is resolved. “When it’s ready” lets GitHub merge it as soon as all of that is true.`, [{ v: 'now', label: 'Merge now', kind: 'prime' }, { v: 'auto', label: 'When it’s ready' }, { v: '', label: 'Cancel', kind: 'quiet' }]);
    if (!how) return;
    await api('/api/prs/merge', { repo: p.repo, n: p.number, auto: how === 'auto' });
    toast(how === 'auto' ? `#${p.number} merges by itself once it’s ready.` : `Merged #${p.number}.`, 5000);
    load(true);
  }
  function more(b, p) {
    const items = [];
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
    items.push({ glyph: '☰', label: 'Details: comments and checks', run: () => openPrs({ show: { repo: p.repo, n: p.number, item: p } }) });
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
    if (a === 'refresh') return load(true);
    if (a === 'connections') return openConnections(null);
    if (a === 'savekey') { await api('/api/linear/key', { key: $('wkKey').value }); return load(true); }
    if (a === 'who') { W.usersQ = $('wkWho').value.trim(); W.users = W.usersQ ? (await api(`/api/linear/users?q=${encodeURIComponent(W.usersQ)}`)).users : null; return render(); }
    if (a === 'me') { await api('/api/linear/me', { id: b.dataset.id }); W.users = null; return load(true); }
    if (a === 'start') return showMenu(b, whoItems((pv, acct) => startIssue(b.dataset.id, pv, acct), { review: true }));
    if (a === 'issuechat') return b.dataset.key ? ChatUI.openKey(b.dataset.key).catch(() => (b.dataset.id ? ChatUI.open({ sessionId: b.dataset.id }) : null)) : ChatUI.open({ sessionId: b.dataset.id });
    if (a === 'chat') return ChatUI.open({ sessionId: b.dataset.id });
    const p = find(b.dataset.repo, b.dataset.n); if (!p) return undefined;
    if (a === 'fix-comments' || a === 'fix-checks') return showMenu(b, whoItems((pv, acct, fresh) => prChat(p, a, pv, acct, fresh), { chat: p.chat }));
    if (a === 'review') return showMenu(b, whoItems((pv, acct, fresh) => prChat(p, 'review', pv, acct, fresh), { review: true }));
    if (a === 'ready') return readyNow(p);
    if (a === 'merge') return merge(p);
    if (a === 'more') return more(b, p);
    return undefined;
  }
  async function startIssue(id, provider, account) {
    toast(`Starting ${id}…`, 4000);
    const r = await api('/api/work/start', { identifier: id, provider, account });
    await ChatUI.openKey(r.key);
    load(true);
  }
  document.addEventListener('click', wrap(async e => {
    if (!showing()) return undefined;
    const b = e.target.closest('#page [data-wk]'); if (!b) return undefined;
    return act(b.dataset.wk, b);
  }));
  document.addEventListener('keydown', e => {
    if (!showing() || e.key !== 'Enter') return;
    if (e.target.id === 'wkWho') { e.preventDefault(); wrap(() => act('who'))(); }
    if (e.target.id === 'wkKey') { e.preventDefault(); wrap(() => act('savekey'))(); }
  });

  return { render: () => { render(); if (!W.loading && (!W.data || Date.now() - W.at > 60000)) load(false); }, changed: () => { if (showing()) load(true); else W.at = 0; }, count, load };
})();

// The sidebar's entry (the standard layout; the saga themes keep theirs and reach it with Ctrl+K).
function workNav() {
  const n = Work.count();
  return `<button class="nav-i" data-view="work" aria-current="${S.view === 'work'}"><span class="glyph" aria-hidden="true">⇄</span><span class="ni-t">${esc(voice('Your work'))}</span>${n ? `<span class="tag gilt">${n}</span>` : ''}</button>`;
}
