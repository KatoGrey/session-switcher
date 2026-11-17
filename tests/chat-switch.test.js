'use strict';
// Switching the account an open chat runs as (the account menu at the top right of a chat), on the real
// server in a pretend home (tests/fake-world.js): the chat stops, then the same conversation resumes as the
// other account. Claude among its accounts, Codex among its Codex accounts.
const test = require('node:test');
const assert = require('node:assert/strict');

const skip = process.platform !== 'win32' || !!process.versions.electron ? 'its launchers are Windows .cmd files, and it’s not for the installed app’s self-check' : false;

async function world() {
  const { build } = require('./fake-world');
  const w = await build();
  const token = (await (await fetch(w.base)).text()).match(/TOKEN = '([a-f0-9]+)'/)[1];
  const call = async (p, body) => { const r = await fetch(w.base + p.slice(1), { method: body ? 'POST' : 'GET', headers: { 'x-switcher-token': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const until = async (what, fn, ms = 30000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; assert.ok(Date.now() - t0 < ms, `timed out: ${what}\n${w.serverLog().slice(-2000)}`); await new Promise(r => setTimeout(r, 150)); } };
  const attach = async key => (await call('/api/chat/attach', { key })).json || {};
  return { w, call, until, attach };
}

test('switching accounts: a Claude chat carries on as your other Claude account, the same conversation', { skip }, async () => {
  const { w, call, until, attach } = await world();
  try {
    const accounts = (await call('/api/state')).json.accounts;
    const first = accounts.find(a => a.id !== 'two'), second = accounts.find(a => a.id === 'two');
    assert.ok(first && second, JSON.stringify(accounts.map(a => a.id)));
    const open = await call('/api/chat/open', { account: first.id, sessionId: w.ids.quest, mode: 'resume' });
    assert.equal(open.status, 200, JSON.stringify(open.json));
    assert.equal(open.json.accountId, first.id);
    await until('ready', async () => (await attach(open.json.key)).state === 'ready');
    // What the page does: stop it (switching), then resume the same conversation as the other one.
    assert.equal((await call('/api/chat/stop', { key: open.json.key, switching: true })).status, 200);
    const again = await call('/api/chat/open', { account: second.id, sessionId: w.ids.quest, mode: 'resume' });
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.equal(again.json.accountId, second.id, 'it runs as the other account now');
    assert.equal(String(again.json.sessionId || w.ids.quest).toLowerCase(), w.ids.quest.toLowerCase(), 'the same conversation');
    assert.notEqual(again.json.key, open.json.key);
    await until('ready again', async () => (await attach(again.json.key)).state === 'ready');
    assert.equal((await call('/api/chat/send', { key: again.json.key, text: 'Carry on from here.' })).status, 200);
    const history = await until('the message reaches the same transcript', async () => {
      const r = await call(`/api/chat/history?id=${encodeURIComponent(w.ids.quest)}`);
      return r.status === 200 && r.json.items && r.json.items.some(i => i.kind === 'user' && /Carry on from here/.test(i.text || '')) && r.json;
    });
    assert.ok(history.items.some(i => i.kind === 'user' && /Write the side-quest dialogue/.test(i.text || '')), 'with what came before');
  } finally { await w.done(); }
});

test('switching accounts: in a chat with a partner, only the main one switches; the partner keeps running', { skip }, async () => {
  const { w, call, until, attach } = await world();
  try {
    const accounts = (await call('/api/state')).json.accounts;
    const first = accounts.find(a => a.id !== 'two');
    const open = await call('/api/chat/open', { account: first.id, sessionId: w.ids.quest, mode: 'resume' });
    assert.equal(open.status, 200, JSON.stringify(open.json));
    await until('ready', async () => (await attach(open.json.key)).state === 'ready');
    const mate = await call('/api/chat/companion', { key: open.json.key, kind: 'codex' });
    assert.equal(mate.status, 200, JSON.stringify(mate.json));
    await until('the partner is ready, with its thread', async () => { const a = await attach(mate.json.key); return a.state === 'ready' && a.sessionId; });
    assert.equal((await call('/api/chat/stop', { key: open.json.key, switching: true })).status, 200);
    assert.notEqual((await attach(mate.json.key)).state, 'ended', 'switching doesn’t stop the partner');
    const again = await call('/api/chat/open', { account: 'two', sessionId: w.ids.quest, mode: 'resume' });
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.equal(again.json.accountId, 'two');
    assert.equal(again.json.crew && again.json.crew.running && again.json.crew.running.codex, mate.json.key, `the same partner is its partner again: ${JSON.stringify(again.json.crew)}`);
    // Stopping it (not switching) still stops the partner with it.
    assert.equal((await call('/api/chat/stop', { key: again.json.key })).status, 200);
    await until('the partner stopped too', async () => (await attach(mate.json.key)).state === 'ended');
  } finally { await w.done(); }
});

test('switching accounts: a Codex chat carries on as another Codex account, the same thread', { skip }, async () => {
  const { w, call, until, attach } = await world();
  try {
    const state = (await call('/api/state')).json;
    const claudeId = state.accounts[0].id;
    // A Codex chat with something in it, on the main Codex account.
    const opened = await call('/api/chat/open', { account: 'codex', cwd: w.tavern, mode: 'new', provider: 'codex' });
    assert.equal(opened.status, 200, JSON.stringify(opened.json));
    assert.equal(opened.json.accountId, 'codex');
    await until('ready', async () => (await attach(opened.json.key)).state === 'ready');
    assert.equal((await call('/api/chat/send', { key: opened.json.key, text: 'Hello from the first account.' })).status, 200);
    const thread = await until('its thread', async () => (await attach(opened.json.key)).sessionId);
    await until('answered', async () => (await attach(opened.json.key)).state === 'ready');
    // Another Codex account (its home shares the main one's chats).
    const added = await call('/api/codex/accounts', { name: 'Work', kind: 'chatgpt' });
    assert.equal(added.status, 200, JSON.stringify(added.json));
    const work = added.json.codex.accounts.find(x => x.name === 'Work');
    assert.ok(work, JSON.stringify(added.json.codex.accounts));
    // What the page does: stop it (switching), then resume the thread as the other Codex account.
    assert.equal((await call('/api/chat/stop', { key: opened.json.key, switching: true })).status, 200);
    const t0 = Date.now();
    const again = await call('/api/chat/open', { account: work.id, sessionId: thread, mode: 'resume', provider: 'codex' });
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.ok(Date.now() - t0 < 15000, 'it doesn’t wait long for the first account to let go');
    assert.equal(again.json.accountId, work.id, 'it runs as the other Codex account now');
    assert.equal(again.json.provider, 'codex');
    await until('ready again', async () => (await attach(again.json.key)).state === 'ready');
    assert.equal((await attach(again.json.key)).sessionId, thread, 'the same thread');
    // The page's own way in for an ordinary reopen (a Claude account id) still finds the thread's account.
    assert.equal((await call('/api/chat/stop', { key: again.json.key })).status, 200);
    const plain = await call('/api/chat/open', { account: claudeId, sessionId: thread, mode: 'resume', provider: 'codex' });
    assert.equal(plain.status, 200, JSON.stringify(plain.json));
    assert.equal(plain.json.accountId, work.id, 'reopened later, it carries on as the account it last ran as');
  } finally { await w.done(); }
});
