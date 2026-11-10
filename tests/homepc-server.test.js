'use strict';
// The real server, twice: a "PC" and a "laptop", each with a pretend home of its own (no real accounts,
// chats or settings are seen). Nothing of "Your home PC" is on until it's turned on: the PC refuses to be
// copied from until "This is my home PC" is on there (and only the PC itself can turn that on). Then the
// laptop pairs through the PC's phone access, copies its work down through the routes as server.js wires
// them, and shows the PC's page through its relay.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const APP = path.join(__dirname, '..');
const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const put = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function startServer(W, name, { phonePort } = {}) {
  const home = path.join(W, name, 'home'), data = path.join(W, name, 'data'), tmp = path.join(W, name, 'tmp');
  for (const d of [home, data, tmp]) fs.mkdirSync(d, { recursive: true });
  const port = await freePort(), homePort = await freePort();
  put(path.join(data, 'accounts.json'), JSON.stringify({ mainConfigDir: path.join(home, '.claude'), claudeCommand: 'claude-not-here', accounts: [], prefs: { phone: { enabled: !!phonePort, port: phonePort || 4788 } }, codex: { enabled: false, command: 'codex-not-here' }, gemini: { enabled: false, command: 'agy-not-here' } }));
  const env = { ...process.env, USERPROFILE: home, HOME: home, TEMP: tmp, TMP: tmp, TMPDIR: tmp, SWITCHER_DATA_DIR: data, SWITCHER_PORT: String(port), SWITCHER_HOME_PORT: String(homePort), SWITCHER_NO_BROWSER: '1' };
  for (const k of Object.keys(env)) if (/^SWITCHER_(SHELL|RESTART_FROM)$/.test(k)) delete env[k];
  const child = spawn(process.execPath, [path.join(APP, 'server.js')], { cwd: APP, env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let err = ''; child.stderr.on('data', d => { err += d; });
  const base = `http://127.0.0.1:${port}`;
  let token = null;
  for (let i = 0; i < 150 && !token; i++) {
    await sleep(200);
    try { const html = await (await fetch(`${base}/`)).text(); token = (/TOKEN = '([a-f0-9]+)'/.exec(html) || [])[1] || null; } catch { /* not up yet */ }
  }
  if (!token) { child.kill(); throw new Error(`${name} didn’t start: ${err.slice(-800)}`); }
  const api = async (p, body) => {
    const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'X-Switcher-Token': token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json();
    if (!r.ok) throw new Error(`${p}: ${j.error}`);
    return j;
  };
  return { child, home, data, port, homePort, api };
}
async function copied(laptop) {
  let st;
  for (let i = 0; i < 300; i++) { st = await laptop.api('/api/homepc'); if (st.job && st.job.state !== 'running') break; await sleep(200); }
  return st;
}

test('the real server: off until turned on at the PC; then a laptop pairs, copies its work, and shows the PC through its relay', { timeout: 120000 }, async t => {
  const W = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-hps-')));
  const phonePort = await freePort();
  // The PC: a project with a chat in it.
  const pcHome = path.join(W, 'pc', 'home');
  const proj = path.join(pcHome, 'Desktop', 'Games', 'Starfall Tavern');
  put(path.join(proj, 'story.txt'), 'chapter one');
  put(path.join(proj, 'art', 'hero.bin'), Buffer.alloc(50000, 3));
  put(path.join(pcHome, '.claude', '.credentials.json'), '{"secret":true}');
  const sid = '11111111-2222-3333-4444-555555555555';
  put(path.join(pcHome, '.claude', 'projects', proj.replace(/[^a-zA-Z0-9]/g, '-'), `${sid}.jsonl`), `${JSON.stringify({ type: 'user', sessionId: sid, cwd: proj, timestamp: new Date().toISOString(), uuid: 'u1', message: { role: 'user', content: 'Plan chapter two' } })}\n`);
  const pc = await startServer(W, 'pc', { phonePort });
  t.after(() => { try { pc.child.kill(); } catch { /* gone */ } });
  const laptop = await startServer(W, 'laptop');
  t.after(() => { try { laptop.child.kill(); } catch { /* gone */ } });
  t.after(async () => { await sleep(500); fs.rmSync(W, { recursive: true, force: true }); });

  // Nobody has turned anything on: neither computer is a home PC or a laptop of one, and nothing was made for it.
  for (const c of [pc, laptop]) {
    const st = await c.api('/api/homepc');
    assert.equal(st.share, false);
    assert.equal(st.paired, false);
    for (const f of ['home-pc', 'home-pc.json', 'mirror-snap']) assert.ok(!fs.existsSync(path.join(c.data, f)), `${f} isn’t made until it’s used`);
  }
  assert.equal((await pc.api('/api/homepc')).phoneOn, true);
  await assert.rejects(fetch(`http://127.0.0.1:${laptop.homePort}/`), 'no relay listens on a computer that isn’t paired');

  // A pairing code from the PC, typed into the laptop.
  for (let i = 0; i < 50 && !(await pc.api('/api/phone')).listening; i++) await sleep(100);
  const { code } = await pc.api('/api/phone/pair', {});
  const paired = await laptop.api('/api/homepc/pair', { address: `127.0.0.1:${phonePort}`, code });
  assert.equal(paired.paired, true);
  assert.equal((await laptop.api('/api/homepc')).up, true);

  // Paired isn't enough to copy: the PC says how to turn it on, and nothing comes over.
  await laptop.api('/api/homepc/copy', { dir: 'down', all: true });
  let st = await copied(laptop);
  assert.equal(st.job.state, 'failed');
  assert.match(st.job.errors[0].error, /isn’t turned on on your home PC.*This is my home PC/);
  assert.ok(!st.lastDown, 'a copy that never began isn’t the last copy');
  const lapProj = path.join(laptop.home, 'Desktop', 'Games', 'Starfall Tavern');
  assert.ok(!fs.existsSync(lapProj));
  // The PC's page, through the laptop's relay, as the laptop's window would show it.
  const page = await (await fetch(`http://127.0.0.1:${laptop.homePort}/`)).text();
  assert.match(page, /window\.REMOTE = true/);
  const pcToken = /TOKEN = '([a-f0-9]+)'/.exec(page)[1];
  const viaRelay = (p, opts = {}) => fetch(`http://127.0.0.1:${laptop.homePort}${p}`, { ...opts, headers: { 'X-Switcher-Token': pcToken, Origin: `http://127.0.0.1:${laptop.homePort}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  // A paired device can't turn it on for itself: only someone at the PC can.
  const sneak = await viaRelay('/api/homepc/share', { method: 'POST', body: JSON.stringify({ on: true }) });
  assert.equal(sneak.status, 403);
  assert.equal((await pc.api('/api/homepc')).share, false);

  // Turned on at the PC.
  assert.equal((await pc.api('/api/homepc/share', { on: true })).share, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(pc.data, 'accounts.json'), 'utf8')).prefs.homePcShare, true);

  // The two user folders aren't the same here (as two computers with different user names): it says so first.
  await laptop.api('/api/homepc/copy', { dir: 'down', all: true });
  st = await copied(laptop);
  assert.equal(st.job.state, 'blocked');
  assert.deepEqual(st.job.warn.homes, { pc: pcHome, here: laptop.home });
  assert.ok(!fs.existsSync(lapProj));

  // Everything down.
  await laptop.api('/api/homepc/copy', { dir: 'down', all: true, force: true });
  st = await copied(laptop);
  assert.equal(st.job.state, 'done', JSON.stringify(st.job));
  assert.equal(fs.readFileSync(path.join(lapProj, 'story.txt'), 'utf8'), 'chapter one');
  assert.equal(fs.statSync(path.join(lapProj, 'art', 'hero.bin')).size, 50000);
  // (Chats come as they are: with the same user folder on both computers, their folders match.)
  assert.ok(fs.existsSync(path.join(laptop.home, '.claude', 'projects', proj.replace(/[^a-zA-Z0-9]/g, '-'), `${sid}.jsonl`)));
  assert.ok(!fs.existsSync(path.join(laptop.home, '.claude', '.credentials.json')), 'the sign-in stays on the PC');
  const incoming = JSON.parse(fs.readFileSync(path.join(laptop.data, 'home-pc', 'incoming', 'accounts.json'), 'utf8'));
  assert.equal(incoming.prefs.homePcShare, false, 'the laptop doesn’t become a home PC by copying one');
  assert.equal(incoming.prefs.phone.enabled, false);
  // Said once, the warning isn't raised again.
  await laptop.api('/api/homepc/copy', { dir: 'down' });
  st = await copied(laptop);
  assert.equal(st.job.state, 'done', JSON.stringify(st.job));

  // The PC's chats, seen from the laptop through the relay.
  const r = await viaRelay('/api/sessions');
  assert.equal(r.status, 200);
  const sessions = await r.json();
  assert.ok(sessions.projects.some(p => p.cwd === proj), 'the PC’s chats, seen from the laptop');
  // The laptop's own routes aren't the PC's to reach.
  const own = await viaRelay('/api/homepc');
  assert.equal(own.status, 403);

  // Turned off again at the PC: the next copy is refused.
  assert.equal((await pc.api('/api/homepc/share', { on: false })).share, false);
  await laptop.api('/api/homepc/copy', { dir: 'down' });
  st = await copied(laptop);
  assert.equal(st.job.state, 'failed');
  assert.match(st.job.errors[0].error, /isn’t turned on/);
  assert.ok(st.lastDown && st.lastDown.state === 'done', 'what was copied before is still the last copy');
});
