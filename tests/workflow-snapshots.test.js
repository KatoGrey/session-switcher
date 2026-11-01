'use strict';
// Real HTTP routes and real provider transport, with isolated fake accounts/processes. A project
// without Git must keep its text change record when the chat closes and reopens, then undo safely.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { build } = require('./fake-world');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  for (let i = 0; i < 150; i++) { const value = await check(); if (value) return value; await sleep(100); }
  assert.fail(message);
}
async function changesFrom(base, key, token) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(base + 'api/chat/events?' + new URLSearchParams({ key, token }), { signal: controller.signal });
    assert.equal(response.status, 200);
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let text = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      let end;
      while ((end = text.indexOf('\n\n')) >= 0) {
        const part = text.slice(0, end); text = text.slice(end + 2);
        if (!/^event: chat$/m.test(part)) continue;
        const data = part.split('\n').find(line => line.startsWith('data: '));
        if (!data) continue;
        const event = JSON.parse(data.slice(6));
        if (event.kind === 'changes') return event;
      }
    }
    assert.fail('The live stream ended before recording the change.');
  } finally { clearTimeout(timer); controller.abort(); }
}

test('workflow: text-only Undo survives closing and reopening a real-server Codex chat without creating Git', { skip: process.platform !== 'win32' ? 'Fake provider launchers currently use Windows .cmd files.' : process.versions.electron ? 'not for the installed app’s self-check' : false }, async t => {
  try { execFileSync('git', ['--version'], { windowsHide: true, stdio: 'ignore' }); }
  catch { t.skip('Git is required for the private snapshot object store.'); return; }
  const world = await build();
  try {
    const html = await (await fetch(world.base)).text(), token = html.match(/TOKEN = '([a-f0-9]+)'/)[1];
    const call = async (route, body) => {
      const response = await fetch(world.base + route, { method: 'POST', headers: { 'x-switcher-token': token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
    };
    const opened = await call('api/chat/open', { provider: 'codex', cwd: world.tavern, mode: 'new' });
    const ready = await until(async () => { const c = await call('api/chat/attach', { key: opened.key }); return c.state === 'ready' && c; }, 'Codex did not become ready.');
    // A cold scan can intentionally skip its first turn. Wait for this tiny fixture's background
    // warm-up, so this integration check exercises the supported ready path under parallel CI load.
    const stores = path.join(world.W, 'data', '.shadow-snapshots');
    await until(() => {
      try { return fs.readdirSync(stores, { withFileTypes: true }).some(d => {
        if (!d.isDirectory()) return false;
        try { return JSON.parse(fs.readFileSync(path.join(stores, d.name, 'index.json'), 'utf8')).history?.length > 0; } catch { return false; }
      }); } catch { return false; }
    }, 'The project text baseline did not warm up.');
    const readme = fs.readFileSync(path.join(world.tavern, 'README.md'), 'utf8');
    await call('api/chat/send', { key: opened.key, text: 'Please write a note' });
    const change = await changesFrom(world.base, opened.key, token);
    assert.equal(change.scope, 'text');
    assert.deepEqual(change.files.map(f => f.path), ['codex-note.txt']);
    assert.equal(fs.existsSync(path.join(world.tavern, '.git')), false);
    assert.equal(fs.readFileSync(path.join(world.tavern, 'codex-note.txt'), 'utf8'), 'written by the stand-in\n');
    await call('api/chat/stop', { key: opened.key });
    const reopened = await call('api/chat/open', { provider: 'codex', cwd: world.tavern, sessionId: ready.sessionId, mode: 'resume' });
    assert.notEqual(reopened.key, opened.key);
    await until(async () => (await call('api/chat/attach', { key: reopened.key })).state === 'ready', 'The reopened chat did not become ready.');
    const undo = await call('api/chat/undo', { key: reopened.key, turn: change.turn });
    assert.deepEqual(undo.restored, ['codex-note.txt']);
    assert.equal(fs.existsSync(path.join(world.tavern, 'codex-note.txt')), false);
    assert.equal(fs.readFileSync(path.join(world.tavern, 'README.md'), 'utf8'), readme);
    assert.equal(fs.existsSync(path.join(world.tavern, '.git')), false);
  } finally { await world.done(); }
});
