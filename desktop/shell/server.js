'use strict';
// The app's own server (../server.js), run on this Electron as Node, with your data in the app's data
// folder. It tells the app when it wants a restart or a quit; anything else that stops it is
// started again, unless another copy of Session Switcher now has the port (then that one serves).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PORT = Number(process.env.SWITCHER_PORT) || 4777;
const URL_BASE = `http://127.0.0.1:${PORT}/`;

// What answers on the port: { version, build, pid } if it's Session Switcher.
function probe(timeoutMs = 1500) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/version', timeout: timeoutMs }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => { body += d; });
      res.on('end', () => { try { const j = JSON.parse(body); resolve(j && j.app === 'session-switcher' ? j : null); } catch { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}
// The running copy's key, from the note it leaves for the next copy (lib/handover.js).
function token() {
  try { return JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `session-switcher-${PORT}.json`), 'utf8')).token || null; } catch { return null; }
}
function post(pathname, body = {}) {
  const t = token();
  return new Promise(resolve => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: pathname, timeout: 5000, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'X-Switcher-Token': t || '', Host: `127.0.0.1:${PORT}` } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.on('error', () => resolve(0));
    req.end(data);
  });
}

function createServer({ appFiles, dataDir, env = {}, log = () => {}, onQuit = () => {}, onTrouble = () => {} }) {
  let child = null, wanted = 'run', crashes = [];
  function start() {
    wanted = 'run';
    child = spawn(process.execPath, [path.join(appFiles, 'server.js')], {
      cwd: appFiles,
      env: { ...process.env, ...env, ELECTRON_RUN_AS_NODE: '1', SWITCHER_DATA_DIR: dataDir, SWITCHER_NO_BROWSER: '1', SWITCHER_SHELL: 'electron', SWITCHER_PORT: String(PORT) },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
    });
    let err = '';
    child.stderr.on('data', d => { err = (err + d).slice(-4000); });
    child.on('message', m => {
      if (!m || typeof m !== 'object') return;
      if (m.type === 'restart') wanted = 'restart';
      if (m.type === 'quit') { wanted = 'quit'; onQuit(); }
    });
    const me = child;
    child.on('exit', async code => {
      if (child === me) child = null;
      if (wanted === 'quit' || wanted === 'stop') return;
      if (wanted === 'restart') { log('Restarting the server.'); return start(); }
      // It stopped by itself. Another copy may have taken the port over (or was already serving it).
      if (await probe()) { log('Another copy of Session Switcher is serving; using it.'); return undefined; }
      const now = Date.now();
      crashes = crashes.filter(t => now - t < 60000).concat(now);
      log(`The server stopped (code ${code}). ${err.trim().split(/\r?\n/).slice(-3).join(' ')}`);
      if (crashes.length >= 3) return onTrouble(err.trim() || `The server stopped (code ${code}).`);
      return setTimeout(start, 800);
    });
  }
  // Waits until something serves the app on the port (this server, or another copy).
  async function ready(ms = 60000) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (await probe()) return true;
      await new Promise(r => setTimeout(r, 300));
    }
    return false;
  }
  // Stops it the polite way (it keeps what it was doing), then firmly.
  async function stop({ forUpdate = false } = {}) {
    wanted = 'stop';
    const c = child;
    if (!c) return;
    await post('/api/quit', forUpdate ? { forUpdate: true } : {});
    await new Promise(resolve => {
      const t = setTimeout(() => { try { c.kill(); } catch { /* gone */ } resolve(); }, 6000);
      c.once('exit', () => { clearTimeout(t); resolve(); });
    });
  }
  return { start, stop, ready, running: () => !!child };
}

module.exports = { createServer, probe, post, URL_BASE, PORT };
