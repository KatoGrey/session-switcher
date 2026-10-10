// Claude and Codex in one chat: what each is told it missed (lib/duo.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { entries, catchUp, ITEMS_MAX } = require('../lib/duo');

const t0 = Date.parse('2026-10-09T12:00:00Z');
const at = min => new Date(t0 + min * 60000).toISOString();
const user = (min, text) => ({ kind: 'user', text, at: at(min) });
const reply = (min, text, tools = []) => ({ kind: 'assistant', at: at(min), blocks: [...tools, ...(text ? [{ type: 'text', text }] : [])] });
const edit = path => ({ type: 'tool', name: 'Edit', summary: path, meta: { path } });
const bash = () => ({ type: 'tool', name: 'Bash', summary: 'npm test' });

test('duo: Claude hears what you asked Codex and what Codex said and did', () => {
  const codex = [user(1, 'Make the key art, 16:9.'), reply(2, 'Here it is. Saved to art/key.png.', [edit('art/key.png'), bash()])];
  const block = catchUp({ to: 'claude', theirs: entries(codex, 'codex') });
  assert.match(block, /^<shared-context items="2">\nYou and Codex share this chat; the user sees you both\./);
  assert.match(block, /The user, to Codex:\nMake the key art, 16:9\./);
  assert.match(block, /Codex:\nHere it is\. Saved to art\/key\.png\.\n\(Codex changed art\/key\.png; ran 1 command\.\)/);
  assert.ok(block.endsWith('</shared-context>\n\n'));
});

test('duo: only what came after it last caught up', () => {
  const claude = [user(1, 'Old question'), reply(2, 'Old answer'), user(10, 'New question'), reply(11, 'New answer')];
  const block = catchUp({ to: 'codex', theirs: entries(claude, 'claude', at(5)) });
  assert.doesNotMatch(block, /Old/);
  assert.match(block, /The user, to Claude:\nNew question/);
  assert.match(block, /Claude:\nNew answer/);
});

test('duo: a Codex reply without a time of its own counts from its turn’s start', () => {
  const codex = [user(1, 'Before'), { kind: 'assistant', blocks: [{ type: 'text', text: 'Old reply' }] }, user(10, 'After'), { kind: 'assistant', blocks: [{ type: 'text', text: 'New reply' }] }];
  const list = entries(codex, 'codex', at(5));
  assert.deepEqual(list.map(e => e.text), ['After', 'New reply']);
});

test('duo: a message it got itself isn’t repeated back (sent to both, or passed on)', () => {
  const claude = [user(1, 'Plan the release together.'), reply(2, 'Here’s a plan: …')];
  const block = catchUp({ to: 'codex', theirs: entries(claude, 'claude'), heard: ['Plan the release together.'] });
  assert.doesNotMatch(block, /The user, to Claude/);
  assert.match(block, /Claude:\nHere’s a plan/);
  assert.match(block, /items="1"/);
});

test('duo: the catch-up inside a message isn’t passed on again', () => {
  const codex = [user(1, '<shared-context items="1">\nClaude:\nsomething Claude said\n</shared-context>\n\nDo number 2.'), reply(2, 'Done.')];
  const block = catchUp({ to: 'claude', theirs: entries(codex, 'codex') });
  assert.doesNotMatch(block, /something Claude said/);
  assert.match(block, /The user, to Codex:\nDo number 2\./);
});

test('duo: a reply still being written says so', () => {
  const block = catchUp({ to: 'claude', theirs: entries([user(1, 'Go'), reply(2, 'Halfway there')], 'codex'), busy: true });
  assert.match(block, /Codex \(still working on it\):\nHalfway there/);
});

test('duo: a long stretch keeps the newest and says how many are left out', () => {
  const many = [];
  for (let i = 0; i < 40; i++) many.push(user(i * 2, `Question ${i}`), reply(i * 2 + 1, `Answer ${i} ${'x'.repeat(300)}`));
  const block = catchUp({ to: 'codex', theirs: entries(many, 'claude') });
  assert.match(block, new RegExp(`items="${ITEMS_MAX}"`));
  assert.match(block, /Answer 39/);
  assert.doesNotMatch(block, /Question 0\n/);
  assert.match(block, /\(56 earlier messages are left out; ask the user if you need them\.\)/);
});

test('duo: files you undid are mentioned, even with nothing else new', () => {
  const block = catchUp({ to: 'claude', undone: [['a.js', 'b.js'], ['a.js']] });
  assert.match(block, /^<shared-context items="0">\nThe user undid the file changes from your earlier reply: a\.js, b\.js are back as before it\./);
});

test('duo: nothing new, nothing added', () => {
  assert.equal(catchUp({ to: 'claude', theirs: [] }), '');
  assert.equal(catchUp({ to: 'codex', theirs: entries([reply(1, '')], 'claude') }), '');
});
