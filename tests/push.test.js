'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const push = require('../lib/push');

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
// A phone: its keys, and how it opens a message (RFC 8291, the other side).
function phone() {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const keys = { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
  const open = body => {
    const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), n = body[20], asPublic = body.subarray(21, 21 + n), ct = body.subarray(21 + n);
    assert.equal(rs, 4096);
    const shared = ua.computeSecret(asPublic);
    const ikm = hmac(hmac(auth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic, Buffer.from([1])]));
    const prk = hmac(salt, ikm);
    const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
    const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
    const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
    d.setAuthTag(ct.subarray(ct.length - 16));
    const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
    assert.equal(plain[plain.length - 1], 2, 'the last record’s delimiter');
    return plain.subarray(0, plain.length - 1).toString('utf8');
  };
  return { keys, open };
}

test('push: a message is encrypted so only the phone can open it', () => {
  const p = phone();
  const body = push.encrypt('{"title":"Starfall Tavern needs you"}', p.keys);
  assert.equal(p.open(body), '{"title":"Starfall Tavern needs you"}');
  assert.ok(!body.includes(Buffer.from('Starfall')), 'not readable on the way');
  assert.throws(() => push.encrypt('x', { p256dh: 'AAAA', auth: 'BBBB' }), /keys aren’t right/);
});

test('push: the encryption matches the standard’s own worked example (RFC 8291, appendix A)', () => {
  const as = crypto.createECDH('prime256v1');
  as.setPrivateKey(Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url'));
  const body = push.encrypt(Buffer.from('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24', 'base64url'),
    { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    { salt: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'), ecdh: as });
  assert.equal(body.toString('base64url'), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('push: signed by this PC, for the push service it goes to; subscriptions per phone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-push-'));
  const sent = [];
  const pu = push.createPush({ dataDir: dir, send: async (endpoint, headers, body) => { sent.push({ endpoint, headers, body }); return { status: endpoint.includes('gone') ? 410 : 201, text: '' }; } });
  const p = phone(), q = phone();
  assert.throws(() => pu.subscribe('dev1', { endpoint: 'http://insecure.example/x', keys: p.keys }), /isn’t a push subscription/);
  pu.subscribe('dev1', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: p.keys }, { levels: { 'S-1': 'off' } });
  pu.subscribe('dev2', { endpoint: 'https://web.push.apple.com/gone', keys: q.keys });
  assert.equal(pu.count(), 2);
  const out = await pu.notify({ kind: 'needs', title: 'Hi', tag: 'k:1' });
  assert.deepEqual(out.map(o => o.status), [201, 410]);
  assert.equal(pu.count(), 1, 'a subscription that has ended is forgotten');
  const h = sent[0].headers;
  assert.equal(h['Content-Encoding'], 'aes128gcm'); assert.equal(h.Urgency, 'high');
  assert.equal(JSON.parse(p.open(sent[0].body)).title, 'Hi');
  // The signature checks out with the public key the phone subscribed with.
  const [, jwt, k] = h.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, pu.publicKey());
  const [hd, cl, sig] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(cl, 'base64url'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, push.CONTACT);
  const raw = Buffer.from(k, 'base64url');
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${hd}.${cl}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
  // Kept across restarts, the same keys; removing the phone stops its pushes.
  const again = push.createPush({ dataDir: dir });
  assert.equal(again.publicKey(), pu.publicKey());
  assert.equal(again.count('dev1'), 1);
  again.forgetDevice('dev1');
  assert.equal(again.count(), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('push: each phone’s alert levels and quiet hours (in its own time zone)', () => {
  const prefs = push.cleanPrefs({ levels: { 'S-1': 'off', 's-2': 'needs', 's-3': 'all', bad: 'loud' }, quiet: { on: true, from: '22:00', to: '08:00' }, tz: 'America/New_York' });
  assert.deepEqual(prefs.levels, { 's-1': 'off', 's-2': 'needs' });
  const noon = new Date('2026-10-11T16:00:00Z'), night = new Date('2026-10-12T03:00:00Z');   // 12:00 and 23:00 in New York
  assert.equal(push.wants(prefs, { kind: 'needs', sessionId: 's-1' }, noon), false);
  assert.equal(push.wants(prefs, { kind: 'reply', sessionId: 's-2' }, noon), false);
  assert.equal(push.wants(prefs, { kind: 'needs', sessionId: 's-2' }, noon), true);
  assert.equal(push.wants(prefs, { kind: 'reply', sessionId: 'other' }, noon), true);
  assert.equal(push.wants(prefs, { kind: 'needs', sessionId: 'other' }, night), false, 'quiet hours');
  assert.equal(push.cleanPrefs({ tz: 'Not/AZone' }).tz, '');
  // Replies: by default only from chats you wrote to lately; needing you always gets through.
  const d = push.cleanPrefs({});
  assert.equal(d.replies, 'recent');
  // Replies right away by default, or gathered every 15 or 60 minutes (nothing else).
  assert.equal(d.digest, 0);
  assert.equal(push.cleanPrefs({ digest: 15 }).digest, 15);
  assert.equal(push.cleanPrefs({ digest: '60' }).digest, 60);
  assert.equal(push.cleanPrefs({ digest: 5 }).digest, 0);
  assert.equal(push.wants(d, { kind: 'reply', sessionId: 'x', yourRecent: false }, noon), false, 'a chat you left working on its own');
  assert.equal(push.wants(d, { kind: 'reply', sessionId: 'x', yourRecent: true }, noon), true);
  assert.equal(push.wants(d, { kind: 'needs', sessionId: 'x', yourRecent: false }, noon), true);
  assert.equal(push.wants(push.cleanPrefs({ replies: 'all' }), { kind: 'reply', sessionId: 'x', yourRecent: false }, noon), true);
  assert.equal(push.wants(push.cleanPrefs({ replies: 'none' }), { kind: 'reply', sessionId: 'x', yourRecent: true }, noon), false);
});

test('push: what’s new is approvals that just came up and replies that just finished', () => {
  const seen = { map: new Map(), primed: false };
  const chat = (o) => ({ source: 'app', key: 'k1', sessionId: 's1', title: 'Rally', phase: 'thinking', pending: [], finishedAt: null, ...o });
  assert.deepEqual(push.news([chat({ phase: 'waiting', pending: [{ requestId: 'r0' }] })], seen), [], 'the first look only learns');
  let n = push.news([chat({ phase: 'waiting', pending: [{ requestId: 'r0' }, { requestId: 'r1' }] })], seen);
  assert.deepEqual(n.map(x => `${x.kind}:${x.pending.requestId}`), ['needs:r1']);
  assert.deepEqual(push.news([chat({ phase: 'waiting', pending: [{ requestId: 'r1' }] })], seen), [], 'the same one isn’t sent twice');
  n = push.news([chat({ phase: 'idle', finishedAt: 5 })], seen);
  assert.deepEqual(n.map(x => x.kind), ['reply', 'clear'], 'answered: its notification can go');
  assert.deepEqual(push.news([chat({ phase: 'idle', finishedAt: 5 })], seen), []);
  push.news([chat({ phase: 'waiting', pending: [{ requestId: 'r9' }] })], seen);
  assert.deepEqual(push.news([], seen).map(x => `${x.kind}:${x.chat.key}`), ['clear:k1'], 'a chat that stopped while asking clears too');
  // Chats elsewhere (terminals, the desktop app) aren't this app's to push about.
  assert.deepEqual(push.news([{ source: 'terminal', key: null, phase: 'waiting', pending: [{ requestId: 'z' }] }], seen), []);
});
