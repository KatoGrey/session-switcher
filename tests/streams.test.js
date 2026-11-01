'use strict';
// One live connection per window (lib/streams.js): a window's chats all come over it, each event named
// for the request it answers, and nothing is left attached when a window goes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStreams, cleanId, boundedWrite } = require('../lib/streams');

const fakeRes = () => { const out = []; return { out, write(s) { out.push(s); return true; }, text: () => out.join('') }; };
const fakeChat = (buffer = []) => ({ buffer, clients: new Set(), info: () => ({ key: 'k', sessionId: 's' }) });
// As an EventSource would hand them over.
const parse = text => text.split('\n\n').filter(Boolean).map(block => {
  const ev = /^event: (.*)$/m.exec(block);
  return { name: ev && ev[1], data: block.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('\n') };
});

test('streams: a window that’s stopped reading is cut off, one that’s only busy isn’t', () => {
  const res = fakeRes(); let cut = 0; res.destroy = () => { cut++; };
  res.writableLength = 100;
  assert.equal(boundedWrite(res, 'a', 1000), true);
  res.writableLength = 32 << 20;   // far behind
  assert.equal(boundedWrite(res, 'b', 2000), true, 'for now: a long replay looks like this too');
  assert.equal(boundedWrite(res, 'c', 20000), true);
  res.writableLength = 100;        // it caught up
  assert.equal(boundedWrite(res, 'd', 25000), true);
  res.writableLength = 32 << 20;
  assert.equal(boundedWrite(res, 'e', 40000), true, 'the clock starts again');
  assert.equal(cut, 0);
  assert.equal(boundedWrite(res, 'f', 40000 + 31000), false);
  assert.equal(cut, 1);
  assert.deepEqual(res.out, ['a', 'b', 'c', 'd', 'e']);
  const flood = fakeRes(); let gone = 0; flood.destroy = () => { gone++; };
  flood.writableLength = 300 << 20;
  assert.equal(boundedWrite(flood, 'g', 1000), false, 'too far behind goes at once');
  assert.equal(gone, 1);
  assert.equal(boundedWrite(fakeRes(), 'x'), true, 'a stand-in with no queue to measure is fine');
  const broken = { write() { throw new Error('closed'); } };
  assert.equal(boundedWrite(broken, 'x'), false);
});

test('streams: a window that reconnects ends its old connection, and the old one’s closing changes nothing', () => {
  const s = createStreams(), old = fakeRes(), fresh = fakeRes();
  let ended = 0; old.end = () => { ended++; };
  const leaveOld = s.open('w', old);
  const chat = fakeChat();
  s.watch('w', 'a', chat);
  assert.equal(chat.clients.size, 1);
  const leaveNew = s.open('w', fresh);
  assert.equal(ended, 1);
  assert.equal(chat.clients.size, 0, 'what it had is dropped; it asks again');
  s.watch('w', 'a', chat);
  leaveOld();   // the old connection's close arrives late
  assert.equal(s.has('w'), true);
  assert.equal(chat.clients.size, 1, 'and the new one keeps what it asked for');
  leaveNew();
  assert.equal(s.has('w'), false);
  assert.equal(chat.clients.size, 0);
});

test('streams: a chat replays what happened since, says when that ends, then follows', () => {
  const s = createStreams(), res = fakeRes();
  s.open('w1', res);
  const chat = fakeChat([{ seq: 1, kind: 'user', text: 'old' }, { seq: 2, kind: 'assistant', text: 'new' }]);
  assert.equal(s.watch('w1', 's1', chat, 1), true);
  const evs = parse(res.text());
  assert.deepEqual(evs.map(e => e.name), ['mux', 'ch', 'c', 'cr']);
  assert.equal(evs[1].data.split('\n')[0], 's1 0');
  assert.deepEqual(JSON.parse(evs[1].data.split('\n')[1]), { key: 'k', sessionId: 's' });
  assert.equal(evs[2].data.split('\n')[0], 's1 2', 'only what came after');
  assert.equal(JSON.parse(evs[2].data.split('\n')[1]).text, 'new');
  // What the chat itself writes (lib/chat.js emit) comes through named for this request, in one piece.
  assert.equal(chat.clients.size, 1);
  const line = { seq: 3, kind: 'delta', text: 'with\nnewline and data: inside' };
  for (const c of chat.clients) c.write(`id: 3\nevent: chat\ndata: ${JSON.stringify(line)}\n\n`);
  const last = parse(res.text()).at(-1);
  assert.equal(last.name, 'c');
  assert.equal(last.data.split('\n')[0], 's1 3');
  assert.deepEqual(JSON.parse(last.data.slice(last.data.indexOf('\n') + 1)), line);
});

test('streams: two chats over one connection stay apart', () => {
  const s = createStreams(), res = fakeRes();
  s.open('w1', res);
  const a = fakeChat(), b = fakeChat();
  s.watch('w1', 'a', a); s.watch('w1', 'b', b);
  for (const c of a.clients) c.write('id: 1\nevent: chat\ndata: {"t":"A"}\n\n');
  for (const c of b.clients) c.write('id: 7\nevent: chat\ndata: {"t":"B"}\n\n');
  const evs = parse(res.text()).filter(e => e.name === 'c');
  assert.deepEqual(evs.map(e => e.data.split('\n')[0]), ['a 1', 'b 7']);
  assert.deepEqual(evs.map(e => JSON.parse(e.data.split('\n')[1]).t), ['A', 'B']);
});

test('streams: no connection, no watching; watching again replaces, and leaving lets go', () => {
  const s = createStreams(), res = fakeRes(), chat = fakeChat();
  assert.equal(s.watch('nobody', 's', chat), false, 'that window isn’t connected');
  assert.equal(chat.clients.size, 0);
  const close = s.open('w1', res);
  s.watch('w1', 's', chat); s.watch('w1', 's', chat);
  assert.equal(chat.clients.size, 1, 'the same request again is one client, not two');
  s.unwatch('w1', 's');
  assert.equal(chat.clients.size, 0, 'unwatched');
  s.watch('w1', 's', chat);
  close();
  assert.equal(chat.clients.size, 0, 'the window went: an idle chat can be stopped again');
  assert.equal(s.has('w1'), false);
});

test('streams: a window that reconnects before the old connection has closed keeps its new one', () => {
  const s = createStreams(), first = fakeRes(), second = fakeRes(), chat = fakeChat();
  const closeFirst = s.open('w1', first);
  s.watch('w1', 's', chat);
  s.open('w1', second);
  assert.equal(chat.clients.size, 0, 'what the old connection followed is dropped; the window asks again');
  s.watch('w1', 's', chat);
  closeFirst();
  assert.equal(s.has('w1'), true, 'the old one closing late doesn’t take the new one with it');
  assert.equal(chat.clients.size, 1);
});

test('streams: ids can’t carry anything into the stream', () => {
  assert.equal(cleanId('s1\nevent: evil'), 's1eventevil');
  assert.equal(cleanId('w-abc_1'), 'w-abc_1');
  assert.equal(cleanId('x'.repeat(100)).length, 48);
});
