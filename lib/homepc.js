'use strict';
// A laptop's side of "Your home PC" (lib/mirror.js is the PC's side). Paired once, through the PC's
// phone access (over your Wi-Fi, or Tailscale when you're away):
//
//  - The app's window can show your home PC's Session Switcher: every chat, project and account, run on
//    the PC with its storage. It goes through a small relay on this computer (127.0.0.1 only) that adds
//    the pairing key, so the key never sits in a web page.
//  - "Copy from my PC" brings your projects, chats and settings here, at the same folders, so the laptop
//    can carry on by itself when the PC is off. Run again, it only fetches what changed.
//  - "Send my work to the PC" takes back what you did here. Nothing is deleted on either side, and a file
//    changed in both places keeps both versions.
//  - Drives this computer doesn't have (the PC's D:, say) are stood in for by a folder with that drive
//    letter (Windows' subst), so every path stays the same and every chat opens.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const readline = require('readline');
const { execFile } = require('child_process');
const store = require('./store');
const mirror = require('./mirror');

const IS_WIN = process.platform === 'win32';
const PHONE_PORT = 4788;
const MIRROR_HEADERS = { 'X-Switcher-Mirror': '1' };
const ORDER = { claude: 0, gemini: 1, codex: 2, project: 3, app: 4 };
const BIG = 1024 ** 3;
const { ONE_STEP } = mirror;
// Tailscale's addresses (100.64.0.0/10) reach the PC from anywhere; a home network's only from home.
const isTailscale = a => { const m = /^100\.(\d+)\./.exec(String(a || '')); return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127; };

// Files copied in for Session Switcher itself wait here until it next starts (the running copy keeps
// its own in memory and would write over them).
function applyIncoming(dataDir, log = () => {}) {
  const inc = path.join(dataDir, 'home-pc', 'incoming');
  if (!fs.existsSync(inc)) return 0;
  let n = 0;
  const move = (from, to) => {
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      const a = path.join(from, e.name), b = path.join(to, e.name);
      if (e.isDirectory()) { fs.mkdirSync(b, { recursive: true }); move(a, b); }
      else if (e.isFile()) { try { fs.rmSync(b, { force: true }); fs.renameSync(a, b); n++; } catch (err) { log(`Home PC: couldn’t put ${b} in place: ${err.message}`); } }
    }
  };
  try { move(inc, dataDir); fs.rmSync(inc, { recursive: true, force: true }); } catch (err) { log(`Home PC: ${err.message}`); }
  if (n) log(`Home PC: put in place ${n} settings files copied from the PC.`);
  return n;
}

function createHomePc({ dataDir, log = () => {}, proxyPort, tailscale = null, onChange = () => {}, home = os.homedir() }) {
  // Nothing is made on a computer that never pairs: its folder appears with the first copy.
  const dir = path.join(dataDir, 'home-pc');
  const file = path.join(dataDir, 'home-pc.json');
  let st = store.loadOwnJson(file, null, log) || {};
  const save = () => { try { store.writeJsonAtomic(file, st); } catch (err) { log(`Home PC: couldn’t save: ${err.message}`); } };
  const agent = new http.Agent({ keepAlive: true, maxSockets: 12 });
  const relayAgent = new http.Agent({ keepAlive: true });
  let job = null, showing = { on: 'laptop', reason: null }, health = { up: null, at: 0, version: null, paired: null };

  /* ---------- talking to the PC ---------- */
  function request(pathname, { method = 'GET', headers = {}, timeout = 15000, body = null, key = st.key, address = st.address, port = st.port } = {}) {
    return new Promise((resolve, reject) => {
      if (!address) return reject(Object.assign(new Error('No home PC is paired yet.'), { status: 409 }));
      const req = http.request({ host: address, port: port || PHONE_PORT, method, path: pathname, agent, timeout, headers: { ...(key ? { Cookie: `sw_device=${key}` } : {}), ...headers } }, resolve);
      req.on('timeout', () => req.destroy(Object.assign(new Error('Your home PC didn’t answer.'), { code: 'ETIMEDOUT' })));
      req.on('error', reject);
      if (body && typeof body.pipe === 'function') body.pipe(req); else req.end(body || undefined);
    });
  }
  const readAll = res => new Promise((resolve, reject) => { let s = ''; res.setEncoding('utf8'); res.on('data', d => { s += d; }); res.on('end', () => resolve(s)); res.on('error', reject); });
  async function json(pathname, opts = {}) {
    const res = await request(pathname, { ...opts, headers: { ...MIRROR_HEADERS, ...(opts.headers || {}) } });
    const text = await readAll(res);
    let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
    if (res.statusCode >= 400) throw Object.assign(new Error((j && j.error) || `Your home PC said ${res.statusCode}.`), { status: res.statusCode, reason: j && j.reason });
    return j;
  }
  // Is the PC there, and does it still know this laptop?
  async function probe() {
    try {
      const res = await request('/hello', { timeout: 4000 });
      const j = JSON.parse(await readAll(res));
      health = { up: j.app === 'session-switcher', paired: !!j.paired, version: j.version || null, at: Date.now() };
    } catch { health = { up: false, paired: null, version: health.version, at: Date.now() }; }
    return health;
  }

  // Tailscale's other devices that answer as Session Switcher, so you needn't type an address.
  async function find() {
    const out = [];
    if (tailscale) {
      const r = await tailscale(['status', '--json']);
      let j = {};
      try { j = JSON.parse(r.out.slice(r.out.indexOf('{'))); } catch { /* not running */ }
      const peers = Object.values(j.Peer || {}).filter(p => p && p.Online !== false);
      await Promise.all(peers.map(async p => {
        const ip = (p.TailscaleIPs || []).find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a));
        if (!ip) return;
        try {
          const res = await request('/hello', { address: ip, port: PHONE_PORT, key: null, timeout: 3000 });
          const h = JSON.parse(await readAll(res));
          if (h.app === 'session-switcher') out.push({ name: String(p.HostName || p.DNSName || ip), address: ip, port: PHONE_PORT, version: h.version || null, tailscale: true });
        } catch { /* not this one */ }
      }));
      if (r.missing) return { found: out, tailscale: false };
    }
    return { found: out.sort((a, b) => a.name.localeCompare(b.name)), tailscale: !!tailscale };
  }

  // Your PC among this laptop's Tailscale devices: the one that knows this laptop's key.
  async function twin() {
    if (!tailscale) return null;
    const { found } = await find();
    for (const f of found) {
      try { const h = JSON.parse(await readAll(await request('/hello', { address: f.address, port: f.port, timeout: 3000 }))); if (h.paired) return f; } catch { /* not it */ }
    }
    return null;
  }
  async function pair({ address, port = PHONE_PORT, code }) {
    const a = String(address || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const m = /^(.+?)(?::(\d+))?$/.exec(a);
    if (!m || !/^[\w.-]+$/.test(m[1])) throw Object.assign(new Error('That doesn’t look like an address. Pick your PC from the list, or type its Tailscale address (like 100.101.102.103).'), { status: 400 });
    const host = m[1], p = Number(m[2] || port) || PHONE_PORT;
    let hello;
    try { hello = JSON.parse(await readAll(await request('/hello', { address: host, port: p, key: null, timeout: 6000 }))); } catch { throw Object.assign(new Error(`Nothing answered at ${host}:${p}. Is the PC on, with Session Switcher running and phone access turned on?`), { status: 502 }); }
    if (hello.app !== 'session-switcher') throw Object.assign(new Error('Something answered there, but it isn’t Session Switcher.'), { status: 502 });
    const q = new URLSearchParams({ code: String(code || ''), name: os.hostname().slice(0, 40) });
    const res = await request(`/pair?${q}`, { address: host, port: p, key: null, timeout: 8000 });
    const text = await readAll(res);
    const cookie = [].concat(res.headers['set-cookie'] || []).map(c => /sw_device=([^;]+)/.exec(c)).find(Boolean);
    if (!cookie) {
      const why = /<p>([^<]+)<\/p>/.exec(text);
      throw Object.assign(new Error(why ? why[1].replace(/&#39;|&rsquo;/g, '’') : 'Your PC didn’t take that code.'), { status: 403 });
    }
    st = { ...st, address: host, port: p, key: decodeURIComponent(cookie[1]), pcName: null, pcPlatform: null, pcVersion: hello.version || null, pairedAt: Date.now(), use: st.use || 'pc' };
    save();
    // Its name and kind, when it lets this laptop copy (that's off on the PC until turned on there): the window works either way.
    try { const pl = await json('/api/mirror/plan'); st.pcName = pl.pc || null; st.pcPlatform = pl.platform || null; save(); } catch { /* copying is off there, or it's an older copy */ }
    // Paired over your home Wi-Fi: the same PC on Tailscale works away from home too (and at home, about as fast).
    if (!isTailscale(host)) { const ts = await twin(); if (ts) { st.address = ts.address; st.port = ts.port; save(); } }
    log(`Home PC: paired with ${st.address}:${st.port}.`);
    startRelay();
    onChange();
    return status();
  }
  function forget() { st = { use: 'laptop', drives: st.drives || {}, ...(st.ack ? { ack: st.ack } : {}) }; showing = { on: 'laptop', reason: null }; save(); log('Home PC: forgotten.'); onChange(); return status(); }
  function setUse(use) { st.use = use === 'pc' ? 'pc' : 'laptop'; save(); onChange(); return status(); }
  function setShowing(v) { showing = { on: v && v.on === 'pc' ? 'pc' : 'laptop', reason: (v && v.reason) || null, at: Date.now() }; onChange(); return status(); }

  function status() {
    return {
      paired: !!st.key, address: st.address || null, tailscale: isTailscale(st.address), port: st.port || null, pcName: st.pcName || null, pcVersion: health.version || st.pcVersion || null,
      platform: process.platform, pcPlatform: st.pcPlatform || null,
      up: health.up, stillPaired: health.paired, checkedAt: health.at, use: st.use || 'laptop', showing, relay: proxyPort ? `http://127.0.0.1:${proxyPort}/` : null,
      lastDown: st.lastDown || null, lastUp: st.lastUp || null, drives: st.drives || {}, job: job && publicJob(),
    };
  }
  const publicJob = () => { const { stop, ...rest } = job; return { ...rest, errors: rest.errors.slice(0, 20), errorCount: rest.errors.length }; };

  /* ---------- the relay the window uses ---------- */
  let relay = null;
  function startRelay() {
    if (!proxyPort || relay) return;
    const own = new Set([`127.0.0.1:${proxyPort}`, `localhost:${proxyPort}`]);
    relay = http.createServer((req, res) => {
      if (!own.has(req.headers.host || '')) { res.writeHead(403); return res.end('Forbidden'); }
      if (!st.key) { res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No home PC is paired on this laptop.'); }
      // The PC's "pair again" page: the code is used here, so the key stays with this laptop.
      if (req.method === 'GET' && req.url.startsWith('/pair?')) {
        const q = new URL(req.url, 'http://x').searchParams;
        pair({ address: st.address, port: st.port, code: q.get('code') })
          .then(() => { res.writeHead(302, { Location: '/' }); res.end(); })
          .catch(err => { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(err.message); });
        return undefined;
      }
      const target = `${st.address}:${st.port || PHONE_PORT}`;
      const headers = { ...req.headers, host: target, cookie: `sw_device=${st.key}` };
      delete headers['x-switcher-mirror']; delete headers.referer;
      // Only this window's own requests are passed off as the PC's page; anything else keeps its origin (and is refused there).
      if (headers.origin && (headers.origin === `http://127.0.0.1:${proxyPort}` || headers.origin === `http://localhost:${proxyPort}`)) headers.origin = `http://${target}`;
      const up = http.request({ host: st.address, port: st.port || PHONE_PORT, method: req.method, path: req.url, headers, agent: relayAgent }, pres => {
        const h = { ...pres.headers };
        delete h['set-cookie'];
        if (h.location) h.location = String(h.location).replace(`http://${target}`, '');
        res.writeHead(pres.statusCode, h);
        pres.pipe(res);
      });
      up.setTimeout(20000, () => { if (!res.headersSent) up.destroy(new Error('timeout')); });
      up.on('error', () => {
        if (res.headersSent) { res.destroy(); return; }
        if (req.url.startsWith('/api/')) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Your home PC isn’t answering.', reason: 'offline' })); return; }
        res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0a090c;color:#cfc6b6;font:16px Georgia,serif"><div style="text-align:center;max-width:420px"><p>Your home PC isn’t answering.</p><p style="color:#9a928a;font-size:14px">The app switches to this laptop by itself in a moment.</p></div>');
      });
      res.on('close', () => { if (!res.writableFinished) up.destroy(); });
      req.pipe(up);
      return undefined;
    });
    relay.on('error', err => { log(`Home PC relay couldn’t listen on ${proxyPort}: ${err.message}`); relay = null; });
    relay.listen(proxyPort, '127.0.0.1');
  }

  /* ---------- where things go on this computer ---------- */
  const localHome = path.resolve(home);
  function localRoot(root, plan) {
    if (root.kind === 'app') return dataDir;
    if (mirror.inside(plan.home, root.path)) return path.join(localHome, path.relative(plan.home, root.path));
    return root.path;
  }
  const incomingRoot = () => path.join(dir, 'incoming');
  const partsOf = rel => rel.split('/');
  // A drive the PC has and this computer doesn't: a folder stands in for it, under the same letter.
  async function ensureDrive(p) {
    if (!IS_WIN) return true;
    const m = /^([A-Za-z]):[\\/]/.exec(p);
    if (!m) return true;
    const letter = m[1].toUpperCase();
    if (fs.existsSync(`${letter}:\\`)) return true;
    const base = path.join(localHome, 'Home PC drives', letter);
    fs.mkdirSync(base, { recursive: true });
    await new Promise(resolve => execFile('subst', [`${letter}:`, base], { windowsHide: true, timeout: 10000 }, () => resolve()));
    if (!fs.existsSync(`${letter}:\\`)) return false;
    st.drives = { ...(st.drives || {}), [letter]: base }; save();
    log(`Home PC: ${letter}: on this laptop is ${base}.`);
    return true;
  }
  // Stand-ins don't survive a restart of Windows; put them back when the app starts.
  async function restoreDrives() {
    for (const [letter, base] of Object.entries(st.drives || {})) {
      if (fs.existsSync(`${letter}:\\`) || !fs.existsSync(base)) continue;
      await new Promise(resolve => execFile('subst', [`${letter}:`, base], { windowsHide: true, timeout: 10000 }, () => resolve()));
    }
  }
  // OneDrive on this laptop would upload whatever lands in its folders.
  async function oneDriveFolders() {
    if (!IS_WIN) return [];
    const dirs = [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial].filter(Boolean).map(p => path.resolve(p));
    if (!dirs.length) return [];
    const running = await new Promise(resolve => execFile('tasklist', ['/FI', 'IMAGENAME eq OneDrive.exe', '/NH'], { windowsHide: true, timeout: 8000 }, (_e, out) => resolve(/OneDrive\.exe/i.test(String(out || '')))));
    return running ? [...new Set(dirs)] : [];
  }

  /* ---------- records: what each file was the last time it was copied ---------- */
  // files[rel] = [PC size, PC modified, laptop size, laptop modified]
  const recFile = id => path.join(dir, 'records', `${id.replace(/[^\w-]/g, '')}.json`);
  const loadRecs = id => { try { const j = JSON.parse(fs.readFileSync(recFile(id), 'utf8')); return j && j.files ? j : { files: {} }; } catch { return { files: {} }; } };
  const saveRecs = (id, r) => { try { fs.mkdirSync(path.join(dir, 'records'), { recursive: true }); store.writeJsonAtomic(recFile(id), r); } catch (err) { log(`Home PC: couldn’t save the copy records: ${err.message}`); } };
  const near = (a, b) => Math.abs(Number(a) - Number(b)) <= 2;

  /* ---------- copying ---------- */
  function newJob(dirn) {
    job = { dir: dirn, all: false, bigLater: 0, bigLaterBytes: 0, state: 'running', startedAt: Date.now(), endedAt: null, root: null, roots: [], listed: 0, listedBytes: 0, done: 0, doneBytes: 0, same: 0, keptHere: 0, conflicts: 0, skipped: 0, errors: [], current: '', needsRestart: false, warn: null, stop: false };
    onChange();
    return job;
  }
  const stopped = () => !job || job.stop;
  const noteErr = (rel, err) => { job.errors.push({ p: rel, error: String(err && err.message || err).slice(0, 200) }); };

  // A worker pool: tasks wait in a short line, so listing 300,000 files doesn't hold them all at once.
  function pool(n) {
    const line = [];
    let active = 0, waiters = [], idle = [];
    const pump = () => {
      while (active < n && line.length) {
        const t = line.shift(); active++;
        t().catch(() => {}).finally(() => { active--; pump(); if (line.length < 200) { const w = waiters; waiters = []; w.forEach(f => f()); } if (!active && !line.length) { const i = idle; idle = []; i.forEach(f => f()); } });
      }
    };
    return {
      async add(t) { line.push(t); pump(); if (line.length > 1000) await new Promise(r => waiters.push(r)); },
      done: () => (active || line.length ? new Promise(r => idle.push(r)) : Promise.resolve()),
    };
  }

  async function fetchFile(root, e, target, { sqlite = false, attempt = 0 } = {}) {
    const part = `${target}.ssmirror-part`, meta = `${part}.json`;
    const base = `${e.s}:${e.m}`;
    let start = 0;
    try { if (fs.readFileSync(meta, 'utf8') === base) start = fs.statSync(part).size; } catch { /* starts afresh */ }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const q = new URLSearchParams({ root: root.id, p: e.p });
    // A database is snapshotted on the PC first, which takes a while for a big one.
    const res = await request(`/api/mirror/file?${q}`, { headers: { ...MIRROR_HEADERS, ...(start ? { Range: `bytes=${start}-` } : {}) }, timeout: /\.(sqlite3?|db)$/i.test(e.p) ? 45 * 60000 : 120000 });
    if (res.statusCode >= 400) { const t = await readAll(res); let msg = `The PC said ${res.statusCode}.`; try { msg = JSON.parse(t).error || msg; } catch { /* plain */ } throw new Error(msg); }
    const from = Number(res.headers['x-mirror-start']) || 0;
    if (from !== start) start = 0;
    const stat = String(res.headers['x-mirror-stat'] || base), size = Number(res.headers['x-mirror-size']);
    fs.writeFileSync(meta, stat);
    let got = 0;
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(part, { flags: start ? 'a' : 'w' });
      res.on('data', c => { got += c.length; job.doneBytes += c.length; if (stopped()) res.destroy(new Error('Stopped.')); });
      res.on('error', reject);
      out.on('error', reject);
      res.pipe(out);
      out.on('finish', resolve);
      res.on('aborted', () => reject(new Error('The connection to your PC dropped.')));
    });
    const after = res.trailers && res.trailers['x-mirror-after'];
    if (Number.isFinite(size) && start + got !== size) throw new Error('Only part of the file arrived.');
    if (after && after !== stat) {
      // It changed while it came (a chat writing to it): once more, from the start.
      fs.rmSync(part, { force: true }); fs.rmSync(meta, { force: true });
      if (attempt < 2) return fetchFile(root, e, target, { sqlite, attempt: attempt + 1 });
      throw new Error('It kept changing while it was copied. It’ll be copied next time.');
    }
    if (sqlite || mirror.isSqlite(part)) for (const side of ['-wal', '-shm', '-journal']) { if (fs.existsSync(target + side)) { try { fs.rmSync(target + side); } catch { throw new Error('It’s in use on this laptop. Close what’s using it and copy again.'); } } }
    await mirror.moveIntoPlace(part, target);
    fs.rmSync(meta, { force: true });
    const [s, m] = stat.split(':').map(Number);
    try { fs.utimesSync(target, new Date(), new Date(m)); } catch { /* keeps now */ }
    return { s, m };
  }

  // Session Switcher's settings, as they should be here: phone access, and letting a laptop copy, stay the PC's.
  function fixAppFile(rel, file) {
    if (rel !== 'accounts.json') return;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (j.prefs && j.prefs.phone) j.prefs.phone.enabled = false;
      if (j.prefs && j.prefs.homePcShare) j.prefs.homePcShare = false;
      const t = fs.statSync(file).mtime;
      fs.writeFileSync(file, JSON.stringify(j, null, 2));
      fs.utimesSync(file, new Date(), t);
    } catch { /* left as it came */ }
  }

  async function downRoot(root, plan) {
    const local = localRoot(root, plan);
    const recs = loadRecs(root.id);
    job.root = root.label;
    if (root.kind === 'project' && !(await ensureDrive(local))) { noteErr(root.label, new Error(`This laptop has no ${local.slice(0, 2)} drive, and a stand-in couldn’t be made.`)); return; }
    const q = new URLSearchParams({ root: root.id });
    const res = await request(`/api/mirror/list?${q}`, { headers: MIRROR_HEADERS, timeout: 300000 });
    if (res.statusCode >= 400) { let msg = `The PC said ${res.statusCode}.`; try { msg = JSON.parse(await readAll(res)).error || msg; } catch { /* plain */ } noteErr(root.label, new Error(msg)); return; }
    const work = pool(root.kind === 'app' ? 2 : 6);
    let lastSave = Date.now();
    const rl = readline.createInterface({ input: res, crlfDelay: Infinity });
    for await (const line of rl) {
      if (stopped()) { res.destroy(); break; }
      if (!line) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.done) break;
      job.listed++; job.listedBytes += e.s;
      const here = path.join(local, ...partsOf(e.p));
      const target0 = root.kind === 'app' ? path.join(incomingRoot(), ...partsOf(e.p)) : here;
      const rec = recs.files[e.p];
      let lst = null;
      try { lst = await fs.promises.stat(here); if (!lst.isFile()) { job.skipped++; continue; } } catch { /* not here yet */ }
      const pcChanged = !rec || rec[0] !== e.s || rec[1] !== e.m;
      const hereChanged = !!(lst && rec && (lst.size !== rec[2] || !near(Math.floor(lst.mtimeMs), rec[3])));
      if (!pcChanged && lst && !hereChanged) { job.same++; continue; }
      if (!pcChanged && hereChanged) { job.keptHere++; continue; }
      // A big file that changed again (Codex's history, say) waits for a full copy, at home: from away it would take hours.
      if (pcChanged && rec && e.s > BIG && !job.all) { job.bigLater++; job.bigLaterBytes += e.s; continue; }
      let target = target0, keepHere = false, beside = false;
      if (pcChanged && lst && !rec) {
        if (lst.size === e.s && Math.abs(lst.mtimeMs - e.m) <= 2000) { recs.files[e.p] = [e.s, e.m, lst.size, Math.floor(lst.mtimeMs)]; job.same++; continue; }
        if (root.kind === 'project') keepHere = true;
      } else if (pcChanged && hereChanged) {
        if (root.kind !== 'project') { job.conflicts++; continue; }   // a tool's file changed here too: this laptop's stays
        beside = true; job.conflicts++;
      }
      // A database Codex or agy has open here can't be swapped under it.
      await work.add(async () => {
        if (stopped()) return;
        job.current = e.p;
        try {
          if (beside) target = mirror.besideName(here, 'PC');
          if (keepHere) await mirror.moveIntoPlace(here, mirror.besideName(here, 'laptop'));
          const got = await fetchFile(root, e, target);
          if (root.kind === 'app') { fixAppFile(e.p, target); job.needsRestart = true; }
          if (!beside) { const now = fs.statSync(target); recs.files[e.p] = [got.s, got.m, now.size, Math.floor(now.mtimeMs)]; }
          else if (rec) recs.files[e.p] = [e.s, e.m, rec[2], rec[3]];
          job.done++;
        } catch (err) { noteErr(`${root.label}/${e.p}`, err); }
        if (Date.now() - lastSave > 20000) { lastSave = Date.now(); saveRecs(root.id, recs); }
      });
    }
    await work.done();
    saveRecs(root.id, recs);
  }

  // Claude's own list of MCP servers and trusted folders lives in ~/.claude.json, next to this laptop's
  // sign-in: only what's missing here is added.
  function mergeClaude(extras) {
    if (!extras) return;
    const f = path.join(localHome, '.claude.json');
    let j = {};
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (err) { if (fs.existsSync(f)) return; }
    let changed = false;
    j.mcpServers = j.mcpServers || {};
    for (const [k, v] of Object.entries(extras.mcpServers || {})) if (!(k in j.mcpServers)) { j.mcpServers[k] = v; changed = true; }
    j.projects = j.projects || {};
    for (const [k, v] of Object.entries(extras.projects || {})) if (!(k in j.projects)) { j.projects[k] = v; changed = true; }
    if (!changed) return;
    try { fs.copyFileSync(f, `${f}.home-pc-bak`); } catch { /* there was none */ }
    fs.writeFileSync(f, JSON.stringify(j, null, 2));
    log('Home PC: added your MCP servers and trusted folders to this laptop’s Claude.');
  }

  async function copyDown({ force = false, all = false } = {}) {
    if (job && job.state === 'running') throw Object.assign(new Error('A copy is already going.'), { status: 409 });
    newJob('down');
    job.all = !!all;
    let began = false;
    try {
      const plan = await json('/api/mirror/plan', { timeout: 60000 });
      st.pcName = plan.pc || st.pcName; st.pcPlatform = plan.platform || st.pcPlatform; save();
      if (plan.platform !== process.platform) throw new Error('Your home PC and this computer aren’t the same kind (one is Windows, the other a Mac), so its folders can’t be copied here as they are. Using the PC in this window works all the same.');
      const roots = [...plan.roots].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
      job.roots = roots.map(r => r.label);
      // Two things to know before a first copy. "Copy anyway" (force) goes on, and is remembered: the same
      // warning isn't raised again.
      const warn = {}, ack = st.ack || {};
      // OneDrive here would upload your projects to the cloud as they arrive.
      const od = await oneDriveFolders();
      const hit = od.filter(d => roots.some(r => r.kind === 'project' && mirror.inside(d, localRoot(r, plan))));
      // Chats are recorded under their folder's full name: with another user folder here, the PC's won't open.
      const otherHome = !!plan.home && !mirror.same(path.resolve(plan.home), localHome);
      const sig = { oneDrive: hit.join('|'), homes: `${plan.home}|${localHome}` };
      if (hit.length && ack.oneDrive !== sig.oneDrive) warn.oneDrive = hit;
      if (otherHome && ack.homes !== sig.homes) warn.homes = { pc: plan.home, here: localHome };
      if (Object.keys(warn).length) {
        if (!force) { job.state = 'blocked'; job.warn = warn; job.endedAt = Date.now(); onChange(); return publicJob(); }
        st.ack = { ...ack, ...Object.fromEntries(Object.keys(warn).map(k => [k, sig[k]])) };
      }
      st.lastPlan = plan; save();
      began = true;
      for (const r of roots) { if (stopped()) break; try { await downRoot(r, plan); } catch (err) { noteErr(r.label, err); } }
      try { mergeClaude(plan.claude); } catch (err) { noteErr('Claude settings', err); }
      job.state = stopped() ? 'stopped' : 'done';
    } catch (err) { job.state = 'failed'; noteErr('', err); }
    job.endedAt = Date.now(); job.current = '';
    // A copy that never got going (the PC refused, or isn't the same kind) isn't "the last copy".
    if (began) st.lastDown = { at: job.endedAt, state: job.state, files: job.done, bytes: job.doneBytes, conflicts: job.conflicts, errors: job.errors.length, needsRestart: job.needsRestart, bigLater: job.bigLater, bigLaterBytes: job.bigLaterBytes };
    save(); onChange();
    log(`Home PC: copy from the PC ${job.state}: ${job.done} files, ${Math.round(job.doneBytes / 1e6)} MB, ${job.errors.length} problems.`);
    return publicJob();
  }

  async function sendFile(root, f, rec, local) {
    const abs = path.join(local, ...partsOf(f.p));
    let src = abs, tmpSnap = null;
    if (mirror.isSqlite(abs)) {
      const out = path.join(os.tmpdir(), `ss-up-${process.pid}-${Date.now()}.sqlite`);
      const { DatabaseSync, backup } = require('node:sqlite');
      const db = new DatabaseSync(abs, { readOnly: true });
      try { await backup(db, out, { rate: ONE_STEP }); } finally { db.close(); }
      src = tmpSnap = out;
    }
    try {
      const size = fs.statSync(src).size;
      const q = new URLSearchParams({ root: root.id, p: f.p, base: rec && rec[0] >= 0 ? `${rec[0]}:${rec[1]}` : 'new', mtime: String(f.m) });
      const body = fs.createReadStream(src);
      body.on('data', c => { job.doneBytes += c.length; });
      const res = await request(`/api/mirror/file?${q}`, { method: 'PUT', headers: { ...MIRROR_HEADERS, 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) }, body, timeout: 300000 });
      const text = await readAll(res);
      let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
      if (res.statusCode >= 400 || !j) throw new Error((j && j.error) || `The PC said ${res.statusCode}.`);
      return j;
    } finally { if (tmpSnap) fs.rm(tmpSnap, { force: true }, () => {}); }
  }

  async function copyUp() {
    if (job && job.state === 'running') throw Object.assign(new Error('A copy is already going.'), { status: 409 });
    const plan = st.lastPlan;
    if (!plan) throw Object.assign(new Error('Copy from your PC first: then this laptop knows which folders are whose.'), { status: 409 });
    newJob('up');
    try {
      await json('/api/mirror/plan', { timeout: 30000 });   // the PC is there and still knows this laptop
      const roots = plan.roots.filter(r => r.kind !== 'app').sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
      job.roots = roots.map(r => r.label);
      for (const root of roots) {
        if (stopped()) break;
        job.root = root.label;
        const local = localRoot(root, plan);
        if (!fs.existsSync(local)) continue;
        const recs = loadRecs(root.id);
        const work = pool(4);
        for await (const f of mirror.walk(local, root.kind)) {
          if (stopped()) break;
          if (!mirror.mayGoUp(root.kind, f.p)) continue;
          job.listed++;
          const rec = recs.files[f.p];
          if (rec && f.s === rec[2] && near(f.m, rec[3])) { job.same++; continue; }
          job.listedBytes += f.s;
          await work.add(async () => {
            if (stopped()) return;
            job.current = f.p;
            try {
              const r = await sendFile(root, f, rec, local);
              if (r.conflict) { job.conflicts++; recs.files[f.p] = [rec ? rec[0] : -1, rec ? rec[1] : -1, f.s, f.m]; }
              else recs.files[f.p] = [r.s, r.m, f.s, f.m];
              job.done++;
            } catch (err) { noteErr(`${root.label}/${f.p}`, err); }
          });
        }
        await work.done();
        saveRecs(root.id, recs);
      }
      job.state = stopped() ? 'stopped' : 'done';
    } catch (err) { job.state = 'failed'; noteErr('', err); }
    job.endedAt = Date.now(); job.current = '';
    st.lastUp = { at: job.endedAt, state: job.state, files: job.done, bytes: job.doneBytes, conflicts: job.conflicts, errors: job.errors.length };
    save(); onChange();
    log(`Home PC: sent to the PC ${job.state}: ${job.done} files, ${job.conflicts} kept as both, ${job.errors.length} problems.`);
    return publicJob();
  }

  function stopCopy() { if (job && job.state === 'running') job.stop = true; return status(); }
  async function start(kind, opts = {}) {
    if (job && job.state === 'running') throw Object.assign(new Error('A copy is already going.'), { status: 409 });
    if (kind === 'up' && !st.lastPlan) throw Object.assign(new Error('Copy from your PC first: then this laptop knows which folders are whose.'), { status: 409 });
    const run = kind === 'up' ? copyUp() : copyDown(opts);
    run.catch(err => log(`Home PC: ${err.message}`));
    await new Promise(resolve => setTimeout(resolve, 50));
    return status();
  }

  restoreDrives().catch(() => {});
  if (st.key) startRelay();
  return { status, probe, find, pair, forget, setUse, setShowing, start, stopCopy, startRelay, settings: () => st, close: () => { if (relay) relay.close(); agent.destroy(); relayAgent.destroy(); } };
}

module.exports = { createHomePc, applyIncoming, PHONE_PORT };
