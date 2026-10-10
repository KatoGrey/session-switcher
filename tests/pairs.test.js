// Claude and Codex in one chat: partners, catching up, and "Both" taking turns (lib/pairs.js), with
// stand-in chats in place of real Claude Code and Codex processes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPairs } = require('../lib/pairs');
const { createChatPrefs } = require('../lib/chatprefs');

const tick = () => new Promise(r => setTimeout(r, 6));
let n = 0;
class FakeChat {
  constructor({ provider = 'claude', sessionId = null, state = 'ready' } = {}) {
    Object.assign(this, { key: `k${++n}`, provider, sessionId, state, companionKey: null, parentKey: null, buffer: [], sent: [], waiters: [], startedAt: new Date().toISOString() });
    this.exited = new Promise(r => { this.markExited = r; });
  }
  info() { return { bufferFrom: this.startedAt }; }
  async beforeTurn() {}
  send(text, images, opts = {}) { this.sent.push({ text, ...opts }); this.buffer.push({ kind: 'user', text, at: new Date().toISOString(), ...(opts.relay ? { relay: true } : {}) }); this.state = 'busy'; }
  reply(text, tools = []) { this.buffer.push({ kind: 'assistant', at: new Date().toISOString(), blocks: [...tools, { type: 'text', text }] }); this.state = 'ready'; this.emit({ kind: 'result', ok: true }); }
  emit(ev) { this.buffer.push(ev); if (ev.kind === 'result' || ev.kind === 'ended') for (const w of this.waiters.splice(0)) w(ev); }
  turnDone() { return new Promise(r => this.waiters.push(r)); }
  stop() { this.stopping = true; this.end(); }
  end() { this.state = 'ended'; this.emit({ kind: 'ended' }); this.markExited(); }
}
function setup({ transcripts = {}, changed = {} } = {}) {
  const all = new Map();
  const chats = {
    get: k => { const c = all.get(k); if (!c) throw new Error('gone'); return c; },
    bySession: id => [...all.values()].find(c => c.state !== 'ended' && c.sessionId && c.sessionId === id) || null,
  };
  const add = c => { all.set(c.key, c); return c; };
  const prefs = createChatPrefs({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ss-pairs-')) });
  const started = [], read = [];
  const pairs = createPairs({
    chats, prefs,
    transcript: async (provider, id) => { read.push(id); return transcripts[id] || []; },
    lastChanged: (provider, id) => changed[id] || 0,
    startPartner: async (lead, { remembered }) => { started.push(remembered); return add(new FakeChat({ provider: lead.provider === 'codex' ? 'claude' : 'codex', sessionId: remembered || `new-${n + 1}` })); },
  });
  return { pairs, prefs, add, started, read };
}
const at = ms => new Date(Date.now() - ms).toISOString();

test('pairs: Codex joins a Claude chat and reads it so far', async () => {
  const { pairs, add } = setup({ transcripts: { L: [{ kind: 'user', text: 'Plan the art.', at: at(60000) }, { kind: 'assistant', at: at(50000), blocks: [{ type: 'text', text: 'Plan: three icons.' }] }] } });
  const lead = add(new FakeChat({ sessionId: 'L' }));
  const partner = await pairs.ensure(lead);
  assert.equal(partner.provider, 'codex');
  assert.equal(partner.parentKey, lead.key); assert.equal(lead.companionKey, partner.key);
  await pairs.send(partner, 'Do the icons.');
  const s = partner.sent[0].text;
  assert.match(s, /^<shared-context items="2">/);
  assert.match(s, /The user, to Claude:\nPlan the art\./);
  assert.match(s, /Claude:\nPlan: three icons\./);
  assert.ok(s.endsWith('</shared-context>\n\nDo the icons.'));
});

test('pairs: each hears what the other said and did, once', async () => {
  const { pairs, add } = setup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  const partner = await pairs.ensure(lead);
  await pairs.send(partner, 'Do the icons.'); await tick();
  partner.reply('Icons done.', [{ type: 'tool', name: 'Edit', summary: 'art/icon.png', meta: { path: 'art/icon.png' } }]); await tick();
  await pairs.send(lead, 'Thanks, use them.');
  const s = lead.sent[0].text;
  assert.match(s, /The user, to Codex:\nDo the icons\./);
  assert.match(s, /Codex:\nIcons done\.\n\(Codex changed art\/icon\.png\.\)/);
  assert.ok(s.endsWith('Thanks, use them.'));
  await tick();
  await pairs.send(lead, 'And one more thing.');
  assert.equal(lead.sent[1].text, 'And one more thing.', 'nothing new, nothing repeated');
});

test('pairs: Both takes turns, and the second builds on the first', async () => {
  const { pairs, add } = setup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  const { handedOver } = await pairs.sendBoth(lead, 'Plan the 1.4 release.');
  assert.equal(lead.sent.at(-1).text, 'Plan the 1.4 release.');
  const partner = pairs.partnerOf(lead);
  await tick();
  assert.equal(partner.sent.length, 0, 'the second waits for the first');
  assert.ok(lead.buffer.some(e => e.kind === 'handoff' && e.state === 'waiting' && e.to === 'codex'));
  lead.reply('Claude’s plan: ship on Friday.');
  assert.equal(await handedOver, partner);
  const s = partner.sent.at(-1);
  assert.equal(s.relay, true);
  assert.match(s.text, /Claude:\nClaude’s plan: ship on Friday\./);
  assert.match(s.text, /sent the message below to both of you, and Claude answered it first/);
  assert.doesNotMatch(s.text, /The user, to Claude:\nPlan the 1\.4/);
  assert.ok(s.text.endsWith('Plan the 1.4 release.'));
  assert.ok(lead.buffer.some(e => e.kind === 'handoff' && e.state === 'sent'));
});

test('pairs: stopping the first one skips the hand-over', async () => {
  const { pairs, add } = setup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  const { handedOver } = await pairs.sendBoth(lead, 'Try it.');
  lead.interruptedAt = Date.now() + 1;
  lead.emit({ kind: 'result', ok: false });
  assert.equal(await handedOver, null);
  assert.equal(pairs.partnerOf(lead).sent.length, 0);
  assert.ok(lead.buffer.some(e => e.kind === 'handoff' && e.state === 'skipped'));
});

test('pairs: a partner already running is paired, never started twice', async () => {
  const { pairs, prefs, add, started } = setup();
  prefs.link('L', 'P');
  const running = add(new FakeChat({ provider: 'codex', sessionId: 'P' }));   // opened from a list
  const lead = add(new FakeChat({ sessionId: 'L' }));
  assert.equal(await pairs.ensure(lead), running);
  assert.deepEqual(started, []);
});

test('pairs: two quick messages start one partner', async () => {
  const { pairs, add, started } = setup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  const [a, b] = await Promise.all([pairs.ensure(lead), pairs.ensure(lead)]);
  assert.equal(a, b); assert.equal(started.length, 1);
});

test('pairs: a partner left running from an earlier run is paired when its chat opens again', () => {
  const { pairs, prefs, add } = setup();
  prefs.link('L', 'P');
  const old = add(new FakeChat({ sessionId: 'L' })); old.state = 'ended';
  const orphan = add(new FakeChat({ provider: 'codex', sessionId: 'P' })); orphan.parentKey = old.key;
  const lead = add(new FakeChat({ sessionId: 'L' }));
  assert.equal(pairs.adopt(lead), true);
  assert.equal(lead.companionKey, orphan.key);
});

test('pairs: when its earlier conversation won’t resume, it starts fresh and gets what was waiting', async () => {
  const { pairs, prefs, add, started } = setup();
  prefs.link('L', 'P');
  const lead = add(new FakeChat({ sessionId: 'L' }));
  const first = await pairs.ensure(lead);
  first.state = 'starting';
  await pairs.send(first, 'Hello Codex.');
  first.end();   // never got going
  await tick(); await tick();
  const second = pairs.partnerOf(lead);
  assert.notEqual(second, first);
  assert.deepEqual(started, ['P', null]);
  assert.ok(second.sent.some(x => x.text.endsWith('Hello Codex.')), 'what was waiting goes to the new one');
  assert.ok(lead.buffer.some(e => e.kind === 'notice' && /started a new one, caught up on this chat/.test(e.text)));
});

test('pairs: after a restart, a chat hears what its partner said since it last caught up', async () => {
  const { pairs, prefs, add } = setup({ transcripts: { P: [{ kind: 'user', text: 'Old ask', at: at(90000) }, { kind: 'assistant', at: at(80000), blocks: [{ type: 'text', text: 'Old answer' }] }, { kind: 'user', text: 'New ask', at: at(20000) }, { kind: 'assistant', at: at(10000), blocks: [{ type: 'text', text: 'New answer' }] }] } });
  prefs.link('L', 'P'); prefs.setHeard('L', at(50000));
  const lead = add(new FakeChat({ sessionId: 'L' }));
  await pairs.send(lead, 'Where were we?');
  const s = lead.sent[0].text;
  assert.match(s, /New answer/); assert.doesNotMatch(s, /Old answer/);
});

test('pairs: a partner whose conversation hasn’t changed isn’t read again', async () => {
  const { pairs, prefs, add, read } = setup({ changed: { P: Date.now() - 60000 } });
  prefs.link('L', 'P'); prefs.setHeard('L', at(1000));
  const lead = add(new FakeChat({ sessionId: 'L' }));
  await pairs.send(lead, 'Hi');
  assert.deepEqual(read, []);
  assert.equal(lead.sent[0].text, 'Hi');
});

test('pairs: Claude can be the partner too, in a Codex chat', async () => {
  const { pairs, add } = setup();
  const lead = add(new FakeChat({ provider: 'codex', sessionId: 'T' }));
  const partner = await pairs.ensure(lead);
  assert.equal(partner.provider, 'claude');
  await pairs.send(lead, 'Make the art.'); await tick();
  lead.reply('Art made.'); await tick();
  await pairs.send(partner, 'Write the patch notes.');
  assert.match(partner.sent[0].text, /You and Codex share this chat/);
  assert.match(partner.sent[0].text, /Codex:\nArt made\./);
});

test('pairs: files you undid are mentioned with your next message, once', async () => {
  const { pairs, add } = setup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  lead.undoneFiles = [['a.js', 'b.js']];
  await pairs.send(lead, 'Try a gentler fix.');
  assert.match(lead.sent[0].text, /The user undid the file changes from your earlier reply: a\.js, b\.js are back as before it\./);
  assert.ok(lead.sent[0].text.endsWith('Try a gentler fix.'));
  await pairs.send(lead, 'And another thing.');
  assert.equal(lead.sent[1].text, 'And another thing.');
});

test('pairs: only a chat’s current partner is its partner; an earlier one is a chat of its own again', () => {
  const { prefs } = setup();
  prefs.link('L', 'P1');
  prefs.link('L', 'P2');   // it started a new conversation since
  assert.equal(prefs.parentOf('P2'), 'L');
  assert.equal(prefs.parentOf('P1'), null);
  assert.deepEqual([...prefs.partners().keys()], ['p2']);
});

test('pairs: a Codex conversation that can’t be resumed is replaced before your message goes', async () => {
  const all = new Map(), started = [];
  const chats = { get: k => { const c = all.get(k); if (!c) throw new Error('gone'); return c; }, bySession: id => [...all.values()].find(c => c.state !== 'ended' && c.sessionId === id) || null };
  const prefs = createChatPrefs({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ss-pairs-')) });
  prefs.link('L', 'GONE');
  const pairs = createPairs({ chats, prefs, transcript: async () => [], startPartner: async (lead, { remembered }) => {
    started.push(remembered);
    const c = new FakeChat({ provider: 'codex', sessionId: remembered || 'NEW', state: 'starting' }); all.set(c.key, c);
    if (remembered) setTimeout(() => c.end(), 20); else setTimeout(() => { c.state = 'ready'; c.buffer.push({ kind: 'init' }); }, 20);
    return c;
  } });
  const lead = new FakeChat({ sessionId: 'L' }); all.set(lead.key, lead);
  const partner = await pairs.ensure(lead);
  assert.deepEqual(started, ['GONE', null]);
  assert.equal(partner.sessionId, 'NEW'); assert.equal(lead.companionKey, partner.key);
  await pairs.send(partner, 'Hello Codex.');
  assert.ok(partner.sent[0].text.endsWith('Hello Codex.'));
  assert.ok(lead.buffer.some(e => e.kind === 'notice' && /started a new one/.test(e.text)));
});

test('pairs: a Codex conversation still in use (an app that’s just quitting) is waited for, not replaced', async () => {
  const all = new Map(), started = [];
  const chats = { get: k => { const c = all.get(k); if (!c) throw new Error('gone'); return c; }, bySession: id => [...all.values()].find(c => c.state !== 'ended' && c.sessionId === id) || null };
  const prefs = createChatPrefs({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ss-pairs-')) });
  prefs.link('L', 'P');
  const pairs = createPairs({ chats, prefs, transcript: async () => [], startPartner: async (lead, { remembered }) => {
    started.push(remembered);
    const c = new FakeChat({ provider: 'codex', sessionId: remembered || 'NEW', state: 'starting' }); all.set(c.key, c);
    if (started.length === 1) setTimeout(() => { c.buffer.push({ kind: 'notice', level: 'warning', text: 'Couldn’t start Codex: thread P already has an active writer' }); c.end(); }, 10);
    else setTimeout(() => { c.state = 'ready'; c.buffer.push({ kind: 'init' }); }, 10);
    return c;
  } });
  const lead = new FakeChat({ sessionId: 'L' }); all.set(lead.key, lead);
  const partner = await pairs.ensure(lead);
  assert.deepEqual(started, ['P', 'P'], 'tried again, the same conversation');
  assert.equal(partner.sessionId, 'P');
  assert.ok(!lead.buffer.some(e => e.kind === 'notice'), 'and nothing to tell you');
});
