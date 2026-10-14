'use strict';
// Switcher Lite's housekeeping: how much room chats' worktrees take, freeing it (dependencies and
// build output only), removing clean worktrees of archived chats and rebuilding them, and phone
// alerts by web push.
//
// Safety, in one place. Free space removes a folder only when all of these hold:
//  - its worktree is a real git worktree (git lists it), and the folder is inside it;
//  - it's named like dependencies, build output or a cache (lite.isRemovable), and isn't a link;
//  - git says it's ignored (so a committed "build" folder stays).
// Remove worktree runs `git worktree remove` without --force, only for an archived chat, and only
// when `git status` shows nothing uncommitted. The branch always stays.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const store = require('./store');
const lite = require('./lite');

const run = (cmd, args, opts = {}) => new Promise(resolve => {
  cp.execFile(cmd, args, { timeout: opts.timeout || 60000, maxBuffer: 16 * 1024 * 1024, cwd: opts.cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => resolve({ ok: !err, code: err ? err.code : 0, out: String(stdout || ''), err: String(stderr || (err && err.message) || '') }));
});
const git = (dir, args, opts) => run('git', ['-C', dir, ...args], opts);

/* ---------- worktrees ---------- */

// The repository a worktree belongs to, and whether git lists this folder as one of its worktrees.
async function worktreeOf(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const common = await git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common.ok) return null;
  const repo = path.dirname(common.out.trim());
  const list = await git(repo, ['worktree', 'list', '--porcelain']);
  if (!list.ok) return null;
  const real = fs.realpathSync(dir);
  const entries = list.out.split('\n\n').map(b => { const m = /^worktree (.+)$/m.exec(b); const br = /^branch refs\/heads\/(.+)$/m.exec(b); return m ? { path: m[1], branch: br ? br[1] : null } : null; }).filter(Boolean);
  const hit = entries.find(e => { try { return fs.realpathSync(e.path) === real; } catch { return false; } });
  if (!hit || fs.realpathSync(repo) === real) return null; // the main checkout is never treated as a worktree here
  return { repo, path: real, branch: hit.branch };
}

// Folders under a worktree that are dependencies, build output or caches, without following links
// or going into .git; stops at the first heavy folder on each path.
function heavyCandidates(root, maxDepth = 5) {
  const out = [];
  const walk = (dir, depth) => {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink() || e.name === '.git') continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).split(path.sep).join('/');   // as git writes it (Windows too)
      if (lite.HEAVY.has(e.name)) { if (lite.isRemovable(root, rel)) out.push(rel); continue; }
      if (depth < maxDepth) walk(full, depth + 1);
    }
  };
  walk(root, 1);
  return out;
}
// Only the candidates git says are ignored.
async function ignoredOnly(root, rels) {
  if (!rels.length) return [];
  return new Promise(resolve => {
    const p = cp.spawn('git', ['-C', root, 'check-ignore', '--stdin'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.on('close', () => { const ign = new Set(out.split('\n').map(s => s.trim().replace(/\/$/, '')).filter(Boolean)); resolve(rels.filter(r => ign.has(r) || ign.has(`${r}/`))); });
    p.on('error', () => resolve([]));
    p.stdin.end(rels.map(r => `${r}/`).join('\n'));
  });
}
async function sizeKB(paths) {
  if (!paths.length) return {};
  const r = await run('du', ['-sk', ...paths], { timeout: 180000 });
  const out = {};
  for (const line of r.out.split('\n')) { const m = /^(\d+)\s+(.+)$/.exec(line); if (m) out[m[2]] = Number(m[1]); }
  return out;
}
// Everything Free space would remove from one worktree, after every check.
async function freeTargets(dir) {
  const wt = await worktreeOf(dir);
  if (!wt) return { wt: null, targets: [] };
  const cands = heavyCandidates(wt.path).filter(rel => { try { return !fs.lstatSync(path.join(wt.path, rel)).isSymbolicLink(); } catch { return false; } });
  return { wt, targets: await ignoredOnly(wt.path, cands) };
}

function createLiteOps({ dataDir, log = () => {}, store: liteStore }) {
  /* ----- disk use, scanned in the background and kept for a while ----- */
  let scan = { at: 0, running: false, worktrees: [] };
  async function scanSpace(chats) {
    if (scan.running) return;
    scan.running = true;
    try {
      const byPath = new Map();
      for (const c of chats) if (c.worktree) { const k = c.worktree; if (!byPath.has(k)) byPath.set(k, []); byPath.get(k).push(c.id); }
      const out = [];
      for (const [dir, ids] of byPath) {
        if (!fs.existsSync(dir)) { out.push({ path: dir, chats: ids, exists: false }); continue; }
        const { wt, targets } = await freeTargets(dir);
        if (!wt) { out.push({ path: dir, chats: ids, exists: true, worktree: false }); continue; }
        const sizes = await sizeKB([wt.path, ...targets.map(t => path.join(wt.path, t))]);
        const heavy = targets.map(t => ({ rel: t, kb: sizes[path.join(wt.path, t)] || 0 }));
        out.push({ path: dir, chats: ids, exists: true, worktree: true, repo: wt.repo, branch: wt.branch, kb: sizes[wt.path] || 0, heavyKB: heavy.reduce((n, h) => n + h.kb, 0), heavy });
      }
      scan = { at: Date.now(), running: false, worktrees: out };
    } catch (err) { log(`Lite: disk scan failed (${err.message})`); scan.running = false; }
  }
  function space(chats, { fresh = false } = {}) {
    if (fresh || Date.now() - scan.at > 10 * 60e3) scanSpace(chats).catch(() => {});
    const w = scan.worktrees;
    return { at: scan.at || null, scanning: scan.running, worktrees: w, totalKB: w.reduce((n, x) => n + (x.kb || 0), 0), heavyKB: w.reduce((n, x) => n + (x.heavyKB || 0), 0) };
  }

  // Free space in these worktrees. Returns what was removed.
  async function freeSpace(dirs) {
    const done = [];
    for (const dir of (dirs || []).slice(0, 200)) {
      const { wt, targets } = await freeTargets(String(dir));
      if (!wt) { done.push({ path: dir, skipped: 'Not a git worktree.' }); continue; }
      const sizes = await sizeKB(targets.map(t => path.join(wt.path, t)));
      let kb = 0;
      for (const t of targets) {
        const full = path.join(wt.path, t);
        if (!lite.isRemovable(wt.path, t)) continue;
        try { if (fs.lstatSync(full).isSymbolicLink()) continue; fs.rmSync(full, { recursive: true, force: true }); kb += sizes[full] || 0; } catch (err) { log(`Lite: couldn’t remove ${full} (${err.message})`); }
      }
      log(`Lite: freed ${Math.round(kb / 1024)} MB in ${wt.path} (${targets.join(', ') || 'nothing to remove'})`);
      done.push({ path: wt.path, removed: targets, kb });
      const s = scan.worktrees.find(x => x.path === dir || x.path === wt.path); if (s) { s.kb = Math.max(0, (s.kb || 0) - kb); s.heavyKB = 0; s.heavy = []; }
    }
    return done;
  }

  // Removes an archived chat's worktree when nothing in it is uncommitted. The branch stays.
  async function removeWorktree(chatId, dir) {
    const rec = liteStore.get().archived.chats[chatId];
    if (!rec) throw Object.assign(new Error('Archive the chat first. Only archived chats’ worktrees can be removed.'), { status: 409 });
    // Only the worktree recorded for this chat when it was archived, never another folder.
    if (!rec.worktree) throw Object.assign(new Error('There’s no worktree on record for this chat.'), { status: 409 });
    const wt = await worktreeOf(dir);
    if (!wt) throw Object.assign(new Error('That folder isn’t a git worktree (or it’s already gone).'), { status: 400 });
    let recReal = null; try { recReal = fs.realpathSync(rec.worktree); } catch { /* gone */ }
    if (recReal !== wt.path) throw Object.assign(new Error('That isn’t this chat’s worktree.'), { status: 409 });
    const st = await git(wt.path, ['status', '--porcelain']);
    if (!st.ok) throw Object.assign(new Error(`git status failed: ${st.err.trim()}`), { status: 500 });
    if (st.out.trim()) throw Object.assign(new Error('It has uncommitted changes, so it stays. Commit or stash them first.'), { status: 409 });
    const r = await git(wt.repo, ['worktree', 'remove', wt.path]);
    if (!r.ok) throw Object.assign(new Error(`git worktree remove: ${r.err.trim()}`), { status: 409 });
    liteStore.noteArchived(chatId, { worktree: wt.path, branch: wt.branch || rec.branch, repo: wt.repo, worktreeRemoved: true });
    log(`Lite: removed worktree ${wt.path} (branch ${wt.branch || 'detached'} kept)`);
    scan.worktrees = scan.worktrees.filter(x => x.path !== dir && x.path !== wt.path);
    return { ok: true, branch: wt.branch };
  }

  // Puts a removed worktree back from its branch, then installs dependencies in the background.
  const rebuilds = new Map();
  async function rebuildWorktree(chatId) {
    const rec = liteStore.get().archived.chats[chatId] || {};
    const dir = rec.worktree, repo = rec.repo, branch = rec.branch;
    if (!dir || !repo || !branch) throw Object.assign(new Error('There’s no record of its worktree and branch, so it can’t be rebuilt.'), { status: 400 });
    if (fs.existsSync(dir)) return { ok: true, already: true };
    const r = await git(repo, ['worktree', 'add', dir, branch]);
    if (!r.ok) throw Object.assign(new Error(`git worktree add: ${r.err.trim()}`), { status: 409 });
    liteStore.noteArchived(chatId, { worktreeRemoved: false });
    const install = fs.existsSync(path.join(dir, 'pnpm-lock.yaml')) ? ['pnpm', ['install', '--frozen-lockfile']]
      : fs.existsSync(path.join(dir, 'yarn.lock')) ? ['yarn', ['install', '--frozen-lockfile']]
      : fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock')) ? ['bun', ['install']]
      : fs.existsSync(path.join(dir, 'package-lock.json')) ? ['npm', ['ci']] : null;
    if (install) {
      const logFile = path.join(dataDir, 'lite-logs', `${crypto.createHash('sha1').update(dir).digest('hex').slice(0, 10)}.log`);
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      const out = fs.openSync(logFile, 'w');
      const p = cp.spawn(install[0], install[1], { cwd: dir, stdio: ['ignore', out, out] });
      rebuilds.set(chatId, { state: 'installing', log: logFile, startedAt: Date.now() });
      p.on('close', code => { rebuilds.set(chatId, { state: code === 0 ? 'ready' : 'failed', log: logFile, code }); log(`Lite: dependencies for ${dir}: ${code === 0 ? 'installed' : `install failed (${code})`}`); });
      p.on('error', err => rebuilds.set(chatId, { state: 'failed', log: logFile, error: err.message }));
    } else rebuilds.set(chatId, { state: 'ready' });
    log(`Lite: rebuilt worktree ${dir} from ${branch}`);
    return { ok: true, installing: !!install };
  }
  const rebuildState = chatId => rebuilds.get(chatId) || null;

  /* ----- phone alerts ----- */
  // Sent through the app's notifications (lib/push.js): its keys, its phones and each phone's settings.
  // Lite adds its own kinds with its own wording: a plan at its floor, a manual reset about to lapse,
  // routines and the hackathon. (Needs you and replies come from the app itself.)
  const SENT = path.join(dataDir, 'lite-alerts.json');
  const sent = store.loadOwnJson(SENT, null, log) || (() => { const old = store.loadOwnJson(path.join(dataDir, 'push.json'), null, () => {}); return (old && old.sent && typeof old.sent === 'object' && !Array.isArray(old.sent)) ? old.sent : {}; })();
  const saveSent = () => { try { store.writeJsonAtomic(SENT, sent); } catch (err) { log(`Lite: couldn’t save lite-alerts.json (${err.message})`); } };
  let sendPush = null;
  const usePush = fn => { sendPush = fn; };
  const notify = (kind, payload) => (sendPush ? sendPush({ ...payload, kind, at: Date.now() }) : Promise.resolve(0));
  // Plans: one reaching the floor (with what's next), and a manual reset expiring within two days.
  function watchPlans(plans, order, floor) {
    for (const p of plans) {
      if (typeof p.left !== 'number') continue;
      const key = `floor-${p.id}-${p.resetsAt || ''}`;
      if (p.left <= floor && !sent[key]) {
        sent[key] = Date.now();
        const nextId = (order[p.family] || [])[0];
        const next = plans.find(x => x.id === nextId);
        notify('floor', { title: `${p.label} at ${p.left}%`, body: next ? `Next up: ${next.label} (${next.left}%, resets ${new Date(next.resetsAt).toLocaleDateString('en-US', { weekday: 'short' })}).` : 'Every plan in this family is at the floor.', tag: `floor-${p.id}` });
      }
      for (const c of (p.credits && p.credits.list) || []) {
        const ck = `credit-${c.id}`;
        if (c.expiresAt && Date.parse(c.expiresAt) - Date.now() < 2 * 864e5 && !sent[ck]) { sent[ck] = Date.now(); notify('reset', { title: `A manual reset on ${p.label} expires soon`, body: `It lapses ${new Date(c.expiresAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.`, tag: `credit-${p.id}` }); }
      }
    }
    for (const k of Object.keys(sent)) if (Date.now() - sent[k] > 30 * 864e5) delete sent[k];
    saveSent();
  }

  return { space, freeSpace, removeWorktree, rebuildWorktree, rebuildState, notify, usePush, watchPlans };
}

module.exports = { createLiteOps, worktreeOf, heavyCandidates, ignoredOnly, freeTargets };
