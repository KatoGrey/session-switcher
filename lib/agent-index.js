'use strict';
// Searchable words from selected Codex/Gemini transcripts. Never open a model or materialize
// pictures: one background reader skips oversized records, and publishes only complete updates.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('node:zlib');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createHash, randomBytes } = require('crypto');
const { ownText } = require('./shared');
const { identity, witness } = require('./session-cache');

const MAX = 1500000, HEAD = 300000, TAIL = MAX - HEAD;
const LINE_BYTES = 2 * 1024 * 1024, CACHE_BYTES = 12 * 1024 * 1024;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const ROLLOUT = /(?:^|[-_])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl(?:\.zst)?$/i;
const isCompressed = file => /\.jsonl\.zst$/i.test(file);
const hash = text => createHash('sha256').update(text).digest('hex');
const keyPath = file => process.platform === 'win32' ? file.toLowerCase() : file;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const cancelled = () => Object.assign(new Error('Indexing stopped'), { name: 'AbortError' });
const check = signal => { if (signal.aborted) throw cancelled(); };
const detached = text => Buffer.from(text, 'utf16le').toString('utf16le');
// Keep the usual small rolling append cheap without retaining a multi-megabyte parent.
const slice = (text, start, end) => {
  const kept = text.slice(start, end);
  return text.length <= kept.length + 128 * 1024 ? kept : detached(kept);
};
const broad = dir => keyPath(dir) === keyPath(path.parse(dir).root) || keyPath(dir) === keyPath(path.resolve(os.homedir()));
const stamp = st => ({ identity: identity(st), size: st.size, mtimeMs: st.mtimeMs });
const same = (x, st) => x.identity === identity(st) && x.size === st.size && x.mtimeMs === st.mtimeMs;

// Node's native Zstd stream accepts an unfinished final frame at EOF. Check only framing here;
// native Zstd still validates/decompresses the payload. Four header bytes are the entire buffer.
// Native EOF issue (including default finishFlush): https://github.com/nodejs/node/issues/64592
// Format: https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md
function zstdFrames() {
  const header = Buffer.alloc(4);
  let state = 'magic', remaining = 4, have = 0, collect = true, checksum = false, last = false, frames = 0;
  const begin = (next, bytes, save = false) => { state = next; remaining = bytes; have = 0; collect = save; };
  const finish = () => { frames++; begin('magic', 4, true); };
  const advance = () => {
    switch (state) {
      case 'magic': {
        const magic = header.readUInt32LE(0);
        if (magic === 0xfd2fb528) begin('descriptor', 1, true);
        else if ((magic & 0xfffffff0) === 0x184d2a50) begin('skipLength', 4, true);
        else throw new Error('Invalid Zstandard frame magic');
        break;
      }
      case 'descriptor': {
        const d = header[0], single = !!(d & 32), contentSize = d >>> 6;
        if (d & 8) throw new Error('Invalid Zstandard frame descriptor');
        checksum = !!(d & 4);
        begin('fields', (single ? 0 : 1) + [0, 1, 2, 4][d & 3] + (contentSize ? 1 << contentSize : single ? 1 : 0));
        break;
      }
      case 'fields': begin('block', 3, true); break;
      case 'block': {
        const block = header.readUIntLE(0, 3), type = (block >>> 1) & 3;
        if (type === 3) throw new Error('Invalid Zstandard block type');
        last = !!(block & 1); begin('body', type === 1 ? 1 : block >>> 3); break;
      }
      case 'body': if (!last) begin('block', 3, true); else if (checksum) begin('checksum', 4); else finish(); break;
      case 'checksum': case 'skipBody': finish(); break;
      case 'skipLength': begin('skipBody', header.readUInt32LE(0)); break;
    }
  };
  return new Transform({
    transform(chunk, encoding, callback) {
      try {
        let pos = 0;
        while (pos < chunk.length || remaining === 0) {
          const take = Math.min(remaining, chunk.length - pos);
          if (collect && take) chunk.copy(header, have, pos, pos + take);
          pos += take; have += take; remaining -= take;
          if (!remaining) advance();
        }
        callback(null, chunk);
      } catch (err) { callback(err); }
    },
    flush(callback) { callback(frames && state === 'magic' && remaining === 4 ? null : new Error('Truncated Zstandard frame')); },
  });
}

async function lines(file, x, end, onLine, signal) {
  const compressed = isCompressed(file);
  let offset = compressed ? 0 : x.offset, position = offset, skipping = compressed ? false : x.skipping, parts = [], length = 0, sinceYield = 0;
  const add = part => {
    if (skipping) return;
    length += part.length;
    if (length > LINE_BYTES) { skipping = true; parts = []; return; }
    parts.push(part);
  };
  if (end <= offset) {
    if (compressed) throw new Error('Empty compressed transcript');
    return { offset, skipping };
  }
  // All offsets and witnesses in the cache describe physical source bytes. Decoded positions
  // exist only while reading; a changed archive always starts a fresh decoder at physical byte 0.
  const decoded = compressed ? zlib.createZstdDecompress({ params: { [zlib.constants.ZSTD_d_windowLogMax]: 27 } }) : null;
  const frames = compressed ? zstdFrames() : null;
  let input;
  try { input = fs.createReadStream(file, { start: offset, end: end - 1, signal }); }
  catch (err) { if (decoded) decoded.destroy(); if (frames) frames.destroy(); throw err; }
  let streamError;
  const pumping = decoded ? pipeline(input, frames, decoded, { signal }).catch(err => { streamError = err; }) : null;
  try {
    for await (const chunk of decoded || input) {
      check(signal);
      let from = 0, nl;
      while ((nl = chunk.indexOf(10, from)) !== -1) {
        if (nl > from) add(chunk.subarray(from, nl));
        if (length && !skipping) onLine((parts.length === 1 ? parts[0] : Buffer.concat(parts, length)).toString('utf8'));
        offset = position + nl + 1;
        parts = []; length = 0; skipping = false; from = nl + 1;
      }
      if (from < chunk.length) add(chunk.subarray(from));
      position += chunk.length;
      sinceYield += chunk.length;
      if (sinceYield >= 8 * 1024 * 1024) { sinceYield = 0; await pause(5); check(signal); }
    }
  } finally {
    input.destroy(); if (frames) frames.destroy(); if (decoded) decoded.destroy();
    if (pumping) await pumping;
  }
  if (streamError) throw streamError;
  // A finished immutable archive may end with a valid JSON record without its optional newline.
  if (compressed && length && !skipping) onLine((parts.length === 1 ? parts[0] : Buffer.concat(parts, length)).toString('utf8'));
  if (compressed) return { offset: end, skipping: false };
  // A valid partial record is reread after its newline arrives. A known oversized record can
  // resume discarding from EOF, rather than rescanning gigabytes whenever another chunk arrives.
  return { offset: skipping ? position : offset, skipping };
}

function userWords(text) {
  text = ownText(text);
  if (/^\s*# AGENTS\.md instructions for\b/i.test(text)) {
    const start = text.indexOf('<INSTRUCTIONS>'), end = text.indexOf('</INSTRUCTIONS>', start);
    text = start >= 0 && end >= start ? text.slice(end + '</INSTRUCTIONS>'.length) : '';
  }
  return ownText(text);
}

function words(line, provider) {
  let e; try { e = JSON.parse(line); } catch { return ''; }
  if (!e || typeof e !== 'object') return '';
  if (provider === 'codex') {
    const p = e.type === 'response_item' && e.payload;
    if (!p || p.type !== 'message' || !['user', 'assistant'].includes(p.role) || !Array.isArray(p.content)) return '';
    let text = p.content.filter(b => b && ['input_text', 'output_text', 'text'].includes(b.type) && typeof b.text === 'string')
      .map(b => /^\s*<environment_context>[\s\S]*<\/environment_context>\s*$/.test(b.text) ? '' : p.role === 'user' ? userWords(b.text) : b.text).filter(Boolean).join('\n');
    if (p.role === 'user') text = userWords(text);
    return text.trim();
  }
  if (!['USER_INPUT', 'PLANNER_RESPONSE'].includes(e.type) || typeof e.content !== 'string') return '';
  let text = e.content;
  if (e.type === 'USER_INPUT') {
    const body = text.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
    text = ownText(body ? body[1] : text);
  }
  return text.trim();
}

function valid(x) {
  return x && Number.isSafeInteger(x.offset) && x.offset >= 0 && Number.isSafeInteger(x.size) && x.size >= x.offset &&
    Number.isFinite(x.mtimeMs) && typeof x.identity === 'string' && /^[a-f0-9]{64}$/.test(x.witness) &&
    typeof x.compressed === 'boolean' && typeof x.skipping === 'boolean' && typeof x.over === 'boolean' &&
    typeof x.full === 'string' && x.full.length <= MAX && typeof x.head === 'string' && x.head.length <= HEAD &&
    typeof x.tail === 'string' && x.tail.length <= TAIL && (x.over ? !x.full : !x.head && !x.tail);
}

function createAgentIndex({ dataDir, getRoots, log = () => {}, maxChars = 64000000, refreshMs = 5000 }) {
  const cacheDir = path.join(dataDir, '.session-index', 'agent-v1');
  const budget = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 64000000;
  const refreshWindow = Number.isFinite(refreshMs) ? Math.max(0, refreshMs) : 5000;
  const published = new Map(); // Only budgeted, detached views; full incremental state stays on disk.
  const progress = { done: 0, total: 0, ready: false };
  let wanted = new Map(), signature = '', revision = 0, pending = false, stopped = false, worker = null, controller = null;
  let catalogue = null, prunedAt = null, completedAt = null, completedSignature = null;
  const cacheName = (file, provider) => path.join(cacheDir, hash(provider + '\0' + keyPath(file)) + '.json');
  const share = () => Math.min(MAX, Math.floor(budget / Math.max(1, wanted.size)));
  const warn = err => { try { log(`Agent search index: ${err.message}`); } catch { /* logging must not stop indexing */ } };

  async function readCache(file, provider) {
    let handle;
    try {
      handle = await fs.promises.open(cacheName(file, provider), 'r');
      const st = await handle.stat();
      if (!st.isFile() || st.size > CACHE_BYTES) return null;
      const buffer = Buffer.alloc(st.size);
      let offset = 0;
      while (offset < buffer.length) {
        const r = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (!r.bytesRead) return null;
        offset += r.bytesRead;
      }
      const saved = JSON.parse(buffer.toString('utf8'));
      return saved.version === 2 && saved.source === file && saved.provider === provider && valid(saved.value) ? saved.value : null;
    } catch { return null; }
    finally { if (handle) await handle.close().catch(() => {}); }
  }

  async function writeCache(file, provider, value, signal) {
    check(signal);
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const dest = cacheName(file, provider), temp = `${dest}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await fs.promises.writeFile(temp, JSON.stringify({ version: 2, source: file, provider, value }), { mode: 0o600 });
      check(signal);
      await fs.promises.rename(temp, dest);
    } finally { await fs.promises.rm(temp, { force: true }).catch(() => {}); }
  }

  async function pruneCache(files, selected, signal) {
    const now = Date.now();
    if (prunedAt !== null && now - prunedAt >= 0 && now - prunedAt < 6 * 3600000) return;
    let listing;
    try { listing = await fs.promises.opendir(cacheDir); } catch { return; }
    prunedAt = now;
    const keep = new Set([...files].map(([id, file]) => path.basename(cacheName(file, selected.get(id).provider))));
    let seen = 0, removed = 0;
    // Disposable files in our own namespace only. Bound housekeeping even after years of chats;
    // leave recent caches useful to other instances and never remove a selected source's cache.
    for await (const entry of listing) {
      check(signal);
      if (++seen > 2000 || removed >= 100) break;
      if (!entry.isFile() || keep.has(entry.name)) continue;
      const temporary = /^[a-f0-9]{64}\.json\.\d+\.[a-f0-9]+\.tmp$/.test(entry.name);
      if (!temporary && !/^[a-f0-9]{64}\.json$/.test(entry.name)) continue;
      try {
        const file = path.join(cacheDir, entry.name), st = await fs.promises.lstat(file);
        if (st.isFile() && !st.isSymbolicLink() && now - st.mtimeMs > (temporary ? 1 : 30) * 86400000) {
          check(signal); await fs.promises.unlink(file); removed++;
        }
      } catch { /* another instance may already have removed it */ }
    }
  }

  function view(x, limit) {
    if (!x.over && x.full.length <= limit) return { full: detached(x.full) };
    const h = Math.floor(limit / 5), t = limit - h;
    return { head: detached((x.over ? x.head : x.full).slice(0, h)), tail: t ? detached((x.over ? x.tail : x.full).slice(-t)) : '' };
  }

  async function shrinkViews(signal) {
    const limit = share();
    let copied = 0;
    for (const p of published.values()) {
      check(signal);
      if (p.limit <= limit) continue;
      const held = p.value.full === undefined ? p.value.head.length + p.value.tail.length : p.value.full.length;
      if (held > limit) {
        p.value = view({ ...p.value, over: p.value.full === undefined }, limit);
        copied += limit * 2; // UTF-16 bytes copied, bounded by one 1.5M-character view at a time.
      }
      p.limit = limit;
      if (copied >= 4 * 1024 * 1024) { copied = 0; await pause(0); check(signal); }
    }
  }

  async function roots(signal) {
    const configured = await getRoots(), out = { codex: [], gemini: [] };
    for (const provider of ['codex', 'gemini']) {
      const seen = new Set();
      for (const home of (configured && configured[provider]) || []) {
        check(signal);
        if (typeof home !== 'string' || !path.isAbsolute(home)) continue;
        try {
          const resolvedHome = await fs.promises.realpath(home);
          if (broad(resolvedHome)) continue;
          // This explicit root may be a shared account-home junction; descendants may not be links.
          const root = await fs.promises.realpath(path.join(resolvedHome, provider === 'codex' ? 'sessions' : 'brain'));
          if (broad(root) || seen.has(keyPath(root)) || !(await fs.promises.stat(root)).isDirectory()) continue;
          seen.add(keyPath(root)); out[provider].push(root);
        } catch { /* not installed, inaccessible, or not used yet */ }
      }
    }
    return out;
  }

  async function locate(selected, signal) {
    const bases = await roots(signal), rootKey = JSON.stringify(bases), selectedKey = [...selected.values()].filter(s => s.provider === 'codex').map(s => s.id.toLowerCase()).sort().join(',');
    const files = new Map();
    if (catalogue && catalogue.rootKey === rootKey && catalogue.selectedKey === selectedKey && Date.now() - catalogue.at < 30000) {
      for (const [id, file] of catalogue.files) {
        check(signal);
        const raw = isCompressed(file) ? file.slice(0, -4) : file;
        let found = file;
        for (const candidate of [raw, raw + '.zst']) {
          try { const st = await fs.promises.lstat(candidate); if (st.isFile() && !st.isSymbolicLink()) { found = candidate; break; } } catch { /* it may just have been archived */ }
        }
        files.set(id, found);
      }
    } else {
      const ids = new Map([...selected.values()].filter(s => s.provider === 'codex').map(s => [s.id.toLowerCase(), s.id]));
      const found = new Map();
      let entries = 0;
      async function walk(dir, depth) {
        if (entries >= 100000 || depth > 6 || !ids.size) return;
        let listing;
        try { listing = await fs.promises.opendir(dir); } catch { return; }
        for await (const entry of listing) {
          check(signal);
          if (++entries > 100000) break;
          if (entries % 256 === 0) { await pause(0); check(signal); }
          const file = path.join(dir, entry.name);
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) { await walk(file, depth + 1); continue; }
          if (!entry.isFile()) continue;
          const m = entry.name.match(ROLLOUT), id = m && ids.get(m[1].toLowerCase());
          if (!id) continue;
          try {
            const st = await fs.promises.lstat(file), previous = found.get(id), compressed = isCompressed(file);
            if (st.isFile() && !st.isSymbolicLink() && (!previous || (previous.compressed && !compressed) ||
              (previous.compressed === compressed && st.mtimeMs > previous.mtimeMs))) found.set(id, { file, mtimeMs: st.mtimeMs, compressed });
          } catch { /* source disappeared during listing */ }
        }
      }
      for (const root of bases.codex) await walk(root, 0);
      for (const [id, x] of found) files.set(id, x.file);
      catalogue = { rootKey, selectedKey, at: Date.now(), files: new Map(files) };
    }
    for (const s of selected.values()) {
      if (s.provider !== 'gemini') continue;
      let best = null;
      for (const root of bases.gemini) {
        check(signal);
        let file = root;
        try {
          for (const part of [s.id, '.system_generated', 'logs']) {
            file = path.join(file, part);
            const st = await fs.promises.lstat(file);
            if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Not a transcript directory');
          }
          file = path.join(file, 'transcript.jsonl');
          const st = await fs.promises.lstat(file);
          if (st.isFile() && !st.isSymbolicLink() && (!best || st.mtimeMs > best.mtimeMs)) best = { file, mtimeMs: st.mtimeMs };
        } catch { /* only the selected, ordinary transcript paths are considered */ }
      }
      if (best) files.set(s.id, best.file);
    }
    return files;
  }

  async function index(s, file, signal) {
    check(signal);
    const st = await fs.promises.lstat(file);
    if (!st.isFile() || st.isSymbolicLink()) { published.delete(s.id); return; }
    const previous = published.get(s.id), limit = share(), compressed = isCompressed(file);
    const previousOK = previous && previous.file === file && previous.provider === s.provider && previous.identity === identity(st) &&
      (!compressed || same(previous, st)) && st.size >= previous.size && !(st.size === previous.size && st.mtimeMs !== previous.mtimeMs) && previous.witness === await witness(file, previous.offset);
    if (previous && !previousOK) published.delete(s.id);
    if (previousOK && same(previous, st) && previous.limit === limit) return;
    let x = await readCache(file, s.provider);
    if (x && (x.compressed !== compressed || (compressed && !same(x, st)) || x.identity !== identity(st) || st.size < x.size ||
      (st.size === x.size && st.mtimeMs !== x.mtimeMs) || x.witness !== await witness(file, x.offset))) x = null;
    if (x && same(x, st)) {
      check(signal);
      published.set(s.id, { file, provider: s.provider, ...stamp(st), offset: x.offset, witness: x.witness, limit, value: view(x, limit) });
      return;
    }
    if (!x) x = { offset: 0, compressed, skipping: false, over: false, full: '', head: '', tail: '' };
    const before = await witness(file, st.size), parts = [];
    let chars = 0;
    const flush = () => {
      if (!parts.length) return;
      const add = (x.full || x.tail ? '\n\n' : '') + parts.join('\n\n').replace(/\r/g, '');
      if (!x.over) {
        x.full += add;
        if (x.full.length > MAX) { x.head = slice(x.full, 0, HEAD); x.tail = slice(x.full, -TAIL); x.full = ''; x.over = true; }
      } else x.tail = slice(x.tail + add, -TAIL);
      parts.length = 0; chars = 0;
    };
    Object.assign(x, await lines(file, x, st.size, line => {
      const text = words(line, s.provider);
      if (!text) return;
      parts.push(text); chars += text.length;
      if (chars >= 65536) flush();
    }, signal));
    flush(); check(signal);
    const after = await fs.promises.lstat(file);
    if (!after.isFile() || after.isSymbolicLink() || identity(after) !== identity(st) || after.size < st.size || (compressed && !same(stamp(st), after)) ||
      (after.size === st.size && after.mtimeMs !== st.mtimeMs) || before !== await witness(file, st.size)) {
      published.delete(s.id); // a known rewrite also invalidates the previously published prefix
      throw new Error('Transcript changed while indexing');
    }
    Object.assign(x, stamp(st), { witness: await witness(file, x.offset) });
    check(signal);
    try { await writeCache(file, s.provider, x, signal); } catch (err) { if (signal.aborted) throw err; warn(err); }
    check(signal);
    published.set(s.id, { file, provider: s.provider, ...stamp(st), offset: x.offset, witness: x.witness, limit, value: view(x, limit) });
  }

  function start() {
    if (worker || stopped) return;
    worker = Promise.resolve().then(async () => {
      while (pending && !stopped) {
        pending = false;
        const selected = wanted, current = revision, runSignature = signature;
        controller = new AbortController();
        const signal = controller.signal;
        Object.assign(progress, { done: 0, total: selected.size, ready: false });
        try {
          // The old selection already fits the total budget. Shrink it cooperatively before
          // any new participant publishes, keeping request() cheap and the aggregate bounded.
          await shrinkViews(signal);
          const files = await locate(selected, signal);
          for (const s of selected.values()) {
            check(signal);
            try {
              const file = files.get(s.id);
              if (file) await index(s, file, signal); else published.delete(s.id);
            } catch (err) { if (signal.aborted) throw err; if (err.code === 'ENOENT') published.delete(s.id); warn(err); }
            if (current === revision) progress.done++;
          }
          await pruneCache(files, selected, signal);
          if (current === revision) { progress.ready = true; completedAt = Date.now(); completedSignature = runSignature; }
        } catch (err) { if (!signal.aborted) { warn(err); if (current === revision) { progress.done = progress.total; progress.ready = true; completedAt = Date.now(); completedSignature = runSignature; } } }
      }
    }).finally(() => { worker = null; controller = null; if (pending && !stopped) start(); });
  }

  function request(sessions) {
    if (stopped) return;
    const next = new Map();
    for (const s of sessions || []) {
      if (!s || !['codex', 'gemini'].includes(s.provider) || typeof s.id !== 'string' || !ID.test(s.id)) continue;
      const id = s.id.toLowerCase();
      if (!next.has(id)) next.set(id, { id, provider: s.provider, updated: s.updated });
    }
    const sig = JSON.stringify([...next.values()].sort((a, b) => `${a.provider}:${a.id}`.localeCompare(`${b.provider}:${b.id}`)));
    // HTTP asks for indexing and reads progress in the same request. Let subsequent polls see
    // the completed state instead of restarting an identical refresh before every response.
    const age = completedAt === null ? Infinity : Date.now() - completedAt;
    if (!worker && progress.ready && sig === completedSignature && age >= 0 && age < refreshWindow) return;
    if (worker && sig === signature) return;
    // A busy chat updates its timestamp while a large rollout is still being read. Queue its
    // fresh append, but do not repeatedly cancel the same cold scan before it can finish.
    if (worker && next.size === wanted.size && [...next.values()].every(s => wanted.get(s.id)?.provider === s.provider)) {
      wanted = next; signature = sig; pending = true;
      return;
    }
    wanted = next; signature = sig; revision++; pending = true;
    if (controller) controller.abort();
    for (const [id, p] of published) {
      if (!next.has(id) || next.get(id).provider !== p.provider) published.delete(id);
    }
    Object.assign(progress, { done: 0, total: next.size, ready: false });
    start();
  }
  const stop = () => { stopped = true; pending = false; if (controller) controller.abort(); };
  const idle = async () => { while (worker) await worker; };
  return { request, textOf: id => typeof id === 'string' ? published.get(id.toLowerCase())?.value || null : null, progress, stop, idle };
}

module.exports = { createAgentIndex };
