#!/usr/bin/env node
// Runs every test: the logic and server checks (*.test.js), then the browser suites (ui.js) against a
// separate copy of the app on a free port, with a throwaway data folder. Your own Session Switcher,
// its accounts and its history are never touched.
//
//   node tests/run.js                 everything
//   node tests/run.js menus chat      only the browser suites named
//   SHOTS=folder node tests/run.js    also save screenshots there
//   node tests/run.js "look checks"   compare every theme with how it looked last time (LOOKS=folder
//                                     for where; the first run, or LOOKS_RESET=1, keeps a new baseline)
//   BROWSER=/path/to/chrome           use a particular browser (Edge or Chrome is found by itself)
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

// The whole run gets a temp folder of its own: the logic checks, the test copy of the app and the
// browsers make their throwaway folders in it (TEMP and TMP on Windows, TMPDIR on a Mac, all read by
// os.tmpdir() each time), and it's deleted at the end, passed or failed or stopped with Ctrl+C. So
// nothing piles up in the real temp folder, and nothing outside this one is touched.
const RUN_TMP = path.join(os.tmpdir(), `ss-run-${process.pid}-${Date.now().toString(36)}`);
fs.mkdirSync(RUN_TMP, { recursive: true });
const TMP_ENV = { TEMP: RUN_TMP, TMP: RUN_TMP, TMPDIR: RUN_TMP };
Object.assign(process.env, TMP_ENV);
// Windows keeps a file locked a moment after the program that had it open has stopped (a browser
// profile, the app's log), so it tries for about 5 s; what still can't go is left.
function removeRunTmp() {
  for (let i = 0; i < 10; i++) {
    try { fs.rmSync(RUN_TMP, { recursive: true, force: true }); return; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); }
  }
}
process.on('exit', removeRunTmp);
// Stopped partway: the test copy of the app and any browser still open go first, so their files can be deleted.
const running = new Set();
process.on('SIGINT', () => { for (const x of running) try { x.close ? x.close() : x.kill(); } catch { /* gone */ } process.exit(130); });

const { launch, sleep } = require('./browser');
const demo = require('./demo');
const suites = [...require('./ui'), ...require('./project-art.ui'), ...require('./theme-studio.ui')];

const APP = path.join(__dirname, '..');
const only = process.argv.slice(2);
const SHOTS = process.env.SHOTS ? path.resolve(process.env.SHOTS) : null;

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

async function main() {
  let failed = 0;
  if (!only.length) {
    console.log('— logic and server checks');
    const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).map(f => path.join(__dirname, f));
    // On GitHub the failures are also written as annotations (from a TAP copy of the results), each
    // with its error and where it happened, readable on the run's page without signing in.
    const tap = process.env.GITHUB_ACTIONS ? path.join(RUN_TMP, `ss-tap-${process.pid}.txt`) : null;
    const runLogic = () => spawnSync(process.execPath, ['--test', '--test-reporter=spec', '--test-reporter-destination=stdout', ...(tap ? ['--test-reporter=tap', `--test-reporter-destination=${tap}`] : []), ...files], { stdio: 'inherit', cwd: APP, env: { ...process.env, ...TMP_ENV } });
    const failures = () => {
      let text = ''; try { text = fs.readFileSync(tap, 'utf8'); } catch { return []; }
      const out = [];
      const lines = text.split(/\r?\n/);
      lines.forEach((l, i) => {
        const m = l.match(/^(\s*)not ok \d+ - (.+)$/); if (!m) return;
        // Its details: "  error: |-" (with the message on the lines under it), "  location: '…'".
        const pad = m[1].length + 2, why = [];
        let key = null;
        for (let j = i + 1; j < lines.length && !/^\s*(not )?ok \d+ /.test(lines[j]) && !/^\s*# Subtest/.test(lines[j]); j++) {
          const x = lines[j], k = x.slice(pad).match(/^(\w+):\s*(.*)$/);
          if (x.length - x.trimStart().length === pad && k) { key = k[1]; if (key === 'error' || key === 'location') why.push(`${key}: ${k[2].replace(/^\|-?$/, '')}`.trim()); }
          else if (key === 'error' && x.trim() && why.length < 6) why.push(x.trim());
        }
        out.push(`${m[2].slice(0, 300)}${why.length ? ` — ${why.join(' ').replace(/\s+/g, ' ').slice(0, 600)}` : ''}`);
      });
      return out;
    };
    let r = runLogic();
    // On GitHub, as with the browser suites: a failure is run once more before it counts (their Macs
    // are slow and uneven); a real fault fails both times. The first miss is still noted.
    if (r.status !== 0 && process.env.CI) {
      const first = tap ? failures() : [];
      console.log(`  ↻ the logic checks missed ${first.length || 'something'}; once more`);
      r = runLogic();
      if (r.status === 0) for (const f of first) console.log(`::warning title=logic tests (passed the second time)::${f.replace(/%/g, '%25')}`);
    }
    if (tap && r.status !== 0) for (const f of failures()) console.log(`::error title=logic tests::${f.replace(/%/g, '%25')}`);
    if (r.status !== 0) failed++;
  }

  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(RUN_TMP, 'ss-data-'));
  const base = `http://127.0.0.1:${port}/`;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: APP,
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^SWITCHER_/.test(k))), ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}), SWITCHER_PORT: String(port), SWITCHER_DATA_DIR: dataDir, SWITCHER_NO_BROWSER: '1', SWITCHER_DRY_RUN: '1', ...TMP_ENV },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.add(server);
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
    if (only.length ? !only.includes(suite.name) : suite.onlyByName) continue;
    console.log(`— ${suite.name}`);
    // On GitHub (CI), a suite that fails is run once more before it counts: their machines (the Mac
    // especially) are slow and uneven, so a check can miss a moment that's there. A real fault fails
    // both times. Here, on your PC, once is enough.
    const tries = process.env.CI ? 2 : 1;
    for (let attempt = 1; attempt <= tries; attempt++) {
      const browsers = [], lines = [], fails = [];
      const say = (name, detail) => `${name}${detail !== undefined ? `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`;
      const t = {
        check(name, ok, detail) {
          if (!ok) fails.push(say(name, detail));
          lines.push(`  ${ok ? '✔' : '✖'} ${ok ? name : say(name, detail)}`);
        },
        // path: what follows the address, like "?chat=…" for a popped-out chat.
        async open({ width = 1440, height = 900, mobile = false, demo: useDemo = true, path: at = '', ...demoOpts } = {}) {
          const b = await launch({ width, height, mobile });
          browsers.push(b); running.add(b);
          if (useDemo) await demo.install(b, demoOpts);
          await b.nav(base + at, 3000);
          return b;
        },
        async shot(b, name) { if (SHOTS) await b.shot(path.join(SHOTS, `${suite.name.replace(/\W+/g, '-')}-${name}.png`)); },
      };
      try { await suite.run(t); } catch (err) { t.check('finished without an error', false, err.message); }
      for (const b of browsers) {
        const errors = b.logs.filter(l => /^EXC /.test(l));
        t.check('no script errors on the page', !errors.length, errors.slice(0, 3));
        b.close(); running.delete(b);
      }
      if (fails.length && attempt < tries) { console.log(`  ↻ ${fails.length} check${fails.length === 1 ? '' : 's'} missed (${fails[0].slice(0, 160)}); once more`); continue; }
      for (const l of lines) console.log(l);
      if (!fails.length && attempt > 1) console.log('  (passed the second time)');
      failed += fails.length;
      // On GitHub, each failed check is also an annotation, readable on the run's page without signing in.
      if (process.env.GITHUB_ACTIONS) for (const f of fails) console.log(`::error title=${suite.name.replace(/[\r\n:,]/g, ' ')}::${f.replace(/%/g, '%25').replace(/\r?\n/g, '%0A').slice(0, 900)}`);
      break;
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
