// The server itself, started on a free port with a throwaway data folder (your own app is never touched).
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const APP = path.join(__dirname, '..');
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

// home: a throwaway home folder, for tests that write where Claude Code and Codex keep their own files.
async function startServer(dataDir, { home = null, preload = null } = {}) {
  const port = await freePort();
  const homeEnv = home ? { HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: '' } : {};
  const proc = spawn(process.execPath, [...(preload ? ['--require', preload] : []), 'server.js'], {
    cwd: APP, stdio: 'ignore',
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^SWITCHER_/.test(k))), ...homeEnv, SWITCHER_PORT: String(port), SWITCHER_DATA_DIR: dataDir, SWITCHER_NO_BROWSER: '1', SWITCHER_DRY_RUN: '1' },
  });
  const base = `http://127.0.0.1:${port}`;
  let html = null;
  for (let i = 0; i < 100 && !html; i++) { try { html = await (await fetch(`${base}/`)).text(); } catch { await new Promise(r => setTimeout(r, 150)); } }
  if (!html) { proc.kill(); throw new Error('The server didn’t start.'); }
  const token = html.match(/TOKEN = '([a-f0-9]+)'/)[1];
  const call = async (p, body) => {
    const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'x-switcher-token': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const stop = async () => { await call('/api/quit', {}).catch(() => {}); await new Promise(r => { proc.on('exit', r); setTimeout(() => { proc.kill(); r(); }, 3000); }); };
  return { call, stop, base };
}

test('reopen: last time’s open chats are offered once, and set aside when answered', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-srv-'));
  fs.writeFileSync(path.join(dataDir, 'open-chats.json'), JSON.stringify({ at: Date.now(), chats: [
    { sessionId: '00000000-1111-4222-8333-444444444444', provider: 'claude', accountId: 'main', accountName: 'Main', cwd: 'C:\\Nowhere', title: 'A chat that’s gone', folder: 'Nowhere' },
  ] }));
  const s = await startServer(dataDir);
  try {
    const st = await s.call('/api/state');
    assert.equal(st.status, 200);
    assert.deepEqual(st.json.reopen.map(c => c.title), ['A chat that’s gone']);
    assert.ok(fs.existsSync(path.join(dataDir, 'reopen.json')) && !fs.existsSync(path.join(dataDir, 'open-chats.json')), 'set aside at start');
    const r = await s.call('/api/reopen', { action: 'reopen' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.reopened, []);
    assert.equal(r.json.failed.length, 1, 'a chat that can’t be found is reported, not thrown');
    assert.equal(r.json.failed[0].title, 'A chat that’s gone');
    assert.deepEqual((await s.call('/api/state')).json.reopen, [], 'offered once');
  } finally { await s.stop(); }
});

test('reopen: “Not now” sets them aside without opening anything', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-srv-'));
  fs.writeFileSync(path.join(dataDir, 'open-chats.json'), JSON.stringify({ at: Date.now(), chats: [{ sessionId: '00000000-1111-4222-8333-555555555555', provider: 'claude', accountId: 'main', title: 'Later' }] }));
  const s = await startServer(dataDir);
  try {
    assert.equal((await s.call('/api/state')).json.reopen.length, 1);
    const r = await s.call('/api/reopen', { action: 'dismiss' });
    assert.deepEqual(r.json, { reopened: [], failed: [] });
    assert.deepEqual((await s.call('/api/state')).json.reopen, []);
  } finally { await s.stop(); }
});

test('history: a chat that isn’t anywhere is still “not found” (only running chats get an empty history)', async () => {
  const s = await startServer(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-srv-')));
  try {
    const r = await s.call('/api/chat/history?id=00000000-1111-4222-8333-666666666666&provider=claude');
    assert.equal(r.status, 404);
    assert.match(r.json.error, /wasn’t found/);
  } finally { await s.stop(); }
});

test('openclaw: without OpenClaw the list still loads, and an unknown session reads as empty', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-home-'));
  const s = await startServer(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-srv-')), { home });
  try {
    const list = await s.call('/api/sessions');
    assert.equal(list.status, 200);
    assert.ok(!list.json.projects.some(p => p.sessions.some(x => x.provider === 'openclaw')));
    const r = await s.call('/api/chat/history?id=agent%3Amain%3Adirect%3Ax&provider=openclaw');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.items, []);
    assert.equal(r.json.error, 'unknown-session');
  } finally { await s.stop(); }
});

test('rules: saved to CLAUDE.md and AGENTS.md for every project (in a throwaway home)', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-home-'));
  const s = await startServer(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-srv-')), { home });
  try {
    const before = await s.call('/api/rules');
    assert.equal(before.status, 200);
    assert.ok(before.json.claude.path.startsWith(home) && before.json.codex.path.startsWith(home), 'only the throwaway home is used');
    const saved = await s.call('/api/rules', { text: '# Mine\n\nBe brief.', to: ['claude', 'codex'] });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.same, true);
    assert.equal(fs.readFileSync(path.join(home, '.codex', 'AGENTS.md'), 'utf8'), '# Mine\n\nBe brief.\n');
    assert.equal((await s.call('/api/rules', { text: 'x', to: [] })).status, 400, 'nowhere to save');
    assert.equal((await s.call('/api/rules?cwd=C%3A%5CNot%5CA%5CProject')).status, 404, 'only known projects');
  } finally { await s.stop(); }
});

test('updates: Codex to the newest from npm and Gemini by its own updater, each in a terminal; versions for Setup', async () => {
  const s = await startServer(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-srv-')));
  try {
    const v = await s.call('/api/tools/versions');
    assert.equal(v.status, 200);
    assert.ok('codex' in v.json && 'gemini' in v.json, 'says what it knows (null for one that’s off)');
    const cx = await s.call('/api/codex/update', {});
    assert.equal(cx.status, 200); assert.equal(cx.json.dryRun, true); assert.equal(cx.json.running, 0);
    if (cx.json.script) assert.match(cx.json.script, /npm install -g @openai\/codex@latest/);
    const gm = await s.call('/api/gemini/update', {});
    assert.equal(gm.status, 200); assert.equal(gm.json.dryRun, true);
    if (gm.json.script) assert.match(gm.json.script, /" update/);
    // Continue in a fresh chat asks a running chat; one that isn't says so.
    const h = await s.call('/api/chat/handoff', { key: 'not-a-chat' });
    assert.equal(h.status, 404); assert.match(h.json.error, /isn’t running any more/);
  } finally { await s.stop(); }
});

test('tools: listed (each side may be missing), and copying checks the name first', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-home-'));
  const s = await startServer(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-srv-')), { home });
  try {
    const t = await s.call('/api/tools');
    assert.equal(t.status, 200);
    assert.ok(Array.isArray(t.json.servers));
    assert.equal((await s.call('/api/tools/copy', { name: 'bad name', to: 'codex' })).status, 400);
    assert.equal((await s.call('/api/tools/copy', { name: 'Nope', to: 'codex' })).status, 404);
  } finally { await s.stop(); }
});

test('tasks: queued for a project, waiting while no account can start them, and removed', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-home-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-srv-'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-proj-'));
  const s = await startServer(dataDir, { home });
  try {
    assert.equal((await s.call('/api/project/create', { existing: proj, useExisting: true })).status, 200);
    const bad = await s.call('/api/tasks', { action: 'add', task: { cwd: proj, prompt: '   ' } });
    assert.equal(bad.status, 400);
    const r = await s.call('/api/tasks', { action: 'add', task: { cwd: proj, provider: 'claude', accountId: 'auto', prompt: 'Write the README.', when: 'now' } });
    assert.equal(r.status, 200);
    const id = r.json.task.id;
    let list = (await s.call('/api/tasks')).json.tasks;
    assert.equal(list.length, 1);
    assert.equal(list[0].state, 'queued');
    assert.equal(list[0].why, 'account', 'nobody is signed in in this throwaway home, so it waits');
    const start = await s.call('/api/tasks', { action: 'start', id });
    assert.equal(start.status, 409);
    assert.match(start.json.error, /sign in first/);
    assert.ok(JSON.parse(fs.readFileSync(path.join(dataDir, 'tasks.json'), 'utf8')).tasks.length === 1, 'kept on disk');
    // Repeating, with Gemini: it becomes a routine that runs on Gemini, at that time (Gemini off: it says so).
    const at = new Date(Date.now() + 3600e3).toISOString();
    const gTask = { cwd: proj, provider: 'gemini', prompt: 'Draft the lore.', when: 'at', at, repeat: 'daily' };
    const off = await s.call('/api/tasks', { action: 'add', task: gTask });
    assert.equal(off.status, 400, 'Gemini is off in this throwaway copy');
    assert.equal((await s.call('/api/gemini/settings', { enabled: true })).status, 200);
    const g = await s.call('/api/tasks', { action: 'add', task: gTask });
    assert.equal(g.status, 200, JSON.stringify(g.json));
    assert.ok(g.json.routine && g.json.routine.account === 'gemini' && g.json.routine.trigger.schedule.kind === 'daily', JSON.stringify(g.json));
    assert.ok(['accept-edits', 'plan', 'full'].includes(g.json.routine.permissionMode), 'with one of Gemini’s own modes');
    assert.equal((await s.call('/api/routines/remove', { id: g.json.routine.id })).status, 200);
    assert.equal((await s.call('/api/gemini/settings', { enabled: false })).status, 200);
    assert.equal((await s.call('/api/tasks', { action: 'remove', id })).status, 200);
    list = (await s.call('/api/tasks')).json.tasks;
    assert.equal(list.length, 0);
  } finally { await s.stop(); }
});

test('races: one can’t start without Codex, and nothing is left behind', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-home-'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-proj-'));
  const { execFileSync } = require('child_process');
  execFileSync('git', ['-C', proj, 'init', '-q']);
  fs.writeFileSync(path.join(proj, 'a.txt'), 'one\n');
  const s = await startServer(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-srv-')), { home });
  try {
    await s.call('/api/project/create', { existing: proj, useExisting: true });
    const r = await s.call('/api/race', { action: 'start', cwd: proj, prompt: 'Fix it', accountId: 'auto' });
    assert.equal(r.status, 409);
    assert.match(r.json.error, /Codex/);
    assert.equal(execFileSync('git', ['-C', proj, 'worktree', 'list']).toString().trim().split('\n').length, 1, 'no copies made');
    assert.deepEqual((await s.call('/api/races')).json.races, []);
    assert.equal((await s.call('/api/race', { action: 'keep', id: 'nope', who: 'claude' })).status, 404);
  } finally { await s.stop(); }
});

// (Not under the desktop app's own Node, as the nightly self-check runs: there the desktop app starts the
// new copy itself, so a copy on its own never restarts that way.)
test('restart: a new copy takes over (same port, new process, same build), the old one exits, and the old page is told to reload', { skip: process.versions.electron ? 'the desktop app restarts itself' : false }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-srv-'));
  const s = await startServer(dir);
  let next = null;
  try {
    const before = (await s.call('/api/version')).json;
    const st = (await s.call('/api/state')).json;
    assert.equal(st.restart.pending, false);
    assert.equal(typeof st.update, 'boolean');
    assert.equal((await s.call('/api/restart', { when: 'typo' })).status, 400, 'an invalid request does not stop the app');
    assert.equal((await s.call('/api/version')).json.pid, before.pid);
    // "When replies finish" with nothing working restarts at once.
    const r = await s.call('/api/restart', { when: 'idle' });
    assert.equal(r.json.restarting, true);
    for (let i = 0; i < 120 && !next; i++) {
      await new Promise(res => setTimeout(res, 250));
      try { const v = await (await fetch(`${s.base}/api/version`)).json(); if (v.pid !== before.pid) next = v; } catch { /* between copies */ }
    }
    assert.ok(next, 'a new copy answered on the same port');
    assert.equal(next.build, before.build);
    assert.ok(!fs.existsSync(path.join(dir, 'restart.json')), 'the restart note is used up');
    let oldAlive = true; try { process.kill(before.pid, 0); } catch { oldAlive = false; }
    assert.equal(oldAlive, false, 'the old copy has exited');
    // The page from before is out of date now (new token); a reload picks the new copy up.
    assert.equal((await s.call('/api/state')).status, 403);
  } finally {
    if (next) {
      const html = await (await fetch(`${s.base}/`)).text();
      const token = html.match(/TOKEN = '([a-f0-9]+)'/)[1];
      await fetch(`${s.base}/api/quit`, { method: 'POST', headers: { 'x-switcher-token': token, 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
      for (let i = 0; i < 40; i++) { try { process.kill(next.pid, 0); await new Promise(res => setTimeout(res, 100)); } catch { break; } }
    } else await s.stop();
  }
});

test('restart: a replacement initialization failure leaves the current app usable', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-srv-'));
  const preload = path.join(dir, 'fail-replacement.cjs');
  fs.writeFileSync(preload, `require(${JSON.stringify(path.join(APP, 'lib', 'restart.js'))}).startReplacement = async () => { throw new Error('Replacement failed to initialize (test)'); };`);
  const s = await startServer(dir, { preload });
  try {
    const before = (await s.call('/api/version')).json;
    const r = await s.call('/api/restart', { when: 'now' });
    assert.equal(r.status, 503);
    assert.match(r.json.error, /Replacement failed to initialize/);
    assert.equal((await s.call('/api/version')).json.pid, before.pid, 'the old process is still serving');
    assert.equal((await s.call('/api/state')).status, 200, 'the existing window token still works');
    assert.equal(fs.existsSync(path.join(dir, 'restart.json')), false, 'no stale restart marker');
    assert.equal((await s.call('/api/state')).json.restart.pending, false);
  } finally { await s.stop(); }
});

test('the themes’ paintings are served from art/ (WebP only), and nothing else there is', async () => {
  const s = await startServer(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-srv-')));
  try {
    const dir = path.join(__dirname, '..', 'art');
    const one = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).find(f => /^[a-z0-9-]+\.webp$/.test(f));
    if (one) {
      const ok = await fetch(`${s.base}/art/${one}`);
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get('content-type'), 'image/webp');
    }
    for (const bad of ['/art/none-such.webp', '/art/src/isekai-dark.png', '/art/../server.js', '/art/..%2fserver.js', '/art/x.png', '/art/spots.json']) {
      const r = await fetch(`${s.base}${bad}`);
      assert.notEqual(r.status, 200, `${bad} must not be served`);
    }
  } finally { await s.stop(); }
});

test('the font pack and its licence are served from fonts/, and nothing else there is', async () => {
  const s = await startServer(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-srv-')));
  try {
    const { FAMILIES } = require('../theme');
    for (const f of FAMILIES.flatMap(x => x.faces.map(fc => fc[0]))) {
      const r = await fetch(`${s.base}/fonts/${f}.woff2`);
      assert.equal(r.status, 200, `${f}.woff2`);
      assert.equal(r.headers.get('content-type'), 'font/woff2');
      assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 4).toString('latin1'), 'wOF2', `${f}.woff2 is a WOFF2 file`);
    }
    const ofl = await fetch(`${s.base}/fonts/OFL.txt`);
    assert.equal(ofl.status, 200);
    assert.match(ofl.headers.get('content-type'), /^text\/plain/);
    const text = await ofl.text();
    const notices = text.split('SIL OPEN FONT LICENSE')[0];
    // Each family is named on a notice line, alone ("Inter: Copyright …") or with its relatives ("Alegreya and Alegreya SC: …").
    const named = notices.split('\n').filter(l => /: Copyright/.test(l)).map(l => l.split(': Copyright')[0].split(/, | and /));
    for (const f of FAMILIES) assert.ok(named.some(n => n.includes(f.name)), `OFL.txt has ${f.name}'s notice`);
    for (const bad of ['/fonts/none-such.woff2', '/fonts/../server.js', '/fonts/..%2fserver.js', '/fonts/OFL.md', '/fonts/inter.ttf']) {
      const r = await fetch(`${s.base}${bad}`);
      assert.notEqual(r.status, 200, `${bad} must not be served`);
    }
  } finally { await s.stop(); }
});

test('page scripts are served from ui/, and nothing else is', async () => {
  const s = await startServer(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-srv-')));
  try {
    const ok = await fetch(`${s.base}/ui/chat.js`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type'), /javascript/);
    for (const bad of ['/ui/../server.js', '/ui/..%2fserver.js', '/ui/x.json', '/lib/chat.js', '/accounts.json']) {
      const r = await fetch(`${s.base}${bad}`);
      assert.notEqual(r.status, 200, `${bad} must not be served`);
    }
  } finally { await s.stop(); }
});

test('push: a paired phone signs up for notifications; Allow/Deny needs its one-time token; removing the phone stops them', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-srv-'));
  const s = await startServer(dataDir);
  try {
    const port = await freePort();
    assert.equal((await s.call('/api/phone', { enabled: true, port })).status, 200);
    const phone = `http://127.0.0.1:${port}`;
    // Before pairing: the worker and the manifest (nothing private), and nothing else.
    const sw = await fetch(`${phone}/sw.js`);
    assert.equal(sw.status, 200); assert.match(await sw.text(), /notificationclick/);
    assert.equal((await (await fetch(`${phone}/manifest.webmanifest`)).json()).display, 'standalone');
    assert.equal((await fetch(`${phone}/api/push`)).status, 401);
    // Pair, as the phone does.
    const { code } = (await s.call('/api/phone/pair', {})).json;
    const p = await fetch(`${phone}/pair?code=${code}&name=Test`, { redirect: 'manual' });
    const cookie = p.headers.get('set-cookie').split(';')[0];
    const html = await (await fetch(`${phone}/`, { headers: { cookie } })).text();
    const token = html.match(/TOKEN = '([a-f0-9]+)'/)[1];
    const call = async (q, body, { tok = true } = {}) => {
      const r = await fetch(phone + q, { method: body ? 'POST' : 'GET', headers: { cookie, ...(tok ? { 'x-switcher-token': token } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, json: await r.json().catch(() => null) };
    };
    const st = (await call('/api/push')).json;
    assert.equal(st.phone, true); assert.equal(st.subscribed, false); assert.match(st.key, /^B[\w-]{80,}$/);
    const ua = require('crypto').createECDH('prime256v1'); ua.generateKeys();
    const subscription = { endpoint: 'https://push.example.invalid/sub/1', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: require('crypto').randomBytes(16).toString('base64url') } };
    assert.equal((await call('/api/push/subscribe', { subscription, prefs: { levels: {}, tz: 'Europe/London' } })).status, 200);
    assert.equal((await call('/api/push')).json.subscribed, true);
    assert.equal((await s.call('/api/phone')).json.pushPhones, 1, 'the PC sees it');
    assert.equal((await s.call('/api/push/subscribe', { subscription })).status, 403, 'only a phone signs itself up');
    // The notification's buttons send no page token; a wrong or used one-time token is refused.
    assert.equal((await call('/api/push/act', { token: 'nope', decision: 'allow' }, { tok: false })).status, 410);
    assert.equal((await call('/api/push/reply', { token: 'nope', text: 'hi' }, { tok: false })).status, 410, 'a reply from a notification needs its one-time token');
    assert.equal((await call('/api/push/subscribe', { subscription }, { tok: false })).status, 403, 'everything else still needs the page’s token');
    // The Android app's connection: the phone's pairing lets it in (no page token), and it hears tests.
    assert.equal((await fetch(`${phone}/api/notify/stream`)).status, 401, 'not without pairing');
    const ac = new AbortController();
    const stream = await fetch(`${phone}/api/notify/stream?since=0`, { headers: { cookie }, signal: ac.signal });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get('content-type'), /text\/event-stream/);
    const reader = stream.body.getReader(), dec = new TextDecoder();
    let got = '';
    const until = async re => { const t0 = Date.now(); while (!re.test(got) && Date.now() - t0 < 5000) { const { value, done } = await reader.read(); if (done) break; got += dec.decode(value); } return re.test(got); };
    assert.ok(await until(/"kind":"hello"/), got);
    assert.equal((await call('/api/notify/prefs', { prefs: { levels: { abc: 'off' }, quiet: { on: true, from: '22:00', to: '07:00' }, tz: 'Europe/London' } })).status, 200);
    assert.deepEqual((await s.call('/api/phone')).json.appsListening.length, 1, 'the PC sees the app listening');
    assert.equal((await call('/api/notify/test', {})).json.ok, true);
    assert.ok(await until(/"kind":"test"/), got);
    ac.abort();
    // The app can tell when the PC has a newer version of it.
    const hello = await (await fetch(`${phone}/hello`)).json();
    assert.ok(hello.apk === null || Number.isInteger(hello.apk.code), JSON.stringify(hello));
    // Removing the phone stops its notifications.
    const id = (await s.call('/api/phone')).json.devices[0].id;
    assert.equal((await s.call('/api/phone/forget', { id })).json.pushPhones, 0);
    assert.equal((await call('/api/push')).status, 401);
    // Tailscale's status reads either way (installed or not).
    assert.equal((await s.call('/api/phone/tailscale')).status, 200);
    assert.equal((await call('/api/phone/tailscale')).status, 401);
  } finally { await s.stop(); }
});

test('drafts: what you were writing in a chat is kept for your other devices, the newest wins', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-srv-'));
  const s = await startServer(dataDir);
  try {
    const id = 'c6e577cb-c6e5-46e5-ae57-c6e577cbc6e5';
    assert.equal((await s.call('/api/draft', { id, text: 'Half a thought', at: 2000 })).status, 200);
    assert.deepEqual((await s.call(`/api/draft?id=${id}`)).json, { text: 'Half a thought', at: 2000 });
    await s.call('/api/draft', { id, text: 'An older one', at: 1000 });
    assert.equal((await s.call(`/api/draft?id=${id}`)).json.text, 'Half a thought', 'an older draft doesn’t replace a newer one');
    await s.call('/api/draft', { id, text: '', at: 3000 });
    assert.equal((await s.call(`/api/draft?id=${id}`)).json.text, '', 'sent (or emptied): gone');
    assert.equal((await s.call('/api/draft', { id: '../x', text: 'x' })).status, 400);
  } finally { await s.stop(); }
});

test('its own settings stay with it: what it starts doesn’t inherit its data folder or port', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-srv-'));
  // Every program the app starts is noted, with whether it was handed the app's own settings.
  const seen = path.join(dir, 'spawned.txt');
  const preload = path.join(dir, 'watch-spawn.cjs');
  fs.writeFileSync(preload, `const cp = require('child_process'), fs = require('fs');
for (const f of ['spawn', 'execFile', 'exec']) { const real = cp[f]; cp[f] = function (...a) { const o = a.find(x => x && typeof x === 'object' && !Array.isArray(x)) || {}; const env = o.env || process.env; fs.appendFileSync(${JSON.stringify(seen)}, Object.keys(env).filter(k => /^SWITCHER_/.test(k)).join(',') + '\\n'); return real.apply(this, a); }; }`);
  const s = await startServer(dir, { preload });
  try {
    await s.call('/api/health');   // runs claude --version, among others
    const lines = fs.existsSync(seen) ? fs.readFileSync(seen, 'utf8').split('\n').filter(l => l !== '') : [];
    assert.ok(fs.existsSync(seen), 'it started something');
    assert.deepEqual(lines, [], 'nothing it started was given SWITCHER_ settings');
  } finally { await s.stop(); }
});
