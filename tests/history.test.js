'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readHistory, LIMITS } = require('../lib/chat');

function transcript(t, entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'chat.jsonl');
  fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return file;
}
const user = (id, text) => ({ type: 'user', uuid: `u-${id}`, timestamp: new Date(1700000000000 + id * 1000).toISOString(), message: { content: text } });
const assistant = (id, content) => ({ type: 'assistant', uuid: `a-${id}`, timestamp: new Date(1700000000000 + id * 1000 + 500).toISOString(), message: { id: `m-${id}`, content } });

test('history: reading a page yields to other app work before it completes', async t => {
  const entries = Array.from({ length: 4000 }, (_, i) => user(i, `Message ${i}: ${'details '.repeat(40)}`));
  const file = transcript(t, entries);
  let responsive = false;
  setImmediate(() => { responsive = true; });
  const page = await readHistory(file, { limit: 60 });
  assert.equal(responsive, true, 'opening history must not hold all app events until the whole parse finishes');
  assert.equal(page.items.length, 60);
  assert.equal(page.items.at(-1).uuid, 'u-3999');
});

test('history: widening a page preserves messages, split replies, tools and pictures', async t => {
  const picture = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } };
  const file = transcript(t, [
    user(1, 'Look at this.'),
    assistant(1, [{ type: 'text', text: 'Opening the file.' }, { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'large.txt' } }]),
    { type: 'user', timestamp: new Date(1700000001800).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: [{ type: 'text', text: 'x'.repeat(5 * 1024 * 1024) }, picture] }] } },
    assistant(1, [{ type: 'text', text: 'The file is ready.' }]),
    user(2, [{ type: 'text', text: 'Use the image.' }, picture]),
  ]);
  const page = await readHistory(file, { limit: 20 });
  assert.equal(page.cursor, null);
  assert.deepEqual(page.items.map(e => e.kind), ['user', 'assistant', 'user']);
  const reply = page.items[1];
  assert.deepEqual(reply.blocks.filter(b => b.type === 'text').map(b => b.text), ['Opening the file.', 'The file is ready.']);
  assert.equal(reply.blocks.find(b => b.type === 'tool').result.images[0].src, 'data:image/png;base64,aGVsbG8=');
  assert.equal(page.items[2].images[0].src, 'data:image/png;base64,aGVsbG8=');
});

test('history: older pages and a live cutoff return each complete message once', async t => {
  const entries = Array.from({ length: 96 }, (_, i) => [user(i, `Question ${i}`), assistant(i, [{ type: 'text', text: `Answer ${i}` }])]).flat();
  const file = transcript(t, entries), seen = [];
  let cursor = null;
  do {
    const page = await readHistory(file, { cursor, until: new Date(1700000000000 + 80 * 1000).toISOString(), limit: 13 });
    seen.unshift(...page.items.map(e => e.uuid));
    assert.notEqual(page.cursor, cursor || 'start', 'Earlier always advances');
    cursor = page.cursor;
  } while (cursor);
  assert.deepEqual(seen, entries.slice(0, 160).map(e => e.uuid));
});

test('history: an oversized record cannot widen past the scan budget or trap Earlier at one cursor', async t => {
  const oldBudget = LIMITS.historyBytes;
  LIMITS.historyBytes = 3 * 1024 * 1024;
  t.after(() => { LIMITS.historyBytes = oldBudget; });
  const file = transcript(t, [user(1, 'Before the huge record'), user(2, 'x'.repeat(5 * 1024 * 1024)), user(3, 'After the huge record')]);
  const first = await readHistory(file);
  assert.deepEqual(first.items.map(e => e.uuid), ['u-3'], 'one request stays within its bounded tail window');
  assert.ok(first.cursor, 'older history remains available');
  const seen = [...first.items.map(e => e.uuid)];
  let cursor = first.cursor, pages = 0;
  while (cursor) {
    const page = await readHistory(file, { cursor });
    assert.ok(page.cursor === null || Number(page.cursor) < Number(cursor), 'Earlier advances even across an oversized partial line');
    seen.unshift(...page.items.map(e => e.uuid)); cursor = page.cursor;
    assert.ok(++pages < 5, 'paging must finish');
  }
  assert.deepEqual(seen, ['u-1', 'u-3'], 'complete messages around the oversized record appear once');
});

test('history: a step knows how long it took, and a subagent step which subagent and model', async t => {
  const { toolView } = require('../lib/chat');
  const file = transcript(t, [
    user(1, 'Check it.'),
    assistant(1, [{ type: 'tool_use', id: 'tool-a', name: 'Agent', input: { description: 'Find the menu code', prompt: 'Look for it.', subagent_type: 'session-switcher:scout' } }]),
    { type: 'user', timestamp: new Date(1700000001500 + 4200).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: 'tool-a', content: 'Found it.' }] } },
  ]);
  const page = await readHistory(file, { limit: 20 });
  const step = page.items.find(it => it.kind === 'assistant').blocks[0];
  assert.equal(step.ms, 4200);
  assert.deepEqual(step.meta, { agent: 'session-switcher:scout', model: null, effort: null });
  assert.deepEqual(toolView('Task', { description: 'x', subagent_type: 'Explore', model: 'haiku', effort: 'low' }).meta, { agent: 'Explore', model: 'haiku', effort: 'low' });
  assert.equal(toolView('Agent', { description: 'x', prompt: 'y' }).meta, null);
});
