'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('session index: clipped head and rolling tail do not retain whole large replies', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-index-memory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Isolated GC avoids measuring allocations from other tests; the child streams its large
  // fixture onto disk, so the test itself never keeps those replies as strings.
  const output = execFileSync(process.execPath, ['--expose-gc', path.join(__dirname, 'fixtures', 'index-memory.js'), root], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const result = JSON.parse(output.trim());
  assert.ok(result.firstMiB < 8, 'first clipped reply retained ' + result.firstMiB.toFixed(1) + ' MiB');
  assert.ok(result.secondMiB < 8, 'rolling tail retained ' + result.secondMiB.toFixed(1) + ' MiB');
});
