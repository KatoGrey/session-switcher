'use strict';
// Disposable search indexes, kept beside app data in a hidden folder. Each transcript has its own
// small atomic file; no giant JSON write blocks the server and no original conversation is changed.
const fs = require('fs');
const path = require('path');
const { createHash, randomBytes } = require('crypto');

const hash = value => createHash('sha256').update(value).digest('hex');
const identity = stat => `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;

async function witness(file, offset) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const length = Math.min(offset, 4096), first = Buffer.alloc(length), last = Buffer.alloc(length);
    const a = await handle.read(first, 0, length, 0);
    const b = await handle.read(last, 0, length, Math.max(0, offset - length));
    return hash(Buffer.concat([first.subarray(0, a.bytesRead), last.subarray(0, b.bytesRead)]));
  } finally { await handle.close(); }
}

function createIndexCache(dataDir, root) {
  const dir = path.join(dataDir, '.session-index', hash(path.resolve(root)).slice(0, 16));
  const name = file => path.join(dir, `${hash(path.resolve(file))}.json`);
  const savedAt = new Map();
  let ready;
  async function read(file) {
    try {
      const cache = name(file);
      if ((await fs.promises.stat(cache)).size > 16 * 1024 * 1024) return null;
      const saved = JSON.parse(await fs.promises.readFile(cache, 'utf8'));
      if (saved.version !== 1 || saved.source !== file) return null;
      const x = saved.value;
      if (!x || !Number.isSafeInteger(x.offset) || x.offset < 0 || !Number.isFinite(x.size) || x.size < x.offset || !Number.isFinite(x.mtimeMs)) return null;
      if (typeof x.identity !== 'string' || typeof x.witness !== 'string' || typeof x.over !== 'boolean') return null;
      if (typeof x.full !== 'string' || x.full.length > 1500000 || typeof x.head !== 'string' || x.head.length > 300000 || typeof x.tail !== 'string' || x.tail.length > 1200000) return null;
      if (!x.stats || !['prompts', 'replies', 'tools'].every(k => Number.isFinite(x.stats[k]) && x.stats[k] >= 0) || !Array.isArray(x.stats.models) || x.stats.models.length > 5) return null;
      if (!Array.isArray(x.times) || x.times.length > 1500 || !x.times.every(Number.isFinite)) return null;
      return x;
    } catch { return null; }   // missing or damaged caches are simply rebuilt
  }
  async function write(file, value) {
    const now = Date.now(), previous = savedAt.get(file);
    // Streaming can update a transcript every few seconds. Rewriting megabytes of cache for every
    // delta costs more than replaying the last minute's append after a restart.
    if (previous && now >= previous && now - previous < 60000) return;
    if (!ready) ready = fs.promises.mkdir(dir, { recursive: true }).catch(err => { ready = null; throw err; });
    await ready;
    const dest = name(file), temp = `${dest}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await fs.promises.writeFile(temp, JSON.stringify({ version: 1, source: file, value }), { mode: 0o600 });
      await fs.promises.rename(temp, dest);
      savedAt.set(file, now);
    } finally { await fs.promises.rm(temp, { force: true }).catch(() => {}); }
  }
  async function prune(files) {
    const sources = new Set(files);
    for (const file of savedAt.keys()) if (!sources.has(file)) savedAt.delete(file);
    const keep = new Set(files.map(file => path.basename(name(file))));
    let names;
    try { names = await fs.promises.readdir(dir); } catch { return; }
    for (const file of names) if (/^[a-f0-9]{64}\.json$/.test(file) && !keep.has(file)) await fs.promises.rm(path.join(dir, file), { force: true }).catch(() => {});
  }
  return { read, write, prune };
}

module.exports = { createIndexCache, identity, witness };
