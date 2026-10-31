'use strict';
// Names for chats (lib/namer.js): what comes back is checked, each chat is asked about once, one at a time,
// and nothing is left running or kept. The program is a stand-in here.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createNamer, cleanName, promptFor, ARGS } = require('../lib/namer');

const sleep = ms => new Promise(r => setTimeout(r, ms));
// A stand-in for the program: says `reply` once it has read its input.
function program(reply, { code = 0, hang = false } = {}) {
  const c = new EventEmitter();
  c.stdin = new PassThrough(); c.stdout = new PassThrough();
  let input = '';
  c.stdin.on('data', d => { input += d; });
  c.stdin.on('end', () => {
    c.input = input;
    if (hang) return;
    setImmediate(() => { c.stdout.write(reply); c.emit('close', code); });
  });
  return c;
}

test('namer: only a name counts as a name', () => {
  assert.equal(cleanName('Luxellia NPC name fixes\n'), 'Luxellia NPC name fixes');
  assert.equal(cleanName('"Portrait redo for Rebirth."'), 'Portrait redo for Rebirth');
  assert.equal(cleanName('**Title:** Tavern brawl design'.replace('**Title:**', 'Title:')), 'Tavern brawl design');
  assert.equal(cleanName('\n\n  Rounder app icon  \nand more text'), 'Rounder app icon');
  for (const bad of ['', '   ', 'I need more information to do that', 'Sorry, I can’t title this', 'What would you like to call it?', 'Here’s a title for you', 'x', 'a very long reply that goes on and on and on and on and is plainly not a title at all']) assert.equal(cleanName(bad), null, bad);
});

test('namer: nothing it asks can use a tool, a setting or a saved session', () => {
  for (const a of ['--no-session-persistence', '--tools=', '--setting-sources=', '--strict-mcp-config', '-p']) assert.ok(ARGS.includes(a), a);
  assert.equal(ARGS[ARGS.indexOf('--model') + 1], 'haiku');
  const p = promptFor({ first: 'x'.repeat(5000), reply: 'y'.repeat(5000), folder: 'Rebirth' });
  assert.ok(p.length < 2600, 'it doesn’t send a whole chat');
  assert.match(p, /Rebirth/);
});

test('namer: a chat gets its name, once', async () => {
  const named = [], started = [];
  const n = createNamer({
    spawn: (job, args, cwd) => { const c = program('Luxellia NPC fixes\n'); started.push({ job, args, cwd, c }); return c; },
    apply: async (job, name) => { named.push([job.id, name]); },
  });
  assert.equal(n.note({ id: 'a', first: 'Fix the NPC names', reply: 'Done.', folder: 'Rebirth', extra: 1 }), true);
  assert.equal(n.note({ id: 'a', first: 'Fix the NPC names' }), false, 'asked already');
  await sleep(30);
  assert.deepEqual(named, [['a', 'Luxellia NPC fixes']]);
  assert.equal(started.length, 1);
  assert.equal(started[0].job.extra, 1);
  assert.match(started[0].c.input, /Fix the NPC names/);
  assert.equal(n.waiting(), 0);
});

test('namer: nothing to go on, turned off, or a bad answer: no name', async () => {
  let starts = 0, on = true;
  const named = [];
  const n = createNamer({ spawn: () => { starts++; return program('I need more information'); }, apply: async (j, name) => named.push(name), isOn: () => on });
  assert.equal(n.note({ id: 'a', first: '   ' }), false);
  assert.equal(n.note({ first: 'hello' }), false);
  on = false;
  assert.equal(n.note({ id: 'b', first: 'hello' }), false);
  on = true;
  assert.equal(n.note({ id: 'c', first: 'hello' }), true);
  await sleep(20);
  assert.equal(starts, 1);
  assert.deepEqual(named, []);
});

test('namer: one at a time, new chats before older ones, a failure stops nothing', async () => {
  const order = [], named = [];
  let n;
  const replies = { a: ['A name here', 0], old1: ['Old one', 0], bad: ['', 1], fresh: ['Fresh chat', 0], old2: ['Old two', 0] };
  n = createNamer({
    spawn: job => { order.push(job.id); const [r, code] = replies[job.id]; return program(r, { code }); },
    apply: async (job, name) => { if (job.id === 'old1') throw new Error('it’s busy'); named.push(name); },
  });
  n.note({ id: 'a', first: 'x' });
  n.note({ id: 'old1', first: 'x' }, { later: true });
  n.note({ id: 'bad', first: 'x' }, { later: true });
  n.note({ id: 'old2', first: 'x' }, { later: true });
  n.note({ id: 'fresh', first: 'x' });
  await sleep(60);
  assert.deepEqual(order, ['a', 'fresh', 'old1', 'bad', 'old2']);
  assert.deepEqual(named, ['A name here', 'Fresh chat', 'Old two']);
});

test('namer: a program that hangs is stopped, and the next one goes on', async () => {
  const killed = [], named = [];
  const n = createNamer({
    spawn: job => program('Second chat', { hang: job.id === 'hung' }),
    kill: c => { killed.push(c); },
    apply: async (j, name) => named.push(name),
    timeout: 30,
  });
  n.note({ id: 'hung', first: 'x' });
  n.note({ id: 'next', first: 'x' }, { later: true });
  await sleep(90);
  assert.equal(killed.length, 1);
  assert.deepEqual(named, ['Second chat']);
});

test('namer: turned off and on again, what was waiting carries on', async () => {
  let on = true;
  const named = [];
  const n = createNamer({ spawn: job => program(`Name of ${job.id}`), apply: async (j, name) => named.push(name), isOn: () => on });
  n.note({ id: 'a', first: 'x' });
  n.note({ id: 'b', first: 'x' }, { later: true });
  on = false;
  await sleep(30);
  assert.deepEqual(named, ['Name of a'], 'the one under way finishes; the next waits');
  assert.equal(n.waiting(), 1);
  on = true;
  n.resume();
  await sleep(30);
  assert.deepEqual(named, ['Name of a', 'Name of b']);
  assert.equal(n.waiting(), 0);
});

test('namer: a program that won’t start is only logged', async () => {
  const logs = [];
  const n = createNamer({ spawn: () => { throw new Error('no such program'); }, apply: async () => assert.fail('no name'), log: m => logs.push(m) });
  n.note({ id: 'a', first: 'x' });
  await sleep(10);
  assert.match(logs[0], /no such program/);
});
