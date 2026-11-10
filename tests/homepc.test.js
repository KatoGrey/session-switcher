'use strict';
// Your home PC and a laptop: pairing, copying everything down, copying again, sending work back
// (with a file changed on both), sign-ins left behind, the relay the window uses. Both "computers"
// are folders in a temp folder; nothing outside it is touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { DatabaseSync } = require('node:sqlite');
const { createRemote } = require('../lib/remote');
const mirrorLib = require('../lib/mirror');
const { createHomePc, applyIncoming } = require('../lib/homepc');

const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const put = (p, text, mtime) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); if (mtime) fs.utimesSync(p, mtime, mtime); };
const read = p => fs.readFileSync(p, 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function finish(hp) {
  for (let i = 0; i < 400; i++) { const j = hp.status().job; if (j && j.state !== 'running') return j; await sleep(50); }
  throw new Error('the copy never finished');
}

test('a laptop pairs with the PC, copies everything, copies again, and sends its work back', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-homepc-'));
  const pcHome = path.join(root, 'pc', 'alex'), lapHome = path.join(root, 'laptop', 'alex');
  const pcData = path.join(pcHome, 'AppData', 'Roaming', 'Session Switcher'), lapData = path.join(lapHome, 'AppData', 'Roaming', 'Session Switcher');
  const proj = path.join(pcHome, 'Desktop', 'Games', 'Starfall Tavern');
  const old = new Date('2026-10-01T10:00:00Z');
  // The PC: a project with a database in use, chats and sign-ins for each tool, the app's settings.
  put(path.join(proj, 'story.txt'), 'chapter one', old);
  put(path.join(proj, 'art', 'hero.bin'), Buffer.alloc(300000, 7), old);
  put(path.join(proj, 'Thumbs.db'), 'junk');
  const db = new DatabaseSync(path.join(proj, 'save.sqlite'));
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('kept')");   // left open: its rows are still in the WAL
  put(path.join(pcHome, '.claude', 'projects', '-starfall', 's1.jsonl'), '{"a":1}\n', old);
  put(path.join(pcHome, '.claude', '.credentials.json'), 'SECRET');
  put(path.join(pcHome, '.claude', 'sessions', '123.json'), '{}');
  put(path.join(pcHome, '.claude', 'settings.json'), '{"theme":"dark"}', old);
  put(path.join(pcHome, '.codex', 'auth.json'), 'SECRET');
  put(path.join(pcHome, '.codex', 'sessions', '2026', 'r.jsonl'), '{"x":1}\n', old);
  put(path.join(pcHome, '.codex', 'log', 'codex.log'), 'noise');
  put(path.join(pcHome, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'), 'SECRET');
  put(path.join(pcHome, '.gemini', 'antigravity-cli', 'conversations', 'c1.db'), 'not sqlite', old);
  put(path.join(pcData, 'accounts.json'), JSON.stringify({ prefs: { phone: { enabled: true, port: 4788 }, homePcShare: true } }), old);
  put(path.join(pcData, 'chat-names.json'), '{"s1":"The plan"}', old);
  put(path.join(pcData, 'open-chats.json'), '["s1"]', old);
  put(path.join(pcHome, '.claude.json'), JSON.stringify({ mcpServers: { notes: { command: 'notes-mcp' } }, projects: { [proj]: { hasTrustDialogAccepted: true } } }));

  const port = await freePort(), relayPort = await freePort();
  const getPlan = () => mirrorLib.plan({ projects: [proj, path.join(proj, 'art')], claudeDirs: [{ id: 'main', dir: path.join(pcHome, '.claude'), main: true }], codexHome: path.join(pcHome, '.codex'), geminiHome: path.join(pcHome, '.gemini'), dataDir: pcData, home: pcHome, tmpDir: null });
  const mirror = mirrorLib.createMirror({ getPlan, dataDir: pcData });
  // The PC's server, as server.js routes it: a paired device, with the header, reaches the copy routes.
  const remote = createRemote({ dataDir: pcData, appDir: pcData, version: 'test', getPrefs: () => ({ phone: { enabled: true, port } }),
    async handle(req, res) {
      const url = new URL(req.url, 'http://x'), q = url.searchParams;
      const send = (code, obj, extra = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...extra }); res.end(JSON.stringify(obj)); };
      try {
        if (url.pathname === '/echo') return send(200, { device: req.device.name }, { 'Set-Cookie': 'other=1' });
        if (!url.pathname.startsWith('/api/mirror/') || req.headers['x-switcher-mirror'] !== '1') return send(404, { error: 'no' });
        if (url.pathname === '/api/mirror/plan') return send(200, { ...getPlan(), claude: mirrorLib.claudeExtras(pcHome) });
        if (url.pathname === '/api/mirror/list') return await mirror.list(res, q.get('root'));
        if (url.pathname === '/api/mirror/file' && req.method === 'GET') return await mirror.get(req, res, q.get('root'), q.get('p'));
        if (url.pathname === '/api/mirror/file' && req.method === 'PUT') return send(200, await mirror.put(req, res, q.get('root'), q.get('p'), q.get('base'), q.get('mtime')));
        return send(404, { error: 'no' });
      } catch (err) { if (!res.headersSent) send(err.status || 500, { error: err.message }); else res.destroy(); }
      return undefined;
    } });
  await remote.sync();
  const hp = createHomePc({ dataDir: lapData, home: lapHome, proxyPort: relayPort });
  t.after(() => { hp.close(); remote.stop(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  // Until it's used, nothing of it is on this computer: no folder, no settings file, no relay listening.
  assert.ok(!fs.existsSync(path.join(lapData, 'home-pc')) && !fs.existsSync(path.join(lapData, 'home-pc.json')));
  assert.ok(!fs.existsSync(path.join(pcData, 'mirror-snap')), 'nor a snapshot folder on the PC before the first database is asked for');
  await assert.rejects(fetch(`http://127.0.0.1:${relayPort}/`), 'the relay starts with the pairing');
  assert.equal(hp.status().paired, false);

  // Pairing: a wrong code is refused with the PC's own words; the right one keeps a key here.
  await assert.rejects(hp.pair({ address: `127.0.0.1:${port}`, code: 'WRONGONE' }), /expired|isn’t right/);
  await hp.pair({ address: `127.0.0.1:${port}`, code: remote.startPairing().code });
  assert.equal(hp.status().paired, true);
  assert.equal((await hp.probe()).paired, true);

  // The relay: the PC answers as this laptop, and the PC's cookies don't reach the page.
  const viaRelay = await fetch(`http://127.0.0.1:${relayPort}/echo`);
  assert.equal(viaRelay.status, 200);
  assert.equal(viaRelay.headers.get('set-cookie'), null);
  assert.match((await viaRelay.json()).device, /./);
  assert.equal((await fetch(`http://127.0.0.1:${relayPort}/api/mirror/plan`, { headers: { 'X-Switcher-Mirror': '1' } })).status, 404, 'the copy routes aren’t reachable through the window’s relay');
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/mirror/plan`, { headers: { 'X-Switcher-Mirror': '1' } })).status, 401, 'nor without the pairing');

  // This laptop's user folder isn't the PC's (chats from the PC won't open here): it says so first, and
  // copies nothing until you say to go on. Said once, it isn't asked again.
  await hp.start('down', { all: true });
  let job = await finish(hp);
  assert.equal(job.state, 'blocked');
  assert.deepEqual(job.warn, { homes: { pc: pcHome, here: lapHome } });
  assert.ok(!fs.existsSync(path.join(lapHome, 'Desktop')) && !hp.status().lastDown, 'nothing is copied yet');
  assert.equal(hp.status().pcPlatform, process.platform, 'and it knows what kind of computer the PC is');

  // Everything comes down, at the same places under this laptop's home.
  await hp.start('down', { all: true, force: true });
  job = await finish(hp);
  assert.equal(job.state, 'done', JSON.stringify(job.errors));
  const lproj = path.join(lapHome, 'Desktop', 'Games', 'Starfall Tavern');
  assert.equal(read(path.join(lproj, 'story.txt')), 'chapter one');
  assert.equal(fs.statSync(path.join(lproj, 'story.txt')).mtimeMs, old.getTime(), 'the PC’s time is kept');
  assert.equal(fs.statSync(path.join(lproj, 'art', 'hero.bin')).size, 300000);
  assert.ok(!fs.existsSync(path.join(lproj, 'Thumbs.db')));
  const copy = new DatabaseSync(path.join(lproj, 'save.sqlite'), { readOnly: true });
  assert.equal(copy.prepare('SELECT v FROM t').get().v, 'kept', 'a database in use comes over whole');
  copy.close();
  assert.equal(read(path.join(lapHome, '.claude', 'projects', '-starfall', 's1.jsonl')), '{"a":1}\n');
  assert.ok(fs.existsSync(path.join(lapHome, '.codex', 'sessions', '2026', 'r.jsonl')));
  assert.ok(fs.existsSync(path.join(lapHome, '.gemini', 'antigravity-cli', 'conversations', 'c1.db')));
  for (const secret of [['.claude', '.credentials.json'], ['.codex', 'auth.json'], ['.gemini', 'antigravity-cli', 'antigravity-oauth-token']]) assert.ok(!fs.existsSync(path.join(lapHome, ...secret)), `${secret.join('/')} stays on the PC`);
  assert.ok(!fs.existsSync(path.join(lapHome, '.claude', 'sessions')) && !fs.existsSync(path.join(lapHome, '.codex', 'log')));
  // The app's settings wait for the next start; phone access, and being a home PC, stay the PC's; what's running isn't brought.
  const inc = path.join(lapData, 'home-pc', 'incoming');
  assert.equal(JSON.parse(read(path.join(inc, 'accounts.json'))).prefs.phone.enabled, false);
  assert.equal(JSON.parse(read(path.join(inc, 'accounts.json'))).prefs.homePcShare, false, 'the laptop doesn’t become a home PC by copying one');
  assert.ok(fs.existsSync(path.join(pcData, 'mirror-snap')), 'the database was read from a snapshot');
  assert.ok(fs.existsSync(path.join(inc, 'chat-names.json')) && !fs.existsSync(path.join(inc, 'open-chats.json')) && !fs.existsSync(path.join(inc, 'devices.json')));
  assert.equal(job.needsRestart, true);
  assert.deepEqual(JSON.parse(read(path.join(lapHome, '.claude.json'))).mcpServers, { notes: { command: 'notes-mcp' } });
  assert.equal(applyIncoming(lapData), 2);
  assert.ok(fs.existsSync(path.join(lapData, 'chat-names.json')) && !fs.existsSync(inc));

  // Again: nothing to fetch. Then what changed on the PC, and only that.
  await hp.start('down'); job = await finish(hp);
  assert.equal(job.done, 0, JSON.stringify(job));
  put(path.join(proj, 'story.txt'), 'chapter two', new Date('2026-10-02T10:00:00Z'));
  await hp.start('down'); job = await finish(hp);
  assert.equal(job.done, 1); assert.equal(read(path.join(lproj, 'story.txt')), 'chapter two');

  // Work on the laptop while the PC is off: a new file, a changed picture, a chat that went on, a setting.
  // The PC also changed the story meanwhile, and so did the laptop.
  put(path.join(lproj, 'notes.txt'), 'written on the plane');
  put(path.join(lproj, 'art', 'hero.bin'), Buffer.alloc(1000, 9));
  fs.appendFileSync(path.join(lapHome, '.claude', 'projects', '-starfall', 's1.jsonl'), '{"b":2}\n');
  put(path.join(lapHome, '.claude', 'settings.json'), '{"theme":"light"}');
  put(path.join(proj, 'story.txt'), 'chapter three (PC)', new Date('2026-10-03T10:00:00Z'));
  put(path.join(lproj, 'story.txt'), 'chapter three (laptop)');
  await hp.start('up'); job = await finish(hp);
  assert.equal(job.state, 'done', JSON.stringify(job.errors));
  assert.equal(read(path.join(proj, 'notes.txt')), 'written on the plane');
  assert.equal(fs.statSync(path.join(proj, 'art', 'hero.bin')).size, 1000);
  assert.equal(read(path.join(pcHome, '.claude', 'projects', '-starfall', 's1.jsonl')), '{"a":1}\n{"b":2}\n');
  assert.equal(read(path.join(pcHome, '.claude', 'settings.json')), '{"theme":"dark"}', 'settings never go back');
  assert.equal(read(path.join(proj, 'story.txt')), 'chapter three (PC)', 'the PC’s newer version stays');
  assert.equal(read(path.join(proj, 'story (laptop).txt')), 'chapter three (laptop)', 'and the laptop’s is kept beside it');
  assert.equal(job.conflicts, 1);
  // Sent once: again sends nothing.
  await hp.start('up'); job = await finish(hp);
  assert.equal(job.done, 0, JSON.stringify(job));
  // Back down: the laptop gets the PC's story, and keeps its own beside it.
  await hp.start('down'); job = await finish(hp);
  assert.equal(read(path.join(lproj, 'story.txt')), 'chapter three (PC)');
  assert.equal(read(path.join(lproj, 'story (laptop).txt')), 'chapter three (laptop)');
  assert.equal(read(path.join(lproj, 'notes.txt')), 'written on the plane');
});

test('the PC refuses paths outside its folders, sign-ins, and settings sent back', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-mirror-'));
  try {
    const p = path.join(root, 'proj');
    fs.mkdirSync(p);
    for (const bad of ['../x', '/etc/passwd', 'C:/x', 'a/../../x', 'a\\..\\x', '', 'a//b']) assert.equal(mirrorLib.resolveIn(p, bad), null, bad);
    assert.ok(mirrorLib.resolveIn(p, 'a/b.txt'));
    assert.equal(mirrorLib.skipped('claude', '.credentials.json'), true);
    assert.equal(mirrorLib.skipped('codex', 'auth.json'), true);
    assert.equal(mirrorLib.skipped('codex', 'state_5.sqlite-wal'), true);
    assert.equal(mirrorLib.skipped('app', 'devices.json'), true);
    assert.equal(mirrorLib.skipped('app', 'chat-names.json'), false);
    assert.equal(mirrorLib.skipped('project', 'secrets/.credentials.json'), false, 'a project is copied whole');
    assert.equal(mirrorLib.mayGoUp('claude', 'settings.json'), false);
    assert.equal(mirrorLib.mayGoUp('claude', 'projects/x/s.jsonl'), true);
    assert.equal(mirrorLib.mayGoUp('app', 'accounts.json'), false);
    // Projects: no home, no drive, no tool folder; one inside another comes with it.
    const home = path.join(root, 'home');
    fs.mkdirSync(path.join(home, 'Code', 'A', 'inner'), { recursive: true });
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    const pl = mirrorLib.plan({ projects: [home, path.join(home, 'Code', 'A'), path.join(home, 'Code', 'A', 'inner'), path.join(home, '.claude'), path.parse(root).root], claudeDirs: [{ id: 'main', dir: path.join(home, '.claude'), main: true }], dataDir: path.join(home, 'data'), home, tmpDir: null });
    assert.deepEqual(pl.roots.filter(r => r.kind === 'project').map(r => r.path), [path.join(home, 'Code', 'A')]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
