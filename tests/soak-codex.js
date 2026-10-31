#!/usr/bin/env node
'use strict';
// One long synthetic Codex turn: real event handling, no provider/account/project or filesystem
// writes. Completed multi-MB outputs, images, approvals and overlapping item completion exercise
// bounded replay and completion metadata without waiting for a turn to release its raw results.
// node --expose-gc tests/soak-codex.js --minutes 5 --pace-ms 1000
// node --expose-gc tests/soak-codex.js --until 2026-10-31T15:20:00Z --pace-ms 2000
const assert = require('node:assert/strict'), os = require('node:os');
const snapshots = require('../lib/snapshots');
snapshots.warm = () => {};
const { CodexChat } = require('../lib/codex');
const { LIMITS } = require('../lib/chat');
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf('--' + name); return i < 0 ? fallback : args[i + 1]; };
const deadline = option('until', null) ? Date.parse(option('until')) : Date.now() + Number(option('minutes', 5)) * 60000;
const pace = Number(option('pace-ms', 1000));
if (!Number.isFinite(deadline) || deadline <= Date.now() || !Number.isFinite(pace) || pace < 0) throw new Error('Use a future deadline and a nonnegative pace.');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const chat = new CodexChat({ cfg: {}, account: { id: 'synthetic', name: 'Synthetic' }, cwd: os.tmpdir(), codex: {} });
chat.srv = { listeners: new Set(), respond() {} };
chat.state = 'ready'; chat.beginTurn('long-synthetic-turn');
let steps = 0, approvals = 0, images = 0, rawBytes = 0, nextReport = 0, peakMiB = 0;
function step() {
  const id = 'step-' + (++steps), payload = id + ' ' + 'x'.repeat(2 * 1024 * 1024);
  rawBytes += Buffer.byteLength(payload);
  const item = { id, type: 'commandExecution', status: 'inProgress', command: 'echo synthetic-output' };
  chat.itemStarted(item);
  if (steps % 17 === 0) {
    const requestId = 'approval-' + steps;
    chat.onRequest({ id: requestId, method: 'item/commandExecution/requestApproval', params: { itemId: id } });
    assert.match(chat.pending.get(requestId).event.view.detail, /synthetic-output/);
    chat.answer(requestId, { decision: 'allow' }); approvals++;
  }
  chat.itemCompleted({ ...item, status: 'completed', exitCode: 0, aggregatedOutput: payload });
  assert.deepEqual(Object.keys(chat.items.get(id)).sort(), ['id', 'status', 'type']);
  if (steps % 5 === 0) {
    const text = { id: 'text-' + steps, type: 'agentMessage', text: 'Finished synthetic step ' + steps + '.' };
    chat.itemStarted(text); chat.itemCompleted(text);
  }
  if (steps % 11 === 0) {
    const image = { id: 'image-' + steps, type: 'imageGeneration', status: 'inProgress' };
    chat.itemStarted(image);
    const imagePart = chat.itemMids.get(image.id);
    const text = { id: 'after-image-' + steps, type: 'agentMessage', text: 'The picture finishes later.' };
    chat.itemStarted(text); chat.itemCompleted(text);
    chat.itemCompleted({ ...image, status: 'completed', result: 'data:image/png;base64,' + Buffer.alloc(384 * 1024, steps % 251).toString('base64') });
    assert.equal(chat.buffer.findLast(e => e.itemId === image.id).mid, imagePart);
    images++;
  }
  assert.equal(chat.pending.size, 0);
  assert.ok(chat.replayBytes <= LIMITS.bufferBytes, 'ordinary replay exceeded its byte budget');
}
function report(state) {
  if (global.gc) global.gc();
  const m = process.memoryUsage(), retainedMiB = (m.heapUsed + m.external) / 1048576;
  peakMiB = Math.max(peakMiB, retainedMiB);
  console.log(JSON.stringify({ at: new Date().toISOString(), state, steps, approvals, images, rawMiB: Math.round(rawBytes / 1048576), retainedMiB: +retainedMiB.toFixed(1), peakMiB: +peakMiB.toFixed(1), replayMiB: +(chat.replayBytes / 1048576).toFixed(1), buffered: chat.buffer.length, itemMetadata: chat.items.size }));
}
(async () => {
  report('starting');
  while (Date.now() < deadline) {
    step();
    if (Date.now() >= nextReport) { report('running'); nextReport = Date.now() + 60000; }
    await sleep(Math.min(pace, Math.max(0, deadline - Date.now())));
  }
  chat.end(null);
  assert.equal(chat.items.size, 0); assert.equal(chat.itemMids.size, 0);
  report('passed');
})().catch(err => { console.error(err.stack || err); chat.end(null); process.exitCode = 1; });
