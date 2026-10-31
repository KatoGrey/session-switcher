'use strict';
// How much of Ollama's cloud you've used, read from ollama.com the same way the Ollama app reaches
// it: requests signed with the key Ollama keeps in ~/.ollama (nothing to copy from a browser, nothing
// that expires). ollama.com reports request counts here (24 hours by hour, 7 days by day), not the
// percentage of the plan that its settings page shows.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

// Reads Ollama's OpenSSH ed25519 key into a signing key; the key never leaves this process.
function loadKey(file = path.join(os.homedir(), '.ollama', 'id_ed25519')) {
  const pem = fs.readFileSync(file, 'utf8');
  const b = Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
  if (b.subarray(0, 14).toString() !== 'openssh-key-v1') throw new Error('Not an OpenSSH key.');
  let o = 15;
  const rd = () => {
    if (o + 4 > b.length) throw new Error('Truncated OpenSSH key.');
    const n = b.readUInt32BE(o); o += 4;
    if (n > b.length - o) throw new Error('Truncated OpenSSH key.');
    const v = b.subarray(o, o + n); o += n; return v;
  };
  rd(); rd(); rd();
  if (o + 4 > b.length) throw new Error('Truncated OpenSSH key.');
  o += 4; const pubBlob = rd(); const priv = rd();
  let p = 8;
  const rp = () => {
    if (p + 4 > priv.length) throw new Error('Truncated ed25519 private key.');
    const n = priv.readUInt32BE(p); p += 4;
    if (n > priv.length - p) throw new Error('Truncated ed25519 private key.');
    const v = priv.subarray(p, p + n); p += n; return v;
  };
  if (rp().toString() !== 'ssh-ed25519') throw new Error('Not an ed25519 key.');
  const pub = rp(), sk = rp();
  if (pub.length < 32 || sk.length < 32) throw new Error('Truncated ed25519 key material.');
  const key = crypto.createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: sk.subarray(0, 32).toString('base64url'), x: pub.toString('base64url') }, format: 'jwk' });
  return { key, pub: pubBlob.toString('base64') };
}

function signedGet(k, pathname) {
  return new Promise((resolve, reject) => {
    const full = `${pathname}${pathname.includes('?') ? '&' : '?'}ts=${Math.floor(Date.now() / 1000)}`;
    const sig = crypto.sign(null, Buffer.from(`GET,${full}`), k.key).toString('base64');
    const req = https.request({ host: 'ollama.com', path: full, method: 'GET', headers: { Authorization: `${k.pub}:${sig}` }, timeout: 15000 }, res => {
      let s = ''; res.setEncoding('utf8');
      res.on('error', reject);
      res.on('data', d => { if (s.length + d.length > 1048576) { req.destroy(new Error('ollama.com response too large.')); return; } s += d; });
      res.on('end', () => { if (res.statusCode !== 200) return reject(new Error(`ollama.com answered ${res.statusCode}`)); try { resolve(JSON.parse(s)); } catch { reject(new Error('ollama.com sent something unexpected.')); } });
    });
    req.on('timeout', () => req.destroy(new Error('ollama.com took too long.')));
    req.on('error', reject);
    req.end();
  });
}

function createOllamaAccount({ log = () => {} } = {}) {
  let cache = { at: 0, value: null };
  async function usage({ maxAgeMs = 30 * 60e3 } = {}) {
    if (cache.value && Date.now() - cache.at < maxAgeMs) return cache.value;
    try {
      const k = loadKey();
      const [day, week] = await Promise.all([signedGet(k, '/api/usage?range=24h'), signedGet(k, '/api/usage?range=7d')]);
      const v = { day: day.totals ? day.totals.request_count : null, week: week.totals ? week.totals.request_count : null, byDay: (week.buckets || []).map(b => ({ from: b.from, n: b.request_count })), at: Date.now() };
      cache = { at: Date.now(), value: v };
      return v;
    } catch (err) { log(`Lite: Ollama usage: ${err.message}`); cache = { at: Date.now() - maxAgeMs + 5 * 60e3, value: cache.value }; return cache.value; }
  }
  return { usage };
}

module.exports = { createOllamaAccount, loadKey };
