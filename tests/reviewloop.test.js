// "Fix and recheck until clean" (lib/reviewloop.js), with a stand-in chat and stand-in reviews.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReviewLoop } = require('../lib/reviewloop');

function fakeChat() {
  const c = { key: 'k1', state: 'ready', events: [], sent: [], waiters: [] };
  c.emit = ev => c.events.push(ev);
  c.turnDone = () => new Promise(r => c.waiters.push(r));
  c.finish = (ev = { kind: 'result', ok: true }) => { for (const w of c.waiters.splice(0)) w(ev); };
  return c;
}
const tick = () => new Promise(r => setTimeout(r, 5));
const finding = t => ({ title: t });
// Reviews hand out the given findings, round after round.
function setup(rounds) {
  let n = 0;
  const reviews = [];
  const loop = createReviewLoop({
    send: async (chat, text) => { chat.sent.push(text); chat.state = 'busy'; },
    review: async (chat, files, base) => { const id = `r${++n}`; reviews.push({ id, files, base }); return { id, done: Promise.resolve({ state: 'done', findings: rounds[n - 1] || [] }) }; },
    fixText: (what, list) => `fix ${what}: ${list.map(f => f.title).join(', ')}`,
  });
  return { loop, reviews };
}
const steps = c => c.events.map(e => `${e.state}${e.done ? `:${e.done}` : ''}@${e.round}`);

test('reviewloop: fixes, rechecks from the same starting point, and stops when clean', async () => {
  const c = fakeChat(), { loop, reviews } = setup([[]]);
  const { done } = loop.start(c, { id: 'r0', what: 'the changes', base: 'abc', findings: [finding('Bug')], files: ['a.js'] });
  await tick();
  assert.deepEqual(c.sent, ['fix the changes: Bug']);
  c.finish(); await done;
  assert.deepEqual(reviews.map(r => r.base), ['abc']);
  assert.deepEqual(steps(c), ['fixing@1', 'checking@1', 'end:clean@1']);
});

test('reviewloop: stops after three rounds with findings still open', async () => {
  const c = fakeChat(), { loop } = setup([[finding('A')], [finding('B')], [finding('C')]]);
  const { done } = loop.start(c, { id: 'r0', what: 'x', findings: [finding('Z')] });
  for (let i = 0; i < 3; i++) { await tick(); c.state = 'ready'; c.finish(); }
  await done;
  assert.equal(c.sent.length, 3);
  assert.equal(c.events.at(-1).done, 'rounds');
});

test('reviewloop: Stop ends it after the current step, and nothing more is sent', async () => {
  const c = fakeChat(), { loop, reviews } = setup([[finding('A')]]);
  const { done } = loop.start(c, { id: 'r0', what: 'x', findings: [finding('Z')] });
  await tick();
  loop.stop(c);
  c.finish(); await done;
  assert.equal(c.sent.length, 1);
  assert.equal(reviews.length, 0, 'no recheck after stopping');
  assert.equal(c.events.at(-1).done, 'stopped');
});

test('reviewloop: one at a time per chat, and not while Claude is busy', async () => {
  const c = fakeChat(), { loop } = setup([[]]);
  loop.start(c, { id: 'r0', what: 'x', findings: [finding('Z')] });
  assert.throws(() => loop.start(c, { id: 'r0', what: 'x', findings: [finding('Z')] }), /already running/);
  const busy = fakeChat(); busy.key = 'k2'; busy.state = 'busy';
  assert.throws(() => loop.start(busy, { id: 'r0', what: 'x', findings: [finding('Z')] }), /busy/);
  c.finish();
});

/* ---------- reviews both ways (lib/review.js) ---------- */
const { reviewAsk, parseFindings, mergeFindings } = require('../lib/review');

test('review: Claude is asked for findings as JSON, and its answer is read back', () => {
  const ask = reviewAsk({ target: { type: 'uncommittedChanges' } }, 'Add a save system');
  assert.match(ask, /git diff HEAD/);
  assert.match(ask, /What was asked for: Add a save system/);
  assert.match(ask, /Don't change any files/);
  const r = parseFindings('Mostly solid.\n```json\n{"findings":[{"title":"Save can overwrite","file":"save.lua","start":"40","priority":"P1"},{"nope":1}]}\n```');
  assert.equal(r.overall, 'Mostly solid.');
  assert.deepEqual(r.findings.map(f => [f.title, f.file, f.start, f.priority]), [['Save can overwrite', 'save.lua', 40, 'P1']]);
  assert.deepEqual(parseFindings('No JSON here, all good.').findings, []);
});

test('review: a dual review marks what both found, and puts it first', () => {
  const m = mergeFindings([{ title: 'Off by one', file: 'a.js', start: 10, priority: 'P2' }, { title: 'Slow loop', file: 'b.js' }], [{ title: 'Index error', file: 'A.js', start: 12 }, { title: 'Typo', file: 'c.js', priority: 'P3' }]);
  assert.deepEqual(m.map(f => `${f.by}:${f.title}`), ['both:Off by one', 'claude:Typo', 'codex:Slow loop']);
});
