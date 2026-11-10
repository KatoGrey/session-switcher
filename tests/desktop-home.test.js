'use strict';
// The desktop app's window on a laptop: your home PC when it answers, this laptop when it doesn't.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createHome } = require('../desktop/shell/home');

test('the window opens the PC, falls back to the laptop when it stops answering, and goes back when asked', { timeout: 20000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-home-'));
  let answering = true;
  const relay = http.createServer((req, res) => {
    if (!answering) { res.writeHead(502); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ app: 'session-switcher', paired: true }));
  });
  await new Promise(r => relay.listen(0, '127.0.0.1', r));
  const relayPort = relay.address().port;
  t.after(() => { relay.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const loads = [], told = [], notes = [];
  const win = { isDestroyed: () => false, loadURL: u => loads.push(u) };
  const home = createHome({ dataDir: dir, relayPort, localUrl: 'http://127.0.0.1:4777/', window: () => win, notify: t1 => notes.push(t1), post: async (p, b) => { told.push([p, b]); return 200; } });

  // Not paired: the laptop, quietly.
  assert.equal(await home.startUrl(), 'http://127.0.0.1:4777/');
  assert.equal(notes.length, 0);
  fs.writeFileSync(path.join(dir, 'home-pc.json'), JSON.stringify({ key: 'k', use: 'pc' }));
  assert.equal(await home.startUrl(), `http://127.0.0.1:${relayPort}/`);
  assert.equal(home.state().on, 'pc');

  // It stops answering: two checks later the window is on the laptop, and you're told.
  answering = false;
  const tick = () => new Promise(r => { home.begin(); setTimeout(r, 0); });
  void tick;
  home.pageLoaded(`http://127.0.0.1:${relayPort}/`, 502);
  assert.equal(home.state().on, 'laptop');
  assert.equal(home.state().reason, 'pc-down');
  assert.equal(loads.at(-1), 'http://127.0.0.1:4777/');
  assert.ok(notes.length >= 1);
  assert.deepEqual(told.at(-1), ['/api/homepc/showing', { on: 'laptop', reason: 'pc-down' }]);

  // Back on: switching is yours to do, and remembered.
  answering = true;
  home.switchTo('pc');
  assert.equal(home.state().on, 'pc');
  assert.equal(loads.at(-1), `http://127.0.0.1:${relayPort}/`);
  assert.ok(told.some(([p, b]) => p === '/api/homepc/use' && b.use === 'pc'));
  home.switchTo('laptop');
  assert.equal(home.state().reason, 'chosen');
  home.stop();

  // Paired but chose the laptop: it starts there.
  fs.writeFileSync(path.join(dir, 'home-pc.json'), JSON.stringify({ key: 'k', use: 'laptop' }));
  assert.equal(await home.startUrl(), 'http://127.0.0.1:4777/');
  // Chose the PC but it's off: the laptop, and a note.
  fs.writeFileSync(path.join(dir, 'home-pc.json'), JSON.stringify({ key: 'k', use: 'pc' }));
  answering = false;
  const n = notes.length;
  assert.equal(await home.startUrl(), 'http://127.0.0.1:4777/');
  assert.equal(notes.length, n + 1);
});
