#!/usr/bin/env node
'use strict';
// Optional long-running orchestration check. No models, real chats or app data are used.
// node --expose-gc tests/soak-crew.js --minutes 60
// Reuses real LiveChat buffers, shared context, preferences and Together queues with synthetic
// providers, exercising mixed turns, parallel work, plans, held messages and Stop over time.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { LiveChat, LIMITS } = require('../lib/chat');
const { createPairs } = require('../lib/pairs');
const { createChatPrefs } = require('../lib/chatprefs');
const { ownText } = require('../lib/shared');

const argv = process.argv.slice(2), option = (key, fallback) => { const at = argv.indexOf(key); return at < 0 ? fallback : argv[at + 1]; };
const minutes = Number(option('--minutes', 1)), pace = Number(option('--pace-ms', 3000));
const imageEvery = Number(option('--image-every', 0));
if (!(minutes > 0 && minutes <= 480 && pace >= 0)) throw new Error('Use --minutes 1..480 and a nonnegative --pace-ms.');
const until = Date.now() + minutes * 60000;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-crew-soak-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const all = new Map(), deliveries = new Map();
const prefs = createChatPrefs({ dataDir: root });
const counters = { scenarios: 0, delivered: 0, recovered: 0, cancelled: 0, largeReplies: 0, imageReplies: 0 };
let next = 0, active = 0, maxActive = 0, peakHeap = 0;

class SyntheticChat extends LiveChat {
  constructor(provider) {
    super({ cfg: {}, account: { id: provider, name: provider }, cwd: root, sessionId: randomUUID() });
    this.provider = provider; this.state = 'ready'; this.timer = null;
  }
  async beforeTurn() {} // git snapshot behavior has separate real-repository tests
  send(text, images = []) {
    assert.equal(this.state, 'ready', `${this.provider} received overlapping turns`);
    const matches = [...ownText(text).matchAll(/\[soak:(\d+)\]/g)];
    const id = matches.length ? Number(matches.at(-1)[1]) : null;
    if (id !== null) {
      const seen = deliveries.get(id) || new Set();
      assert.ok(!seen.has(this.provider), `duplicate request ${id} for ${this.provider}`);
      seen.add(this.provider); deliveries.set(id, seen); counters.delivered++;
    }
    this.emit({ kind: 'user', text, images }); this.setState('busy');
    active++; maxActive = Math.max(maxActive, active);
    this.timer = setTimeout(() => {
      this.timer = null; active--;
      const large = id !== null && id % 61 === 0;
      const answer = large ? 'synthetic detail '.repeat(65536) : `Completed request ${id}.`;
      if (large) counters.largeReplies++;
      this.emit({ kind: 'assistant', mid: randomUUID(), blocks: [{ type: 'text', text: answer }] });
      if (imageEvery > 0 && id !== null && id % imageEvery === 0) {
        const src = 'data:image/png;base64,' + Buffer.alloc(3 * 1024 * 1024, id % 256).toString('base64');
        this.emit({ kind: 'assistant', blocks: [{ type: 'image', src }] }); counters.imageReplies++;
      }
      this.setState('ready'); this.emit({ kind: 'result', ok: true });
    }, 5 + (id === null ? 10 : id % 11));
  }
  finishPriorWork() { this.setState('ready'); this.emit({ kind: 'result', ok: true }); }
  interruptPriorWork() { this.interruptedAt = Date.now(); this.finishPriorWork(); }
  stop() { if (this.timer) { clearTimeout(this.timer); this.timer = null; active--; } this.stopping = true; this.end(0); return this.exited; }
}
const add = provider => { const chat = new SyntheticChat(provider); all.set(chat.key, chat); return chat; };
const chats = { get: key => { const chat = all.get(key); if (!chat) throw new Error('missing chat'); return chat; }, bySession: id => [...all.values()].find(c => c.sessionId === id && c.state !== 'ended') };
const pairs = createPairs({ chats, prefs, transcript: async () => [], startPartner: async (lead, {kind}) => add(kind) });
const lead = add('claude');

async function settle(predicate = () => true) {
  const deadline = Date.now() + 10000;
  do {
    await sleep(2);
    if (!active && [...all.values()].every(c => c.state === 'ready') && predicate()) { await sleep(2); if (!active) return; }
  } while (Date.now() < deadline);
  throw new Error(`orchestration did not settle: ${JSON.stringify([...all.values()].map(c => ({provider:c.provider,state:c.state,waiters:c.turnWaiters.length})))}`);
}
const request = () => { const id = ++next; return { id, text: `Synthetic task, do only your assigned part. [soak:${id}]` }; };
const delivered = (id, providers) => assert.deepEqual([...(deliveries.get(id) || [])].sort(), providers.slice().sort(), `request ${id}`);

async function scenario() {
  const a = request(), type = counters.scenarios % 7;
  if (type === 0) {
    const round = await pairs.sendGroup(lead, a.text, [], {kinds:['claude','codex','gemini']});
    await round.handedOver; await settle(); delivered(a.id, ['claude','codex','gemini']);
  } else if (type === 1) {
    await pairs.sendTogether(lead, a.text, [], {kinds:['claude','codex','gemini']});
    await settle(); delivered(a.id, ['claude','codex','gemini']);
  } else if (type === 2) {
    const from = lead.seq;
    await pairs.planFirst(lead, a.text, [], {by:'gemini',kind:'codex'});
    await settle(() => lead.buffer.some(e => e.seq > from && e.kind === 'planfirst' && e.state === 'ready'));
    delivered(a.id, ['gemini','codex']);
  } else if (type === 3) {
    const cx = pairs.crewOf(lead).find(c=>c.provider==='codex'), b = request();
    cx.setState('busy');
    await pairs.sendAfter(lead, a.text); await pairs.sendAfter(lead, b.text);
    cx.finishPriorWork();
    await settle(() => deliveries.has(b.id)); delivered(a.id, ['claude']); delivered(b.id, ['claude']);
  } else if (type === 4) {
    lead.setState('busy');
    const from = lead.seq;
    const held = await pairs.sendGroup(lead, a.text, [{mediaType:'image/png',data:'synthetic-image'}], {kinds:['claude','codex']});
    lead.interruptPriorWork(); await held.handedOver; await settle();
    delivered(a.id, []);
    const recovered = lead.buffer.find(e=>e.seq>from && e.kind==='unsent' && e.text===a.text);
    assert.ok(recovered); assert.equal(recovered.images[0].data,'synthetic-image'); counters.recovered++;
  } else if (type === 5) {
    const controller = new AbortController();
    const round = await pairs.sendGroup(lead, a.text, [], {kinds:['claude','codex','gemini'],signal:controller.signal});
    controller.abort(); await round.handedOver; await settle();
    delivered(a.id, ['claude']); assert.deepEqual(round.delivered.map(c => c.provider), ['claude']); counters.cancelled++;
  } else {
    const controller = new AbortController(); lead.setState('busy');
    const round = await pairs.sendGroup(lead, a.text, [], {kinds:['claude','codex'],signal:controller.signal});
    controller.abort(); await round.handedOver; lead.finishPriorWork(); await settle();
    delivered(a.id, []); assert.deepEqual(round.delivered, []); counters.cancelled++;
  }
  counters.scenarios++;
  for (const chat of all.values()) {
    assert.equal(chat.turnWaiters.length, 0, `${chat.provider} leaked a turn observer`);
    assert.ok(chat.buffer.length <= 5000);
    assert.ok(chat.replayBytes - chat.recoveryBytes <= LIMITS.bufferBytes, `${chat.provider} exceeded its ordinary replay budget`);
  }
  assert.equal(all.size, 3, 'the crew remains three conversations');
  // Only the current scenario needs this bookkeeping; a growing test-side history would hide leaks.
  deliveries.clear();
}

function report(state) {
  if (global.gc) global.gc();
  const heap = process.memoryUsage().heapUsed / 1048576;
  peakHeap = Math.max(peakHeap, heap);
  console.log(JSON.stringify({at:new Date().toISOString(),state,...counters,maxActive,heapMiB:+heap.toFixed(1),peakHeapMiB:+peakHeap.toFixed(1),buffers:[...all.values()].map(c=>c.buffer.length),replayMiB:[...all.values()].map(c=>+(c.replayBytes/1048576).toFixed(1))}));
  assert.ok(heap < 512, `retained heap exceeded a conservative 512 MiB budget: ${heap}`);
}

(async () => {
  try {
    await pairs.ensure(lead,{kind:'codex'}); await pairs.ensure(lead,{kind:'gemini'});
    report('starting'); let lastReport = Date.now();
    while (Date.now() < until) {
      await scenario();
      if (Date.now() - lastReport >= 60000) { report('running'); lastReport = Date.now(); }
      if (pace) await sleep(Math.min(pace, Math.max(0, until - Date.now())));
    }
    report('passed');
  } catch (err) { report('failed'); console.error(err.stack); process.exitCode = 1; }
  finally { for (const chat of all.values()) chat.stop(); fs.rmSync(root, {recursive:true,force:true}); }
})();
