'use strict';
// "Keep it working until…" (lib/keepworking.js): a quiet chat is told to carry on, and only then.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createKeepWorking, ownId } = require('../lib/keepworking');
const { idleStop } = require('../lib/chat');

const MIN = 60e3;
let keys = 0;
function fakeChat(provider = 'claude', id = 'conv-1') {
  const c = { key: `k${++keys}`, provider, sessionId: id, state: 'ready', pending: new Map(), buffer: [], seq: 0, account: { id: 'a1' }, holdUntil: 0,
    emit(ev) { ev.seq = ++c.seq; c.buffer.push(ev); } };
  return c;
}
// A little world: one chat, a clock, and what it was sent.
function world({ dataDir = null, chat = fakeChat(), partners = [], openImpl = null, moveAccount = null } = {}) {
  const w = { t: 1e12, chat, partners, sent: [], opened: 0, live: chat };
  w.keep = createKeepWorking({
    dataDir, now: () => w.t,
    live: id => (w.live && String(w.live.sessionId).toLowerCase() === String(id).toLowerCase() && w.live.state !== 'ended' ? w.live : null),
    crewOf: () => w.partners,
    open: async id => { w.opened++; if (openImpl) return openImpl(id); w.live = w.chat = fakeChat(w.chat.provider, id); return w.live; },
    sendOne: async (lead, kind, text) => { w.sent.push({ to: [kind], text }); const c = [lead, ...w.partners].find(x => x.provider === kind) || lead; c.emit({ kind: 'user', text }); return c; },
    sendAll: async (lead, kinds, text) => { w.sent.push({ to: kinds, text }); const reached = [lead, ...w.partners].filter(c => kinds.includes(c.provider) && c.state !== 'ended'); for (const c of reached) c.emit({ kind: 'user', text }); return reached; },
    moveAccount: moveAccount ? lead => moveAccount(w, lead) : null,
  });
  w.go = async mins => { w.t += mins * MIN; await w.keep.tick(); };
  w.on = (opts = {}) => w.keep.start({ id: w.chat.sessionId, until: w.t + 480 * MIN, quietMinutes: 5, ...opts });
  w.reply = (chat = w.chat, { tools = 1, text = 'ok', ok = true } = {}) => {
    chat.emit({ kind: 'assistant', blocks: [{ type: 'text', text }, ...Array.from({ length: tools }, () => ({ type: 'tool', name: 'Edit' }))] });
    chat.emit({ kind: 'result', ok });
  };
  return w;
}

test('keep working: a quiet chat is told to carry on, once it’s been quiet long enough', async () => {
  const w = world();
  w.on({ note: 'Start with the lore.' });
  await w.go(0);
  assert.equal(w.sent.length, 0, 'not at once');
  await w.go(4);
  assert.equal(w.sent.length, 0, 'not before its time');
  await w.go(1.1);
  assert.equal(w.sent.length, 1);
  assert.match(w.sent[0].text, /^From Session Switcher: keep working until/);
  assert.match(w.sent[0].text, /Start with the lore\./);
  assert.match(w.sent[0].text, /ALL DONE$/);
  assert.equal(w.keep.view('conv-1').nudges, 1);
});

test('keep working: not while it’s working, or while it’s waiting on you', async () => {
  const w = world();
  w.on();
  await w.go(0);
  w.chat.state = 'busy';
  await w.go(30);
  assert.equal(w.sent.length, 0, 'it’s working');
  assert.equal(w.keep.view('conv-1').state, 'working');
  w.chat.state = 'ready';
  w.chat.pending.set('r1', {});
  await w.go(30);
  assert.equal(w.sent.length, 0, 'it’s waiting on a permission');
  assert.equal(w.keep.view('conv-1').state, 'asking');
  w.chat.pending.clear();
  await w.go(1);
  assert.equal(w.sent.length, 0, 'the wait starts again');
  await w.go(5);
  assert.equal(w.sent.length, 1);
});

test('keep working: work going on in the background counts as working', async () => {
  const w = world();
  w.on();
  await w.go(0);
  w.chat.background = [{ id: 'b1' }];
  await w.go(30);
  assert.equal(w.sent.length, 0);
  w.chat.background = [];
  await w.go(1); await w.go(5.1);
  assert.equal(w.sent.length, 1);
});

test('keep working: gone silent mid-reply for a long time, it’s stopped and told to carry on', async () => {
  const w = world();
  w.on({ until: w.t + 6000 * MIN });
  let stops = 0;
  w.chat.interrupt = async () => { stops++; w.chat.state = 'ready'; w.chat.emit({ kind: 'result', ok: false, interrupted: true, cancelled: true }); };
  await w.go(0);
  w.chat.state = 'busy'; w.chat.lastAt = w.t;
  await w.go(30);
  assert.equal(stops, 0, 'half an hour could be a long command');
  await w.go(11);
  await new Promise(r => setImmediate(r));
  assert.equal(stops, 1);
  assert.equal(w.keep.has('conv-1'), true, 'that isn’t the same as you pressing Stop');
  assert.ok(w.chat.buffer.some(e => /it’s said nothing for 40 minutes/.test(e.text || '')));
  await w.go(1); await w.go(5.1);
  assert.equal(w.sent.length, 1, 'and it’s told to carry on');
  // Not for ever.
  for (let i = 0; i < 6; i++) { w.chat.state = 'busy'; w.chat.lastAt = w.t; await w.go(41); await new Promise(r => setImmediate(r)); w.chat.state = 'busy'; }
  assert.equal(stops, 3, 'three times at most');
});

test('keep working: a long command that says it’s still going, or a question for you, isn’t hung', async () => {
  const w = world();
  w.on({ until: w.t + 6000 * MIN });
  let stops = 0;
  w.chat.interrupt = async () => { stops++; };
  await w.go(0);
  w.chat.state = 'busy';
  for (let i = 0; i < 5; i++) { w.chat.lastAt = w.t; await w.go(30); }
  assert.equal(stops, 0);
  w.chat.pending.set('r1', {});
  w.chat.lastAt = w.t - 300 * MIN;
  await w.go(30);
  assert.equal(stops, 0);
});

test('keep working: the wait starts over each time it finishes', async () => {
  const w = world();
  w.on();
  await w.go(0); await w.go(5.1);
  assert.equal(w.sent.length, 1);
  w.chat.state = 'busy';
  await w.go(20);
  w.reply(); w.chat.state = 'ready';
  await w.go(1);
  assert.equal(w.sent.length, 1);
  await w.go(5.1);
  assert.equal(w.sent.length, 2);
});

test('keep working: a check-in that hasn’t been answered yet isn’t judged', async () => {
  const w = world();
  w.on();
  await w.go(0); await w.go(5.1);
  // It's gone in, but the chat hasn't got going: this isn't "nothing done", and no second one goes.
  await w.go(0.5); await w.go(0.5);
  assert.equal(w.sent.length, 1);
  assert.equal(w.keep.view('conv-1').nudges, 1);
  assert.equal(w.keep.view('conv-1').state, 'working');
  w.reply(w.chat, { tools: 2 });
  await w.go(1); await w.go(5.1);
  assert.equal(w.sent.length, 2);
});

test('keep working: pictures made count as work done', async () => {
  const w = world();
  w.on();
  const pic = () => { w.chat.emit({ kind: 'assistant', blocks: [{ type: 'image', id: 'i1' }] }); w.chat.emit({ kind: 'result', ok: true }); };
  for (let i = 0; i < 4; i++) { await w.go(0); await w.go(5.1); pic(); await w.go(0.5); }
  assert.equal(w.keep.has('conv-1'), true);
  assert.equal(w.sent.length, 4);
});

test('keep working: stops at the time you set', async () => {
  const w = world();
  w.on({ until: w.t + 12 * MIN });
  await w.go(0); await w.go(5.1);
  assert.equal(w.sent.length, 1);
  await w.go(10);
  assert.equal(w.keep.has('conv-1'), false);
  assert.equal(w.sent.length, 1);
  assert.match(w.chat.buffer.at(-1).text, /that’s the time you set\. It sent 1 check-in\./);
  assert.equal(w.chat.keepWorkingUntil, 0, 'nothing of ours holds it open now');
});

test('keep working: stops when it says it’s finished, but only in answer to a check-in', async () => {
  const w = world();
  w.on();
  await w.go(0);
  w.reply(w.chat, { text: 'ALL DONE', tools: 0 });   // before any check-in: it means something else
  await w.go(5.1);
  assert.equal(w.sent.length, 1);
  w.reply(w.chat, { text: 'Nothing left to do.\n\n**ALL DONE**', tools: 0 });
  await w.go(1);
  assert.equal(w.keep.has('conv-1'), false);
  assert.match(w.chat.buffer.at(-1).text, /they say everything’s finished/);
});

test('keep working: words merely mentioning it don’t count', async () => {
  const w = world();
  w.on();
  await w.go(0); await w.go(5.1);
  w.reply(w.chat, { text: 'I will reply ALL DONE when I am through.', tools: 1 });
  await w.go(1);
  assert.equal(w.keep.has('conv-1'), true);
});

test('keep working: two check-ins running with nothing done, and it stops', async () => {
  const w = world();
  w.on();
  await w.go(0); await w.go(5.1);
  w.reply(w.chat, { tools: 0, text: 'Still nothing.' });
  await w.go(1); await w.go(5.1);
  assert.equal(w.sent.length, 2);
  w.reply(w.chat, { tools: 0, text: 'Still nothing.' });
  await w.go(1);
  assert.equal(w.keep.has('conv-1'), false);
  assert.match(w.chat.buffer.at(-1).text, /nothing more got done/);
});

test('keep working: a check-in that got something done clears the count', async () => {
  const w = world();
  w.on();
  await w.go(0); await w.go(5.1);
  w.reply(w.chat, { tools: 0 });
  await w.go(1); await w.go(5.1);
  w.reply(w.chat, { tools: 3 });
  await w.go(1); await w.go(5.1);
  w.reply(w.chat, { tools: 0 });
  await w.go(1);
  assert.equal(w.keep.has('conv-1'), true);
  assert.equal(w.sent.length, 3);
});

test('keep working: you writing to it means there’s more to do', async () => {
  const w = world();
  w.on();
  await w.go(0); await w.go(5.1);
  w.reply(w.chat, { tools: 0 });
  await w.go(1);
  w.chat.emit({ kind: 'user', text: 'One more thing: do the map.' });
  w.reply(w.chat, { tools: 0 });
  await w.go(1); await w.go(5.1);
  w.reply(w.chat, { tools: 0 });
  await w.go(1);
  assert.equal(w.keep.has('conv-1'), true, 'the count started over');
});

test('keep working: out of usage, it waits for the reset, and then carries on', async () => {
  const w = world();
  w.on();
  await w.go(0); await w.go(5.1);
  const back = w.t + 120 * MIN;
  w.chat.emit({ kind: 'limit', which: 'five_hour', resetsAt: new Date(back).toISOString() });
  w.chat.emit({ kind: 'result', ok: false, subtype: 'error' });
  await w.go(1);
  assert.equal(w.keep.view('conv-1').state, 'out');
  assert.equal(w.keep.view('conv-1').backAt, back + MIN);
  await w.go(60);
  assert.equal(w.sent.length, 1, 'it waits');
  await w.go(60.5);
  assert.equal(w.sent.length, 2, 'back, and on with it');
});

test('keep working: carrying on as another account counts as back', async () => {
  const w = world();
  w.on();
  await w.go(0); await w.go(5.1);
  w.chat.emit({ kind: 'limit', which: 'five_hour', resetsAt: new Date(w.t + 300 * MIN).toISOString() });
  w.chat.emit({ kind: 'result', ok: false });
  await w.go(1);
  assert.equal(w.keep.view('conv-1').state, 'out');
  w.chat.account = { id: 'a2' };
  await w.go(5.1);
  assert.equal(w.sent.length, 2);
});

test('keep working: out of usage, it moves to your account with room', async () => {
  const moved = [];
  const w = world({ moveAccount: (x, lead) => { moved.push(lead.key); x.chat.state = 'ended'; x.live = x.chat = fakeChat('claude', 'conv-1'); x.chat.account = { id: 'a2' }; return 'Second'; } });
  w.on();
  await w.go(0); await w.go(5.1);
  const first = w.chat;
  first.emit({ kind: 'limit', resetsAt: new Date(w.t + 300 * MIN).toISOString() });
  first.emit({ kind: 'result', ok: false });
  await w.go(0.3);
  assert.equal(moved.length, 1, 'once it’s finished its turn');
  assert.ok(w.chat.buffer.some(e => /it carries on as Second/.test(e.text || '')));
  await w.go(0.3);
  assert.equal(w.sent.length, 2, 'and it’s told at once, there');
  assert.equal(w.chat.buffer.at(-1).kind, 'user');
  assert.notEqual(w.keep.view('conv-1').state, 'out');
});

test('keep working: nowhere to move to, and it waits', async () => {
  const asked = [];
  const w = world({ moveAccount: (x, lead) => { asked.push(lead.key); return null; } });
  w.on();
  await w.go(0); await w.go(5.1);
  w.chat.emit({ kind: 'limit', resetsAt: new Date(w.t + 120 * MIN).toISOString() });
  w.chat.emit({ kind: 'result', ok: false });
  await w.go(1); await w.go(1);
  assert.ok(asked.length >= 1);
  assert.equal(w.keep.view('conv-1').state, 'out');
  assert.equal(w.sent.length, 1);
});

test('keep working: a partner out of usage doesn’t move the chat', async () => {
  const codex = fakeChat('codex', 'conv-c');
  const asked = [];
  const w = world({ partners: [codex], moveAccount: (x, lead) => { asked.push(lead.key); return null; } });
  w.on();
  await w.go(0); await w.go(5.1);
  codex.emit({ kind: 'limit', resetsAt: new Date(w.t + 120 * MIN).toISOString() });
  codex.emit({ kind: 'result', ok: false });
  w.reply(w.chat);
  await w.go(1);
  assert.equal(asked.length, 0);
});

test('keep working: one of a crew that can’t be reached isn’t waited for, and sits out a while', async () => {
  const codex = fakeChat('codex', 'conv-c'), gemini = fakeChat('gemini', 'conv-g');
  const w = world({ partners: [codex, gemini] });
  w.on();
  // Gemini stops, and won't start again: the send reaches the other two.
  gemini.state = 'ended';
  const at = [];
  for (let i = 0; i < 3; i++) {
    await w.go(0); await w.go(5.1);
    at.push(w.sent.at(-1).to.join());
    assert.equal(w.keep.view('conv-1').error, 'Gemini couldn’t be reached');
    w.reply(w.chat); w.reply(codex);
    await w.go(0.3);
    assert.equal(w.keep.view('conv-1').state, 'waiting', 'not waiting two minutes for a reply that can’t come');
  }
  assert.deepEqual(at, ['claude,codex,gemini', 'claude,codex,gemini', 'claude,codex,gemini']);
  await w.go(5.1);
  assert.deepEqual(w.sent.at(-1).to, ['claude', 'codex'], 'it’s left out for now');
  assert.equal(w.keep.view('conv-1').error, null);
});

test('keep working: only those working in it, not everyone it ever had in', async () => {
  const w = world();   // Codex was in this chat weeks ago, but isn't running
  w.on();
  await w.go(0); await w.go(5.1);
  assert.deepEqual(w.sent[0].to, ['claude']);
  // One who joins while it's on counts from then.
  const codex = fakeChat('codex', 'conv-c');
  w.partners = [codex];
  w.reply(w.chat);
  await w.go(1); await w.go(5.1);
  assert.deepEqual(w.sent[1].to, ['claude', 'codex']);
});

test('keep working: one of a crew that won’t start doesn’t stop the rest', async () => {
  let crew = [fakeChat('codex', 'conv-c')], t = 1e12, tries = 0;
  const chat = fakeChat();
  const keep = createKeepWorking({ now: () => t, live: () => chat, crewOf: () => crew, open: async () => chat, sendAll: async () => [chat], sendOne: async () => { tries++; throw Object.assign(new Error('It won’t start.'), { status: 500 }); } });
  keep.start({ id: 'conv-1', until: t + 6000 * MIN, quietMinutes: 5 });
  // Codex was in the crew when this started, then stopped, and won't start again. Claude's on a long job.
  crew = [];
  chat.state = 'busy'; chat.lastAt = t;
  const go = async m => { t += m * MIN; chat.lastAt = t; await keep.tick(); };
  await go(0);
  for (let i = 0; i < 3; i++) await go(5.1);
  assert.equal(tries, 3);
  assert.equal(keep.view('conv-1').error, 'Codex couldn’t be reached');
  await go(5.1); await go(5.1);
  assert.equal(tries, 3, 'it sits out a while');
  assert.equal(keep.has('conv-1'), true, 'and the rest carry on');
});

test('keep working: a copy isn’t its original until it has its own id', () => {
  assert.equal(ownId({ sessionId: 'a', startedAs: 'a' }), 'a');
  assert.equal(ownId({ fork: true, sessionId: 'a', startedAs: 'a' }), null);
  assert.equal(ownId({ fork: true, sessionId: 'b', startedAs: 'a' }), 'b');
  assert.equal(ownId({ sessionId: null }), null);
});

test('keep working: follows a chat whose id changes as it starts', async () => {
  const w = world();
  w.on();
  await w.go(0);
  // The app finds it by what it started as, and the run goes with its new id.
  const chat = w.chat;
  const real = w.keep;
  chat.sessionId = 'conv-2';
  w.live = { ...chat };
  const moved = createKeepWorking({ now: () => w.t, live: () => chat, crewOf: () => [], open: async () => chat, sendOne: async (l, k, text) => { w.sent.push({ text }); return chat; }, sendAll: async () => [] });
  void real;
  moved.start({ id: 'conv-1', until: w.t + 60 * MIN, quietMinutes: 5 });
  await moved.tick();
  assert.equal(moved.has('conv-2'), true);
  assert.equal(moved.has('conv-1'), false);
  w.t += 5.1 * MIN;
  await moved.tick();
  assert.equal(w.sent.length, 1);
});

test('keep working: in a crew, one on a long job doesn’t hold up the others', async () => {
  const codex = fakeChat('codex', 'conv-c'), gemini = fakeChat('gemini', 'conv-g');
  const w = world({ partners: [codex, gemini] });
  w.on();
  await w.go(0);
  codex.state = 'busy';
  await w.go(5.1);
  assert.deepEqual(w.sent.at(-1).to, ['claude', 'gemini'], 'the two that are quiet, at once');
  w.reply(w.chat); w.reply(gemini);
  await w.go(0.3);
  assert.equal(w.sent.length, 1);
  codex.state = 'ready';
  await w.go(1);
  assert.equal(w.sent.length, 1, 'Codex has only just finished');
  await w.go(4.2);
  assert.deepEqual(w.sent.at(-1).to, ['claude', 'gemini'], 'the others’ five minutes came first');
  w.reply(w.chat); w.reply(gemini);
  await w.go(0.9);
  assert.deepEqual(w.sent.at(-1).to, ['codex'], 'and then Codex’s, by itself');
});

test('keep working: in a crew, the one that’s asking you just waits', async () => {
  const codex = fakeChat('codex', 'conv-c');
  const w = world({ partners: [codex] });
  w.on();
  await w.go(0);
  codex.pending.set('r1', {});
  await w.go(5.1);
  assert.deepEqual(w.sent.at(-1).to, ['claude']);
  assert.equal(w.keep.view('conv-1').state, 'asking');
});

test('keep working: taking turns, it’s a round: when they’ve all finished, and everyone in it', async () => {
  const codex = fakeChat('codex', 'conv-c');
  const w = world({ partners: [codex] });
  w.on({ how: 'turns' });
  await w.go(0);
  codex.state = 'busy';
  await w.go(30);
  assert.equal(w.sent.length, 0, 'someone’s still working');
  codex.state = 'ready';
  await w.go(1); await w.go(5.1);
  assert.deepEqual(w.sent.at(-1).to, ['claude', 'codex']);
  assert.equal(w.keep.view('conv-1').how, 'turns');
});

test('keep working: the one that’s out sits out; the one that’s finished is left alone', async () => {
  const codex = fakeChat('codex', 'conv-c'), gemini = fakeChat('gemini', 'conv-g');
  const w = world({ partners: [codex, gemini] });
  w.on();
  await w.go(0); await w.go(5.1);
  assert.deepEqual(w.sent.at(-1).to, ['claude', 'codex', 'gemini']);
  codex.emit({ kind: 'limit', resetsAt: new Date(w.t + 300 * MIN).toISOString() });
  codex.emit({ kind: 'result', ok: false });
  w.reply(w.chat); w.reply(gemini);
  await w.go(1); await w.go(5.1);
  assert.deepEqual(w.sent.at(-1).to, ['claude', 'gemini']);
  // Claude's finished; Gemini isn't.
  w.reply(w.chat, { text: 'ALL DONE', tools: 0 }); w.reply(gemini);
  await w.go(1); await w.go(5.1);
  assert.deepEqual(w.sent.at(-1).to, ['gemini']);
  assert.equal(w.keep.has('conv-1'), true);
});

test('keep working: nothing to do is one by one, and someone else’s work gets them one more look', async () => {
  const codex = fakeChat('codex', 'conv-c');
  const w = world({ partners: [codex] });
  w.on();
  await w.go(0);
  const round = async (claudeTools, codexTools) => { await w.go(5.1); w.reply(w.chat, { tools: claudeTools }); w.reply(codex, { tools: codexTools }); await w.go(0.3); };
  await round(0, 1);
  await round(0, 1);
  assert.deepEqual(w.sent.at(-1).to, ['claude', 'codex']);
  // Claude's now had two with nothing to do: it's left alone, while Codex works.
  await w.go(5.1);
  assert.ok(w.sent.at(-1).to.includes('claude'), 'Codex got something done, so Claude gets one more look');
  w.reply(w.chat, { tools: 0 }); w.reply(codex, { tools: 0 });
  await w.go(0.3); await w.go(5.1);
  assert.deepEqual(w.sent.at(-1).to, ['codex'], 'now only Codex');
  w.reply(codex, { tools: 0 });
  await w.go(0.3);
  assert.equal(w.keep.has('conv-1'), false, 'and nobody has anything left');
  assert.match(w.chat.buffer.at(-1).text, /nothing more got done/);
});

test('keep working: everyone in a crew finished means finished', async () => {
  const codex = fakeChat('codex', 'conv-c');
  const w = world({ partners: [codex] });
  w.on();
  await w.go(0); await w.go(5.1);
  w.reply(w.chat, { text: 'ALL DONE', tools: 0 }); w.reply(codex, { text: 'ALL DONE', tools: 0 });
  await w.go(1);
  assert.equal(w.keep.has('conv-1'), false);
});

test('keep working: a chat isn’t let go for being idle while it’s on', async () => {
  const codex = fakeChat('codex', 'conv-c');
  const w = world({ partners: [codex] });
  const until = w.t + 90 * MIN;
  w.on({ until });
  await w.go(0);
  assert.ok(w.chat.keepWorkingUntil >= until && codex.keepWorkingUntil >= until);
  const idle = { state: 'ready', clients: new Set(), lastActivity: 0, keepWorkingUntil: w.chat.keepWorkingUntil };
  assert.equal(idleStop(idle, until - 1), false);
  assert.equal(idleStop(idle, until + 2 * MIN), true, 'and after its time, it can be');
});

test('keep working: leaves "Carry on when it’s back" its own hold', async () => {
  const w = world();
  w.on({ until: w.t + 12 * MIN });
  w.chat.holdUntil = w.t + 999 * MIN;
  await w.go(0); await w.go(15);
  assert.equal(w.keep.has('conv-1'), false);
  assert.equal(w.chat.holdUntil, 1e12 + 999 * MIN, 'that’s still waiting');
  assert.equal(w.chat.keepWorkingUntil, 0);
});

test('keep working: started again while a send is on its way, the old one can’t end the new one', async () => {
  let reject;
  const w = world();
  const sends = [];
  const keep = createKeepWorking({ now: () => w.t, live: () => w.chat, crewOf: () => [], open: async () => w.chat, sendAll: async () => [], sendOne: (l, k, text, o) => { sends.push(o); return new Promise((res, rej) => { reject = rej; }); } });
  keep.start({ id: 'conv-1', until: w.t + 600 * MIN, quietMinutes: 5 });
  await keep.tick(); w.t += 5.1 * MIN;
  const going = keep.tick();
  await new Promise(r => setImmediate(r));
  assert.equal(sends.length, 1);
  const v = keep.start({ id: 'conv-1', until: w.t + 90 * MIN, quietMinutes: 15, note: 'New' });
  assert.equal(sends[0].signal.aborted, true, 'the one on its way is called off');
  reject(new Error('It failed.'));
  await going;
  assert.equal(keep.has('conv-1'), true);
  assert.equal(keep.view('conv-1').note, 'New');
  assert.equal(keep.view('conv-1').until, v.until);
  assert.equal(keep.view('conv-1').error, null, 'nor write on its notes');
});

test('keep working: turned off while a check-in is on its way, it’s called off', async () => {
  const w = world();
  const signals = [];
  let release;
  const keep = createKeepWorking({ now: () => w.t, live: () => w.chat, crewOf: () => [fakeChat('codex', 'conv-c')], open: async () => w.chat, sendOne: async () => null, sendAll: (l, k, text, o) => { signals.push(o.signal); return new Promise(res => { release = res; }); } });
  keep.start({ id: 'conv-1', until: w.t + 600 * MIN });
  await keep.tick(); w.t += 5.1 * MIN;
  const going = keep.tick();
  await new Promise(r => setImmediate(r));
  assert.equal(signals.length, 1);
  assert.equal(signals[0].aborted, false);
  keep.stop('conv-1');
  assert.equal(signals[0].aborted, true);
  release([]);
  await going;
  assert.equal(keep.has('conv-1'), false);
});

test('keep working: taking turns, turning it off still reaches the ones whose turn hasn’t come', async () => {
  const w = world({ partners: [fakeChat('codex', 'conv-c')] });
  const signals = [];
  const keep = createKeepWorking({ now: () => w.t, live: () => w.chat, crewOf: () => w.partners, open: async () => w.chat, sendOne: async () => null, sendAll: async (l, k, text, o) => { signals.push(o); return { handedOver: Promise.resolve(null) }; } });
  keep.start({ id: 'conv-1', until: w.t + 600 * MIN, how: 'turns' });
  await keep.tick(); w.t += 5.1 * MIN; await keep.tick();
  assert.equal(signals.length, 1);
  assert.equal(signals[0].how, 'turns');
  assert.equal(signals[0].signal.aborted, false, 'the send has returned, but the round goes on');
  keep.stop('conv-1');
  assert.equal(signals[0].signal.aborted, true);
});

test('keep working: taking turns, one the round never reached isn’t judged for its silence', async () => {
  const chat = fakeChat(), codex = fakeChat('codex', 'conv-c');
  let t = 1e12, rounds = 0, crew = [codex];
  const keep = createKeepWorking({ now: () => t, live: () => chat, crewOf: () => crew, open: async () => chat, sendOne: async () => chat, sendAll: async () => { rounds++; chat.emit({ kind: 'user', text: 'From Session Switcher: keep working' }); chat.emit({ kind: 'assistant', blocks: [{ type: 'tool' }] }); chat.emit({ kind: 'result', ok: true }); return [chat]; } });
  keep.start({ id: 'conv-1', until: t + 6000 * MIN, how: 'turns' });
  crew = [];   // Codex stops, and doesn't come back
  const go = async m => { t += m * MIN; await keep.tick(); };
  await go(0);
  for (let i = 0; i < 3; i++) { await go(5.1); await go(0.5); }
  assert.equal(rounds, 3);
  assert.equal(keep.has('conv-1'), true, 'it isn’t "nothing done": Codex never got it');
  assert.equal(keep.view('conv-1').error, 'Codex couldn’t be reached');
});

test('keep working: one run waiting on a long round doesn’t hold up another', async () => {
  const a = fakeChat('claude', 'conv-a'), b = fakeChat('claude', 'conv-b'), sent = [];
  let t = 1e12, finish;
  const keep = createKeepWorking({ now: () => t, live: id => (id === 'conv-a' ? a : b), crewOf: c => (c === a ? [fakeChat('codex', 'conv-c')] : []), open: async () => a, sendAll: () => new Promise(res => { finish = res; }), sendOne: async (l, k) => { sent.push(l.sessionId); return l; } });
  keep.start({ id: 'conv-a', until: t + 600 * MIN });
  keep.start({ id: 'conv-b', until: t + 600 * MIN });
  await keep.tick();
  t += 5.1 * MIN;
  const going = keep.tick();
  await new Promise(r => setImmediate(r));
  assert.deepEqual(sent, ['conv-b']);
  finish([a]);
  await going;
});

test('keep working: a chat hanging in the middle of a round is still seen to', async () => {
  const chat = fakeChat();
  let t = 1e12, stops = 0;
  chat.interrupt = async () => { stops++; };
  const keep = createKeepWorking({ now: () => t, live: () => chat, crewOf: () => [fakeChat('codex', 'conv-c')], open: async () => chat, sendOne: async () => chat, sendAll: () => new Promise(() => {}) });
  keep.start({ id: 'conv-1', until: t + 600 * MIN, how: 'turns' });
  await keep.tick();
  t += 5.1 * MIN;
  keep.tick();
  await new Promise(r => setImmediate(r));
  chat.state = 'busy'; chat.lastAt = t;
  t += 41 * MIN;
  keep.tick();
  await new Promise(r => setImmediate(r));
  assert.equal(stops, 1);
});

test('keep working: a partner it can’t reach sits out, and a restart remembers that', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-keep-'));
  let t = 1e12;
  const chat = fakeChat('claude', 'conv-a'), cx = fakeChat('codex', 'conv-c');
  const make = sends => createKeepWorking({ dataDir, now: () => t, live: () => chat, crewOf: () => [cx], open: async () => chat, sendAll: async () => [], sendOne: async (l, k) => { sends.push(k); if (k === 'codex') throw new Error('won’t start'); return chat; } });
  const sends = [], keep = make(sends);
  keep.start({ id: 'conv-a', until: t + 480 * MIN, quietMinutes: 1 });
  await keep.tick();
  // Claude's on a long job; Codex won't start, three times.
  chat.state = 'busy';
  for (let i = 0; i < 8; i++) { t += 2 * MIN; await keep.tick(); }
  const tries = sends.filter(k => k === 'codex').length;
  assert.equal(tries, 3, 'three tries, then it sits out');
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'keep-working.json'), 'utf8')).runs[0];
  assert.ok(saved.out.codex && saved.out.codex.unreached, 'and that’s on disk straight away');
  // A restart doesn't try it again early.
  const again = [], after = make(again);
  await after.tick();
  t += 2 * MIN;
  await after.tick();
  assert.equal(again.filter(k => k === 'codex').length, 0, 'not before the hour’s up');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('keep working: the time coming during a long round still counts the check-in that went', async () => {
  let t = 1e12, finish;
  const chat = fakeChat('claude', 'conv-a'), cx = fakeChat('codex', 'conv-c');
  const keep = createKeepWorking({ now: () => t, live: () => chat, crewOf: () => [cx], open: async () => chat, sendOne: async () => chat,
    // The first of the round has it, and it's still replying.
    sendAll: async (lead, kinds, text, { onReached }) => { onReached(); await new Promise(r => { finish = r; }); return [chat]; } });
  keep.start({ id: 'conv-a', until: t + 30 * MIN, quietMinutes: 1, how: 'turns' });
  await keep.tick();
  t += 2 * MIN;
  keep.tick();                                 // on its way, and stays there
  await new Promise(r => setImmediate(r));
  assert.equal(keep.view('conv-a').nudges, 1, 'it counts once someone has it');
  t += 30 * MIN;
  await keep.tick();
  assert.equal(keep.has('conv-a'), false);
  assert.equal(keep.endedSince(0)[0].nudges, 1, 'and it’s there in how it ended');
  finish();
  await new Promise(r => setImmediate(r));
  assert.equal(keep.endedSince(0)[0].nudges, 1, 'once');
});

test('keep working: a check-in nobody got doesn’t count', async () => {
  let t = 1e12;
  const chat = fakeChat('claude', 'conv-a'), cx = fakeChat('codex', 'conv-c');
  const keep = createKeepWorking({ now: () => t, live: () => chat, crewOf: () => [cx], open: async () => chat, sendOne: async () => chat, sendAll: async () => [] });
  keep.start({ id: 'conv-a', until: t + 480 * MIN, quietMinutes: 1 });
  await keep.tick();
  t += 2 * MIN;
  await keep.tick();
  assert.equal(keep.view('conv-a').nudges, 0);
  assert.match(keep.view('conv-a').error, /couldn’t be reached/);
});

test('keep working: refused for usage isn’t "nothing got done"', async () => {
  const w = world();
  w.on({ until: w.t + 6000 * MIN });
  await w.go(0);
  for (let i = 0; i < 4; i++) {
    await w.go(400);
    assert.equal(w.sent.length, i + 1, `check-in ${i + 1} goes once it’s back`);
    w.chat.emit({ kind: 'limit', resetsAt: new Date(w.t + 300 * MIN).toISOString() });
    w.chat.emit({ kind: 'result', ok: false });
    await w.go(1);
    assert.equal(w.keep.has('conv-1'), true, `still on after ${i + 1} refused`);
    assert.equal(w.keep.view('conv-1').state, 'out');
  }
});

test('keep working: a chat that stopped opens again when a check-in is due', async () => {
  const w = world();
  w.on();
  await w.go(0);
  w.chat.state = 'ended';
  await w.go(1);
  assert.equal(w.opened, 0, 'not at once');
  assert.equal(w.keep.view('conv-1').state, 'closed');
  await w.go(5.1);
  assert.equal(w.opened, 1);
  await w.go(0.3);
  assert.equal(w.sent.length, 1, 'and it’s told straight away');
});

test('keep working: can’t be opened just now isn’t trouble; can’t be opened at all is', async () => {
  const busy = world({ openImpl: () => { throw Object.assign(new Error('It’s running in a terminal.'), { status: 409 }); } });
  busy.on();
  await busy.go(0);
  busy.live = null;
  for (let i = 0; i < 20; i++) await busy.go(6);
  assert.equal(busy.keep.has('conv-1'), true);
  assert.equal(busy.keep.view('conv-1').error, 'It’s running in a terminal.');

  const gone = world({ openImpl: () => { throw Object.assign(new Error('Its folder no longer exists.'), { status: 400 }); } });
  gone.on({ until: gone.t + 5000 * MIN });
  await gone.go(0);
  gone.live = null;
  for (let i = 0; i < 40 && gone.keep.has('conv-1'); i++) await gone.go(70);
  assert.equal(gone.keep.has('conv-1'), false, 'it gave up');
  assert.equal(gone.opened, 6);
});

test('keep working: replies that keep failing wait longer each time, and then it stops', async () => {
  const w = world();
  w.on({ until: w.t + 5000 * MIN });
  await w.go(0); await w.go(5.1);
  const gaps = [];
  let last = w.t;
  for (let i = 0; i < 400 && w.keep.has('conv-1'); i++) {
    if (w.keep.view('conv-1').state === 'working' || w.sent.at(-1) && !w.sent.at(-1).answered) {
      w.sent.at(-1).answered = true;
      w.chat.emit({ kind: 'result', ok: false, subtype: 'error_during_execution' });
    }
    const before = w.sent.length;
    await w.go(1);
    if (w.sent.length > before) { gaps.push(Math.round((w.t - last) / MIN)); last = w.t; }
  }
  assert.equal(w.keep.has('conv-1'), false);
  assert.match(w.chat.buffer.at(-1).text, /kept failing/);
  assert.ok(gaps.length >= 3 && gaps.every((g, i) => !i || g >= gaps[i - 1]), `waits get longer: ${gaps}`);
});

test('keep working: Stop means stop', async () => {
  const w = world();
  w.on();
  await w.go(0);
  assert.equal(w.keep.stop('CONV-1', 'stop'), true);
  assert.match(w.chat.buffer.at(-1).text, /because you pressed Stop/);
  await w.go(30);
  assert.equal(w.sent.length, 0);
  assert.equal(w.keep.stop('conv-1'), false, 'it’s off already');
});

test('keep working: checks what you asked for', () => {
  const w = world();
  assert.throws(() => w.keep.start({ id: null, until: w.t + 60 * MIN }), /Send it a message first/);
  assert.throws(() => w.keep.start({ id: 'x', until: w.t - 5 }), /still to come/);
  assert.throws(() => w.keep.start({ id: 'x', until: NaN }), /still to come/);
  assert.throws(() => w.keep.start({ id: 'x', until: w.t + 30 * 24 * 60 * MIN }), /two weeks/);
  const v = w.keep.start({ id: 'x', until: w.t + 60 * MIN, quietMinutes: 0.01, note: 'n'.repeat(5000) });
  assert.equal(v.quietMinutes, 1, 'at least a minute');
  assert.equal(v.note.length, 2000);
});

test('keep working: starting again keeps the count, and changes the time', async () => {
  const w = world();
  w.on();
  await w.go(0); await w.go(5.1);
  w.reply(w.chat);
  const v = w.on({ until: w.t + 60 * MIN, quietMinutes: 15 });
  assert.equal(v.nudges, 1);
  assert.equal(v.quietMinutes, 15);
});

test('keep working: says when it ended by itself', async () => {
  const told = [];
  let t = 1e12;
  const chat = fakeChat();
  const keep = createKeepWorking({ now: () => t, live: () => chat, crewOf: () => [], open: async () => chat, sendAll: async () => [], sendOne: async () => chat, onEnded: (c, words) => told.push([c.key, words]) });
  keep.start({ id: 'conv-1', until: t + 12 * MIN });
  t += 13 * MIN;
  await keep.tick();
  assert.equal(told.length, 1);
  assert.match(told[0][1], /that’s the time you set/);
  keep.start({ id: 'conv-1', until: t + 12 * MIN });
  keep.stop('conv-1', 'stop');
  assert.equal(told.length, 1, 'not when you stopped it');
});

test('keep working: how it ended is kept for the morning, unless you stopped it yourself', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-keep-'));
  const w = world({ dataDir });
  const began = w.t;
  w.on({ until: w.t + 12 * MIN });
  await w.go(0); await w.go(5.1); await w.go(10);
  const [e] = w.keep.endedSince(began);
  assert.equal(e.id, 'conv-1');
  assert.equal(e.why, 'time');
  assert.equal(e.nudges, 1);
  assert.deepEqual(w.keep.endedSince(w.t + 1), [], 'only since then');
  w.on();
  w.keep.stop('conv-1', 'stop');
  assert.equal(w.keep.endedSince(began).length, 1, 'you know about that one');
  const later = createKeepWorking({ dataDir, now: () => w.t, live: () => null, crewOf: () => [], open: async () => null, sendOne: async () => {}, sendAll: async () => {} });
  assert.equal(later.endedSince(began).length, 1, 'and it’s still there after a restart');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('keep working: a restart remembers it’s waiting for usage', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-keep-'));
  const w = world({ dataDir });
  w.on();
  await w.go(0);
  w.chat.emit({ kind: 'limit', resetsAt: new Date(w.t + 120 * MIN).toISOString() });
  w.chat.emit({ kind: 'result', ok: false });
  await w.go(0.5);
  const sent = [];
  const after = createKeepWorking({ dataDir, now: () => w.t, live: () => w.chat, crewOf: () => [], open: async () => w.chat, sendOne: async (l, k, text) => { sent.push(text); return w.chat; }, sendAll: async () => [] });
  await after.tick(); w.t += 6 * MIN; await after.tick();
  assert.equal(sent.length, 0, 'it’s still out');
  assert.equal(after.view('conv-1').state, 'out');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('keep working: a restart carries on where it was; one whose time has passed is gone', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-keep-'));
  const a = world({ dataDir });
  a.on({ note: 'The map.' });
  a.keep.start({ id: 'short', until: a.t + 10 * MIN });
  await a.go(0); await a.go(5.1);
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'keep-working.json'), 'utf8'));
  assert.equal(saved.runs.length, 2);
  const b = world({ dataDir });
  b.t = a.t;
  // A clock at the same time: the file was read when it was made, by its own clock, so make another at that time.
  const c = (() => { const w = { t: a.t + 20 * MIN, chat: fakeChat(), sent: [] };
    w.keep = createKeepWorking({ dataDir, now: () => w.t, live: () => w.chat, crewOf: () => [], open: async () => w.chat, sendOne: async (l, k, text) => w.sent.push(text), sendAll: async () => {} });
    return w; })();
  assert.equal(c.keep.has('conv-1'), true);
  assert.equal(c.keep.has('short'), false, 'its time has passed');
  assert.equal(c.keep.view('conv-1').nudges, 1, 'the count is kept');
  assert.equal(c.keep.view('conv-1').note, 'The map.');
  await c.keep.tick(); c.t += 5.1 * MIN; await c.keep.tick();
  assert.equal(c.sent.length, 1);
  fs.rmSync(dataDir, { recursive: true, force: true });
});
