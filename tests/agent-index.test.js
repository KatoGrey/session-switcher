'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { execFileSync } = require('node:child_process');
const zlib = require('node:zlib');
const { createAgentIndex } = require('../lib/agent-index');

const codex = (role, text, extra = []) => ({ type: 'response_item', payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }, ...extra] } });
const gemini = (type, content) => ({ type, content });
const line = value => JSON.stringify(value) + '\n';
const all = value => value ? value.full === undefined ? value.head + '\n' + value.tail : value.full : '';
const chars = value => value ? value.full === undefined ? value.head.length + value.tail.length : value.full.length : 0;
const tick = () => new Promise(resolve => setImmediate(resolve));
function archive(row, bytes = null) {
  const file = row.file + '.zst';
  fs.writeFileSync(file, zlib.zstdCompressSync(bytes || fs.readFileSync(row.file)));
  fs.unlinkSync(row.file);
  return { ...row, file };
}
// Small independent raw/RLE frames exercise header lengths and boundaries which normal
// compression defaults don't produce. The native decoder validates every complete fixture.
function framed(blocks, { single = false, sizeFlag = 0, dictionaryFlag = 0, unused = false } = {}) {
  const total = blocks.reduce((n, b) => n + (b.size === undefined ? b.bytes.length : b.size), 0);
  const descriptor = (sizeFlag << 6) | (single ? 32 : 0) | (unused ? 16 : 0) | dictionaryFlag;
  const width = sizeFlag ? 1 << sizeFlag : single ? 1 : 0, size = Buffer.alloc(width);
  if (width === 8) size.writeBigUInt64LE(BigInt(total));
  else if (width) size.writeUIntLE(sizeFlag === 1 ? total - 256 : total, 0, width);
  const header = Buffer.concat([Buffer.from([0x28, 0xb5, 0x2f, 0xfd, descriptor]), single ? Buffer.alloc(0) : Buffer.from([0]), Buffer.alloc([0, 1, 2, 4][dictionaryFlag]), size]);
  const data = blocks.map((b, i) => {
    const block = Buffer.alloc(3), length = b.size === undefined ? b.bytes.length : b.size;
    block.writeUIntLE((length << 3) | ((b.type || 0) << 1) | (i === blocks.length - 1 ? 1 : 0), 0, 3);
    return Buffer.concat([block, b.bytes]);
  });
  return { bytes: Buffer.concat([header, ...data]), headerSize: header.length };
}

function fixture(t, options = {}) {
  // (Its real path: a Mac's temp folder is reached through a link, and GitHub's Windows one by a short name.)
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-agent-index-')));
  const home = path.join(root, 'codex'), cli = path.join(root, 'gemini'), dataDir = path.join(root, 'data');
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(cli, 'brain'), { recursive: true });
  const stores = [], logs = [], roots = { codex: [home], gemini: [cli] };
  const create = () => { const store = createAgentIndex({ dataDir, getRoots: () => roots, log: s => logs.push(s), refreshMs: 0, ...options }); stores.push(store); return store; };
  const source = (provider, id = randomUUID(), entries = []) => {
    const file = provider === 'codex' ? path.join(home, 'sessions', '2026', '10', '31', `rollout-2026-10-31-${id}.jsonl`)
      : path.join(cli, 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, entries.map(line).join(''));
    return { id, provider, updated: 1, file };
  };
  t.after(async () => {
    for (const s of stores) s.stop();
    await Promise.all(stores.map(s => s.idle()));
    assert.equal(path.dirname(path.resolve(root)).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(root).startsWith('ss-agent-index-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, home, cli, roots, dataDir, create, source, logs };
}

test('agent index: selected Codex and Gemini words, without images, wrappers, tools or injected context', async t => {
  const f = fixture(t), c = f.source('codex', undefined, [
    codex('developer', 'hidden developer'),
    codex('user', '# AGENTS.md instructions for C:\\project\n\n<INSTRUCTIONS>hidden repository instructions</INSTRUCTIONS>'),
    codex('user', '# AGENTS.md instructions for C:\\project\n<INSTRUCTIONS>hidden rules</INSTRUCTIONS>\nGenuine text after instructions'),
    { type: 'event_msg', payload: { type: 'user_message', message: 'duplicate event' } },
    { type: 'response_item', payload: { type: 'reasoning', text: 'hidden reasoning' } },
    codex('user', '<environment_context>hidden environment</environment_context>', [
      { type: 'input_text', text: '<shared-context>hidden other agent</shared-context>\n<other-chat>hidden other chat</other-chat>\nActual request' },
      { type: 'input_text', text: '<shared-context>hidden queued relay</shared-context>Second queued request' },
      { type: 'input_image', image_url: 'hidden picture' },
    ]),
    codex('assistant', 'Actual answer', [{ type: 'text', text: 'Extra text block' }]),
  ]);
  const g = f.source('gemini', undefined, [
    gemini('USER_INPUT', 'hidden runtime <USER_REQUEST><shared-context>hidden relay</shared-context>Gemini request</USER_REQUEST> hidden runtime tail'),
    { ...gemini('PLANNER_RESPONSE', 'Gemini answer'), tool_calls: [{ args: 'hidden tool' }] },
    gemini('GENERIC', 'hidden result'),
  ]);
  const excluded = f.source('codex', undefined, [codex('user', 'not selected')]);
  const original = fs.createReadStream, read = [];
  t.mock.method(fs, 'createReadStream', (file, opts) => { read.push(file); return original(file, opts); });
  const ix = f.create();
  ix.request([c, g, { id: randomUUID(), provider: 'claude' }]);
  assert.equal(ix.textOf(c.id), null, 'request returns before filesystem work starts');
  assert.equal(ix.progress.ready, false);
  await ix.idle();
  assert.deepEqual(ix.progress, { done: 2, total: 2, ready: true });
  assert.equal(all(ix.textOf(c.id)), 'Genuine text after instructions\n\nActual request\nSecond queued request\n\nActual answer\nExtra text block');
  assert.equal(all(ix.textOf(g.id)), 'Gemini request\n\nGemini answer');
  assert.ok(!read.includes(excluded.file));
  assert.equal(ix.textOf(excluded.id), null);
});

test('agent index: cached restart and partial UTF-8 append resume at the last complete record', async t => {
  const f = fixture(t), a = f.source('codex', undefined, [codex('user', 'Beginning')]);
  const prefixSize = fs.statSync(a.file).size;
  const next = Buffer.from(line(codex('assistant', 'Latest 🌲 reply'))), cut = next.indexOf(Buffer.from('🌲')) + 2;
  fs.appendFileSync(a.file, next.subarray(0, cut));
  const first = f.create(); first.request([a]); await first.idle();
  assert.equal(all(first.textOf(a.id)), 'Beginning');
  first.stop();
  const original = fs.createReadStream, starts = [];
  t.mock.method(fs, 'createReadStream', (file, opts) => { if (file === a.file) starts.push(opts.start); return original(file, opts); });
  const second = f.create(); second.request([a]); await second.idle();
  assert.deepEqual(starts, [], 'unchanged restart reads the small persistent cache');
  fs.appendFileSync(a.file, next.subarray(cut));
  second.request([a]); await second.idle();
  assert.deepEqual(starts, [prefixSize]);
  assert.equal(all(second.textOf(a.id)), 'Beginning\n\nLatest 🌲 reply');
  assert.equal(fs.readdirSync(path.join(f.dataDir, '.session-index', 'agent-v1')).filter(n => n.endsWith('.tmp')).length, 0);
});

test('agent index: oversized records and unfinished oversized appends are skipped with bounded offsets', async t => {
  const f = fixture(t), a = f.source('codex', undefined, [codex('user', 'before image')]);
  fs.appendFileSync(a.file, '{"picture":"' + 'x'.repeat(3 * 1024 * 1024));
  const ix = f.create(); ix.request([a]); await ix.idle();
  assert.equal(all(ix.textOf(a.id)), 'before image');
  const previousEnd = fs.statSync(a.file).size, original = fs.createReadStream, starts = [];
  t.mock.method(fs, 'createReadStream', (file, opts) => { if (file === a.file) starts.push(opts.start); return original(file, opts); });
  fs.appendFileSync(a.file, 'more ignored image"}\n' + line(codex('assistant', 'after image')));
  ix.request([a]); await ix.idle();
  assert.deepEqual(starts, [previousEnd], 'a known oversized incomplete record need not be reread');
  assert.equal(all(ix.textOf(a.id)), 'before image\n\nafter image');
  assert.ok(!all(ix.textOf(a.id)).includes('ignored'));
});

test('agent index: Zstandard streams skip huge decoded records and restart from bounded physical-source cache', async t => {
  const f = fixture(t), raw = f.source('codex', undefined, []);
  const source = line(codex('user', 'before compressed image')) + '{"image":"' + 'x'.repeat(12 * 1024 * 1024) + '"}\n' + JSON.stringify(codex('assistant', 'after compressed image'));
  const a = archive(raw, Buffer.from(source));
  const ix = f.create(); ix.request([a]); await ix.idle();
  assert.equal(all(ix.textOf(a.id)), 'before compressed image\n\nafter compressed image', 'valid final archive record need not end with a newline');
  const dir = path.join(f.dataDir, '.session-index', 'agent-v1');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8'));
  assert.equal(saved.value.offset, fs.statSync(a.file).size);
  assert.equal(saved.value.compressed, true);
  assert.ok(saved.value.offset < 10000, 'decoded twelve-megabyte offset is never stored as a compressed seek position');
  ix.stop();
  const original = fs.createReadStream, reads = [];
  t.mock.method(fs, 'createReadStream', (file, opts) => { reads.push(file); return original(file, opts); });
  const next = f.create(); next.request([a]); await next.idle();
  assert.equal(all(next.textOf(a.id)), 'before compressed image\n\nafter compressed image');
  assert.deepEqual(reads, [], 'unchanged compressed restart uses the small cache');
});

test('agent index: compressed rewrites rebuild from physical byte zero and raw transcripts always win', async t => {
  const f = fixture(t), raw = f.source('codex', undefined, [codex('user', 'live raw words')]);
  const packed = raw.file + '.zst';
  fs.writeFileSync(packed, zlib.zstdCompressSync(Buffer.from(line(codex('user', 'archived words')))));
  const future = new Date(Date.now() + 60000); fs.utimesSync(packed, future, future);
  const ix = f.create(); ix.request([raw]); await ix.idle();
  assert.equal(all(ix.textOf(raw.id)), 'live raw words', 'raw beats a newer archive');
  fs.unlinkSync(raw.file); ix.request([raw]); await ix.idle();
  assert.equal(all(ix.textOf(raw.id)), 'archived words', 'raw-to-archive transition bypasses the catalogue TTL');
  const original = fs.createReadStream, starts = [];
  t.mock.method(fs, 'createReadStream', (file, opts) => { if (file === packed) starts.push(opts.start); return original(file, opts); });
  fs.writeFileSync(packed, zlib.zstdCompressSync(Buffer.from(line(codex('user', 'a changed archive with different words')))));
  ix.request([raw]); await ix.idle();
  assert.deepEqual(starts, [0]); assert.equal(all(ix.textOf(raw.id)), 'a changed archive with different words');
  const replacement = packed + '.replacement';
  fs.writeFileSync(replacement, zlib.zstdCompressSync(Buffer.from(line(codex('user', 'replacement frame'))))); fs.renameSync(replacement, packed);
  ix.request([raw]); await ix.idle();
  assert.deepEqual(starts, [0, 0]); assert.equal(all(ix.textOf(raw.id)), 'replacement frame');
  fs.writeFileSync(raw.file, line(codex('user', 'live again'))); fs.utimesSync(packed, future, future);
  ix.request([raw]); await ix.idle(); assert.equal(all(ix.textOf(raw.id)), 'live again', 'archive-to-raw transition immediately prefers the live source');
});

test('agent index: truncated, corrupt and excessive-window frames fail without partial text or leaked streams', async t => {
  const f = fixture(t), rows = [];
  const payload = Buffer.from(line(codex('user', 'must not publish partial decoded words')) + line(codex('assistant', 'x'.repeat(20000))));
  const good = zlib.zstdCompressSync(payload, { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } });
  const bad = Buffer.from(good); bad[bad.length - 1] ^= 1;
  const window = zlib.zstdCompressSync(Buffer.from('small frame'), { params: { [zlib.constants.ZSTD_c_contentSizeFlag]: 0 } });
  assert.equal(window[4] & 32, 0, 'fixture has a separate window descriptor');
  window[5] = (28 - 10) << 3; // A valid frame header requiring a 256MiB decoder window.
  for (const bytes of [good.subarray(0, good.length - 2), bad, window, Buffer.from('not a zstandard frame')]) {
    const raw = f.source('codex'), file = raw.file + '.zst'; fs.writeFileSync(file, bytes); fs.unlinkSync(raw.file); rows.push({ ...raw, file });
  }
  const read = fs.createReadStream, decode = zlib.createZstdDecompress, inputs = [], decoders = [];
  t.mock.method(fs, 'createReadStream', (file, opts) => { const s = read(file, opts); inputs.push(s); return s; });
  t.mock.method(zlib, 'createZstdDecompress', opts => { const s = decode(opts); decoders.push(s); return s; });
  const ix = f.create(); ix.request(rows); await ix.idle();
  for (const [i, row] of rows.entries()) assert.equal(ix.textOf(row.id) === null, true, `invalid frame ${i} must not publish decoded words`);
  assert.deepEqual(ix.progress, { done: 4, total: 4, ready: true });
  assert.equal(inputs.length, 4); assert.equal(decoders.length, 4);
  assert.ok(inputs.every(s => s.destroyed)); assert.ok(decoders.every(s => s.destroyed));
  assert.ok(f.logs.some(s => /too much memory|window/i.test(s)), 'configured decoder window cap is enforced by the actual native decoder');
});

test('agent index: concatenated Zstandard frames and skippable metadata cross arbitrary input boundaries', async t => {
  const f = fixture(t), a = f.source('codex');
  const metadata = Buffer.alloc(11); metadata.writeUInt32LE(0x184d2a50); metadata.writeUInt32LE(3, 4); metadata.write('abc', 8);
  const bytes = Buffer.concat([zlib.zstdCompressSync(Buffer.from(line(codex('user', 'first frame')))), metadata,
    zlib.zstdCompressSync(Buffer.from(line(codex('assistant', 'second frame'))), { params: { [zlib.constants.ZSTD_c_contentSizeFlag]: 0, [zlib.constants.ZSTD_c_checksumFlag]: 1 } })]);
  const file = a.file + '.zst'; fs.writeFileSync(file, bytes); fs.unlinkSync(a.file);
  const whole = f.create(); whole.request([a]); await whole.idle();
  assert.equal(all(whole.textOf(a.id)), 'first frame\n\nsecond frame', 'all of it arriving in one read, as a small archive does');
  whole.stop(); await whole.idle();
  fs.rmSync(f.dataDir, { recursive: true, force: true });
  const read = fs.createReadStream;
  t.mock.method(fs, 'createReadStream', (name, opts) => read(name, name === file ? { ...opts, highWaterMark: 1 } : opts));
  const ix = f.create(); ix.request([a]); await ix.idle();
  assert.equal(all(ix.textOf(a.id)), 'first frame\n\nsecond frame');
});

test('agent index: all frame header field lengths, ignored unused bit, RLE and empty final blocks', async t => {
  const f = fixture(t), rows = [];
  for (const single of [false, true]) for (let sizeFlag = 0; sizeFlag < 4; sizeFlag++) for (let dictionaryFlag = 0; dictionaryFlag < 4; dictionaryFlag++) {
    const term = `header-${single}-${sizeFlag}-${dictionaryFlag}`;
    const payload = Buffer.from(line(codex('user', term + (sizeFlag === 1 ? ' '.repeat(200) : ''))));
    const value = framed([{ bytes: payload }], { single, sizeFlag, dictionaryFlag, unused: dictionaryFlag % 2 === 1 });
    assert.deepEqual(zlib.zstdDecompressSync(value.bytes), payload);
    const raw = f.source('codex'), file = raw.file + '.zst'; fs.writeFileSync(file, value.bytes); fs.unlinkSync(raw.file); rows.push({ ...raw, file, term });
  }
  const payload = Buffer.from(line(codex('user', 'raw then RLE then empty final')));
  const rle = framed([{ bytes: payload }, { type: 1, bytes: Buffer.from('\n'), size: 8 }, { bytes: Buffer.alloc(0) }]);
  assert.deepEqual(zlib.zstdDecompressSync(rle.bytes), Buffer.concat([payload, Buffer.from('\n'.repeat(8))]));
  const raw = f.source('codex'), file = raw.file + '.zst'; fs.writeFileSync(file, rle.bytes); fs.unlinkSync(raw.file); rows.push({ ...raw, file, term: 'raw then RLE then empty final' });
  const ix = f.create(); ix.request(rows); await ix.idle();
  for (const row of rows) assert.equal(all(ix.textOf(row.id)), row.term);
});

test('agent index: incomplete magic, optional headers, block headers/payloads and checksums never publish', async t => {
  const f = fixture(t), payload = Buffer.from(line(codex('user', 'no partial result')));
  const frame = framed([{ bytes: payload }], { sizeFlag: 3, dictionaryFlag: 3 });
  const checksum = zlib.zstdCompressSync(payload, { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } });
  const malformed = [
    ...[1, 3, 4, 5, 6, 8, 12, frame.headerSize - 1, frame.headerSize, frame.headerSize + 1, frame.headerSize + 2, frame.bytes.length - 1].map(n => frame.bytes.subarray(0, n)),
    ...[1, 2, 3, 4].map(n => checksum.subarray(0, checksum.length - n)),
    Buffer.concat([frame.bytes, Buffer.from([0x28])]),
    Buffer.concat([frame.bytes, Buffer.from([0x50, 0x2a, 0x4d, 0x18, 3, 0, 0, 0, 1])]),
  ];
  const rows = malformed.map(bytes => { const raw = f.source('codex'), file = raw.file + '.zst'; fs.writeFileSync(file, bytes); fs.unlinkSync(raw.file); return { ...raw, file }; });
  const ix = f.create(); ix.request(rows); await ix.idle();
  for (const [i, row] of rows.entries()) assert.equal(ix.textOf(row.id) === null, true, `truncation fixture ${i} published text`);
  assert.equal(ix.progress.ready, true);
});

test('agent index: stop destroys both the compressed input and active decoder', async t => {
  const f = fixture(t), a = archive(f.source('codex', undefined, [codex('user', 'unpublished archive')]));
  const read = fs.createReadStream, decode = zlib.createZstdDecompress, inputs = [], decoders = [];
  t.mock.method(fs, 'createReadStream', (file, opts) => {
    if (file !== a.file) return read(file, opts);
    const bytes = fs.readFileSync(file);
    const s = Readable.from((async function* () { for (const byte of bytes) { await new Promise(r => setTimeout(r, 2)); yield Buffer.from([byte]); } })());
    inputs.push(s); return s;
  });
  t.mock.method(zlib, 'createZstdDecompress', opts => { const s = decode(opts); decoders.push(s); return s; });
  const ix = f.create(); ix.request([a]);
  while (!inputs.length) await tick();
  ix.stop(); await ix.idle();
  assert.equal(ix.textOf(a.id), null);
  assert.ok(inputs.every(s => s.destroyed)); assert.ok(decoders.every(s => s.destroyed));
});

test('agent index: a failed append never exposes partial search text or counts it twice on retry', async t => {
  const f = fixture(t), a = f.source('gemini', undefined, [gemini('USER_INPUT', 'original')]);
  const ix = f.create(); ix.request([a]); await ix.idle();
  const appended = line(gemini('PLANNER_RESPONSE', 'new searchable reply'));
  fs.appendFileSync(a.file, appended);
  const original = fs.createReadStream;
  const mocked = t.mock.method(fs, 'createReadStream', (file, opts) => file !== a.file ? original(file, opts) : Readable.from((async function* () {
    yield Buffer.from(appended); throw Object.assign(new Error('Synthetic read failure'), { code: 'EIO' });
  })()));
  ix.request([a]); await ix.idle();
  assert.equal(all(ix.textOf(a.id)), 'original');
  assert.equal(ix.progress.ready, true);
  mocked.mock.restore();
  ix.request([a]); await ix.idle();
  assert.equal(all(ix.textOf(a.id)), 'original\n\nnew searchable reply');
});

test('agent index: replacement, same-size rewrite with restored mtime, and truncation invalidate saved words', async t => {
  const f = fixture(t), a = f.source('codex', undefined, [codex('user', 'old words')]);
  const ix = f.create(); ix.request([a]); await ix.idle();
  const st = fs.statSync(a.file);
  fs.writeFileSync(a.file, line(codex('user', 'new words'))); fs.utimesSync(a.file, st.atime, st.mtime);
  ix.request([a]); await ix.idle(); assert.equal(all(ix.textOf(a.id)), 'new words');
  const replacement = a.file + '.replacement'; fs.writeFileSync(replacement, line(codex('user', 'replaced!')));
  fs.utimesSync(replacement, st.atime, st.mtime); fs.renameSync(replacement, a.file);
  ix.request([a]); await ix.idle(); assert.equal(all(ix.textOf(a.id)), 'replaced!');
  fs.writeFileSync(a.file, line(codex('user', 'short')));
  ix.request([a]); await ix.idle(); assert.equal(all(ix.textOf(a.id)), 'short');
  fs.unlinkSync(a.file); ix.request([a]); await ix.idle(); assert.equal(ix.textOf(a.id), null);
});

test('agent index: rewrite during an initial read is not published or persisted', async t => {
  const f = fixture(t), a = f.source('gemini', undefined, [gemini('USER_INPUT', 'first version')]);
  const original = fs.createReadStream;
  const mock = t.mock.method(fs, 'createReadStream', (file, opts) => file !== a.file ? original(file, opts) : Readable.from((async function* () {
    yield Buffer.from(line(gemini('USER_INPUT', 'first version')));
    fs.writeFileSync(a.file, line(gemini('USER_INPUT', 'other version')));
  })()));
  const ix = f.create(); ix.request([a]); await ix.idle();
  assert.equal(ix.textOf(a.id), null);
  mock.mock.restore(); ix.request([a]); await ix.idle();
  assert.equal(all(ix.textOf(a.id)), 'other version');
  const appended = line(gemini('PLANNER_RESPONSE', 'appended words'));
  fs.appendFileSync(a.file, appended);
  const replaced = t.mock.method(fs, 'createReadStream', (file, opts) => file !== a.file ? original(file, opts) : Readable.from((async function* () {
    yield Buffer.from(appended);
    fs.writeFileSync(a.file, line(gemini('USER_INPUT', 'replacement')));
  })()));
  ix.request([a]); await ix.idle();
  assert.equal(ix.textOf(a.id), null, 'a verified rewrite invalidates the formerly published prefix too');
  replaced.mock.restore(); ix.request([a]); await ix.idle();
  assert.equal(all(ix.textOf(a.id)), 'replacement');
});

test('agent index: missing and invalid IDs settle progress, with no path traversal', async t => {
  const f = fixture(t), ix = f.create(), missing = randomUUID();
  ix.request([{ id: missing, provider: 'codex' }, { id: 'gemini-missing', provider: 'gemini' }, { id: '../../escape', provider: 'gemini' }]);
  await ix.idle();
  assert.deepEqual(ix.progress, { done: 2, total: 2, ready: true });
  assert.equal(ix.textOf(missing), null);
  ix.request([]); await ix.idle();
  assert.deepEqual(ix.progress, { done: 0, total: 0, ready: true });
});

test('agent index: unchanged HTTP-style polls observe ready; changed timestamps and expired windows refresh', async t => {
  const f = fixture(t, { refreshMs: 5000 }), a = f.source('codex', undefined, [codex('user', 'first')]);
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const ix = f.create(); ix.request([a]); await ix.idle();
  for (let n = 0; n < 3; n++) {
    now += 1500; ix.request([a]);
    assert.equal(ix.progress.ready, true, 'request followed immediately by progress must expose completion');
  }
  fs.appendFileSync(a.file, line(codex('assistant', 'fresh timestamp')));
  const changed = { ...a, updated: 2 };
  ix.request([changed]); assert.equal(ix.progress.ready, false, 'metadata changes bypass the cooldown'); await ix.idle();
  assert.match(all(ix.textOf(a.id)), /fresh timestamp/);
  fs.appendFileSync(a.file, line(codex('assistant', 'append without metadata')));
  now += 5001; ix.request([changed]); assert.equal(ix.progress.ready, false); await ix.idle();
  assert.match(all(ix.textOf(a.id)), /append without metadata/);
  const b = f.source('gemini', undefined, [gemini('USER_INPUT', 'new selection')]);
  ix.request([changed, b]); assert.equal(ix.progress.ready, false, 'new selections bypass the cooldown'); await ix.idle();
  assert.equal(all(ix.textOf(b.id)), 'new selection');
  ix.request([b, changed]); assert.equal(ix.progress.ready, true, 'row ordering does not defeat the completed window');
});

test('agent index: shared sessions roots are catalogued once; descendant links are not followed', async t => {
  const f = fixture(t), a = f.source('codex', undefined, [codex('user', 'shared physical source')]);
  const otherHome = path.join(f.root, 'other-home'); fs.mkdirSync(otherHome);
  try { fs.symlinkSync(path.join(f.home, 'sessions'), path.join(otherHome, 'sessions'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (err) { if (['EPERM', 'EACCES'].includes(err.code)) { t.skip('Directory links unavailable'); return; } throw err; }
  const outside = path.join(f.root, 'outside'); fs.mkdirSync(outside);
  const hiddenId = randomUUID(); fs.writeFileSync(path.join(outside, `rollout-${hiddenId}.jsonl`), line(codex('user', 'linked outsider')));
  fs.symlinkSync(outside, path.join(f.home, 'sessions', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  f.roots.codex.push(otherHome);
  const open = fs.promises.opendir, visited = [];
  t.mock.method(fs.promises, 'opendir', async dir => { visited.push(dir); return open.call(fs.promises, dir); });
  const ix = f.create(); ix.request([a, { id: hiddenId, provider: 'codex' }]); await ix.idle();
  assert.equal(all(ix.textOf(a.id)), 'shared physical source');
  assert.equal(ix.textOf(hiddenId), null);
  const canonical = fs.realpathSync(path.join(f.home, 'sessions'));
  assert.equal(visited.filter(dir => dir === canonical).length, 1);
  assert.ok(!visited.some(dir => path.basename(dir) === 'linked'));
});

test('agent index: cancellation stops oversized reads, with no partial publication', async t => {
  const f = fixture(t), a = f.source('codex', undefined, [codex('user', 'not published early')]);
  const original = fs.createReadStream;
  let chunks = 0;
  t.mock.method(fs, 'createReadStream', (file, opts) => {
    if (file !== a.file) return original(file, opts);
    return Readable.from((async function* () {
      yield Buffer.from(line(codex('user', 'not published early')));
      for (let n = 0; n < 100; n++) { chunks++; await new Promise(r => setTimeout(r, 2)); yield Buffer.alloc(65536, 120); }
    })());
  });
  const ix = f.create(); ix.request([a]);
  while (!chunks) await tick();
  ix.stop(); await ix.idle();
  assert.ok(chunks < 10, 'cancelled reader should release its stream promptly');
  assert.equal(ix.textOf(a.id), null);
  ix.request([a]); await ix.idle(); assert.equal(ix.textOf(a.id), null, 'stop is terminal');
});

test('agent index: a new selection replaces a running request and removes unselected views', async t => {
  const f = fixture(t), a = f.source('codex', undefined, [codex('user', 'first')]), b = f.source('gemini', undefined, [gemini('USER_INPUT', 'second')]);
  const ix = f.create(); ix.request([a]); ix.request([b]); await ix.idle();
  assert.equal(ix.textOf(a.id), null); assert.equal(all(ix.textOf(b.id)), 'second');
  assert.deepEqual(ix.progress, { done: 1, total: 1, ready: true });
});

test('agent index: updated session timestamps queue a refresh without restarting a long read', async t => {
  const f = fixture(t), a = f.source('codex', undefined, [codex('user', 'first'), codex('assistant', 'last')]), b = f.source('gemini', undefined, [gemini('USER_INPUT', 'other chat')]);
  const data = fs.readFileSync(a.file), original = fs.createReadStream;
  let starts = 0, begun = false;
  t.mock.method(fs, 'createReadStream', (file, opts) => {
    if (file !== a.file) return original(file, opts);
    starts++;
    return Readable.from((async function* () {
      begun = true; yield data.subarray(0, 20);
      await new Promise(r => setTimeout(r, 15)); yield data.subarray(20);
    })());
  });
  const ix = f.create(); ix.request([a, b]);
  while (!begun) await tick();
  for (let n = 2; n < 10; n++) {
    const rows = [{ ...a, id: n % 2 ? a.id.toUpperCase() : a.id, updated: n }, b];
    ix.request(n % 2 ? rows.reverse() : rows);
  }
  await ix.idle();
  assert.equal(starts, 1);
  assert.equal(all(ix.textOf(a.id)), 'first\n\nlast');
  assert.deepEqual(ix.progress, { done: 2, total: 2, ready: true });
});

test('agent index: UUID case changes reuse the same catalogue, cache and published lookup', async t => {
  const f = fixture(t), a = f.source('codex', undefined, [codex('user', 'Codex case')]), b = f.source('gemini', undefined, [gemini('USER_INPUT', 'Gemini case')]);
  const ix = f.create(); ix.request([a, b]); await ix.idle();
  ix.request([{ ...a, id: a.id.toUpperCase() }, { ...b, id: b.id.toUpperCase() }, a]); await ix.idle();
  assert.deepEqual(ix.progress, { done: 2, total: 2, ready: true });
  assert.equal(all(ix.textOf(a.id)), 'Codex case'); assert.equal(all(ix.textOf(a.id.toUpperCase())), 'Codex case');
  assert.equal(all(ix.textOf(b.id)), 'Gemini case'); assert.equal(all(ix.textOf(b.id.toUpperCase())), 'Gemini case');
});

test('agent index: aggregate budget keeps prefix and latest tail, and disk cache supplies larger views', async t => {
  const f = fixture(t, { maxChars: 1000 });
  const rows = Array.from({ length: 4 }, (_, i) => f.source('codex', undefined, [codex('user', `prefix${i}-` + 'x'.repeat(1800)), codex('assistant', `-latest${i}`)]));
  const ix = f.create(); ix.request(rows); await ix.idle();
  assert.equal(rows.reduce((sum, r) => sum + chars(ix.textOf(r.id)), 0), 1000);
  for (const [i, r] of rows.entries()) { assert.ok(ix.textOf(r.id).head.startsWith(`prefix${i}`)); assert.ok(ix.textOf(r.id).tail.endsWith(`latest${i}`)); }
  const original = fs.createReadStream, read = [];
  t.mock.method(fs, 'createReadStream', (file, opts) => { read.push(file); return original(file, opts); });
  ix.request([rows[0]]); await ix.idle();
  assert.equal(chars(ix.textOf(rows[0].id)), 1000);
  assert.deepEqual(read, [], 'view growth reads bounded cache, not the source transcript');
  const before = ix.textOf(rows[0].id);
  ix.request(rows);
  assert.equal(ix.textOf(rows[0].id), before, 'request does not copy the existing text');
  assert.ok(rows.reduce((sum, r) => sum + chars(ix.textOf(r.id)), 0) <= 1000, 'old views already fit the total budget');
  await ix.idle();
  assert.ok(rows.every(r => chars(ix.textOf(r.id)) === 250), 'the worker gives all participants their fair share');
  assert.ok(rows.reduce((sum, r) => sum + chars(ix.textOf(r.id)), 0) <= 1000);
});

test('agent index: resizing yields and can be cancelled before a new participant publishes', async t => {
  const budget = 8000000, f = fixture(t, { maxChars: budget });
  const rows = Array.from({ length: 8 }, () => f.source('codex', undefined, [codex('assistant', 'x'.repeat(1100000))]));
  const added = f.source('gemini', undefined, [gemini('USER_INPUT', 'new participant')]);
  const ix = f.create(); ix.request(rows); await ix.idle();
  const before = rows.map(r => ix.textOf(r.id));
  const observed = new Promise((resolve, reject) => setTimeout(() => {
    try {
      const changed = rows.filter((r, i) => ix.textOf(r.id) !== before[i]).length;
      assert.ok(changed > 0 && changed < rows.length, 'the event loop runs between groups of copied views');
      assert.equal(ix.textOf(added.id), null, 'the new first-listed participant cannot publish before resizing finishes');
      assert.ok(rows.reduce((sum, r) => sum + chars(ix.textOf(r.id)), 0) <= budget);
      ix.stop(); resolve();
    } catch (err) { reject(err); }
  }, 0));
  ix.request([added, ...rows]);
  assert.ok(rows.every((r, i) => ix.textOf(r.id) === before[i]), 'request itself performs no view copies');
  await observed; await ix.idle();
  assert.equal(ix.textOf(added.id), null);
  assert.ok(rows.reduce((sum, r) => sum + chars(ix.textOf(r.id)), 0) <= budget);
});

test('agent index: corrupt and oversized persistent caches are rebuilt', async t => {
  const f = fixture(t), a = f.source('gemini', undefined, [gemini('USER_INPUT', 'original source')]);
  const first = f.create(); first.request([a]); await first.idle(); first.stop();
  const dir = path.join(f.dataDir, '.session-index', 'agent-v1'), cache = path.join(dir, fs.readdirSync(dir)[0]);
  fs.writeFileSync(cache, '{bad json');
  const second = f.create(); second.request([a]); await second.idle(); second.stop();
  assert.equal(all(second.textOf(a.id)), 'original source');
  fs.truncateSync(cache, 13 * 1024 * 1024);
  const third = f.create(); third.request([a]); await third.idle();
  assert.equal(all(third.textOf(a.id)), 'original source');
  assert.ok(fs.statSync(cache).size < 2000);
});

test('agent index: bounded housekeeping removes only stale owned unselected caches and abandoned writes', async t => {
  const f = fixture(t), a = f.source('gemini', undefined, [gemini('USER_INPUT', 'keep selected cache')]);
  const first = f.create(); first.request([a]); await first.idle(); first.stop();
  const dir = path.join(f.dataDir, '.session-index', 'agent-v1'), selected = path.join(dir, fs.readdirSync(dir)[0]);
  const old = new Date(Date.now() - 40 * 86400000);
  fs.utimesSync(selected, old, old);
  const stale = path.join(dir, '0'.repeat(64) + '.json'), recent = path.join(dir, '1'.repeat(64) + '.json');
  const temp = path.join(dir, '2'.repeat(64) + '.json.123.abcd.tmp'), unrelated = path.join(dir, 'notes.txt');
  for (const file of [stale, recent, temp, unrelated]) fs.writeFileSync(file, 'disposable fixture');
  for (const file of [stale, temp, unrelated]) fs.utimesSync(file, old, old);
  const second = f.create(); second.request([a]); await second.idle();
  assert.equal(all(second.textOf(a.id)), 'keep selected cache');
  assert.equal(fs.existsSync(selected), true); assert.equal(fs.existsSync(recent), true); assert.equal(fs.existsSync(unrelated), true);
  assert.equal(fs.existsSync(stale), false); assert.equal(fs.existsSync(temp), false);
});

test('agent index: large-record skipping and many capped indexes fit a small isolated heap', t => {
  const f = fixture(t);
  const script = String.raw`
    const fs=require('fs'),path=require('path'),zlib=require('node:zlib'),{pipeline}=require('node:stream/promises'),{createAgentIndex}=require(process.argv[1]);
    const root=process.argv[2],home=path.join(root,'memory-home'),dir=path.join(home,'sessions');fs.mkdirSync(dir,{recursive:true});
    const rows=[];
    for(let i=0;i<8;i++){
      const id='00000000-0000-0000-0000-'+String(i).padStart(12,'0');rows.push({id,provider:'codex'});
      const fd=fs.openSync(path.join(dir,'rollout-'+id+'.jsonl'),'w');
      fs.writeSync(fd,'{"image":"');const chunk=Buffer.alloc(65536,120);for(let n=0;n<64;n++)fs.writeSync(fd,chunk);fs.writeSync(fd,'"}\n');
      for(let n=0;n<4;n++)fs.writeSync(fd,JSON.stringify({type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'head'+i+' '+('z'.repeat(900000))+' tail'+i}]}})+'\n');
      fs.closeSync(fd);
    }
    (async()=>{
      for(let i=1;i<rows.length;i+=2){const raw=path.join(dir,'rollout-'+rows[i].id+'.jsonl');await pipeline(fs.createReadStream(raw),zlib.createZstdCompress(),fs.createWriteStream(raw+'.zst'));fs.unlinkSync(raw);}
      global.gc();const before=process.memoryUsage().heapUsed;
      const ix=createAgentIndex({dataDir:path.join(root,'memory-data'),getRoots:()=>({codex:[home]}),maxChars:600000});
      ix.request(rows);await ix.idle();await new Promise(r=>setImmediate(r));global.gc();global.gc();
      const retained=process.memoryUsage().heapUsed-before;
      const total=rows.reduce((n,r)=>{const v=ix.textOf(r.id);if(!v||!v.head.startsWith('head')||!v.tail.endsWith(r.id.slice(-1)))throw Error('lost prefix/tail');return n+v.head.length+v.tail.length;},0);
      console.log(JSON.stringify({retained,total,ready:ix.progress.ready}));ix.stop();
    })().catch(e=>{console.error(e);process.exitCode=1});
  `;
  const result = JSON.parse(execFileSync(process.execPath, ['--expose-gc', '--max-old-space-size=32', '-e', script, require.resolve('../lib/agent-index'), f.root], { encoding: 'utf8', windowsHide: true, timeout: 30000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).trim());
  assert.equal(result.ready, true); assert.equal(result.total, 600000);
  assert.ok(result.retained < 8 * 1024 * 1024, 'budgeted views retained ' + result.retained + ' bytes');
});
