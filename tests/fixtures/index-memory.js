'use strict';
// Runs only as the isolated child of session-memory.test.js.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createSessionStore } = require('../../lib/sessions');
(async () => {
  const root = process.argv[2], projects = path.join(root, 'projects'), dataDir = path.join(root, 'data');
  fs.mkdirSync(path.join(projects, 'one'), { recursive: true }); fs.mkdirSync(dataDir);
  const file = path.join(projects, 'one', 'aaaaaaaa-1111-4222-8333-444444444444.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'user', cwd: root, message: { content: 'northneedle' } }) + '\n');
  function append(id, word) {
    const fd = fs.openSync(file, 'a'), chunk = Buffer.alloc(1024 * 1024, 120);
    try {
      fs.writeSync(fd, '{"type":"assistant","message":{"id":"' + id + '","content":[{"type":"text","text":"');
      for (let i = 0; i < 16; i++) fs.writeSync(fd, chunk);
      fs.writeSync(fd, ' ' + word + '"}]}}\n');
    } finally { fs.closeSync(fd); }
  }
  const collect = async () => {
    await new Promise(r => setImmediate(r));
    for (let i = 0; i < 3; i++) global.gc();
    const m = process.memoryUsage();
    return m.heapUsed + m.external;   // Node can store decoded UTF-16 strings outside the V8 heap.
  };
  const store = createSessionStore({ root: projects, dataDir });
  const baseline = await collect();
  append('m1', 'southneedle'); await store.refreshIndex();
  assert.equal(store.search('northneedle southneedle').hits.length, 1);
  const firstMiB = ((await collect()) - baseline) / 1048576;
  append('m2', 'latestneedle'); await store.refreshIndex();
  assert.equal(store.search('northneedle latestneedle').hits.length, 1);
  const secondMiB = ((await collect()) - baseline) / 1048576;
  // Retained index: 1.5M characters (up to 3MB UTF-16) plus small metadata. Before the fix, both
  // 16MB replies stayed alive behind its head/tail slices, retaining over 32MB.
  console.log(JSON.stringify({ firstMiB, secondMiB }));
})().catch(err => { console.error(err); process.exitCode = 1; });
