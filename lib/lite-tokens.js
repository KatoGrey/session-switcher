'use strict';
/* Tokens: how many you've used, day by day and chat by chat, read from the chats' own records
   (Claude Code's transcripts and Codex's session files), so it counts every chat wherever it ran:
   here, in the desktop app or in a terminal.

   The records are large (gigabytes), so they're read by a separate, low-priority process: once in
   full, then only what each file has gained since. What it keeps is small: for each file, its
   chat, folder and a total per day. Lite adds those up by day, project and chat.

   Counting: Claude Code writes one reply over several lines that repeat its usage (the last has
   the final count), so each reply counts once, at its last figures. Codex records a running total
   for the conversation; what counts is how much it grew. "Tokens" are everything the model read
   and wrote: new input, input read back from its cache, input written to the cache, and output. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const LEDGER_V = 1;
const CHUNK = 8 * 1024 * 1024;

// The day a moment falls on, in this computer's time zone (YYYY-MM-DD).
function dayOf(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const add = (rec, day, v) => { const x = rec.days[day] || (rec.days[day] = [0, 0, 0, 0]); for (let i = 0; i < 4; i++) x[i] += v[i]; };

// One line of a Claude Code transcript. v = [new input, cache read, cache write, output].
function claudeLine(rec, line) {
  if (line.indexOf('"usage"') < 0 || line.indexOf('"assistant"') < 0) return;
  let e; try { e = JSON.parse(line); } catch { return; }
  const m = e && e.type === 'assistant' && e.message;
  const u = m && m.usage;
  if (!u || m.model === '<synthetic>') return;
  const day = dayOf(e.timestamp); if (!day) return;
  if (!rec.sid && e.sessionId) rec.sid = e.sessionId;
  if (!rec.cwd && e.cwd) rec.cwd = e.cwd;
  const v = [u.input_tokens || 0, u.cache_read_input_tokens || 0, u.cache_creation_input_tokens || 0, u.output_tokens || 0];
  // The same reply again (another of its lines): only what grew since its last line counts.
  if (m.id && m.id === rec.lastId && rec.lastDay) {
    const d = v.map((x, i) => Math.max(0, x - (rec.lastU[i] || 0)));
    add(rec, rec.lastDay, d);
    rec.lastU = v.map((x, i) => Math.max(x, rec.lastU[i] || 0));
    return;
  }
  add(rec, day, v);
  rec.lastId = m.id || null; rec.lastU = v; rec.lastDay = day;
}
// One line of a Codex session file.
function codexLine(rec, line) {
  if (line.indexOf('"session_meta"') >= 0) {
    let e; try { e = JSON.parse(line); } catch { return; }
    const p = e && e.payload;
    if (p && p.id && !rec.sid) rec.sid = p.id;
    if (p && p.cwd && !rec.cwd) rec.cwd = p.cwd;
    return;
  }
  if (line.indexOf('"token_count"') < 0) return;
  let e; try { e = JSON.parse(line); } catch { return; }
  const t = e && e.payload && e.payload.info && e.payload.info.total_token_usage;
  if (!t) return;
  const day = dayOf(e.timestamp); if (!day) return;
  // Codex's input includes what it read from its cache; split so the four parts match Claude's.
  const cached = t.cached_input_tokens || 0;
  const now = [Math.max(0, (t.input_tokens || 0) - cached), cached, t.cache_write_input_tokens || 0, t.output_tokens || 0];
  const prev = rec.prev || [0, 0, 0, 0];
  // A smaller total than before means a new count started (a fork, say): it counts from zero.
  const restarted = now.some((x, i) => x < prev[i]);
  add(rec, day, now.map((x, i) => (restarted ? x : x - prev[i])));
  rec.prev = now;
}

// Reads what a file has gained since last time. Returns false if it had to be read from the start.
function readFile(rec, file, st) {
  const fresh = !rec.size || st.size < (rec.off || 0) || (rec.ino && rec.ino !== st.ino);
  if (fresh) Object.assign(rec, { off: 0, days: {}, lastId: null, lastU: null, lastDay: null, prev: null });
  rec.ino = st.ino;
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(CHUNK);
    let pos = rec.off || 0, carry = '';
    const handle = rec.kind === 'codex' ? codexLine : claudeLine;
    while (pos < st.size) {
      const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, st.size - pos), pos);
      if (!n) break;
      pos += n;
      const text = carry + buf.toString('utf8', 0, n);
      const lines = text.split('\n');
      carry = lines.pop();
      for (const l of lines) if (l) handle(rec, l);
    }
    // An unfinished last line is read again next time.
    rec.off = pos - Buffer.byteLength(carry);
  } finally { fs.closeSync(fd); }
  rec.size = st.size; rec.mtime = st.mtimeMs;
  return !fresh;
}

function walk(dir, out, seen) {
  let real; try { real = fs.realpathSync(dir); } catch { return; }
  if (seen.has(real)) return;
  seen.add(real);
  let ents; try { ents = fs.readdirSync(real, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(real, e.name);
    if (e.isDirectory() || e.isSymbolicLink()) { let s; try { s = fs.statSync(p); } catch { continue; } if (s.isDirectory()) walk(p, out, seen); else if (e.name.endsWith('.jsonl')) out.add(fs.realpathSync(p)); }
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.add(p);
  }
}

// The scan itself (run in its own low-priority process): every record file under the roots.
function scan(ledgerFile, roots) {
  let ledger = { v: LEDGER_V, files: {} };
  try { const j = JSON.parse(fs.readFileSync(ledgerFile, 'utf8')); if (j && j.v === LEDGER_V) ledger = j; } catch { /* first run */ }
  const save = () => { const tmp = `${ledgerFile}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(ledger)); fs.renameSync(tmp, ledgerFile); };
  const files = [];
  for (const r of roots) {
    const set = new Set(); walk(r.dir, set, new Set());
    for (const f of set) files.push({ f, kind: r.kind, provider: r.provider || r.kind });
  }
  // Transcript cleanup must not erase usage already counted. Keep the small daily summaries
  // for missing files; if a file returns, its saved offset prevents recounting it.
  let n = 0;
  const started = Date.now();
  for (const { f, kind, provider } of files) {
    let st; try { st = fs.statSync(f); } catch { continue; }
    const rec = ledger.files[f] || (ledger.files[f] = { kind, provider, days: {} });
    if (rec.size === st.size && rec.mtime === st.mtimeMs) continue;
    rec.kind = kind; rec.provider = provider;
    try { readFile(rec, f, st); } catch { /* unreadable now; next time */ }
    if (++n % 200 === 0) save();
  }
  ledger.at = Date.now(); ledger.took = Date.now() - started; ledger.read = n;
  save();
}

// ---------- in Switcher ----------

function createTokens({ dataDir, log = () => {}, roots }) {
  const ledgerFile = path.join(dataDir, 'lite-tokens.json');
  let running = null, cache = { mtime: 0, ledger: null };
  // Starts a scan (unless one is going), in a separate process that yields to everything else.
  function refresh() {
    if (running) return running;
    running = new Promise(resolve => {
      const child = spawn(process.execPath, [__filename, 'scan', ledgerFile, JSON.stringify(roots())], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
      let err = '';
      child.stderr.on('data', d => { err = (err + d).slice(-2000); });
      child.on('close', code => { running = null; if (code) log(`Tokens: the count stopped (${code}): ${err.trim().split('\n').pop() || ''}`); resolve(); });
      child.on('error', e => { running = null; log(`Tokens: couldn’t count (${e.message})`); resolve(); });
    });
    return running;
  }
  function ledger() {
    let st; try { st = fs.statSync(ledgerFile); } catch { return null; }
    if (st.mtimeMs !== cache.mtime) { try { cache = { mtime: st.mtimeMs, ledger: JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) }; } catch { /* mid-write: last good one */ } }
    return cache.ledger;
  }
  let timer = null;
  function start() {
    if (timer) return;
    setTimeout(() => refresh(), 45e3).unref();
    timer = setInterval(() => refresh(), 15 * 60e3); timer.unref();
  }
  return { refresh, ledger, start, scanning: () => !!running };
}

// What the page shows, from the ledger. place(sessionId, cwd) -> { key, name, title } maps a chat
// to Lite's project (and title) the way the lists do.
function tokensView(ledger, place, now = new Date()) {
  const today = dayOf(now);
  const month = today.slice(0, 7);
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = dayOf(prevMonthDate).slice(0, 7);
  const dayN = now.getDate();
  const byDay = new Map(), byProject = new Map(), byChat = new Map();
  let all = 0, monthTotal = 0, monthFresh = 0, prevMonthTo = 0, prevMonthTotal = 0;
  const monthByProv = {};
  const sum = v => v[0] + v[1] + v[2] + v[3];
  for (const rec of Object.values((ledger && ledger.files) || {})) {
    const where = place(rec.sid, rec.cwd);
    for (const [day, v] of Object.entries(rec.days || {})) {
      const t = sum(v); if (!t) continue;
      all += t;
      const d = byDay.get(day) || { day, total: 0, claude: 0, codex: 0, fresh: 0 };
      d.total += t; d[rec.provider === 'claude' ? 'claude' : 'codex'] += t; d.fresh += v[0] + v[2] + v[3];
      byDay.set(day, d);
      if (day.startsWith(month)) {
        monthTotal += t; monthFresh += v[0] + v[2] + v[3];
        monthByProv[rec.provider] = (monthByProv[rec.provider] || 0) + t;
        const p = byProject.get(where.key) || { key: where.key, name: where.name, total: 0, chats: new Set() };
        p.total += t; if (rec.sid) p.chats.add(rec.sid); byProject.set(where.key, p);
        if (rec.sid) { const c = byChat.get(rec.sid) || { id: rec.sid, title: where.title, project: where.name, provider: rec.provider, total: 0 }; c.total += t; byChat.set(rec.sid, c); }
      }
      if (day.startsWith(prevMonth)) { prevMonthTotal += t; if (Number(day.slice(8)) <= dayN) prevMonthTo += t; }
    }
  }
  const days = [];
  for (let i = 89; i >= 0; i--) { const d = dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)); days.push(byDay.get(d) || { day: d, total: 0, claude: 0, codex: 0, fresh: 0 }); }
  const best = [...byDay.values()].sort((a, b) => b.total - a.total)[0] || null;
  const projects = [...byProject.values()].map(p => ({ key: p.key, name: p.name, total: p.total, chats: p.chats.size, share: monthTotal ? p.total / monthTotal : 0 })).sort((a, b) => b.total - a.total);
  const chats = [...byChat.values()].sort((a, b) => b.total - a.total).slice(0, 12);
  return {
    at: ledger && ledger.at ? ledger.at : null, month, monthTotal, monthFresh, monthByProv, prevMonthTotal, prevMonthTo,
    all, since: byDay.size ? [...byDay.keys()].sort()[0] : null, best, days, projects, chats,
  };
}

module.exports = { createTokens, tokensView, dayOf, claudeLine, codexLine };

if (require.main === module && process.argv[2] === 'scan') {
  try { os.setPriority(19); } catch { /* best effort */ }
  scan(process.argv[3], JSON.parse(process.argv[4]));
}
