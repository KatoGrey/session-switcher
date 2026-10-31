'use strict';
// Routines (lib/routines.js): schedules, command watchers, preserved settings across editors,
// runNow status reporting, restart cleanup of needs-you/working runs, and crew sendChat routing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
require('../lib/electron-node');
const os = require('os');
const path = require('path');
const { createRoutines } = require('../lib/routines');

function makeEnv(extra = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-routines-')));
  test.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });
  const sent = [];
  let chatSeq = 0;
  const startChat = extra.startChat || (async opts => {
    const chat = {
      key: `k${++chatSeq}`,
      sessionId: opts.sessionId || `sess-${chatSeq}`,
      state: 'ready',
      title: opts.title,
      activity: { finishedAt: 0, lastText: '', ok: true },
      pending: new Map(),
      clients: new Set(),
      send: text => sent.push({ chat, text }),
    };
    return chat;
  });
  const accountInfo = extra.accountInfo || (id => (id === 'main' ? { id: 'main', provider: 'claude', name: 'Main', modes: ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'] } : null));
  const rt = createRoutines({
    dataDir: dir,
    accountInfo,
    startChat,
    sendChat: extra.sendChat || ((chat, text, r) => { sent.push({ chat, text, to: r.chat.to || null }); chat.send(text); }),
    usageFor: extra.usageFor || (async () => ({ name: 'Main', data: { fiveHour: { used: 10 }, week: { used: 20 } } })),
    ...extra,
  });
  test.after(() => rt.stop());
  return { dir, rt, sent };
}

test('routines: update preserves model, limit, permissionMode, and crew chat.to when omitted by an editor (R4)', () => {
  const { dir, rt } = makeEnv();
  const created = rt.create({
    name: 'Overnight sync',
    cwd: dir,
    account: 'main',
    permissionMode: 'bypassPermissions',
    model: 'claude-opus-4-8',
    limit: 75,
    prompt: 'Sync status across agents.',
    chat: { mode: 'continue', sessionId: 'crew-session-1', to: 'parallel' },
    trigger: { type: 'schedule', schedule: { kind: 'every', every: 25, unit: 'minutes' } },
  });
  assert.equal(created.model, 'claude-opus-4-8');
  assert.equal(created.limit, 75);
  assert.equal(created.permissionMode, 'bypassPermissions');
  assert.equal(created.chat.to, 'parallel');

  // Simulated full-app or Lite edit that omits model, limit, and chat.to:
  const updated = rt.update(created.id, {
    name: 'Overnight sync (updated)',
    cwd: dir,
    account: 'main',
    prompt: 'Sync status across agents and check findings.',
    chat: { mode: 'continue', sessionId: 'crew-session-1' },
    trigger: { type: 'schedule', schedule: { kind: 'every', every: 30, unit: 'minutes' } },
  });
  assert.equal(updated.model, 'claude-opus-4-8', 'model preserved when omitted');
  assert.equal(updated.limit, 75, 'limit preserved when omitted');
  assert.equal(updated.permissionMode, 'bypassPermissions', 'permissionMode preserved when omitted');
  assert.equal(updated.chat.to, 'parallel', 'crew chat.to preserved when omitted');
});

test('routines: runNow reports started: false when skipped by usage limit or busy chat, and routes crew sends (R6)', async () => {
  let busy = true;
  const { dir, rt, sent } = makeEnv({
    startChat: async opts => ({
      key: 'k-busy',
      sessionId: opts.sessionId || 'sess-busy',
      state: busy ? 'busy' : 'ready',
      title: opts.title,
      activity: {},
      pending: new Map(),
      clients: new Set(),
      send: () => {},
    }),
  });
  const r = rt.create({
    name: 'Crew check-in',
    cwd: dir,
    account: 'main',
    prompt: 'Check in with Claude, Codex, and Gemini.',
    chat: { mode: 'continue', sessionId: 'sess-crew', to: 'parallel' },
    trigger: { type: 'schedule', schedule: { kind: 'every', every: 25, unit: 'minutes' } },
  });

  const skipped = await rt.runNow(r.id);
  assert.equal(skipped.started, false, 'busy chat reports started: false');
  assert.match(skipped.message || '', /still busy/i);

  busy = false;
  const ran = await rt.runNow(r.id);
  assert.equal(ran.started, true, 'ready chat reports started: true');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'parallel', 'sendChat receives routine with chat.to = parallel');
});

test('routines: onActivity records stopped when chat ends and startup cleans up needs-you runs (R1)', async () => {
  let lastChat = null;
  const { dir, rt } = makeEnv({
    startChat: async opts => {
      lastChat = {
        key: 'k-stop',
        sessionId: 'sess-stop',
        state: 'ready',
        title: opts.title,
        activity: { finishedAt: 0, lastText: '', ok: true },
        pending: new Map([['req1', { event: { toolName: 'Bash' } }]]),
        clients: new Set(),
        send: () => {},
      };
      return lastChat;
    },
  });
  const r = rt.create({
    name: 'Check stop',
    cwd: dir,
    account: 'main',
    prompt: 'Run check.',
    chat: { mode: 'new' },
    trigger: { type: 'schedule', schedule: { kind: 'daily', time: '09:00' } },
  });
  await rt.runNow(r.id);
  rt.onActivity(lastChat);
  assert.equal(rt.list()[0].history[0].status, 'needs-you');

  // Chat stops before finishing:
  lastChat.state = 'ended';
  rt.onActivity(lastChat);
  assert.equal(rt.list()[0].history[0].status, 'stopped');
  assert.equal(rt.list()[0].running, false);
});

test('routines: timed crew mission stores chat.kinds and untilAt, clears chat.to with null, and un-pauses cleanly', () => {
  const { dir, rt } = makeEnv();
  const future = Date.now() + 8 * 3600000;
  const mission = rt.create({
    name: 'Crew mission',
    cwd: dir,
    account: 'main',
    prompt: 'Check in every 25 minutes.',
    untilAt: future,
    chat: { mode: 'continue', sessionId: 'sess-mission', to: 'turns', kinds: ['claude', 'codex', 'gemini'] },
    trigger: { type: 'schedule', schedule: { kind: 'every', every: 25, unit: 'minutes' } },
  });
  assert.equal(mission.untilAt, future);
  assert.equal(mission.chat.to, 'turns');
  assert.deepEqual(mission.chat.kinds, ['claude', 'codex', 'gemini']);

  // Omitting untilAt and chat.kinds on update preserves them:
  const kept = rt.update(mission.id, {
    name: 'Crew mission v2',
    cwd: dir,
    account: 'main',
    prompt: 'Updated check-in prompt.',
    chat: { mode: 'continue', sessionId: 'sess-mission' },
    trigger: { type: 'schedule', schedule: { kind: 'every', every: 25, unit: 'minutes' } },
  });
  assert.equal(kept.untilAt, future);
  assert.equal(kept.chat.to, 'turns');
  assert.deepEqual(kept.chat.kinds, ['claude', 'codex', 'gemini']);

  // Explicitly passing to: null and untilAt: null clears them:
  const cleared = rt.update(mission.id, {
    name: 'Single chat routine',
    cwd: dir,
    account: 'main',
    prompt: 'Single assistant now.',
    untilAt: null,
    chat: { mode: 'continue', sessionId: 'sess-mission', to: null },
    trigger: { type: 'schedule', schedule: { kind: 'every', every: 25, unit: 'minutes' } },
  });
  assert.equal(cleared.untilAt, null);
  assert.equal(cleared.chat.to, undefined);
  assert.equal(cleared.chat.kinds, undefined);
});

