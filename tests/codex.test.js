'use strict';
// Codex's connection (lib/codex.js): its messages are read as bytes, so one too big to read is
// skipped instead of cutting the app off from Codex, and a chat's history that's too big to read at
// once comes in fewer turns at a time.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { jsonLines, CodexServer, createCodex } = require('../lib/codex');

test('codex: messages are read line by line; one too long is skipped, and the ones after it still arrive', () => {
  const stream = new EventEmitter(), lines = [], long = [];
  jsonLines(stream, l => lines.push(l), (head, size) => long.push({ head, size }), 100);
  const big = `{"id":7,"result":"${'x'.repeat(300)}"}`;
  // Split anywhere, the way a pipe hands them over.
  const all = Buffer.from(`{"id":1,"result":"ok"}\n${big}\n{"id":2,"result":"é"}\n{"method":"turn/started"}`);
  stream.emit('data', Buffer.alloc(0));   // an empty piece is nothing
  let i = 0;
  for (const n of [5, 25, 30, 140, 150, 50, 13]) { stream.emit('data', all.subarray(i, i + n)); i += n; }
  stream.emit('data', all.subarray(i));
  stream.emit('end');
  assert.deepEqual(lines, ['{"id":1,"result":"ok"}', '{"id":2,"result":"é"}', '{"method":"turn/started"}'], 'the ones before and after, whole (even a character split between pieces)');
  assert.equal(long.length, 1, 'the long one is noted once, not once per piece');
  assert.match(long[0].head, /^\{"id":7,/); assert.equal(long[0].size, big.length);
});

test('codex: an answer too big to read fails its own request at once, saying so', async () => {
  const logs = [], s = new CodexServer({}, m => logs.push(m));
  const p = new Promise((resolve, reject) => s.waiting.set(7, { resolve, reject, timer: setTimeout(() => reject(new Error('timed out')), 5000), method: 'thread/turns/list' }));
  s.tooLong('{"id":7,"result":{"data":[', 700 * 1048576);
  await assert.rejects(p, e => e.tooBig === true && /too big to read/.test(e.message));
  assert.equal(s.waiting.size, 0);
  assert.match(logs[0], /700 MB was too big to read \(the answer to thread\/turns\/list\)/);
  s.tooLong('{"method":"item/completed","params":', 200 * 1048576);
  assert.match(logs[1], /200 MB was too big to read; skipped it/, 'a notification is only noted');
});

test('codex: a chat’s history too big for twelve turns comes three, then one, at a time, and that chat remembers', async () => {
  const real = CodexServer.prototype.request, asked = [];
  CodexServer.prototype.request = async function (method, params) {
    asked.push(`${params.limit}/${params.itemsView}${params.cursor ? `@${params.cursor}` : ''}`);
    if (params.limit > 1) throw Object.assign(new Error('Codex’s answer was too big to read at once.'), { tooBig: true });
    return { data: [{ id: `turn-${asked.length}`, startedAt: 1, items: [] }], nextCursor: 'older' };
  };
  try {
    const codex = createCodex({ getConfig: () => ({ prefs: { cleanEnv: false }, codex: { enabled: true } }), chats: {}, usage: {} });
    const h = await codex.history('t-pictures');
    assert.deepEqual(asked, ['12/full', '3/full', '1/full'], 'fewer turns each time, every step still included');
    assert.equal(h.cursor, 'older', 'the rest come with Earlier');
    await codex.history('t-pictures', 'older');
    assert.equal(asked.at(-1), '1/full@older', 'Earlier starts at the size that worked');
    assert.equal(asked.length, 4);
    await codex.history('t-other');
    assert.equal(asked[4], '12/full', 'another chat starts at twelve again');
  } finally { CodexServer.prototype.request = real; }
});

const fs = require('fs'), os = require('os'), path = require('path');
const { createLog } = require('../lib/logger');
test('log: the same message thousands of times is written once, then how many more times; others as they come', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-log-')), 'switcher.log');
  let t = Date.parse('2026-10-29T00:55:00Z');
  const log = createLog(file, { echo: false, now: () => t });
  log('Codex: a message of 700 MB was too big to read; skipped it.');
  for (let i = 0; i < 3452; i++) { t += 10; log('Codex: a message of 700 MB was too big to read; skipped it.'); }
  log('Error on GET /api/chat/history: something else');
  t += 61e3; log('Error on GET /api/chat/history: something else');
  log.flush();
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  assert.equal(lines.length, 4, lines.join('\n'));
  assert.match(lines[0], /too big to read/);
  assert.match(lines[1], /\(the message above, 3452 more times\)/);
  assert.match(lines[2], /something else/);
  assert.match(lines[3], /something else/, 'a minute on, a repeat is written again');
});
