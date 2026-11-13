'use strict';
// Latitude's repo on a Windows PC (lib/winrepo.js): which folders get the Windows note, the setup check, and the
// fixes done here. Everything runs in throwaway git repos; nothing touches git's global settings.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const w = require('../lib/winrepo');

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim();
function repo(remote) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'winrepo-'));
  git(dir, 'init', '-q');
  if (remote) git(dir, 'remote', 'add', 'origin', remote);
  return dir;
}
const gone = [];
test.after(() => { for (const d of gone) fs.rmSync(d, { recursive: true, force: true }); });

test('only clones of Latitude’s repo, from anywhere inside them, get the note, and only on Windows', () => {
  const lat = repo('https://github.com/latitudegames/latitude.git'), ssh = repo('git@github.com:latitudegames/latitude'), other = repo('https://github.com/latitudegames/latitude-docs.git'), none = repo(null);
  gone.push(lat, ssh, other, none);
  const deep = path.join(lat, 'packages', 'server', 'src');
  fs.mkdirSync(deep, { recursive: true });
  assert.equal(w.repoRoot(deep), lat);
  const alias = repo('git@github-work:latitudegames/latitude.git'); gone.push(alias);
  assert.ok(w.isLatitude(lat) && w.isLatitude(deep) && w.isLatitude(ssh) && w.isLatitude(alias), 'an SSH alias is the same repo');
  assert.ok(!w.isLatitude(other), 'a repo whose name only starts the same isn’t it');
  assert.ok(!w.isLatitude(none) && !w.isLatitude(os.tmpdir()));
  assert.equal(w.noteFor(deep, 'win32'), w.WINDOWS_NOTE);
  assert.equal(w.noteFor(deep, 'darwin'), '');
  assert.equal(w.noteFor(other, 'win32'), '');
  assert.equal(w.noteFor(null, 'win32'), '');
  assert.match(w.WINDOWS_NOTE, /GRAPHQL_FRESHNESS_SKIP=1/);
  assert.match(w.WINDOWS_NOTE, /Never run schema:write or schema:generate/);
  assert.match(w.WINDOWS_NOTE, /git mv -f/);
});

test('a worktree of Latitude’s repo counts too (its config is the shared repository’s)', () => {
  const main = repo('https://github.com/latitudegames/latitude');
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'winrepo-tree-'));
  gone.push(main, tree);
  const gitdir = path.join(main, '.git', 'worktrees', 'feature');
  fs.mkdirSync(gitdir, { recursive: true });
  fs.writeFileSync(path.join(gitdir, 'commondir'), '../..\n');
  fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${gitdir}\n`);
  assert.ok(w.isLatitude(tree));
});

test('the setup check says what’s fine, what to fix and how, without changing anything', async () => {
  const dir = repo('https://github.com/latitudegames/latitude.git'); gone.push(dir);
  fs.writeFileSync(path.join(dir, '.nvmrc'), execFileSync('node', ['--version'], { encoding: 'utf8', windowsHide: true }).trim());
  fs.writeFileSync(path.join(dir, 'yarn.lock'), '# lock\n');
  fs.writeFileSync(path.join(dir, '.env.local'), 'TURBO_TOKEN=abc\nEXPO_TOKEN=\n');
  const before = git(dir, 'status', '--porcelain');
  const mac = await w.check(dir, { platform: 'darwin' });
  const by = id => mac.find(c => c.id === id);
  assert.deepEqual(mac.map(c => c.id), ['node', 'hooks', 'deps', 'env', 'turbo'], 'nothing Windows-only on a Mac');
  assert.equal(by('node').state, 'ok');
  assert.equal(by('node').fix, null, 'nothing to fix, no button');
  assert.deepEqual([by('hooks').state, by('hooks').fix], ['fix', 'chat']);
  assert.deepEqual([by('deps').state, by('deps').fix], ['fix', 'chat']);
  assert.match(by('deps').detail, /Not installed/);
  assert.equal(by('env').state, 'info', 'secrets only matter for running the app');
  assert.match(by('env').detail, /ONEPASS_CONNECT_TOKEN, ONEPASS_TOKEN, EXPO_TOKEN/);
  assert.doesNotMatch(by('env').detail, /TURBO_TOKEN/);
  assert.equal(by('turbo').state, 'info');
  assert.equal(git(dir, 'status', '--porcelain'), before, 'checking changes nothing');

  fs.writeFileSync(path.join(dir, '.nvmrc'), 'v1.2.3');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', '.yarn-state.yml'), '# state\n');
  const files = git(dir, 'status', '--porcelain', '--untracked-files=all');
  const win = await w.check(dir, { platform: 'win32' });
  const wy = id => win.find(c => c.id === id);
  assert.deepEqual([wy('node').state, wy('node').fix], ['fix', 'chat']);
  assert.match(wy('node').detail, /the repo uses 1\.2\.3/);
  assert.equal(wy('deps').state, 'ok');
  for (const id of ['longpaths', 'symlinks', 'graphql', 'notes', 'gemini']) assert.ok(wy(id), `Windows checks ${id}`);
  assert.equal(wy('longpaths').fix === null || wy('longpaths').fix === 'here', true);
  assert.equal(wy('graphql').state, 'ok');
  assert.deepEqual([wy('gemini').state, wy('gemini').fix], ['fix', 'here']);
  for (const c of win) assert.ok(['ok', 'fix', 'info'].includes(c.state) && c.label && c.detail, c.id);
  assert.equal(git(dir, 'status', '--porcelain', '--untracked-files=all'), files, 'checking changes nothing');
});

test('Gemini’s local note is written once, kept out of git, and a GEMINI.md of the repo’s own is left alone', async () => {
  const dir = repo('https://github.com/latitudegames/latitude.git'); gone.push(dir);
  const done = await w.fixHere('gemini', dir);
  assert.match(done, /GEMINI\.md/);
  const text = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
  assert.match(text, /Session Switcher wrote it/);
  assert.ok(text.includes(w.WINDOWS_NOTE));
  assert.match(fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8'), /^\/GEMINI\.md$/m, 'only the root’s');
  fs.mkdirSync(path.join(dir, 'docs')); fs.writeFileSync(path.join(dir, 'docs', 'GEMINI.md'), 'x');
  assert.equal(git(dir, 'status', '--porcelain', '--untracked-files=all'), '?? docs/GEMINI.md', 'a deeper one is still seen');
  fs.rmSync(path.join(dir, 'docs'), { recursive: true });
  assert.equal(git(dir, 'status', '--porcelain'), '', 'never shows up to be committed');
  await assert.rejects(w.fixHere('gemini', dir), e => e.status === 409);
  const after = await w.check(dir, { platform: 'win32' });
  assert.equal(after.find(c => c.id === 'gemini').state, 'ok');

  const own = repo('https://github.com/latitudegames/latitude.git'); gone.push(own);
  fs.writeFileSync(path.join(own, 'GEMINI.md'), '# The team’s own\n');
  const theirs = (await w.check(own, { platform: 'win32' })).find(c => c.id === 'gemini');
  assert.deepEqual([theirs.state, theirs.fix], ['info', null]);
  assert.equal(fs.readFileSync(path.join(own, 'GEMINI.md'), 'utf8'), '# The team’s own\n');

  // One the repo tracks, deleted here, isn't written back.
  const tracked = repo('https://github.com/latitudegames/latitude.git'); gone.push(tracked);
  fs.writeFileSync(path.join(tracked, 'GEMINI.md'), 'tracked\n');
  git(tracked, 'add', 'GEMINI.md'); fs.rmSync(path.join(tracked, 'GEMINI.md'));
  await assert.rejects(w.fixHere('gemini', tracked), e => e.status === 409);
  assert.ok(!fs.existsSync(path.join(tracked, 'GEMINI.md')));
});

test('fixes through a chat follow the repo’s guide and stay on this PC; the others aren’t chats', async () => {
  for (const id of ['node', 'symlinks', 'hooks', 'deps', 'turbo']) {
    const p = w.fixPrompt(id, { detail: 'something.' });
    assert.match(p, /don't commit, push or change tracked files/, id);
  }
  assert.match(w.fixPrompt('node', { detail: '24.16.0 here; the repo uses 24.22.1 (.nvmrc).' }), /docs\/developer-setup\/local-windows-setup\.md/);
  assert.throws(() => w.fixPrompt('longpaths'), e => e.status === 400);
  assert.throws(() => w.fixPrompt('graphql'), e => e.status === 400);
  for (const id of ['constructor', 'toString', '__proto__']) assert.throws(() => w.fixPrompt(id), e => e.status === 400, id);
  await assert.rejects(w.fixHere('node', os.tmpdir()), e => e.status === 400);
});
