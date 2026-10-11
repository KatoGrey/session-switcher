'use strict';
// The fix pipeline: each bug chat and the pull request on its branch, by how far it's got.
//   Working   a bug chat with no pull request yet
//   PR        a pull request is open
//   Preview   it has the `preview` label (a live copy is being built or is up)
//   Testers   it has the `community-qa` label (testers have been asked to try it)
//   Merged    merged in the last 7 days
// Pull requests come from `gh pr list` in each chat's repo (cached for a minute and a half), matched
// to chats by branch name. Checks and whether the chat is working or waiting on you come along.

const { execFile } = require('child_process');

const CACHE_MS = 90e3;
const MERGED_DAYS = 7;
const DEFAULT_BRANCHES = new Set(['main', 'master', 'internal', 'alpha', 'beta', 'production', 'develop', 'HEAD']);

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
// Which column a chat (and its PR, if any) sits in; null to leave it off the board. Pure, for tests.
function stageOf(pr, now = Date.now()) {
  if (!pr) return 'working';
  if (pr.state === 'MERGED') return now - Date.parse(pr.mergedAt || pr.updatedAt || 0) < MERGED_DAYS * 864e5 ? 'merged' : null;
  if (pr.state === 'CLOSED') return null;
  const labels = new Set((pr.labels || []).map(l => (typeof l === 'string' ? l : l.name)));
  if (labels.has('community-qa')) return 'testers';
  if (labels.has('preview')) return 'preview';
  return 'pr';
}

const fs = require('fs');
const run = (args, cwd, ms = 25e3) => new Promise(resolve => {
  execFile(args[0], args.slice(1), { cwd, timeout: ms, maxBuffer: 16 * 1024 * 1024 }, (err, out, errOut) => resolve(err ? { error: (String(errOut || '').trim().split('\n').pop() || err.message).slice(0, 200) } : { out }));
});
const DAY = 864e5;

function createPipeline({ log = () => {} } = {}) {
  const repoOf = new Map();   // folder -> the repo's main folder (worktrees share one), or null
  const cache = new Map();    // main folder -> { at, prs, error, loading }
  const checks = new Map();   // "folder#n" -> { at, ci }
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
  // Your open pull requests and the ones merged lately (gh's check summary is too heavy to ask for
  // a whole list at once in a big repo, so checks come per PR below).
  function prsIn(root) {
    const hit = cache.get(root);
    if (hit && (hit.loading || Date.now() - hit.at < CACHE_MS)) return hit.loading || Promise.resolve(hit);
    const fields = 'number,title,url,headRefName,state,isDraft,labels,updatedAt,mergedAt,reviewDecision';
    const loading = Promise.all([
      run(['gh', 'pr', 'list', '--state', 'open', '--author', '@me', '--limit', '100', '--json', fields], root),
      run(['gh', 'pr', 'list', '--state', 'merged', '--author', '@me', '--limit', '30', '--json', fields], root),
    ]).then(([open, merged]) => {
      let prs = [], error = open.error || null;
      for (const r of [open, merged]) if (r.out) { try { prs = prs.concat(JSON.parse(r.out)); } catch { error = error || 'Couldn’t read gh’s answer.'; } }
      if (error) log(`Lite pipeline: gh in ${root}: ${error}`);
      const entry = { at: Date.now(), prs, error, loading: null };
      cache.set(root, entry); return entry;
    });
    cache.set(root, { ...(hit || { prs: [], error: null }), at: hit ? hit.at : 0, loading });
    return loading;
  }
  async function ciFor(root, n) {
    const k = `${root}#${n}`, hit = checks.get(k);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.ci;
    const r = await run(['gh', 'pr', 'checks', String(n), '--json', 'name,bucket'], root);
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
    const cands = chats.filter(c => !c.archived && ((c.branch && !DEFAULT_BRANCHES.has(c.branch)) || fromRoutine(c)));
    const roots = await Promise.all(cands.map(c => mainRepo(c.runDir || c.cwd)));
    const repos = [...new Set(roots.filter(Boolean))];
    const byRepo = new Map(await Promise.all(repos.map(async r => [r, await prsIn(r)])));
    const errors = [...byRepo].filter(([, e]) => e.error && !/no git remotes/i.test(e.error)).map(([repo, e]) => ({ repo, error: e.error }));
    const rows = [];
    cands.forEach((c, i) => {
      const root = roots[i], repo = root && byRepo.get(root);
      const pr = repo && c.branch && !DEFAULT_BRANCHES.has(c.branch) ? (repo.prs || []).filter(p => p.headRefName === c.branch).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] || null : null;
      const bug = fromRoutine(c) || c.kind === 'bug';
      if (!pr && !fromRoutine(c)) return;
      if (pr && !bug && now - (c.updated || 0) > 14 * DAY) return;
      const stage = stageOf(pr, now);
      if (!stage || (stage === 'working' && (c.status === 'done' || now - (c.updated || 0) > 14 * DAY))) return;
      rows.push({ c, pr, root, stage });
    });
    // One card per pull request: the chat that worked on it most recently.
    const byPr = new Map();
    for (const r of rows) { const k = r.pr ? `${r.root}#${r.pr.number}` : `chat:${r.c.id}`; const was = byPr.get(k); if (!was || (r.c.updated || 0) > (was.c.updated || 0)) byPr.set(k, r); }
    const kept = [...byPr.values()];
    const cis = await limited(kept.map(r => () => (r.pr && r.pr.state === 'OPEN' ? ciFor(r.root, r.pr.number) : Promise.resolve(null))));
    const items = kept.map(({ c, pr, stage }, i) => {
      const l = liveBy.get(String(c.id).toLowerCase());
      return {
        chat: c.id, title: String(c.title || c.fullTitle || '').replace(/\s*\(from [^)]+\)\s*$/, ''), provider: c.provider, branch: c.branch || null, stage,
        updated: Math.max(c.updated || 0, pr ? Date.parse(pr.updatedAt) || 0 : 0),
        live: l ? { working: !!l.working, waiting: !!(l.pending && l.pending.length) } : null,
        waiting: !!c.waiting,
        pr: pr ? { number: pr.number, url: pr.url, title: pr.title, draft: !!pr.isDraft, labels: (pr.labels || []).map(x => x.name).filter(n => !['agent-generated', 'community-qa-notified'].includes(n)), ci: cis[i] || { state: 'none', failing: [], pending: 0 }, review: pr.reviewDecision || null } : null,
      };
    }).sort((a, b) => b.updated - a.updated);
    return { items, errors, at: Date.now() };
  }
  return { view, refresh: () => { cache.clear(); checks.clear(); } };
}

module.exports = { createPipeline, ciOf, stageOf };
