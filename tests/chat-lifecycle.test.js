'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { LiveChat } = require('../lib/chat');
const snapshots = require('../lib/snapshots');

function chat(cwd = process.cwd()) {
  return new LiveChat({ cfg: {}, account: { id: 'test', name: 'Test' }, cwd, log: () => {} });
}

test('chat lifecycle: a stalled viewer disconnects without interrupting a healthy viewer or losing replay', () => {
  const c = chat(), received = [];
  let destroyed = false;
  const slow = { writableLength: 17 * 1024 * 1024, behindSince: Date.now() - 31000,
    write() { assert.fail('a stalled client must not accumulate more output'); }, destroy() { destroyed = true; } };
  const healthy = { writableLength: 0, write(data) { received.push(data); } };
  c.clients.add(slow); c.clients.add(healthy);
  c.emit({ kind: 'assistant', blocks: [{type:'text',text:'The reply is preserved.'}] });
  assert.equal(destroyed, true);
  assert.equal(c.clients.has(slow), false);
  assert.equal(c.clients.has(healthy), true);
  assert.equal(received.length, 1);
  assert.equal(c.buffer.at(-1).blocks[0].text, 'The reply is preserved.');
});

test('chat lifecycle: cancelling a turn observer removes it without consuming the next result', async () => {
  const c = chat(), controller = new AbortController();
  c.state = 'ready';
  const cancelled = c.turnDone(controller.signal);
  const next = c.turnDone();
  assert.equal(c.turnWaiters.length, 2);
  controller.abort();
  assert.deepEqual(await cancelled, { kind: 'cancelled' });
  assert.equal(c.turnWaiters.length, 1);
  c.emit({ kind: 'result', ok: true });
  assert.equal((await next).ok, true);
  assert.equal(c.turnWaiters.length, 0);
});

test('chat lifecycle: ended or already-cancelled observers do not leave listeners behind', async () => {
  const c = chat(), controller = new AbortController();
  controller.abort();
  assert.deepEqual(await c.turnDone(controller.signal), { kind: 'cancelled' });
  c.state = 'ended';
  assert.deepEqual(await c.turnDone(), { kind: 'ended' });
  assert.equal(c.turnWaiters.length, 0);
});

test('chat lifecycle: a parallel group shares a repository baseline, including a newly starting partner', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-group-baseline-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', dir], { windowsHide: true });
  fs.writeFileSync(path.join(dir, 'save.lua'), 'return 1\n');
  const a = chat(dir), b = chat(dir), c = chat(dir);
  a.state = 'ready'; b.state = 'ready'; c.state = 'starting';
  const shared = new Map(), original = snapshots.snapshot;
  let calls = 0;
  snapshots.snapshot = async (...args) => { calls++; return original(...args); };
  t.after(() => { snapshots.snapshot = original; });
  await Promise.all([a, b, c].map(x => x.beforeTurn({ snapshots: shared })));
  assert.equal(calls, 1, 'the group only reads and hashes the repository once');
  assert.ok(a.snap.pending.before);
  assert.equal(a.snap.pending.before, b.snap.pending.before);
  assert.equal(a.snap.pending.before, c.snap.pending.before);
  fs.writeFileSync(path.join(dir, 'save.lua'), 'return 2\n');
  const changed = await original(dir);
  assert.deepEqual((await snapshots.changes(dir, a.snap.pending.before, changed)).map(f => f.path), ['save.lua']);
});

test('chat lifecycle: text changes and Undo survive reopening and a parent folder becoming Git', async t => {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'ss-shadow-lifecycle-')), root=path.join(base,'project'), data=path.join(base,'data');
  fs.mkdirSync(root); const file=path.join(root,'story.md'); fs.writeFileSync(file,'before\r\n');
  const extras=require('../lib/extras').createExtras({dir:path.join(base,'extras')});
  snapshots.configure({dataDir:data,attributes:async paths=>paths.map(()=>0)});
  t.after(async()=>{await snapshots.configure({});fs.rmSync(base,{recursive:true,force:true});});
  const c=new LiveChat({cfg:{},account:{id:'test',name:'Test'},cwd:root,sessionId:'shadow-lifecycle',extras}); c.state='ready';
  await snapshots.snapshot(root,{shadow:true,fresh:true}); // cold work is allowed to outlast a send's deadline
  await c.beforeTurn(); assert.ok(c.snap.pending); assert.equal(snapshots.isShadow(c.snap.pending.before),true);
  fs.writeFileSync(file,'after\r\n'); await c.afterTurn();
  const event=c.buffer.find(e=>e.kind==='changes'); assert.equal(event.scope,'text'); assert.equal(event.files[0].path,'story.md');
  assert.equal(extras.turns(c.sessionId)[0].top,root);
  execFileSync('git',['init','-q',base],{windowsHide:true}); fs.writeFileSync(path.join(base,'.gitignore'),'data/\nextras/\n');
  const reopened=new LiveChat({cfg:{},account:{id:'test',name:'Test'},cwd:root,sessionId:c.sessionId,extras}); reopened.state='ready';
  await reopened.beforeTurn(); assert.equal(reopened.snap.top,base); assert.equal(snapshots.isShadow(reopened.snap.pending.before),false);
  reopened.clearPendingSnapshot();
  assert.match(await reopened.turnDiff(0,'story.md'),/-before/);
  assert.deepEqual((await reopened.undoTurn(0)).restored,['story.md']);
  assert.equal(fs.readFileSync(file,'utf8'),'before\r\n');
  assert.equal(fs.existsSync(path.join(root,'.git')),false,'the project only joins the real parent repository');
});

test('chat lifecycle: a late text baseline is skipped for every parallel recipient and never installed after send', {timeout:6000}, async t => {
  const original={targetOf:snapshots.targetOf,snapshot:snapshots.snapshot,warm:snapshots.warm}; let finish,calls=0;
  snapshots.warm=()=>{}; snapshots.targetOf=async cwd=>({top:cwd,shadow:true});
  snapshots.snapshot=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
  t.after(()=>Object.assign(snapshots,original));
  const a=chat(),b=chat(); a.state='ready';b.state='starting';const group=new Map();
  const started=Date.now();await Promise.all([a.beforeTurn({snapshots:group}),b.beforeTurn({snapshots:group})]);
  assert.ok(Date.now()-started<3500);assert.equal(calls,1);assert.equal(a.snap.pending,null);assert.equal(b.snap.pending,null);
  finish('shadow:v1:late:late');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(a.snap.pending,null);assert.equal(b.snap.pending,null);
});

test('chat lifecycle: simultaneous preparations share one baseline and a late one cannot replace running work', async t => {
  const original={targetOf:snapshots.targetOf,snapshot:snapshots.snapshot,warm:snapshots.warm,pin:snapshots.pin};
  let finish,calls=0;const pins=[];
  snapshots.warm=()=>{};snapshots.targetOf=async cwd=>({top:cwd,shadow:false});
  snapshots.snapshot=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};snapshots.pin=ref=>pins.push(ref);
  t.after(()=>Object.assign(snapshots,original));
  const c=chat(); c.state='starting';const one=c.beforeTurn(),two=c.beforeTurn();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
  finish('shared-baseline');await Promise.all([one,two]);
  assert.deepEqual(pins,['shared-baseline']);assert.equal(c.snap.pending.before,'shared-baseline');
  c.clearPendingSnapshot();c.state='ready';const late=c.beforeTurn();await new Promise(resolve=>setImmediate(resolve));
  c.state='busy';finish('too-late');await late;
  assert.equal(c.snap.pending,null);assert.deepEqual(pins,['shared-baseline']);
});

test('chat lifecycle: final snapshot gates only its own completion observers and later sends', async t => {
  const c=chat(); c.state='ready'; c.snap.pending={before:'before',top:process.cwd()};
  let finish,compared=0,resumed=0; const capture=new Promise(resolve=>{finish=resolve;});
  c.compareSnapshot=()=>{compared++;return capture;};
  const first=c.turnDone(), controller=new AbortController(), cancelled=c.turnDone(controller.signal);
  let completed=false;first.then(()=>{completed=true;});
  c.emit({kind:'result',ok:true});
  assert.ok(c.buffer.some(e=>e.kind==='result'),'the page receives completion without waiting for disk');
  assert.equal(c.snap.pending,null);assert.equal(compared,1);assert.equal(c.turnWaiters.length,0);
  assert.equal(c.waitForSnapshot(()=>{resumed++;}),true);assert.equal(c.waitForSnapshot(()=>{resumed++;}),true);
  const later=c.turnDone();let laterDone=false;later.then(()=>{laterDone=true;});
  controller.abort();assert.equal((await cancelled).kind,'cancelled');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(completed,false);
  finish();await first;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(resumed,1);assert.equal(laterDone,false,'a later observer cannot receive the prior completion');
  c.emit({kind:'result',ok:true});await later;
});

test('chat lifecycle: snapshot failure releases the round and closing prevents a deferred provider flush', async () => {
  const c=chat();c.state='ready';c.snap.pending={before:'before',top:process.cwd()};
  let reject; c.compareSnapshot=()=>new Promise((resolve,no)=>{reject=no;});
  const done=c.turnDone();c.emit({kind:'result',ok:true});
  let resumed=false;c.waitForSnapshot(()=>{resumed=true;});c.state='ended';
  reject(new Error('disk unavailable'));assert.equal((await done).ok,true);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(resumed,false);
});

test('chat lifecycle: individual Undo cannot roll back another parallel assistant when command ownership is unknown', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ss-shared-undo-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));execFileSync('git',['init','-q',root],{windowsHide:true});
  for(const file of ['a.txt','b.txt'])fs.writeFileSync(path.join(root,file),'before');
  const a=chat(root),b=chat(root);a.state='ready';b.state='ready';const shared=new Map();
  await Promise.all([a.beforeTurn({snapshots:shared}),b.beforeTurn({snapshots:shared})]);
  a.emit({kind:'assistant',blocks:[{type:'tool',name:'Bash',summary:'write a.txt'}]});
  b.emit({kind:'assistant',blocks:[{type:'tool',name:'Bash',summary:'write b.txt'}]});
  fs.writeFileSync(path.join(root,'a.txt'),'A work');fs.writeFileSync(path.join(root,'b.txt'),'B work');
  a.emit({kind:'result',ok:true});b.emit({kind:'result',ok:true});await Promise.all([a.afterTurn(),b.afterTurn()]);
  assert.ok(a.buffer.find(e=>e.kind==='changes').shared);
  const undone=await a.undoTurn(0,true);assert.deepEqual(undone.restored,[]);assert.equal(undone.skipped.length,2);
  assert.equal(fs.readFileSync(path.join(root,'b.txt'),'utf8'),'B work');
  assert.match(await a.turnDiff(0,'a.txt'),/A work/,'diffs remain available for shared work');
});

test('chat lifecycle: explicit separate parallel edits keep their own individual Undo', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ss-known-parallel-undo-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));execFileSync('git',['init','-q',root],{windowsHide:true});
  for(const file of ['a.txt','b.txt'])fs.writeFileSync(path.join(root,file),'before');
  const a=chat(root),b=chat(root);a.state='ready';b.state='ready';const shared=new Map();
  await Promise.all([a.beforeTurn({snapshots:shared}),b.beforeTurn({snapshots:shared})]);
  a.emit({kind:'assistant',blocks:[{type:'tool',name:'Edit',meta:{path:path.join(root,'a.txt')}}]});
  b.emit({kind:'assistant',blocks:[{type:'tool',name:'Edit',meta:{path:path.join(root,'b.txt')}}]});
  fs.writeFileSync(path.join(root,'a.txt'),'A work');fs.writeFileSync(path.join(root,'b.txt'),'B work');
  await Promise.all([a.afterTurn(),b.afterTurn()]);
  assert.deepEqual((await a.undoTurn(0)).restored,['a.txt']);
  assert.equal(fs.readFileSync(path.join(root,'a.txt'),'utf8'),'before');assert.equal(fs.readFileSync(path.join(root,'b.txt'),'utf8'),'B work');
});

test('chat lifecycle: Undo distinguishes the same filename in different folders', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ss-distinct-undo-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));execFileSync('git',['init','-q',root],{windowsHide:true});
  fs.mkdirSync(path.join(root,'nested'));
  const manual=path.join(root,'index.txt'),owned=path.join(root,'nested','index.txt');
  fs.writeFileSync(manual,'original root');fs.writeFileSync(owned,'original nested');
  const c=chat(root);c.state='ready';await c.beforeTurn();
  c.emit({kind:'assistant',blocks:[{type:'tool',name:'Edit',meta:{path:owned}}]});
  fs.writeFileSync(manual,'user work');fs.writeFileSync(owned,'assistant work');await c.afterTurn();
  assert.equal(c.snap.turns[0].files.find(f=>f.path==='index.txt').meanwhile,true);
  assert.deepEqual((await c.undoTurn(0)).restored,['nested/index.txt']);
  assert.equal(fs.readFileSync(manual,'utf8'),'user work');assert.equal(fs.readFileSync(owned,'utf8'),'original nested');
});

test('chat lifecycle: a peer\'s relative edits resolve from its own subfolder before shared Undo', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ss-peer-cwd-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));execFileSync('git',['init','-q',root],{windowsHide:true});
  const sub=path.join(root,'nested');fs.mkdirSync(sub);
  const file=path.join(sub,'index.txt');fs.writeFileSync(file,'original');
  const a=chat(root),b=chat(sub);a.state=b.state='ready';const shared=new Map();
  await Promise.all([a.beforeTurn({snapshots:shared}),b.beforeTurn({snapshots:shared})]);
  a.emit({kind:'assistant',blocks:[{type:'tool',name:'Edit',meta:{path:file}}]});
  b.emit({kind:'assistant',blocks:[{type:'tool',name:'Edit',meta:{path:'./index.txt'}}]});
  fs.writeFileSync(file,'combined work');await Promise.all([a.afterTurn(),b.afterTurn()]);
  assert.equal(a.snap.turns[0].files[0].shared,true);
  assert.deepEqual((await a.undoTurn(0,true)).restored,[]);
  assert.equal(fs.readFileSync(file,'utf8'),'combined work');
});

test('chat lifecycle: an aliased project path keeps accurate ownership without reading file contents', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ss-alias-undo-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const real=path.join(root,'real'),alias=path.join(root,'alias');fs.mkdirSync(real);
  fs.symlinkSync(real,alias,process.platform==='win32'?'junction':'dir');
  execFileSync('git',['init','-q',real],{windowsHide:true});
  const file=path.join(real,'note.txt');fs.writeFileSync(file,'original');
  const c=chat(real);c.state='ready';await c.beforeTurn();
  c.emit({kind:'assistant',blocks:[{type:'tool',name:'Edit',meta:{path:path.join(alias,'note.txt')}}]});
  fs.writeFileSync(file,'edited through alias');await c.afterTurn();
  assert.equal(c.snap.turns[0].files[0].meanwhile,undefined);
  assert.deepEqual((await c.undoTurn(0)).restored,['note.txt']);
  assert.equal(fs.readFileSync(file,'utf8'),'original');
});

test('chat lifecycle: an unresolved peer path cannot be declared safely disjoint', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ss-unknown-path-undo-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));execFileSync('git',['init','-q',root],{windowsHide:true});
  const file=path.join(root,'note.txt');fs.writeFileSync(file,'original');
  const a=chat(root),b=chat(root);a.state=b.state='ready';const shared=new Map();
  await Promise.all([a.beforeTurn({snapshots:shared}),b.beforeTurn({snapshots:shared})]);
  a.emit({kind:'assistant',blocks:[{type:'tool',name:'Edit',meta:{path:file}}]});
  b.emit({kind:'assistant',blocks:[{type:'tool',name:'Edit',meta:{path:path.join(root,'missing-alias','note.txt')}}]});
  fs.writeFileSync(file,'work with uncertain peer ownership');await Promise.all([a.afterTurn(),b.afterTurn()]);
  assert.equal(a.snap.turns[0].files[0].shared,true);
  assert.deepEqual((await a.undoTurn(0,true)).restored,[]);
  assert.equal(fs.readFileSync(file,'utf8'),'work with uncertain peer ownership');
});

test('chat lifecycle: Codex external tools make overlapping Undo ownership unknown', async t => {
  const {historyItems}=require('../lib/codex');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ss-external-undo-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));execFileSync('git',['init','-q',root],{windowsHide:true});
  const file=path.join(root,'shared.txt');
  for(const type of ['mcpToolCall','dynamicToolCall']){
    fs.writeFileSync(file,'before');const a=chat(root),b=chat(root);a.state=b.state='ready';
    const shared=new Map();await Promise.all([a.beforeTurn({snapshots:shared}),b.beforeTurn({snapshots:shared})]);
    a.emit({kind:'assistant',blocks:[{type:'tool',name:'Edit',meta:{path:file}}]});
    const events=historyItems([{id:'synthetic',items:[{type,id:'external',server:'functions',tool:'exec',arguments:{}}]}]);
    b.emit(events[0]);fs.writeFileSync(file,'both assistants changed this');
    await Promise.all([a.afterTurn(),b.afterTurn()]);
    const result=await a.undoTurn(0,true);
    assert.deepEqual(result.restored,[],type);assert.equal(result.skipped.length,1,type);
    assert.equal(fs.readFileSync(file,'utf8'),'both assistants changed this');
  }
});

test('chat lifecycle: a fresh queued baseline retains protection from a still-running peer', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ss-queued-shared-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));execFileSync('git',['init','-q',root],{windowsHide:true});
  const file=path.join(root,'shared.md');fs.writeFileSync(file,'original');
  const a=chat(root),b=chat(root);a.state=b.state='ready';const shared=new Map();
  await Promise.all([a.beforeTurn({snapshots:shared}),b.beforeTurn({snapshots:shared})]);
  b.state='busy';b.emit({kind:'assistant',blocks:[{type:'tool',name:'Bash',summary:'long-running write'}]});
  a.noteQueuedSnapshot();await a.afterTurn();a.state='busy';
  await new Promise(resolve=>{assert.equal(a.waitForQueuedSnapshot(resolve),true);});
  assert.ok(a.snap.pending&&a.snap.pending.queued);assert.equal(a.snap.pending.sharedAll,true);
  a.emit({kind:'assistant',blocks:[{type:'tool',name:'Edit',meta:{path:file}}]});
  fs.writeFileSync(file,'overlapping queued edits');await a.afterTurn();
  assert.deepEqual((await a.undoTurn(0,true)).restored,[]);
  assert.equal(fs.readFileSync(file,'utf8'),'overlapping queued edits');
  b.clearPendingSnapshot();
});

test('chat lifecycle: a peer finishing during queued preparation still protects its later edits', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ss-finishing-peer-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));execFileSync('git',['init','-q',root],{windowsHide:true});
  for(const f of ['own.md','peer.md'])fs.writeFileSync(path.join(root,f),'original');
  const a=chat(root),b=chat(root);a.state=b.state='ready';const shared=new Map();
  await Promise.all([a.beforeTurn({snapshots:shared}),b.beforeTurn({snapshots:shared})]);
  b.state='busy';a.noteQueuedSnapshot();await a.afterTurn();a.state='busy';
  const snapshots=require('../lib/snapshots'),original=snapshots.snapshot;let changed=false;
  snapshots.snapshot=async(...args)=>{
    const ref=await original(...args);
    if(!changed&&a.snap.queuePreparing){changed=true;fs.writeFileSync(path.join(root,'peer.md'),'peer completed work');b.state='ready';}
    return ref;
  };
  try{await new Promise(resolve=>a.waitForQueuedSnapshot(resolve));}
  finally{snapshots.snapshot=original;}
  assert.equal(changed,true);assert.equal(a.snap.pending.sharedAll,true);
  a.emit({kind:'assistant',blocks:[{type:'tool',name:'Bash',summary:'queued edit'}]});
  fs.writeFileSync(path.join(root,'own.md'),'queued work');await a.afterTurn();
  assert.deepEqual((await a.undoTurn(0,true)).restored,[]);
  assert.equal(fs.readFileSync(path.join(root,'peer.md'),'utf8'),'peer completed work');b.clearPendingSnapshot();
});
