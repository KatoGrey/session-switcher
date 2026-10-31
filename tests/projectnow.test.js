'use strict';
// A project's state in git (lib/projectnow.js): read for real from a throwaway repository.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectNow, parseBranch } = require('../lib/projectnow');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ss-now-'));
// The self-check runs these on any computer: without git there's nothing here to test.
const noGit = (() => { try { execFileSync('git', ['--version'], { windowsHide: true, stdio: 'pipe' }); return false; } catch { return true; } })();
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { windowsHide: true, stdio: 'pipe' }).toString();
function repo() {
  const r = fs.realpathSync(tmp());
  git(r, 'init', '-q', '-b', 'main');
  git(r, 'config', 'user.email', 't@example.com'); git(r, 'config', 'user.name', 'T'); git(r, 'config', 'commit.gpgsign', 'false');
  return r;
}
const write = (r, rel, s = 'x') => { const f = path.join(r, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

test('project now: the branch line, however git puts it', () => {
  assert.deepEqual(parseBranch('## main...origin/main [ahead 1, behind 2]'), { branch: 'main', upstream: 'origin/main', ahead: 1, behind: 2 });
  assert.deepEqual(parseBranch('## main...origin/main'), { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0 });
  assert.deepEqual(parseBranch('## feature/x'), { branch: 'feature/x', upstream: null, ahead: 0, behind: 0 });
  assert.deepEqual(parseBranch('## No commits yet on main'), { branch: 'main', upstream: null, ahead: 0, behind: 0 });
  assert.equal(parseBranch('## HEAD (no branch)').branch, null);
});

test('project now: a folder that isn’t in git just says so', async () => {
  assert.deepEqual(await createProjectNow().read(tmp()), { git: null });
});

test('project now: branch, what isn’t committed and the last commits', { skip: noGit }, async () => {
  const r = repo();
  write(r, 'a.txt'); write(r, 'gone.txt');
  git(r, 'add', '.'); git(r, 'commit', '-qm', 'First: the start');
  write(r, 'a.txt', 'changed'); fs.rmSync(path.join(r, 'gone.txt')); write(r, 'new.txt');
  const { git: g } = await createProjectNow().read(r);
  assert.equal(g.branch, 'main');
  assert.equal(g.changed, 3);
  const by = n => g.files.find(f => f.rel === n);
  assert.equal(by('a.txt').status, 'changed');
  assert.equal(by('gone.txt').status, 'deleted');
  assert.equal(by('new.txt').status, 'new');
  assert.equal(by('a.txt').file, path.join(r, 'a.txt'));
  write(r, 'fresh/inside.txt');
  const again = (await createProjectNow().read(r)).git.files.find(f => f.rel === 'fresh/');
  assert.equal(again.dir, true, 'a whole new folder says it’s a folder');
  assert.equal(again.status, 'new');
  assert.equal(g.commits[0].subject, 'First: the start');
  assert.ok(g.commits[0].at > Date.now() - 600e3 && g.commits[0].at <= Date.now() + 1000);
  assert.ok(/^[0-9a-f]{5,}$/.test(g.commits[0].hash));
});

test('project now: a project in a subfolder sees its own files, named from there', { skip: noGit }, async () => {
  const r = repo();
  write(r, 'sub/in.txt'); write(r, 'out.txt');
  git(r, 'add', '.'); git(r, 'commit', '-qm', 'Both');
  write(r, 'sub/in.txt', 'changed'); write(r, 'out.txt', 'changed');
  const { git: g } = await createProjectNow().read(path.join(r, 'sub'));
  assert.deepEqual(g.files.map(f => f.rel), ['in.txt']);
  assert.equal(g.files[0].file, path.join(r, 'sub', 'in.txt'));
});

test('project now: asked again soon, it doesn’t run git again; a repository with no commits is fine', { skip: noGit }, async () => {
  const r = repo();
  write(r, 'a.txt');
  const now = createProjectNow();
  const first = await now.read(r);
  assert.equal(first.git.branch, 'main');
  assert.deepEqual(first.git.commits, []);
  write(r, 'b.txt');
  assert.equal(await now.read(r), first, 'the same answer for a moment');
});

test('project now: one file’s uncommitted changes; a new one is all additions; nothing outside', { skip: noGit }, async () => {
  const r = repo(), now = createProjectNow();
  write(r, 'a.txt', 'one\n'); git(r, 'add', '.'); git(r, 'commit', '-qm', 'One');
  write(r, 'a.txt', 'one\ntwo\n'); write(r, 'sub/new file.txt', 'fresh\n');
  assert.match(await now.fileDiff(r, 'a.txt'), /\+two/);
  assert.match(await now.fileDiff(r, 'sub/new file.txt'), /\+fresh/);
  fs.rmSync(path.join(r, 'a.txt'));
  assert.match(await now.fileDiff(r, 'a.txt'), /-one/);
  await assert.rejects(now.fileDiff(r, '../x.txt'), e => e.status === 400);
  await assert.rejects(now.fileDiff(r, ''), e => e.status === 400);
  const fresh = repo();
  write(fresh, 'b.txt', 'hi\n');
  assert.match(await now.fileDiff(fresh, 'b.txt'), /\+hi/, 'no commits yet');
  git(fresh, 'add', '.');
  assert.match(await now.fileDiff(fresh, 'b.txt'), /\+hi/, 'staged, with nothing to compare to but the index');
});

test('project now: what the viewer won’t show, a diff doesn’t either', { skip: noGit }, async () => {
  const r = repo(), now = createProjectNow();
  write(r, 'auth.json', '{"token":"secret"}\n');
  await assert.rejects(now.fileDiff(r, 'auth.json'), e => e.status === 403);
  if (process.platform === 'win32') {
    const outside = tmp();
    fs.writeFileSync(path.join(outside, 'x.txt'), 'outside\n');
    fs.symlinkSync(outside, path.join(r, 'linked'), 'junction');
    await assert.rejects(now.fileDiff(r, 'linked/x.txt'), e => e.status === 403, 'nor what a link leads to');
  }
});

test('project now: a file with brackets in its name is that file', { skip: noGit }, async () => {
  const r = repo(), now = createProjectNow();
  write(r, 'notes[1].txt', 'a\n'); write(r, 'notes1.txt', 'b\n');
  git(r, 'add', '.'); git(r, 'commit', '-qm', 'Both');
  write(r, 'notes[1].txt', 'a\nbrackets\n'); write(r, 'notes1.txt', 'b\nplain\n');
  const d = await now.fileDiff(r, 'notes[1].txt');
  assert.match(d, /\+brackets/);
  assert.doesNotMatch(d, /\+plain/);
});

test('project now: before the first commit, it’s the file as it is now', { skip: noGit }, async () => {
  const r = repo(), now = createProjectNow();
  write(r, 'a.txt', 'old\n');
  git(r, 'add', '.');
  write(r, 'a.txt', 'current\n');
  const d = await now.fileDiff(r, 'a.txt');
  assert.match(d, /\+current/);
  assert.doesNotMatch(d, /\+old/);
});

test('project now: everything a chat changed, as it stands now, partners included', { skip: noGit }, async () => {
  const snaps = require('../lib/snapshots');
  const r = repo(), now = createProjectNow();
  write(r, 'mine.txt', 'one\n'); write(r, 'theirs.txt', 'one\n'); write(r, 'undone.txt', 'one\n'); write(r, 'other.txt', 'one\n');
  git(r, 'add', '.'); git(r, 'commit', '-qm', 'Start');
  const top = await snaps.topOf(r);
  const before = await snaps.snapshot(top);
  write(r, 'mine.txt', 'one\ntwo\n'); write(r, 'undone.txt', 'one\ntwo\n'); write(r, 'other.txt', 'changed by someone else\n');
  const t1 = await snaps.snapshot(top);
  write(r, 'theirs.txt', 'one\nmore\n');
  const t2 = await snaps.snapshot(top);
  write(r, 'undone.txt', 'one\n');   // put back
  const lead = { snap: { top, turns: [{ before, after: t1, at: '2026-10-31T01:00:00Z', files: [{ path: 'mine.txt' }, { path: 'undone.txt' }, { path: 'other.txt', meanwhile: true }] }] } };
  const partner = { snap: { top, turns: [{ before: t1, after: t2, at: '2026-10-31T02:00:00Z', files: [{ path: 'theirs.txt' }] }] } };
  const so = await now.soFar('k', [lead, partner]);
  assert.deepEqual(so.files.map(f => f.path).sort(), ['mine.txt', 'theirs.txt'], 'not what was put back, and not what someone else changed');
  assert.match(await now.soFarDiff('k', 'mine.txt'), /\+two/);
  assert.match(await now.soFarDiff('k', 'theirs.txt'), /\+more/);
  await assert.rejects(now.soFarDiff('k', 'other.txt'), e => e.status === 404);
  await assert.rejects(now.soFarDiff('nobody', 'mine.txt'), e => e.status === 404);
  assert.deepEqual((await now.soFar('none', [{ snap: { top: undefined, turns: [] } }])).files, [], 'a folder that isn’t in git has nothing to say');
  // Its turns can each say where they're kept; the latest decides, and only what's kept with it counts.
  const elsewhere = { snap: { top, turns: [{ before: t1, after: t2, at: '2026-10-31T00:00:00Z', top: 'C:/somewhere/else', files: [{ path: 'elsewhere.txt' }] }, { before, after: t1, at: '2026-10-31T03:00:00Z', top, files: [{ path: 'mine.txt' }] }] } };
  assert.deepEqual((await now.soFar('e', [elsewhere])).files.map(f => f.path), ['mine.txt']);
});

test('project now: what the chats here changed, newest first, the partners’ too', () => {
  const now = createProjectNow();
  const kept = {
    lead: [
      { kind: 'changes', turn: 0, at: '2026-10-31T01:00:00Z', files: [{ path: 'a.md', status: 'changed', add: 2, del: 1 }, { path: 'theirs.md', status: 'changed', add: 9, del: 0, meanwhile: true }] },
      { kind: 'changes', turn: 1, at: '2026-10-31T03:00:00Z', files: [{ path: 'b.md', status: 'added', add: 5, del: 0 }] },
      { kind: 'undone', turn: 0, restored: ['a.md'], skipped: [] },
      { kind: 'review', id: 'r', state: 'done', at: '2026-10-31T04:00:00Z' },
      { kind: 'changes', turn: 2, at: '2026-10-31T04:30:00Z', files: [{ path: 'only-others.md', meanwhile: true }] },
    ],
    partner: [{ kind: 'changes', turn: 0, at: '2026-10-31T02:00:00Z', files: [{ path: 'c.md', status: 'changed', add: 1, del: 1 }], scope: 'text' }],
  };
  const extras = { list: id => kept[id] || [] };
  const rows = now.history([{ id: 'lead', by: 'claude', chat: 'lead' }, { id: 'partner', by: 'codex', chat: 'lead' }, { id: 'nothing', chat: 'x' }], extras);
  assert.deepEqual(rows.map(r => [r.id, r.turn]), [['lead', 1], ['partner', 0], ['lead', 0]], 'newest first; a reply with nothing of its own isn’t listed');
  assert.deepEqual(rows[2].files.map(f => f.path), ['a.md'], 'what someone else changed meanwhile isn’t its doing');
  assert.equal(rows[2].undone, true);
  assert.equal(rows[0].undone, false);
  assert.deepEqual([rows[2].add, rows[2].del], [2, 1]);
  assert.equal(rows[1].by, 'codex');
  assert.equal(rows[1].chat, 'lead', 'a partner’s change belongs to its chat');
  assert.equal(rows[1].scope, 'text');
  assert.equal(now.history([{ id: 'lead', chat: 'lead' }], extras, { since: Date.parse('2026-10-31T02:00:00Z') }).length, 1, 'since');
  assert.equal(now.history([{ id: 'lead', chat: 'lead' }], extras, { limit: 1 }).length, 1, 'limit');
});

test('project now: it never touches the index', { skip: noGit }, async () => {
  const r = repo();
  write(r, 'a.txt'); git(r, 'add', '.'); git(r, 'commit', '-qm', 'One');
  const idx = path.join(r, '.git', 'index'), before = fs.readFileSync(idx);
  write(r, 'a.txt', 'changed');
  await createProjectNow().read(r);
  assert.ok(before.equals(fs.readFileSync(idx)));
});
