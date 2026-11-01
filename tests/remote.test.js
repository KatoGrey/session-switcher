'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { createRemote } = require('../lib/remote');

const freePort = () => new Promise(resolve => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});

test('removing a phone closes all its live streams and leaves another phone connected', { timeout: 10000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-revoke-phone-')), port = await freePort();
  const open = new Map(), remote = createRemote({ dataDir: root, appDir: root, version: 'test',
    getPrefs: () => ({ phone: { enabled: true, port } }),
    handle(req, res) {
      open.set(`${req.device.name}${req.url}`, res);
      res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: connected\n\n');
    },
  });
  t.after(() => { remote.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  await remote.sync();
  const pair = name => { const { code } = remote.startPairing(); return remote.pair(code, name, '127.0.0.1'); };
  const first = pair('First'), second = pair('Second');
  const base = `http://127.0.0.1:${port}`;
  const readers = [];
  for (const route of ['/api/events?stream=test', '/api/chat/events?key=test', '/api/notify/stream']) {
    const response = await fetch(base + route, { headers: { cookie: `sw_device=${first.cookie}` } });
    assert.equal(response.status, 200);
    const reader = response.body.getReader(); await reader.read(); readers.push(reader);
  }
  const keep = await fetch(base + '/api/events', { headers: { cookie: `sw_device=${second.cookie}` } });
  assert.equal(keep.status, 200);
  const reader = keep.body.getReader(); await reader.read();
  remote.forget(first.device.id);
  for (const removed of readers) assert.equal((await removed.read()).done, true, 'revoked stream ends immediately');
  open.get('Second/api/events').write('data: still connected\n\n');
  const next = await reader.read();
  assert.equal(next.done, false); assert.match(Buffer.from(next.value).toString(), /still connected/);
  const denied = await fetch(base + '/api/events', { headers: { cookie: `sw_device=${first.cookie}` } });
  assert.equal(denied.status, 401);
  await denied.arrayBuffer();
  const malformed = await fetch(base + '/api/events', { headers: { cookie: 'sw_device=%zz' } });
  assert.equal(malformed.status, 401); await malformed.arrayBuffer();
  await reader.cancel();
});

