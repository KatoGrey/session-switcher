const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { READY, startReplacement } = require('../lib/restart');

function replacement() {
  const child = new EventEmitter();
  Object.assign(child, { pid: 12345, connected: true, killed: false, detached: false });
  child.disconnect = () => { child.connected = false; };
  child.unref = () => { child.detached = true; };
  child.kill = () => { child.killed = true; };
  return child;
}

test('restart keeps the current copy until the replacement confirms it loaded, not just spawned', async () => {
  const child = replacement();
  let ready = false;
  const promise = startReplacement({ spawnProcess: () => child }).then(x => { ready = true; return x; });
  child.emit('spawn');
  child.emit('message', { type: READY, pid: child.pid + 1 });
  await Promise.resolve();
  assert.equal(ready, false);
  child.emit('message', { type: READY, pid: child.pid });
  assert.equal(await promise, child);
  assert.equal(child.detached, true);
  assert.equal(child.connected, false);
  assert.equal(child.killed, false);
});

test('restart reports asynchronous spawn failure without an uncaught error', async () => {
  const child = replacement();
  const promise = startReplacement({ spawnProcess: () => child });
  process.nextTick(() => child.emit('error', new Error('ENOENT')));
  await assert.rejects(promise, /ENOENT/);
  assert.equal(child.detached, false);
});

test('restart rejects a replacement that exits during initialization', async () => {
  const child = replacement();
  const promise = startReplacement({ spawnProcess: () => child });
  process.nextTick(() => child.emit('exit', 1));
  await assert.rejects(promise, /exited before it was ready/);
  assert.equal(child.detached, false);
});

test('restart times out and stops only its own unresponsive replacement', async () => {
  const child = replacement();
  await assert.rejects(startReplacement({ spawnProcess: () => child, timeoutMs: 20 }), /did not become ready/);
  assert.equal(child.killed, true);
  assert.equal(child.detached, false);
});
