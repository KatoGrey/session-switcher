// Switcher Lite's housekeeping on real (throwaway) git repos, and web push encryption.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const cp = require('child_process');
const lite = require('../lib/lite');
const { createLiteOps, worktreeOf, freeTargets } = require('../lib/lite-ops');

const sh = (cwd, ...args) => cp.execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString();
const write = (p, s = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

// A repo with a worktree holding: ignored node_modules (and a nested one), ignored .next, a committed
// build/ folder, source, and a link to a folder outside.
function makeRepo() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lite-wt-')));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  sh(repo, 'init', '-q', '-b', 'main');
  write(path.join(repo, '.gitignore'), 'node_modules/\n.next/\n');
  write(path.join(repo, 'src/app.js'), 'code');
  write(path.join(repo, 'build/keep.txt'), 'committed build output');
  sh(repo, 'add', '-A'); sh(repo, 'commit', '-qm', 'init');
  const wt = path.join(base, 'wt-feature');
  sh(repo, 'worktree', 'add', '-q', '-b', 'feature', wt);
  write(path.join(wt, 'node_modules/pkg/index.js'), 'dep');
  write(path.join(wt, 'apps/web/node_modules/x.js'), 'dep');
  write(path.join(wt, '.next/cache.bin'), 'cache');
  const outside = path.join(base, 'outside');
  write(path.join(outside, 'precious.txt'), 'never delete');
  fs.symlinkSync(outside, path.join(wt, 'dist'));
  return { base, repo, wt, outside };
}

test('Free space removes ignored dependencies and build output only', async () => {
  const { repo, wt, outside } = makeRepo();
  assert.equal(await worktreeOf(repo), null, 'the main checkout is never treated as a worktree');
  const w = await worktreeOf(wt);
  assert.ok(w && w.branch === 'feature');
  const { targets } = await freeTargets(wt);
  assert.deepEqual(targets.sort(), ['.next', 'apps/web/node_modules', 'node_modules'].sort(), 'not the committed build/, not the dist link');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lite-data-'));
  const ops = createLiteOps({ dataDir: dir, store: lite.createLite({ dataDir: dir }) });
  const [r] = await ops.freeSpace([wt]);
  assert.deepEqual(r.removed.sort(), targets.sort());
  assert.ok(!fs.existsSync(path.join(wt, 'node_modules')) && !fs.existsSync(path.join(wt, '.next')));
  assert.ok(fs.existsSync(path.join(wt, 'src/app.js')), 'code stays');
  assert.ok(fs.existsSync(path.join(wt, 'build/keep.txt')), 'a committed build folder stays');
  assert.ok(fs.existsSync(path.join(outside, 'precious.txt')), 'nothing through a link');
  const [again] = await ops.freeSpace([path.join(repo)]);
  assert.match(again.skipped, /Not a git worktree/, 'the main checkout is refused');
});

test('Remove worktree: archived chats only, never with uncommitted changes; the branch stays; rebuild brings it back', async () => {
  const { repo, wt } = makeRepo();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lite-data-'));
  const st = lite.createLite({ dataDir: dir });
  const ops = createLiteOps({ dataDir: dir, store: st });
  await assert.rejects(ops.removeWorktree('c1', wt), /Archive the chat first/);
  st.archive({ chats: ['c0'], records: { c0: { title: 'Another chat' } } });
  await assert.rejects(ops.removeWorktree('c0', wt), /no worktree on record/, 'an archived chat can’t remove a worktree that isn’t its own');
  st.archive({ chats: ['c2'], records: { c2: { title: 'Elsewhere', worktree: path.join(path.dirname(wt), 'other') } } });
  await assert.rejects(ops.removeWorktree('c2', wt), /isn’t this chat’s worktree/);
  st.archive({ chats: ['c1'], records: { c1: { title: 'A chat', worktree: wt } } });
  write(path.join(wt, 'src/new.js'), 'uncommitted');
  await assert.rejects(ops.removeWorktree('c1', wt), /uncommitted/);
  assert.ok(fs.existsSync(wt));
  fs.rmSync(path.join(wt, 'src/new.js'));
  await assert.rejects(ops.removeWorktree('c1', wt), /uncommitted/, 'an untracked link counts too');
  fs.unlinkSync(path.join(wt, 'dist'));
  const r = await ops.removeWorktree('c1', wt);
  assert.equal(r.branch, 'feature');
  assert.ok(!fs.existsSync(wt));
  assert.match(sh(repo, 'branch', '--list', 'feature'), /feature/, 'the branch stays');
  assert.equal(st.get().archived.chats.c1.worktreeRemoved, true);
  const b = await ops.rebuildWorktree('c1');
  assert.ok(b.ok && fs.existsSync(path.join(wt, 'src/app.js')), 'rebuilt from the branch');
});


test('phone alerts: a phone can switch kinds off, hackathon alerts only when switched on, and Lite sign-ups open Lite', () => {
  const { cleanPrefs, wants } = require('../lib/push');
  const p = cleanPrefs({ kinds: { reply: false, floor: true, bogus: true }, app: 'lite' });
  assert.deepEqual(p.kinds, { reply: false, floor: true });
  assert.equal(p.app, 'lite');
  assert.equal(wants(p, { kind: 'reply' }), false);
  assert.equal(wants(p, { kind: 'needs' }), true);
  assert.equal(wants(p, { kind: 'hack' }), false);
  assert.equal(wants(cleanPrefs({ kinds: { hack: true } }), { kind: 'hack' }), true);
});
