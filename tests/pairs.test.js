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
  turnDone(signal) {
    if (signal && signal.aborted) return Promise.resolve({ kind: 'cancelled' });
    return new Promise(resolve => {
      const finish = ev => { if (signal) signal.removeEventListener('abort', cancel); resolve(ev); };
      const cancel = () => { this.waiters = this.waiters.filter(f => f !== finish); finish({ kind: 'cancelled' }); };
      this.waiters.push(finish);
      if (signal) signal.addEventListener('abort', cancel, { once: true });
    });
  }
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

test('pairs: cancellation during preparation prevents delivery and releases only its unused baseline', async () => {
  const {pairs,add}=setup(),lead=add(new FakeChat({sessionId:'cancel-single'}));
  const controller=new AbortController();let release;
  lead.snap={pending:null};lead.clearPendingSnapshot=()=>{lead.snap.pending=null;};
  lead.beforeTurn=async()=>{await new Promise(resolve=>{release=resolve;});lead.snap.pending={before:'synthetic'};};
  const sending=pairs.send(lead,'Automatic check-in.',[],{signal:controller.signal});
  while(!release)await tick();controller.abort();release();
  await assert.rejects(sending,err=>err.name==='AbortError');
  assert.equal(lead.sent.length,0);assert.equal(lead.snap.pending,null);assert.equal(lead.heardUntil,undefined);
});

test('crew: cancellation after parallel baselines are prepared cancels every undelivered recipient', async () => {
  const {pairs,add}=setup(),lead=add(new FakeChat({sessionId:'cancel-crew'}));
  const mate=await pairs.ensure(lead),controller=new AbortController();let ready=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  for(const chat of [lead,mate]){
    chat.snap={pending:null};chat.clearPendingSnapshot=()=>{chat.snap.pending=null;};
    chat.beforeTurn=async()=>{ready++;await gate;chat.snap.pending={before:'synthetic'};};
  }
  const sending=pairs.sendTogether(lead,'Automatic crew check-in.',[],{kinds:['claude','codex'],signal:controller.signal});
  while(ready<2)await tick();controller.abort();release();
  await assert.rejects(sending,err=>err.name==='AbortError');
  assert.equal(lead.sent.length+mate.sent.length,0);
  assert.equal(lead.snap.pending,null);assert.equal(mate.snap.pending,null);
  assert.equal(lead.buffer.some(e=>e.kind==='notice'),false,'deliberate cancellation is quiet');
});

test('crew: a cancellation never reports an already accepted delivery as failed', async () => {
  const {pairs,add}=setup(),lead=add(new FakeChat({sessionId:'partial-cancel'}));
  const mate=await pairs.ensure(lead),controller=new AbortController(),send=lead.send.bind(lead);
  lead.send=(...args)=>{send(...args);controller.abort();};
  const sent=await pairs.sendTogether(lead,'One begins before cancellation.',[],{kinds:['claude','codex'],signal:controller.signal});
  assert.deepEqual(sent,[lead]);assert.equal(lead.sent.length,1);assert.equal(mate.sent.length,0);
});

test('crew: cancelling a taking-turns round skips its next assistant without interrupting the accepted reply', async () => {
  const { pairs, add } = setup(), lead = add(new FakeChat({ sessionId: 'cancel-handoff' }));
  const controller = new AbortController();
  const round = await pairs.sendGroup(lead, 'Automatic check-in', [], { kinds: ['claude', 'codex'], signal: controller.signal });
  const partner = pairs.crewOf(lead)[0];
  assert.equal(lead.sent.length, 1); assert.equal(lead.waiters.length, 1);
  controller.abort();
  assert.equal(await round.handedOver, null);
  assert.deepEqual(round.delivered, [lead]);
  assert.equal(lead.state, 'busy', 'turning off future check-ins does not stop the current reply');
  assert.equal(lead.waiters.length, 1, 'the queue still observes the accepted reply until it actually finishes');
  assert.equal(partner.sent.length, 0);
  lead.reply('Finished the accepted work.'); await tick();
  assert.equal(lead.waiters.length, 0);
  assert.equal(partner.sent.length, 0);
  assert.equal(lead.buffer.some(e => e.kind === 'unsent'), false, 'cancelled automation is not restored as a user draft');
});

test('crew: cancelling a round waiting on a busy first assistant releases its observer and sends nothing', async () => {
  const { pairs, add } = setup(), lead = add(new FakeChat({ sessionId: 'cancel-busy', state: 'busy' }));
  const controller = new AbortController();
  const round = await pairs.sendBoth(lead, 'Automatic check-in', [], { signal: controller.signal });
  controller.abort();
  assert.equal(await round.handedOver, null);
  assert.equal(lead.waiters.length, 0);
  lead.reply('Existing reply'); await tick();
  assert.equal(lead.sent.length, 0);
  assert.equal(pairs.crewOf(lead)[0].sent.length, 0);
});

test('crew: cancelling a queued round leaves the current complete round ordered', async () => {
  const { pairs, add } = setup(), lead = add(new FakeChat({ sessionId: 'cancel-queued' }));
  const first = await pairs.sendGroup(lead, 'Current request', [], { kinds: ['claude', 'codex'] });
  const controller = new AbortController();
  const held = await pairs.sendGroup(lead, 'Automatic check-in', [], { kinds: ['claude', 'codex'], signal: controller.signal });
  controller.abort();
  const third = await pairs.sendGroup(lead, 'Later user request', [], { kinds: ['claude', 'codex'] });
  lead.reply('First answer'); const partner = await first.handedOver;
  assert.equal(lead.sent.length, 1, 'the later request still waits through the first partner\'s answer');
  partner.reply('First partner answer');
  assert.equal(await held.handedOver, null);
  await tick(); await tick();
  assert.equal(lead.sent.length, 2);
  assert.match(lead.sent[1].text, /Later user request/);
  assert.equal(lead.buffer.some(e => e.kind === 'unsent'), false);
  lead.reply('Later answer'); const last = await third.handedOver; last.reply('Later partner answer');
});

test('crew: cancellation while the next assistant takes its baseline prevents that handoff', async () => {
  const { pairs, add } = setup(), lead = add(new FakeChat({ sessionId: 'cancel-next-baseline' }));
  const partner = await pairs.ensure(lead), controller = new AbortController(); let release;
  partner.beforeTurn = () => new Promise(resolve => { release = resolve; });
  const round = await pairs.sendGroup(lead, 'Automatic check-in', [], { kinds: ['claude', 'codex'], signal: controller.signal });
  lead.reply('First work finished'); while (!release) await tick();
  controller.abort(); release();
  assert.equal(await round.handedOver, null);
  assert.equal(partner.sent.length, 0);
  assert.equal(partner.waiters.length, 0);
});

test('crew: cancelling a handoff cannot start a differently ordered round alongside the accepted reply', async () => {
  const { pairs, add } = setup(), lead = add(new FakeChat({ sessionId: 'cancel-reordered' }));
  const controller = new AbortController();
  const first = await pairs.sendGroup(lead, 'First request', [], { kinds: ['claude', 'codex'], signal: controller.signal });
  const next = await pairs.sendGroup(lead, 'Later request', [], { kinds: ['codex', 'claude'] });
  const partner = pairs.crewOf(lead)[0];
  controller.abort(); assert.equal(await first.handedOver, null); await tick();
  assert.equal(partner.sent.length, 0, 'a different first assistant still waits for the accepted reply');
  lead.reply('Accepted reply complete'); await tick(); await tick();
  assert.equal(partner.sent.length, 1);
  partner.reply('Next round first reply'); assert.equal(await next.handedOver, lead);
  lead.reply('Next round last reply');
});

test('crew: cancelling after a result still waits for its final snapshot before another round edits', async () => {
  const { pairs, add } = setup(), lead = add(new FakeChat({ sessionId: 'cancel-finalizing' }));
  let release, observed = 0;
  const finalizing = new Promise(resolve => { release = resolve; });
  const turnDone = lead.turnDone.bind(lead);
  lead.turnDone = signal => { const result = turnDone(signal); return observed++ === 0 ? result.then(async ev => { await finalizing; return ev; }) : result; };
  const controller = new AbortController();
  const first = await pairs.sendGroup(lead, 'First request', [], { kinds: ['claude', 'codex'], signal: controller.signal });
  const next = await pairs.sendGroup(lead, 'Later request', [], { kinds: ['codex', 'claude'] });
  const partner = pairs.crewOf(lead)[0];
  lead.reply('Result visible, snapshot still saving'); controller.abort();
  assert.equal(await first.handedOver, null); await tick();
  assert.equal(partner.sent.length, 0, 'being ready is not enough while the accepted reply finalizes');
  release(); await tick(); await tick();
  assert.equal(partner.sent.length, 1);
  partner.reply('Next round first reply'); assert.equal(await next.handedOver, lead);
  lead.reply('Next round last reply');
});

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
  assert.ok(lead.sent.at(-1).text.endsWith('Plan the 1.4 release.'));
  assert.match(lead.sent.at(-1).text, /You answer first; Codex picks it up after you/, 'the first one knows a partner follows');
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

test('pairs: what the partner says during the snapshot before a send is passed on next time', async () => {
  const { pairs, add } = setup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  const partner = await pairs.ensure(lead);
  partner.state = 'busy';
  await pairs.send(lead, 'First message.');
  // A slow snapshot: the partner replies while it runs.
  lead.beforeTurn = async () => { await tick(); partner.reply('Step 2: I rewrote save.lua.'); await tick(); };
  await pairs.send(lead, 'Second message.');
  lead.beforeTurn = async () => {};
  await tick();
  await pairs.send(lead, 'Third message.');
  assert.ok(lead.sent.some(s => /Step 2: I rewrote save\.lua/.test(s.text)), 'the reply from during the snapshot reaches Claude');
});

test('pairs: "when it’s done" waits for the busy one, then sends', async () => {
  const { pairs, add } = setup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  const partner = await pairs.ensure(lead);
  lead.state = 'busy';
  await pairs.sendAfter(partner, 'Now the icons.');
  assert.equal(partner.sent.length, 0, 'held while Claude works');
  assert.ok(partner.buffer.some(e => e.kind === 'notice' && /once Claude finishes/.test(e.text)));
  lead.reply('Done with the code.');
  await tick(); await tick();
  assert.ok(partner.sent.at(-1).text.endsWith('Now the icons.'), 'sent once Claude finished');
  assert.match(partner.sent.at(-1).text, /Done with the code\./, 'and caught up on what Claude just did');
});

test('pairs: plan first drafts, has the other check it, then asks who builds', async () => {
  const { pairs, add } = setup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  await pairs.planFirst(lead, 'Add a save system.');
  assert.match(lead.sent.at(-1).text, /Add a save system\.\n\n\(Plan first: .*Don't change any files yet/s);
  assert.ok(lead.buffer.some(e => e.kind === 'planfirst' && e.state === 'drafting'));
  lead.reply('1. Write save.lua\n2. Hook it to the menu');
  await tick(); await tick();
  const partner = pairs.partnerOf(lead);
  assert.match(partner.sent.at(-1).text, /\(Plan first\) Check Claude's plan above/);
  assert.match(partner.sent.at(-1).text, /Write save\.lua/, 'and it was caught up on the plan');
  assert.ok(lead.buffer.some(e => e.kind === 'planfirst' && e.state === 'checking'));
  partner.reply('Add a version number to the save file.');
  await tick(); await tick();
  assert.ok(lead.buffer.some(e => e.kind === 'planfirst' && e.state === 'ready' && e.checked));
});

// A crew of three: Codex and Gemini in a Claude chat.
function crewSetup({ unavailable = [], waitForPartner = async () => {} } = {}) {
  const all = new Map();
  const chats = {
    get: k => { const c = all.get(k); if (!c) throw new Error('gone'); return c; },
    bySession: id => [...all.values()].find(c => c.state !== 'ended' && c.sessionId && c.sessionId === id) || null,
  };
  const add = c => { all.set(c.key, c); return c; };
  const prefs = createChatPrefs({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ss-crew-')) });
  const started = [];
  const kinds = new Map();
  const pairs = createPairs({
    chats, prefs,
    transcript: async () => [],
    kindOf: id => kinds.get(id) || null,
    startPartner: async (lead, { remembered, kind }) => { started.push({ remembered, kind }); if (unavailable.includes(kind)) throw new Error(`${kind} is unavailable`); await waitForPartner(kind); const id = remembered || `${kind}-${n + 1}`; kinds.set(id, kind); return add(new FakeChat({ provider: kind, sessionId: id })); },
  });
  return { pairs, prefs, add, started, kinds };
}

test('crew: Codex and Gemini both join a Claude chat; each is its own partner', async () => {
  const { pairs, add, started, prefs } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  const cx = await pairs.ensure(lead, { kind: 'codex' });
  const gm = await pairs.ensure(lead, { kind: 'gemini' });
  assert.equal(cx.provider, 'codex'); assert.equal(gm.provider, 'gemini');
  assert.deepEqual(started.map(s => s.kind), ['codex', 'gemini']);
  assert.equal(pairs.crewOf(lead).length, 2, 'both stay in the chat (Gemini doesn’t push Codex out)');
  assert.equal(await pairs.ensure(lead, { kind: 'codex' }), cx, 'asking for Codex again: the same one');
  assert.deepEqual(pairs.kindsIn(lead).sort(), ['codex', 'gemini']);
  assert.deepEqual(prefs.crewOf('L'), { codex: cx.sessionId, gemini: gm.sessionId }, 'remembered, one of each');
  assert.equal(prefs.parentOf(cx.sessionId), 'L'); assert.equal(prefs.parentOf(gm.sessionId), 'L');
});

test('crew: “All” goes round in turn, each seeing the answers before theirs', async () => {
  const { pairs, add } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  const { handedOver } = await pairs.sendBoth(lead, 'Name the tavern.', [], { kinds: ['codex', 'gemini'] });
  assert.match(lead.sent[0].text, /The user sent the message below to all of you\. You answer first; Codex and Gemini pick it up after you/);
  lead.reply('The Starfall.');
  await tick(); await tick();
  const [cx, gm] = pairs.crewOf(lead);
  assert.equal(cx.provider, 'codex');
  assert.match(cx.sent[0].text, /Claude:\nThe Starfall\./);
  assert.match(cx.sent[0].text, /the others before you answered it/);
  assert.equal(gm.sent.length, 0, 'Gemini waits for Codex');
  cx.reply('The Lantern Rest.');
  await tick(); await tick();
  assert.match(gm.sent[0].text, /Claude:\nThe Starfall\./);
  assert.match(gm.sent[0].text, /Codex:\nThe Lantern Rest\./, 'Gemini hears both');
  assert.match(gm.sent[0].text, /You, Claude and Codex share this chat/);
  gm.reply('The Hearth and Harp.');
  assert.equal(await handedOver, gm);
  // Next time Claude speaks, it hears Codex and Gemini both.
  await pairs.send(lead, 'Pick one.');
  assert.match(lead.sent[1].text, /Codex:\nThe Lantern Rest\./);
  assert.match(lead.sent[1].text, /Gemini:\nThe Hearth and Harp\./);
});

test('crew: Together with the ones you picked: Gemini then Codex in a Claude chat, Claude sitting out', async () => {
  const { pairs, add } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  const { handedOver } = await pairs.sendGroup(lead, 'Sketch the menu.', [], { kinds: ['gemini', 'codex'] });
  assert.equal(lead.sent.length, 0, 'Claude isn’t asked');
  const gm = pairs.crewOf(lead).find(c => c.provider === 'gemini');
  assert.match(gm.sent[0].text, /to Codex and you, to take turns in this order: you, then Codex\. You answer first\. Codex picks it up after you/);
  assert.ok(lead.buffer.some(e => e.kind === 'handoff' && e.to === 'codex' && e.state === 'waiting' && e.after === 'gemini'), 'the chat shows Codex is next, after Gemini');
  gm.reply('Three tabs: Play, Load, Quit.');
  await tick(); await tick();
  const cx = pairs.crewOf(lead).find(c => c.provider === 'codex');
  assert.match(cx.sent[0].text, /Gemini:\nThree tabs/);
  assert.match(cx.sent[0].text, /to Gemini and you, to take turns in this order: Gemini, then you\. Gemini answered it before you \(above\).*You are the last one/s);
  cx.reply('Added Settings.');
  assert.equal(await handedOver, cx);
  assert.equal(lead.sent.length, 0, 'still not Claude');
});

test('crew: Together in any order, Claude second; fewer than two is refused', async () => {
  const { pairs, add } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  await assert.rejects(pairs.sendGroup(lead, 'Hi.', [], { kinds: ['codex'] }), /at least two/);
  const { handedOver } = await pairs.sendGroup(lead, 'Review the save code.', [], { kinds: ['codex', 'claude'] });
  const cx = pairs.crewOf(lead).find(c => c.provider === 'codex');
  assert.equal(lead.sent.length, 0, 'Claude waits for Codex');
  cx.reply('Found a race on autosave.');
  await tick(); await tick();
  assert.match(lead.sent[0].text, /Codex:\nFound a race on autosave\./);
  assert.match(lead.sent[0].text, /in this order: Codex, then you\. Codex answered it before you/);
  lead.reply('Fixed it with a lock.');
  assert.equal(await handedOver, lead);
});

test('crew: at the same time, everyone picked starts at once, each on its own part', async () => {
  const { pairs, add } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  await assert.rejects(pairs.sendTogether(lead, 'Hi.', [], { kinds: ['claude'] }), /at least two/);
  const msg = 'Claude: write the save system. Codex: make the menu icons.';
  await pairs.sendTogether(lead, msg, [], { kinds: ['claude', 'codex'] });
  const cx = pairs.crewOf(lead).find(c => c.provider === 'codex');
  assert.equal(lead.sent.length, 1, 'Claude has it'); assert.equal(cx.sent.length, 1, 'and Codex has it, before Claude answered');
  assert.equal(lead.state, 'busy'); assert.equal(cx.state, 'busy', 'both at work at once');
  assert.match(lead.sent[0].text, /to Codex and you at the same time: you all work on it at once.*Do only your own part.*yours is what it gives Claude.*Don't edit files it may be working on/s);
  assert.match(cx.sent[0].text, /to Claude and you at the same time.*yours is what it gives Codex/s);
  assert.ok(lead.sent[0].text.endsWith(msg) && cx.sent[0].text.endsWith(msg), 'your words, once, after the note');
  // Afterwards each hears what the other did.
  await tick(); lead.reply('Wrote save.lua.'); cx.reply('Made 4 icons in art/menu.'); await tick();
  await pairs.send(lead, 'Wire the icons in.');
  assert.match(lead.sent[1].text, /Codex:\nMade 4 icons in art\/menu\./);
});

test('crew: at the same time without the chat’s own: Codex and Gemini in a Claude chat', async () => {
  const { pairs, add } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  await pairs.sendTogether(lead, 'Codex: icons. Gemini: the lore text.', [], { kinds: ['codex', 'gemini'] });
  const [cx, gm] = ['codex', 'gemini'].map(k => pairs.crewOf(lead).find(c => c.provider === k));
  assert.equal(lead.sent.length, 0, 'Claude sits out');
  assert.equal(cx.sent.length, 1); assert.equal(gm.sent.length, 1);
  assert.match(gm.sent[0].text, /to Codex and you at the same time/);
});

test('crew: at the same time, a delivery failure leaves the successful sends accepted', async () => {
  const { pairs, add } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  const cx = await pairs.ensure(lead, { kind: 'codex' });
  cx.send = () => { throw new Error('The chat has stopped.'); };
  const sent = await pairs.sendTogether(lead, 'Claude: code. Codex: icons. Gemini: review.', [], { kinds: ['claude', 'codex', 'gemini'] });
  assert.deepEqual(sent.map(c => c.provider), ['claude', 'gemini']);
  assert.equal(lead.sent.length, 1, 'the successful send is not reported as failed and retried');
  assert.equal(sent[1].sent.length, 1);
  assert.ok(lead.buffer.some(e => e.kind === 'notice' && e.level === 'warning' && /Codex.*The chat has stopped\./.test(e.text)), 'the failed recipient is named');
});

test('crew: at the same time, all delivery failures reject after naming each recipient', async () => {
  const { pairs, add } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  const cx = await pairs.ensure(lead, { kind: 'codex' });
  for (const c of [lead, cx]) c.send = () => { throw new Error('The chat has stopped.'); };
  await assert.rejects(pairs.sendTogether(lead, 'Try both.', [], { kinds: ['claude', 'codex'] }), err => err.status === 500);
  const warnings = lead.buffer.filter(e => e.kind === 'notice' && e.level === 'warning').map(e => e.text);
  assert.ok(warnings.some(t => /Claude.*The chat has stopped\./.test(t)));
  assert.ok(warnings.some(t => /Codex.*The chat has stopped\./.test(t)));
});

test('crew: take turns skips an unavailable middle assistant without waiting for the first again', async () => {
  const { pairs, add } = crewSetup({ unavailable: ['codex'] });
  const lead = add(new FakeChat({ sessionId: 'L' }));
  const { handedOver, delivered } = await pairs.sendGroup(lead, 'Review the save system.', [], { kinds: ['claude', 'codex', 'gemini'] });
  assert.deepEqual(delivered, [lead], 'only the first has received it before the handoff');
  await tick();
  lead.reply('The save needs a version number.');
  await tick(); await tick();
  const gm = pairs.crewOf(lead).find(c => c.provider === 'gemini');
  assert.equal(gm.sent.length, 1, 'Gemini gets the request after Codex fails to start');
  assert.match(gm.sent[0].text, /The save needs a version number\./);
  assert.match(gm.sent[0].text, /in this order: Claude, then you\. Claude answered it before you/, 'only assistants that received the request are described as having answered');
  assert.equal(await handedOver, gm);
  assert.deepEqual(delivered, [lead, gm], 'an unavailable middle assistant is absent from the actual delivery list');
  assert.ok(lead.buffer.some(e => e.kind === 'handoff' && e.to === 'codex' && e.state === 'skipped'));
  assert.ok(lead.buffer.some(e => e.kind === 'handoff' && e.to === 'gemini' && e.state === 'sent'));
});

test('crew: plan first with the ones you picked: Gemini drafts, Codex checks', async () => {
  const { pairs, add } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  await pairs.planFirst(lead, 'Add a save system.', [], { by: 'gemini', kind: 'codex' });
  await tick();
  const gm = pairs.crewOf(lead).find(c => c.provider === 'gemini');
  assert.equal(lead.sent.length, 0, 'Claude doesn’t draft it');
  assert.match(gm.sent.at(-1).text, /\(Plan first: .*Codex checks the plan next/s);
  assert.ok(lead.buffer.some(e => e.kind === 'planfirst' && e.state === 'drafting' && e.who === 'gemini' && e.to === 'codex'));
  gm.reply('1. save.lua 2. menu hook');
  await tick(); await tick();
  const cx = pairs.crewOf(lead).find(c => c.provider === 'codex');
  assert.match(cx.sent.at(-1).text, /\(Plan first\) Check Gemini's plan above/);
  cx.reply('Add a version number.');
  await tick(); await tick();
  assert.ok(lead.buffer.some(e => e.kind === 'planfirst' && e.state === 'ready' && e.checked));
});

test('crew: after a restart, the crew comes back, each by its own conversation', async () => {
  const one = crewSetup();
  const lead = one.add(new FakeChat({ sessionId: 'L' }));
  const cx = await one.pairs.ensure(lead, { kind: 'codex' });
  const gm = await one.pairs.ensure(lead, { kind: 'gemini' });
  // A new run: the same prefs, nothing running.
  const lead2 = one.add(new FakeChat({ sessionId: 'L' }));
  cx.state = 'ended'; gm.state = 'ended'; lead.state = 'ended';
  const g2 = await one.pairs.ensure(lead2, { kind: 'gemini' });
  assert.equal(g2.sessionId, gm.sessionId, 'Gemini resumes its own conversation');
  const c2 = await one.pairs.ensure(lead2, { kind: 'codex' });
  assert.equal(c2.sessionId, cx.sessionId, 'and Codex its own');
});

test('crew: taking turns while the first is mid-reply: the round starts when it’s done, and each waits for a real answer', async () => {
  const { pairs, add } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  lead.state = 'busy';
  const { handedOver } = await pairs.sendGroup(lead, 'Review the save code.', [], { kinds: ['claude', 'codex'] });
  await tick();
  assert.equal(lead.sent.length, 0, 'held while Claude finishes what it was doing');
  assert.ok(lead.buffer.some(e => e.kind === 'notice' && /Claude is still working\. Your message goes to Claude, then Codex/.test(e.text)));
  lead.reply('Done with what I was on.');
  await tick(); await tick();
  assert.ok(lead.sent.at(-1).text.endsWith('Review the save code.'), 'now it has it');
  const cx = pairs.crewOf(lead).find(c => c.provider === 'codex');
  assert.equal(cx.sent.length, 0, 'and Codex isn’t told Claude has answered until it has');
  lead.reply('Found a race on autosave.');
  assert.equal(await handedOver, cx);
  assert.match(cx.sent[0].text, /Found a race on autosave\./);
});

test('crew: taking turns, stopped while waiting for the first: nothing goes out, and it says what didn’t', async () => {
  const { pairs, add } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  lead.state = 'busy';
  const { handedOver } = await pairs.sendGroup(lead, 'Review the save code.', [], { kinds: ['claude', 'codex'] });
  lead.interruptedAt = Date.now() + 1;
  lead.emit({ kind: 'result', ok: false });
  assert.equal(await handedOver, null);
  assert.equal(lead.sent.length, 0);
  assert.ok(lead.buffer.some(e => e.kind === 'notice' && /didn’t go out: “Review the save code\./.test(e.text)));
});

test('crew: one that fails by itself mid-round doesn’t end it for the others, and isn’t said to have answered', async () => {
  const { pairs, add } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  const { handedOver } = await pairs.sendGroup(lead, 'Name the tavern.', [], { kinds: ['codex', 'gemini'] });
  await tick();
  const cx = pairs.crewOf(lead).find(c => c.provider === 'codex');
  cx.end();   // it crashed: nobody stopped it
  const gm = await handedOver;
  assert.equal(gm.provider, 'gemini');
  assert.ok(gm.sent[0].text.endsWith('Name the tavern.'), 'Gemini still gets it');
  assert.doesNotMatch(gm.sent[0].text, /Codex answered it before you/);
  assert.ok(lead.buffer.some(e => e.kind === 'notice' && /Codex stopped before it finished, so Gemini picks this up/.test(e.text)));
});

test('crew: stopping one with Stop still ends the round', async () => {
  const { pairs, add } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  const { handedOver } = await pairs.sendGroup(lead, 'Name the tavern.', [], { kinds: ['codex', 'gemini'] });
  await tick();
  const cx = pairs.crewOf(lead).find(c => c.provider === 'codex');
  cx.stop();
  assert.equal(await handedOver, null);
  assert.equal(pairs.crewOf(lead).find(c => c.provider === 'gemini').sent.length, 0);
});

test('crew: one that can’t take the message is skipped, and the next still gets it', async () => {
  const { pairs, add } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  const cx = await pairs.ensure(lead, { kind: 'codex' });
  cx.send = () => { throw new Error('Signed out.'); };
  const { handedOver } = await pairs.sendGroup(lead, 'Review it.', [], { kinds: ['claude', 'codex', 'gemini'] });
  await tick();
  lead.reply('Looks fine.');
  const gm = await handedOver;
  assert.equal(gm.provider, 'gemini');
  assert.match(gm.sent[0].text, /Looks fine\./);
  assert.ok(lead.buffer.some(e => e.kind === 'handoff' && e.to === 'codex' && e.state === 'skipped'));
  assert.ok(lead.buffer.some(e => e.kind === 'notice' && /Codex couldn’t pick this up: Signed out\./.test(e.text)));
});

test('crew: plan first: a drafter that can’t start doesn’t leave the card spinning; a busy one finishes first', async () => {
  const one = crewSetup({ unavailable: ['gemini'] });
  const lead = one.add(new FakeChat({ sessionId: 'L' }));
  await assert.rejects(one.pairs.planFirst(lead, 'Add saves.', [], { by: 'gemini', kind: 'codex' }), /unavailable/);
  assert.ok(lead.buffer.some(e => e.kind === 'planfirst' && e.state === 'stopped'));

  const two = crewSetup();
  const busy = two.add(new FakeChat({ sessionId: 'B' }));
  busy.state = 'busy';
  await two.pairs.planFirst(busy, 'Add saves.', [], { kind: 'codex' });
  await tick();
  assert.equal(busy.sent.length, 0, 'held');
  busy.reply('Finished the other thing.');
  await tick(); await tick();
  assert.match(busy.sent.at(-1).text, /\(Plan first: /);
  const cx = two.pairs.crewOf(busy).find(c => c.provider === 'codex');
  assert.equal(cx.sent.length, 0, 'the checker waits for the plan itself, not the reply before it');
  busy.reply('1. save.lua');
  await tick(); await tick();
  assert.match(cx.sent.at(-1).text, /Check Claude's plan above/);
});

test('pairs: a copy that hasn’t its own id yet doesn’t take over the original’s partner or what it’s heard', async () => {
  const { pairs, prefs, add, started } = setup();
  prefs.link('L', 'P'); prefs.setHeard('L', at(50000));
  const copy = add(new FakeChat({ sessionId: 'L' }));
  Object.assign(copy, { fork: true, startedAs: 'L' });
  await pairs.ensure(copy);
  assert.deepEqual(started, [null], 'it starts a partner of its own');
  await pairs.send(copy, 'Hello.');
  const heard = prefs.heard('L');
  assert.ok(Date.parse(heard) < Date.now() - 40000, 'the original’s “heard up to” isn’t moved');
});

test('pairs: a copy links its new partner only after receiving its own conversation id', async () => {
  const { pairs, prefs, add } = setup();
  prefs.link('L', 'P');
  const copy = add(new FakeChat({ sessionId: 'L' }));
  Object.assign(copy, { fork: true, startedAs: 'L' });
  const partner = await pairs.ensure(copy);
  assert.equal(prefs.companionOf('L'), 'P', 'starting the copy’s partner leaves the original crew intact');
  assert.equal(prefs.parentOf(partner.sessionId), null, 'the copy is not linked under the original id');
  copy.sessionId = 'COPY';
  pairs.link(copy);
  assert.equal(prefs.companionOf('COPY'), partner.sessionId);
  assert.equal(prefs.parentOf(partner.sessionId), 'COPY');
  assert.equal(prefs.companionOf('L'), 'P');
});

test('pairs: an uninitialized copy does not fall back to the original’s remembered partner history', async () => {
  const { pairs, prefs, add } = setup({ transcripts: { P: [{ kind: 'assistant', at: at(1000), blocks: [{ type: 'text', text: 'Original partner’s unrelated work.' }] }] } });
  prefs.link('L', 'P');
  const copy = add(new FakeChat({ sessionId: 'L' }));
  Object.assign(copy, { fork: true, startedAs: 'L' });
  assert.deepEqual(pairs.matesOf(copy), []);
  await pairs.send(copy, 'A task for the copy.');
  assert.equal(copy.sent[0].text, 'A task for the copy.');
});

test('crew: parallel messages wait for every baseline before any assistant can edit', async () => {
  const { pairs, add } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  const cx = await pairs.ensure(lead, { kind: 'codex' });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  cx.beforeTurn = async () => { await gate; };
  const sending = pairs.sendTogether(lead, 'Claude: code. Codex: art.', [], { kinds: ['claude', 'codex'] });
  try {
    await tick(); await tick();
    assert.equal(lead.sent.length, 0, 'Claude must not edit while Codex’s baseline is still being prepared');
    assert.equal(cx.sent.length, 0);
  } finally { release(); await sending; }
  assert.equal(lead.sent.length, 1); assert.equal(cx.sent.length, 1);
});

test('crew: a reply completed synchronously while sending still hands over', async () => {
  const { pairs, add } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  lead.send = function (...args) { FakeChat.prototype.send.apply(this, args); this.reply('Finished immediately.'); };
  const { handedOver } = await pairs.sendGroup(lead, 'Review it.', [], { kinds: ['claude', 'codex'] });
  await tick();
  const cx = pairs.crewOf(lead).find(c => c.provider === 'codex');
  assert.equal(cx.sent.length, 1, 'a fast result is not lost before the handoff listener attaches');
  assert.equal(await handedOver, cx);
});

test('crew: stopping a busy middle assistant cancels the pending handoff', async () => {
  const { pairs, add } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  const cx = await pairs.ensure(lead, { kind: 'codex' });
  cx.state = 'busy';
  const { handedOver } = await pairs.sendGroup(lead, 'Review it.', [], { kinds: ['claude', 'codex', 'gemini'] });
  lead.reply('Claude’s review.'); await tick();
  cx.interruptedAt = Date.now(); cx.state = 'ready'; cx.emit({ kind: 'result', ok: false });
  await tick();
  assert.equal(cx.sent.length, 0, 'Stop must not immediately start the queued request');
  assert.equal(await handedOver, null);
  assert.equal(pairs.crewOf(lead).find(c => c.provider === 'gemini').sent.length, 0);
});

test('crew: a replacement partner finishes its real reply before the following assistant starts', async () => {
  const { pairs, add } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  const cx = await pairs.ensure(lead, { kind: 'codex' });
  const { handedOver } = await pairs.sendGroup(lead, 'Review it.', [], { kinds: ['claude', 'codex', 'gemini'] });
  cx.end(); cx.turnDone = () => Promise.resolve({ kind: 'ended' });
  lead.reply('Claude’s review.'); await tick(); await tick();
  const replacement = pairs.crewOf(lead).find(c => c.provider === 'codex');
  const gm = pairs.crewOf(lead).find(c => c.provider === 'gemini');
  assert.notEqual(replacement, cx);
  assert.equal(replacement.sent.length, 1);
  assert.equal(gm.sent.length, 0, 'the dead partner’s completion is not the replacement’s answer');
  replacement.reply('Replacement’s review.');
  assert.equal(await handedOver, gm);
  assert.match(gm.sent[0].text, /Replacement’s review\./);
});

test('crew: a remembered partner failing after accepting a request keeps its fresh retry in the same turn', async () => {
  const { pairs, prefs, add } = crewSetup();
  const lead = add(new FakeChat({ provider: 'gemini', sessionId: 'retry-lead' }));
  prefs.link(lead.sessionId, 'remembered-claude', 'claude');
  const old = await pairs.ensure(lead, { kind: 'claude' });
  old.state = 'starting';
  const { handedOver } = await pairs.sendGroup(lead, 'Review the save code.', [], { kinds: ['claude', 'codex'] });
  assert.equal(old.sent.length, 1);
  old.end();
  await tick(); await tick();
  const replacement = pairs.crewOf(lead).find(c => c.provider === 'claude');
  const next = pairs.crewOf(lead).find(c => c.provider === 'codex');
  assert.notEqual(replacement, old);
  assert.equal(replacement.sent.length, 1);
  assert.equal(next.sent.length, 0, 'failed startup must not release the handoff while its retry is answering');
  replacement.reply('The retry found the missing version check.');
  assert.equal(await handedOver, next);
  assert.match(next.sent[0].text, /retry found the missing version check/);
  assert.equal(old.waitingSends.length, 0, 'the failed process no longer retains requests or pictures');
  next.reply('Checked.');
});

test('crew: stopping a fresh startup retry skips the following assistant', async () => {
  const { pairs, prefs, add } = crewSetup();
  const lead = add(new FakeChat({ provider: 'gemini', sessionId: 'stopped-retry-lead' }));
  prefs.link(lead.sessionId, 'remembered-claude', 'claude');
  const old = await pairs.ensure(lead, { kind: 'claude' }); old.state = 'starting';
  const { handedOver } = await pairs.sendGroup(lead, 'Review it.', [], { kinds: ['claude', 'codex'] });
  old.end(); await tick(); await tick();
  const replacement = pairs.crewOf(lead).find(c => c.provider === 'claude');
  replacement.stop();
  assert.equal(await handedOver, null);
  assert.equal(pairs.crewOf(lead).find(c => c.provider === 'codex').sent.length, 0);
});

test('crew: cancelling during remembered-partner replacement cannot restore automation as a user draft', async () => {
  let calls = 0, release;
  const { pairs, prefs, add } = crewSetup({ waitForPartner: kind => {
    if (kind === 'claude' && ++calls === 2) return new Promise(resolve => { release = resolve; });
  } });
  const lead = add(new FakeChat({ provider: 'gemini', sessionId: 'cancel-retry' }));
  prefs.link(lead.sessionId, 'remembered-claude', 'claude');
  const old = await pairs.ensure(lead, { kind: 'claude' }); old.state = 'starting';
  const controller = new AbortController();
  const round = await pairs.sendGroup(lead, 'Automatic check-in', [], { kinds: ['claude', 'codex'], signal: controller.signal });
  old.end(); while (!release) await tick();
  controller.abort(); release();
  assert.equal(await round.handedOver, null); await tick(); await tick();
  assert.equal(lead.buffer.some(e => e.kind === 'unsent'), false);
  const replacement = pairs.crewOf(lead).find(c => c.provider === 'claude');
  assert.notEqual(replacement, old); assert.equal(replacement.sent.length, 0);
  assert.equal(pairs.crewOf(lead).find(c => c.provider === 'codex').sent.length, 0);
  assert.equal(old.waitingSends.length, 0);
});

test('pairs: successful startup releases fallback request data, including pictures', async () => {
  const { pairs, prefs, add } = crewSetup();
  const lead = add(new FakeChat({ provider: 'gemini', sessionId: 'successful-start' }));
  prefs.link(lead.sessionId, 'remembered-claude', 'claude');
  const partner = await pairs.ensure(lead, { kind: 'claude' }); partner.state = 'starting';
  await pairs.send(partner, 'First', [{ data: 'image' }]);
  await pairs.send(partner, 'Second');
  assert.equal(partner.waitingSends.length, 2, 'busy startup still keeps all not-yet-initialized requests');
  partner.reply('Ready.'); await tick();
  assert.equal(partner.waitingSends.length, 0);
});

test('pairs: an initialized remembered partner cannot restart as fresh after its startup events were trimmed', async () => {
  const { pairs, prefs, add, started } = setup();
  const lead = add(new FakeChat({ sessionId: 'trimmed-startup' }));
  prefs.link(lead.sessionId, 'remembered-codex', 'codex');
  const partner = await pairs.ensure(lead);
  partner.startedEvents = true; partner.initialized = true;
  partner.buffer = [{ kind: 'state', state: 'ready' }];
  await pairs.send(partner, 'Continue the existing conversation.');
  assert.equal(partner.waitingSends?.length || 0, 0, 'successful startup must not retain another fallback payload');
  const starts = started.length;
  partner.end(); await tick(); await tick();
  assert.equal(started.length, starts, 'a later exit cannot silently create a fresh replacement');
});

test('pairs: a failed delivery retains undo context for the retry', async () => {
  const { pairs, add } = setup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  lead.undoneFiles = ['save.lua']; lead.partnerUndone = ['menu.lua'];
  lead.send = () => { throw new Error('Pipe closed.'); };
  await assert.rejects(pairs.send(lead, 'Try again.'), /Pipe closed/);
  lead.send = FakeChat.prototype.send;
  await pairs.send(lead, 'Try again.');
  assert.match(lead.sent[0].text, /undid the file changes.*save\.lua/);
  assert.match(lead.sent[0].text, /undid.*menu\.lua/);
  assert.deepEqual(lead.undoneFiles, []); assert.deepEqual(lead.partnerUndone, []);
});

test('crew: a stopped held request is recoverable in full, including its pictures and recipients', async () => {
  const { pairs, add } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L', state: 'busy' }));
  const text = 'Keep the whole request. '.repeat(100), images = [{ mediaType: 'image/png', data: 'test-image' }];
  const { handedOver } = await pairs.sendGroup(lead, text, images, { kinds: ['claude', 'codex'] });
  lead.interruptedAt = Date.now() + 1; lead.state = 'ready'; lead.emit({ kind: 'result', ok: false });
  assert.equal(await handedOver, null);
  const saved = lead.buffer.find(e => e.kind === 'unsent');
  assert.ok(saved, 'the page receives a recoverable request instead of just a clipped notice');
  assert.equal(saved.text, text); assert.deepEqual(saved.images, images);
  assert.equal(saved.request.to, 'group'); assert.deepEqual(saved.request.kinds, ['claude', 'codex']);
});

test('crew: a stopped held plan keeps the original request and picture too', async () => {
  const { pairs, add } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L', state: 'busy' }));
  const images = [{ mediaType: 'image/png', data: 'plan-image' }];
  await pairs.planFirst(lead, 'Plan the new menu.', images, { kind: 'codex' });
  lead.interruptedAt = Date.now() + 1; lead.state = 'ready'; lead.emit({ kind: 'result', ok: false });
  await tick();
  const saved = lead.buffer.find(e => e.kind === 'unsent');
  assert.ok(saved); assert.equal(saved.text, 'Plan the new menu.');
  assert.deepEqual(saved.images, images); assert.equal(saved.request.to, 'plan'); assert.equal(saved.request.kind, 'codex');
});

test('crew: two held rounds stay in order through the last assistant’s answer', async () => {
  const { pairs, add } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L', state: 'busy' }));
  const first = await pairs.sendGroup(lead, 'First request.', [], { kinds: ['claude', 'codex'] });
  const second = await pairs.sendGroup(lead, 'Second request.', [], { kinds: ['claude', 'codex'] });
  lead.reply('Finished the old task.'); await tick(); await tick();
  assert.equal(lead.sent.length, 1, 'only the first queued request starts');
  const cx = pairs.crewOf(lead).find(c => c.provider === 'codex');
  lead.reply('First answer.'); await first.handedOver; await tick();
  assert.equal(lead.sent.length, 1, 'the second round waits for Codex to finish the first');
  cx.reply('First check.'); await tick(); await tick();
  assert.equal(lead.sent.length, 2); assert.ok(lead.sent[1].text.endsWith('Second request.'));
  lead.reply('Second answer.'); await second.handedOver;
  assert.equal(cx.sent.length, 2); cx.reply('Second check.');
});

test('crew: a held plan and a round share the same queue', async () => {
  const { pairs, add } = crewSetup();
  const lead = add(new FakeChat({ sessionId: 'L', state: 'busy' }));
  await pairs.planFirst(lead, 'Plan first.', [], { kind: 'codex' });
  const round = await pairs.sendGroup(lead, 'Review next.', [], { kinds: ['claude', 'codex'] });
  lead.reply('Finished the old task.'); await tick(); await tick();
  assert.equal(lead.sent.length, 1, 'the queued round does not start alongside the plan');
  const cx = pairs.crewOf(lead).find(c => c.provider === 'codex');
  lead.reply('1. Add saves.'); await tick(); await tick();
  assert.equal(cx.sent.length, 1); assert.equal(lead.sent.length, 1);
  cx.reply('Check versioning.'); await tick(); await tick();
  assert.equal(lead.sent.length, 2); assert.ok(lead.sent[1].text.endsWith('Review next.'));
  lead.reply('Review complete.'); await round.handedOver; cx.reply('Checked.');
});

test('crew: stopping a partner that was still opening cancels its handoff and the next queued request', async () => {
  let ready;
  const opening = new Promise(resolve => { ready = resolve; });
  const { pairs, add } = crewSetup({ waitForPartner: () => opening });
  const lead = add(new FakeChat({ sessionId: 'L' }));
  const first = await pairs.sendGroup(lead, 'First request.', [], { kinds: ['claude', 'codex'] });
  const queued = await pairs.sendGroup(lead, 'Keep this queued request.', [], { kinds: ['claude', 'codex'] });
  ready(); await tick();
  const cx = pairs.crewOf(lead).find(c => c.provider === 'codex');
  cx.stop(); lead.reply('First answer.');
  await first.handedOver; await tick();
  assert.equal(lead.sent.length, 1, 'the second request must not restart a crew the user just stopped');
  assert.equal(pairs.crewOf(lead).find(c => c.provider === 'codex'), cx, 'the stopped partner is not reopened for a pending handoff');
  await queued.handedOver;
  assert.ok(lead.buffer.some(e => e.kind === 'unsent' && e.text === 'Keep this queued request.'));
});

test('pairs: Stop during snapshot preparation prevents delivery and releases the unused baseline', async () => {
  const { pairs, add } = setup();
  const lead = add(new FakeChat({ sessionId: 'L' }));
  let entered, resume;
  const started = new Promise(r => { entered = r; }), gate = new Promise(r => { resume = r; });
  lead.snap = { pending: null };
  lead.beforeTurn = async () => { entered(); await gate; lead.snap.pending = { before: 'unused-tree' }; };
  const sending = pairs.send(lead, 'Please do this.');
  await started; lead.interruptedAt = Date.now(); resume();
  await assert.rejects(sending, /stopped/i);
  assert.equal(lead.sent.length, 0);
  assert.equal(lead.snap.pending, null);
});

test('pairs: a send failure releases only its own unused baseline', async () => {
  const { pairs, add } = setup(), lead = add(new FakeChat({ sessionId: 'L' }));
  lead.snap = { pending: null };
  lead.beforeTurn = async () => { lead.snap.pending = { before: 'not-delivered' }; };
  lead.send = () => { throw new Error('offline'); };
  await assert.rejects(pairs.send(lead, 'Try once.'), /offline/);
  assert.equal(lead.snap.pending, null);
  const existing = lead.snap.pending = { before: 'a-running-turn' };
  lead.beforeTurn = async () => {};
  await assert.rejects(pairs.send(lead, 'Try again.'), /offline/);
  assert.equal(lead.snap.pending, existing, 'a different running turn keeps its baseline');
});

test('pairs: a failed concurrent send cannot clear a baseline already used by a successful send', async () => {
  const {pairs,add}=setup(), lead=add(new FakeChat({sessionId:'concurrent-baseline'}));
  lead.snap={pending:null};let resume;
  const gate=new Promise(resolve=>{resume=resolve;});
  lead.beforeTurn=async()=>{await gate;if(!lead.snap.pending)lead.snap.pending={before:'shared'};};
  let sent=0;lead.send=function(...args){if(++sent===2)throw new Error('Second delivery failed.');return FakeChat.prototype.send.apply(this,args);};
  const first=pairs.send(lead,'First.'), second=pairs.send(lead,'Second.');
  await tick();resume();const results=await Promise.allSettled([first,second]);
  assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');
  assert.equal(lead.snap.pending.before,'shared');assert.equal(lead.snap.pending.delivered,true);
});

test('pairs: a stopped wait-until-done send keeps its complete request and recipient', async () => {
  const { pairs, add } = setup(), lead = add(new FakeChat({sessionId:'L'}));
  const cx = await pairs.ensure(lead); cx.state = 'busy';
  const images = [{mediaType:'image/png',data:'keep-me'}];
  await pairs.sendAfter(lead, 'Preserve the whole pending message.', images);
  cx.stop(); await tick();
  const held = lead.buffer.find(e => e.kind === 'unsent');
  assert.equal(lead.sent.length, 0);
  assert.equal(held.text, 'Preserve the whole pending message.');
  assert.deepEqual(held.images, images);
  assert.deepEqual(held.request, {to:'me',kind:'claude'});
});

test('pairs: two wait-until-done sends remain ordered through the recipient replies', async () => {
  const { pairs, add } = setup(), lead = add(new FakeChat({sessionId:'L'}));
  const cx = await pairs.ensure(lead); cx.state = 'busy';
  await pairs.sendAfter(lead, 'First pending request.');
  await pairs.sendAfter(lead, 'Second pending request.');
  cx.reply('Finished.'); await tick(); await tick();
  assert.equal(lead.sent.length, 1);
  lead.reply('First done.'); await tick(); await tick();
  assert.equal(lead.sent.length, 2);
  assert.ok(lead.sent.at(-1).text.endsWith('Second pending request.'));
  lead.reply('Second done.');
});

test('crew: Plan first does not reopen a checker stopped while it was warming up', async () => {
  let ready; const opening = new Promise(resolve => { ready = resolve; });
  const { pairs, add } = crewSetup({waitForPartner:()=>opening});
  const lead = add(new FakeChat({sessionId:'L'}));
  await pairs.planFirst(lead, 'Plan this.'); ready(); await tick();
  const cx = pairs.crewOf(lead).find(c=>c.provider === 'codex');
  cx.stop(); lead.reply('A plan.'); await tick(); await tick();
  assert.equal(pairs.crewOf(lead).find(c=>c.provider === 'codex'), cx);
  assert.equal(lead.buffer.filter(e=>e.kind==='planfirst').at(-1).state, 'stopped');
});
