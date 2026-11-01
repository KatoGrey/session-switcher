#!/usr/bin/env node
'use strict';
// Optional, synthetic-only benchmark: node --expose-gc tests/bench-history.js
// Compares the committed implementation with the working tree. It never reads real conversations.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');
const { performance, monitorEventLoopDelay } = require('perf_hooks');

const APP = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-history-bench-'));
const root = path.join(dir, 'projects'), project = path.join(root, 'synthetic');
fs.mkdirSync(project, { recursive: true });
const gc = () => { if (global.gc) global.gc(); };
function committed(name) {
  const source = execFileSync('git', ['show', `HEAD:lib/${name}.js`], { cwd: APP, encoding: 'utf8', maxBuffer: 2 << 20, windowsHide: true });
  const filename = path.join(APP, 'lib', `${name}.js`), mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(source, filename);
  return mod.exports;
}
async function measureIndex(label, implementation, dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  gc();
  const before = process.memoryUsage().heapUsed, cpu = process.cpuUsage();
  const delay = monitorEventLoopDelay({ resolution: 10 }); delay.enable();
  const store = implementation.createSessionStore({ root, dataDir });
  const began = performance.now();
  await store.refreshIndex();
  const ms = performance.now() - began;
  delay.disable(); gc();
  const used = process.cpuUsage(cpu);
  const result = { label, milliseconds: Math.round(ms), cpuMilliseconds: Math.round((used.user + used.system) / 1000), retainedHeapMiB: +(Math.max(0, process.memoryUsage().heapUsed - before) / 1048576).toFixed(1), maxEventLoopDelayMs: +(delay.max / 1e6).toFixed(1), searchableChats: store.search('benchmarkneedle').hits.length };
  if (result.searchableChats !== 16) throw new Error(`${label}: incomplete search index`);
  return result;
}
async function main() {
  let bytes = 0;
  for (let i = 0; i < 16; i++) {
    const file = path.join(project, `${String(i).padStart(8, '0')}-1111-4222-8333-444444444444.jsonl`);
    const fd = fs.openSync(file, 'w');
    try {
      for (let j = 0; j < 512; j++) {
        const timestamp = new Date(1700000000000 + j * 1000).toISOString();
        const lines = [
          { type: 'user', cwd: APP, timestamp, message: { content: `Question ${j}. ${'detail '.repeat(550)}` } },
          { type: 'assistant', timestamp, message: { id: `m${j}`, model: 'synthetic-model', content: [{ type: 'text', text: `benchmarkneedle ${j}. ${'answer '.repeat(550)}` }] } },
        ].map(e => JSON.stringify(e)).join('\n') + '\n';
        bytes += Buffer.byteLength(lines); fs.writeSync(fd, lines);
      }
    } finally { fs.closeSync(fd); }
  }
  gc();
  const old = committed('sessions'), current = require('../lib/sessions');
  const results = [];
  results.push(await measureIndex('committed: initial index', old, path.join(dir, 'old')));
  results.push(await measureIndex('committed: restart', old, path.join(dir, 'old')));
  results.push(await measureIndex('working tree: initial index', current, path.join(dir, 'new')));
  results.push(await measureIndex('working tree: restart', current, path.join(dir, 'new')));
  console.log(JSON.stringify({ syntheticTranscriptMiB: +(bytes / 1048576).toFixed(1), chats: 16, gcEnabled: !!global.gc, results }, null, 2));
}
main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
