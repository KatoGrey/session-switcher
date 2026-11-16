'use strict';
// Headless runs (lib/headless.js): which chats a script or another agent started, where a chat began (lib/sessions.js),
// and what you've said about one (lib/chatprefs.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isHeadless } = require('../lib/headless');
const { createSessionStore } = require('../lib/sessions');
const { createChatPrefs } = require('../lib/chatprefs');

const tmp = (t, prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const ACCT = { id: 'main', name: 'Main' };

test('headless: claude -p and the Agent SDK, never opened here or first met when opened, are headless; the app’s own chats aren’t', () => {
  const since = Date.now() - 864e5, now = Date.now();
  assert.equal(isHeadless({ entrypoint: 'sdk-cli', lastOpened: null, updated: now }, undefined, since), true, 'a script ran it since the history began, and nobody opened it here');
  assert.equal(isHeadless({ entrypoint: 'sdk-ts', updated: now }, undefined, since), true, 'the Agent SDK');
  assert.equal(isHeadless({ entrypoint: 'sdk-py', updated: now }, undefined, since), true);
  assert.equal(isHeadless({ entrypoint: 'sdk-cli', lastOpened: null, updated: since - 1000 }, undefined, since), false, 'older than the history: its record may be lost, so it stays one of yours');
  assert.equal(isHeadless({ entrypoint: 'sdk-cli', updated: now }), false, 'with no history at all, there’s no telling');
  assert.equal(isHeadless({ entrypoint: 'sdk-cli', lastOpened: { mode: 'app', born: 'outside' } }), true, 'opened here later: still a script’s run');
  assert.equal(isHeadless({ entrypoint: 'sdk-cli', lastOpened: { mode: 'app', born: 'app' } }), false, 'the app started it (it runs Claude Code the SDK way too)');
  assert.equal(isHeadless({ entrypoint: 'sdk-cli', lastOpened: { mode: 'app' } }), false, 'a record from before `born` stays one of yours');
  assert.equal(isHeadless({ entrypoint: 'cli', lastOpened: null }), false, 'a terminal chat');
  assert.equal(isHeadless({ entrypoint: 'claude-desktop' }), false, 'the desktop app');
  assert.equal(isHeadless({ entrypoint: null }), false, 'one that doesn’t say');
  assert.equal(isHeadless({ provider: 'codex', source: 'exec' }), true, 'codex exec');
  assert.equal(isHeadless({ provider: 'codex', source: 'appServer' }), false);
  assert.equal(isHeadless({ provider: 'codex', source: 'cli' }), false);
  assert.equal(isHeadless({ provider: 'gemini', entrypoint: 'sdk-cli' }), false);
  assert.equal(isHeadless({ provider: 'openclaw' }), false);
  assert.equal(isHeadless({ entrypoint: 'sdk-cli' }, false), false, 'what you said wins: back with your chats');
  assert.equal(isHeadless({ entrypoint: 'cli' }, true), true, 'and into Headless runs');
  assert.equal(isHeadless(null), false);
});

function world(t) {
  const dir = tmp(t, 'ss-headless-');
  const root = path.join(dir, 'projects'), dataDir = path.join(dir, 'data'), cwd = path.join(dir, 'work');
  fs.mkdirSync(path.join(root, 'work'), { recursive: true }); fs.mkdirSync(dataDir); fs.mkdirSync(cwd);
  const stamp = new Date().toISOString();
  const chat = (id, entries) => fs.writeFileSync(path.join(root, 'work', `${id}.jsonl`), entries.map(e => JSON.stringify({ cwd, timestamp: stamp, sessionId: id, ...e })).join('\n') + '\n');
  const user = (text, more = {}) => ({ type: 'user', message: { role: 'user', content: text }, ...more });
  const reply = text => ({ type: 'assistant', message: { id: `m-${text.length}`, role: 'assistant', content: [{ type: 'text', text }] } });
  const listed = store => { const out = {}; for (const p of store.scan().projects) for (const s of p.sessions) out[s.id] = s; return out; };
  return { root, dataDir, cwd, chat, user, reply, listed };
}

test('sessions: how a chat began comes from its first message; what opened it later doesn’t count', t => {
  const w = world(t);
  const a = 'aaaaaaaa-0000-4000-8000-000000000001', b = 'aaaaaaaa-0000-4000-8000-000000000002', c = 'aaaaaaaa-0000-4000-8000-000000000003';
  w.chat(a, [w.user('Review PR 41', { entrypoint: 'sdk-cli' }), w.reply('Two findings.')]);
  // From a Claude Code that didn't say, opened in the app later (whose records say sdk-cli).
  w.chat(b, [w.user('An old chat'), w.reply('Hello.'), w.user('More', { entrypoint: 'sdk-cli' }), w.reply('Sure.')]);
  w.chat(c, [w.user('Typed in a terminal', { entrypoint: 'cli' }), w.reply('Hi.'), w.user('Opened in the app', { entrypoint: 'sdk-cli' }), w.reply('Hi again.')]);
  const s = w.listed(createSessionStore({ root: w.root, dataDir: w.dataDir }));
  assert.equal(s[a].entrypoint, 'sdk-cli');
  assert.equal(s[b].entrypoint, null);
  assert.equal(s[c].entrypoint, 'cli');
  // (With a history that goes back far enough to speak for all three.)
  assert.deepEqual([a, b, c].map(id => isHeadless(s[id], undefined, 0)), [true, false, false]);
});

test('sessions: where a chat began is kept for good: started here, or first met when it was opened', t => {
  const w = world(t);
  const mine = 'bbbbbbbb-0000-4000-8000-000000000001', run = 'bbbbbbbb-0000-4000-8000-000000000002', old = 'bbbbbbbb-0000-4000-8000-000000000003';
  for (const id of [mine, run, old]) w.chat(id, [w.user(`Chat ${id.slice(-1)}`, { entrypoint: 'sdk-cli' }), w.reply('Done.')]);
  // A record from before `born` was kept.
  fs.writeFileSync(path.join(w.dataDir, 'history.json'), JSON.stringify({ [old]: { account: 'main', accountName: 'Main', at: Date.now() - 1000, mode: 'app' } }));
  const store = createSessionStore({ root: w.root, dataDir: w.dataDir });
  store.recordLaunch(mine, ACCT, 'app', 'app');          // a new chat, started here
  store.recordLaunch(run, ACCT, 'app');                  // a script's run, opened here
  store.recordLaunch(old, ACCT, 'app');
  let s = w.listed(store);
  assert.equal(s[mine].lastOpened.born, 'app');
  assert.equal(s[run].lastOpened.born, 'outside');
  assert.equal(s[old].lastOpened.born, undefined, 'an older record isn’t guessed at');
  assert.deepEqual([mine, run, old].map(id => isHeadless(s[id], undefined, store.historySince())), [false, true, false]);
  // Opened again (even as a "new conversation in the same chat" would say): where it began doesn't change.
  store.recordLaunch(mine, ACCT, 'app');
  store.recordLaunch(run, ACCT, 'fork', 'app');
  s = w.listed(createSessionStore({ root: w.root, dataDir: w.dataDir }));
  assert.equal(s[mine].lastOpened.born, 'app', 'kept across a restart');
  assert.equal(s[run].lastOpened.born, 'outside');
  assert.equal(s[run].lastOpened.mode, 'fork', 'who opened it last, and how, still changes');
});

test('sessions: a chat first met when opened, older than the history, isn’t taken for a script’s', t => {
  const w = world(t);
  const mine = 'cccccccc-0000-4000-8000-000000000001', old = 'cccccccc-0000-4000-8000-000000000002', run = 'cccccccc-0000-4000-8000-000000000003';
  for (const id of [mine, old, run]) w.chat(id, [w.user(`Chat ${id.slice(-1)}`, { entrypoint: 'sdk-cli' }), w.reply('Done.')]);
  // The old one was last used ten days ago; the history only goes back five (its record was lost).
  const tenDays = (Date.now() - 10 * 864e5) / 1000;
  fs.utimesSync(path.join(w.root, 'work', `${old}.jsonl`), tenDays, tenDays);
  fs.writeFileSync(path.join(w.dataDir, 'history.json'), JSON.stringify({ [mine]: { account: 'main', accountName: 'Main', at: Date.now() - 5 * 864e5, mode: 'app', born: 'app' } }));
  const store = createSessionStore({ root: w.root, dataDir: w.dataDir });
  let s = w.listed(store);
  const since = store.historySince();
  assert.ok(Math.abs(since - (Date.now() - 5 * 864e5)) < 60000, 'the history begins with its oldest record');
  assert.deepEqual([mine, old, run].map(id => isHeadless(s[id], undefined, since)), [false, false, true], 'the old one stays yours; the new run without a record is a script’s');
  store.recordLaunch(old, ACCT, 'app');
  store.recordLaunch(run, ACCT, 'app');
  s = w.listed(store);
  assert.equal(s[old].lastOpened.born, undefined, 'opened here, it isn’t locked in as a script’s');
  assert.equal(s[run].lastOpened.born, 'outside');
  assert.deepEqual([old, run].map(id => isHeadless(s[id], undefined, store.historySince())), [false, true]);
});

test('sessions: over the limit, chats that are gone go first, then ones that began elsewhere, and chats started here last', t => {
  const w = world(t);
  const id = n => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const at0 = Date.now() - 864e5;
  // 0: started here (oldest), with its conversation. 1: began elsewhere, still there. 2: started here, its conversation gone.
  for (const n of [0, 1]) w.chat(id(n), [w.user(`Chat ${n}`, { entrypoint: 'sdk-cli' }), w.reply('Done.')]);
  fs.writeFileSync(path.join(w.dataDir, 'history.json'), JSON.stringify({
    [id(0)]: { account: 'main', accountName: 'Main', at: at0, mode: 'app', born: 'app' },
    [id(1)]: { account: 'main', accountName: 'Main', at: at0 + 1000, mode: 'app', born: 'outside' },
    [id(2)]: { account: 'main', accountName: 'Main', at: at0 + 2000, mode: 'app', born: 'app' },
  }));
  const store = createSessionStore({ root: w.root, dataDir: w.dataDir, maxHistory: 3 });
  w.listed(store);
  const kept = () => Object.keys(JSON.parse(fs.readFileSync(path.join(w.dataDir, 'history.json'), 'utf8')));
  w.chat(id(3), [w.user('Chat 3', { entrypoint: 'sdk-cli' }), w.reply('Done.')]);
  store.invalidate(); w.listed(store);
  store.recordLaunch(id(3), ACCT, 'app', 'app');
  assert.deepEqual(kept().sort(), [id(0), id(1), id(3)], 'the one whose conversation is gone went first');
  w.chat(id(4), [w.user('Chat 4', { entrypoint: 'sdk-cli' }), w.reply('Done.')]);
  store.invalidate(); w.listed(store);
  store.recordLaunch(id(4), ACCT, 'app', 'app');
  assert.deepEqual(kept().sort(), [id(0), id(3), id(4)], 'then the one that began elsewhere, before the older chat started here');
});

test('chat prefs: into Headless runs, back with your chats, and back to how it began', t => {
  const dataDir = tmp(t, 'ss-headless-prefs-');
  const prefs = createChatPrefs({ dataDir });
  prefs.setHeadless('DDDDDDDD-0000-4000-8000-000000000001', true);
  prefs.setHeadless('dddddddd-0000-4000-8000-000000000002', false);
  prefs.setHeadless('dddddddd-0000-4000-8000-000000000003', true);
  prefs.setHeadless('dddddddd-0000-4000-8000-000000000003', null);
  const m = prefs.headlessMarks();
  assert.equal(m.get('dddddddd-0000-4000-8000-000000000001'), true, 'kept by its id in lower case');
  assert.equal(m.get('dddddddd-0000-4000-8000-000000000002'), false);
  assert.equal(m.has('dddddddd-0000-4000-8000-000000000003'), false);
  prefs.flush();
  const again = createChatPrefs({ dataDir }).headlessMarks();
  assert.equal(again.get('dddddddd-0000-4000-8000-000000000002'), false, 'kept across a restart');
  // An id that's a word JavaScript objects have is only a key: nothing else changes.
  prefs.setHeadless('__proto__', true); prefs.setDone('__proto__', true); prefs.setHeadless('constructor', true);
  assert.equal({}.headless, undefined); assert.equal({}.done, undefined);
  assert.equal(prefs.headlessMarks().get('__proto__'), true);
  assert.equal(prefs.headlessMarks().has('dddddddd-0000-4000-8000-000000000009'), false);
  assert.deepEqual(prefs.headlessSaid(['dddddddd-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000009']), { 'dddddddd-0000-4000-8000-000000000002': false, 'dddddddd-0000-4000-8000-000000000009': null });
});
