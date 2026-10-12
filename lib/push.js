'use strict';
// Notifications on your phones: a chat that needs your OK, or one that replied, reaches a paired
// phone even when Session Switcher isn't open on it. Approvals carry Allow and Deny on the
// notification itself. Two ways in:
//
//  - The Android app keeps a light connection to the PC while it's on your Wi-Fi (the server's
//    /api/notify/stream) and shows them itself. Nothing leaves your network.
//  - Web Push (the standard browsers use), for a browser or an iPhone's Home Screen app. Phones only
//    allow it on a secure (https) page, so that phone reaches the PC through Tailscale's https
//    address (tailscale serve), not the plain Wi-Fi one.
//  - Each subscription belongs to a paired phone; remove the phone in Setup and its pushes stop.
//  - The keys that sign pushes (VAPID) are made once and kept in push.json, next to devices.json.
//  - Messages are encrypted for the phone (RFC 8291) before they leave this PC; the push service in
//    between (Google's or Apple's) can't read them.
//  - Nothing here needs a package: Node's own crypto does it.

const path = require('path');
const https = require('https');
const crypto = require('crypto');
const store = require('./store');

const CONTACT = 'https://github.com/KatoGrey/session-switcher';
const b64u = b => Buffer.from(b).toString('base64url');
const unb64u = s => Buffer.from(String(s || ''), 'base64url');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// Encrypts a message for one phone (RFC 8291, aes128gcm). Returns the request body.
function encrypt(payload, keys, { salt = crypto.randomBytes(16), ecdh = null } = {}) {
  const uaPublic = unb64u(keys.p256dh), auth = unb64u(keys.auth);
  if (uaPublic.length !== 65 || auth.length < 16) throw new Error('That subscription’s keys aren’t right.');
  const as = ecdh || crypto.createECDH('prime256v1');
  if (!ecdh) as.generateKeys();
  const asPublic = as.getPublicKey();
  const shared = as.computeSecret(uaPublic);
  const ikm = hmac(hmac(auth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = asPublic.length;
  return Buffer.concat([head, asPublic, body]);
}

// The signed note that says this PC sent it (RFC 8292).
function vapidHeader(endpoint, jwk, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const data = `${b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))}.${b64u(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: CONTACT }))}`;
  const sig = crypto.sign('sha256', Buffer.from(data), { key: crypto.createPrivateKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64u(sig)}, k=${publicOf(jwk)}`;
}
const publicOf = jwk => b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)]));

function post(endpoint, headers, body) {
  return new Promise(resolve => {
    const req = https.request(endpoint, { method: 'POST', headers: { ...headers, 'Content-Length': body.length }, timeout: 15000 }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', d => { if (text.length < 2000) text += d; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', err => resolve({ status: 0, text: err.message }));
    req.end(body);
  });
}

function createPush({ dataDir, log = () => {}, send = post }) {
  const file = path.join(dataDir, 'push.json');
  const saved = store.loadOwnJson(file, null, log) || {};
  let vapid = saved.vapid && saved.vapid.d ? saved.vapid : null;
  let subs = Array.isArray(saved.subs) ? saved.subs : [];
  // What each Android app wants to hear about (its alert levels and quiet hours), by phone.
  let apps = saved.apps && typeof saved.apps === 'object' ? saved.apps : {};
  const save = () => { try { store.writeJsonAtomic(file, { vapid, subs, apps }); } catch (err) { log(`Couldn’t save push.json: ${err.message}`); } };
  function keys() {
    if (!vapid) {
      const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      vapid = privateKey.export({ format: 'jwk' }); save();
    }
    return vapid;
  }
  const okEndpoint = e => { try { const u = new URL(e); return u.protocol === 'https:'; } catch { return false; } };

  // A phone signs up (or updates what it wants to hear about).
  function subscribe(deviceId, sub, prefs = {}) {
    if (!sub || !okEndpoint(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw Object.assign(new Error('That isn’t a push subscription.'), { status: 400 });
    encrypt('check', sub.keys);   // throws if its keys are wrong
    subs = subs.filter(s => s.endpoint !== sub.endpoint);
    subs.push({ deviceId, endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, prefs: cleanPrefs(prefs), created: Date.now() });
    save();
  }
  function setPrefs(deviceId, endpoint, prefs) {
    const s = subs.find(x => x.endpoint === endpoint && x.deviceId === deviceId);
    if (s) { s.prefs = cleanPrefs(prefs); save(); }
    return !!s;
  }
  function unsubscribe(deviceId, endpoint) { const n = subs.length; subs = subs.filter(s => !(s.endpoint === endpoint && s.deviceId === deviceId)); if (subs.length !== n) save(); }
  function forgetDevice(deviceId) { const n = subs.length; subs = subs.filter(s => s.deviceId !== deviceId); const had = deviceId in apps; delete apps[deviceId]; if (subs.length !== n || had) save(); }
  // Only phones that are still paired.
  function keepDevices(ids) {
    const n = subs.length, m = Object.keys(apps).length;
    subs = subs.filter(s => ids.includes(s.deviceId));
    for (const k of Object.keys(apps)) if (!ids.includes(k)) delete apps[k];
    if (subs.length !== n || Object.keys(apps).length !== m) save();
  }
  function setAppPrefs(deviceId, prefs) { apps[deviceId] = cleanPrefs(prefs); save(); }
  const appPrefs = deviceId => apps[deviceId] || cleanPrefs({});

  // Sends to every phone that wants it. `want(prefs)` decides per phone.
  async function notify(message, want = () => true) {
    const out = [];
    for (const s of subs.slice()) {
      if (!want(s.prefs || {}, s)) continue;
      // A phone that signed up from Switcher Lite opens Lite when tapped (and shows Lite's icon).
      const body = JSON.stringify(s.prefs && s.prefs.app === 'lite' ? { ...message, home: '/lite', icon: message.liteIcon || undefined } : message);
      const r = await send(s.endpoint, {
        'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', TTL: String(message.ttl || 3600),
        Urgency: message.kind === 'needs' ? 'high' : 'normal', ...(message.tag ? { Topic: message.tag.replace(/[^\w-]/g, '').slice(0, 32) } : {}),
        Authorization: vapidHeader(s.endpoint, keys()),
      }, encrypt(body, s.keys));
      // Gone (the phone unsubscribed, or the browser was reset): forget it.
      if (r.status === 404 || r.status === 410) { subs = subs.filter(x => x !== s); save(); log('Push: a phone’s subscription has ended; removed it.'); }
      else if (r.status < 200 || r.status >= 300) log(`Push to a phone failed (${r.status || 'no answer'}): ${String(r.text).slice(0, 160)}`);
      out.push({ deviceId: s.deviceId, status: r.status });
    }
    return out;
  }

  return {
    publicKey: () => publicOf(keys()), subscribe, prefsOf: deviceId => (subs.find(s => s.deviceId === deviceId) || {}).prefs || null, setPrefs, unsubscribe, forgetDevice, keepDevices, notify, setAppPrefs, appPrefs,
    count: deviceId => subs.filter(s => !deviceId || s.deviceId === deviceId).length,
    has: (deviceId, endpoint) => subs.some(s => s.deviceId === deviceId && s.endpoint === endpoint),
  };
}

// What a phone wants: per-chat alert levels ('needs' or 'off'; everything else is 'all'), quiet
// hours in its own time zone, which kinds it hears about at all (kinds: { reply: false } and so on;
// 'hack' only when switched on), and which app it signed up from (app: 'lite' opens Switcher Lite).
const KINDS = ['needs', 'reply', 'floor', 'reset', 'routine', 'hack'];
function cleanPrefs(p) {
  const levels = {};
  for (const [k, v] of Object.entries((p && p.levels) || {}).slice(0, 2000)) if (v === 'needs' || v === 'off') levels[String(k).toLowerCase().slice(0, 80)] = v;
  const q = p && p.quiet;
  const hhmm = s => (/^\d{2}:\d{2}$/.test(String(s)) ? String(s) : null);
  let tz = String((p && p.tz) || '').slice(0, 60);
  try { new Intl.DateTimeFormat('en', { timeZone: tz || undefined }); } catch { tz = ''; }
  const kinds = {};
  for (const k of KINDS) if (p && p.kinds && typeof p.kinds[k] === 'boolean') kinds[k] = p.kinds[k];
  return { levels, quiet: q && q.on && hhmm(q.from) && hhmm(q.to) ? { on: true, from: q.from, to: q.to } : null, tz, kinds, app: p && p.app === 'lite' ? 'lite' : null };
}
// Whether a phone wants to hear about this: its alert level for the chat, and its quiet hours.
function wants(prefs, { kind, sessionId }, now = new Date()) {
  const on = prefs.kinds && prefs.kinds[kind];
  if (on === false || (kind === 'hack' && on !== true)) return false;
  const level = (sessionId && prefs.levels && prefs.levels[String(sessionId).toLowerCase()]) || 'all';
  if (level === 'off' || (level === 'needs' && kind !== 'needs')) return false;
  const q = prefs.quiet;
  if (q && q.on) {
    let h, m;
    try { [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: prefs.tz || undefined, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(':').map(Number); } catch { h = now.getHours(); m = now.getMinutes(); }
    const at = s => { const [a, b] = s.split(':').map(Number); return a * 60 + b; };
    const t = h * 60 + m, a = at(q.from), b = at(q.to);
    if (a <= b ? t >= a && t < b : t >= a || t < b) return false;
  }
  return true;
}

// What's new since last time, from the app's chats: approvals and questions that just came up,
// replies that just finished, and chats whose approvals were all answered (or that stopped). `seen` is kept between calls; the first call only learns.
function news(list, seen) {
  const out = [];
  const first = !seen.primed;
  for (const x of list) {
    if (x.source !== 'app' || !x.key || x.aside) continue;
    const was = seen.map.get(x.key) || { req: new Set(), fin: x.finishedAt || null };
    const req = new Set((x.pending || []).map(p => p.requestId));
    if (!first) {
      for (const p of x.pending || []) if (!was.req.has(p.requestId)) out.push({ kind: 'needs', chat: x, pending: p });
      if (x.phase === 'idle' && x.finishedAt && x.finishedAt !== was.fin && !req.size) out.push({ kind: 'reply', chat: x });
      if (was.req.size && !req.size) out.push({ kind: 'clear', chat: x });
    }
    seen.map.set(x.key, { req, fin: x.finishedAt || null });
  }
  for (const [k, was] of seen.map) if (!list.some(x => x.key === k)) { if (was.req.size) out.push({ kind: 'clear', chat: { key: k } }); seen.map.delete(k); }
  seen.primed = true;
  return out;
}

module.exports = { createPush, encrypt, vapidHeader, cleanPrefs, wants, news, CONTACT };
