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

test('openclaw: rows say what the session is about (channel name, first prompt, cron name)', async () => {
  const { h, ws } = home();
  const dir = path.join(h, '.openclaw', 'agents', 'main', 'agent');
  fs.mkdirSync(dir, { recursive: true });
  const db = new sqlite.DatabaseSync(path.join(dir, 'openclaw-agent.sqlite'));
  db.exec('CREATE TABLE session_conversations (session_id TEXT, conversation_id TEXT)');
  db.exec('CREATE TABLE conversations (conversation_id TEXT, label TEXT)');
  db.exec('CREATE TABLE transcript_events (seq INTEGER PRIMARY KEY, session_id TEXT, event_json TEXT, event_zstd BLOB)');
  const add = db.prepare('INSERT INTO transcript_events (seq, session_id, event_json, event_zstd) VALUES (?, ?, ?, NULL)');
  // sess-1: a Discord channel conversation whose first user turn carries injected context.
  db.exec("INSERT INTO session_conversations VALUES ('sess-1','conv-1')");
  db.exec("INSERT INTO conversations VALUES ('conv-1','discord:1470130712576393432#celeste-dev')");
  add.run(1, 'sess-1', JSON.stringify({ message: { role: 'user', content: '<system>workspace context</system>Can you setup Felix and Evelyn as your subagents?' } }));
  add.run(3, 'sess-1', JSON.stringify({ message: { role: 'user', content: '<realtime_delegation>\n  <input>Okay, you have a lovely voice</input>\n  <transcript_delta>user: Okay</transcript_delta>\n</realtime_delegation>' } }));
  // sess-2: a cron run whose user event carries the cron's name and its task.
  add.run(2, 'sess-2', JSON.stringify({ message: { role: 'user', content: '[cron:59256e63-14d4-4620 Linear Backlog Cleanup] run the confidence pass' } }));
  db.close();
  const dataDir = tmp();
  const oc = createOpenClaw({ home: h, dataDir, run: async () => ({ code: 0, stdout: JSON.stringify({ sessions: SESSIONS }), stderr: '' }) });
  oc.sessions(0); await settle();
  const rows = oc.cached();
  const ch = rows.find(r => r.sessionId === 'sess-1');
  assert.equal(ch.title, 'Nova · #celeste-dev', 'a labeled conversation names the conversation');
  assert.ok(ch.firstPrompt.startsWith('Can you setup Felix'), 'the first prompt is the human part');
  const cr = rows.find(r => r.sessionId === 'sess-2');
  assert.ok(cr.title.startsWith('Nova · Linear Backlog Cleanup'), 'a cron session is named by the cron');
  assert.match(cr.firstPrompt, /run the confidence pass$/);
  const disc = await oc.history('agent:main:discord:channel:123');
  const texts = disc.items.filter(x => x.kind === 'user').map(x => x.text);
  assert.ok(texts.some(t => t === 'Okay, you have a lovely voice'), 'voice turns read as their spoken words');
  assert.ok(fs.existsSync(path.join(dataDir, 'openclaw-titles.json')), 'titles are kept between runs');
  // A later instance still describes sessions whose store has gone away.
  fs.rmSync(dir, { recursive: true, force: true });
  const oc2 = createOpenClaw({ home: h, dataDir, run: async () => ({ code: 0, stdout: JSON.stringify({ sessions: SESSIONS }), stderr: '' }) });
  oc2.sessions(0); await settle();
  const again = oc2.cached().find(r => r.sessionId === 'sess-2');
  assert.ok(again.title.startsWith('Nova · Linear Backlog Cleanup'), 'a session is described even after its store is gone');
});

test('openclaw: injected scaffolding never becomes a title or a transcript line', async () => {
  const { h, ws } = home();
  const dir = path.join(h, '.openclaw', 'agents', 'main', 'agent');
  fs.mkdirSync(dir, { recursive: true });
  const db = new sqlite.DatabaseSync(path.join(dir, 'openclaw-agent.sqlite'));
  db.exec('CREATE TABLE transcript_events (seq INTEGER PRIMARY KEY, session_id TEXT, event_json TEXT, event_zstd BLOB)');
  const add = db.prepare('INSERT INTO transcript_events (seq, session_id, event_json, event_zstd) VALUES (?, ?, ?, NULL)');
  add.run(1, 'sess-2', JSON.stringify({ message: { role: 'user', content: '<<openclaw-internal-context>> nothing to see' } }));
  add.run(2, 'sess-2', JSON.stringify({ message: { role: 'user', content: 'Disable automatic completion turns with tools.exec.notifyOnExit=false; check per-agent overrides.' } }));
  add.run(3, 'sess-2', JSON.stringify({ message: { role: 'user', content: 'This content was routed by OpenClaw from another session.' } }));
  add.run(4, 'sess-2', JSON.stringify({ message: { role: 'user', content: 'Please file the expense report.' } }));
  db.close();
  let archived = null;
  const oc = createOpenClaw({ home: h, run: async c => {
    if (c.startsWith('openclaw sessions archive')) {
      archived = c;
      return { code: 0, stdout: JSON.stringify([{ key: 'agent:main:cron:nightly', archived: true }]), stderr: '' };
    }
    return { code: 0, stdout: JSON.stringify({ sessions: SESSIONS }), stderr: '' };
  } });
  oc.sessions(0); await settle();
  const cr = oc.cached().find(r => r.sessionId === 'sess-2');
  assert.equal(cr.firstPrompt, 'Please file the expense report.', 'only real conversation becomes the title');
  const r = await oc.history('agent:main:cron:nightly');
  assert.deepEqual(r.items.map(x => x.text), ['Please file the expense report.']);
  // Archive goes through the CLI and reports per-key results.
  const done = await oc.archive(['agent:main:cron:nightly']);
  assert.ok(/--json .*agent:main:cron:nightly|agent:main:cron:nightly.*--json/.test(archived.replace(/'/g, '').replace(/"/g, '')) && archived.includes('agent:main:cron:nightly'), 'the key reaches the CLI, quoted for the platform');
  assert.deepEqual(done.results, [{ key: 'agent:main:cron:nightly', archived: true, error: null }]);
  const bad = await oc.archive([]);
  assert.equal(bad.ok, false);
});

test('openclaw: a follow-up turn is sent through the CLI and its reply comes back', async () => {
  const { h } = home();
  let sent = null, fileText = null;
  const oc = createOpenClaw({ home: h, dataDir: tmp(), run: async (c, opts) => {
    if (c.startsWith('openclaw sessions')) return { code: 0, stdout: JSON.stringify({ sessions: SESSIONS }), stderr: '' };
    sent = c;
    const f = /--message-file ('[^']+'|"[^"]+"|\S+)/.exec(c);
    if (f) fileText = fs.readFileSync(f[1].replace(/^'|'$/g, '').replace(/^"|"$/g, ''), 'utf8');
    return { code: 0, stdout: JSON.stringify({ result: { terminalReply: { disposition: 'visible', text: 'Done — archived nothing, answered everything.' } } }), stderr: '' };
  } });
  oc.sessions(0); await settle();
  const r = await oc.sendMessage('agent:main:cron:nightly', 'Where did the night run get to?');
  assert.equal(r.ok, true);
  assert.equal(r.reply, 'Done — archived nothing, answered everything.');
  assert.ok(sent.includes('--session-key agent:main:cron:nightly'), 'the session key reaches the CLI');
  assert.equal(fileText, 'Where did the night run get to?', 'the message travels through a file, not the shell');
  // Guards: unknown session, empty text.
  assert.equal((await oc.sendMessage('agent:ghost:direct:x', 'hi')).ok, false);
  assert.equal((await oc.sendMessage('agent:main:cron:nightly', '  ')).ok, false);
  // A CLI failure is an error, not a throw.
  const oc2 = createOpenClaw({ home: h, run: async c => (c.startsWith('openclaw sessions')
    ? { code: 0, stdout: JSON.stringify({ sessions: SESSIONS }), stderr: '' }
    : { code: 1, stdout: '', stderr: 'gateway went away' }) });
  oc2.sessions(0); await settle();
  const bad = await oc2.sendMessage('agent:main:cron:nightly', 'hello');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /gateway went away/);
});
