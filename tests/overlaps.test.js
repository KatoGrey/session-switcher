'use strict';
// Two chats changing the same file (lib/overlaps.js): noticed whichever program they are, only for what's
// recent and only for chats still open, and only what's new is read each time.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createOverlaps } = require('../lib/overlaps');

const CWD = path.resolve('/projects/game');
const NOW = Date.parse('2026-10-31T12:00:00Z');
const iso = minsAgo => new Date(NOW - minsAgo * 60e3).toISOString();
let seq = 0;
const edit = (p, minsAgo = 1, name = 'Edit') => ({ kind: 'assistant', seq: ++seq, at: iso(minsAgo), blocks: [{ type: 'tool', name, meta: { path: p, paths: [p] } }] });
const chat = (key, events = [], over = {}) => ({ key, provider: 'claude', cwd: CWD, state: 'ready', sessionId: `s-${key}`, buffer: events, ...over });

test('overlaps: two chats, one file: each hears about the other', () => {
  const a = chat('a', [edit('lib/x.js', 5)]), b = chat('b', [edit(path.join(CWD, 'lib', 'x.js'), 1)], { provider: 'codex' });
  const r = createOverlaps().check([a, b], NOW);
  assert.deepEqual([...r.keys()].sort(), ['a', 'b']);
  const row = r.get('a')[0];
  assert.equal(row.rel, 'lib/x.js');
  assert.equal(row.file, path.join(CWD, 'lib', 'x.js'));
  assert.equal(row.others[0].key, 'b');
  assert.equal(row.others[0].provider, 'codex');
  assert.equal(row.at, NOW - 60e3, 'when it last happened');
  assert.equal(row.mine, NOW - 5 * 60e3);
  assert.equal(r.get('b')[0].others[0].key, 'a');
});

test('overlaps: different files, and a chat on its own, are nothing to say', () => {
  const r = createOverlaps().check([chat('a', [edit('a.js'), edit('a.js')]), chat('b', [edit('b.js')])], NOW);
  assert.equal(r.size, 0);
});

test('overlaps: a long time apart doesn’t count, and old news goes', () => {
  const r = createOverlaps({ windowMs: 45 * 60e3 }).check([chat('a', [edit('x.js', 100)]), chat('b', [edit('x.js', 1)])], NOW);
  assert.equal(r.size, 0);
  const both = [chat('a', [edit('x.js', 20)]), chat('b', [edit('x.js', 10)])], o = createOverlaps({ windowMs: 45 * 60e3 });
  assert.equal(o.check(both, NOW).size, 2);
  assert.equal(o.check(both, NOW + 40 * 60e3).size, 0, 'an hour on, it’s over');
});

test('overlaps: a chat that’s ended isn’t told, but the one still open is', () => {
  const r = createOverlaps().check([chat('a', [edit('x.js')], { state: 'ended' }), chat('b', [edit('x.js')])], NOW);
  assert.deepEqual([...r.keys()], ['b']);
});

const say = (kind, minsAgo) => ({ kind, seq: ++seq, at: iso(minsAgo) });

test('overlaps: one reply after another is fine; replies that overlapped aren’t', () => {
  // The second began after the first had finished: it read what the first left.
  const first = () => chat('a', [say('user', 30), edit('x.js', 29), say('result', 25)]);
  let r = createOverlaps().check([first(), chat('b', [say('user', 20), edit('x.js', 19), say('result', 15)])], NOW);
  assert.equal(r.size, 0, 'taking turns');
  // The second began while the first was still going.
  r = createOverlaps().check([first(), chat('b', [say('user', 27), edit('x.js', 26), say('result', 15)])], NOW);
  assert.equal(r.size, 2, 'at the same time');
  // And one that hasn't finished yet.
  r = createOverlaps().check([chat('a', [say('user', 30), edit('x.js', 29)]), chat('b', [say('user', 5), edit('x.js', 4)])], NOW);
  assert.equal(r.size, 2, 'still going');
});

test('overlaps: it follows a reply as it goes, a piece at a time', () => {
  const o = createOverlaps(), a = chat('a', [say('user', 30), edit('x.js', 29)]), b = chat('b', []);
  assert.equal(o.check([a, b], NOW).size, 0);
  a.buffer.push(say('result', 25));
  assert.equal(o.check([a, b], NOW).size, 0);
  b.buffer.push(say('user', 20), edit('x.js', 19));
  assert.equal(o.check([a, b], NOW).size, 0, 'it had finished before this one began');
  a.buffer.push(say('user', 15), edit('x.js', 14));
  assert.equal(o.check([a, b], NOW).size, 2, 'its next reply overlaps');
});

test('overlaps: an edit you said no to didn’t happen', () => {
  const asked = { kind: 'assistant', seq: ++seq, at: iso(2), blocks: [{ type: 'tool', id: 'x', name: 'Edit', meta: { paths: ['same.txt'] } }] };
  const no = { kind: 'tool_result', seq: ++seq, at: iso(2), toolUseId: 'x', result: { text: 'You declined this change.', isError: true } };
  assert.equal(createOverlaps().check([chat('a', [asked, no]), chat('b', [edit('same.txt')])], NOW).size, 0);
  // One that failed may have written part of it.
  const failed = { kind: 'tool_result', seq: ++seq, at: iso(2), toolUseId: 'x', result: { text: 'Disk full', isError: true } };
  assert.equal(createOverlaps().check([chat('a', [asked, failed]), chat('b', [edit('same.txt')])], NOW).size, 2);
  // And what it had changed before that still counts.
  const first = { kind: 'assistant', seq: ++seq, at: iso(3), blocks: [{ type: 'tool', id: 'w', name: 'Edit', meta: { paths: ['same.txt'] } }] };
  const later = { kind: 'assistant', seq: ++seq, at: iso(2), blocks: [{ type: 'tool', id: 'y', name: 'Edit', meta: { paths: ['same.txt'] } }] };
  const noLater = { kind: 'tool_result', seq: ++seq, at: iso(2), toolUseId: 'y', result: { text: 'The user declined this.', isError: true } };
  assert.equal(createOverlaps().check([chat('a', [first, later, noLater]), chat('b', [edit('same.txt')])], NOW).size, 2);
});

test('overlaps: reading a file isn’t changing it', () => {
  const read = { kind: 'assistant', seq: ++seq, at: iso(1), blocks: [{ type: 'tool', name: 'Read', meta: { path: 'x.js' } }] };
  assert.equal(createOverlaps().check([chat('a', [read]), chat('b', [edit('x.js')])], NOW).size, 0);
});

test('overlaps: side questions and commands don’t count', () => {
  const cmd = { kind: 'assistant', seq: ++seq, at: iso(1), blocks: [{ type: 'tool', name: 'Bash', meta: null }] };
  const r = createOverlaps().check([chat('a', [edit('x.js')], { aside: true }), chat('b', [edit('x.js')]), chat('c', [cmd])], NOW);
  assert.equal(r.size, 0);
});

test('overlaps: only what’s new is read, so a long chat costs nothing', () => {
  const o = createOverlaps(), a = chat('a', [edit('x.js')]), b = chat('b', [edit('y.js')]);
  assert.equal(o.check([a, b], NOW).size, 0);
  let reads = 0;
  const first = a.buffer[0];
  a.buffer = new Proxy(a.buffer, { get(t, k) { if (k === '0') reads++; return t[k]; } });
  o.check([a, b], NOW);
  // Only the last one is looked at, to see that nothing's newer.
  assert.ok(reads <= 1, `read ${reads}`);
  assert.ok(first);
  b.buffer.push(edit('x.js'));
  assert.equal(o.check([a, b], NOW).size, 2, 'and an edit that comes later is seen');
});

test('overlaps: a Windows path differing only in case is the same file', { skip: process.platform !== 'win32' }, () => {
  const r = createOverlaps().check([chat('a', [edit('Lib/X.js')]), chat('b', [edit('lib/x.JS')])], NOW);
  assert.equal(r.size, 2);
});

test('overlaps: one chat’s partner counts as another chat', () => {
  const r = createOverlaps().check([chat('lead', [edit('x.js')]), chat('help', [edit('x.js')], { parentKey: 'lead', provider: 'gemini' })], NOW);
  assert.equal(r.get('lead')[0].others[0].provider, 'gemini');
});

test('overlaps: from what each program really reports', () => {
  const { toolView } = require('../lib/chat');
  const { toolBlock } = require('../lib/gemini');
  const file = path.join(CWD, 'lore', 'a.md');
  const ev = block => ({ kind: 'assistant', seq: ++seq, at: iso(1), blocks: [block] });
  const claude = chat('claude', [ev({ type: 'tool', name: 'Edit', ...toolView('Edit', { file_path: file, old_string: 'a', new_string: 'b' }) })]);
  const gemini = chat('gemini', [ev(toolBlock('g1', 'write_to_file', { TargetFile: file, CodeContent: 'x' }))], { provider: 'gemini' });
  const read = chat('reader', [ev({ type: 'tool', name: 'Read', ...toolView('Read', { file_path: file }) })]);
  const r = createOverlaps().check([claude, gemini, read], NOW);
  assert.deepEqual([...r.keys()].sort(), ['claude', 'gemini'], 'reading a file isn’t changing it');
});
