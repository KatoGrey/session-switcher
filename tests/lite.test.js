// Switcher Lite's pure parts: the use-next order, the pace forecast, the Free space filter, stage
// guesses, monorepo splits, and lite.json changes in a throwaway folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lite = require('../lib/lite');

const NOW = Date.parse('2026-10-10T12:00:00-06:00');
const H = 3600e3, D = 24 * H;
const at = ms => new Date(ms).toISOString();

test('use-next order: per family, soonest reset first, plans at or below the floor drop out', () => {
  const plans = [
    { id: 'cx-aid', family: 'chatgpt', left: 100, resetsAt: at(NOW + 7 * D) },
    { id: 'cx-lat', family: 'chatgpt', left: 47, resetsAt: at(NOW + 3 * D) },
    { id: 'cx-per', family: 'chatgpt', left: 100, resetsAt: at(NOW + 4 * D) },
    { id: 'cl-lat', family: 'claude', left: 65, resetsAt: at(NOW + 4 * D) },
    { id: 'cl-low', family: 'claude', left: 15, resetsAt: at(NOW + 1 * D) },
    { id: 'cl-per', family: 'claude', broken: 'Signed in as the wrong account', left: null },
    { id: 'ollama', family: 'ollama', unlimited: true },
  ];
  const o = lite.useNextOrder(plans, 15);
  assert.deepEqual(o.chatgpt, ['cx-lat', 'cx-per', 'cx-aid']);
  assert.deepEqual(o.claude, ['cl-lat'], 'at the floor (15%) is skipped, broken is skipped');
  assert.deepEqual(lite.useNextOrder(plans, 10).claude, ['cl-low', 'cl-lat'], 'a lower floor brings it back, first since it resets soonest');
  assert.deepEqual(lite.useNextOrder(plans, 50).chatgpt, ['cx-per', 'cx-aid'], 'below a 50% floor it drops out');
});

test('use-next order: a week that hasn’t started goes last; ties go to the one with less left', () => {
  const plans = [
    { id: 'fresh', family: 'chatgpt', left: 100, resetsAt: null },
    { id: 'b', family: 'chatgpt', left: 80, resetsAt: at(NOW + 2 * D) },
    { id: 'a', family: 'chatgpt', left: 40, resetsAt: at(NOW + 2 * D) },
  ];
  assert.deepEqual(lite.useNextOrder(plans, 15).chatgpt, ['a', 'b', 'fresh']);
});

test('forecast: uses the last day of samples, so a heavy day shows straight away', () => {
  const plan = { id: 'p', left: 40, resetsAt: at(NOW + 3 * D), startedAt: at(NOW - 4 * D) };
  // Steady 10% a day for the week so far would leave 10%; today it went 70 → 40 (30% in a day).
  const samples = [{ t: NOW - 24 * H, left: 70 }, { t: NOW - 12 * H, left: 55 }, { t: NOW - H, left: 41 }];
  const f = lite.forecast(plan, samples, NOW, 15);
  assert.equal(f.source, 'day');
  assert.ok(f.rate > 28 && f.rate < 32, `rate ${f.rate}`);
  assert.equal(f.kind, 'dry');
  assert.ok(f.dryAt > NOW && f.dryAt < NOW + 2 * D);
});

test('forecast: a reset inside the day starts the measurement again', () => {
  const plan = { id: 'p', left: 90, resetsAt: at(NOW + 7 * D - 6 * H) };
  const samples = [{ t: NOW - 20 * H, left: 30 }, { t: NOW - 10 * H, left: 20 }, { t: NOW - 6 * H, left: 100 }, { t: NOW - H, left: 92 }];
  const f = lite.forecast(plan, samples, NOW, 15);
  assert.equal(f.source, 'day');
  // 100 → 90 over 6 hours: 40% a day, not the jump from 20 to 90.
  assert.ok(f.rate > 38 && f.rate < 42, `rate ${f.rate}`);
});

test('forecast: without a day of history it falls back to this week’s average', () => {
  const plan = { id: 'p', left: 64, resetsAt: at(NOW + 4 * D), startedAt: at(NOW - 3 * D) };
  const f = lite.forecast(plan, [], NOW, 15);
  assert.equal(f.source, 'week');
  assert.equal(f.rate, 12);           // 36% over 3 days
  assert.equal(f.atReset, 16);        // 64 − 12 × 4
  assert.equal(f.kind, 'room');
  assert.equal(f.moreToUse, 1);
  // Codex: no start time, so the window length before the reset is used.
  const g = lite.forecast({ left: 100, resetsAt: at(NOW + 5 * D), windowMins: 7 * 24 * 60 }, [], NOW, 15);
  assert.equal(g.kind, 'untouched');
  // Lands at the floor right as it resets.
  const h = lite.forecast({ left: 30, resetsAt: at(NOW + 2 * D), startedAt: at(NOW - 5 * D) }, [], NOW, 15);
  assert.equal(h.kind, 'onTarget');
});

test('Free space: only dependencies, build output and caches inside the worktree', () => {
  const root = '/tmp/wt/feature-x';
  assert.ok(lite.isRemovable(root, 'node_modules'));
  assert.ok(lite.isRemovable(root, 'apps/web/.next'));
  assert.ok(lite.isRemovable(root, 'packages/ui/dist'));
  assert.ok(lite.isRemovable(root, path.join(root, 'build')));
  assert.ok(lite.isRemovable(root, '.turbo'));
  assert.ok(!lite.isRemovable(root, 'src'), 'code stays');
  assert.ok(!lite.isRemovable(root, ''), 'never the worktree itself');
  assert.ok(!lite.isRemovable(root, '.'), 'never the worktree itself');
  assert.ok(!lite.isRemovable(root, '../other/node_modules'), 'never outside it');
  assert.ok(!lite.isRemovable(root, '/tmp/wt/node_modules'), 'never a sibling');
  assert.ok(!lite.isRemovable(root, '.git/node_modules'), 'never inside .git');
  assert.ok(!lite.isRemovable(root, 'node_modules/foo/dist'), 'inside node_modules it goes with node_modules');
  assert.ok(!lite.isRemovable(root, 'src/build.ts'), 'a file named like it isn’t it');
  assert.deepEqual(lite.cleanupTargets(root, ['node_modules', 'src', 'dist', '../x/dist']), ['node_modules', 'dist']);
});

test('stage guesses and monorepo splits', () => {
  assert.equal(lite.guessStage('Fix discover spacing'), 'bug');
  assert.equal(lite.guessStage('Investigate Voyage Spanish language'), 'explore');
  assert.equal(lite.guessStage('AI Dungeon 2D jukebox and tavern interactions'), 'feature');
  const rules = [{ project: 'voyage', match: 'voyage|character forge' }, { project: 'aid', match: 'ai dungeon|alchemy' }, { project: 'latitude', default: true }];
  assert.equal(lite.splitKey('/r/latitude', 'Explore Voyage daily challenges', rules), '/r/latitude#voyage');
  assert.equal(lite.splitKey('/r/latitude', 'Alchemy release retro', rules), '/r/latitude#aid');
  assert.equal(lite.splitKey('/r/latitude', 'Churn research', rules), '/r/latitude#latitude');
  assert.equal(lite.splitKey('/r/other', 'Anything', null), '/r/other');
  assert.ok(lite.isQuiet(NOW - 5 * D, NOW, 4));
  assert.ok(!lite.isQuiet(NOW - 3 * D, NOW, 4));
});

test('lite.json: stages, waiting with a reminder, buckets, archive records, usage samples', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lite-'));
  const s = lite.createLite({ dataDir: dir });
  assert.deepEqual(s.get().buckets, [], 'starts with nothing personal');
  s.setBuckets([{ name: 'Voyage' }, { id: 'aid', name: 'AI Dungeon' }, { name: 'Voyage' }]);
  assert.deepEqual(s.get().buckets.map(b => b.id), ['voyage', 'aid']);
  s.setProject('/r/latitude#voyage', { bucket: 'voyage' });
  assert.throws(() => s.setProject('/r/x', { bucket: 'nope' }), /doesn’t exist/);
  const [w] = s.setChats(['c1'], { stage: 'waiting', waitingOn: 'CQA' });
  assert.equal(w.waitingOn, 'CQA');
  assert.ok(Date.parse(w.remindAt) > Date.now() + 47 * H, 'reminds after two days');
  s.setChats(['c1'], { stage: 'feature' });
  assert.equal(s.get().chats.c1.remindAt, undefined, 'no reminder once it isn’t waiting');
  assert.throws(() => s.setChats(['c1'], { stage: 'later' }), /Unknown stage/);
  s.archive({ chats: ['c1'], records: { c1: { title: 'A chat', branch: 'feat/x', worktree: '/r/wt', stage: 'feature' } } });
  assert.equal(s.get().archived.chats.c1.branch, 'feat/x');
  s.archive({ chats: ['c1'] }, false);
  assert.equal(s.get().archived.chats.c1, undefined);
  assert.deepEqual(s.get().permissions, { claude: null, codex: null }, 'follows the full app until set');
  s.setLook({ permissions: { claude: 'bypassPermissions', codex: 'full' } });
  assert.deepEqual(s.get().permissions, { claude: 'bypassPermissions', codex: 'full' });
  s.setLook({ permissions: { codex: 'yolo' } });
  assert.equal(s.get().permissions.codex, null, 'an unknown mode goes back to following the app');
  s.setLook({ skin: 'rebel', floor: 20, quietDays: 7, mode: 'nope' });
  assert.equal(s.get().look.skin, 'rebel'); assert.equal(s.get().look.mode, 'system'); assert.equal(s.get().plans.floor, 20);
  s.sample([{ id: 'p', left: 50 }], NOW);
  s.sample([{ id: 'p', left: 49 }], NOW + 5 * 60e3);
  assert.equal(s.samplesFor('p').length, 1, 'a sample within 15 minutes updates the last one');
  s.sample([{ id: 'p', left: 45 }], NOW + H);
  assert.equal(s.samplesFor('p').length, 2);
  const again = lite.createLite({ dataDir: dir });
  assert.equal(again.get().look.skin, 'rebel', 'kept on disk');
  assert.equal(again.samplesFor('p').length, 2);
});
