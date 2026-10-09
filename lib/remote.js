'use strict';
// Phone access: lets the Session Switcher app on your phone use this PC's Session Switcher over
// your Wi-Fi (or Tailscale). It's off until you turn it on in Setup.
//
//  - It listens on its own port (4788 by default) on your network. The usual window keeps using
//    127.0.0.1 only.
//  - A phone has to be paired once: Setup shows an 8-character code that works for 10 minutes,
//    once. Pairing gives the phone a long random key (kept as a cookie); only its hash is stored
//    here, in devices.json. Remove a phone in Setup and its key stops working at once.
//  - Without a paired key, the only things it answers are /hello (so the phone can tell it found
//    Session Switcher), /pair, and /get (the page to download the Android app).
//
// Anyone holding a paired phone can do what you can do in Session Switcher, including letting
// Claude or Codex run commands on this PC. Pair only your own devices.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const store = require('./store');

const COOKIE = 'sw_device';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const CODE_TTL = 10 * 60 * 1000;
const MAX_TRIES = 8;
const DEFAULT_PORT = 4788;

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a090c;color:#ede6d9;font:17px/1.55 Georgia,serif;padding:24px;box-sizing:border-box}
main{max-width:460px}h1{font-size:26px;margin:0 0 12px}p{color:#cfc6b6}a.btn{display:inline-block;margin-top:10px;padding:12px 20px;border-radius:8px;background:#a5463f;color:#fff;text-decoration:none;font-weight:600}
code{font-family:Consolas,monospace;color:#d9bf74}small{color:#9a928a}</style></head><body><main>${body}</main></body></html>`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// This PC's addresses a phone can reach: Wi-Fi/Ethernet, and Tailscale (100.64.0.0/10) marked as such.
function addresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || /^169\.254\./.test(a.address)) continue;
      const [x, y] = a.address.split('.').map(Number);
      const tailscale = x === 100 && y >= 64 && y <= 127;
      if (/vEthernet|VirtualBox|VMware|WSL|Hyper-V|Docker/i.test(name) && !tailscale) continue;
      out.push({ address: a.address, name, tailscale });
    }
  }
  return out.sort((a, b) => Number(a.tailscale) - Number(b.tailscale));
}

function parseCookies(h) {
  const out = {};
  for (const part of String(h || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}

function createRemote({ dataDir, appDir, version, log = () => {}, getPrefs, handle }) {
  const file = path.join(dataDir, 'devices.json');
  let devices = (store.loadOwnJson(file, null, log) || {}).devices || [];
  let pairing = null; // { code, expires, tries }
  let server = null, listening = null;
  const saveDevices = () => { try { store.writeJsonAtomic(file, { devices }); } catch (err) { log(`Couldn’t save devices.json: ${err.message}`); } };

  function deviceFor(req) {
    const v = parseCookies(req.headers.cookie)[COOKIE];
    if (!v || !/^[a-f0-9]{12}\.[A-Za-z0-9_-]{30,}$/.test(v)) return null;
    const [id, secret] = v.split('.');
    const d = devices.find(x => x.id === id);
    if (!d) return null;
    const a = Buffer.from(d.hash, 'hex'), b = Buffer.from(sha(secret), 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    if (Date.now() - (d.lastSeen || 0) > 60000) { d.lastSeen = Date.now(); d.lastIp = req.socket.remoteAddress || null; saveDevices(); }
    return d;
  }

  function startPairing() {
    let code = '';
    for (const b of crypto.randomBytes(8)) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    pairing = { code, expires: Date.now() + CODE_TTL, tries: 0 };
    log('Phone access: pairing code issued.');
    return { code, expiresAt: pairing.expires };
  }
  function cancelPairing() { pairing = null; }

  function pair(code, name, ip) {
    const want = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!pairing || Date.now() > pairing.expires) { pairing = null; return { error: 'That code has expired, or none is active. On your PC, open Setup → Phone access → Pair a phone for a new one.' }; }
    const a = Buffer.from(want.padEnd(8).slice(0, 8)), b = Buffer.from(pairing.code);
    if (want.length !== 8 || !crypto.timingSafeEqual(a, b)) {
      if (++pairing.tries >= MAX_TRIES) { pairing = null; log('Phone access: too many wrong codes; the code was cancelled.'); return { error: 'Too many wrong codes. Make a new one on your PC.' }; }
      return { error: 'That code isn’t right. Check it on your PC and try again.' };
    }
    pairing = null;
    const id = crypto.randomBytes(6).toString('hex');
    const secret = crypto.randomBytes(32).toString('base64url');
    const d = { id, name: String(name || 'Phone').replace(/[^\w .'()-]/g, '').slice(0, 40) || 'Phone', hash: sha(secret), created: Date.now(), lastSeen: Date.now(), lastIp: ip || null };
    devices.push(d);
    saveDevices();
    log(`Phone access: paired “${d.name}”.`);
    return { cookie: `${id}.${secret}`, device: d };
  }

  function forget(id) { const n = devices.length; devices = devices.filter(d => d.id !== id); if (devices.length !== n) { saveDevices(); log(`Phone access: removed a phone (${id}).`); } }

  const apkPath = () => [path.join(appDir, 'SessionSwitcher.apk'), path.join(appDir, 'mobile', 'android', 'build', 'SessionSwitcher.apk')].find(p => fs.existsSync(p)) || null;

  async function onRequest(req, res) {
    const url = new URL(req.url, 'http://phone.invalid');
    const secure = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' };
    if (req.method === 'GET' && url.pathname === '/hello') {
      res.writeHead(200, { ...secure, 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ app: 'session-switcher', version, paired: !!deviceFor(req) }));
    }
    if (req.method === 'GET' && url.pathname === '/pair') {
      const r = pair(url.searchParams.get('code'), url.searchParams.get('name'), req.socket.remoteAddress);
      if (r.error) { res.writeHead(403, { ...secure, 'Content-Type': 'text/html; charset=utf-8' }); return res.end(page('Couldn’t pair', `<h1>Couldn’t pair this phone</h1><p>${esc(r.error)}</p><a class="btn" href="javascript:history.back()">Go back</a>`)); }
      res.writeHead(302, { ...secure, Location: '/', 'Set-Cookie': `${COOKIE}=${r.cookie}; Max-Age=${400 * 24 * 3600}; Path=/; HttpOnly; SameSite=Lax` });
      return res.end();
    }
    if (req.method === 'GET' && (url.pathname === '/get' || url.pathname === '/SessionSwitcher.apk')) {
      const apk = apkPath();
      if (url.pathname === '/SessionSwitcher.apk') {
        if (!apk) { res.writeHead(404); return res.end('Not built yet.'); }
        res.writeHead(200, { ...secure, 'Content-Type': 'application/vnd.android.package-archive', 'Content-Disposition': 'attachment; filename="SessionSwitcher.apk"' });
        return fs.createReadStream(apk).pipe(res);
      }
      res.writeHead(200, { ...secure, 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(page('Session Switcher for Android', `<h1>Session Switcher for Android</h1>
        ${apk ? `<p>Download the app, open it, and allow your browser to install apps if Android asks.</p><a class="btn" href="/SessionSwitcher.apk">Download the app</a>` : '<p>The Android app hasn’t been built on this PC yet. See <code>mobile/android/README.md</code>.</p>'}
        <p style="margin-top:22px">Then, in the app, enter this PC’s address <code>${esc(req.headers.host || '')}</code> and the pairing code from Setup → Phone access on your PC.</p>`));
    }
    const device = deviceFor(req);
    if (!device) {
      res.writeHead(401, { ...secure, 'Content-Type': url.pathname.startsWith('/api/') ? 'application/json' : 'text/html; charset=utf-8' });
      return res.end(url.pathname.startsWith('/api/') ? JSON.stringify({ error: 'This phone isn’t paired any more. Pair it again from Setup → Phone access on your PC.', reason: 'unpaired' })
        : page('Not paired', '<h1>This phone isn’t paired</h1><p>On your PC, open Session Switcher → Setup → <b>Phone access</b> → <b>Pair a phone</b>, then enter the code in the app.</p>'));
    }
    req.device = device;
    return handle(req, res, { remote: true });
  }

  // Starts or stops listening to match Setup. Returns the current status.
  async function sync() {
    const p = getPrefs().phone || {};
    const want = p.enabled ? (Number(p.port) || DEFAULT_PORT) : null;
    if (listening === want) return status();
    if (server) { const s = server; server = null; listening = null; await new Promise(r => s.close(() => r())); for (const sock of s._sockets || []) sock.destroy(); }
    if (!want) return status();
    const s = http.createServer((req, res) => onRequest(req, res).catch(err => { log(`Phone access error: ${err.message}`); if (!res.headersSent) { res.writeHead(500); res.end(); } }));
    s._sockets = new Set();
    s.on('connection', sock => { s._sockets.add(sock); sock.on('close', () => s._sockets.delete(sock)); });
    await new Promise((resolve) => {
      s.once('error', err => { log(`Phone access couldn’t listen on port ${want}: ${err.message}`); s.lastError = err.code === 'EADDRINUSE' ? `Port ${want} is in use by another program. Pick another port.` : err.message; resolve(); });
      s.listen(want, '0.0.0.0', () => { server = s; listening = want; log(`Phone access on, port ${want}.`); resolve(); });
    });
    if (!server) return { ...status(), error: s.lastError };
    return status();
  }

  function status() {
    const p = getPrefs().phone || {};
    return {
      enabled: !!p.enabled, listening: listening !== null, port: Number(p.port) || DEFAULT_PORT,
      addresses: addresses(), apk: !!apkPath(),
      pairing: pairing && Date.now() < pairing.expires ? { code: pairing.code, expiresAt: pairing.expires } : null,
      devices: devices.map(({ id, name, created, lastSeen, lastIp }) => ({ id, name, created, lastSeen, lastIp })),
    };
  }

  function stop() { if (server) { try { server.close(); for (const sock of server._sockets || []) sock.destroy(); } catch { /* closing */ } server = null; listening = null; } }

  return { sync, status, startPairing, cancelPairing, forget, stop, DEFAULT_PORT };
}

module.exports = { createRemote, addresses };
