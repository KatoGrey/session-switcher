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

test('race: each side’s chat opens in its own copy, on the model and effort picked for it', () => {
  const race = { copies: { claude: { cwd: 'C:\\race\\claude' }, codex: { cwd: 'C:\\race\\codex' }, gemini: { cwd: 'C:\\race\\gemini' } } };
  const run = { claude: { model: 'opus', effort: 'high' }, codex: { model: 'gpt-6-sol', effort: 'low' }, gemini: { model: 'gemini-4-argon-high', effort: 'max' } };
  assert.deepEqual(raceLib.racerOpen(race, 'claude', { account: 'studio', run }), { account: 'studio', cwd: 'C:\\race\\claude', mode: 'new', provider: 'claude', model: 'opus', effort: 'high' });
  assert.deepEqual(raceLib.racerOpen(race, 'codex', { account: 'studio', run }), { account: null, cwd: 'C:\\race\\codex', mode: 'new', provider: 'codex', model: 'gpt-6-sol', effort: 'low' }, 'Codex: its own model and effort, and no Claude account');
  assert.deepEqual(raceLib.racerOpen(race, 'gemini', { run }), { account: null, cwd: 'C:\\race\\gemini', mode: 'new', provider: 'gemini', model: 'gemini-4-argon-high' }, 'Gemini has no effort (it’s in its model’s name)');
  // Nothing picked for a side: it starts as last time.
  assert.deepEqual(raceLib.racerOpen(race, 'codex', { run: { claude: run.claude } }), { account: null, cwd: 'C:\\race\\codex', mode: 'new', provider: 'codex' });
  assert.deepEqual(raceLib.racerOpen(race, 'claude', { account: 'studio' }), { account: 'studio', cwd: 'C:\\race\\claude', mode: 'new', provider: 'claude' });
  // An effort without a model, an effort no assistant has, and a model that isn't one are left out.
  assert.deepEqual(raceLib.racerOpen(race, 'claude', { account: 'a', run: { claude: { effort: 'high' } } }), { account: 'a', cwd: 'C:\\race\\claude', mode: 'new', provider: 'claude' });
  assert.deepEqual(raceLib.racerOpen(race, 'claude', { account: 'a', run: { claude: { model: 'opus[1m]', effort: 'loud' } } }), { account: 'a', cwd: 'C:\\race\\claude', mode: 'new', provider: 'claude', model: 'opus[1m]' });
  assert.deepEqual(raceLib.racerOpen(race, 'claude', { account: 'a', run: { claude: { model: 'opus --dangerously-skip-permissions', effort: 'high' } } }), { account: 'a', cwd: 'C:\\race\\claude', mode: 'new', provider: 'claude' });
  assert.deepEqual(raceLib.racerOpen(race, 'claude', { account: 'a', run: 'opus' }), { account: 'a', cwd: 'C:\\race\\claude', mode: 'new', provider: 'claude' });
});

// The whole way through the real server, with the stand-ins (tests/fake-world.js): a race started from the dialog's
// request starts each side's chat on its own model and effort.
test('race: on the real server, each side starts on its own model and effort', { skip: process.platform !== 'win32' || !!process.versions.electron ? 'its launchers are Windows .cmd files, and it’s not for the installed app’s self-check' : false }, async () => {
  const { build } = require('./fake-world');
  const w = await build();
  let id = null, call = null, again = null;
  try {
    const token = (await (await fetch(w.base)).text()).match(/TOKEN = '([a-f0-9]+)'/)[1];
    call = async (p, body) => { const r = await fetch(w.base + p.slice(1), { method: body ? 'POST' : 'GET', headers: { 'x-switcher-token': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
    const until = async (what, fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; assert.ok(Date.now() - t0 < ms, `timed out: ${what}`); await new Promise(r => setTimeout(r, 150)); } };
    await until('Codex signed in', async () => { const st = (await call('/api/state')).json; return st.codex && st.codex.signedIn; });
    const started = await call('/api/race', { action: 'start', who: ['claude', 'codex'], cwd: w.courier, accountId: 'main', prompt: 'Make the courier faster.', run: { claude: { model: 'sonnet', effort: 'low' }, codex: { model: 'gpt-fake', effort: 'high' } } });
    assert.equal(started.status, 200, JSON.stringify(started.json));
    id = started.json.id;
    const racers = started.json.races.find(r => r.id === id).racers;
    const claude = (await call('/api/chat/attach', { key: racers.claude.key })).json, codex = (await call('/api/chat/attach', { key: racers.codex.key })).json;
    assert.equal(claude.provider || 'claude', 'claude');
    assert.equal(codex.provider, 'codex');
    assert.notEqual(claude.cwd, codex.cwd, 'each in its own copy');
    assert.deepEqual([claude.model, claude.effort], ['sonnet', 'low'], 'Claude on its own model and effort');
    assert.deepEqual([codex.model, codex.effort], ['gpt-fake', 'high'], 'Codex on its own model and effort');
    // Stopped, then opened again from its card, it carries on with the same model and effort.
    const sid = await until('Claude’s racer has its id', async () => (await call('/api/chat/attach', { key: racers.claude.key })).json.sessionId);
    await call('/api/chat/stop', { key: racers.claude.key });
    again = await call('/api/chat/open', { sessionId: sid, account: 'main', mode: 'resume', force: true });
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.deepEqual([again.json.model, again.json.effort], ['sonnet', 'low'], 'reopened on the same model and effort');
  } finally {
    // Nothing left behind, even when a check fails partway: the reopened chat stops before the copies go, and a copy
    // a chat still held open goes once the app has stopped.
    if (call && again && again.json && again.json.key) await call('/api/chat/stop', { key: again.json.key }).catch(() => {});
    if (id && call) await call('/api/race', { action: 'discard', id }).catch(() => {});
    await w.done();
    try { if (id && fs.existsSync(raceLib.RACE_ROOT)) for (const d of fs.readdirSync(raceLib.RACE_ROOT).filter(n => n.endsWith(`-${id}`))) fs.rmSync(path.join(raceLib.RACE_ROOT, d), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* still open: it goes with the temp folder */ }
  }
});
