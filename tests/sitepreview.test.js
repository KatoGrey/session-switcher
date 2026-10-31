'use strict';
// A site's folder served for the frame beside a chat (lib/sitepreview.js): only to the page that was given
// the key, only what's in that folder, nothing private.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createSitePreview } = require('../lib/sitepreview');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-site-')));
function site() {
  const root = tmp();
  const put = (rel, text = 'x') => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
  put('index.html', '<h1>Hello</h1>'); put('css/a b.css', 'body{}'); put('sub/index.html', 'Sub'); put('auth.json', '{"token":"x"}');
  return { root, put };
}
// A request as a browser makes it, with a cookie or a Host of our choosing.
const get = (url, { cookie, host, method = 'GET' } = {}) => new Promise((res, rej) => {
  const u = new URL(url);
  const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { ...(cookie ? { cookie } : {}), ...(host ? { host } : {}) } }, r => {
    let body = ''; r.on('data', d => { body += d; }); r.on('end', () => res({ status: r.statusCode, body, headers: r.headers }));
  });
  req.on('error', rej); req.end();
});
async function signedIn(p, file) {
  const url = await p.urlFor(file);
  const first = await get(url);
  assert.equal(first.status, 302);
  assert.ok(!/k=/.test(first.headers.location), 'the key leaves the address');
  const cookie = first.headers['set-cookie'][0].split(';')[0];
  assert.match(first.headers['set-cookie'][0], /HttpOnly/);
  assert.match(first.headers['set-cookie'][0], /SameSite=Strict/);
  return { base: new URL(url).origin, cookie, url };
}

test('site preview: the page with the key sees the site', async () => {
  const { root } = site();
  const p = createSitePreview({});
  try {
    const { base, cookie } = await signedIn(p, path.join(root, 'index.html'));
    const home = await get(`${base}/index.html`, { cookie });
    assert.equal(home.status, 200);
    assert.equal(home.body, '<h1>Hello</h1>');
    assert.match(home.headers['content-type'], /text\/html/);
    assert.equal((await get(`${base}/css/a%20b.css`, { cookie })).body, 'body{}');
    assert.match((await get(`${base}/css/a%20b.css`, { cookie })).headers['content-type'], /text\/css/);
    assert.equal((await get(`${base}/sub/`, { cookie })).body, 'Sub', 'a folder is its index.html');
    assert.equal((await get(`${base}/`, { cookie })).body, '<h1>Hello</h1>');
    assert.equal((await get(`${base}/nope.html`, { cookie })).status, 404);
    assert.equal((await get(`${base}/index.html`, { cookie, method: 'HEAD' })).body, '');
  } finally { p.stopAll(); }
});

test('site preview: nobody else gets in', async () => {
  const { root } = site();
  const p = createSitePreview({});
  try {
    const { base, cookie, url } = await signedIn(p, path.join(root, 'index.html'));
    assert.equal((await get(`${base}/index.html`)).status, 403, 'no cookie');
    assert.equal((await get(`${base}/index.html`, { cookie: 'ss_site=abc' })).status, 403, 'the wrong one');
    assert.equal((await get(`${base}/index.html?k=wrong`)).status, 403, 'the wrong key');
    assert.equal((await get(`${base}/index.html`, { cookie, host: 'evil.example' })).status, 403, 'another name for this address');
    assert.equal((await get(url, { host: 'evil.example' })).status, 403);
    const post = await new Promise((res, rej) => { const u = new URL(`${base}/index.html`); const r = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { cookie } }, x => { x.resume(); res(x.statusCode); }); r.on('error', rej); r.end(); });
    assert.equal(post, 405);
  } finally { p.stopAll(); }
});

test('site preview: only that folder, and nothing private', async () => {
  const { root } = site();
  const outside = tmp();
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  const p = createSitePreview({ allowed: f => !/auth\.json$/.test(f) });
  try {
    const { base, cookie } = await signedIn(p, path.join(root, 'index.html'));
    assert.equal((await get(`${base}/auth.json`, { cookie })).status, 403, 'as the viewer would refuse it');
    for (const bad of ['/../secret.txt', '/..%2f..%2fsecret.txt', '/%2e%2e/%2e%2e/secret.txt']) {
      const r = await get(base + bad, { cookie });
      assert.ok(r.status === 403 || r.status === 404, `${bad}: ${r.status}`);
      assert.ok(!r.body.includes('secret'), bad);
    }
    if (process.platform === 'win32') {
      fs.symlinkSync(outside, path.join(root, 'linked'), 'junction');
      assert.equal((await get(`${base}/linked/secret.txt`, { cookie })).status, 403, 'nor what a link leads to');
    }
  } finally { p.stopAll(); }
});

test('site preview: a second site doesn’t lock out the first', async () => {
  const one = site(), two = site();
  fs.writeFileSync(path.join(two.root, 'index.html'), 'Two');
  const p = createSitePreview({});
  try {
    const a = await signedIn(p, path.join(one.root, 'index.html')), b = await signedIn(p, path.join(two.root, 'index.html'));
    assert.notEqual(a.cookie.split('=')[0], b.cookie.split('=')[0], 'cookies don’t keep to a port, so each has its own');
    // As a browser sends them: both, to either.
    const jar = `${a.cookie}; ${b.cookie}`;
    assert.equal((await get(`${a.base}/index.html`, { cookie: jar })).body, '<h1>Hello</h1>');
    assert.equal((await get(`${b.base}/index.html`, { cookie: jar })).body, 'Two');
    assert.equal((await get(`${a.base}/index.html`, { cookie: b.cookie })).status, 403, 'and one’s isn’t the other’s');
  } finally { p.stopAll(); }
});

test('site preview: one server however many ask at once, and stopping stops them all', async () => {
  const { root } = site();
  const p = createSitePreview({});
  const urls = await Promise.all(Array.from({ length: 6 }, (_, i) => p.urlFor(path.join(root, `page${i}.html`))));
  assert.equal(new Set(urls.map(u => new URL(u).port)).size, 1);
  assert.equal(p.size(), 1);
  const late = p.urlFor(path.join(root, 'sub', 'index.html'));
  p.stopAll();
  await assert.rejects(late);
  assert.equal(p.size(), 0, 'not even one that was still starting');
  await assert.rejects(get(urls[0]), 'the server’s gone');
});

test('site preview: sends what it promised, and lets go of a file when the page stops reading', async () => {
  const { root, put } = site();
  const big = put('big.bin', Buffer.alloc(6 << 20, 7)), empty = put('empty.txt', '');
  const p = createSitePreview({});
  try {
    const { base, cookie } = await signedIn(p, path.join(root, 'index.html'));
    const none = await get(`${base}/empty.txt`, { cookie });
    assert.equal(none.status, 200);
    assert.equal(none.body, '');
    fs.rmSync(empty);
    await new Promise((res, rej) => {
      const u = new URL(`${base}/big.bin`);
      const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, headers: { cookie } }, r => {
        assert.equal(r.headers['content-length'], String(6 << 20));
        r.once('data', () => { req.destroy(); res(); });
      });
      req.on('error', () => {}); req.on('close', res); req.end();
      setTimeout(() => rej(new Error('no answer')), 5000).unref();
    });
    let gone = false;
    for (let i = 0; i < 40 && !gone; i++) {
      try { fs.rmSync(big); gone = true; } catch { await new Promise(r => setTimeout(r, 50)); }
    }
    assert.ok(gone, 'the file isn’t held open');
  } finally { p.stopAll(); }
});

test('site preview: one server a folder, and it goes when it’s not used', async () => {
  const { root } = site();
  const p = createSitePreview({ idle: 40 });
  try {
    const a = await p.urlFor(path.join(root, 'index.html')), b = await p.urlFor(path.join(root, 'sub.html'));
    assert.equal(new URL(a).port, new URL(b).port);
    assert.equal(p.size(), 1);
    const other = await p.urlFor(path.join(root, 'sub', 'index.html'));
    assert.notEqual(new URL(other).port, new URL(a).port);
    assert.equal(p.size(), 2);
    await new Promise(r => setTimeout(r, 120));
    assert.equal(p.size(), 0);
  } finally { p.stopAll(); }
});
