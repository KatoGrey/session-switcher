'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('codex memory: completed tool payloads and closed active inputs are released while replay and approvals remain usable', () => {
  const out = execFileSync(process.execPath, ['--expose-gc', path.join(__dirname, 'fixtures', 'codex-memory.js')], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const result = JSON.parse(out.trim());
  assert.equal(result.results, 4);
  assert.ok(result.completedMiB < 6, 'completed tool payloads retained ' + result.completedMiB.toFixed(1) + ' MiB');
  assert.ok(result.closedMiB < 6, 'closed active inputs retained ' + result.closedMiB.toFixed(1) + ' MiB');
});
