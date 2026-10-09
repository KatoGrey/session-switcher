'use strict';
// Reads Claude Code's session files: a cached list of chats, previews of a chat's recent
// messages, a full-text search index, and the app's own chat names and launch history.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const store = require('./store');

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
    if (!firstPrompt && isRealPrompt(e)) firstPrompt = messageText(e.message);
  }
  for (const e of all) {
    if (!cwd && typeof e.cwd === 'string') cwd = e.cwd;
    if (typeof e.customTitle === 'string') customTitle = e.customTitle;
    if (typeof e.aiTitle === 'string') aiTitle = e.aiTitle;
    if (e.type === 'summary' && typeof e.summary === 'string') summary = e.summary;
    if (typeof e.gitBranch === 'string' && e.gitBranch) branch = e.gitBranch;
    if (isRealPrompt(e)) lastPrompt = messageText(e.message);
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

// ---------- the store ----------

function createSessionStore({ root, dataDir, log = () => {} }) {
  const meta = new Map();   // file -> { mtimeMs, size, value }
  const index = new Map();  // file -> { mtimeMs, size, text, lower }
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

  function scan() {
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
    return { projects, skipped, root };
  }

  function fileFor(id) {
    if (!ID_RE.test(String(id || ''))) throw Object.assign(new Error('That isn’t a valid chat id.'), { status: 400 });
    let f = byId.get(String(id).toLowerCase());
    if (!f || !fs.existsSync(f)) { scan(); f = byId.get(String(id).toLowerCase()); }
    if (!f) throw Object.assign(new Error('That chat wasn’t found. It may have been deleted; refresh the list.'), { status: 404 });
    return f;
  }

  function find(id) {
    const file = fileFor(id);
    const { projects } = scan();
    for (const p of projects) {
      const s = p.sessions.find(x => x.id.toLowerCase() === String(id).toLowerCase());
      if (s) return { project: p, session: s, file };
    }
    throw Object.assign(new Error('That chat wasn’t found. Refresh the list.'), { status: 404 });
  }

  // Streams the whole file: counts, models, branch, and the most recent messages.
  async function preview(id) {
    const { project, session, file } = find(id);
    const msgs = [];
    let prompts = 0, replies = 0, tools = 0, first = null, last = null, version = null;
    const models = new Set();
    const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line || line[0] !== '{') continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.timestamp) { if (!first) first = e.timestamp; last = e.timestamp; }
      if (e.version) version = e.version;
      if (e.isSidechain) continue;
      if (isRealPrompt(e)) {
        prompts++;
        msgs.push({ role: 'you', text: clipKeepLines(messageText(e.message), 900), at: e.timestamp || null });
      } else if (e.type === 'assistant' && e.message) {
        const m = e.message;
        if (m.model && !/synthetic/i.test(m.model)) models.add(m.model);
        if (Array.isArray(m.content)) tools += m.content.filter(b => b && b.type === 'tool_use').length;
        const t = messageText(m).trim();
        if (!t) continue;
        const prev = msgs[msgs.length - 1];
        if (prev && prev.role === 'claude' && prev.mid && prev.mid === m.id) prev.text = clipKeepLines(prev.text + '\n' + t, 900);
        else { replies++; msgs.push({ role: 'claude', text: clipKeepLines(t, 900), at: e.timestamp || null, mid: m.id }); }
      }
      if (msgs.length > 40) msgs.splice(0, msgs.length - 30);
    }
    return {
      session: { ...session, folder: project.name, folderExists: project.exists },
      file,
      stats: { prompts, replies, tools, first, last, version, models: [...models].slice(-3) },
      messages: msgs.slice(-14).map(({ mid, ...rest }) => rest),
    };
  }

  // ---------- full-text index ----------

  async function indexFile(file, stat) {
    const parts = [];
    const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line || line[0] !== '{') continue;
      if (!line.includes('"user"') && !line.includes('"assistant"')) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.isSidechain) continue;
      if (isRealPrompt(e)) parts.push(`You: ${messageText(e.message)}`);
      else if (e.type === 'assistant' && e.message) { const t = messageText(e.message).trim(); if (t) parts.push(`Claude: ${t}`); }
    }
    let text = parts.join('\n\n').replace(/\r/g, '');
    if (text.length > INDEX_MAX) text = text.slice(0, INDEX_HEAD) + '\n…\n' + text.slice(-INDEX_TAIL);
    index.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, text, lower: text.toLowerCase() });
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
        const body = ix ? ix.lower : '';
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
    return names[session.id] || session.autoTitle;
  }

  function recordLaunch(id, account, mode) {
    history[id] = { account: account.id, accountName: account.name, at: Date.now(), mode };
    const keys = Object.keys(history);
    if (keys.length > 2000) for (const k of keys.sort((a, b) => history[a].at - history[b].at).slice(0, keys.length - 2000)) delete history[k];
    try { store.writeJsonAtomic(historyFile, history); } catch (err) { log(`Couldn’t save history: ${err.message}`); }
  }

  const lastOpened = id => history[id] || null;

  return { scan, find, fileFor, preview, refreshIndex, search, rename, recordLaunch, lastOpened, progress, root };
}

module.exports = { createSessionStore, readMeta, isRealPrompt, messageText, ID_RE };
