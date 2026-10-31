'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLog } = require('../lib/logger');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-logger-'));
  const file = path.join(dir, 'switcher.log');
  let time = Date.parse('2026-10-31T08:00:00Z');
  const log = createLog(file, { echo: false, now: () => time });
  t.after(() => { if (log.close) log.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { log, advance: ms => { time += ms; }, lines: () => fs.readFileSync(file, 'utf8').trim().split(/\r?\n/) };
}

test('log: interleaved repeated provider errors stay bounded and name both suppressed errors', t => {
  const { log, lines } = fixture(t);
  log('Codex: the output was too large.');
  log('Gemini: the connection ended.');
  for (let i = 0; i < 2000; i++) {
    log('Codex: the output was too large.');
    log('Gemini: the connection ended.');
  }
  log.flush();
  const output = lines();
  assert.ok(output.length <= 6, `a repeating pair should not flood the log (${output.length} lines)`);
  assert.ok(output.some(l => /2000 more times/.test(l) && /Codex/.test(l)), 'a non-adjacent summary identifies the suppressed error');
  assert.ok(output.some(l => /2000 more times/.test(l) && /Gemini/.test(l)), 'the other count is attributable too');
});

test('log: errors with the same first line and different details are both recorded', t => {
  const { log, lines } = fixture(t);
  log('Request failed\nFirst operation: read history');
  log('Request failed\nSecond operation: send message');
  log.flush();
  const output = lines().join('\n');
  assert.match(output, /First operation: read history/);
  assert.match(output, /Second operation: send message/);
});

test('log: a repeat is recorded again after a minute, with pending counts preserved', t => {
  const { log, lines, advance } = fixture(t);
  log('Codex disconnected'); log('Gemini disconnected');
  log('Codex disconnected'); log('Gemini disconnected');
  advance(61000);
  log('Codex disconnected');
  log.flush();
  const output = lines();
  assert.equal(output.filter(l => /\] Codex disconnected$/.test(l)).length, 2);
  assert.equal(output.filter(l => /1 more time/.test(l)).length, 2);
});
