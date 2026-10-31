'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const cp = require('node:child_process');

function capture(t) {
  const child = new EventEmitter(), kills = [];
  Object.assign(child, { pid: 43210, exitCode: null, signalCode: null, stdout: new PassThrough(), stderr: new PassThrough() });
  t.mock.method(cp, 'spawn', (command, args) => {
    if (command === 'taskkill') { kills.push(args); return new EventEmitter(); }
    return child;
  });
  const file = require.resolve('../lib/system'), previous = require.cache[file];
  delete require.cache[file];
  const { runCapture } = require(file);
  t.after(() => { if (previous) require.cache[file] = previous; else delete require.cache[file]; });
  return { child, kills, runCapture };
}

test('capture: each output stream stays bounded and overflow stops the child tree only once', { skip: process.platform !== 'win32' }, async t => {
  const { child, kills, runCapture } = capture(t);
  const result = runCapture('fake command');
  for (let i = 0; i < 80; i++) {
    child.stdout.write(Buffer.alloc(65536, 120));
    child.stderr.write(Buffer.alloc(65536, 121));
  }
  child.emit('close', 0); // it may exit successfully before Windows has finished stopping it
  const r = await result;
  assert.ok(r.stdout.length <= 2000000, 'stdout cannot grow while the OS is still stopping the process');
  assert.ok(r.stderr.length <= 2000000, 'stderr has the same bound as stdout');
  assert.equal(kills.length, 1, 'continued pipe data cannot spawn a storm of taskkill processes');
  assert.equal(r.truncated, true);
  assert.equal(r.code, -1, 'an incomplete answer cannot look like a successful command');
  assert.match(r.stderr, /output exceeded/);
});

test('capture: UTF-8 split between pipe chunks preserves filenames and JSON text', async t => {
  const { child, runCapture } = capture(t);
  const result = runCapture('fake command');
  const text = '{"file":"夜空-🌙.txt"}', bytes = Buffer.from(text);
  for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
  for (const byte of bytes) child.stderr.write(Buffer.from([byte]));
  child.stdout.end(); child.stderr.end(); child.emit('close', 0);
  const r = await result;
  assert.equal(r.stdout, text); assert.equal(r.stderr, text);
  assert.deepEqual(JSON.parse(r.stdout), { file: '夜空-🌙.txt' });
  assert.equal(r.truncated, undefined);
});
