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

test('kind and status guesses, and monorepo splits', () => {
  assert.equal(lite.guessKind('Fix discover spacing'), 'bug');
  assert.equal(lite.guessKind('Prototype a 3D island'), 'prototype');
  assert.equal(lite.guessKind('AI Dungeon 2D jukebox and tavern interactions'), null, 'no tag unless it says so');
  assert.equal(lite.guessStatus('Investigate Voyage Spanish language'), 'exploring');
  assert.equal(lite.guessStatus('AI Dungeon 2D jukebox and tavern interactions'), 'building');
  assert.equal(lite.guessStatus('Write release notes for 1.4'), 'finishing');
  const rules = [{ project: 'voyage', match: 'voyage|character forge' }, { project: 'aid', match: 'ai dungeon|alchemy' }, { project: 'latitude', default: true }];
  assert.equal(lite.splitKey('/r/latitude', 'Explore Voyage daily challenges', rules), '/r/latitude#voyage');
  assert.equal(lite.splitKey('/r/latitude', 'Alchemy release retro', rules), '/r/latitude#aid');
  assert.equal(lite.splitKey('/r/latitude', 'Churn research', rules), '/r/latitude#latitude');
  assert.equal(lite.splitKey('/r/other', 'Anything', null), '/r/other');
  assert.ok(lite.isQuiet(NOW - 5 * D, NOW, 4));
  assert.ok(!lite.isQuiet(NOW - 3 * D, NOW, 4));
});

test('lite.json: kind, status, Focus, Waiting with a reminder, buckets, archive records, usage samples', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lite-'));
  const s = lite.createLite({ dataDir: dir });
  assert.deepEqual(s.get().buckets, [], 'starts with nothing personal');
  s.setBuckets([{ name: 'Voyage' }, { id: 'aid', name: 'AI Dungeon' }, { name: 'Voyage' }]);
  assert.deepEqual(s.get().buckets.map(b => b.id), ['voyage', 'aid']);
  s.setProject('/r/latitude#voyage', { bucket: 'voyage' });
  assert.throws(() => s.setProject('/r/x', { bucket: 'nope' }), /doesn’t exist/);
  s.setChats(['c1'], { status: 'building', kind: 'bug' });
  const [w] = s.setChats(['c1'], { waiting: true, waitingOn: 'CQA' });
  assert.equal(w.waitingOn, 'CQA');
  assert.equal(w.status, 'building', 'waiting keeps where the work is');
  assert.ok(Date.parse(w.remindAt) > Date.now() + 47 * H, 'reminds after two days');
  s.setChats(['c1'], { focus: true });
  assert.equal(s.get().chats.c1.focus, true);
  assert.equal(s.get().chats.c1.waiting, true, 'Focus and Waiting sit together');
  s.setChats(['c1'], { waiting: false });
  assert.equal(s.get().chats.c1.remindAt, undefined, 'no reminder once it isn’t waiting');
  assert.throws(() => s.setChats(['c1'], { status: 'someday' }), /Unknown status/);
  s.setChats(['c1'], { status: 'later' });
  assert.equal(s.get().chats.c1.status, 'later', 'Later is the backlog');
  assert.throws(() => s.setChats(['c1'], { kind: 'epic' }), /Unknown kind/);
  s.setChats(['c2'], { stage: 'final' });
  assert.equal(s.get().chats.c2.status, 'finishing', 'an old page sending a stage still lands right');
  s.archive({ chats: ['c1'], records: { c1: { title: 'A chat', branch: 'feat/x', worktree: '/r/wt', status: 'building', kind: 'bug' } } });
  assert.equal(s.get().archived.chats.c1.branch, 'feat/x');
  assert.equal(s.get().archived.chats.c1.kind, 'bug');
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

test('guesses: the model’s JSON is read even inside prose, and bad kinds or statuses are dropped', () => {
  const { parseGuesses, looksLikePrompt } = require('../lib/lite-guess');
  const g = parseGuesses('Sure! ```json\n[{"id":"a","kind":"bug","status":"building","title":"Fix discover spacing."},{"id":"b","kind":"epic","status":"later","title":"x"},{"id":"","kind":"bug"}]\n```');
  assert.deepEqual(g, [{ id: 'a', kind: 'bug', status: 'building', title: 'Fix discover spacing' }, { id: 'b', kind: null, status: null, title: 'x' }]);
  assert.deepEqual(parseGuesses('no json here'), []);
  assert.ok(looksLikePrompt('You are reviewer "astra-6". Read the file and…'));
  assert.ok(looksLikePrompt('Reply with just the word ready.'));
  assert.ok(!looksLikePrompt('Alchemy release retro'));
});

test('seen and guesses are kept in lite.json; yours still wins', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lite-'));
  const s = lite.createLite({ dataDir: dir });
  s.setGuess('c1', { kind: 'bug', status: 'building', title: 'Fix the thing', by: 'm' });
  s.setGuess('c2', { kind: 'nope', by: 'm' });
  assert.equal(s.get().guess.c1.kind, 'bug');
  assert.equal(s.get().guess.c2.kind, undefined, 'unknown kinds aren’t kept');
  s.setGuess('c1', { status: 'finishing', by: 'git', keep: true });
  assert.deepEqual([s.get().guess.c1.kind, s.get().guess.c1.status, s.get().guess.c1.title], ['bug', 'finishing', 'Fix the thing'], 'a pushed branch only moves the status');
  s.setSeen(['c1'], 1000); s.setSeen(['c1'], 500);
  assert.equal(s.get().seen.c1, undefined, 'older than two weeks is dropped');
  s.setSeen(['c3']);
  assert.ok(s.get().seen.c3 > Date.now() - 5000);
  s.setLook({ routinesFollow: true });
  assert.equal(s.get().routinesFollow, true);
  await new Promise(r => setTimeout(r, 600));
  const again = lite.createLite({ dataDir: dir });
  assert.equal(again.get().guess.c1.title, 'Fix the thing');
  assert.ok(again.get().seen.c3);
});

test('old stages move onto kind, status, Focus and Waiting when lite.json loads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lite-'));
  fs.writeFileSync(path.join(dir, 'lite.json'), JSON.stringify({
    chats: { a: { stage: 'priority' }, b: { stage: 'bug' }, c: { stage: 'waiting', waitingOn: 'CQA', remindAt: '2026-10-12T00:00:00.000Z' }, d: { stage: 'final' }, e: { stage: 'explore', project: '/r/x' }, f: { stage: 'done' }, g: { stage: 'feature' } },
    guess: { h: { stage: 'bug', title: 'Fix it', by: 'm' }, i: { stage: 'final', by: 'git' } },
    archived: { chats: { j: { at: null, stage: 'bug', title: 'Old' } }, projects: [] },
  }));
  const s = lite.createLite({ dataDir: dir });
  const c = s.get().chats;
  assert.deepEqual(c.a, { focus: true });
  assert.deepEqual(c.b, { kind: 'bug', status: 'building' });
  assert.deepEqual(c.c, { waiting: true, waitingOn: 'CQA', remindAt: '2026-10-12T00:00:00.000Z' });
  assert.deepEqual(c.d, { status: 'finishing' });
  assert.deepEqual(c.e, { status: 'exploring', project: '/r/x' });
  assert.deepEqual(c.f, { status: 'done' });
  assert.deepEqual(c.g, { kind: 'feature', status: 'building' });
  assert.deepEqual(s.get().guess.h, { kind: 'bug', status: 'building', title: 'Fix it', by: 'm' });
  assert.equal(s.get().guess.i.status, 'finishing');
  assert.equal(s.get().archived.chats.j.kind, 'bug');
  assert.ok(Object.values(c).every(r => !('stage' in r)), 'the old key is gone');
});

test('Ollama: the week runs Monday to Monday UTC, and the estimate follows the last reading', () => {
  const now = Date.parse('2026-10-10T22:30:00Z'); // a Saturday
  const byDay = [['2026-10-04', 900], ['2026-10-05', 600], ['2026-10-06', 2400], ['2026-10-07', 1600], ['2026-10-08', 1600], ['2026-10-09', 2100], ['2026-10-10', 1700]].map(([d, n]) => ({ from: `${d}T00:00:00Z`, n }));
  const none = lite.ollamaWeek(byDay, [], now);
  assert.equal(none.startedAt, '2026-10-05T00:00:00.000Z');
  assert.equal(none.resetsAt, '2026-10-12T00:00:00.000Z');
  assert.equal(none.requests, 10000, 'Sunday’s requests belong to last week');
  assert.equal(none.used, null, 'no estimate without a reading');
  const reading = { at: '2026-10-10T20:00:00Z', pct: 20, requests: 8000, resetsAt: '2026-10-12T00:00:00Z' };
  assert.equal(lite.ollamaWeek(byDay, [reading], now).used, 25, '2,000 more requests at 0.0025% each');
  const nextWeek = lite.ollamaWeek([{ from: '2026-10-12T00:00:00Z', n: 4000 }], [reading], Date.parse('2026-10-12T12:00:00Z'));
  assert.equal(nextWeek.used, 10, 'a new week starts from zero at the same rate');
});

test('Lite page: data-open and data-chat mean "open this chat" and nothing else', () => {
  // A folder's fold state once used data-open="true"; every click inside it then tried to open a
  // chat called "true" and nothing happened.
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'ui-lite')).filter(n => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'ui-lite', f), 'utf8');
    assert.ok(!/data-open="\$\{!*open\}"/.test(src), `${f} uses data-open for something other than a chat id`);
    // The same clash once came from the main area keeping data-chat for the chat it shows: every
    // click in a conversation re-opened it (and text couldn't be selected).
    assert.ok(!/\bm\.dataset\.chat\b/.test(src), `${f} puts data-chat on the main area`);
  }
});

test('Claude Desktop renames wait until the app is closed, and change only the title fields', () => {
  const { createDesktopNames, renamed } = require('../lib/lite-desktop-names');
  const r = renamed({ title: 'Old', completedTurns: 3, previousTitles: ['Older'], other: { a: 1 } }, 'New');
  assert.deepEqual(r, { title: 'New', completedTurns: 3, previousTitles: ['Older', 'Old'], titleTurn: 3, other: { a: 1 } });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-desk-'));
  fs.mkdirSync(path.join(root, 'org', 'acct'), { recursive: true });
  const file = path.join(root, 'org', 'acct', 'local_abc.json');
  fs.writeFileSync(file, JSON.stringify({ sessionId: 'local_abc', cliSessionId: 'c1', title: 'Old', completedTurns: 2, keep: 'me' }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lite-'));
  const store = lite.createLite({ dataDir: dir });
  let running = true;
  const desktop = { get: id => (id === 'c1' ? { desktopId: 'local_abc', cli: 'c1' } : null), ROOT: root };
  const names = createDesktopNames({ store, desktop, isRunning: () => running, root });
  assert.deepEqual(names.queue('C1', 'Voyage Lab pages'), { queued: true, desktopOpen: true });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).title, 'Old', 'nothing written while the app runs');
  assert.ok(store.get().desktopRenames.c1);
  running = false;
  assert.deepEqual(names.apply().done, ['c1']);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual([j.title, j.previousTitles, j.titleTurn, j.keep], ['Voyage Lab pages', ['Old'], 2, 'me']);
  assert.equal(store.get().desktopRenames.c1, undefined, 'done, so no longer waiting');
  assert.throws(() => names.queue('nope', 'x'), /didn’t come from the Claude desktop app/);
});

test('families: sub-chats join their parent’s project and status unless you set your own', () => {
  const g = { status: true, kind: true };
  const chats = [
    { id: 'P', parent: null, project: '/r/latitude#voyage', status: 'building', guessed: { status: false } },
    { id: 'k1', parent: 'p', project: '~loose', status: 'exploring', guessed: g },
    { id: 'k2', parent: 'P', project: '/r/other', status: 'exploring', guessed: { status: false } },
    { id: 'g1', parent: 'k1', project: '~loose', status: 'finishing', guessed: g },
    { id: 'orphan', parent: 'gone', project: '/r/x', status: 'building', guessed: g },
    { id: 'a', parent: 'b', project: '/r/a', status: 'building', guessed: g },
    { id: 'b', parent: 'a', project: '/r/b', status: 'building', guessed: g },
  ];
  chats.push({ id: 'k3', parent: 'P', project: '/r/bujo-app', status: 'building', guessed: g });
  chats.push({ id: 'D', parent: null, project: '/r/d', status: 'done', guessed: { status: false } }, { id: 'dk', parent: 'D', project: '/r/d', status: 'building', guessed: { status: false } });
  lite.families(chats, { k2: { project: '/r/other' } }, key => key === '~loose');
  const by = Object.fromEntries(chats.map(c => [c.id, c]));
  assert.deepEqual([by.k1.root, by.k1.depth, by.k1.project, by.k1.homeProject, by.k1.status], ['P', 1, '/r/latitude#voyage', '~loose', 'building']);
  assert.deepEqual([by.g1.root, by.g1.depth, by.g1.project, by.g1.status], ['P', 2, '/r/latitude#voyage', 'building'], 'grandchildren follow too');
  assert.deepEqual([by.k2.project, by.k2.status], ['/r/other', 'exploring'], 'a project or status you set stays');
  assert.deepEqual([by.orphan.depth, by.orphan.project], [0, '/r/x'], 'a parent that isn’t listed leaves it alone');
  assert.deepEqual([by.k3.project, by.k3.status, by.k3.root], ['/r/bujo-app', 'building', 'P'], 'work in a real repo stays in that project, still in the family');
  assert.equal(by.dk.status, 'building', 'a status you set on a sub-chat stays, even under a Done parent');
  assert.ok(by.a.depth <= 1 && by.b.depth <= 1, 'a loop doesn’t run away');
});

test('routines: verdicts, first-start seeding, escalation with its limits', async () => {
  const { createLiteRoutines, verdictOf, withSuffix, stripSuffix } = require('../lib/lite-routines');
  assert.deepEqual(verdictOf('Checked #bugs.\n\nALL CLEAR: nothing new since 9am'), { kind: 'clear', title: 'nothing new since 9am', details: 'Checked #bugs.' });
  const e = verdictOf('Looked at Discord.\n\n**ESCALATE:** Login loops on iOS 18\nThree players in #help since 8:10, link: https://x/1');
  assert.deepEqual([e.kind, e.title], ['escalate', 'Login loops on iOS 18']);
  assert.match(e.details, /Three players/);
  assert.equal(verdictOf('just chatting').kind, 'none');
  assert.equal(stripSuffix(withSuffix(withSuffix('Check #bugs'))), 'Check #bugs', 'the suffix is added once and comes off cleanly');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lite-'));
  const store = lite.createLite({ dataDir: dir });
  store.setRoutineFlow('r1', { triage: true, notify: 'important', escalate: { on: true } });
  const r = { id: 'r1', name: 'Daily check', cwd: '/r/x', provider: 'codex', history: [{ id: 'old', status: 'done', sessionId: 's0', line: 'ESCALATE: old thing' }] };
  const replies = { s1: 'Looked.\n\nESCALATE: Crash on save\nDetails here', s2: 'ALL CLEAR: quiet', s3: 'ESCALATE: crash on save\nAgain', s4: 'ESCALATE: B\nx', s5: 'ESCALATE: C\nx', s6: 'ESCALATE: D\nx' };
  const started = [], pushed = [];
  const lr = createLiteRoutines({ store, routinesList: () => [r], lastReply: async id => replies[id], escalationAccount: () => 'main',
    startEscalation: async o => { started.push(o); return { key: `k${started.length}`, sessionId: `esc${started.length}` }; }, notify: async (k, p) => { pushed.push(p.title); return 1; } });
  await lr.tick();
  assert.equal(store.get().routineEvents.length, 0, 'runs from before Lite looked are never handled');
  const run = (id, status = 'done') => r.history.unshift({ id, status, sessionId: `s${id.slice(1)}`, line: '' });
  run('h1'); await lr.tick();
  assert.equal(started.length, 1); assert.match(started[0].prompt, /Crash on save/); assert.equal(started[0].cwd, '/r/x');
  run('h2'); await lr.tick();
  assert.equal(started.length, 1, 'all clear starts nothing');
  run('h3'); await lr.tick();
  assert.equal(started.length, 1, 'the same title within a week joins the earlier chat');
  assert.match(store.get().routineEvents[0].note, /Same as/);
  run('h4'); await lr.tick(); run('h5'); await lr.tick(); run('h6'); await lr.tick();
  assert.equal(started.length, 3, 'at most three bug chats a routine a day');
  assert.match(store.get().routineEvents[0].note, /Already started 3/);
  r.history.unshift({ id: 'h7', status: 'failed', line: 'Start the Ollama app first.' }); await lr.tick();
  assert.equal(store.get().routineEvents[0].kind, 'failed');
  assert.ok(pushed.some(t => /didn’t finish/.test(t)));
  await lr.tick();
  assert.equal(store.get().routineEvents.filter(x => x.run === 'h7').length, 1, 'each run is handled once');
});

test('routines: one sweep can escalate several things, each with its own details', () => {
  const { escalationsOf } = require('../lib/lite-routines');
  const e = escalationsOf('Read 12 posts.\n\nESCALATE: Story cards vanish on refresh\nThree reports in #bugs, repro below.\n\nESCALATE: **Voice cuts out on iOS 18**\nTwo testers, links.\n\nALL CLEAR: the rest are known or not bugs');
  assert.deepEqual(e.map(x => x.title), ['Story cards vanish on refresh', 'Voice cuts out on iOS 18']);
  assert.match(e[0].details, /Three reports/); assert.doesNotMatch(e[0].details, /Voice/);
  assert.match(e[1].details, /Two testers/); assert.doesNotMatch(e[1].details, /ALL CLEAR/);
});

test('pipeline: a PR’s column comes from its labels; checks fold to one word', () => {
  const { stageOf, ciOf } = require('../lib/lite-pipeline');
  const L = (...n) => n.map(name => ({ name }));
  assert.equal(stageOf(null), 'working');
  assert.equal(stageOf({ state: 'OPEN', labels: L('voyage-bug') }), 'pr');
  assert.equal(stageOf({ state: 'OPEN', labels: L('voyage-bug', 'preview') }), 'preview');
  assert.equal(stageOf({ state: 'OPEN', labels: L('preview', 'community-qa') }), 'testers');
  assert.equal(stageOf({ state: 'MERGED', mergedAt: at(NOW - 2 * D) }, NOW), 'merged');
  assert.equal(stageOf({ state: 'MERGED', mergedAt: at(NOW - 9 * D) }, NOW), null, 'old merges drop off');
  assert.equal(stageOf({ state: 'CLOSED', labels: [] }), null);
  assert.deepEqual(ciOf([]), { state: 'none', failing: [], pending: 0 });
  assert.equal(ciOf([{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }, { name: 'skip', status: 'COMPLETED', conclusion: 'SKIPPED' }]).state, 'passing');
  assert.equal(ciOf([{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }, { name: 'deploy', status: 'IN_PROGRESS' }]).state, 'pending');
  assert.deepEqual(ciOf([{ name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' }, { context: 'ci/x', state: 'PENDING' }]), { state: 'failing', failing: ['lint'], pending: 1 });
  // gh pr checks rows
  assert.equal(ciOf([{ name: 'a', bucket: 'pass' }, { name: 'b', bucket: 'skipping' }]).state, 'passing');
  assert.equal(ciOf([{ name: 'a', bucket: 'pass' }, { name: 'pr-policy', bucket: 'pending' }]).state, 'passing', 'a policy check waiting on ready-for-review doesn’t count');
  assert.deepEqual(ciOf([{ name: 'a', bucket: 'pass' }, { name: 'build', bucket: 'pending' }]), { state: 'pending', failing: [], pending: 1 });
  assert.deepEqual(ciOf([{ name: 'e2e', bucket: 'fail' }, { name: 'b', bucket: 'pending' }]), { state: 'failing', failing: ['e2e'], pending: 1 });
});

test('read-only guard: Latitude read tools and plain read commands pass; writes don’t', () => {
  const { check } = require('../bin/readonly-guard');
  const run = (category, tool) => check('mcp__latitude__run', { category, tool, params: {} }).ok;
  assert.ok(run('slack', 'get-thread-replies')); assert.ok(run('discord', 'get-channel-messages')); assert.ok(run('linear', 'search-issues')); assert.ok(run('github', 'list-open-prs'));
  assert.ok(!run('slack', 'reply-to-thread')); assert.ok(!run('slack', 'post-message')); assert.ok(!run('discord', 'send-message'));
  assert.ok(!run('linear', 'create-issue')); assert.ok(!run('github', 'community-qa-create-pr')); assert.ok(!run('github', 'update-pr')); assert.ok(!run('nope', 'get-x'));
  const sh = cmd => check('Bash', { command: cmd }).ok;
  assert.ok(sh('gh pr list --repo latitudegames/latitude --search "head:community-qa/" --json number,title'));
  assert.ok(sh('gh pr list --json number | jq length'));
  assert.ok(sh('node /x/bin/switcher-glm.js --cd /y "Read #community-qa; don\'t post; report $ costs"'));
  assert.ok(!sh('gh pr edit 1 --add-label preview')); assert.ok(!sh('gh pr list; gh pr merge 1')); assert.ok(!sh('curl -X POST https://slack.com'));
  assert.ok(!sh('echo hi > /tmp/x')); assert.ok(!sh('node x.js $(cat secret)'));
  assert.ok(!check('Write', { file_path: '/tmp/x' }).ok); assert.ok(!check('mcp__slack__slack_post_message', {}).ok);
  assert.ok(check('Read', { file_path: '/tmp/x' }).ok);
});

test('routines: a flow keeps a long escalation prompt and the bug chat’s provider, model and effort', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lite-flow-'));
  const store = lite.createLite({ dataDir: dir });
  const long = 'x'.repeat(9000);
  const f = store.setRoutineFlow('r1', { triage: true, notify: 'important', escalate: { on: true, prompt: long, provider: 'codex', model: 'gpt-6.1-sol', effort: 'medium', permissionMode: 'full' }, maxPerDay: 8 });
  assert.equal(f.escalate.prompt.length, 9000);
  assert.deepEqual([f.escalate.provider, f.escalate.model, f.escalate.effort, f.escalate.permissionMode], ['codex', 'gpt-6.1-sol', 'medium', 'full']);
  const g = store.setRoutineFlow('r2', { escalate: { on: true, prompt: 'p', provider: 'nope', effort: 'huge' } });
  assert.equal(g.escalate.provider, undefined); assert.equal(g.escalate.effort, undefined);
});

test('routines: a weekly routine runs on its day at its time', () => {
  const { nextRun, describeSchedule } = require('../lib/routines');
  const wed = new Date(2026, 9, 14, 12, 0).getTime(); // a Wednesday, noon
  const next = new Date(nextRun({ kind: 'weekly', time: '09:30', day: 1 }, wed));
  assert.equal(next.getDay(), 1); assert.equal(next.getHours(), 9); assert.equal(next.getMinutes(), 30);
  assert.ok(next.getTime() > wed && next.getTime() - wed < 7 * 864e5);
  assert.equal(describeSchedule({ kind: 'weekly', time: '09:30', day: 1 }), 'Every Monday at 9:30 AM');
});

test('waiting chats: only PR moves that matter are news; bots aren’t', () => {
  const { prChange, snapOf, prLinks, standing } = require('../lib/lite-waits');
  const pr = (o = {}) => snapOf({ state: 'OPEN', isDraft: false, reviewDecision: 'REVIEW_REQUIRED', author: { login: 'ryan' }, latestReviews: [], ...o });
  const bot = { author: { login: 'latitude-pr-reviewer' }, state: 'COMMENTED' };
  assert.equal(prChange(null, pr(), 1), null, 'the first look only learns');
  assert.equal(prChange(pr(), pr({ latestReviews: [bot] }), 1), null);
  assert.equal(prChange(pr({ isDraft: true }), pr(), 7), 'PR #7 is out of draft');
  assert.equal(prChange(pr(), pr({ reviewDecision: 'APPROVED', latestReviews: [{ author: { login: 'sean' }, state: 'APPROVED' }] }), 7), 'PR #7 was approved by sean');
  assert.equal(prChange(pr(), pr({ state: 'MERGED' }), 7), 'PR #7 was merged');
  assert.equal(prChange(pr(), pr({ latestReviews: [{ author: { login: 'sean' }, state: 'COMMENTED' }] }), 7), 'sean reviewed PR #7');
  assert.equal(standing(pr({ isDraft: true })), 'Still a draft');
  assert.deepEqual(prLinks('see https://github.com/a/b/pull/1 then https://github.com/a/b/pull/2.'), ['https://github.com/a/b/pull/2', 'https://github.com/a/b/pull/1']);
});

test('Lite counts as used once it has been opened here; idle weeks are left alone unless switched on', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lite-used-'));
  const st = lite.createLite({ dataDir: dir });
  assert.ok(!st.get().used, 'a new install: not used, so no background checks');
  assert.equal(st.setLook({}).autoStartWeeks, false, 'the week-starter is off to begin with');
  assert.equal(st.markUsed(), true, 'the first opening');
  assert.equal(st.markUsed(), false, 'and only the first');
  assert.equal(lite.createLite({ dataDir: dir }).get().used, true, 'remembered');
  assert.equal(st.setLook({ autoStartWeeks: true }).autoStartWeeks, true, 'switched on');
  // A lite.json from before "used" was noted means Lite was in use there.
  const old = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lite-old-'));
  fs.writeFileSync(path.join(old, 'lite.json'), JSON.stringify({ buckets: [] }));
  assert.equal(lite.createLite({ dataDir: old }).get().used, true);
});
