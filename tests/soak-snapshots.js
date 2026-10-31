#!/usr/bin/env node
'use strict';
// Optional endurance test. Uses only its own temporary project and private snapshot store.
// node --expose-gc tests/soak-snapshots.js --minutes 60 --pace-ms 10000
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const snapshots = require('../lib/snapshots');
const { createShadowStore } = require('../lib/shadow-snapshots');
const argv = process.argv.slice(2);
const option = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : Number(argv[i + 1]); };
const minutes = option('--minutes', 1), pace = option('--pace-ms', 10000);
if (!(minutes > 0 && minutes <= 480 && pace >= 0)) throw new Error('Invalid duration or pace.');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-snapshot-soak-'));
const root = path.join(base, 'project'), dataDir = path.join(base, 'data');
fs.mkdirSync(root);
const limits = { manifests: 12, pinGraceMs: 0, projectBytes: 16 << 20, totalBytes: 24 << 20 };
const attributes = async paths => paths.map(() => 0);
snapshots.configure({ dataDir, limits, attributes });
const other = createShadowStore({ dir: path.join(dataDir, '.shadow-snapshots'), limits, attributes });
const expected = new Map();
for (let i = 0; i < 80; i++) {
  const file = `part-${i}.md`, text = `Original part ${i}.\n` + 'Source text.\n'.repeat(120);
  fs.writeFileSync(path.join(root, file), text); expected.set(file, text);
}
let rounds = 0, captures = 0, restores = 0, peakHeap = 0, lastLog = 0;
const until = Date.now() + minutes * 60000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function report(state) {
  if (global.gc) global.gc();
  const heap = process.memoryUsage().heapUsed / 1048576; peakHeap = Math.max(peakHeap, heap);
  console.log(JSON.stringify({ at: new Date().toISOString(), state, rounds, captures, restores,
    heapMiB: +heap.toFixed(1), peakHeapMiB: +peakHeap.toFixed(1) }));
  lastLog = Date.now();
}
async function round() {
  const file = `part-${rounds % 80}.md`, previous = expected.get(file);
  const before = await snapshots.snapshot(root, { shadow: true, fresh: true }); captures++;
  snapshots.pin(before);
  let after;
  try {
    const text = `Revision ${rounds}.\n${previous.slice(-1500)}`;
    fs.writeFileSync(path.join(root, file), text); expected.set(file, text);
    after = await other.capture(root); captures++; snapshots.pin(after);
    assert.deepEqual((await snapshots.changes(root, before, after)).map(x => x.path), [file]);
    if (rounds % 19 === 0) {
      // The second instance prunes repeatedly while the first still needs both trees.
      for (let i = 0; i < 15; i++) {
        fs.writeFileSync(path.join(root, 'activity.md'), `Background ${rounds}/${i}`);
        await other.capture(root); captures++;
      }
      assert.ok(await other.resolve(root, before)); assert.ok(await other.resolve(root, after));
    }
    if (rounds % 3 === 0) {
      assert.match(await snapshots.diff(root, before, after, file), /Revision/);
      const result = await snapshots.restore(root, before, after, [file]);
      assert.deepEqual(result.restored, [file]); assert.deepEqual(result.skipped, []);
      expected.set(file, previous); restores++;
    }
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), expected.get(file));
    assert.equal(fs.existsSync(path.join(root, '.git')), false);
  } finally { snapshots.release(before); if (after) snapshots.release(after); }
  rounds++;
}
(async () => {
  try {
    while (Date.now() < until) {
      await round(); if (Date.now() - lastLog >= 60000) report('running');
      await sleep(Math.min(pace, Math.max(0, until - Date.now())));
    }
    for (const [file, text] of expected) assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), text);
    report('passed');
  } catch (err) { report('failed'); console.error(err); process.exitCode = 1; }
  finally {
    await snapshots.configure(); await other.close();
    if (path.dirname(base) !== path.resolve(os.tmpdir()) || !path.basename(base).startsWith('ss-snapshot-soak-')) throw new Error('Unexpected temporary root.');
    fs.rmSync(base, { recursive: true, force: true });
  }
})();
