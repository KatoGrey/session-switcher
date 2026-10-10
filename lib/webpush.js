'use strict';
// Web push with no packages: VAPID (RFC 8292) to say who's sending, and the aes128gcm content
// encoding (RFC 8291) so only the phone can read the message. Used by Switcher Lite's phone alerts.
//
// The keys live in push.json in the data folder (never in the repo), with each phone's subscription.

const crypto = require('crypto');
const https = require('https');
const http = require('http');

const b64u = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// A new P-256 key pair for VAPID: the public key raw (65 bytes, base64url) for the page, the private
// key as a JWK for signing.
function makeVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), unb64u(pub.x), unb64u(pub.y)]);
  return { publicKey: b64u(raw), privateJwk: jwk };
}

// The Authorization header for one push service (its origin is the audience), valid for 12 hours.
function vapidHeader(endpoint, keys, subject = 'mailto:switcher@localhost', now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const key = crypto.createPrivateKey({ key: keys.privateJwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

// RFC 8291: encrypts the payload for one subscription (its p256dh key and auth secret).
function encrypt(payload, sub, { salt = crypto.randomBytes(16), serverKeys = null } = {}) {
  const uaPublic = unb64u(sub.keys.p256dh);
  const authSecret = unb64u(sub.keys.auth);
  const ecdh = crypto.createECDH('prime256v1');
  if (serverKeys) ecdh.setPrivateKey(serverKeys); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  // One record: the payload, then the 0x02 delimiter that marks the last record.
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

// What a browser does on receipt (used by the tests to check the round trip).
function decrypt(body, uaPrivate, authSecret) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const data = body.subarray(21 + idlen);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const uaPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(asPublic);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString();
}

// Sends one notification. Resolves { status }; 404/410 mean the subscription is gone.
function send(sub, payload, keys, { ttl = 3600, urgency = 'normal', topic = null, subject } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(sub.endpoint); } catch { return reject(new Error('Bad push endpoint.')); }
    const body = encrypt(JSON.stringify(payload), sub);
    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', 'Content-Length': body.length, TTL: String(ttl), Urgency: urgency, ...(topic ? { Topic: topic } : {}), Authorization: vapidHeader(sub.endpoint, keys, subject) },
      timeout: 15000,
    }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
    req.on('timeout', () => req.destroy(new Error('The push service took too long.')));
    req.on('error', reject);
    req.end(body);
  });
}

module.exports = { makeVapidKeys, vapidHeader, encrypt, decrypt, send, b64u, unb64u };
