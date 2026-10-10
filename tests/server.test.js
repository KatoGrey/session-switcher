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
async function startServer(dataDir, { home = null } = {}) {
  const port = await freePort();
  const homeEnv = home ? { HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: '' } : {};
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: APP, stdio: 'ignore',
    env: { ...process.env, ...homeEnv, SWITCHER_PORT: String(port), SWITCHER_DATA_DIR: dataDir, SWITCHER_NO_BROWSER: '1', SWITCHER_DRY_RUN: '1' },
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
