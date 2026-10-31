'use strict';
// Reads Claude Code's session files: a cached list of chats, previews of a chat's recent
// messages, a full-text search index, and the app's own chat names and launch history.

const fs = require('fs');
const path = require('path');
const store = require('./store');
const { ownText } = require('./shared');
const { createIndexCache, identity, witness } = require('./session-cache');

const HEAD = 256 * 1024;
const TAIL = 128 * 1024;
const ACTIVE_WINDOW_MS = 3 * 60 * 1000;
const ID_RE = /^[0-9a-zA-Z-]{8,64}$/;
const INDEX_MAX = 1500000, INDEX_HEAD = 300000, INDEX_TAIL = 1200000;
const INDEX_LINE_BYTES = 64 * 1024 * 1024;
// V8 can keep an entire large reply alive behind a short sliced string. A normal 64KB flush can
// retain its modest parent; copying the whole rolling tail on each one would triple indexing CPU.
// For larger parents copy the retained UTF-16 code units, preserving surrogate clipping boundaries.
const indexSlice = (text, start, end) => {
  const kept = text.slice(start, end);
  return text.length <= kept.length + 128 * 1024 ? kept : Buffer.from(kept, 'utf16le').toString('utf16le');
};

// ---------- reading entries ----------

function readChunks(file, size) {
  const fd = fs.openSync(file, 'r');
  try {
    if (size <= HEAD + TAIL) {
      const b = Buffer.alloc(size);
      fs.readSync(fd, b, 0, size, 0);
      return [b.toString('utf8')];
    }
    const h = Buffer.alloc(HEAD), t = Buffer.alloc(TAIL);
    fs.readSync(fd, h, 0, HEAD, 0);
    fs.readSync(fd, t, 0, TAIL, size - TAIL);
    return [h.toString('utf8'), t.toString('utf8')];
  } finally { fs.closeSync(fd); }
}

function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s[0] !== '{') continue;
    try { out.push(JSON.parse(s)); } catch { /* cut-off line at a chunk edge */ }
  }
  return out;
}

// Some apps put a <system-reminder> block in front of what you typed (the Claude desktop app does
// it on every message). It's for Claude, not part of your message, so it's left out here; a
// message that is nothing but reminders reads as empty.
const REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const withoutReminders = t => (t.includes('<system-reminder>') ? t.replace(REMINDER_RE, '').trim() : t);
function messageText(msg) {
  if (!msg) return '';
  const c = msg.content;
  if (typeof c === 'string') return withoutReminders(c);
  if (Array.isArray(c)) return c.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => withoutReminders(b.text)).filter(Boolean).join('\n');
  return '';
}

function isRealPrompt(e) {
  if (!e || e.type !== 'user' || e.isMeta || e.isSidechain || e.isCompactSummary) return false;
  const t = messageText(e.message).trim();
  if (!t) return false;
  if (/^<(command-|local-command|system-reminder|bash-|user-memory|task-notification)/.test(t)) return false;
  if (t.startsWith('Caveat:') || t.startsWith('This session is being continued from a previous conversation')) return false;
  return true;
}

const clip = (s, n) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const clipKeepLines = (s, n) => { s = String(s).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

const WINDOWS = process.platform === 'win32';
function readMeta(file, stat) {
  const chunks = readChunks(file, stat.size);
  const head = parseLines(chunks[0]);
  const all = chunks.length > 1 ? head.concat(parseLines(chunks[1])) : head;
  let cwd = null, firstPrompt = null, lastPrompt = null, customTitle = null, aiTitle = null, summary = null, branch = null, entrypoint = null;
  for (const e of head) {
    if (!cwd && typeof e.cwd === 'string') cwd = e.cwd;
    if (!firstPrompt && isRealPrompt(e)) firstPrompt = ownText(messageText(e.message));
    // How it was started: claude-desktop or cli for a person's chat, sdk-cli for a script (claude -p).
    if (!entrypoint && typeof e.entrypoint === 'string') entrypoint = e.entrypoint;
  }
  for (const e of all) {
    if (!cwd && typeof e.cwd === 'string') cwd = e.cwd;
    if (typeof e.customTitle === 'string') customTitle = e.customTitle;
    if (typeof e.aiTitle === 'string') aiTitle = e.aiTitle;
    if (e.type === 'summary' && typeof e.summary === 'string') summary = e.summary;
    if (typeof e.gitBranch === 'string' && e.gitBranch) branch = e.gitBranch;
    // (A "keep it working" check-in isn't something you asked.)
    if (isRealPrompt(e) && !/^From Session Switcher: /.test(ownText(messageText(e.message)))) lastPrompt = ownText(messageText(e.message));
  }
  // No words to go by in a small file: it's empty, or a stub. In a long one, they may only be out of
  // reach: its first message was a big picture or paste, or it opens with a summary of an earlier chat.
  // That's a real chat, and it must stay listed and reopenable.
  if (!cwd || (!firstPrompt && chunks.length < 2)) return null;
  const opening = firstPrompt || lastPrompt || '';
  return {
    id: path.basename(file, '.jsonl'),
    cwd,
    autoTitle: clip(customTitle || aiTitle || summary || opening.replace(/^From Commander:\s*/, '') || 'A long chat', 90), // a Commander-started chat is named for its task
    firstPrompt: clip(opening, 240),
    lastPrompt: lastPrompt && lastPrompt !== opening ? clip(lastPrompt, 240) : null,
    branch,
    entrypoint,
  };
}

// Reads complete lines from byte `start` to the end of the file, as they are now. Returns the byte
// offset just past the last complete line, so the next read can carry on from there. A single huge
// picture/tool record must not exhaust memory while building this disposable search index. Skip
// that record through its newline, keeping all surrounding complete messages and the original file.
async function readLinesFrom(file, start, onLine, { end, maxLineBytes = INDEX_LINE_BYTES } = {}) {
  let offset = start, position = start, parts = [], length = 0, oversized = false;
  const add = part => {
    if (oversized) return;
    length += part.length;
    if (length > maxLineBytes) { oversized = true; parts = []; return; }
    parts.push(part);
  };
  if (end !== undefined && end <= start) return offset;
  for await (const chunk of fs.createReadStream(file, { start, ...(end !== undefined ? { end: end - 1 } : {}) })) {
    let from = 0, nl;
    while ((nl = chunk.indexOf(10, from)) !== -1) {
      if (nl > from) add(chunk.subarray(from, nl));
      if (length && !oversized) onLine((parts.length === 1 ? parts[0] : Buffer.concat(parts, length)).toString('utf8'));
      offset = position + nl + 1;
      parts = []; length = 0; oversized = false; from = nl + 1;
    }
    if (from < chunk.length) add(chunk.subarray(from));
    position += chunk.length;
  }
  return offset;
}

// The last `bytes` of a file as complete lines (the first, partial line is dropped).
function tailLines(file, size, bytes) {
  const start = Math.max(0, size - bytes);
  const len = size - start;
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, len, start); } finally { fs.closeSync(fd); }
  const text = buf.toString('utf8');
  const lines = text.split('\n');
  if (start > 0) lines.shift();
  return lines;
}

// ---------- the store ----------

function createSessionStore({ root, dataDir, log = () => {} }) {
  const cache = createIndexCache(dataDir, root);
  const meta = new Map();   // file -> { mtimeMs, size, value }
  // file -> { mtimeMs, size, offset, text, stats }: built once, then extended with whatever was
  // appended since (transcripts only grow), so a long chat that keeps working costs almost nothing.
  const index = new Map();
  const indexingFile = new Map();
  let memo = null;          // the last scan, reused for a moment (it's asked for many times a second)
  const byId = new Map();   // session id -> file
  const namesFile = path.join(dataDir, 'chat-names.json');
  const historyFile = path.join(dataDir, 'history.json');
  let names = store.loadOwnJson(namesFile, {}, log) || {};
  let history = store.loadOwnJson(historyFile, {}, log) || {};
  let indexing = null, indexAgain = false;
  const progress = { done: 0, total: 0, ready: false };

  function listFiles() {
    const out = [];
    let dirs = [];
    try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { return out; }
    for (const d of dirs) {
      const dir = path.join(root, d.name);
      let files = [];
      try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')); } catch { continue; }
      for (const f of files) {
        const file = path.join(dir, f);
        const st = store.statOrNull(file);
        if (st && st.isFile()) out.push({ file, dir, stat: st });
      }
    }
    return out;
  }

  const dirFacts = new Map();   // project folder -> { at, exists, notes }
  function scan({ fresh = false } = {}) {
    if (!fresh && memo && Date.now() - memo.at < 3000) return memo.value;
    const files = listFiles();
    // After the first full read, a pass reads at most this many changed chats (a burst of changes
    // never holds the app up); the rest are read on the next pass, a moment later.
    const first = !meta.size;
    let budget = first ? Infinity : 80, more = false;
    const seen = new Set();
    const byCwd = new Map();
    let skipped = 0;
    const now = Date.now();
    for (const { file, dir, stat } of files) {
      seen.add(file);
      let m = meta.get(file);
      const changed = !m || m.identity !== identity(stat) || m.mtimeMs !== stat.mtimeMs || m.size !== stat.size;
      if (changed && budget <= 0) more = true;
      else if (changed) {
        budget--;
        let value = null;
        try { value = readMeta(file, stat); } catch { value = null; }
        m = { mtimeMs: stat.mtimeMs, size: stat.size, identity: identity(stat), value };
        meta.set(file, m);
      }
      if (!m || !m.value) { skipped++; continue; }
      const v = m.value;
      byId.set(v.id.toLowerCase(), file);
      // Windows can write one folder more than one way (C:\\x, C:/x, c:\\x), depending on what started the chat. It's one project.
      if (WINDOWS && v.cwd.includes('/')) v.cwd = v.cwd.replace(/\//g, '\\');
      const where = WINDOWS ? v.cwd.replace(/\\+$/, '').toLowerCase() : v.cwd;
      if (!byCwd.has(where)) {
        // Whether the folder exists and its notes: looked at every half minute, not on every pass.
        let d = dirFacts.get(v.cwd);
        if (!d || now - d.at > 30000) {
          let notes = 0;
          try { notes = fs.readdirSync(path.join(dir, 'memory')).length; } catch { /* none */ }
          d = { at: now, notes, exists: fs.existsSync(v.cwd), memory: path.join(dir, 'memory') };
          dirFacts.set(v.cwd, d);
        }
        byCwd.set(where, { cwd: v.cwd, name: path.basename(v.cwd.replace(/[\\/]+$/, '')) || v.cwd, exists: d.exists, notes: d.notes, sessions: [] });
      }
      const h = history[v.id] || null;
      byCwd.get(where).sessions.push({
        ...v,
        title: names[v.id] || v.autoTitle,
        renamed: !!names[v.id],
        updated: stat.mtimeMs,
        active: now - stat.mtimeMs < ACTIVE_WINDOW_MS,
        sizeKB: Math.round(stat.size / 1024),
        lastOpened: h,
      });
    }
    for (const f of [...meta.keys()]) if (!seen.has(f)) { meta.delete(f); index.delete(f); }
    for (const [id, f] of byId) if (!seen.has(f)) byId.delete(id);
    if (more) setImmediate(() => { memo = null; });   // the rest on the next pass
    const projects = [...byCwd.values()];
    for (const p of projects) {
      p.sessions.sort((a, b) => b.updated - a.updated);
      p.updated = p.sessions[0].updated;
    }
    projects.sort((a, b) => b.updated - a.updated);
    const value = { projects, skipped, root };
    const map = new Map();
    for (const p of projects) for (const x of p.sessions) map.set(x.id.toLowerCase(), { project: p, session: x });
    memo = { at: Date.now(), value, map };
    return value;
  }
  const invalidate = () => { memo = null; };

  function fileFor(id) {
    if (!ID_RE.test(String(id || ''))) throw Object.assign(new Error('That isn’t a valid chat id.'), { status: 400 });
    let f = byId.get(String(id).toLowerCase());
    if (!f || !fs.existsSync(f)) { scan({ fresh: true }); f = byId.get(String(id).toLowerCase()); }
    if (!f) throw Object.assign(new Error('That chat wasn’t found. It may have been deleted; refresh the list.'), { status: 404 });
    return f;
  }

  function find(id) {
    const file = fileFor(id);
    const want = String(id).toLowerCase();
    scan();
    let hit = memo && memo.map.get(want);
    if (!hit) { scan({ fresh: true }); hit = memo.map.get(want); }
    if (hit) return { project: hit.project, session: hit.session, file };
    throw Object.assign(new Error('That chat wasn’t found. Refresh the list.'), { status: 404 });
  }

  // Counts and models come from the index (kept up to date incrementally); the recent messages
  // come from the end of the file, so even a very long chat previews instantly.
  async function preview(id) {
    const { project, session, file } = find(id);
    const st = fs.statSync(file);
    const ix = await indexFile(file, st);
    const msgs = [];
    for (const line of tailLines(file, st.size, 3 * 1024 * 1024)) {
      if (!line || line[0] !== '{') continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.isSidechain) continue;
      if (isRealPrompt(e)) msgs.push({ role: 'you', text: clipKeepLines(messageText(e.message), 900), at: e.timestamp || null });
      else if (e.type === 'assistant' && e.message) {
        const m = e.message, t = messageText(m).trim();
        if (!t) continue;
        const prev = msgs[msgs.length - 1];
        if (prev && prev.role === 'claude' && prev.mid && prev.mid === m.id) prev.text = clipKeepLines(prev.text + '\n' + t, 900);
        else msgs.push({ role: 'claude', text: clipKeepLines(t, 900), at: e.timestamp || null, mid: m.id });
      }
      if (msgs.length > 40) msgs.splice(0, msgs.length - 30);
    }
    const x = ix.stats;
    return {
      session: { ...session, folder: project.name, folderExists: project.exists },
      file,
      stats: { prompts: x.prompts, replies: x.replies, tools: x.tools, first: x.first, last: x.last, version: x.version, models: x.models.slice(-3) },
      messages: msgs.slice(-14).map(({ mid, ...rest }) => rest),
    };
  }

  // ---------- full-text index ----------

  // Reads only what was appended since the last time (or the whole file the first time, or if
  // it shrank). One file is never indexed twice at once.
  function indexFile(file, stat) {
    const busy = indexingFile.get(file);
    if (busy) return busy;
    const job = (async () => {
      let x = index.get(file);
      if (x && x.identity === identity(stat) && x.mtimeMs === stat.mtimeMs && x.size === stat.size) return x;
      if (!x) x = await cache.read(file);
      if (x && (x.identity !== identity(stat) || stat.size < x.size || (stat.size === x.size && stat.mtimeMs !== x.mtimeMs) || x.witness !== await witness(file, x.offset))) x = null;
      if (x && x.mtimeMs === stat.mtimeMs && x.size === stat.size) { index.set(file, x); return x; }
      // Build an append separately from the published index. If a cloud/file read fails after a
      // complete message, retry must not count it twice or leave half an update visible to search.
      if (x) x = { ...x, times: [...(x.times || [])], stats: { ...x.stats, models: [...x.stats.models] } };
      else x = { offset: 0, full: '', head: '', tail: '', over: false, lastMid: null, times: [], stats: { prompts: 0, replies: 0, tools: 0, first: null, last: null, version: null, models: [] } };
      const parts = [], st = x.stats;
      let partSize = 0;
      const flushText = () => {
        if (!parts.length) return;
        const add = (x.full || x.tail ? '\n\n' : '') + parts.join('\n\n').replace(/\r/g, '');
        if (!x.over) {
          x.full += add;
          if (x.full.length > INDEX_MAX) { x.head = indexSlice(x.full, 0, INDEX_HEAD); x.tail = indexSlice(x.full, -INDEX_TAIL); x.full = ''; x.over = true; }
        } else x.tail = indexSlice(x.tail + add, -INDEX_TAIL);
        parts.length = 0; partSize = 0;
      };
      const append = text => { parts.push(text); partSize += text.length; if (partSize >= 65536) flushText(); };
      if (!x.times) x.times = [];
      // When each message and reply happened (the last few days of them), for the hub's day at a glance.
      const noteTime = ts => { const t = Date.parse(ts); if (t && t > Date.now() - 3 * 864e5) x.times.push(t); };
      x.offset = await readLinesFrom(file, x.offset, line => {
        if (line[0] !== '{' || (!line.includes('"user"') && !line.includes('"assistant"'))) return;
        let e; try { e = JSON.parse(line); } catch { return; }
        if (e.timestamp) { if (!st.first) st.first = e.timestamp; st.last = e.timestamp; }
        if (e.version) st.version = e.version;
        if (e.isSidechain) return;
        if (isRealPrompt(e)) { st.prompts++; noteTime(e.timestamp); append(`You: ${messageText(e.message)}`); return; }
        if (e.type !== 'assistant' || !e.message) return;
        const m = e.message;
        if (m.model && !/synthetic/i.test(m.model) && st.models[st.models.length - 1] !== m.model) { st.models = st.models.filter(v => v !== m.model).concat(m.model).slice(-5); }
        if (Array.isArray(m.content)) st.tools += m.content.filter(b => b && b.type === 'tool_use').length;
        const t = messageText(m).trim();
        if (!t) return;
        if (m.id !== x.lastMid) { st.replies++; x.lastMid = m.id; noteTime(e.timestamp); }
        append(`Claude: ${t}`);
      }, { end: stat.size });
      flushText();
      if (x.times.length > 1500) x.times = x.times.filter(t => t > Date.now() - 3 * 864e5).slice(-1500);
      x.mtimeMs = stat.mtimeMs; x.size = stat.size;
      x.identity = identity(stat); x.witness = await witness(file, x.offset);
      index.set(file, x);
      try { await cache.write(file, x); } catch (err) { log(`Couldn’t cache the index of ${path.basename(file)}: ${err.message}`); }
      return x;
    })().finally(() => indexingFile.delete(file));
    indexingFile.set(file, job);
    return job;
  }

  function refreshIndex() {
    if (indexing) { indexAgain = true; return indexing; }
    indexing = (async () => {
      do {
        indexAgain = false;
        const files = listFiles();
        const present = new Set(files.map(f => f.file));
        for (const file of index.keys()) if (!present.has(file)) index.delete(file);
        const stale = files.filter(({ file, stat }) => { const x = index.get(file); return !x || x.identity !== identity(stat) || x.mtimeMs !== stat.mtimeMs || x.size !== stat.size; });
        progress.total = files.length;
        progress.done = files.length - stale.length;
        for (const { file, stat } of stale) {
          try { await indexFile(file, stat); } catch (err) { log(`Couldn’t index ${path.basename(file)}: ${err.message}`); }
          progress.done++;
          await new Promise(r => setImmediate(r));
        }
        await cache.prune(files.map(f => f.file));
        progress.ready = true;
      } while (indexAgain);
    })().finally(() => { indexing = null; });
    return indexing;
  }

  // Each chat's messages and replies since a moment (ms): [{ id, times }], for the day at a glance.
  function activity(since) {
    const out = [];
    for (const [file, x] of index) {
      if (!x.times || !x.times.length || x.times[x.times.length - 1] < since) continue;
      const times = x.times.filter(t => t >= since);
      if (times.length) out.push({ id: path.basename(file, '.jsonl'), times });
    }
    return out;
  }

  function* searchMatches(q) {
    const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    if (!terms.length) return;
    const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const res = terms.map(t => new RegExp(esc(t), 'i')), resG = terms.map(t => new RegExp(esc(t), 'gi'));
    const { projects } = scan();
    for (const p of projects) {
      for (const s of p.sessions) {
        const file = byId.get(s.id.toLowerCase());
        const ix = file && index.get(file);
        const metaText = `${s.title} ${s.autoTitle} ${s.firstPrompt} ${s.lastPrompt || ''} ${p.name} ${s.branch || ''}`.toLowerCase();
        // Matched without lowering the whole text (it can be megabytes per chat, on every search).
        const spans = ix ? ix.over ? [ix.head, ix.tail] : [ix.full] : [''];
        if (!terms.every((t, k) => metaText.includes(t) || spans.some(text => res[k].test(text)))) { yield null; continue; }
        let count = 0, pos = Infinity;
        let text = '';
        for (const span of spans) {
          let first = Infinity;
          for (const re of resG) { re.lastIndex = 0; let m; while (count < 999 && (m = re.exec(span))) { count++; if (m.index < first) first = m.index; } }
          if (pos === Infinity && first !== Infinity) { pos = first; text = span; }
        }
        let snippet = '';
        if (pos !== Infinity) {
          let a = Math.max(0, pos - 90);
          if (a > 0) { const sp = text.indexOf(' ', a); if (sp !== -1 && sp < pos) a = sp + 1; }
          let b = Math.min(text.length, pos + 160);
          if (b < text.length) { const sp = text.lastIndexOf(' ', b); if (sp > pos + 40) b = sp; }
          snippet = (a > 0 ? '…' : '') + text.slice(a, b).replace(/\s+/g, ' ').trim() + (b < text.length ? '…' : '');
        }
        yield { id: s.id, folder: p.name, cwd: p.cwd, count, snippet, inTitle: terms.every(t => metaText.includes(t)) };
      }
    }
  }
  function searchResult(hits, limit) {
    hits.sort((x, y) => (y.inTitle - x.inTitle) || (y.count - x.count));
    return { hits: hits.slice(0, limit), progress };
  }
  function search(q, limit = 60) { return searchResult([...searchMatches(q)].filter(Boolean), limit); }
  async function searchAsync(q, limit = 60, { signal } = {}) {
    const cancelled = () => { if (signal && signal.aborted) throw signal.reason || new Error('Search cancelled.'); };
    cancelled();
    await new Promise(resolve => setImmediate(resolve));
    const hits = []; let yielded = Date.now();
    for (const hit of searchMatches(q)) {
      cancelled();
      if (hit) hits.push(hit);
      if (Date.now() - yielded >= 8) { await new Promise(resolve => setImmediate(resolve)); yielded = Date.now(); }
    }
    cancelled();
    return searchResult(hits, limit);
  }

  // ---------- names and history ----------

  function rename(id, name) {
    const { session } = find(id);
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (clean && clean !== session.autoTitle) names[session.id] = clean; else delete names[session.id];
    store.writeJsonAtomic(namesFile, names);
    invalidate();
    return names[session.id] || session.autoTitle;
  }

  // A chat's name from the start, unless you've named it already: a copy, as "<original> (copy)", so it
  // can't be mistaken for the chat it was copied from. (It needn't be listed yet: it's only just begun.)
  function nameIfUnnamed(id, name) {
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!id || !clean || names[id]) return;
    names[id] = clean;
    store.writeJsonAtomic(namesFile, names);
    invalidate();
  }

  function recordLaunch(id, account, mode) {
    history[id] = { account: account.id, accountName: account.name, at: Date.now(), mode };
    invalidate();
    const keys = Object.keys(history);
    if (keys.length > 2000) for (const k of keys.sort((a, b) => history[a].at - history[b].at).slice(0, keys.length - 2000)) delete history[k];
    try { store.writeJsonAtomic(historyFile, history); } catch (err) { log(`Couldn’t save history: ${err.message}`); }
  }

  const lastOpened = id => history[id] || null;

  // Where Claude keeps its notes on a project (it's beside the project's conversations).
  const memoryDir = cwd => { const d = dirFacts.get(cwd); return d ? d.memory : null; };
  return { scan, find, fileFor, preview, refreshIndex, search, searchAsync, activity, rename, nameIfUnnamed, recordLaunch, lastOpened, progress, root, invalidate, memoryDir };
}

module.exports = { createSessionStore, readMeta, isRealPrompt, messageText, readLinesFrom, ID_RE };
