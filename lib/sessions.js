'use strict';
// Reads Claude Code's session files: a cached list of chats, previews of a chat's recent
// messages, a full-text search index, and the app's own chat names and launch history.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const store = require('./store');
const { ownText } = require('./shared');

const HEAD = 256 * 1024;
const TAIL = 128 * 1024;
const ACTIVE_WINDOW_MS = 3 * 60 * 1000;
const ID_RE = /^[0-9a-zA-Z-]{8,64}$/;
const INDEX_MAX = 1500000, INDEX_HEAD = 300000, INDEX_TAIL = 1200000;

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

function messageText(msg) {
  if (!msg) return '';
  const c = msg.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n');
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

function readMeta(file, stat) {
  const chunks = readChunks(file, stat.size);
  const head = parseLines(chunks[0]);
  const all = chunks.length > 1 ? head.concat(parseLines(chunks[1])) : head;
  let cwd = null, firstPrompt = null, lastPrompt = null, customTitle = null, aiTitle = null, summary = null, branch = null;
  for (const e of head) {
    if (!cwd && typeof e.cwd === 'string') cwd = e.cwd;
    if (!firstPrompt && isRealPrompt(e)) firstPrompt = ownText(messageText(e.message));
  }
  for (const e of all) {
    if (!cwd && typeof e.cwd === 'string') cwd = e.cwd;
    if (typeof e.customTitle === 'string') customTitle = e.customTitle;
    if (typeof e.aiTitle === 'string') aiTitle = e.aiTitle;
    if (e.type === 'summary' && typeof e.summary === 'string') summary = e.summary;
    if (typeof e.gitBranch === 'string' && e.gitBranch) branch = e.gitBranch;
    if (isRealPrompt(e)) lastPrompt = ownText(messageText(e.message));
  }
  if (!cwd || !firstPrompt) return null; // empty or stub file
  return {
    id: path.basename(file, '.jsonl'),
    cwd,
    autoTitle: clip(customTitle || aiTitle || summary || firstPrompt, 90),
    firstPrompt: clip(firstPrompt, 240),
    lastPrompt: lastPrompt && lastPrompt !== firstPrompt ? clip(lastPrompt, 240) : null,
    branch,
  };
}

// Reads complete lines from byte `start` to the end of the file, as they are now. Returns the byte
// offset just past the last complete line, so the next read can carry on from there.
async function readLinesFrom(file, start, onLine) {
  let offset = start, rest = null;
  for await (const chunk of fs.createReadStream(file, { start })) {
    const buf = rest ? Buffer.concat([rest, chunk]) : chunk;
    let from = 0, nl;
    while ((nl = buf.indexOf(10, from)) !== -1) {
      if (nl > from) onLine(buf.toString('utf8', from, nl));
      offset += nl + 1 - from;
      from = nl + 1;
    }
    rest = from < buf.length ? buf.subarray(from) : null;
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

  function scan({ fresh = false } = {}) {
    if (!fresh && memo && Date.now() - memo.at < 1500) return memo.value;
    const files = listFiles();
    const seen = new Set();
    const byCwd = new Map();
    let skipped = 0;
    const now = Date.now();
    for (const { file, dir, stat } of files) {
      seen.add(file);
      let m = meta.get(file);
      if (!m || m.mtimeMs !== stat.mtimeMs || m.size !== stat.size) {
        let value = null;
        try { value = readMeta(file, stat); } catch { value = null; }
        m = { mtimeMs: stat.mtimeMs, size: stat.size, value };
        meta.set(file, m);
      }
      if (!m.value) { skipped++; continue; }
      const v = m.value;
      byId.set(v.id.toLowerCase(), file);
      if (!byCwd.has(v.cwd)) {
        let notes = 0;
        try { notes = fs.readdirSync(path.join(dir, 'memory')).length; } catch { /* none */ }
        byCwd.set(v.cwd, { cwd: v.cwd, name: path.basename(v.cwd.replace(/[\\/]+$/, '')) || v.cwd, exists: fs.existsSync(v.cwd), notes, sessions: [] });
      }
      const h = history[v.id] || null;
      byCwd.get(v.cwd).sessions.push({
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
      if (x && x.mtimeMs === stat.mtimeMs && x.size === stat.size) return x;
      if (!x || stat.size < x.offset) x = { offset: 0, full: '', head: '', tail: '', over: false, lastMid: null, stats: { prompts: 0, replies: 0, tools: 0, first: null, last: null, version: null, models: [] } };
      const parts = [], st = x.stats;
      x.offset = await readLinesFrom(file, x.offset, line => {
        if (line[0] !== '{' || (!line.includes('"user"') && !line.includes('"assistant"'))) return;
        let e; try { e = JSON.parse(line); } catch { return; }
        if (e.timestamp) { if (!st.first) st.first = e.timestamp; st.last = e.timestamp; }
        if (e.version) st.version = e.version;
        if (e.isSidechain) return;
        if (isRealPrompt(e)) { st.prompts++; parts.push(`You: ${messageText(e.message)}`); return; }
        if (e.type !== 'assistant' || !e.message) return;
        const m = e.message;
        if (m.model && !/synthetic/i.test(m.model) && st.models[st.models.length - 1] !== m.model) { st.models = st.models.filter(v => v !== m.model).concat(m.model).slice(-5); }
        if (Array.isArray(m.content)) st.tools += m.content.filter(b => b && b.type === 'tool_use').length;
        const t = messageText(m).trim();
        if (!t) return;
        if (m.id !== x.lastMid) { st.replies++; x.lastMid = m.id; }
        parts.push(`Claude: ${t}`);
      });
      if (parts.length) {
        const add = (x.full || x.tail ? '\n\n' : '') + parts.join('\n\n').replace(/\r/g, '');
        // Very long chats keep their beginning and their most recent part searchable.
        if (!x.over) {
          x.full += add;
          if (x.full.length > INDEX_MAX) { x.head = x.full.slice(0, INDEX_HEAD); x.tail = x.full.slice(-INDEX_TAIL); x.full = ''; x.over = true; }
        } else x.tail = (x.tail + add).slice(-INDEX_TAIL);
      }
      x.text = x.over ? `${x.head}\n…\n${x.tail}` : x.full;
      x.mtimeMs = stat.mtimeMs; x.size = stat.size;
      index.set(file, x);
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
        const stale = files.filter(({ file, stat }) => { const x = index.get(file); return !x || x.mtimeMs !== stat.mtimeMs || x.size !== stat.size; });
        progress.total = files.length;
        progress.done = files.length - stale.length;
        for (const { file, stat } of stale) {
          try { await indexFile(file, stat); } catch (err) { log(`Couldn’t index ${path.basename(file)}: ${err.message}`); }
          progress.done++;
          await new Promise(r => setImmediate(r));
        }
        progress.ready = true;
      } while (indexAgain);
    })().finally(() => { indexing = null; });
    return indexing;
  }

  function search(q, limit = 60) {
    const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    if (!terms.length) return { hits: [], progress };
    const { projects } = scan();
    const hits = [];
    for (const p of projects) {
      for (const s of p.sessions) {
        const file = byId.get(s.id.toLowerCase());
        const ix = file && index.get(file);
        const metaText = `${s.title} ${s.autoTitle} ${s.firstPrompt} ${s.lastPrompt || ''} ${p.name} ${s.branch || ''}`.toLowerCase();
        const body = ix ? ix.text.toLowerCase() : '';
        if (!terms.every(t => metaText.includes(t) || body.includes(t))) continue;
        let count = 0;
        for (const t of terms) { let i = -1; while ((i = body.indexOf(t, i + 1)) !== -1 && count < 999) count++; }
        let snippet = '';
        const pos = body ? Math.min(...terms.map(t => { const i = body.indexOf(t); return i < 0 ? Infinity : i; })) : Infinity;
        if (pos !== Infinity) {
          let a = Math.max(0, pos - 90);
          if (a > 0) { const sp = ix.text.indexOf(' ', a); if (sp !== -1 && sp < pos) a = sp + 1; }
          let b = Math.min(ix.text.length, pos + 160);
          if (b < ix.text.length) { const sp = ix.text.lastIndexOf(' ', b); if (sp > pos + 40) b = sp; }
          snippet = (a > 0 ? '…' : '') + ix.text.slice(a, b).replace(/\s+/g, ' ').trim() + (b < ix.text.length ? '…' : '');
        }
        hits.push({ id: s.id, folder: p.name, cwd: p.cwd, count, snippet, inTitle: terms.every(t => metaText.includes(t)) });
      }
    }
    hits.sort((x, y) => (y.inTitle - x.inTitle) || (y.count - x.count));
    return { hits: hits.slice(0, limit), progress };
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

  function recordLaunch(id, account, mode) {
    history[id] = { account: account.id, accountName: account.name, at: Date.now(), mode };
    invalidate();
    const keys = Object.keys(history);
    if (keys.length > 2000) for (const k of keys.sort((a, b) => history[a].at - history[b].at).slice(0, keys.length - 2000)) delete history[k];
    try { store.writeJsonAtomic(historyFile, history); } catch (err) { log(`Couldn’t save history: ${err.message}`); }
  }

  const lastOpened = id => history[id] || null;

  return { scan, find, fileFor, preview, refreshIndex, search, rename, recordLaunch, lastOpened, progress, root, invalidate };
}

module.exports = { createSessionStore, readMeta, isRealPrompt, messageText, readLinesFrom, ID_RE };
