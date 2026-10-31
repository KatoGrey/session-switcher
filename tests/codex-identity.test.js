'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const snaps = require('../lib/snapshots');
const { CodexChat, historyItems } = require('../lib/codex');
const { LIMITS } = require('../lib/chat');

function chat(t) {
  t.mock.method(snaps, 'warm', () => {});
  const c = new CodexChat({ cfg: {}, account: { id: 'test', name: 'Test' }, cwd: os.tmpdir(), codex: {} });
  c.state = 'ready';
  return c;
}
const text = (id, value = id) => ({ type: 'agentMessage', id, text: value });
const edit = id => ({ type: 'fileChange', id, status: 'completed', changes: [{ path: 'one.txt', kind: { type: 'update' }, diff: '+one' }] });
function started(c, item) { c.onNotify('item/started', { item }); }
function completed(c, item) { c.onNotify('item/completed', { item }); }
function historyMids(id, items) {
  return new Map(historyItems([{ id, startedAt: 1, status: 'completed', items }]).flatMap(it => (it.blocks || []).map(b => [b.id, it.mid])));
}
function assertMatching(c, id, items) {
  const expected = historyMids(id, items);
  for (const event of c.buffer.filter(e => e.kind === 'assistant')) for (const block of event.blocks) {
    assert.ok(block.id, 'every provider block has an identity');
    assert.equal(event.mid, expected.get(block.id), block.id + ' must join the same part in history and live replay');
    assert.equal(event.itemId, block.id);
    assert.equal(event.turnId, id);
  }
}

test('codex identities: history and live preserve grouped tools, reasoning, plans and consecutive replies', t => {
  const c = chat(t), id = 'identity-turn';
  const items = [
    { type: 'userMessage', id: 'user-1', content: [{ type: 'text', text: 'Please help' }] },
    { type: 'reasoning', id: 'empty-thought', summary: [] },
    { type: 'plan', id: 'plan-1', text: 'First check it.' },
    edit('edit-1'), text('reply-1'), edit('edit-2'), text('reply-2'),
    { type: 'reasoning', id: 'thought-2', summary: ['Check the result.'] }, text('reply-3'),
  ];
  c.onNotify('turn/started', { turn: { id } });
  for (const item of items) { started(c, item); completed(c, item); }
  assertMatching(c, id, items);
  const history = historyItems([{ id, items }]).filter(x => x.kind === 'assistant');
  assert.equal(history.length, 3, 'the existing multi-tool grouping stays intact');
  assert.equal(history[0].mid, id + ':item:empty-thought');
  assert.deepEqual(history[0].blocks.map(x => x.id), ['plan-1', 'edit-1', 'reply-1', 'edit-2']);
});

test('codex identities: a late picture completion stays with its original part', t => {
  const c = chat(t), id = 'picture-turn';
  const first = text('first'), picture = { type: 'imageGeneration', id: 'picture', status: 'completed', savedPath: '/pictures/one.png' }, second = text('second');
  c.onNotify('turn/started', { turn: { id } });
  started(c, first); completed(c, first);
  started(c, picture);
  started(c, second); completed(c, second);
  completed(c, picture);
  assertMatching(c, id, [first, picture, second]);
  const seen = c.buffer.filter(e => e.kind === 'assistant' && e.itemId === picture.id);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].mid, seen[1].mid);
  assert.notEqual(seen[1].mid, c.seg, 'finishing an old image does not move it under the newer reply');
});

test('codex identities: trimming the replay cannot renumber retained messages against history', t => {
  const c = chat(t), id = 'long-turn', previous = LIMITS.bufferBytes;
  LIMITS.bufferBytes = 2200; t.after(() => { LIMITS.bufferBytes = previous; });
  const items = Array.from({ length: 8 }, (_, i) => text('message-' + i, 'MESSAGE ' + i + ' ' + 'x'.repeat(300)));
  c.onNotify('turn/started', { turn: { id } });
  for (const item of items) { started(c, item); completed(c, item); }
  assert.equal(c.trimmed, true);
  const retained = c.buffer.filter(e => e.kind === 'assistant');
  assert.ok(retained.length > 0 && retained.length < items.length);
  assertMatching(c, id, items);
  assert.equal(new Set(historyMids(id, items).values()).size, items.length);
});

test('codex identities: repeated start notifications preserve a part and a new turn resets its item map', t => {
  const c = chat(t), item = text('same-item');
  c.beginTurn('first-turn');
  started(c, item);
  const mid = c.seg;
  c.onNotify('turn/started', { turn: { id: 'first-turn' } });
  c.onNotify('item/agentMessage/delta', { itemId: item.id, delta: 'Hello' });
  assert.equal(c.seg, mid);
  const delta = c.buffer.findLast(e => e.kind === 'delta');
  assert.equal(delta.itemId, item.id); assert.equal(delta.turnId, 'first-turn'); assert.equal(delta.mid, mid);
  c.beginTurn('second-turn');
  assert.equal(c.itemMids.size, 0);
  started(c, item);
  assert.notEqual(c.seg, mid);
  assert.equal(c.seg, 'second-turn:item:same-item');
});

function sending(t) {
  const c = chat(t), requests = [];
  c.threadReady = true; c.sessionId = 'identity-thread';
  c.waitForSnapshot = c.waitForQueuedSnapshot = () => false;
  c.afterTurn = async () => {};
  c.srv = { request(method, params) {
    return new Promise((resolve, reject) => { requests.push({ method, params, resolve, reject }); });
  } };
  return { c, requests };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const usersOf = c => c.buffer.filter(e => e.kind === 'user');
const acksOf = c => c.buffer.filter(e => e.kind === 'user_turn');
function assertReplaySize(c) {
  assert.equal(c.replayBytes, c.buffer.reduce((sum, event) => sum + Buffer.byteLength(JSON.stringify(event)), 0));
}

test('codex prompt identities: acceptance stamps replay and acknowledges the visible prompt once', async t => {
  const { c, requests } = sending(t);
  c.send('Same words');
  const event = usersOf(c)[0];
  assert.equal(event.turnId, undefined, 'an unaccepted prompt has no turn yet');
  c.onNotify('turn/started', { turn: { id: 'first-turn' } });
  assert.equal(event.turnId, 'first-turn');
  assert.equal(event.userBatch, 'first-turn:start');
  assert.equal(acksOf(c)[0].userSeq, event.seq);
  assert.equal(acksOf(c)[0].userBatch, event.userBatch);
  requests[0].resolve({ turn: { id: 'first-turn' } }); await tick();
  assert.equal(acksOf(c).length, 1, 'notification and RPC response acknowledge the same prompt');
  c.onNotify('turn/completed', { turn: { id: 'first-turn', status: 'completed' } });
  c.send('Same words');
  requests[1].resolve({ turn: { id: 'second-turn' } }); await tick();
  assert.deepEqual(usersOf(c).map(e => e.turnId), ['first-turn', 'second-turn']);
  assertReplaySize(c);
});

test('codex prompt identities: a reply completed before its start response still identifies its user', async t => {
  const { c, requests } = sending(t);
  c.send('Quick reply');
  c.onNotify('turn/completed', { turn: { id: 'fast-turn', status: 'completed' } });
  requests[0].resolve({ turn: { id: 'fast-turn' } }); await tick();
  assert.equal(usersOf(c)[0].turnId, 'fast-turn');
  assert.equal(c.turnId, null, 'identity acknowledgement cannot revive a completed turn');
  assertReplaySize(c);
});

test('codex prompt identities: queued prompts share only the turn that actually accepts their batch', async t => {
  const { c, requests } = sending(t);
  c.threadReady = false;
  c.send('First queued'); c.send('Second queued');
  assert.equal(requests.length, 0);
  c.threadReady = true; c.flush();
  c.send('For the following turn');
  requests[0].resolve({ turn: { id: 'batch-turn' } }); await tick();
  assert.deepEqual(usersOf(c).map(e => e.turnId), ['batch-turn', 'batch-turn', undefined]);
  assert.deepEqual(usersOf(c).map(e => e.userBatch), ['batch-turn:start', 'batch-turn:start', undefined]);
  c.onNotify('turn/completed', { turn: { id: 'batch-turn', status: 'completed' } });
  requests[1].resolve({ turn: { id: 'next-turn' } }); await tick();
  assert.deepEqual(usersOf(c).map(e => e.turnId), ['batch-turn', 'batch-turn', 'next-turn']);
  assert.equal(acksOf(c).length, 3);
  assertReplaySize(c);
});

test('codex prompt identities: refused starts and cancelled queued messages are never marked accepted', async t => {
  const { c, requests } = sending(t);
  c.send('Refused');
  requests[0].reject(new Error('Unavailable')); await tick();
  assert.equal(usersOf(c)[0].turnId, undefined);
  c.threadReady = false; c.send('Stopped before sending'); await c.interrupt();
  assert.equal(usersOf(c)[1].turnId, undefined);
  assert.equal(acksOf(c).length, 0);
  assertReplaySize(c);
});

test('codex prompt identities: accepted steer retains the expected turn even after it finishes', async t => {
  const { c, requests } = sending(t);
  c.beginTurn('old-turn'); c.steer('Also check this');
  c.onNotify('turn/completed', { turn: { id: 'old-turn', status: 'completed' } });
  c.beginTurn('new-turn');
  requests[0].resolve({}); await tick();
  assert.equal(usersOf(c)[0].turnId, 'old-turn');
  assert.equal(usersOf(c)[0].userBatch, undefined, 'a steer cannot match the initial prompt or another steer by words');
  assert.equal(acksOf(c)[0].userBatch, undefined);
  assert.equal(c.turnId, 'new-turn');
  assertReplaySize(c);
});

test('codex prompt identities: refused steer gets its fallback turn, never the rejected turn', async t => {
  const { c, requests } = sending(t);
  c.beginTurn('rejected-turn'); c.steer('Try again');
  c.onNotify('turn/completed', { turn: { id: 'rejected-turn', status: 'completed' } });
  requests[0].reject(new Error('Turn finished')); await tick();
  assert.equal(usersOf(c)[0].turnId, undefined);
  assert.equal(requests[1].method, 'turn/start');
  requests[1].resolve({ turn: { id: 'fallback-turn' } }); await tick();
  assert.equal(usersOf(c)[0].turnId, 'fallback-turn');
  assert.equal(usersOf(c)[0].userBatch, 'fallback-turn:start', 'a refused steer starts a new turn only when its fallback is accepted');
  assert.equal(acksOf(c).length, 1);
  assertReplaySize(c);
});

test('codex prompt identities: only the first history user message has the input-batch identity', () => {
  const user = id => ({ id, type: 'userMessage', content: [{ type: 'text', text: 'Repeated words' }] });
  const history = historyItems([
    { id: 'first', items: [user('one'), user('two'), user('three')] },
    { id: 'second', items: [user('four')] },
  ]).filter(x => x.kind === 'user');
  assert.deepEqual(history.map(x => x.userBatch), ['first:start', undefined, undefined, 'second:start']);
  assert.deepEqual(history.map(x => x.itemId), ['one', 'two', 'three', 'four']);
});

test('codex prompt identities: a clipped combined history prompt is marked so it cannot hide a later queued message', async t => {
  const { c, requests } = sending(t), first = 'x'.repeat(LIMITS.text), second = 'Keep this queued request visible.';
  c.threadReady = false; c.send(first); c.send(second);
  c.threadReady = true; c.flush();
  requests[0].resolve({ turn: { id: 'clipped-batch' } }); await tick();
  const [history] = historyItems([{ id: 'clipped-batch', items: [{ id: 'combined-user', type: 'userMessage', content: requests[0].params.input }] }]);
  assert.equal(history.truncated, true);
  assert.equal(history.userBatch, 'clipped-batch:start');
  assert.equal(history.text.includes(second), false);
  assert.equal(usersOf(c)[1].text, second, 'the retained live member still has the complete later request');
  const [normal] = historyItems([{ id: 'small', items: [{ type: 'userMessage', content: [{ type: 'text', text: second }] }] }]);
  assert.equal(normal.truncated, undefined);
  assertReplaySize(c);
});

test('codex prompt identities: acknowledging an evicted prompt does not charge it back to replay', async t => {
  const { c, requests } = sending(t), previous = LIMITS.bufferBytes;
  LIMITS.bufferBytes = 600; t.after(() => { LIMITS.bufferBytes = previous; });
  c.send('Eventually accepted');
  const event = usersOf(c)[0];
  c.emit({ kind: 'notice', text: 'x'.repeat(500) });
  assert.equal(c.replaySizes.has(event), false);
  requests[0].resolve({ turn: { id: 'evicted-prompt-turn' } }); await tick();
  assert.equal(event.turnId, 'evicted-prompt-turn');
  assert.equal(acksOf(c)[0].userSeq, event.seq, 'an already visible prompt still receives its identity');
  assertReplaySize(c);
});
