'use strict';
// Text snapshots for project folders without Git. Their object database lives in the app's data
// folder; neither a .git directory nor an index is written into the project. An incomplete scan
// never becomes a baseline, and exclusions are recorded so an unreadable file is not a deletion.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

const VERSION = 1;
const PREFIX = 'shadow:v1:';
const HASH = /^[a-f0-9]{64}$/;
const TEXT = new Set(('.txt .md .markdown .mdx .rst .adoc .json .jsonc .json5 .yaml .yml .toml .ini .cfg .conf .csv .tsv .xml .html .htm .css .scss .sass .less .js .jsx .mjs .cjs .ts .tsx .py .pyi .lua .luau .rb .php .go .rs .java .kt .kts .c .h .cc .cpp .hpp .cs .fs .fsx .swift .m .mm .sh .bash .zsh .ps1 .psm1 .bat .cmd .sql .graphql .gql .vue .svelte .astro .gd .gdshader .shader .hlsl .glsl .wgsl .r .R .jl .ex .exs .erl .hrl .clj .cljs .edn .tex .bib .typ .po .pot .properties .sln .csproj .vbproj .vcxproj .props .targets .cmake .gradle .gitignore .gitattributes .editorconfig').toLowerCase().split(' '));
const NAMES = new Set(['readme', 'license', 'licence', 'makefile', 'dockerfile', 'cmakelists.txt', '.gitignore', '.gitattributes', '.editorconfig']);
const SKIP = new Set(['.git', '.hg', '.svn', '.shadow-snapshots', '.session-index', '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.password-store', 'node_modules', 'vendor', 'dist', 'build', 'out', 'target', 'coverage', '.next', '.nuxt', '.cache', '.venv', 'venv', '__pycache__', '.idea', '.vs', 'obj', 'tmp', 'temp', '$recycle.bin', 'system volume information']);
const LIMITS = { entries: 30000, files: 10000, depth: 24, fileBytes: 5 << 20, snapshotBytes: 256 << 20,
  projectBytes: 512 << 20, totalBytes: 2 * 1024 ** 3, metadataBytes: 64 << 20, scanMs: 6000, manifests: 120, retainMs: 14 * 86400000, pinGraceMs: 10000 };
const keyOf = s => crypto.createHash('sha256').update(s).digest('hex');
const normalized = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const signature = st => `${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}:${st.birthtimeNs}`;
const rootIdentity = st => `${st.dev}:${st.ino}:${st.birthtimeNs}`;
const relativeOK = p => typeof p === 'string' && p && !p.includes('\0') && !path.isAbsolute(p) && !p.split(/[\\/]/).some(x => x === '..' || x === '.');
const within = (root, p) => { const r = path.relative(root, path.resolve(root, p)); return !!r && !path.isAbsolute(r) && r !== '..' && !r.startsWith(`..${path.sep}`); };
function eligible(file) {
  if (!relativeOK(file)) return false;
  const parts = file.split(/[\\/]/), name = parts.at(-1).toLowerCase();
  if (parts.slice(0, -1).some(p => SKIP.has(p.toLowerCase()))) return false;
  if (/^(\.env(?:\.|$)|\.?credentials(?:\.|$)|\.?secrets?(?:\.|$)|auth\.json$)/i.test(name)) return false;
  return NAMES.has(name) || TEXT.has(path.extname(name));
}
function broad(root) {
  const r = normalized(root), home = normalized(os.homedir());
  if (within(r, home)) return true;
  const roots = [home, path.parse(r).root, ...['Desktop', 'Documents', 'Downloads', 'Pictures', 'Videos', 'Music', 'OneDrive'].map(n => path.join(home, n))];
  for (const sync of [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial, path.join(home, 'OneDrive')].filter(Boolean))
    roots.push(sync, ...['Desktop', 'Documents', 'Pictures'].map(n => path.join(sync, n)));
  return roots.some(x => normalized(x) === r);
}
function command(command, args, { cwd, env, input, timeout = 60000, maxBuffer = 16 << 20 } = {}) {
  return new Promise(resolve => {
    const child = execFile(command, args, { cwd, env, timeout, maxBuffer, windowsHide: true, encoding: 'buffer' }, (err, stdout, stderr) =>
      resolve({ ok: !err, code: err && err.code, out: stdout || Buffer.alloc(0), err: String(stderr || (err && err.message) || '') }));
    child.stdin.on('error', () => {});
    if (input !== undefined) child.stdin.end(input);
  });
}
const cleanEnv = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k))),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_ATTR_NOSYSTEM: '1' });
async function atomic(file, data) {
  const temp = `${file}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  try { await fsp.writeFile(temp, data, { flag: 'wx', mode: 0o600 }); await fsp.rename(temp, file); }
  finally { await fsp.unlink(temp).catch(() => {}); }
}
async function parallelMap(items, work, concurrency = 16) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await work(items[i], i); }
  }));
  return out;
}

function createShadowStore({ dir, limits: overrides = {}, log = () => {}, attributes: suppliedAttributes = null, trace = () => {} } = {}) {
  if (!dir) throw new Error('A private snapshot folder is required.');
  dir = path.resolve(dir);
  const limits = { ...LIMITS, ...overrides }, pending = new Map(), states = new Map(), pins = new Map(), unavailable = new Map();
  const pinDir = path.join(dir, 'pins'), pinFile = path.join(pinDir, `${process.pid}-${crypto.randomBytes(8).toString('hex')}.json`);
  let worker = null, tail = Promise.resolve(), closed = false;
  function savePins() {
    if (!pins.size) { try { fs.unlinkSync(pinFile); } catch (err) { if (err.code !== 'ENOENT') throw err; } return; }
    fs.mkdirSync(pinDir, { recursive: true, mode: 0o700 });
    const temporary = `${pinFile}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify([...pins.keys()]), { mode: 0o600 }); fs.renameSync(temporary, pinFile); }
    finally { try { fs.unlinkSync(temporary); } catch { /* renamed or never written */ } }
  }
  async function protectedRefs() {
    const refs = new Set(pins.keys());
    const names = await fsp.readdir(pinDir).catch(err => { if (err.code === 'ENOENT') return []; throw err; });
    for (const name of names) {
      const m = name.match(/^(\d+)-[a-f0-9]{16}\.json$/); if (!m) continue;
      const file = path.join(pinDir, name);
      try { process.kill(Number(m[1]), 0); }
      catch (err) { if (err.code === 'ESRCH') { await fsp.unlink(file).catch(() => {}); continue; } }
      let list;
      try { list = await readJSON(file, 1 << 20); } catch (err) { if (err.code === 'ENOENT') continue; throw err; }
      if (!Array.isArray(list) || list.some(ref => !/^shadow:v1:[a-f0-9]{64}:[a-f0-9]{64}$/.test(ref))) throw new Error('Active snapshot metadata could not be checked.');
      for (const ref of list) refs.add(ref);
    }
    return refs;
  }
  async function attributes(paths) {
    if (suppliedAttributes) return suppliedAttributes(paths);
    if (process.platform !== 'win32') return paths.map(() => 0);
    if (!worker) worker = require('./pswork').createPsWorker({ fallback: async (script, opts) => {
      const r = await command('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout: opts.timeoutMs });
      return { code: r.ok ? 0 : -1, stdout: r.out.toString('utf8'), stderr: r.err };
    }});
    const encoded = Buffer.from(JSON.stringify(paths)).toString('base64');
    const script = `$paths = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json; for ($i=0; $i -lt $paths.Count; $i++) { try { $a=[int][IO.File]::GetAttributes([string]$paths[$i]); [Console]::WriteLine(('{0}:{1}' -f $i,$a)) } catch { [Console]::WriteLine(('{0}:-1' -f $i)) } }`;
    const r = await worker.run(script, { timeoutMs: limits.scanMs });
    const result = paths.map(() => -1);
    if (r.code !== 0) return result;
    for (const line of r.stdout.split(/\r?\n/)) { const m = line.trim().match(/^(\d+):(-?\d+)$/); if (m && +m[1] < result.length) result[+m[1]] = +m[2]; }
    return result;
  }
  // Reading these attributes does not fetch file contents. The flags also apply to directories:
  // enumerating a cloud-only directory can hydrate it, so check before opening the directory.
  const available = a => Number.isInteger(a) && a >= 0 && !(a & 0x441000);
  async function readJSON(file, max = 24 << 20) {
    const st = await fsp.stat(file); if (st.size > max) throw new Error('Snapshot metadata is too large.');
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  }
  async function stateFor(root) {
    root = path.resolve(root);
    if (broad(root)) throw new Error('Change tracking needs a project folder, not a user or system folder.');
    const st = await fsp.lstat(root, { bigint: true });
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('The project folder is missing or is a link.');
    const realRoot = await fsp.realpath(root);
    if (broad(realRoot)) throw new Error('Change tracking needs a project folder, not a user or system folder.');
    const canonical = normalized(realRoot), id = keyOf(canonical), identity = rootIdentity(st);
    const prior = states.get(id);
    if (prior) { if (prior.owner.identity !== identity) throw new Error('The project folder has been replaced.'); return prior; }
    const base = path.join(dir, id), gitDir = path.join(base, 'objects.git');
    await fsp.mkdir(base, { recursive: true, mode: 0o700 });
    let owner;
    try { owner = await readJSON(path.join(base, 'owner.json'), 8192); }
    catch (err) {
      if (err.code !== 'ENOENT') throw err;
      owner = { version: VERSION, root: canonical, identity };
      await atomic(path.join(base, 'owner.json'), JSON.stringify(owner));
    }
    if (owner.version !== VERSION || owner.root !== canonical || owner.identity !== identity) throw new Error('This saved snapshot belongs to an earlier project folder.');
    const state = { id, base, gitDir, root: realRoot, owner, cache: {}, history: [], bytes: 0 };
    state.git = (args, opts = {}) => command('git', ['-c', 'core.longpaths=true', `--git-dir=${gitDir}`, `--work-tree=${realRoot}`, ...args], { ...opts, env: { ...cleanEnv(), ...(opts.env || {}) } });
    if (!fs.existsSync(path.join(gitDir, 'HEAD'))) {
      const r = await command('git', ['-c', 'core.longpaths=true', 'init', '--bare', '--quiet', gitDir], { env: cleanEnv() });
      if (!r.ok) throw new Error(r.err.trim() || 'Could not prepare local change tracking.');
      await state.git(['config', 'core.autocrlf', 'false']);
      await state.git(['config', 'core.longpaths', 'true']);
      await state.git(['config', 'core.filemode', process.platform === 'win32' ? 'false' : 'true']);
    }
    await fsp.mkdir(path.join(base, 'manifests'), { recursive: true });
    await loadIndex(state);
    states.set(id, state);
    return state;
  }
  async function scan(root) {
    const started = Date.now(), queue = [{ abs: root, rel: '', depth: 0 }], paths = [], excluded = new Set();
    let entries = 0;
    const check = () => { if (closed) throw new Error('Snapshot tracking stopped.'); if (Date.now() - started > limits.scanMs) throw new Error('This project takes too long to scan for changes.'); };
    while (queue.length) {
      check();
      const batch = queue.splice(0, 64), attrs = await attributes(batch.map(d => d.abs));
      for (let i = 0; i < batch.length; i++) {
        check(); const d = batch[i];
        if (!available(attrs[i])) { if (!d.rel) throw new Error('The project folder is cloud-only or cannot be inspected.'); excluded.add(d.rel); continue; }
        const st = await fsp.lstat(d.abs).catch(() => null);
        if (!st || !st.isDirectory() || st.isSymbolicLink()) { if (!d.rel) throw new Error('The project folder is unavailable.'); excluded.add(d.rel); continue; }
        if (d.depth > limits.depth) { excluded.add(d.rel); continue; }
        let handle;
        try { handle = await fsp.opendir(d.abs); } catch { if (!d.rel) throw new Error('The project folder cannot be read.'); excluded.add(d.rel); continue; }
        for await (const entry of handle) {
          if (++entries > limits.entries) throw new Error('This project has too many entries for automatic change tracking.');
          check();
          const rel = d.rel ? `${d.rel}/${entry.name}` : entry.name, abs = path.join(d.abs, entry.name);
          if (SKIP.has(entry.name.toLowerCase()) || normalized(abs) === normalized(dir)) continue;
          if (entry.isSymbolicLink()) { excluded.add(rel); continue; }
          if (entry.isDirectory()) queue.push({ abs, rel, depth: d.depth + 1 });
          else if (eligible(rel)) { paths.push({ abs, rel }); if (paths.length > limits.files) throw new Error('This project has too many text files for automatic change tracking.'); }
        }
      }
    }
    const files = [], attrs = await attributes(paths.map(p => p.abs));
    const stats = await parallelMap(paths, (p, i) => available(attrs[i]) ? fsp.lstat(p.abs, { bigint: true }).catch(() => null) : null);
    let bytes = 0;
    for (let i = 0; i < paths.length; i++) {
      check(); const p = paths[i];
      if (!available(attrs[i])) { excluded.add(p.rel); continue; }
      const st = stats[i];
      if (!st || !st.isFile() || st.isSymbolicLink() || st.size > BigInt(limits.fileBytes)) { excluded.add(p.rel); continue; }
      bytes += Number(st.size); if (bytes > limits.snapshotBytes) throw new Error('This project has too much text for automatic change tracking.');
      files.push({ ...p, size: Number(st.size), stamp: signature(st), mode: process.platform !== 'win32' && st.mode & 0o100n ? '100755' : '100644' });
    }
    return { files, excluded, bytes, entries };
  }
  async function loadIndex(s) {
    try {
      const saved = await readJSON(path.join(s.base, 'index.json'));
      if (saved.version !== VERSION) return;
      s.cache = saved.cache && typeof saved.cache === 'object' && !Array.isArray(saved.cache) ? saved.cache : {};
      s.history = Array.isArray(saved.history) ? saved.history.filter(h => h && HASH.test(h.id) && Number.isFinite(h.at)) : [];
      s.bytes = Math.max(0, Number(saved.bytes) || 0);
      s.metaBytes = Math.max(0, Number(saved.metaBytes) || 0);
      s.reserved = !!saved.reserved;
      s.tree = saved.tree && HASH.test(saved.tree.fingerprint) && /^[a-f0-9]{40}$/.test(saved.tree.hash) ? saved.tree : null;
    } catch { /* rebuild from files */ }
  }
  async function totalBytes(current) {
    let total = 0;
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory() || !HASH.test(e.name)) continue;
      if (e.name === current.id) { total += current.bytes + (current.metaBytes || 0); continue; }
      try { const s = await readJSON(path.join(dir, e.name, 'index.json')); total += Math.max(0, Number(s.bytes) || 0) + Math.max(0, Number(s.metaBytes) || 0); } catch { /* new store */ }
    }
    return total;
  }
  async function saveIndex(s) { await atomic(path.join(s.base, 'index.json'), JSON.stringify({ version: VERSION, cache: s.cache, history: s.history, bytes: s.bytes, metaBytes: s.metaBytes || 0, tree: s.tree, reserved: !!s.reserved })); }
  async function metadataSize(s) {
    const names = await fsp.readdir(path.join(s.base, 'manifests'));
    const files = [path.join(s.base, 'index.json'), path.join(s.base, 'owner.json'), ...names.filter(n => /^[a-f0-9]{64}\.json$/.test(n)).map(n => path.join(s.base, 'manifests', n))];
    const sizes = await parallelMap(files, async file => { const st = await fsp.stat(file).catch(() => null); return st ? Math.ceil(st.size / 4096) * 4096 : 0; });
    return sizes.reduce((a, b) => a + b, 65536 + s.history.length * 4096); // repository metadata and refs
  }
  async function countBytes(s) {
    const r = await s.git(['count-objects', '-v']);
    if (!r.ok) throw new Error(r.err.trim() || 'Local snapshot storage could not be checked.');
    const stats = r.out.toString(), value = key => Number(stats.match(new RegExp(`^${key}: (\\d+)$`, 'm'))?.[1]) || 0;
    // Git for Windows reports compressed lengths, not allocated clusters. Keep the per-object
    // allocation allowance after capture too, or many small revisions can bypass the quota.
    s.bytes = value('size') * 1024 + value('count') * 4096 + value('size-pack') * 1024 + value('packs') * 4096;
  }
  async function prune(s) {
    const now = Date.now();
    const candidates = s.history.filter((h, i) => now - h.at >= limits.pinGraceMs && (now - h.at > limits.retainMs || i < s.history.length - limits.manifests));
    if (!candidates.length) return;
    // Pins live on disk as well: a second app instance may save another reply while this one
    // is still using its baseline. A short grace covers the capture-to-pin handoff.
    const protected_ = await protectedRefs(), expired = candidates.filter(h => !protected_.has(`${PREFIX}${s.id}:${h.id}`));
    if (!expired.length) return;
    const gone = new Set(expired.map(h => h.id));
    for (const h of expired) {
      await s.git(['update-ref', '-d', `refs/snapshots/${h.id}`]);
      await fsp.unlink(path.join(s.base, 'manifests', `${h.id}.json`)).catch(() => {});
    }
    s.history = s.history.filter(h => !gone.has(h.id));
    await s.git(['prune', '--expire=now']);
    // The most recent retained tree still owns its cached blobs. Clearing every entry on each
    // eviction would turn every later reply in a large project into another full cold scan.
    const cachedTree = s.tree && await s.git(['cat-file', '-e', `${s.tree.hash}^{tree}`]);
    if (!cachedTree || !cachedTree.ok) { s.cache = {}; s.tree = null; }
    await countBytes(s);
  }
  async function acquire() {
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'capture.lock'), nonce = crypto.randomBytes(12).toString('hex');
    for (let tries = 0; tries < 2; tries++) {
      try {
        await fsp.writeFile(file, JSON.stringify({ pid: process.pid, nonce, at: Date.now() }), { flag: 'wx', mode: 0o600 });
        return async () => { try { if ((await readJSON(file, 4096)).nonce === nonce) await fsp.unlink(file); } catch { /* already released */ } };
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        let owner; try { owner = await readJSON(file, 4096); } catch { /* interrupted lock write */ }
        let alive = true;
        if (owner && Number.isInteger(owner.pid) && owner.pid > 0) {
          try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
        } else { const st = await fsp.stat(file).catch(() => null); alive = !st || Date.now() - st.mtimeMs < 60000; }
        if (alive) throw new Error('Another local snapshot is still being saved.');
        await fsp.unlink(file).catch(() => {});
      }
    }
    throw new Error('Local snapshot storage is busy.');
  }
  async function captureNow(root) {
    if (closed) throw new Error('Snapshot tracking stopped.');
    const unlock = await acquire();
    try {
      const s = await stateFor(root);
      await loadIndex(s); // another app instance may have saved a turn since this one last captured
      // Only an app-created capture directory, beneath this verified store, can be removed. The
      // global lock means an interrupted predecessor cannot still be writing there.
      for (const entry of await fsp.readdir(s.base, { withFileTypes: true })) {
        if (!/^capture-[a-f0-9]{16}$/.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
        const stale = path.resolve(s.base, entry.name), actual = await fsp.realpath(stale);
        if (!within(s.base, actual)) throw new Error('Unexpected link in local snapshot storage.');
        await fsp.rm(stale, { recursive: true, force: true });
      }
      if (s.reserved) { await s.git(['prune', '--expire=now']); await countBytes(s); s.reserved = false; await saveIndex(s); }
      return await captureProject(s);
    } finally { await unlock(); }
  }
  async function captureProject(s) {
    const started = Date.now(); let lastPhase = started;
    const phase = name => { const now = Date.now(); trace({ phase: name, ms: now - lastPhase, totalMs: now - started }); lastPhase = now; };
    await prune(s);
    s.metaBytes = await metadataSize(s);
    const inventory = await scan(s.root), changed = [], entries = [], cache = {};
    phase('scan');
    for (const f of inventory.files) {
      const old = s.cache[f.rel];
      if (old && old.stamp === f.stamp && /^[0-9a-f]{40}$/.test(old.blob)) { entries.push({ ...f, blob: old.blob }); cache[f.rel] = old; continue; }
      changed.push(f);
    }
    // Allow for both the bounded staging copy and Git's object, including filesystem allocation.
    const treeMayChange = changed.length || entries.length !== Object.keys(s.cache).length || !s.tree;
    const treeDirs = new Set(['']);
    for (const f of inventory.files) { let d = path.posix.dirname(f.rel); while (d !== '.') { treeDirs.add(d); d = path.posix.dirname(d); } }
    const treeBytes = inventory.files.reduce((n, f) => n + Buffer.byteLength(f.rel) + 64, 0) + [...treeDirs].reduce((n, d) => n + Buffer.byteLength(d) + 64 + 4096, 0);
    const needed = changed.reduce((n, f) => n + Math.ceil((f.size + 128) / 4096) * 8192, 0) + (treeMayChange ? Math.ceil(treeBytes / 4096) * 4096 : 0);
    const futureCache = Object.fromEntries(inventory.files.map(f => [f.rel, { stamp: f.stamp, blob: '0'.repeat(40) }]));
    const indexBytes = Buffer.byteLength(JSON.stringify({ cache: futureCache, history: s.history })) + 8192;
    const manifestBytes = Buffer.byteLength(JSON.stringify([...inventory.excluded, ...inventory.files.map(f => f.rel)])) + 8192;
    const metadataGrowth = indexBytes * 2 + manifestBytes;
    if (s.metaBytes + metadataGrowth > limits.metadataBytes) throw new Error('The local snapshot metadata limit has been reached.');
    if (s.bytes + s.metaBytes + needed + metadataGrowth > limits.projectBytes || await totalBytes(s) + needed + metadataGrowth > limits.totalBytes) throw new Error('The local change-tracking storage limit has been reached.');
    // Reserve before writing: an interrupted first capture must still count towards the shared cap.
    if (needed) { s.bytes += needed; s.metaBytes += metadataGrowth; s.reserved = true; await saveIndex(s); }
    phase('reserve');
    const stage = path.resolve(s.base, `capture-${crypto.randomBytes(8).toString('hex')}`);
    if (!within(s.base, stage)) throw new Error('Invalid private snapshot staging folder.');
    await fsp.mkdir(stage, { mode: 0o700 });
    let succeeded = false;
    try {
    const staged = [];
    for (let from = 0; from < changed.length; from += 64) {
      const batch = changed.slice(from, from + 64), attrs = await attributes(batch.map(f => f.abs));
      for (let i = 0; i < batch.length; i++) {
        if (closed) throw new Error('Snapshot tracking stopped.');
        const f = batch[i]; if (!available(attrs[i])) { inventory.excluded.add(f.rel); continue; }
        let handle, content;
        try {
          handle = await fsp.open(f.abs, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
          const opened = await handle.stat({ bigint: true });
          if (!opened.isFile() || signature(opened) !== f.stamp) throw new Error('File changed before capture.');
          const buffer = Buffer.alloc(f.size + 1); let read = 0;
          while (read < buffer.length) { const r = await handle.read(buffer, read, buffer.length - read, read); if (!r.bytesRead) break; read += r.bytesRead; }
          if (read !== f.size || signature(await handle.stat({ bigint: true })) !== f.stamp) throw new Error('File changed during capture.');
          content = buffer.subarray(0, read);
          if (content.includes(0)) { inventory.excluded.add(f.rel); continue; }
        } catch { inventory.excluded.add(f.rel); continue; }
        finally { if (handle) await handle.close(); }
        const file = path.join(stage, String(staged.length));
        await fsp.writeFile(file, content, { flag: 'wx', mode: 0o600 });
        staged.push({ ...f, staged: file });
      }
    }
    phase('stage');
    if (staged.length) {
      // Git reads only our immutable, size-checked copies. Reopening the live source here could
      // hydrate a cloud file, follow a new link, or retain an oversized file despite rejecting it.
      const r = await s.git(['hash-object', '-w', '--no-filters', '--stdin-paths'], { input: staged.map(f => JSON.stringify(f.staged)).join('\n') + '\n' });
      const blobs = r.out.toString().trim().split(/\r?\n/);
      if (!r.ok || blobs.length !== staged.length || blobs.some(x => !/^[0-9a-f]{40}$/.test(x))) throw new Error(r.err.trim() || 'The saved text could not be captured.');
      for (let i = 0; i < staged.length; i++) {
        const f = staged[i];
        entries.push({ ...f, blob: blobs[i] }); cache[f.rel] = { stamp: f.stamp, blob: blobs[i] };
      }
    }
    phase('hash');
    await parallelMap(entries, async f => {
      const st = await fsp.lstat(f.abs, { bigint: true });
      if (signature(st) !== f.stamp || !st.isFile() || st.isSymbolicLink()) throw new Error('Files changed while their snapshot was being read.');
    });
    phase('verify');
    const index = path.join(s.base, `index-${crypto.randomBytes(8).toString('hex')}`), env = { GIT_INDEX_FILE: index };
    const treeInput = entries.map(f => `${f.mode} ${f.blob}\t${f.rel}\0`).sort().join(''), fingerprint = keyOf(treeInput);
    let tree = s.tree && s.tree.fingerprint === fingerprint ? s.tree.hash : null;
    if (!tree) {
    try {
      const empty = await s.git(['read-tree', '--empty'], { env }); if (!empty.ok) throw new Error(empty.err.trim());
      if (entries.length) { const update = await s.git(['update-index', '-z', '--index-info'], { env, input: treeInput }); if (!update.ok) throw new Error(update.err.trim()); }
      const write = await s.git(['write-tree'], { env }); if (!write.ok) throw new Error(write.err.trim()); tree = write.out.toString().trim();
    } finally { await fsp.unlink(index).catch(() => {}); await fsp.unlink(`${index}.lock`).catch(() => {}); }
    }
    phase('tree');
    const manifest = { version: VERSION, root: s.owner.root, tree, excluded: [...inventory.excluded].sort() }, id = keyOf(JSON.stringify(manifest));
    if (!s.history.some(h => h.id === id)) {
      await atomic(path.join(s.base, 'manifests', `${id}.json`), JSON.stringify(manifest));
      const ref = await s.git(['update-ref', `refs/snapshots/${id}`, tree]); if (!ref.ok) throw new Error(ref.err.trim());
    }
    s.cache = cache;
    s.tree = { fingerprint, hash: tree };
    s.history = s.history.filter(h => h.id !== id); s.history.push({ id, at: Date.now() });
    if (needed) await countBytes(s);
    s.reserved = false;
    await saveIndex(s);
    s.metaBytes = await metadataSize(s); await saveIndex(s);
    phase('save');
    succeeded = true;
    return `${PREFIX}${s.id}:${id}`;
    } finally {
      await fsp.rm(stage, { recursive: true, force: true });
      if (!succeeded) {
        // A rejected capture has no refs. Remove its objects so repeated failures cannot fill the
        // quota permanently; active and historical baselines are protected by their refs.
        await s.git(['prune', '--expire=now']);
        await countBytes(s); s.reserved = false;
        s.metaBytes = await metadataSize(s);
        await saveIndex(s).catch(() => {});
      }
    }
  }
  function capture(root, { fresh = false } = {}) {
    const key = normalized(root);
    const missed = unavailable.get(key);
    if (missed && Date.now() < missed.until) return Promise.reject(missed.error);
    unavailable.delete(key);
    if (pending.has(key)) return fresh ? pending.get(key).catch(() => {}).then(() => capture(root)) : pending.get(key);
    const job = tail.then(() => captureNow(root)).catch(error => {
      // A 300,000-file folder stays too large between messages. Back off instead of walking it
      // again on every send; transient edits during a capture can be retried immediately.
      const delay = /too many entries|too many text files/.test(error.message) ? 10 * 60000
        : /takes too long|too much text|storage limit|metadata limit|cloud-only/.test(error.message) ? 60000 : 0;
      if (delay) { unavailable.set(key, { error, until: Date.now() + delay }); if (unavailable.size > 128) unavailable.delete(unavailable.keys().next().value); }
      throw error;
    });
    tail = job.catch(() => {});
    pending.set(key, job);
    job.finally(() => { if (pending.get(key) === job) pending.delete(key); }).catch(() => {});
    return job;
  }
  async function resolve(root, ref) {
    const m = String(ref).match(/^shadow:v1:([a-f0-9]{64}):([a-f0-9]{64})$/);
    if (!m) throw new Error('That local snapshot is invalid.');
    const s = await stateFor(root);
    if (m[1] !== s.id) throw new Error('That snapshot belongs to another project.');
    let manifest;
    try { manifest = await readJSON(path.join(s.base, 'manifests', `${m[2]}.json`)); }
    catch { throw new Error('That local snapshot has expired or is unavailable.'); }
    if (keyOf(JSON.stringify(manifest)) !== m[2] || manifest.version !== VERSION || manifest.root !== s.owner.root || !/^[a-f0-9]{40}$/.test(manifest.tree) || !Array.isArray(manifest.excluded) || manifest.excluded.some(p => !relativeOK(p))) throw new Error('That local snapshot is damaged.');
    return { ...manifest, gitDir: s.gitDir, env: cleanEnv(), root: s.root };
  }
  async function currentAllowed(root, files) {
    const blocked = new Map(), parents = new Set([path.resolve(root)]);
    blocked.checked = new Map();
    for (const file of files) {
      if (!eligible(file) || !within(root, file)) { blocked.set(file, 'not covered by text snapshots'); continue; }
      let parent = path.dirname(path.resolve(root, file));
      while (parent !== path.resolve(root)) { parents.add(parent); parent = path.dirname(parent); }
    }
    const paths = [...parents], attrs = await attributes(paths);
    const badParents = [];
    for (let i = 0; i < paths.length; i++) {
      const st = await fsp.lstat(paths[i]).catch(err => err.code === 'ENOENT' ? null : false);
      if (st === null) continue;
      if (!available(attrs[i]) || !st || !st.isDirectory() || st.isSymbolicLink()) badParents.push(paths[i]);
    }
    const absolute = files.map(f => path.resolve(root, f)), fileAttrs = await attributes(absolute);
    for (let i = 0; i < files.length; i++) {
      const file = files[i], abs = absolute[i]; if (blocked.has(file)) continue;
      if (badParents.some(p => abs === p || within(p, abs))) { blocked.set(file, 'a parent folder is unavailable or is a link'); continue; }
      const st = await fsp.lstat(abs).catch(err => err.code === 'ENOENT' ? null : false);
      if (st === null) { blocked.checked.set(file, null); continue; }
      if (!available(fileAttrs[i]) || !st || !st.isFile() || st.isSymbolicLink() || st.size > limits.fileBytes) { blocked.set(file, 'the current file is not covered by text snapshots'); continue; }
      let h;
      try {
        h = await fsp.open(abs, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        const opened = await h.stat({ bigint: true });
        if (!opened.isFile() || opened.size > BigInt(limits.fileBytes)) throw new Error('File changed before checking.');
        const b = Buffer.alloc(Number(opened.size) + 1); let read = 0;
        while (read < b.length) { const r = await h.read(b, read, b.length - read, read); if (!r.bytesRead) break; read += r.bytesRead; }
        if (read !== Number(opened.size) || signature(await h.stat({ bigint: true })) !== signature(opened)) throw new Error('File changed during checking.');
        if (b.subarray(0, read).includes(0)) blocked.set(file, 'the current file is binary');
        else blocked.checked.set(file, { stamp: signature(opened),
          blob: crypto.createHash('sha1').update(`blob ${read}\0`).update(b.subarray(0, read)).digest('hex'),
          mode: process.platform !== 'win32' && opened.mode & 0o100n ? '100755' : '100644' });
      }
      catch { blocked.set(file, 'the current file could not be checked'); }
      finally { if (h) await h.close(); }
    }
    return blocked;
  }
  function stillChecked(root, file, checked) {
    try {
      const st = fs.lstatSync(path.resolve(root, file), { bigint: true });
      return !!checked && st.isFile() && !st.isSymbolicLink() && signature(st) === checked.stamp;
    } catch (err) { return err.code === 'ENOENT' && checked === null; }
  }
  const comparePath = file => { const p = file.replace(/\\/g, '/'); return process.platform === 'win32' ? p.toLowerCase() : p; };
  const covered = (manifest, file) => eligible(file) && !manifest.excluded.some(p => {
    const blocked = comparePath(p), candidate = comparePath(file);
    return candidate === blocked || candidate.startsWith(`${blocked}/`);
  });
  const pin = ref => {
    if (closed || !/^shadow:v1:[a-f0-9]{64}:[a-f0-9]{64}$/.test(ref)) throw new Error('That local snapshot cannot be kept active.');
    const n = pins.get(ref) || 0; pins.set(ref, n + 1);
    try { savePins(); } catch (err) { if (n) pins.set(ref, n); else pins.delete(ref); throw err; }
  };
  const release = ref => {
    const n = pins.get(ref) || 0; if (n <= 1) pins.delete(ref); else pins.set(ref, n - 1);
    try { savePins(); } catch (err) { log(`Could not release a local snapshot: ${err.message}`); }
  };
  function close() { closed = true; if (worker) worker.stop(); pins.clear(); try { savePins(); } catch { /* conservative stale pin until this process exits */ } return tail; }
  return { capture, resolve, covered, currentAllowed, stillChecked, pin, release, close, limits, attributes, broad };
}

module.exports = { createShadowStore, isShadow: ref => typeof ref === 'string' && ref.startsWith(PREFIX), eligible, broad, LIMITS };
