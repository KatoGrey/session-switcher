'use strict';
// Your home PC's side of "Copy to this laptop" (lib/homepc.js is the laptop's side). A device paired
// through phone access can list and fetch the files that make up your work here: your projects, your
// Claude, Codex and Gemini chats and settings, and Session Switcher's own settings. It can also send
// back what it changed while it was away.
//
//  - Off until you turn it on here (Setup → Your home PC; server.js refuses these routes otherwise).
//  - Only those folders, and never a sign-in: each computer signs in for itself (a copied sign-in can
//    sign the other computer out when it refreshes).
//  - Nothing is ever deleted, on either side.
//  - A file sent back that the PC has also changed since it was copied isn't overwritten: the laptop's
//    version is kept beside it as "name (laptop).ext".
//  - Databases are read from a snapshot (SQLite's own backup), so a copy is never half-written, even
//    while Codex is using them.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream');

const IS_WIN = process.platform === 'win32';

// Anywhere: system clutter and this copy's own half-done files.
const JUNK = /^(Thumbs\.db|desktop\.ini|\.DS_Store|~\$.*|.*\.ssmirror-part|.*\.ssmirror-part\.json|.*\.ssmirror-tmp)$/i;
// Sign-ins, wherever they are in a tool's folder.
const SECRET = /^(\.credentials\.json|auth\.json(\.backup)?|oauth_creds\.json|google_accounts\.json|antigravity-oauth-token|installation_id|cap_sid|\.sandbox-secrets)$/i;
// A database's journal: never copied on its own (the snapshot already holds what's in it).
const DB_SIDE = /\.(sqlite3?|db)-(wal|shm|journal)$/i;
const DB_NAME = /\.(sqlite3?|db)$/i;
// A snapshot in one step: a read of a single moment, which a writer elsewhere (Codex) can't make start
// over. (The app's own Node wants a positive number here, where plain Node also took -1.)
const ONE_STEP = 0x7fffffff;
// What each tool's folder leaves out, by the first part of the path: the sign-in, and what each running
// copy keeps for itself (live sessions, caches, logs, locks, its own installs).
const SKIP_TOP = {
  claude: /^(\.credentials\.json|\.last-cleanup|\.last-update-result\.json|backups|cache|chrome|downloads|ide|session-env|sessions|shell-snapshots|statsig|telemetry|debug|mcp-needs-auth-cache\.json|\.claude\.json\..+|.+\.switcher-old-.+|.+\.switcher-bak)$/i,
  codex: /^(auth\.json.*|cap_sid|installation_id|\.sandbox.*|\.sqlite-maintenance\.lock|\.codex-provisioning-.*|\.+codex-global-state.*|\.tmp|tmp|log|logs_\d+\.sqlite.*|cache|process_manager|project-metadata-locks|thread-writer-locks|models_cache\.json|node_repl|sandbox\..*\.log|version\.json|chrome-native-hosts.*|computer-use|queue_\d+\.sqlite.*|ipc|app-server-daemon)$/i,
  gemini: null,
};
const SKIP_GEMINI = /^antigravity-cli\/(bin|updater|log|crashes|cli\.log|presence|last_check\.timestamp)(\/|$)/i;
// Session Switcher's own folder: settings and what you've named, never what it's running right now
// (open chats, routines, waiting sends), so the laptop doesn't pick those up and do them twice.
const APP_ONLY = new Set(['accounts.json', 'history.json', 'chat-names.json', 'projects.json', 'banners.json', 'worlds.json', 'prompts.json',
  'chat-prefs.json', 'openclaw-titles.json', 'pairs.json', 'drafts.json', 'organize.json', 'lite.json', 'lite-usage.json', 'gemini-chats.json',
  'board.json', 'aide.json', 'chat-extras', 'openclaw-messages', 'theme-studio', 'commander', 'companion']);
// What a laptop may send back, by kind: your work (projects, chats and their pictures), never settings.
const UP = {
  project: () => true,
  claude: rel => /^(projects|file-history|plans|todos|tasks)\//i.test(rel) || rel === 'history.jsonl',
  codex: rel => /^(sessions|archived_sessions|generated_images|attachments)\//i.test(rel) || /^(session_index\.jsonl|history\.jsonl|state_\d+\.sqlite|thread_history_\d+\.sqlite)$/i.test(rel),
  gemini: rel => /^antigravity-cli\/(conversations|brain|annotations|implicit)\//i.test(rel) || /^antigravity-cli\/(cache\/last_conversations\.json|conversation_summaries\.db)$/i.test(rel),
  app: () => false,
};

function skipped(kind, rel) {
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  if (JUNK.test(name)) return true;
  if (kind === 'project') return false;
  if (SECRET.test(name) || DB_SIDE.test(name)) return true;
  const top = rel.split('/')[0];
  if (kind === 'app') return !APP_ONLY.has(top);
  if (SKIP_TOP[kind] && SKIP_TOP[kind].test(top)) return true;
  if (kind === 'gemini' && SKIP_GEMINI.test(rel)) return true;
  return false;
}
const mayGoUp = (kind, rel) => !skipped(kind, rel) && !!(UP[kind] && UP[kind](rel));

const same = (a, b) => (IS_WIN ? a.toLowerCase() === b.toLowerCase() : a === b);
const inside = (dir, p) => { const r = path.relative(dir, p); return r === '' || (!!r && !r.startsWith('..') && !path.isAbsolute(r)); };
const idFor = p => `p-${crypto.createHash('sha1').update(IS_WIN ? p.toLowerCase() : p).digest('hex').slice(0, 10)}`;
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// The folders this PC offers. `projects`: the folders your chats and projects are in.
function plan({ projects = [], parents = [], claudeDirs = [], codexHome, geminiHome, dataDir, home = os.homedir(), tmpDir = os.tmpdir() }) {
  const roots = [];
  const tools = [...claudeDirs.map(d => d.dir), codexHome, geminiHome, dataDir].filter(Boolean).map(p => path.resolve(p));
  const tmp = tmpDir ? path.resolve(tmpDir) : null;
  // Projects: the folders that exist, not your whole home or a drive, not the temp folder or a tool's own,
  // and one folder only once (a project inside another comes with it).
  const cands = [...new Set([...parents, ...projects].filter(Boolean).map(p => path.resolve(p)))]
    .filter(p => isDir(p) && p !== path.parse(p).root && !same(p, path.resolve(home)) && !(tmp && inside(tmp, p))
      && !tools.some(t => inside(t, p) || inside(p, t)) && !inside(path.join(home, 'AppData'), p) && !/scratch-workspaces/i.test(p))
    .sort((a, b) => a.length - b.length);
  const picked = [];
  for (const p of cands) if (!picked.some(q => inside(q, p))) picked.push(p);
  for (const p of picked) roots.push({ id: idFor(p), kind: 'project', label: path.basename(p), path: p });
  for (const d of claudeDirs) if (isDir(d.dir)) roots.push({ id: d.main ? 'claude' : `claude-${String(d.id).replace(/[^\w-]/g, '').slice(0, 40)}`, kind: 'claude', label: d.main ? 'Claude' : `Claude (${d.name || d.id})`, path: path.resolve(d.dir), account: d.main ? null : d.id });
  if (codexHome && isDir(codexHome)) roots.push({ id: 'codex', kind: 'codex', label: 'Codex', path: path.resolve(codexHome) });
  if (geminiHome && isDir(geminiHome)) roots.push({ id: 'gemini', kind: 'gemini', label: 'Gemini', path: path.resolve(geminiHome) });
  if (dataDir) roots.push({ id: 'app', kind: 'app', label: 'Session Switcher', path: path.resolve(dataDir) });
  return { app: 'session-switcher', pc: os.hostname(), platform: process.platform, home: path.resolve(home), sep: path.sep, roots };
}

// Every file under a root, as { p (with /), s (bytes), m (modified, ms) }. Links and junctions aren't
// followed (they'd lead out of the folder, or round in a circle).
async function* walk(root, kind) {
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    let dir;
    try { dir = await fs.promises.opendir(rel ? path.join(root, rel) : root); } catch { continue; }
    try {
      for await (const e of dir) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (skipped(kind, r)) continue;
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) { stack.push(r); continue; }
        if (!e.isFile()) continue;
        let st;
        try { st = await fs.promises.lstat(path.join(root, r)); } catch { continue; }
        if (st.isSymbolicLink() || !st.isFile()) continue;
        yield { p: r, s: st.size, m: Math.floor(st.mtimeMs) };
      }
    } catch { /* a folder that went away while being read */ }
  }
}

// A path inside a root, from what was asked: never outside it, never through a link.
function resolveIn(root, rel) {
  const r = String(rel || '');
  if (!r || r.length > 4000 || /\0/.test(r) || /^[\\/]/.test(r) || /^[A-Za-z]:/.test(r)) return null;
  const parts = r.split('/');
  if (parts.some(x => !x || x === '.' || x === '..' || /[\\]/.test(x) || (IS_WIN && /[<>:"|?*]/.test(x)))) return null;
  const abs = path.join(root, ...parts);
  if (!inside(root, abs) || abs === root) return null;
  // Every folder on the way must be a real folder, not a link out.
  let cur = root;
  for (const x of parts.slice(0, -1)) {
    cur = path.join(cur, x);
    try { const st = fs.lstatSync(cur); if (st.isSymbolicLink() || !st.isDirectory()) return null; } catch (err) { if (err.code === 'ENOENT') break; return null; }
  }
  return abs;
}

const isSqlite = file => {
  if (!DB_NAME.test(file)) return false;
  try { const fd = fs.openSync(file, 'r'); try { const b = Buffer.alloc(16); fs.readSync(fd, b, 0, 16, 0); return b.toString('latin1') === 'SQLite format 3\u0000'; } finally { fs.closeSync(fd); } } catch { return false; }
};

// Database snapshots, one at a time, kept a while so a big one can be fetched in parts.
function createSnapshots(dir) {
  // Any left from the last run (one can be tens of GB) go now. A computer that has never made one has
  // no folder for them, and nothing is made or kept running until the first is asked for.
  try { for (const f of fs.readdirSync(dir)) { try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* in use */ } } } catch { /* never made */ }
  const made = new Map(); // key -> { file, at, size }
  let queue = Promise.resolve(), begun = false;
  function tidy() {
    const now = Date.now();
    for (const [k, v] of made) if (now - v.at > 30 * 60000) { made.delete(k); fs.rm(v.file, { force: true }, () => {}); }
  }
  function begin() {
    if (begun) return;
    begun = true;
    fs.mkdirSync(dir, { recursive: true });
    setInterval(tidy, 5 * 60000).unref();
  }
  function of(file) {
    begin();
    const st = fs.statSync(file);
    const key = `${file}|${st.size}|${Math.floor(st.mtimeMs)}`;
    const have = made.get(key);
    if (have && fs.existsSync(have.file)) { have.at = Date.now(); return Promise.resolve(have); }
    const run = queue.then(async () => {
      const again = made.get(key);
      if (again && fs.existsSync(again.file)) return again;
      const out = path.join(dir, `${crypto.randomBytes(6).toString('hex')}.sqlite`);
      const { DatabaseSync, backup } = require('node:sqlite');
      const db = new DatabaseSync(file, { readOnly: true });
      try { await backup(db, out, { rate: ONE_STEP }); } finally { db.close(); }
      // An older snapshot of the same file goes.
      for (const [k, v] of made) if (k.startsWith(`${file}|`)) { made.delete(k); fs.rm(v.file, { force: true }, () => {}); }
      const v = { file: out, at: Date.now(), size: fs.statSync(out).size };
      made.set(key, v);
      return v;
    });
    queue = run.catch(() => {});
    return run;
  }
  return { of };
}

// "name.ext" -> "name (laptop).ext", or "(laptop 2)" and so on if that's taken too.
function besideName(abs, tag) {
  const dir = path.dirname(abs), ext = path.extname(abs), base = path.basename(abs, ext);
  for (let i = 1; i < 1000; i++) {
    const p = path.join(dir, `${base} (${tag}${i > 1 ? ` ${i}` : ''})${ext}`);
    if (!fs.existsSync(p)) return p;
  }
  return path.join(dir, `${base} (${tag} ${Date.now()})${ext}`);
}

// Moves a finished file into place; Windows refuses for a moment while something has it open.
async function moveIntoPlace(tmp, abs) {
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, abs); return; } catch (err) {
      if (i >= 5 || !['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) throw err;
      await new Promise(r => setTimeout(r, 300 * (i + 1)));
    }
  }
}

// The PC's routes, for a paired device. getPlan() is called each time (folders come and go).
function createMirror({ getPlan, dataDir, log = () => {} }) {
  const snaps = createSnapshots(path.join(dataDir, "mirror-snap"));
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const rootOf = id => { const r = getPlan().roots.find(x => x.id === id); if (!r) throw fail(404, 'That folder isn’t offered any more.'); return r; };
  const stamp = st => `${st.size}:${Math.floor(st.mtimeMs)}`;

  async function list(res, id) {
    const root = rootOf(id);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
    let files = 0, bytes = 0, closed = false;
    res.on('close', () => { closed = true; });
    let buf = '';
    for await (const f of walk(root.path, root.kind)) {
      if (closed) return;
      files++; bytes += f.s;
      buf += `${JSON.stringify(f)}\n`;
      if (buf.length > 64 * 1024) { const ok = res.write(buf); buf = ''; if (!ok) await new Promise(r => res.once('drain', r)); }
    }
    res.end(`${buf}${JSON.stringify({ done: true, files, bytes })}\n`);
  }

  async function get(req, res, id, rel) {
    const root = rootOf(id);
    const abs = resolveIn(root.path, rel);
    if (!abs || skipped(root.kind, rel)) throw fail(403, 'That file isn’t offered.');
    let st;
    try { st = fs.statSync(abs); } catch { throw fail(404, 'That file has gone.'); }
    if (!st.isFile()) throw fail(404, 'That isn’t a file.');
    const before = stamp(st);
    let src = abs, size = st.size;
    if (isSqlite(abs)) {
      try { const s = await snaps.of(abs); src = s.file; size = s.size; } catch (err) { log(`Copy to laptop: couldn’t snapshot ${abs}: ${err.message}`); throw fail(503, 'That database couldn’t be read just now. Try again.'); }
    }
    const m = /^bytes=(\d+)-$/.exec(req.headers.range || '');
    const start = m && size ? Math.min(Number(m[1]), size) : 0;
    res.writeHead(start ? 206 : 200, {
      'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'X-Mirror-Stat': before, 'X-Mirror-Size': String(size), 'X-Mirror-Start': String(start), Trailer: 'X-Mirror-After',
      ...(start ? { 'Content-Range': `bytes ${start}-${size - 1}/${size}` } : {}),
    });
    if (start >= size) { res.addTrailers({ 'X-Mirror-After': before }); return res.end(); }
    const rs = fs.createReadStream(src, { start });
    res.on('close', () => rs.destroy());
    rs.on('error', () => res.destroy());
    rs.on('end', () => {
      // Changed while it was being sent (a chat writing to it): the laptop fetches it again.
      let after = 'gone';
      try { after = src === abs ? stamp(fs.statSync(abs)) : before; } catch { /* gone */ }
      res.addTrailers({ 'X-Mirror-After': after });
      res.end();
    });
    rs.pipe(res, { end: false });
    return undefined;
  }

  // A file the laptop changed. base: what the PC had when the laptop got it ("size:mtime"), or "new".
  async function put(req, res, id, rel, base, mtime) {
    const root = rootOf(id);
    const abs = resolveIn(root.path, rel);
    if (!abs || !mayGoUp(root.kind, rel)) { req.resume(); throw fail(403, 'That file can’t be sent to the PC.'); }
    let cur = null;
    try { const st = fs.statSync(abs); if (!st.isFile()) { req.resume(); throw fail(409, 'There’s a folder by that name on the PC.'); } cur = stamp(st); } catch (err) { if (err.status) throw err; }
    const conflict = cur !== null && cur !== String(base || '');
    const target = conflict ? besideName(abs, 'laptop') : abs;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${crypto.randomBytes(4).toString('hex')}.ssmirror-tmp`;
    const want = Number(req.headers['content-length']);
    try {
      await new Promise((resolve, reject) => pipeline(req, fs.createWriteStream(tmp), err => (err ? reject(err) : resolve())));
      if (Number.isFinite(want) && fs.statSync(tmp).size !== want) throw fail(400, 'Only part of the file arrived.');
      // A database replaced while its journal is still there would read the old journal into the new file.
      if (!conflict && isSqlite(tmp)) for (const side of ['-wal', '-shm', '-journal']) { if (fs.existsSync(abs + side)) { try { fs.rmSync(abs + side); } catch { throw fail(409, 'That database is in use on the PC. Close what’s using it and send again.'); } } }
      await moveIntoPlace(tmp, target);
    } catch (err) {
      fs.rm(tmp, { force: true }, () => {});
      if (err.status) throw err;
      if (['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) throw fail(409, 'That file is in use on the PC.');
      throw err;
    }
    const t = Number(mtime);
    if (Number.isFinite(t) && t > 0) { try { fs.utimesSync(target, new Date(), new Date(t)); } catch { /* keeps now */ } }
    const st = fs.statSync(target);
    if (conflict) log(`Copy from laptop: kept both versions of ${abs}.`);
    return { ok: true, conflict, rel: conflict ? path.relative(root.path, target).split(path.sep).join('/') : rel, s: st.size, m: Math.floor(st.mtimeMs) };
  }

  return { list, get, put, plan: () => getPlan() };
}

// What the laptop's Claude should know about too: your MCP servers and trusted folders, from ~/.claude.json.
function claudeExtras(home = os.homedir()) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
    const projects = {};
    for (const [k, v] of Object.entries(j.projects || {})) if (v && typeof v === 'object') projects[k] = { hasTrustDialogAccepted: !!v.hasTrustDialogAccepted, allowedTools: Array.isArray(v.allowedTools) ? v.allowedTools : [], mcpServers: v.mcpServers || {} };
    return { mcpServers: j.mcpServers || {}, projects };
  } catch { return { mcpServers: {}, projects: {} }; }
}

module.exports = { ONE_STEP, createMirror, plan, walk, skipped, mayGoUp, resolveIn, isSqlite, createSnapshots, besideName, moveIntoPlace, claudeExtras, idFor, inside, same };
