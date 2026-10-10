'use strict';
// One copy of the app at a time, and never an old server behind new pages.
//
// When a copy starts and the port is already taken, it asks what's running there:
//   - this same build: it just brings the window up, as before;
//   - an older version, or the same version started before its files changed (an update, a git
//     pull): it asks that copy to quit, waits for the port, and starts in its place;
//   - a newer version: it brings that window up rather than going back a version;
//   - something that isn't Session Switcher: it leaves it alone.
// Without this, updating the files while the app runs leaves the old server handing out the new
// pages, and the window sits on "Connecting" with nothing in it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

// A fingerprint of the code: the same files give the same value, whatever their dates say.
function buildId(appDir) {
  const h = crypto.createHash('sha1');
  const add = rel => { try { const data = fs.readFileSync(path.join(appDir, rel)); h.update(rel); h.update(data); } catch { /* not in this version */ } };
  for (const f of ['server.js', 'index.html', 'theme.js', 'styles.css']) add(f);
  for (const dir of ['lib', 'ui']) {
    let list = [];
    try { list = fs.readdirSync(path.join(appDir, dir)).filter(f => f.endsWith('.js')).sort(); } catch { /* none */ }
    for (const f of list) add(`${dir}/${f}`);
  }
  return h.digest('hex').slice(0, 16);
}

// Who is running, kept outside the app's folder (which may sync to the cloud).
const lockFile = port => path.join(os.tmpdir(), `session-switcher-${port}.json`);
function writeLock(port, info) { try { fs.writeFileSync(lockFile(port), JSON.stringify(info), { mode: 0o600 }); } catch { /* best effort */ } }
function readLock(port) { try { return JSON.parse(fs.readFileSync(lockFile(port), 'utf8')); } catch { return null; } }
function clearLock(port, pid) { const j = readLock(port); if (j && j.pid === pid) { try { fs.unlinkSync(lockFile(port)); } catch { /* gone */ } } }

function request(port, method, pathname, headers = {}, timeoutMs = 2500) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers: { Host: `127.0.0.1:${port}`, ...headers }, timeout: timeoutMs }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => { if (body.length < 65536) body += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(body); } catch { /* not JSON */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// What's on the port: { kind: 'current', version, build, pid } for a copy with this check,
// { kind: 'old' } for an earlier Session Switcher, or null for anything else (or no answer).
async function probe(port) {
  const r = await request(port, 'GET', '/api/version');
  if (!r || !r.json) return null;
  if (r.status === 200 && r.json.app === 'session-switcher') return { kind: 'current', version: r.json.version, build: r.json.build, pid: r.json.pid };
  if (r.status === 403 && r.json.reason === 'stale') return { kind: 'old' };
  return null;
}

const parse = v => { const m = String(v || '').match(/(\d+)\.(\d+)\.(\d+)/); return m ? m.slice(1).map(Number) : [0, 0, 0]; };
function compare(a, b) { const x = parse(a), y = parse(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; }

// The process listening on the port, with its command line, so only a Session Switcher is stopped.
async function portOwner(port, sys) {
  if (sys.IS_WIN) {
    const ps = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      `$id = (Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -First 1).OwningProcess`,
      `if (-not $id) { $l = netstat -ano -p tcp | Select-String ':${port}\\s+\\S+:0\\s' | Select-Object -First 1; if ($l) { $id = ($l.ToString().Trim() -split '\\s+')[-1] } }`,
      'if ($id) { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id"; [Console]::Out.Write((ConvertTo-Json -Compress @{ pid = [int]$id; name = [string]$p.Name; cmd = [string]$p.CommandLine })) }',
    ].join('\n');
    const r = await sys.runPowerShell(ps, { timeoutMs: 20000 });
    try { return JSON.parse(r.stdout.trim()); } catch { return null; }
  }
  const r = await sys.runCapture(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { timeoutMs: 8000 });
  const pid = Number(String(r.stdout).trim().split(/\s+/)[0]);
  if (!pid) return null;
  const c = await sys.runCapture(`ps -o command= -p ${pid}`, { timeoutMs: 8000 });
  return { pid, name: '', cmd: String(c.stdout).trim() };
}

function waitFree(port, ms) {
  const until = Date.now() + ms;
  return new Promise(resolve => {
    const tryOnce = () => {
      const s = require('net').connect({ host: '127.0.0.1', port });
      s.once('connect', () => { s.destroy(); if (Date.now() > until) resolve(false); else setTimeout(tryOnce, 250); });
      s.once('error', () => resolve(true));
    };
    tryOnce();
  });
}

// Returns 'start' (the port is free now: listen again), 'open' (bring the running window up) or
// 'busy' (another program has the port). `owner` and `kill` can be swapped out in tests.
async function takeOver({ port, version, build, appDir, sys, log = () => {}, owner = () => portOwner(port, sys), kill = pid => process.kill(pid) }) {
  const running = await probe(port);
  if (running && running.kind === 'current') {
    if (running.build === build) return 'open';
    if (compare(running.version, version) > 0) { log(`Version ${running.version} is already running, newer than this copy (${version}). Opening it.`); return 'open'; }
  }
  const ours = path.join(appDir, 'server.js').toLowerCase();
  const lock = readLock(port);
  let who = null;
  if (!running) {
    // No answer: only a hung copy of this very folder may be stopped. The Mac and .bat launchers
    // start it as plain `node server.js`, so its lock file names it when its command line can't.
    who = await owner().catch(() => null);
    const listed = !!(who && lock && lock.pid === who.pid && String(lock.dir || '').toLowerCase() === appDir.toLowerCase());
    if (!who || !(listed || String(who.cmd || '').toLowerCase().includes(ours))) return 'busy';
    // The same code, only slow to answer (still starting up, say): leave it running.
    if (listed && lock.build === build) return 'open';
  }
  const what = !running ? 'a copy that stopped answering' : running.kind === 'old' ? 'an older copy' : running.version !== version ? `version ${running.version}` : 'a copy started before its files changed';
  log(`Replacing ${what} on port ${port} with ${version}.`);
  // The polite way first: a copy with this check left its key where we can find it.
  let asked = false;
  if (running && running.kind === 'current' && lock && lock.token && lock.pid === running.pid) {
    const r = await request(port, 'POST', '/api/quit', { 'Content-Type': 'application/json', 'X-Switcher-Token': lock.token });
    asked = !!(r && r.status === 200);
  }
  if (!asked) {
    who = who || await owner().catch(() => null);
    const cmd = String(who && who.cmd || '');
    if (who && who.pid && who.pid !== process.pid && /node/i.test(`${who.name} ${cmd}`) && /server\.js/i.test(cmd)) {
      try { kill(who.pid); asked = true; } catch (err) { log(`Couldn’t stop process ${who.pid}: ${err.message}`); }
    }
  }
  if (!asked) { log('Couldn’t stop the copy that’s running. Use Quit in its window, then start Session Switcher again.'); return 'open'; }
  return (await waitFree(port, 10000)) ? 'start' : 'open';
}

module.exports = { buildId, writeLock, readLock, clearLock, probe, compare, takeOver, lockFile };
