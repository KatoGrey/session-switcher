'use strict';
// Race & Split (lib/race.js): git worktree copies, change detection, keepCopy, keepBoth, keepFiles, and cleanup.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const raceLib = require('../lib/race');

function makeRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-race-repo-')));
  test.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });
  const git = args => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  git(['init']);
  git(['config', 'core.autocrlf', 'false']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'line 1\n');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'line 2\n');
  git(['add', '.']);
  git(['commit', '-m', 'init']);
  return dir;
}

const readLf = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

test('race: makeRace creates isolated worktrees, detects changes, detects overlap in keepBoth, and applies keepFiles', async () => {
  const dir = makeRepo();
  // Uncommitted edit in the main repo before starting the race:
  fs.writeFileSync(path.join(dir, 'a.txt'), 'line 1\nuncommitted base\n');

  const race = await raceLib.makeRace(dir, ['claude', 'gemini']);
  test.after(() => raceLib.dropRace(race));

  assert.ok(raceLib.isRaceDir(race.copies.claude.path));
  assert.ok(raceLib.isRaceDir(race.copies.gemini.path));
  assert.equal(readLf(path.join(race.copies.claude.path, 'a.txt')), 'line 1\nuncommitted base\n');

  // Claude edits a.txt and shared.txt; Gemini edits b.txt and shared.txt:
  fs.writeFileSync(path.join(race.copies.claude.path, 'a.txt'), 'line 1\nuncommitted base\nclaude edit\n');
  fs.writeFileSync(path.join(race.copies.claude.path, 'shared.txt'), 'from claude\n');
  fs.writeFileSync(path.join(race.copies.gemini.path, 'b.txt'), 'line 2\ngemini edit\n');
  fs.writeFileSync(path.join(race.copies.gemini.path, 'shared.txt'), 'from gemini\n');

  const claudeChanges = await raceLib.copyChanges(race, 'claude');
  assert.equal(claudeChanges.files.length, 2);

  // keepBoth refuses when both touched shared.txt:
  const overlap = await raceLib.keepBoth(race);
  assert.equal(overlap.applied, false);
  assert.equal(overlap.why, 'overlap');
  assert.deepEqual(overlap.clash, ['shared.txt']);

  // keepFiles applies non-overlapping picks (and tolerates duplicate paths within the same racer):
  const picked = await raceLib.keepFiles(race, {
    claude: ['a.txt', 'A.TXT', 'shared.txt'],
    gemini: ['b.txt'],
  });
  assert.equal(picked.applied, true);
  assert.equal(picked.files.length, 3);
  assert.match(readLf(path.join(dir, 'a.txt')), /claude edit/);
  assert.match(readLf(path.join(dir, 'b.txt')), /gemini edit/);
  assert.equal(readLf(path.join(dir, 'shared.txt')), 'from claude\n');

  await raceLib.dropRace(race);
  assert.equal(fs.existsSync(race.dir), false);
});
