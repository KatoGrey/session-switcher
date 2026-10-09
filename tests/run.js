#!/usr/bin/env node
// Runs every test: the logic and server checks (*.test.js), then the browser suites (ui.js) against a
// separate copy of the app on a free port, with a throwaway data folder. Your own Session Switcher,
// its accounts and its history are never touched.
//
//   node tests/run.js                 everything
//   node tests/run.js menus chat      only the browser suites named
//   SHOTS=folder node tests/run.js    also save screenshots there
//   BROWSER=/path/to/chrome           use a particular browser (Edge or Chrome is found by itself)
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { launch, sleep } = require('./browser');
const demo = require('./demo');
const suites = require('./ui');

const APP = path.join(__dirname, '..');
const only = process.argv.slice(2);
const SHOTS = process.env.SHOTS ? path.resolve(process.env.SHOTS) : null;

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

async function main() {
  let failed = 0;
  if (!only.length) {
    console.log('— logic and server checks');
    const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).map(f => path.join(__dirname, f));
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { stdio: 'inherit', cwd: APP });
    if (r.status !== 0) failed++;
  }

  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-data-'));
  const base = `http://127.0.0.1:${port}/`;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: APP,
    env: { ...process.env, SWITCHER_PORT: String(port), SWITCHER_DATA_DIR: dataDir, SWITCHER_NO_BROWSER: '1', SWITCHER_DRY_RUN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', d => { serverLog += d; });
  server.stderr.on('data', d => { serverLog += d; });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await fetch(base)).ok; } catch { await sleep(200); }
  }
  if (!up) { console.error(`The app didn’t start:\n${serverLog}`); server.kill(); process.exit(1); }

  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  for (const suite of suites) {
    if (only.length && !only.includes(suite.name)) continue;
    console.log(`— ${suite.name}`);
    const browsers = [];
    const t = {
      check(name, ok, detail) {
        if (!ok) failed++;
        console.log(`  ${ok ? '✔' : '✖'} ${name}${!ok && detail !== undefined ? `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
      },
      // path: what follows the address, like "?chat=…" for a popped-out chat.
      async open({ width = 1440, height = 900, mobile = false, demo: useDemo = true, path: at = '', ...demoOpts } = {}) {
        const b = await launch({ width, height, mobile });
        browsers.push(b);
        if (useDemo) await demo.install(b, demoOpts);
        await b.nav(base + at, 3000);
        return b;
      },
      async shot(b, name) { if (SHOTS) await b.shot(path.join(SHOTS, `${suite.name.replace(/\W+/g, '-')}-${name}.png`)); },
    };
    try { await suite.run(t); } catch (err) { t.check(`finished without an error`, false, err.message); }
    for (const b of browsers) {
      const errors = b.logs.filter(l => /^EXC /.test(l));
      t.check('no script errors on the page', !errors.length, errors.slice(0, 3));
      b.close();
    }
  }

  // Stop this test copy of the app (only it: it's the process started above).
  try {
    const html = await (await fetch(base)).text();
    const token = (html.match(/TOKEN = '([a-f0-9]+)'/) || [])[1];
    await fetch(`${base}api/quit`, { method: 'POST', headers: { 'x-switcher-token': token, 'content-type': 'application/json' }, body: '{}' });
  } catch { /* already gone */ }
  setTimeout(() => server.kill(), 1500).unref();
  await new Promise(res => { server.on('exit', res); setTimeout(res, 3000); });
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* a file still open */ }

  console.log(failed ? `\n${failed} check${failed === 1 ? '' : 's'} failed.` : '\nEverything passed.');
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
