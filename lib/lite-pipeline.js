'use strict';
// The fix pipeline: each bug chat and the pull request on its branch, by how far it's got.
//   Working   a bug chat with no pull request yet
//   PR        a pull request is open
//   Preview   (Latitude) it has the `preview` label (a live copy is being built or is up)
//   Testers   (Latitude) it has the `community-qa` label (testers have been asked to try it)
//   Merged    merged in the last 7 days
// Pull requests come from `gh pr list -R owner/repo` for the GitHub repo each chat's folder pushes
// to (cached for a minute and a half), matched to chats by branch name. Checks and whether the chat
// is working or waiting on you come along. Folders whose repo isn't on GitHub have no pull requests.

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CACHE_MS = 90e3;
const MERGED_DAYS = 7;
const DEFAULT_BRANCHES = new Set(['main', 'master', 'internal', 'alpha', 'beta', 'production', 'develop', 'HEAD']);

// Repos with extras of their own; every other GitHub repo gets the plain board (PR, checks, merged).
//   preview   the link to a pull request's live copy
//   labels    labels that put a pull request in a later column, the first that matches winning
//   hide      labels not worth showing on its card
const REPOS = {
  'latitudegames/latitude': {
    preview: n => `https://pr-${n}.preview.voyage.io/`,
    labels: { 'community-qa': 'testers', preview: 'preview' },
    hide: ['agent-generated', 'community-qa-notified'],
  },
};
const PLAIN = { preview: null, labels: {}, hide: [] };
const repoProfile = slug => REPOS[String(slug || '').toLowerCase()] || PLAIN;

// owner/repo from a remote's URL when it's on github.com (https, ssh or git@host:owner/repo, with
// or without .git), else null. aliases: other names ssh knows GitHub by (see sshAliases). Pure, for tests.
function githubRepoOf(url, aliases = []) {
  const m = /^(?:(https?|ssh|git):\/\/(?:[^@/\s]+@)?([^/:\s]+)(?::\d+)?\/|(?:[^@\s/]+@)?([^:\s/]+):\/?)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(String(url || '').trim());
  if (!m || m[5] === '.' || m[5] === '..') return null;
  const host = (m[2] || m[3]).toLowerCase(), viaSsh = !m[1] || /^(ssh|git)$/i.test(m[1]);
  const github = host === 'github.com' || host === 'www.github.com'
    || (viaSsh && (host === 'ssh.github.com' || /^github\.com-/.test(host) || aliases.some(a => a.toLowerCase() === host)));
  return github ? `${m[4]}/${m[5]}` : null;
}
// Hosts ~/.ssh/config names GitHub by (Host work → HostName github.com); gh reads them the same way.
function sshAliases(file = path.join(os.homedir(), '.ssh', 'config')) {
  let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = []; let hosts = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(host|hostname)\b\s*=?\s*(.+?)\s*$/i.exec(line); if (!m) continue;
    if (m[1].toLowerCase() === 'host') hosts = m[2].split(/\s+/).filter(h => !/[*?!]/.test(h));
    else if (/^(ssh\.)?github\.com$/i.test(m[2])) out.push(...hosts);
  }
  return out;
}
// Which remote gh would ask about, from `git config --get-regexp ^remote\.` lines: the one `gh repo
// set-default` picked, else upstream, github, origin, then the rest. Pure, for tests.
function pickRemote(configText, aliases = []) {
  const remotes = new Map();   // name -> { url, resolved }
  for (const line of String(configText || '').split(/\r?\n/)) {
    const m = /^remote\.(.+)\.(url|gh-resolved)\s+(.+)$/.exec(line.trim()); if (!m) continue;
    const r = remotes.get(m[1]) || {}; r[m[2] === 'url' ? 'url' : 'resolved'] = m[3].trim(); remotes.set(m[1], r);
  }
  const gh = r => githubRepoOf(r.url, aliases);
  for (const r of remotes.values()) {
    if (r.resolved === 'base' && gh(r)) return gh(r);
    if (r.resolved && r.resolved !== 'base' && /^[\w.-]+\/[\w.-]+$/.test(r.resolved) && gh(r)) return r.resolved;
  }
  const rank = n => ({ upstream: 3, github: 2, origin: 1 }[n.toLowerCase()] || 0);
  const names = [...remotes.keys()].sort((a, b) => rank(b) - rank(a));
  for (const n of names) { const slug = gh(remotes.get(n)); if (slug) return slug; }
  return null;
}

// Checks on a PR, in one word plus the names that failed. Takes `gh pr checks --json name,bucket`
// rows (bucket: pass, fail, pending, skipping, cancel) or GraphQL rollup rows. Pure, for tests.
function ciOf(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const failing = [], pending = [];
  for (const c of list) {
    const name = c.name || c.context || 'check';
    const bucket = String(c.bucket || '').toLowerCase();
    const concl = String(c.conclusion || c.state || '').toUpperCase();
    const status = String(c.status || '').toUpperCase();
    // A policy check that waits for a draft to be marked ready isn't "still running".
    if (/(^|[-_\s])policy$/i.test(name) && (bucket === 'pending' || status === 'IN_PROGRESS' || status === 'QUEUED')) continue;
    if (bucket ? bucket === 'fail' || bucket === 'cancel' : ['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(concl)) failing.push(name);
    else if (bucket ? bucket === 'pending' : (status && status !== 'COMPLETED') || concl === 'PENDING' || concl === 'EXPECTED') pending.push(name);
  }
  const state = !list.length ? 'none' : failing.length ? 'failing' : pending.length ? 'pending' : 'passing';
  return { state, failing: failing.slice(0, 8), pending: pending.length };
}
// Which column a chat (and its PR, if any) sits in; null to leave it off the board. repo: the PR's
// owner/repo, for its own labels (REPOS). Pure, for tests.
function stageOf(pr, now = Date.now(), repo = null) {
  if (!pr) return 'working';
  if (pr.state === 'MERGED') return now - Date.parse(pr.mergedAt || pr.updatedAt || 0) < MERGED_DAYS * 864e5 ? 'merged' : null;
  if (pr.state === 'CLOSED') return null;
  const labels = new Set((pr.labels || []).map(l => (typeof l === 'string' ? l : l.name)));
  for (const [label, stage] of Object.entries(repoProfile(repo).labels)) if (labels.has(label)) return stage;
  return 'pr';
}

// git and gh run directly, no shell (gh.exe and git.exe are real programs on Windows too).
const run = (args, cwd, ms = 25e3) => new Promise(resolve => {
  execFile(args[0], args.slice(1), { cwd, timeout: ms, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, out, errOut) => resolve(err ? { error: (String(errOut || '').trim().split('\n').pop() || err.message).slice(0, 200) } : { out }));
});
const DAY = 864e5;
const SLUG_MS = 10 * 60e3;

function createPipeline({ log = () => {}, lastReply = null, recentReplies = null } = {}) {
  const repoOf = new Map();   // folder -> the repo's main folder (worktrees share one), or null
  const slugOf = new Map();   // main folder -> { at, slug }: its GitHub owner/repo, or null
  const cache = new Map();    // owner/repo -> { at, prs, error, loading }
  const checks = new Map();   // "owner/repo#n" -> { at, ci }
  const replyPr = new Map();  // chat id -> { updated, n, report }: the PRs a chat's recent reports name, and its last STATUS word
  // A chat that works in the main checkout (a Codex fix chat, say) has no branch of its own to
  // match, so read the PR number from its latest report ("PR #16990", ".../pull/16990").
  async function prNamedBy(c) {
    if (!lastReply && !recentReplies) return null;
    const hit = replyPr.get(c.id);
    if (hit && hit.updated === c.updated) return hit;
    let n = null, report = null;
    try {
      let t = '';
      if (recentReplies) { try { t = String(await recentReplies(c.id, c.provider) || ''); } catch (err) { log(`Lite pipeline: reading ${c.id}: ${err.message}`); } }
      if (!t && lastReply) t = String(await lastReply(c.id, c.provider) || '');
      // Every PR number it names, best first: the STATUS line's, then /pull/ links (newest first),
      // then "PR #n". A report can also name other PRs (one it builds on or reverses), so the
      // caller takes the first that's one of your pull requests.
      const status = (t.match(/^[*_>\s]*STATUS:.*$/gim) || []).pop() || '';
      report = (/STATUS:[*_\s]*(READY-FOR-RYAN|WITH-TESTERS|NEEDS-RYAN|BLOCKED|DONE)\b/i.exec(status) || [])[1] || null;
      if (report) report = report.toUpperCase();
      const nums = re => [...t.matchAll(re)].map(x => Number(x[1])).reverse();
      const fromStatus = [...status.matchAll(/(?:PR\s*#|\/pull\/|#|\bpr-)(\d{4,6})\b/gi)].map(x => Number(x[1]));
      n = [...new Set([...fromStatus, ...nums(/\/pull\/(\d{4,6})\b/g), ...nums(/PR\s*#(\d{4,6})\b/g)])];
      // Branch names it mentions ("community-qa/studio-image-report"), matched to a PR's branch.
      const branches = [...new Set([...t.matchAll(/\b((?:community-qa|codex|fix|feat|bug)\/[\w.-]+)/g)].map(x => x[1].replace(/[.,)]+$/, '')))].reverse();
      n = n.concat(branches);
      if (!n.length) n = null;
    } catch { n = null; }
    const out = { updated: c.updated, n, report };
    replyPr.set(c.id, out);
    return out;
  }
  async function mainRepo(dir) {
    if (repoOf.has(dir)) return repoOf.get(dir);
    let root = null;
    if (dir && fs.existsSync(dir)) {
      const r = await run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], dir, 5e3);
      if (r.out) root = r.out.trim().replace(/[\\/]\.git$/, '') || null;
    }
    repoOf.set(dir, root);
    return root;
  }
  // The GitHub repo a main folder's pull requests are in (its remotes, read again every ten minutes;
  // the chats in one folder share a single look).
  function repoSlug(root) {
    const hit = slugOf.get(root);
    if (hit && Date.now() - hit.at < SLUG_MS) return hit.slug;
    const slug = run(['git', 'config', '--get-regexp', '^remote\\.'], root, 5e3).then(r => (r.out ? pickRemote(r.out, sshAliases()) : null));
    slugOf.set(root, { at: Date.now(), slug });
    return slug;
  }
  // Your open pull requests and the ones merged lately (gh's check summary is too heavy to ask for
  // a whole list at once in a big repo, so checks come per PR below).
  function prsIn(slug, root) {
    const hit = cache.get(slug);
    if (hit && (hit.loading || Date.now() - hit.at < CACHE_MS)) return hit.loading || Promise.resolve(hit);
    const fields = 'number,title,url,headRefName,state,isDraft,labels,updatedAt,mergedAt,reviewDecision';
    const loading = Promise.all([
      run(['gh', 'pr', 'list', '-R', slug, '--state', 'open', '--author', '@me', '--limit', '100', '--json', fields], root),
      run(['gh', 'pr', 'list', '-R', slug, '--state', 'merged', '--author', '@me', '--limit', '30', '--json', fields], root),
    ]).then(([open, merged]) => {
      let prs = [], error = open.error || null;
      for (const r of [open, merged]) if (r.out) { try { prs = prs.concat(JSON.parse(r.out)); } catch { error = error || 'Couldn’t read gh’s answer.'; } }
      if (error) log(`Lite pipeline: gh for ${slug}: ${error}`);
      const entry = { at: Date.now(), prs, error, loading: null };
      cache.set(slug, entry); return entry;
    });
    cache.set(slug, { ...(hit || { prs: [], error: null }), at: hit ? hit.at : 0, loading });
    return loading;
  }
  async function ciFor(slug, n, root) {
    const k = `${slug}#${n}`, hit = checks.get(k);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.ci;
    const r = await run(['gh', 'pr', 'checks', String(n), '-R', slug, '--json', 'name,bucket'], root);
    let rows = [];
    // gh exits non-zero when a check failed or is still running, but still prints the list.
    try { rows = JSON.parse(r.out || '[]'); } catch { rows = []; }
    const ci = ciOf(rows);
    checks.set(k, { at: Date.now(), ci });
    return ci;
  }
  async function limited(jobs, n = 4) {
    const out = []; let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => { while (i < jobs.length) { const j = i++; out[j] = await jobs[j](); } }));
    return out;
  }

  // chats: Lite's chat list; live: what's running. A chat shows when its branch has one of your
  // pull requests (bug chats always; others if touched in the last two weeks), and a bug chat a
  // routine started shows from the start, before it has one.
  async function view(chats, live, now = Date.now()) {
    const liveBy = new Map((live || []).filter(x => x.sessionId).map(x => [x.sessionId.toLowerCase(), x]));
    const fromRoutine = c => !!c.fromRoutine || /\(from [^)]+\)\s*$/.test(c.fullTitle || c.title || '');
    // Helper and script runs (c.auto) can work on a fix chat's branch too; the card belongs to the fix chat.
    const cands = chats.filter(c => !c.archived && !c.auto && ((c.branch && !DEFAULT_BRANCHES.has(c.branch)) || fromRoutine(c)));
    const roots = await Promise.all(cands.map(c => mainRepo(c.runDir || c.cwd)));
    const slugs = await Promise.all(roots.map(r => (r ? repoSlug(r) : null)));
    const repos = [...new Set(slugs.filter(Boolean))];
    const byRepo = new Map(await Promise.all(repos.map(async s => [s, await prsIn(s, roots[slugs.indexOf(s)])])));
    const errors = [...byRepo].filter(([, e]) => e.error && !/no git remotes/i.test(e.error)).map(([repo, e]) => ({ repo, error: e.error }));
    const rows = [];
    // A chat in its own worktree is on its own branch. One working in a shared checkout (the repo's
    // main folder) only reports whatever branch that folder has checked out right now, which may be
    // another chat's; there the PR its own replies name comes first.
    const ownBranch = c => !!c.runIsWorktree;
    // Sweep fix chats, and chats in a shared checkout, are read: for their STATUS line and their PR.
    const named = await limited(cands.map(c => () => (fromRoutine(c) || !ownBranch(c) ? prNamedBy(c) : Promise.resolve(null))), 6);
    cands.forEach((c, i) => {
      const root = roots[i], slug = slugs[i], repo = slug && byRepo.get(slug);
      const byBranch = repo && c.branch && !DEFAULT_BRANCHES.has(c.branch) ? (repo.prs || []).filter(p => p.headRefName === c.branch).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] || null : null;
      let byName = null;
      if (named[i] && named[i].n && repo) for (const ref of named[i].n) { byName = (repo.prs || []).find(p => (typeof ref === 'number' ? p.number === ref : p.headRefName === ref)) || null; if (byName) break; }
      // In a shared checkout the branch belongs to the folder, not the chat: only what it names counts.
      const pr = ownBranch(c) ? byBranch || byName : byName;
      const bug = fromRoutine(c) || c.kind === 'bug';
      if (!pr && !fromRoutine(c)) return;
      if (pr && !bug && now - (c.updated || 0) > 14 * DAY) return;
      const stage = stageOf(pr, now, slug);
      if (!stage || (stage === 'working' && (c.status === 'done' || now - (c.updated || 0) > 14 * DAY))) return;
      rows.push({ c, pr, root, slug, stage, report: named[i] ? named[i].report : null });
    });
    // One card per pull request: the chat that worked on it most recently.
    const byPr = new Map();
    for (const r of rows) { const k = r.pr ? `${r.slug}#${r.pr.number}` : `chat:${r.c.id}`; const was = byPr.get(k); if (!was || (r.c.updated || 0) > (was.c.updated || 0)) byPr.set(k, r); }
    const kept = [...byPr.values()];
    const cis = await limited(kept.map(r => () => (r.pr && r.pr.state === 'OPEN' ? ciFor(r.slug, r.pr.number, r.root) : Promise.resolve(null))));
    const items = kept.map(({ c, pr, slug, stage, report }, i) => {
      const l = liveBy.get(String(c.id).toLowerCase());
      const own = repoProfile(slug);
      return {
        chat: c.id, title: String(c.title || c.fullTitle || '').replace(/\s*\(from [^)]+\)\s*$/, ''), provider: c.provider, branch: c.branch || null, stage, repo: slug || null,
        updated: Math.max(c.updated || 0, pr ? Date.parse(pr.updatedAt) || 0 : 0),
        live: l ? { working: !!l.working, waiting: !!(l.pending && l.pending.length) } : null,
        waiting: !!c.waiting, report,
        pr: pr ? { number: pr.number, url: pr.url, title: pr.title, draft: !!pr.isDraft, review: pr.reviewDecision || null, labels: (pr.labels || []).map(x => x.name).filter(n => !own.hide.includes(n)), ci: cis[i] || { state: 'none', failing: [], pending: 0 }, review: pr.reviewDecision || null, preview: own.preview ? own.preview(pr.number) : null } : null,
      };
    }).sort((a, b) => b.updated - a.updated);
    return { items, errors, at: Date.now() };
  }
  return { view, refresh: () => { cache.clear(); checks.clear(); slugOf.clear(); } };
}

module.exports = { createPipeline, ciOf, stageOf, githubRepoOf, pickRemote, sshAliases, repoProfile, REPOS };
