// OpenClaw agents' sessions: listed without OpenClaw installed or with it, and read from their store.
// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createOpenClaw, LIST_CMD } = require('../lib/openclaw');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ss-oc-'));
const settle = () => new Promise(r => setTimeout(r, 30));
let sqlite = null;
try { sqlite = require('node:sqlite'); } catch { /* older Node: the store checks are skipped */ }

// A home with OpenClaw's settings: one named agent with a workspace, one with none.
function home() {
  const h = tmp(), ws = path.join(h, 'work', 'nova');
  fs.mkdirSync(ws, { recursive: true });
  fs.mkdirSync(path.join(h, '.openclaw'), { recursive: true });
  fs.writeFileSync(path.join(h, '.openclaw', 'openclaw.json'), JSON.stringify({ agents: { list: [{ id: 'main', name: 'Nova', workspace: ws }, { id: 'ghost' }] } }));
  return { h, ws };
}
const SESSIONS = [
  { key: 'agent:main:discord:channel:123', sessionId: 'sess-1', updatedAt: 1760000000000, status: 'idle', displayName: '#general' },
  { key: 'agent:main:cron:nightly', sessionId: 'sess-2', ageMs: 90000, status: 'running' },
  { key: 'agent:ghost:direct:x', sessionId: 'sess-3', updatedAt: 1760000000000 },
];

test('openclaw: not installed, the list is empty and the command isn’t retried right away', async () => {
  let runs = 0, logged = 0;
  const oc = createOpenClaw({ home: tmp(), log: () => { logged++; }, run: async () => { runs++; return { code: 1, stdout: '', stderr: '\'openclaw\' is not recognized' }; }, found: async () => false });
  assert.deepEqual(oc.sessions(0), []);
  await settle();
  assert.deepEqual(oc.sessions(0), []);
  await settle();
  assert.equal(runs, 1, 'it waits a while before looking again');
  assert.equal(logged, 0, 'a missing OpenClaw isn’t an error');
});

test('openclaw: sessions become rows in their agent’s folder, named by the agent', async () => {
  const { h, ws } = home();
  let changes = 0, cmd = null;
  const oc = createOpenClaw({ home: h, run: async c => { cmd = c; return { code: 0, stdout: JSON.stringify({ sessions: SESSIONS }), stderr: '' }; } });
  oc.onSessionsChanged(() => { changes++; });
  oc.sessions(0); await settle();
  assert.equal(cmd, LIST_CMD);
  const rows = oc.cached();
  assert.equal(rows.length, 2, 'an agent without a folder is left out');
  const [a, b] = rows;
  assert.equal(a.provider, 'openclaw');
  assert.equal(a.title, 'Nova · #general');
  assert.equal(a.cwd, ws);
  assert.equal(a.updated, 1760000000000);
  assert.equal(b.title, 'Nova · Cron run');
  assert.ok(Math.abs(b.updated - (Date.now() - 90000)) < 5000, 'an age counts back from now');
  assert.equal(changes, 1);
  // Read again: the same list is the same, so the page isn't told twice.
  oc.sessions(0); await settle();
  assert.equal(changes, 1);
  assert.equal(oc.known('agent:main:cron:nightly').sessionId, 'sess-2');
});

test('openclaw: a failing command is logged once and the last list is kept', async () => {
  const { h } = home();
  const logs = [];
  let fail = false;
  const oc = createOpenClaw({ home: h, log: m => logs.push(m), run: async () => (fail ? { code: 2, stdout: '', stderr: 'gateway offline' } : { code: 0, stdout: JSON.stringify(SESSIONS), stderr: '' }) });
  oc.sessions(0); await settle();
  assert.equal(oc.cached().length, 2, 'a bare list works too');
  fail = true;
  oc.sessions(0); await settle();
  assert.equal(oc.cached().length, 2);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /gateway offline/);
});

test('openclaw: a transcript is read from the store, yours and the agent’s messages only', { skip: !sqlite && 'needs node:sqlite' }, async () => {
  const { h } = home();
  const dir = path.join(h, '.openclaw', 'agents', 'main', 'agent');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'openclaw-agent.sqlite');
  const db = new sqlite.DatabaseSync(file);
  db.exec('CREATE TABLE transcript_events (seq INTEGER PRIMARY KEY, session_id TEXT, event_json TEXT, event_zstd BLOB)');
  const add = db.prepare('INSERT INTO transcript_events (seq, session_id, event_json, event_zstd) VALUES (?, ?, ?, NULL)');
  add.run(1, 'sess-1', JSON.stringify({ timestamp: 1760000000000, message: { role: 'user', content: 'What broke the build?' } }));
  add.run(2, 'sess-1', JSON.stringify({ type: 'thinking' }));
  add.run(3, 'sess-1', JSON.stringify({ message: { role: 'user', content: [{ type: 'text', text: '<system>scaffolding</system>' }] } }));
  add.run(4, 'sess-1', JSON.stringify({ timestamp: '2025-10-09T10:00:00Z', message: { role: 'assistant', content: [{ type: 'text', text: 'A missing semicolon.' }, { type: 'tool_use', name: 'x' }] } }));
  add.run(5, 'sess-2', JSON.stringify({ message: { role: 'user', content: 'another session' } }));
  db.close();
  const before = fs.readFileSync(file);
  const oc = createOpenClaw({ home: h, run: async () => ({ code: 0, stdout: JSON.stringify({ sessions: SESSIONS }), stderr: '' }) });
  oc.sessions(0); await settle();
  const r = oc.history('agent:main:discord:channel:123');
  assert.equal(r.error, undefined);
  assert.deepEqual(r.items.map(x => x.kind), ['user', 'assistant']);
  assert.equal(r.items[0].text, 'What broke the build?');
  assert.equal(r.items[0].at, new Date(1760000000000).toISOString());
  assert.deepEqual(r.items[1].blocks, [{ type: 'text', text: 'A missing semicolon.' }]);
  assert.ok(fs.readFileSync(file).equals(before), 'the store is never written');
  assert.equal(oc.history('agent:main:nope').error, 'unknown-session');
});

test('openclaw: an agent id can’t point outside OpenClaw’s folder', async () => {
  const { h, ws } = home();
  const cfg = path.join(h, '.openclaw', 'openclaw.json');
  fs.writeFileSync(cfg, JSON.stringify({ agents: { defaults: { workspace: ws } } }));
  const oc = createOpenClaw({ home: h, run: async () => ({ code: 0, stdout: JSON.stringify([{ key: 'agent:..:direct:x', sessionId: 's' }]), stderr: '' }) });
  oc.sessions(0); await settle();
  assert.equal(oc.cached().length, 1);
  assert.equal(oc.history('agent:..:direct:x').error, 'unknown-session');
});
