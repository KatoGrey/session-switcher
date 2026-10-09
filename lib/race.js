'use strict';
// Race: Claude and Codex take the same task, each in its own copy of the project (a git worktree made
// from a snapshot of the project, uncommitted changes included). You compare, and keep one: its changes
// are applied to your project and both copies go. No branches are made; your own folder isn't touched
// until you keep one.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const snaps = require('./snapshots');

const RACE_ROOT = path.join(os.tmpdir(), 'ss-race');

function git(cwd, args, { input, maxBuffer = 256 << 20 } = {}) {
  return new Promise(resolve => {
    const child = execFile('git', ['-C', cwd, ...args], { timeout: 120000, windowsHide: true, maxBuffer, encoding: 'buffer' }, (err, out, errOut) => resolve({ ok: !err, out: out || Buffer.alloc(0), err: String(errOut || (err && err.message) || '') }));
    if (input !== undefined) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}
const text = r => r.out.toString('utf8').trim();
const isRaceDir = p => !!p && path.resolve(p).toLowerCase().startsWith(RACE_ROOT.toLowerCase() + path.sep.toLowerCase());

// Makes the two copies. cwd: the project's folder (it may be inside a bigger repository).
async function makeRace(cwd, who = ['claude', 'codex']) {
  const top = await snaps.topOf(cwd);
  if (!top) throw Object.assign(new Error('A race needs a git project: its two copies are git worktrees.'), { status: 400 });
  const rel = path.relative(top, path.resolve(cwd));
  const baseTree = await snaps.snapshot(top);
  const head = text(await git(top, ['rev-parse', '--verify', '--quiet', 'HEAD']));
  const c = await git(top, ['commit-tree', baseTree, ...(head ? ['-p', head] : []), '-m', 'Session Switcher race: the starting point'], { input: '' });
  if (!c.ok) throw new Error(`git couldn’t record the starting point: ${c.err.trim()}`);
  const base = text(c);
  const id = crypto.randomBytes(5).toString('hex');
  const dir = path.join(RACE_ROOT, `${path.basename(top).replace(/[^\w.-]+/g, '-').slice(0, 30)}-${id}`);
  fs.mkdirSync(dir, { recursive: true });
  const copies = {};
  for (const w of who) {
    const p = path.join(dir, w);
    const r = await git(top, ['worktree', 'add', '--detach', p, base]);
    if (!r.ok) { await dropRace({ top, dir, copies }); throw new Error(`git couldn’t make a copy for ${w}: ${r.err.trim()}`); }
    copies[w] = { path: p, cwd: rel ? path.join(p, rel) : p };
  }
  return { id, top, rel, base, baseTree, dir, copies };
}

// What each copy changed: [{ path, status, add, del }], and its snapshot.
async function copyChanges(race, who) {
  const tree = await snaps.snapshot(race.copies[who].path);
  return { tree, files: await snaps.changes(race.copies[who].path, race.baseTree, tree) };
}
async function copyDiff(race, who, file) {
  const tree = await snaps.snapshot(race.copies[who].path);
  return snaps.diff(race.copies[who].path, race.baseTree, tree, file);
}

// Applies one copy's changes to the project, all or nothing. If the project changed since the race
// began, it stops; with force it tries anyway, and if anything clashes nothing is applied.
async function keepCopy(race, who, { force = false } = {}) {
  const now = await snaps.snapshot(race.top);
  if (now !== race.baseTree && !force) return { applied: false, why: 'changed' };
  const { tree, files } = await copyChanges(race, who);
  if (!files.length) return { applied: true, files: [] };
  const patch = await git(race.copies[who].path, ['diff', '--binary', '--no-renames', '--full-index', race.baseTree, tree]);
  if (!patch.ok) throw new Error(`git couldn’t read the changes: ${patch.err.trim()}`);
  const r = await git(race.top, ['apply', '--binary', '--whitespace=nowarn', '-'], { input: patch.out });
  return r.ok ? { applied: true, files } : { applied: false, why: 'conflict', detail: r.err.trim().split(/\r?\n/).slice(-6).join('\n'), files };
}

// Removes both copies (and git's record of them).
async function dropRace(race) {
  for (const c of Object.values(race.copies || {})) await git(race.top, ['worktree', 'remove', '--force', c.path]);
  await git(race.top, ['worktree', 'prune']);
  try { fs.rmSync(race.dir, { recursive: true, force: true }); } catch { /* a file still open: it goes with the temp folder */ }
}

module.exports = { makeRace, copyChanges, copyDiff, keepCopy, dropRace, isRaceDir, RACE_ROOT };
