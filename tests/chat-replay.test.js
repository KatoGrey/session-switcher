'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LiveChat, LIMITS } = require('../lib/chat');

function chat() {
  return new LiveChat({ cfg: {}, account: { id: 'replay-test', name: 'Replay test' }, cwd: process.cwd() });
}
function budget(t, bytes, events = 5000) {
  const old = { bytes: LIMITS.bufferBytes, events: LIMITS.buffer };
  LIMITS.bufferBytes = bytes; LIMITS.buffer = events;
  t.after(() => { LIMITS.bufferBytes = old.bytes; LIMITS.buffer = old.events; });
}
function accounted(c) {
  const bytes = events => events.reduce((sum, e) => sum + Buffer.byteLength(JSON.stringify(e)), 0);
  assert.equal(c.replayBytes, bytes(c.buffer));
  assert.equal(c.recoveryBytes, bytes(c.buffer.filter(e => e.kind === 'unsent')));
}
const at = second => new Date(1700000000000 + second * 1000).toISOString();
const image = (i, n = 700) => ({ kind: 'assistant', at: at(i), blocks: [{ type: 'image', src: `data:image/png;base64,${String(i).repeat(n)}` }] });

test('chat replay: image-heavy replies are bounded by bytes and still reach the current viewer', t => {
  budget(t, 3000);
  const c = chat(), received = [];
  c.clients.add({ writableLength: 0, write(data) { received.push(data); } });
  for (let i = 0; i < 24; i++) c.emit(i % 2 ? image(i) : { kind: 'tool_result', at: at(i), images: [{ src: 'data:image/png;base64,' + 'x'.repeat(700) }] });
  assert.equal(received.length, 24);
  assert.ok(c.buffer.length < 5, 'byte pressure applies long before the 5000-event cap');
  assert.ok(c.replayBytes <= LIMITS.bufferBytes);
  assert.equal(c.trimmed, true);
  assert.equal(c.info().bufferFrom, c.buffer[0].at);
  assert.match(received.at(-1), /"seq":24/);
  accounted(c);
});

test('chat replay: unsent words, pictures and recipients survive byte pressure without hiding older history', t => {
  budget(t, 1800);
  const c = chat(), held = { kind: 'unsent', at: at(0), text: 'Held request', images: [{ data: 'p'.repeat(4000) }], recipients: ['claude', 'codex'] };
  c.emit(held);
  for (let i = 1; i < 8; i++) c.emit(image(i));
  assert.equal(c.buffer[0], held);
  assert.equal(held.images[0].data.length, 4000);
  assert.deepEqual(held.recipients, ['claude', 'codex']);
  assert.ok(c.replayBytes - c.recoveryBytes <= LIMITS.bufferBytes);
  assert.equal(c.info().bufferFrom, c.buffer.find(e => e.kind !== 'unsent').at);
  assert.notEqual(c.info().bufferFrom, held.at, 'history must fill the gap before retained provider events');
  accounted(c);
});

test('chat replay: one oversized reply keeps its history boundary and is released by the next event', t => {
  budget(t, 1000);
  const c = chat();
  c.emit({ kind: 'user', text: 'Make the image', at: at(1) });
  const big = image(2, 3000); c.emit(big);
  assert.deepEqual(c.buffer, [big]);
  assert.equal(c.info().bufferFrom, big.at);
  c.emit({ kind: 'state', state: 'ready', at: at(3) });
  assert.equal(c.buffer.length, 1);
  assert.equal(c.buffer[0].kind, 'state');
  assert.ok(c.replayBytes < LIMITS.bufferBytes);
  accounted(c);
});

test('chat replay: removed streaming progress and older user pictures release their byte accounting', t => {
  budget(t, 100000);
  const c = chat();
  c.emit({ kind: 'delta', mid: 'reply', text: 'x'.repeat(800) });
  c.emit({ kind: 'assistant', mid: 'reply', blocks: [{ type: 'text', text: 'Done' }] });
  c.emit({ kind: 'review', id: 'review', state: 'running', text: 'y'.repeat(900) });
  c.emit({ kind: 'review', id: 'review', state: 'done', text: 'Reviewed' });
  assert.equal(c.buffer.some(e => e.kind === 'delta' || e.state === 'running'), false);
  for (let i = 0; i < 10; i++) c.emit({ kind: 'user', text: String(i), images: [{ src: 'data:image/png;base64,' + 'z'.repeat(700) }] });
  const sent = c.buffer.filter(e => e.kind === 'user');
  assert.equal(sent.filter(e => e.images[0].src).length, 8);
  assert.deepEqual(sent[0].images, [{ src: null, dropped: true }]);
  accounted(c);
});

test('chat replay: evicting tools never invents certainty about a parallel reply\'s file ownership', t => {
  budget(t, 1800);
  const c = chat();
  c.emit({ kind: 'assistant', at: at(1), blocks: [{ type: 'tool', name: 'Bash', summary: 'Write files' }] });
  for (let i = 2; i < 6; i++) c.emit({ kind: 'tool_result', at: at(i), text: 'x'.repeat(900) });
  c.emit({ kind: 'assistant', at: at(6), blocks: [{ type: 'tool', name: 'Edit', meta: { path: 'own.txt' } }] });
  assert.equal(c.buffer.some(e => e.blocks?.some(b => b.name === 'Bash')), false);
  assert.equal(c.ownPaths(at(0)), null, 'a discarded command might have edited the partner\'s files');
  assert.deepEqual(c.ownPaths(at(5)), ['own.txt'], 'a later complete turn can still identify its own files');
  accounted(c);
});

test('chat replay: the event-count cap also keeps Undo conservative after tool eviction', t => {
  budget(t, 100000, 3);
  const c = chat();
  c.emit({ kind: 'assistant', at: at(1), blocks: [{ type: 'tool', name: 'Bash' }] });
  for (let i = 2; i <= 5; i++) c.emit({ kind: 'state', state: 'ready', at: at(i) });
  assert.equal(c.buffer.length, 3);
  assert.equal(c.ownPaths(at(0)), null);
  assert.deepEqual(c.ownPaths(at(2)), []);
  accounted(c);
});

test('chat replay: native generated images do not claim exclusive file ownership', () => {
  const c = chat(); c.emit(image(1));
  assert.equal(c.ownPaths(at(0)), null);
});

test('chat replay: completed startup remains known after its events leave replay', t => {
  budget(t, 900);
  const c = chat();
  c.emit({ kind: 'init', at: at(1) });
  c.emit({ kind: 'tool_result', text: 'x'.repeat(1000), at: at(2) });
  assert.equal(c.buffer.some(e => e.kind === 'init'), false);
  assert.equal(c.initialized, true);
  assert.equal(c.startedEvents, true);
});

test('chat replay: outstanding approvals stay available after other tools fill replay', t => {
  budget(t, 1200, 4);
  const c = chat(), approval = { kind: 'permission', requestId: 'waiting', toolName: 'Write', at: at(0), view: { detail: 'x'.repeat(2000) } };
  c.pending.set('waiting', { event: approval }); c.emit(approval);
  for (let i = 1; i < 9; i++) c.emit({ kind: 'tool_result', at: at(i), text: 'y'.repeat(600) });
  assert.ok(c.buffer.includes(approval));
  assert.equal(c.info().bufferFrom, c.buffer.find(e => e !== approval).at);
  assert.ok(c.replayBytes - Buffer.byteLength(JSON.stringify(approval)) <= LIMITS.bufferBytes);
  c.pending.delete('waiting');
  c.emit({ kind: 'permission_cancel', requestId: 'waiting', at: at(9) });
  assert.equal(c.buffer.includes(approval), false, 'answered approvals can leave replay normally');
  accounted(c);
});

test('chat replay: answering an old pinned approval cannot move history backwards across an evicted gap', t => {
  budget(t, 2200);
  const c = chat(), approval = { kind: 'permission', requestId: 'old', at: at(1), toolName: 'Write' };
  c.emit({ kind: 'user', text: 'Start', at: at(0) });
  c.pending.set('old', { event: approval }); c.emit(approval);
  for (let i = 2; i <= 8; i++) c.emit({ kind: 'assistant', at: at(i), blocks: [{ type: 'text', text: 'x'.repeat(700) }] });
  const boundary = c.info().bufferFrom;
  assert.ok(c.buffer.includes(approval));
  assert.ok(Date.parse(boundary) > Date.parse(approval.at));
  c.pending.delete('old'); c.emit({ kind: 'permission_done', requestId: 'old', at: at(9) });
  assert.ok(c.buffer.includes(approval), 'the old card still fits in remaining space');
  assert.equal(c.info().bufferFrom, boundary, 'conversation history must still supply the missing replies');
  accounted(c);
});
