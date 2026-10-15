'use strict';
/* The keeper: a small process of its own that holds the chats' Claude Code and Codex processes, so
   restarting Switcher doesn't end them. Each chat process talks to the keeper through pipes, as it
   used to talk to Switcher; Switcher talks to the keeper through a local socket only it can open
   (the socket is in a folder only you can read, and the keeper asks for a token kept in the app's
   data folder).

   The keeper splits each process's output into numbered lines and keeps the ones Switcher hasn't
   confirmed. When Switcher restarts, the old copy stops reading, saves each chat's state with the
   number of the last line it handled, and exits; the new copy reconnects and asks for the lines after
   that, so nothing a chat said in between is lost. Quitting the app still ends the chats.

   Not on Windows (no unix sockets there in the same way; chats are started directly, as before), and
   not when SWITCHER_NO_KEEPER is set. */

const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const { spawn } = require('child_process');

const VERSION = 1;
// Lines kept for a chat while Switcher is away (a restart takes seconds; this is for a long gap).
const MAX_LINES = 200000;
const MAX_BYTES = 256 * 1024 * 1024;
// With no Switcher connected for this long, the keeper ends its chats and itself.
const ORPHAN_MS = 6 * 3600e3;

// Where the socket lives: a short path (macOS allows about 104 characters) in a folder of your own,
// one per data folder. The protocol version isn't in the name, so a newer Switcher finds an older
// keeper and can retire it (see 'retire') rather than leave its chats running unseen.
function paths(dataDir) {
  const h = crypto.createHash('sha256').update(path.resolve(dataDir)).digest('hex').slice(0, 12);
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'u';
  const dir = path.join(os.tmpdir(), `switcher-keeper-${uid}`);
  return { dir, sock: path.join(dir, `k-${h}.sock`), tokenFile: path.join(dataDir, 'keeper-token'), logFile: path.join(dataDir, 'keeper.log') };
}

// ---------- the keeper process ----------

function runKeeper({ sock, tokenFile, logFile }) {
  const log = msg => { try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`); } catch { /* no log */ } };
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  const kids = new Map();   // id -> record
  let client = null, lastClientAt = Date.now();
  const send = obj => { if (client) { try { client.write(`${JSON.stringify(obj)}\n`); } catch { /* gone */ } } };

  function addLine(rec, s) {
    const n = rec.next++;
    rec.lines.push({ n, s }); rec.bytes += s.length;
    while (rec.lines.length > MAX_LINES || rec.bytes > MAX_BYTES) { const x = rec.lines.shift(); rec.bytes -= x.s.length; rec.gap = true; }
    if (rec.attached) send({ ev: 'line', id: rec.id, n, s });
  }
  function startKid(m) {
    if (kids.has(m.id)) return send({ ev: 'spawnError', id: m.id, message: 'That id is in use.' });
    let child;
    try { child = spawn(m.file, m.args || [], { env: m.env || process.env, cwd: m.cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true }); }
    catch (err) { return send({ ev: 'spawnError', id: m.id, message: err.message }); }
    const rec = { id: m.id, child, pid: child.pid, lines: [], bytes: 0, next: 1, attached: true, exit: null, errTail: '', partial: '', gap: false, meta: m.meta || null, at: Date.now() };
    kids.set(m.id, rec);
    child.on('error', err => { if (!rec.exit) { rec.exit = { code: null, signal: null, error: err.message, at: Date.now() }; if (rec.attached) send({ ev: 'exit', id: rec.id, code: null, signal: null, error: err.message }); } });
    child.stdin.on('error', () => { /* it went away; close reports it */ });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', d => { const parts = (rec.partial + d).split('\n'); rec.partial = parts.pop(); for (const s of parts) addLine(rec, s); });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', d => { rec.errTail = (rec.errTail + d).slice(-8000); if (rec.attached) send({ ev: 'err', id: rec.id, s: d }); });
    child.on('close', (code, signal) => {
      if (rec.partial) { addLine(rec, rec.partial); rec.partial = ''; }
      if (rec.exit) return;
      rec.exit = { code, signal, at: Date.now() };
      if (rec.attached) send({ ev: 'exit', id: rec.id, code, signal });
    });
    log(`started ${m.id} (pid ${child.pid})${m.meta && m.meta.what ? `: ${m.meta.what}` : ''}`);
    return send({ ev: 'spawned', id: m.id, pid: child.pid });
  }
  function attach(m) {
    const rec = kids.get(m.id);
    if (!rec) return send({ ev: 'exit', id: m.id, code: null, signal: null, error: 'gone' });
    rec.attached = true;
    const after = Number(m.after) || 0;
    if (rec.gap && rec.lines.length && rec.lines[0].n > after + 1) send({ ev: 'gap', id: rec.id });
    if (rec.errTail) send({ ev: 'errTail', id: rec.id, s: rec.errTail });
    for (const x of rec.lines) if (x.n > after) send({ ev: 'line', id: rec.id, n: x.n, s: x.s });
    if (rec.exit) send({ ev: 'exit', id: rec.id, code: rec.exit.code, signal: rec.exit.signal });
    return undefined;
  }
  function killKid(rec, signal) {
    if (!rec || rec.exit) return;
    const hit = sig => { try { process.kill(-rec.pid, sig); } catch { try { rec.child.kill(sig); } catch { /* gone */ } } };
    hit(signal || 'SIGTERM');
    // Anything of its group still there after 5 seconds (the process itself, or something it started
    // that ignored the request) is made to stop.
    if ((signal || 'SIGTERM') !== 'SIGKILL') {
      const pid = rec.pid;
      setTimeout(() => { try { process.kill(-pid, 0); process.kill(-pid, 'SIGKILL'); } catch { if (!rec.exit) hit('SIGKILL'); } }, 5000).unref();
    }
  }
  function onMessage(conn, m) {
    if (conn !== client) {
      // A Switcher that speaks another version: everything here ends, and this keeper goes, so the
      // new one starts clean (its chats are reopened from where they were, as after a crash).
      if (m.op === 'retire' && m.token === token) {
        log(`retired by a Switcher on protocol ${m.v}; ending ${[...kids.values()].filter(r => !r.exit).length} chats`);
        for (const r of kids.values()) killKid(r, 'SIGTERM');
        try { conn.end(`${JSON.stringify({ ev: 'retiring' })}\n`); } catch { /* gone */ }
        setTimeout(() => { for (const r of kids.values()) killKid(r, 'SIGKILL'); try { server.close(); fs.unlinkSync(sock); } catch { /* gone */ } process.exit(0); }, 1500).unref();
        return undefined;
      }
      if (m.op !== 'hello') return conn.destroy();
      if (m.token !== token || m.v !== VERSION) { try { conn.write(`${JSON.stringify({ ev: 'refused', reason: m.token !== token ? 'token' : 'version', v: VERSION })}\n`); } catch { /* gone */ } return conn.destroy(); }
      // One Switcher at a time: a new one (the copy after a restart) takes over.
      if (client) { const old = client; client = null; try { old.destroy(); } catch { /* gone */ } }
      client = conn; lastClientAt = Date.now();
      for (const r of kids.values()) r.attached = false;
      return send({ ev: 'hello', v: VERSION, pid: process.pid, kids: [...kids.values()].map(r => ({ id: r.id, pid: r.pid, alive: !r.exit, exit: r.exit, next: r.next, first: r.lines.length ? r.lines[0].n : r.next, gap: r.gap, meta: r.meta, at: r.at })) });
    }
    const rec = m.id ? kids.get(m.id) : null;
    switch (m.op) {
      case 'spawn': return startKid(m);
      case 'attach': return attach(m);
      case 'write': if (rec && !rec.exit && rec.child.stdin.writable) rec.child.stdin.write(String(m.s)); return undefined;
      case 'end': if (rec && !rec.exit) { try { rec.child.stdin.end(); } catch { /* closed */ } } return undefined;
      case 'kill': return killKid(rec, m.signal);
      case 'killAll': for (const r of kids.values()) killKid(r, 'SIGTERM'); return undefined;
      case 'ack': if (rec) { const n = Number(m.n) || 0; while (rec.lines.length && rec.lines[0].n <= n) rec.bytes -= rec.lines.shift().s.length; } return undefined;
      case 'forget': if (rec && rec.exit) kids.delete(rec.id); return undefined;
      case 'ping': return send({ ev: 'pong', at: m.at });
      default: return undefined;
    }
  }

  const server = net.createServer(conn => {
    conn.setEncoding('utf8');
    let buf = '';
    conn.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        try { onMessage(conn, m); } catch (err) { log(`couldn’t handle ${m.op}: ${err.message}`); }
      }
    });
    conn.on('error', () => { /* closed */ });
    conn.on('close', () => { if (conn === client) { client = null; lastClientAt = Date.now(); for (const r of kids.values()) r.attached = false; } });
  });
  server.on('error', err => { log(`socket: ${err.message}`); process.exit(1); });
  server.listen(sock, () => { try { fs.chmodSync(sock, 0o600); } catch { /* best effort */ } log(`keeper ${process.pid} listening`); });

  setInterval(() => {
    const now = Date.now();
    for (const r of kids.values()) if (r.exit && !client && now - r.exit.at > 10 * 60e3) kids.delete(r.id);
    const alive = [...kids.values()].filter(r => !r.exit);
    if (!client && now - lastClientAt > ORPHAN_MS && alive.length) { log(`no Switcher for ${Math.round(ORPHAN_MS / 3600e3)} hours; ending ${alive.length} chats`); for (const r of alive) killKid(r, 'SIGTERM'); }
    if (!client && !kids.size && now - lastClientAt > 60e3) { log('nothing to keep; exiting'); try { server.close(); fs.unlinkSync(sock); } catch { /* gone */ } process.exit(0); }
  }, 15000);
  process.on('SIGHUP', () => { /* not tied to a terminal */ });
}

// ---------- Switcher's side ----------

// A chat process held by the keeper, looking enough like a child process for the chat code: stdin
// to write to, stderr to read, exit to wait for, and its output as lines (onLine).
class KeptProc extends EventEmitter {
  constructor(client, id, handled = 0) {
    super();
    Object.assign(this, { kept: true, id, client, pid: undefined, exitCode: null, signalCode: null, handled, acked: handled, gap: false, lineCb: null, queue: [], closedIn: false });
    this.stdout = null;
    this.stderr = new EventEmitter();
    const self = this;
    this.stdin = {
      get writable() { return !self.closedIn && self.exitCode === null && !self.signalCode && client.usable(); },
      write(s) { client.send({ op: 'write', id, s: String(s) }); return true; },
      end() { self.closedIn = true; client.send({ op: 'end', id }); },
      on() { return this; },
    };
  }
  // Its output, a line at a time (lines it handled before a restart aren't repeated).
  onLine(cb) {
    this.lineCb = cb;
    const q = this.queue; this.queue = [];
    for (const [n, s] of q) this.line(n, s);
  }
  line(n, s) {
    if (n <= this.handled) return;
    if (!this.lineCb) { this.queue.push([n, s]); return; }
    this.handled = n;
    this.lineCb(s);
  }
  exited(code, signal) {
    if (this.exitCode !== null || this.signalCode) return;
    this.exitCode = code; this.signalCode = signal || null;
    this.emit('exit', code, signal || null);
    this.emit('close', code, signal || null);
    this.client.send({ op: 'forget', id: this.id });
    this.client.procs.delete(this.id);
  }
  kill(signal = 'SIGTERM') { this.client.send({ op: 'kill', id: this.id, signal }); return true; }
}

function createKeeperClient({ dataDir, appDir, log = () => {} }) {
  const p = paths(dataDir);
  const procs = new Map();
  let conn = null, live = false, paused = false, seq = 0, ackTimer = null;
  let hello = null;

  function token() {
    try { const t = fs.readFileSync(p.tokenFile, 'utf8').trim(); if (t) return t; } catch { /* make one */ }
    const t = crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(p.tokenFile, t, { mode: 0o600 });
    return t;
  }
  const usable = () => live && !paused;
  function send(obj) { if (!usable()) return; try { conn.write(`${JSON.stringify(obj)}\n`); } catch { /* closed; the close handler reports it */ } }

  function onEvent(m) {
    if (paused) return;
    const pr = m.id ? procs.get(m.id) : null;
    switch (m.ev) {
      case 'spawned': if (pr) pr.pid = m.pid; break;
      case 'spawnError': if (pr) { pr.emit('error', new Error(m.message)); pr.exited(null, null); } break;
      case 'line': if (pr) { try { pr.line(m.n, m.s); } catch (err) { log(`Keeper: a chat couldn’t handle a line (${err.message})`); } } break;
      case 'err': case 'errTail': if (pr) pr.stderr.emit('data', m.s); break;
      case 'gap': if (pr) pr.gap = true; break;
      case 'exit': if (pr) pr.exited(m.code, m.signal); break;
      default: break;
    }
  }

  function connect() {
    return new Promise((resolve, reject) => {
      const c = net.createConnection(p.sock);
      let buf = '', done = false;
      const fail = err => { if (!done) { done = true; reject(err); } };
      c.setEncoding('utf8');
      c.on('error', fail);
      c.on('connect', () => c.write(`${JSON.stringify({ op: 'hello', token: token(), v: VERSION })}\n`));
      c.on('data', d => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          let m; try { m = JSON.parse(line); } catch { continue; }
          if (!done) {
            if (m.ev === 'hello') { done = true; conn = c; live = true; hello = m; resolve(m); }
            else { fail(Object.assign(new Error('The keeper refused this copy.'), { reason: m.reason })); c.destroy(); }
            continue;
          }
          onEvent(m);
        }
      });
      c.on('close', () => {
        if (!done) return fail(new Error('The keeper closed the connection.'));
        if (conn !== c) return undefined;
        live = false;
        if (paused) return undefined;
        log('Keeper: the connection closed; its chats have stopped.');
        for (const pr of [...procs.values()]) pr.exited(null, 'SIGKILL');
        return undefined;
      });
    });
  }
  function startDaemon() {
    secure();
    token();
    // A socket file left by a keeper that's gone: removed, so the new one can listen.
    try { fs.unlinkSync(p.sock); } catch { /* none */ }
    const child = spawn(process.execPath, [path.join(appDir, 'bin', 'keeper.js'), p.sock, p.tokenFile, p.logFile], { detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    child.unref();
  }
  // Connects to the keeper, starting one if none is running. Resolves with what it holds, or null
  // (chats are then started directly, as before).
  // An older (or newer) keeper: asked to end its chats and go.
  function retire() {
    return new Promise(resolve => {
      const c = net.createConnection(p.sock);
      c.on('error', () => resolve());
      c.on('connect', () => c.write(`${JSON.stringify({ op: 'retire', token: token(), v: VERSION })}\n`));
      c.resume();   // read its goodbye, so the connection can close
      c.on('close', () => resolve());
      setTimeout(resolve, 3000).unref();
    });
  }
  // The socket's folder must be yours alone (on a shared /tmp, someone else could otherwise set up a
  // fake keeper and be handed the token). Made if missing; anything else means no keeper.
  function secure() {
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    try { fs.mkdirSync(p.dir, { mode: 0o700 }); } catch (err) { if (err.code !== 'EEXIST') throw err; }
    const st = fs.lstatSync(p.dir);
    if (!st.isDirectory() || st.isSymbolicLink() || (uid !== null && st.uid !== uid)) throw new Error(`${p.dir} isn’t a folder of yours`);
    if ((st.mode & 0o077) !== 0) fs.chmodSync(p.dir, 0o700);
    try { const s = fs.lstatSync(p.sock); if (uid !== null && s.uid !== uid) throw new Error('the keeper’s socket isn’t yours'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  async function ready() {
    try { secure(); } catch (err) { log(`Keeper: not used (${err.message}); chats run directly.`); return null; }
    try { return await connect(); } catch (err) {
      if (err.reason === 'version') { log('Keeper: retiring one from another version of Switcher.'); await retire(); await new Promise(r => setTimeout(r, 1800)); }
    }
    try { startDaemon(); } catch (err) { log(`Keeper: couldn’t start (${err.message})`); return null; }
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 100));
      try { return await connect(); } catch { /* not listening yet */ }
    }
    log('Keeper: didn’t start in time; chats run directly.');
    return null;
  }
  // Confirms the lines each chat has handled, so the keeper can let them go.
  function ackNow() {
    for (const pr of procs.values()) if (pr.handled > pr.acked) { pr.acked = pr.handled; send({ op: 'ack', id: pr.id, n: pr.handled }); }
  }
  function startAcks() { if (!ackTimer) { ackTimer = setInterval(ackNow, 1000); ackTimer.unref(); } }

  function spawnKept({ file, args, env, cwd, meta }) {
    const id = `${process.pid.toString(36)}-${(++seq).toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const pr = new KeptProc(api, id, 0);
    procs.set(id, pr);
    send({ op: 'spawn', id, file, args, env, cwd, meta });
    startAcks();
    return pr;
  }
  // A process the keeper already holds (from before a restart): its lines after `handled` follow.
  function adopt(id, handled) {
    const pr = new KeptProc(api, id, Number(handled) || 0);
    procs.set(id, pr);
    send({ op: 'attach', id, after: pr.handled });
    startAcks();
    return pr;
  }
  function kill(id, signal) { send({ op: 'kill', id, signal: signal || 'SIGTERM' }); }
  // Quitting: everything it holds ends (the keeper then goes by itself).
  function killAll() { send({ op: 'killAll' }); }
  // For a restart: stop reading (so the state saved next is where the new copy picks up) and let go.
  function pause() {
    if (!live) return;
    paused = true;
    clearInterval(ackTimer); ackTimer = null;
    try { conn.end(); } catch { /* closed */ }
  }

  const api = { ready, usable, send, spawnKept, adopt, kill, killAll, pause, procs, ackNow, kids: () => (hello ? hello.kids : []), paths: p };
  return api;
}

module.exports = { VERSION, paths, runKeeper, createKeeperClient, KeptProc };
