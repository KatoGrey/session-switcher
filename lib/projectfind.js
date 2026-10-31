'use strict';
// Words in a project's files: which lore file mentions the queen, without asking an agent to look. Only files
// of words, not too big, a few at a time so nothing else waits, and it stops after a few seconds with what it
// has found, and says so. What the viewer wouldn't open (sign-ins, keys) isn't read here either.

const fs = require('fs');
const path = require('path');
const { allowed, secretName } = require('./files');
const fsp = fs.promises;

const TEXT = new Set('md markdown mdx txt rst json jsonl csv tsv log yml yaml toml xml ini cfg js mjs cjs ts tsx jsx css scss html htm lua py rb go rs java kt c h cpp hpp cs sh ps1 sql vue svelte gml tres tscn rpy'.split(' '));
const WORDS = new Set(['md', 'markdown', 'mdx', 'txt', 'rst']);
const SKIP = new Set(['node_modules', 'bower_components', 'site-packages', '__pycache__', 'venv', 'vendor', 'target', 'coverage', 'dist', 'build', 'kept pictures']);
const MAX_SIZE = 2 << 20, MAX_FILES = 20000, MAX_HITS = 200, LINES_PER_FILE = 3, BUDGET = 8000, MAX_DEPTH = 12;

// A file as it was listed, and no more of it than was meant: it can grow, or become a link, on the way.
async function readSome(file, max = MAX_SIZE) {
  const listed = await fsp.lstat(file, { bigint: true });
  if (!listed.isFile() || listed.size > max) return null;
  const handle = await fsp.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const st = await handle.stat({ bigint: true });
    if (!st.isFile() || st.ino !== listed.ino || st.dev !== listed.dev || st.size > max) return null;
    const buf = Buffer.allocUnsafe(Number(st.size));
    let got = 0;
    while (got < buf.length) {
      const { bytesRead } = await handle.read(buf, got, buf.length - got, got);
      if (!bytesRead) break;
      got += bytesRead;
    }
    return { text: buf.toString('utf8', 0, got), mtime: Number(st.mtimeMs) };
  } finally { await handle.close().catch(() => {}); }
}

async function find(root, words, { budget = BUDGET, maxFiles = MAX_FILES, maxDepth = MAX_DEPTH } = {}) {
  const q = String(words || '').trim().toLowerCase();
  if (q.length < 2) return { hits: [], files: 0, cut: false };
  const until = Date.now() + budget, hits = [];
  let files = 0, cut = false;
  const look = async file => {
    let got;
    try { got = await readSome(file); } catch { return; }
    if (!got) return;
    files++;
    const { text, mtime } = got, rel = path.relative(root, file).split(path.sep).join('/');
    const low = text.toLowerCase();
    if (!low.includes(q)) return;
    let count = 0;
    const lines = [];
    let at = 0;
    for (let n = 1; at <= low.length; n++) {
      const end = low.indexOf('\n', at), stop = end < 0 ? low.length : end;
      const found = low.slice(at, stop).indexOf(q);
      if (found >= 0) {
        for (let i = low.indexOf(q, at); i >= 0 && i < stop; i = low.indexOf(q, i + q.length)) count++;
        if (lines.length < LINES_PER_FILE) {
          const line = text.slice(at, stop).replace(/\r$/, ''), from = Math.max(0, found - 60);
          lines.push({ n, text: `${from ? '…' : ''}${line.slice(from, from + 200).trim()}` });
        }
      }
      if (end < 0) break;
      at = end + 1;
    }
    hits.push({ rel, path: file, count, lines, mtime, words: WORDS.has(path.extname(rel).slice(1).toLowerCase()) });
  };
  let level = [root], depth = 0;
  while (level.length && !cut) {
    const next = [], batch = [];
    for (let i = 0; i < level.length && !cut; i += 16) {
      if (Date.now() > until) { cut = true; break; }
      await Promise.all(level.slice(i, i + 16).map(async dir => {
        let entries;
        try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
        // Links aren't followed, so one answer does for all of a folder's files, but for their names.
        let dirOk = null;
        for (const e of entries) {
          if (e.name.startsWith('.')) continue;
          const p = path.join(dir, e.name);
          if (e.isDirectory()) { if (depth < maxDepth && !SKIP.has(e.name.toLowerCase())) next.push(p); continue; }
          if (!e.isFile() || !TEXT.has(path.extname(e.name).slice(1).toLowerCase()) || secretName(e.name)) continue;
          if (dirOk === null) dirOk = allowed(dir, root);
          if (dirOk) batch.push(p);
        }
      }));
    }
    for (let i = 0; i < batch.length && !cut; i += 16) {
      if (Date.now() > until || files >= maxFiles || hits.length >= MAX_HITS) { cut = true; break; }
      await Promise.all(batch.slice(i, i + 16).map(look));
    }
    level = next; depth++;
  }
  // Documents first, then the files with the most of it.
  hits.sort((a, b) => (b.words - a.words) || (b.count - a.count) || (b.mtime - a.mtime));
  return { hits: hits.slice(0, MAX_HITS), files, cut };
}

module.exports = { find };
