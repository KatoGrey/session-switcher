'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSessionStore, readLinesFrom } = require('../lib/sessions');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-session-index-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'projects'), dataDir = path.join(dir, 'data'), project = path.join(dir, 'work');
  fs.mkdirSync(path.join(root, 'project'), { recursive: true }); fs.mkdirSync(dataDir); fs.mkdirSync(project);
  const id = 'aaaaaaaa-1111-4222-8333-444444444444', file = path.join(root, 'project', `${id}.jsonl`);
  const stamp = new Date().toISOString();
  const question = text => ({ type: 'user', cwd: project, timestamp: stamp, message: { content: text } });
  const reply = (text, id = 'm1') => ({ type: 'assistant', timestamp: stamp, message: { id, model: 'claude-test', content: [{ type: 'text', text }] } });
  const write = entries => fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return { file, id, root, dataDir, question, reply, write, store: () => createSessionStore({ root, dataDir }) };
}

test('session index: a restart reuses unchanged search text and stats without streaming the transcript again', async t => {
  const f = fixture(t);
  f.write([f.question('A normal question.'), f.reply('The answer includes saffronneedle.')]);
  const first = f.store(); await first.refreshIndex();
  const original = fs.createReadStream, reads = [];
  fs.createReadStream = function (file, options) { if (file === f.file) reads.push(options); return original.apply(this, arguments); };
  t.after(() => { fs.createReadStream = original; });
  const second = f.store(); await second.refreshIndex();
  assert.deepEqual(reads, [], 'an unchanged transcript should come from its disposable index cache');
  assert.equal(second.search('saffronneedle').hits.length, 1);
  const preview = await second.preview(f.id);
  assert.equal(preview.stats.prompts, 1); assert.equal(preview.stats.replies, 1);
  assert.equal(second.activity(Date.now() - 60000)[0].times.length, 2);
});

test('sessions: one folder written two ways is one project', { skip: process.platform !== 'win32' ? 'only Windows writes a folder two ways' : false }, async t => {
  const f = fixture(t);
  const cwd = path.join(path.dirname(f.root), 'work');
  const stamp = new Date().toISOString();
  const chat = (id, dir, text) => fs.writeFileSync(path.join(f.root, 'project', `${id}.jsonl`), `${JSON.stringify({ type: 'user', cwd: dir, timestamp: stamp, message: { content: text } })}\n${JSON.stringify(f.reply('ok'))}\n`);
  chat(f.id, cwd.replace(/\\/g, '/'), 'First, written the other way.');
  chat('bbbbbbbb-1111-4222-8333-444444444444', cwd, 'Second, the way Windows writes it.');
  chat('cccccccc-1111-4222-8333-444444444444', cwd.toUpperCase(), 'Third, in capitals.');
  const { projects } = f.store().scan(true);
  assert.equal(projects.length, 1, JSON.stringify(projects.map(p => p.cwd)));
  assert.equal(projects[0].sessions.length, 3);
  assert.ok(!projects[0].cwd.includes('/'), projects[0].cwd);
  assert.ok(projects[0].sessions.every(s => !s.cwd.includes('/')));
});

test('session search: async results preserve ranking and snippets while yielding and respecting cancellation', async t => {
  const f = fixture(t);
  f.write([f.question('Search across the title and text.'), f.reply('An answer with MixedCase and literal.* characters.')]);
  const store = f.store(); await store.refreshIndex();
  for (const query of ['mixedcase', 'literal.*', 'title mixedcase', 'missing', '']) {
    let responsive = false; setImmediate(() => { responsive = true; });
    assert.deepEqual(await store.searchAsync(query), store.search(query));
    assert.equal(responsive, true, 'another app callback runs before a search completes');
  }
  const stopped = new AbortController(); stopped.abort(new Error('viewer left'));
  await assert.rejects(store.searchAsync('mixedcase', 60, {signal:stopped.signal}), /viewer left/);
  const leaving = new AbortController();
  const pending = store.searchAsync('mixedcase', 60, {signal:leaving.signal});
  leaving.abort(new Error('query replaced'));
  await assert.rejects(pending, /query replaced/);
});

test('session index: a same-size rewrite replaces stale matches and counts', async t => {
  const f = fixture(t);
  f.write([f.question('Question alpha.'), f.reply('oldindexneedle')]);
  const s = f.store(); await s.refreshIndex();
  const size = fs.statSync(f.file).size;
  f.write([f.question('Question omega.'), f.reply('newindexneedle')]);
  assert.equal(fs.statSync(f.file).size, size);
  const changed = new Date(Date.now() + 5000); fs.utimesSync(f.file, changed, changed);
  s.invalidate(); await s.refreshIndex();
  assert.equal(s.search('oldindexneedle').hits.length, 0);
  assert.equal(s.search('newindexneedle').hits.length, 1);
  const preview = await s.preview(f.id);
  assert.equal(preview.stats.prompts, 1); assert.equal(preview.stats.replies, 1);
});

test('session index: replacing a transcript with matching size and time invalidates the running index', async t => {
  const f = fixture(t);
  f.write([f.question('Question alpha.'), f.reply('oldindexneedle')]);
  const before = fs.statSync(f.file), s = f.store(); await s.refreshIndex();
  fs.renameSync(f.file, `${f.file}.old`);
  f.write([f.question('Question omega.'), f.reply('newindexneedle')]);
  fs.utimesSync(f.file, before.atime, before.mtime);
  assert.equal(fs.statSync(f.file).size, before.size);
  s.invalidate(); await s.refreshIndex();
  assert.equal(s.search('oldindexneedle').hits.length, 0);
  assert.equal(s.search('newindexneedle').hits.length, 1);
});

test('session index: after a restart only appended complete records are indexed', async t => {
  const f = fixture(t);
  f.write([f.question('Original question.'), f.reply('Original answer.')]);
  const first = f.store(); await first.refreshIndex();
  const offset = fs.statSync(f.file).size;
  fs.appendFileSync(f.file, JSON.stringify(f.question('A new request.')) + '\n' + JSON.stringify(f.reply('appendneedle', 'm2')) + '\n');
  const original = fs.createReadStream, reads = [];
  fs.createReadStream = function (file, options) { if (file === f.file) reads.push(options.start); return original.apply(this, arguments); };
  t.after(() => { fs.createReadStream = original; });
  const second = f.store(); await second.refreshIndex();
  assert.deepEqual(reads, [offset], 'the original part is not re-indexed on restart');
  assert.equal(second.search('appendneedle').hits.length, 1);
  const preview = await second.preview(f.id);
  assert.equal(preview.stats.prompts, 2); assert.equal(preview.stats.replies, 2);
});

test('session index: a failed append read publishes nothing and retry does not duplicate messages or activity', async t => {
  const f = fixture(t);
  f.write([f.question('Original question.'), f.reply('Original answer.')]);
  const s = f.store(); await s.refreshIndex();
  const appended = [f.question('A new question.'), f.reply('failedreadneedle ' + 'x'.repeat(70000), 'm2'), f.reply('Final answer.', 'm3')];
  appended[2].message.content.push({ type: 'tool_use', name: 'Edit', id: 'edit-1', input: {} });
  const bytes = Buffer.from(appended.map(e => JSON.stringify(e)).join('\n') + '\n');
  fs.appendFileSync(f.file, bytes);
  const original = fs.createReadStream;
  fs.createReadStream = function (file) {
    if (file !== f.file) return original.apply(this, arguments);
    return require('node:stream').Readable.from((async function* () {
      yield bytes;
      throw Object.assign(new Error('Synthetic read failure after complete records'), { code: 'EIO' });
    })());
  };
  try {
    await s.refreshIndex();
    assert.equal(s.search('failedreadneedle').hits.length, 0, 'an incomplete index update is not exposed to search');
    assert.equal(s.activity(0)[0].times.length, 2, 'failed updates do not alter published activity');
  } finally { fs.createReadStream = original; }
  await s.refreshIndex();
  const preview = await s.preview(f.id);
  assert.equal(preview.stats.prompts, 2); assert.equal(preview.stats.replies, 3); assert.equal(preview.stats.tools, 1);
  assert.equal(s.activity(0)[0].times.length, 5);
  assert.equal(s.search('failedreadneedle').hits[0].count, 1);
});

test('session index: an incomplete UTF-8 record is read once after it finishes', async t => {
  const f = fixture(t);
  const text = Buffer.from('first\nÉtoile 🌟\n');
  fs.writeFileSync(f.file, text.subarray(0, text.length - 3));
  const lines = [];
  const offset = await readLinesFrom(f.file, 0, line => lines.push(line));
  assert.equal(offset, 6); assert.deepEqual(lines, ['first']);
  fs.appendFileSync(f.file, text.subarray(text.length - 3));
  const end = await readLinesFrom(f.file, offset, line => lines.push(line));
  assert.equal(end, text.length); assert.deepEqual(lines, ['first', 'Étoile 🌟']);
});

test('session index: oversized records do not hide surrounding messages or repeat after an append', async t => {
  const f = fixture(t), budget = 64 * 1024;
  const first = JSON.stringify(f.question('before the huge record'));
  const last = JSON.stringify(f.reply('Étoile 🌟 after the huge record'));
  const huge = JSON.stringify(f.reply('x'.repeat(budget * 3)));
  const complete = `${first}\n${huge}\n${last}\n`;
  fs.writeFileSync(f.file, complete + huge.slice(0, -1));
  const lines = [];
  const offset = await readLinesFrom(f.file, 0, line => lines.push(JSON.parse(line)), { maxLineBytes: budget });
  assert.equal(offset, Buffer.byteLength(complete), 'an incomplete oversized record is not mistaken for a complete entry');
  assert.deepEqual(lines, [JSON.parse(first), JSON.parse(last)]);
  fs.appendFileSync(f.file, '}\n' + JSON.stringify(f.reply('the next reply', 'next')) + '\n');
  const end = await readLinesFrom(f.file, offset, line => lines.push(JSON.parse(line)), { maxLineBytes: budget });
  assert.equal(end, fs.statSync(f.file).size);
  assert.deepEqual(lines.map(e => e.message.content), [f.question('before the huge record').message.content, f.reply('Étoile 🌟 after the huge record').message.content, f.reply('the next reply', 'next').message.content]);
  assert.equal(fs.readFileSync(f.file, 'utf8').startsWith(complete), true, 'indexing never edits the original transcript');
});

test('session index: the record limit is in bytes and accepts a complete record exactly at the limit', async t => {
  const f = fixture(t), line = 'Étoile 🌟', bytes = Buffer.byteLength(line);
  fs.writeFileSync(f.file, `${line}\n${line}!\nsmall\n`);
  const lines = [];
  assert.equal(await readLinesFrom(f.file, 0, text => lines.push(text), { maxLineBytes: bytes }), fs.statSync(f.file).size);
  assert.deepEqual(lines, [line, 'small']);
});

test('session index: damaged or unavailable caches rebuild without losing search', async t => {
  const f = fixture(t);
  f.write([f.question('Question.'), f.reply('cachefallbackneedle')]);
  await f.store().refreshIndex();
  const cacheRoot = path.join(f.dataDir, '.session-index');
  const cacheDir = path.join(cacheRoot, fs.readdirSync(cacheRoot)[0]);
  const cached = path.join(cacheDir, fs.readdirSync(cacheDir).find(n => n.endsWith('.json')));
  fs.writeFileSync(cached, '{damaged');
  const rebuilt = f.store(); await rebuilt.refreshIndex();
  assert.equal(rebuilt.search('cachefallbackneedle').hits.length, 1);
  // Only disposable files under this test's cache root are removed.
  fs.rmSync(cacheRoot, { recursive: true, force: true });
  fs.writeFileSync(cacheRoot, 'a file prevents creating the cache folder');
  const uncached = f.store(); await uncached.refreshIndex();
  assert.equal(uncached.search('cachefallbackneedle').hits.length, 1);
});

test('session index: changed content with preserved size and mtime invalidates a restart cache', async t => {
  const f = fixture(t);
  f.write([f.question('Question.'), f.reply('beforewitnessneedle')]);
  await f.store().refreshIndex();
  const before = fs.statSync(f.file);
  f.write([f.question('Question.'), f.reply('after_witnessneedle')]);
  assert.equal(fs.statSync(f.file).size, before.size);
  fs.utimesSync(f.file, before.atime, before.mtime);
  const second = f.store(); await second.refreshIndex();
  assert.equal(second.search('beforewitnessneedle').hits.length, 0);
  assert.equal(second.search('after_witnessneedle').hits.length, 1);
});

test('session index: a long chat keeps its beginning and recent text searchable across restarts', async t => {
  const f = fixture(t);
  f.write([f.question('A long discussion.'), f.reply('northneedle ' + 'a'.repeat(100000)), ...Array.from({ length: 22 }, (_, i) => f.reply('b'.repeat(100000), `m-${i + 2}`)), f.reply('southneedle', 'last')]);
  const first = f.store(); await first.refreshIndex();
  const second = f.store(); await second.refreshIndex();
  for (const s of [first, second]) {
    const found = s.search('northneedle southneedle');
    assert.equal(found.hits.length, 1, 'words in the head and tail can match the same chat');
    assert.match(found.hits[0].snippet, /northneedle/);
    assert.equal(s.search('southneedle').hits.length, 1);
    assert.equal((await s.preview(f.id)).stats.replies, 24);
  }
});

test('session index: deleting a transcript removes its activity and disposable cache', async t => {
  const f = fixture(t);
  f.write([f.question('Question.'), f.reply('Answer.')]);
  const s = f.store(); await s.refreshIndex();
  assert.equal(s.activity(Date.now() - 60000).length, 1);
  fs.unlinkSync(f.file);
  await s.refreshIndex();
  assert.deepEqual(s.activity(0), []);
  const cacheRoot = path.join(f.dataDir, '.session-index');
  const cacheDir = path.join(cacheRoot, fs.readdirSync(cacheRoot)[0]);
  assert.deepEqual(fs.readdirSync(cacheDir), []);
});

test('session index: its cached transcript text never goes into a share copy', t => {
  const f = fixture(t), hidden = path.join(f.dataDir, '.session-index', 'sample');
  fs.mkdirSync(hidden, { recursive: true });
  fs.writeFileSync(path.join(hidden, 'private.txt'), 'cached conversation');
  fs.writeFileSync(path.join(f.dataDir, 'main.js'), '// app');
  const { appFiles } = require('../lib/sharecopy');
  assert.deepEqual(appFiles(f.dataDir).map(f => f.name), ['main.js']);
});
