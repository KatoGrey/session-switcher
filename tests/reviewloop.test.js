'use strict';
// Review loop (lib/reviewloop.js): fix-and-recheck until clean, round limits, stop/interrupt handling,
// synchronous send completion, and round-accurate failure reporting.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReviewLoop } = require('../lib/reviewloop');

function makeChat(provider = 'claude') {
  const events = [];
  const clients = new Set();
  let turnWaiters = [];
  const chat = {
    key: `k-${provider}`,
    provider,
    state: 'ready',
    interruptedAt: 0,
    clients,
    events,
    emit(ev) {
      events.push(ev);
      const msg = `event: chat\ndata: ${JSON.stringify(ev)}\n\n`;
      for (const c of [...clients]) c.write(msg);
      if (ev.kind === 'result' || ev.kind === 'ended') {
        const ws = turnWaiters;
        turnWaiters = [];
        for (const w of ws) w(ev);
      }
    },
    turnDone() {
      return new Promise(resolve => turnWaiters.push(resolve));
    },
  };
  return chat;
}

test('reviewloop: fixes and rechecks across rounds until clean, including synchronous turn completion', async () => {
  const chat = makeChat('claude');
  const sent = [];
  let revSeq = 0;
  const loop = createReviewLoop({
    send: async (c, text) => {
      sent.push(text);
      // Synchronous result emitted inside send() before turnDone() would otherwise be called:
      c.emit({ kind: 'result', ok: true });
    },
    review: async () => {
      const n = ++revSeq;
      return {
        id: `rev-${n}`,
        done: Promise.resolve({
          state: 'done',
          findings: n === 1 ? [{ title: 'Still one bug' }] : [],
        }),
      };
    },
    fixText: (what, list) => `Fix ${what}: ${list.map(f => f.title).join(', ')}`,
  });

  const { ok, done } = loop.start(chat, {
    id: 'rev-0',
    what: 'the commit',
    findings: [{ title: 'Initial bug' }],
  });
  assert.equal(ok, true);
  await done;

  assert.equal(sent.length, 2);
  const loopEvents = chat.events.filter(e => e.kind === 'reviewloop');
  assert.deepEqual(
    loopEvents.map(e => [e.id, e.round, e.state, e.done || null]),
    [
      ['rev-0', 1, 'fixing', null],
      ['rev-1', 1, 'checking', null],
      ['rev-1', 2, 'fixing', null],
      ['rev-2', 2, 'checking', null],
      ['rev-2', 2, 'end', 'clean'],
    ]
  );
});

test('reviewloop: reports current round id on round-2 error and names the chat provider when busy', async () => {
  const chat = makeChat('gemini');
  chat.state = 'busy';
  const loop = createReviewLoop({
    send: async c => c.emit({ kind: 'result', ok: true }),
    review: async () => {
      throw new Error('Codex review server offline');
    },
    fixText: (_w, l) => String(l.length),
  });

  assert.throws(
    () => loop.start(chat, { id: 'rev-init', what: 'changes', findings: [{ title: 'Bug' }] }),
    /Gemini is busy/
  );

  chat.state = 'ready';
  let calls = 0;
  const loop2 = createReviewLoop({
    send: async c => c.emit({ kind: 'result', ok: true }),
    review: async () => {
      calls++;
      if (calls === 1) return { id: 'rev-round1', done: Promise.resolve({ state: 'done', findings: [{ title: 'Next bug' }] }) };
      throw new Error('Recheck failed in round 2');
    },
    fixText: (_w, l) => String(l.length),
  });

  await loop2.start(chat, { id: 'rev-start', what: 'changes', findings: [{ title: 'First bug' }] }).done;
  const end = chat.events.filter(e => e.kind === 'reviewloop').pop();
  assert.equal(end.id, 'rev-round1', 'uses current round review id rather than initial id');
  assert.equal(end.round, 2);
  assert.equal(end.done, 'failed');
  assert.match(end.error || '', /Recheck failed in round 2/);
});
