'use strict';
// Codex's connection (lib/codex.js): its messages are read as bytes, so one too big to read is
// skipped instead of cutting the app off from Codex, and a chat's history that's too big to read at
// once comes in fewer turns at a time.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { jsonLines, CodexServer, createCodex } = require('../lib/codex');

test('codex: an old initialization failure cannot close or reset its replacement connection', async t => {
  const sys = require('../lib/system'), children = [];
  t.mock.method(sys, 'killTree', () => {});
  t.mock.method(sys, 'spawnCodex', () => {
    const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter();
    p.stdin = new EventEmitter(); p.stdin.writable = true; p.sent = [];
    p.stdin.write = text => { p.sent.push(JSON.parse(text)); return true; };
    p.stdin.end = () => { p.stdin.writable = false; };
    children.push(p); return p;
  });
  const server = new CodexServer({}), first = server.start(); first.catch(() => {});
  let replacement;
  server.listeners.add({onDied: () => { replacement = server.start(); replacement.catch(() => {}); }});
  t.after(() => { server.listeners.clear(); server.died(new Error('test cleanup')); });
  server.died(new Error('first initialization failed'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(children.length, 2);
  assert.equal(children[1].stdin.writable, true, 'the failed first attempt must not close its successor');
  assert.equal(server.ready, replacement, 'an old rejection must not clear the current readiness promise');
  const init = children[1].sent.find(m => m.method === 'initialize');
  children[1].stdout.emit('data', Buffer.from(JSON.stringify({id:init.id,result:{serverInfo:'replacement'}}) + '\n'));
  await replacement;
  assert.equal(server.info.serverInfo, 'replacement');
  await assert.rejects(first, /first initialization failed/);
  const notices = [];
  server.listeners.add({onNotify: (method) => notices.push(method)});
  children[0].stdout.emit('data', Buffer.from('{"method":"thread/stale-notification"}\n'));
  children[0].stderr.emit('data', Buffer.from('stale error from the old process'));
  assert.deepEqual(notices, []);
  assert.doesNotMatch(server.stderr, /stale error/);
});

test('codex: messages are read line by line; one too long is skipped, and the ones after it still arrive', () => {
  const stream = new EventEmitter(), lines = [], long = [];
  jsonLines(stream, l => lines.push(l), (head, size) => long.push({ head, size }), 100);
  const big = `{"id":7,"result":"${'x'.repeat(300)}"}`;
  // Split anywhere, the way a pipe hands them over.
  const all = Buffer.from(`{"id":1,"result":"ok"}\n${big}\n{"id":2,"result":"é"}\n{"method":"turn/started"}`);
  stream.emit('data', Buffer.alloc(0));   // an empty piece is nothing
  let i = 0;
  for (const n of [5, 25, 30, 140, 150, 50, 13]) { stream.emit('data', all.subarray(i, i + n)); i += n; }
  stream.emit('data', all.subarray(i));
  stream.emit('end');
  assert.deepEqual(lines, ['{"id":1,"result":"ok"}', '{"id":2,"result":"é"}', '{"method":"turn/started"}'], 'the ones before and after, whole (even a character split between pieces)');
  assert.equal(long.length, 1, 'the long one is noted once, not once per piece');
  assert.match(long[0].head, /^\{"id":7,/); assert.equal(long[0].size, big.length);
});

test('codex: an answer too big to read fails its own request at once, saying so', async () => {
  const logs = [], s = new CodexServer({}, m => logs.push(m));
  const p = new Promise((resolve, reject) => s.waiting.set(7, { resolve, reject, timer: setTimeout(() => reject(new Error('timed out')), 5000), method: 'thread/turns/list' }));
  s.tooLong('{"id":7,"result":{"data":[', 700 * 1048576);
  await assert.rejects(p, e => e.tooBig === true && /too big to read/.test(e.message));
  assert.equal(s.waiting.size, 0);
  assert.match(logs[0], /700 MB was too big to read \(the answer to thread\/turns\/list\)/);
  s.tooLong('{"method":"item/completed","params":', 200 * 1048576);
  assert.match(logs[1], /200 MB was too big to read; skipped it/, 'a notification is only noted');
});

test('codex: a chat’s history too big for twelve turns comes three, then one, at a time, and that chat remembers', async () => {
  const real = CodexServer.prototype.request, asked = [];
  CodexServer.prototype.request = async function (method, params) {
    asked.push(`${params.limit}/${params.itemsView}${params.cursor ? `@${params.cursor}` : ''}`);
    if (params.limit > 1) throw Object.assign(new Error('Codex’s answer was too big to read at once.'), { tooBig: true });
    return { data: [{ id: `turn-${asked.length}`, startedAt: 1, items: [] }], nextCursor: 'older' };
  };
  try {
    const codex = createCodex({ getConfig: () => ({ prefs: { cleanEnv: false }, codex: { enabled: true } }), chats: {}, usage: {} });
    const h = await codex.history('t-pictures');
    assert.deepEqual(asked, ['12/full', '3/full', '1/full'], 'fewer turns each time, every step still included');
    assert.equal(h.cursor, 'older', 'the rest come with Earlier');
    await codex.history('t-pictures', 'older');
    assert.equal(asked.at(-1), '1/full@older', 'Earlier starts at the size that worked');
    assert.equal(asked.length, 4);
    await codex.history('t-other');
    assert.equal(asked[4], '12/full', 'another chat starts at twelve again');
  } finally { CodexServer.prototype.request = real; }
});

const fs = require('fs'), os = require('os'), path = require('path');
const { createLog } = require('../lib/logger');
test('log: the same message thousands of times is written once, then how many more times; others as they come', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-log-')), 'switcher.log');
  let t = Date.parse('2026-10-29T00:55:00Z');
  const log = createLog(file, { echo: false, now: () => t });
  log('Codex: a message of 700 MB was too big to read; skipped it.');
  for (let i = 0; i < 3452; i++) { t += 10; log('Codex: a message of 700 MB was too big to read; skipped it.'); }
  log('Error on GET /api/chat/history: something else');
  t += 61e3; log('Error on GET /api/chat/history: something else');
  log.flush();
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  assert.equal(lines.length, 4, lines.join('\n'));
  assert.match(lines[0], /too big to read/);
  assert.match(lines[1], /\(the message above, 3452 more times\)/);
  assert.match(lines[2], /something else/);
  assert.match(lines[3], /something else/, 'a minute on, a repeat is written again');
});

test('codex: a message isn’t sent until its conversation has answered: a copy’s id is the original’s until then', () => {
  const { CodexChat } = require('../lib/codex');
  const asked = [];
  const chat = { threadReady: false, turnId: null, turnStarting: false, queue: [[{ type: 'text', text: 'hi' }]], sessionId: 'the-original', state: 'busy', permissionMode: 'full', waitForSnapshot: () => false, srv: { request: (m, p) => { asked.push([m, p]); return new Promise(() => {}); } } };
  CodexChat.prototype.flush.call(chat);
  assert.deepEqual(asked, [], 'held, though sending has moved it on to busy');
  chat.threadReady = true; chat.sessionId = 'the-copy';
  CodexChat.prototype.flush.call(chat);
  assert.equal(asked[0][0], 'turn/start');
  assert.equal(asked[0][1].threadId, 'the-copy');
});

test('codex: Stop while a reply is still starting stops it as soon as there’s something to stop', async () => {
  const { CodexChat } = require('../lib/codex');
  const chat = { turnId: null, turnStarting: true, queue: [[{ type: 'text', text: 'also this' }]] };
  await CodexChat.prototype.interrupt.call(chat);
  assert.equal(chat.stopOnceStarted, true);
  assert.deepEqual(chat.queue, [], 'what was waiting to go is dropped too');
});

const nextTick = () => new Promise(resolve => setImmediate(resolve));
function pendingCodex(t, cwd = process.cwd()) {
  const { CodexChat } = require('../lib/codex');
  let resolveThread;
  const requests = [], turns = [];
  const srv = { listeners: new Set(), request(method, params) {
    requests.push({method,params});
    if (method === 'thread/start') return new Promise(resolve => { resolveThread = resolve; });
    if (method === 'turn/start') return new Promise((resolve,reject) => turns.push({resolve,reject,params}));
    return Promise.resolve({});
  }};
  const chat = new CodexChat({cfg:{},account:{id:'test',name:'Test'},cwd,
    codex:{server:()=>srv,models:async()=>[{value:'fake',efforts:[]}]}});
  chat.beforeTurn = async()=>{};
  t.after(()=>chat.stop());
  chat.start();
  return {chat,requests,turns,ready:()=>resolveThread({thread:{id:'synthetic-thread'}})};
}

test('codex: Stop before its conversation opens recovers a Together request and releases the next round', {timeout:5000}, async t => {
  const {createPairs}=require('../lib/pairs'), {LiveChat}=require('../lib/chat');
  const {chat,ready,turns}=pendingCodex(t), all=new Map([[chat.key,chat]]);
  const pairs=createPairs({chats:{get:key=>all.get(key),bySession:()=>null},
    prefs:{companionOf:()=>null,crewOf:()=>({}),parentOf:()=>null,link:()=>{},heard:()=>null,setHeard:()=>{}},
    transcript:async()=>[],startPartner:async()=>{
      const mate=new LiveChat({cfg:{},account:{id:'test',name:'Test'},cwd:process.cwd(),sessionId:'fake-claude'});
      mate.state='ready'; mate.beforeTurn=async()=>{};
      mate.send=()=>{mate.emit({kind:'result',ok:true});}; all.set(mate.key,mate); return mate;
    }});
  const images=[{mediaType:'image/png',data:'aGVsbG8='}];
  const first=await pairs.sendBoth(chat,'The original brief.',images);
  await chat.interrupt();
  assert.equal(await first.handedOver,null);
  assert.equal(chat.turnWaiters.length,0);
  const recovered=chat.buffer.find(e=>e.kind==='unsent');
  assert.equal(recovered.text,'The original brief.'); assert.deepEqual(recovered.images,images);
  assert.deepEqual(recovered.request,{to:'group',kinds:['codex','claude'],how:'turns'});
  ready(); await nextTick(); await nextTick();
  const second=await pairs.sendBoth(chat,'The next brief.');
  assert.equal(turns.length,1,'the cancelled first brief never starts');
  assert.ok(turns[0].params.input[0].text.endsWith('The next brief.'));
  turns[0].resolve({turn:{id:'turn-next'}}); await nextTick();
  chat.onNotify('turn/completed',{turn:{id:'turn-next',status:'completed'}});
  await second.handedOver;
});

test('codex: closing during thread startup does not initialize or send afterwards', async t => {
  const {chat,ready,requests}=pendingCodex(t);
  chat.send('Do not send after close.'); chat.stop(); ready(); await nextTick();
  assert.equal(chat.state,'ended');
  assert.equal(chat.buffer.some(e=>e.kind==='init'),false);
  assert.equal(requests.some(r=>r.method==='turn/start'),false);
  assert.ok(requests.some(r=>r.method==='thread/unsubscribe' && r.params.threadId==='synthetic-thread'));
});

test('codex: closing during turn startup interrupts a late accepted turn and never sends the queued message', async t => {
  for(const rejected of [false,true]) {
    const {chat,ready,requests,turns}=pendingCodex(t);
    ready(); await nextTick(); chat.send('First request.'); chat.send('Queued request.');
    chat.stop();
    if(rejected) turns[0].reject(new Error('late failure'));
    else turns[0].resolve({turn:{id:'late-turn'}});
    await nextTick();
    assert.equal(chat.state,'ended'); assert.equal(turns.length,1);
    if(!rejected) assert.ok(requests.some(r=>r.method==='turn/interrupt'&&r.params.turnId==='late-turn'));
  }
});

test('codex: queued work waits for the previous reply snapshot without delaying its visible result', async t => {
  const {chat,ready,turns}=pendingCodex(t); ready(); await nextTick();
  chat.send('First.'); turns[0].resolve({turn:{id:'first'}}); await nextTick();
  chat.send('Queued second.');
  let finish;chat.snap.pending={before:'before',top:process.cwd()};chat.compareSnapshot=()=>new Promise(resolve=>{finish=resolve;});
  chat.onNotify('turn/completed',{turn:{id:'first',status:'completed'}});
  assert.ok(chat.buffer.some(e=>e.kind==='result'&&e.ok));assert.equal(turns.length,1);
  finish();await nextTick();
  assert.equal(turns.length,2);assert.ok(turns[1].params.input[0].text.endsWith('Queued second.'));
  turns[1].resolve({turn:{id:'second'}});await nextTick();
});

test('codex: a fast completed reply cannot be revived by its late start response', async t => {
  for (const responseFirst of [true, false]) {
    const {chat,ready,turns}=pendingCodex(t);ready();await nextTick();
    chat.send('First.');chat.send('Queued second.');
    if(responseFirst)turns[0].resolve({turn:{id:'fast-first'}});
    chat.onNotify('turn/started',{turn:{id:'fast-first'}});
    chat.onNotify('turn/completed',{turn:{id:'fast-first',status:'completed'}});
    if(!responseFirst)turns[0].resolve({turn:{id:'fast-first'}});
    await nextTick();
    assert.equal(turns.length,2,'the queued message starts after the completed reply');
    turns[1].resolve({turn:{id:'second'}});await nextTick();
    chat.onNotify('turn/started',{turn:{id:'fast-first'}});
    chat.onNotify('turn/completed',{turn:{id:'fast-first',status:'completed'}});
    assert.equal(chat.turnId,'second','old duplicate notifications leave the current reply alone');
    assert.equal(chat.buffer.filter(e=>e.kind==='result').length,1);
    chat.onNotify('turn/completed',{turn:{id:'second',status:'completed'}});
    assert.equal(chat.turnId,null);assert.equal(chat.state,'ready');
  }
});

test('codex: a queued reply gets its own fresh baseline and Undo preserves the prior reply', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ss-queued-baseline-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  require('child_process').execFileSync('git',['init','-q',root],{windowsHide:true});
  const file=path.join(root,'story.md');fs.writeFileSync(file,'original');
  const {chat,ready,turns}=pendingCodex(t,root);delete chat.beforeTurn;
  ready();await nextTick();await chat.beforeTurn();chat.send('First edit.');
  turns[0].resolve({turn:{id:'first'}});await nextTick();fs.writeFileSync(file,'first edit');
  await chat.beforeTurn();chat.send('Second edit after that.');
  chat.onNotify('turn/completed',{turn:{id:'first',status:'completed'}});
  const until=Date.now()+15000;
  while(turns.length<2&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(turns.length,2);assert.ok(chat.snap.pending,'second reply owns a baseline');
  turns[1].resolve({turn:{id:'second'}});await nextTick();fs.writeFileSync(file,'second edit');
  chat.onNotify('turn/completed',{turn:{id:'second',status:'completed'}});await chat.afterTurn();
  assert.equal(chat.snap.turns.length,2);
  assert.deepEqual((await chat.undoTurn(1)).restored,['story.md']);
  assert.equal(fs.readFileSync(file,'utf8'),'first edit');
});

test('codex: Stop during queued preparation recovers that message and a later send prepares afresh', async t => {
  const {chat,ready,turns}=pendingCodex(t);ready();await nextTick();
  chat.send('First.');turns[0].resolve({turn:{id:'first'}});await nextTick();chat.send('Cancel this queued message.');
  const preparations=[];chat.beforeTurn=()=>new Promise(resolve=>preparations.push(resolve));
  chat.onNotify('turn/completed',{turn:{id:'first',status:'completed'}});
  assert.equal(preparations.length,1);assert.equal(chat.queue.length,1);
  await chat.interrupt();
  assert.ok(chat.buffer.some(e=>e.kind==='unsent'&&e.text==='Cancel this queued message.'));
  chat.send('New request after Stop.');preparations[0]();await nextTick();
  assert.equal(preparations.length,2,'a cancelled preparation is not reused');assert.equal(turns.length,1);
  preparations[1]();await nextTick();assert.equal(turns.length,2);
  assert.equal(turns[1].params.input[0].text,'New request after Stop.');
  turns[1].resolve({turn:{id:'next'}});await nextTick();
});

test('codex: a late refused steer prepares its fallback as a new reply', async t => {
  const {chat,ready,turns}=pendingCodex(t);ready();await nextTick();
  chat.send('First.');turns[0].resolve({turn:{id:'first'}});await nextTick();
  const request=chat.srv.request.bind(chat.srv);let refuse;
  chat.srv.request=(method,params)=>method==='turn/steer'?new Promise((resolve,reject)=>{refuse=reject;}):request(method,params);
  chat.steer('Fallback message.');chat.onNotify('turn/completed',{turn:{id:'first',status:'completed'}});
  const prepared=[];chat.beforeTurn=async options=>{prepared.push(options);};
  refuse(new Error('turn already ended'));await nextTick();
  assert.deepEqual(prepared,[{queued:true}]);assert.equal(turns.length,2);
  assert.equal(turns[1].params.input[0].text,'Fallback message.');
  turns[1].resolve({turn:{id:'fallback'}});await nextTick();
});

test('codex: a refused steer arriving after Stop is recovered instead of restarting work', async t => {
  const {chat,ready,turns}=pendingCodex(t);ready();await nextTick();
  chat.send('First.');turns[0].resolve({turn:{id:'first'}});await nextTick();
  const request=chat.srv.request.bind(chat.srv);let refuse;
  chat.srv.request=(method,params)=>method==='turn/steer'?new Promise((resolve,reject)=>{refuse=reject;}):request(method,params);
  chat.steer('Cancelled instruction.');await chat.interrupt();
  chat.onNotify('turn/completed',{turn:{id:'first',status:'interrupted'}});
  refuse(new Error('turn ended'));await nextTick();
  assert.equal(turns.length,1,'Stop cannot be followed by a late fallback turn');
  assert.equal(chat.queue.length,0);
  assert.ok(chat.buffer.some(e=>e.kind==='unsent'&&e.text==='Cancelled instruction.'));
});

test('codex: a chat’s thread starts with its subagents (roles in config, what Codex is told), and without them when there are none', async t => {
  const { CodexChat } = require('../lib/codex');
  const open = extras => {
    const requests = [];
    const srv = { listeners: new Set(), request(method, params) { requests.push({ method, params }); return method === 'thread/start' ? new Promise(() => {}) : Promise.resolve({}); } };
    const chat = new CodexChat({ cfg: {}, account: { id: 'test', name: 'Test' }, cwd: process.cwd(), codex: { server: () => srv, models: async () => [], threadExtras: () => extras } });
    chat.beforeTurn = async () => {};
    t.after(() => chat.stop());
    chat.start();
    return requests.find(r => r.method === 'thread/start').params;
  };
  const p = open({ config: { 'agents.cx.description': 'Codex checks', 'agents.cx.config_file': 'C:/x/cx.toml' }, note: 'Sub-agents: use cx.' });
  assert.deepEqual(p.config, { 'agents.cx.description': 'Codex checks', 'agents.cx.config_file': 'C:/x/cx.toml' });
  assert.equal(p.developerInstructions, 'Sub-agents: use cx.');
  const none = open({ config: {}, note: '' });
  assert.equal(none.config, undefined);
  assert.equal(none.developerInstructions, undefined);
});
