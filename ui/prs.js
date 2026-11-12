'use strict';
/* Pull requests: yours, the ones waiting on your review and the ones assigned to you, across GitHub, as
   whoever is signed in to gh on this computer; one PR's checks, open review threads and reviewers; and a
   click to have Claude or Codex review it, fix its review comments or its failing checks (in the chat that
   made it, when there is one), or make one from a chat. The chats follow each repository's own PR
   instructions. GitHub's own sign-in (gh, with its one-time code shown here) is in Connections. (lib/prs.js) */

const PRS = { tab: 'authored', data: null, err: null, loading: false, gh: null, details: new Map(), openKey: null, folder: null, folderData: null };
const PR_TABS = [['authored', 'Yours'], ['review', 'To review'], ['assigned', 'Assigned to you']];
const prKey = (repo, n) => `${String(repo).toLowerCase()}#${n}`;
const DECISION = { APPROVED: ['Approved', 'ok'], CHANGES_REQUESTED: ['Changes requested', 'bad'], REVIEW_REQUIRED: ['Review required', ''] };

/* ---------- GitHub's sign-in (shown in Connections, and here when it's needed) ---------- */

async function ghLoad(fresh = false) {
  try { PRS.gh = await api(`/api/prs/status${fresh ? '?fresh=1' : ''}`); } catch (err) { PRS.gh = { error: err.message }; }
  return PRS.gh;
}
function ghHtml(gh, { inConnections = false } = {}) {
  if (!gh) return '<p class="loading">Asking gh who’s signed in to GitHub…</p>';
  const si = gh.signIn;
  if (si && (si.state === 'waiting' || si.state === 'starting')) {
    return `<div class="gh-code"><p>Enter this code on GitHub to sign in${gh.signedIn ? ' with another account' : ''}:</p>
      <p class="cx-code">${esc(si.code || '…')}</p>
      <div class="d-row cx-row"><a class="btn prime" href="${esc(si.url || 'https://github.com/login/device')}" target="_blank" rel="noopener noreferrer">Open github.com/login/device</a><button type="button" class="btn" data-pr="copycode" data-code="${esc(si.code || '')}">Copy code</button><button type="button" class="btn quiet" data-pr="signincancel">Cancel</button></div>
      <p class="cx-wait"><span class="gen-spin" aria-hidden="true"></span>Waiting for you to approve it. This updates by itself.</p></div>`;
  }
  const failed = si && si.state === 'failed' ? `<p class="mcp-err">${esc(si.error || 'The GitHub sign-in didn’t finish.')}</p>` : '';
  if (gh.error && gh.installed === undefined) return `<p class="rd-state warn">${esc(gh.error)}</p>`;
  if (gh.installed === false) return `<p class="rd-state warn">GitHub’s <code>gh</code> isn’t installed on this computer, so pull requests can’t be read or made here. Install it from <a href="https://cli.github.com" target="_blank" rel="noopener noreferrer">cli.github.com</a>, then check again.</p><div class="lm-b"><button type="button" class="btn quiet sm" data-pr="ghrefresh">Check again</button></div>`;
  if (!gh.signedIn) return `${failed}<p class="rd-state">Not signed in to GitHub${gh.error ? ` (${esc(gh.error)})` : ''}. Sign in to see your pull requests and have Claude or Codex review and make them.</p><div class="lm-b"><button type="button" class="btn gilt" data-pr="signin">Sign in to GitHub</button></div>`;
  const others = (gh.accounts || []).filter(a => a.host === gh.host && a.login !== gh.login);
  return `${failed}<div class="gh-who"><span class="cn-yes">✓</span><span>Signed in to GitHub as <b>${esc(gh.login)}</b>${(gh.accounts.find(a => a.active) || {}).scopes ? `<small>${esc(gh.accounts.find(a => a.active).scopes.join(', '))}</small>` : ''}</span><span class="spacer"></span>
    ${inConnections ? '<button type="button" class="btn sm" data-pr="open">Your pull requests</button>' : ''}
    ${others.length ? `<button type="button" class="btn quiet sm" data-pr="switch" aria-haspopup="menu">Switch account</button>` : ''}
    <button type="button" class="btn quiet sm" data-pr="signin" title="Sign in with another GitHub account too; switch between them here">Add an account</button></div>
    <p class="gh-note">Claude and Codex use this sign-in too, through <code>gh</code>, when they push and make pull requests.</p>`;
}
async function ghAction(act, b) {
  if (act === 'signin') { const r = await api('/api/prs/signin', {}); PRS.gh = { ...(PRS.gh || {}), signIn: r.signIn }; return prsRedraw(); }
  if (act === 'signincancel') { await api('/api/prs/signin-cancel', {}); await ghLoad(); return prsRedraw(); }
  if (act === 'copycode') { const ok = await copyText(b.dataset.code, null); if (ok) { b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = 'Copy code'; }, 1500); } return undefined; }
  if (act === 'ghrefresh') { await ghLoad(true); return prsRedraw(); }
  if (act === 'switch') {
    const gh = PRS.gh || {};
    return showMenu(b, (gh.accounts || []).filter(a => a.host === gh.host).map(a => ({ label: a.login, hint: a.active ? 'in use' : '', disabled: a.active, run: async () => { PRS.gh = await api('/api/prs/switch', { user: a.login }); PRS.data = null; PRS.details.clear(); toast(`Using ${a.login} on GitHub now.`); prsRedraw(); if ($('prDlg') && $('prDlg').open) prsLoad(true); } })));
  }
  return undefined;
}
// What's showing GitHub's status (Connections, or the pull requests window) draws it again.
function prsRedraw() {
  const box = $('cnGitHub'); if (box) box.innerHTML = ghHtml(PRS.gh, { inConnections: true });
  if ($('prDlg') && $('prDlg').open) prsRender();
}
// The PC says the sign-in moved on (the code is ready, or it's done).
async function prsChanged(d) {
  const si = d && d.signIn;
  await ghLoad(si && si.state === 'done');
  if (si && si.state === 'done') { toast(`Signed in to GitHub as ${PRS.gh.login || 'you'}.`, 5000); PRS.data = null; if ($('prDlg') && $('prDlg').open) prsLoad(true); }
  prsRedraw();
}

/* ---------- the window ---------- */

function prDialog() {
  let d = $('prDlg');
  if (d) return d;
  document.body.insertAdjacentHTML('beforeend', `<dialog id="prDlg" class="wide pr-dlg" aria-labelledby="prTitle">
    <div class="setup-head"><h3 id="prTitle">Pull requests</h3><div class="stabs" role="tablist" aria-label="Which pull requests" id="prTabs"></div><button class="icon" data-pr="close" aria-label="Close">✕</button></div>
    <div class="rd-body" id="prBody"><p class="loading">Asking GitHub…</p></div></dialog>`);
  d = $('prDlg');
  d.addEventListener('click', wrap(async e => {
    if (e.target === d) return d.close();
    const tab = e.target.closest('[data-prtab]'); if (tab) { PRS.tab = tab.dataset.prtab; return prsRender(); }
    const b = e.target.closest('[data-pr]'); if (!b) return undefined;
    return prAction(b.dataset.pr, b);
  }));
  return d;
}
// folder: a project's folder, for just its repo's pull requests that involve you.
async function openPrs({ folder = null, show = null } = {}) {
  const d = prDialog();
  Object.assign(PRS, { folder, folderData: null, err: null, openKey: null, tab: folder ? 'folder' : (PRS.tab === 'folder' ? 'authored' : PRS.tab) });
  if (show && PRS.data) {
    const k = prKey(show.repo, show.n);
    const tab = PR_TABS.map(([t]) => t).find(t => (PRS.data[t] || []).some(p => prKey(p.repo, p.number) === k));
    if (tab) { PRS.tab = tab; PRS.openKey = k; }
  }
  if (!d.open) d.showModal();
  prsRender();
  if (!PRS.gh || !PRS.gh.signedIn) await ghLoad();
  prsRender();
  if (PRS.gh && PRS.gh.signedIn) await prsLoad(false);
  if (PRS.openKey && !PRS.details.has(PRS.openKey)) {
    const [repo, n] = PRS.openKey.split('#');
    try { PRS.details.set(PRS.openKey, await api(`/api/prs/detail?repo=${encodeURIComponent(repo)}&n=${n}`)); } catch (err) { PRS.details.set(PRS.openKey, { error: err.message }); }
    prsRender();
    document.querySelector('.pr-row.open')?.scrollIntoView({ block: 'nearest' });
  }
  if (typeof renderPrHub === 'function') renderPrHub();
}
async function prsLoad(fresh) {
  PRS.loading = true; prsRender();
  try {
    if (PRS.folder) PRS.folderData = await api(`/api/prs/folder?cwd=${encodeURIComponent(PRS.folder)}${fresh ? '&fresh=1' : ''}`);
    else PRS.data = await api(`/api/prs/mine${fresh ? '?fresh=1' : ''}`);
    PRS.err = null;
  } catch (err) { PRS.err = err.message; }
  PRS.loading = false;
  prsRender();
}
function prsList() {
  if (PRS.folder) return (PRS.folderData && PRS.folderData.prs) || null;
  return PRS.data ? PRS.data[PRS.tab] || [] : null;
}
function prsRender() {
  const box = $('prBody'); if (!box) return;
  const tabs = $('prTabs');
  const count = k => (PRS.data && PRS.data[k] ? ` (${PRS.data[k].length})` : '');
  tabs.innerHTML = PRS.folder ? `<button role="tab" aria-selected="true">${esc((PRS.folderData && PRS.folderData.repo) || 'This repo')}</button>`
    : PR_TABS.map(([k, label]) => `<button role="tab" data-prtab="${k}" aria-selected="${PRS.tab === k}">${label}${count(k)}</button>`).join('');
  const gh = PRS.gh;
  if (!gh || !gh.signedIn) { box.innerHTML = `<div class="gh-box">${ghHtml(gh)}</div>`; return; }
  const list = prsList();
  const head = `<div class="pr-top"><span>GitHub: <b>${esc(gh.login)}</b>${PRS.data && PRS.data.at && !PRS.folder ? ` · checked ${esc(agoL(PRS.data.at))}` : ''}</span><span class="spacer"></span><button type="button" class="btn quiet sm" data-pr="refresh"${PRS.loading ? ' disabled' : ''}>${PRS.loading ? 'Checking…' : 'Check again'}</button></div>`;
  if (PRS.err) { box.innerHTML = `${head}<p class="rd-state warn">${esc(PRS.err)}</p>`; return; }
  if (!list) { box.innerHTML = `${head}<p class="loading">Asking GitHub for your pull requests…</p>`; return; }
  if (PRS.folder && PRS.folderData && !PRS.folderData.repo) { box.innerHTML = `${head}<p class="rd-state">This folder isn’t on GitHub (none of its git remotes point there).</p>`; return; }
  const empty = { authored: 'You have no open pull requests.', review: 'Nobody is waiting on your review right now.', assigned: 'No open pull requests are assigned to you.', folder: 'No open pull requests here involve you.' }[PRS.folder ? 'folder' : PRS.tab];
  box.innerHTML = `${head}${list.length ? `<ul class="pr-list">${list.map(prRow).join('')}</ul>` : `<p class="rd-state">${empty}</p>`}`;
}
function prRow(p) {
  const k = prKey(p.repo, p.number), open = PRS.openKey === k;
  const dec = DECISION[p.reviewDecision];
  const tags = [p.isDraft ? '<span class="tag">Draft</span>' : '', dec ? `<span class="tag pr-dec ${dec[1]}">${dec[0]}</span>` : ''].join('');
  return `<li class="pr-row${open ? ' open' : ''}" data-key="${esc(k)}">
    <button type="button" class="pr-head" data-pr="toggle" data-repo="${esc(p.repo)}" data-n="${p.number}" aria-expanded="${open}">
      <span class="pr-num">#${p.number}</span><span class="pr-t">${esc(p.title)}</span>${tags}
      <span class="pr-meta">${esc(p.repo)}${p.author && PRS.tab !== 'authored' ? ` · by ${esc(p.author)}` : ''}${p.updatedAt ? ` · updated ${esc(agoL(p.updatedAt))}` : ''}</span></button>
    ${open ? `<div class="pr-detail">${prDetailHtml(PRS.details.get(k))}</div>` : ''}</li>`;
}
function prDetailHtml(d) {
  if (!d) return '<p class="loading">Asking GitHub about it…</p>';
  if (d.error) return `<p class="rd-state warn">${esc(d.error)}</p>`;
  const c = d.checks;
  const checks = [c.failed.length ? `<span class="cn-bad">✗ ${c.failed.length} failing</span>${c.failed.slice(0, 4).map(x => `<a href="${esc(x.url || d.url)}" target="_blank" rel="noopener noreferrer">${esc(x.name)}</a>`).join(', ')}` : '',
    c.pending ? `⏳ ${c.pending} running` : '', c.passed ? `<span class="cn-yes">✓ ${c.passed} passed</span>` : '', c.cancelled ? `${c.cancelled} cancelled` : ''].filter(Boolean).join(' · ') || 'none yet';
  const reviews = [d.reviewers.length ? `waiting on ${esc(d.reviewers.join(', '))}` : '', ...d.reviews.map(r => `${esc(r.author)} ${esc({ APPROVED: 'approved', CHANGES_REQUESTED: 'asked for changes', COMMENTED: 'commented', DISMISSED: 'was dismissed' }[r.state] || r.state.toLowerCase())}`)].filter(Boolean).join(' · ') || 'none yet';
  const who = name => `<button type="button" class="btn sm" data-pr="${name}" data-repo="${esc(d.repo)}" data-n="${d.number}" aria-haspopup="menu">`;
  const acts = [];
  if (d.clones.length) {
    acts.push(`${who('review')}Review it…</button>`);
    if (d.mine && d.open) acts.push(`${who('fix-comments')}Fix ${d.open} comment${d.open === 1 ? '' : 's'}…</button>`);
    if (d.mine && c.failed.length) acts.push(`${who('fix-checks')}Fix the failing check${c.failed.length === 1 ? '' : 's'}…</button>`);
  }
  acts.push(`<a class="btn quiet sm" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Open on GitHub</a>`);
  if (d.preview) acts.push(`<a class="btn quiet sm" href="${esc(d.preview)}" target="_blank" rel="noopener noreferrer">Its preview</a>`);
  return `<p class="pr-line">+${d.additions} −${d.deletions} in ${d.changedFiles} file${d.changedFiles === 1 ? '' : 's'} · <code>${esc(d.head)}</code> → <code>${esc(d.base)}</code>${d.author ? ` · by ${esc(d.author)}` : ''}${d.mergeable === 'CONFLICTING' ? ' · <span class="cn-bad">has conflicts</span>' : ''}</p>
    <p class="pr-line"><span class="pr-k">Checks</span>${checks}</p>
    <p class="pr-line"><span class="pr-k">Reviews</span>${reviews}</p>
    <p class="pr-line"><span class="pr-k">Comments</span>${d.open ? `${d.open} open review thread${d.open === 1 ? '' : 's'}` : 'no open review threads'}</p>
    ${d.chat ? `<p class="pr-line"><span class="pr-k">Chat</span>Made in “${esc(d.chat.title || 'a chat')}” <button type="button" class="linkish" data-pr="chat" data-id="${esc(d.chat.sessionId)}">Open it</button></p>` : ''}
    ${d.clones.length ? '' : `<p class="rd-state">No folder on this computer has ${esc(d.repo)}, so Claude and Codex can’t work on it here. Clone it and open it once in a chat, then check again.</p>`}
    <div class="lm-b">${acts.join('')}</div>`;
}
// Claude as one of your accounts, or Codex: who does it.
function prWhoItems(d, action) {
  const items = [];
  const reuse = action !== 'review' && d.chat;
  for (const a of (S.accounts || []).filter(x => canLaunch(x))) items.push({ glyph: '✦', label: `Claude · ${a.name}`, hint: reuse ? `in “${d.chat.title || 'the chat that made it'}”` : 'a new chat', run: () => prGo(d, action, 'claude', a.id) });
  if (reuse) items.push({ glyph: '✦', label: 'Claude, in a new chat', hint: `as ${current().name}`, run: () => prGo(d, action, 'claude', current().id, true) });
  if (codexOK()) items.push({ glyph: '◆', label: 'Codex', hint: 'a new chat', run: () => prGo(d, action, 'codex', (S.codex && S.codex.id) || 'codex') });
  return items;
}
async function prGo(d, action, provider, account, fresh = false) {
  toast(action === 'review' ? `Fetching #${d.number} and starting the review…` : 'Starting…', 4000);
  const r = await api('/api/prs/act', { action, repo: d.repo, n: d.number, provider, account, fresh, cwd: d.clones[0] });
  if ($('prDlg')) $('prDlg').close();
  if ($('connDlg')) $('connDlg').close();
  await ChatUI.openKey(r.key);
  if (r.resumed) toast('It carries on in the chat that made the pull request, which knows the work.', 6000);
}
async function prAction(act, b) {
  if (act === 'close') return $('prDlg').close();
  if (act === 'refresh') { PRS.details.clear(); return prsLoad(true); }
  if (act === 'open') { if ($('connDlg')) $('connDlg').close(); return openPrs(); }
  if (act === 'toggle') {
    const k = prKey(b.dataset.repo, b.dataset.n);
    PRS.openKey = PRS.openKey === k ? null : k;
    prsRender();
    if (PRS.openKey === k && !PRS.details.has(k)) {
      try { PRS.details.set(k, await api(`/api/prs/detail?repo=${encodeURIComponent(b.dataset.repo)}&n=${b.dataset.n}`)); } catch (err) { PRS.details.set(k, { error: err.message }); }
      prsRender();
    }
    return undefined;
  }
  if (act === 'review' || act === 'fix-comments' || act === 'fix-checks') {
    const d = PRS.details.get(prKey(b.dataset.repo, b.dataset.n)); if (!d) return undefined;
    const items = prWhoItems(d, act);
    if (!items.length) { toast('Sign in to a Claude account or Codex first.'); return undefined; }
    return showMenu(b, items);
  }
  if (act === 'chat') { $('prDlg').close(); return ChatUI.open({ sessionId: b.dataset.id }); }
  return ghAction(act, b);
}
// (GitHub's buttons in Connections.)
document.addEventListener('click', wrap(async e => {
  const b = e.target.closest('#cnGitHub [data-pr]'); if (!b) return undefined;
  return prAction(b.dataset.pr, b);
}));

/* ---------- on the hub ---------- */

// What's waiting on you on GitHub, under "Pull requests": reviews asked of you first, then the ones assigned
// to you, then yours. Only when gh is signed in and there's something; asked again every couple of minutes.
const PrHub = { at: 0, loading: false };
const prHubRows = () => {
  const d = PRS.data; if (!d) return [];
  const seen = new Set(), out = [];
  for (const [role, list] of [['review', d.review], ['assigned', d.assigned], ['authored', d.authored]]) for (const p of list || []) { const k = prKey(p.repo, p.number); if (!seen.has(k)) { seen.add(k); out.push({ ...p, role }); } }
  return out;
};
const prHubCount = () => prHubRows().length;
function renderPrHub() {
  const sec = $('secPrs'), list = $('prHubList');
  if (!sec || !list) return;
  if (Date.now() - PrHub.at > 120000 && !PrHub.loading) {
    PrHub.loading = true;
    (async () => {
      try {
        if (!PRS.gh || !PRS.gh.signedIn) await ghLoad();
        if (PRS.gh && PRS.gh.signedIn) PRS.data = await api('/api/prs/mine');
      } catch { /* the hub just doesn't show it */ }
      PrHub.at = Date.now(); PrHub.loading = false;
      renderPrHub(); if (typeof renderJump === 'function') renderJump();
    })();
  }
  const rows = prHubRows();
  sec.hidden = !rows.length;
  const role = { review: 'waiting on your review', assigned: 'assigned to you', authored: 'yours' };
  list.innerHTML = rows.slice(0, 6).map(p => `<li><button type="button" class="pr-hub-row" data-act="pr-open" data-repo="${esc(p.repo)}" data-n="${p.number}"><span class="pr-num">#${p.number}</span><span class="pr-t">${esc(p.title)}</span>${p.isDraft ? '<span class="tag">Draft</span>' : ''}<span class="pr-meta">${esc(p.repo)} · ${role[p.role]}${p.updatedAt ? ` · updated ${esc(agoL(p.updatedAt))}` : ''}</span></button></li>`).join('')
    + (rows.length > 6 ? `<li><button type="button" class="linkish pr-hub-more" data-act="prs">${rows.length - 6} more…</button></li>` : '');
  if (typeof setSecCount === 'function') setSecCount('prs', rows.length);
}

/* ---------- in a chat ---------- */

// "Make a pull request" (the chat menu, or /pr): the chat commits its work on a branch, pushes it and opens
// the PR the way its repository asks.
async function makePrFromChat(src = 'main') {
  const key = keyFor(src);
  if (!key || C.state === 'ended') { toast('This chat isn’t running. Start it again first.'); return; }
  const name = PROV_NAME[provFor(src)] || 'Claude';
  const note = await ask('Make a pull request', `${name} commits this chat’s work on a branch, pushes it and opens the pull request the way this repository asks (its PR instructions and template). Anything to add? A ticket like VOY-1234, “make it a draft”, who should review. Or leave it empty.`, '', 'Make the pull request', { allowEmpty: true, maxLength: 300, placeholder: 'Optional' });
  if (note === null) return;
  await api('/api/chat/make-pr', { key, note });
}
