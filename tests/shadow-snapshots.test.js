'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createShadowStore, eligible, broad } = require('../lib/shadow-snapshots');

function fixture(t, options = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-text-snapshots-'));
  const root = path.join(base, 'project'), data = path.join(base, 'data'); fs.mkdirSync(root);
  const store = createShadowStore({ dir: data, attributes: paths => Promise.resolve(paths.map(() => 0)), ...options });
  t.after(() => { store.close(); fs.rmSync(base, { recursive: true, force: true }); });
  const write = (name, content) => { const p = path.join(root, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
  return { base, root, data, store, write };
}
const git = (resolved, args) => execFileSync('git', ['-c','core.longpaths=true',`--git-dir=${resolved.gitDir}`, ...args], { windowsHide: true, encoding: 'utf8' });

test('shadow snapshots keep text bytes outside the project and persist across restart', async t => {
  const { root, data, store, write } = fixture(t);
  write('notes/world.md', 'First\r\nSecond\r\n'); write('save.lua', 'return "world"\n');
  write('art.png', 'not a picture but still excluded'); write('.env', 'secret'); write('node_modules/a.js', 'dependency');
  const ref = await store.capture(root), saved = await store.resolve(root, ref);
  assert.equal(fs.existsSync(path.join(root, '.git')), false);
  assert.deepEqual(git(saved, ['ls-tree', '-r', '--name-only', saved.tree]).trim().split('\n'), ['notes/world.md', 'save.lua']);
  assert.equal(git(saved, ['show', `${saved.tree}:notes/world.md`]), 'First\r\nSecond\r\n');
  const reopened = createShadowStore({ dir: data, attributes: async paths => paths.map(() => 0) }); t.after(() => reopened.close());
  assert.equal((await reopened.resolve(root, ref)).tree, saved.tree);
  assert.equal(await reopened.capture(root), ref, 'unchanged files reuse the immutable baseline');
});

test('shadow snapshots mark oversized, binary, linked and offline paths unknown rather than deleted', async t => {
  let offline = new Set();
  const { root, store, write } = fixture(t, { limits: { fileBytes: 20 }, attributes: async paths => paths.map(p => offline.has(p) ? 0x400000 : 0) });
  write('story.md', 'before'); write('offline/notes.txt', 'local initially'); write('binary.txt', 'text');
  const before = await store.resolve(root, await store.capture(root));
  write('story.md', 'x'.repeat(21)); write('binary.txt', Buffer.from([0, 1, 2])); offline.add(path.join(root, 'offline'));
  const after = await store.resolve(root, await store.capture(root));
  for (const file of ['story.md', 'binary.txt', 'offline/notes.txt']) {
    assert.equal(store.covered(before, file), true); assert.equal(store.covered(after, file), false);
  }
  assert.equal(store.covered(after, 'missing.md'), true, 'a wholly scanned, absent path is known to be absent');
  const blocked = await store.currentAllowed(root, ['story.md', 'binary.txt', 'offline/notes.txt']);
  assert.equal(blocked.size, 3, 'even force must skip excluded current contents');
});

test('shadow snapshots bound entry count and never make an incomplete baseline', async t => {
  let inspections=0;
  const { root, store, write } = fixture(t, { limits: { entries: 3 }, attributes:async paths=>{inspections++;return paths.map(()=>0);} });
  for (let i = 0; i < 4; i++) write(`f${i}.txt`, 'small');
  await assert.rejects(store.capture(root), /too many entries/);
  const before=inspections;await assert.rejects(store.capture(root),/too many entries/);
  assert.equal(inspections,before,'an oversized project is not scanned again on every message');
});

test('shadow snapshots reject broad folders and do not include assets or secrets', () => {
  assert.equal(broad(os.homedir()), true); assert.equal(broad(path.parse(process.cwd()).root), true);
  assert.equal(broad(path.join(os.homedir(), 'Desktop')), true);
  for (const file of ['x.png', 'x.zip', 'x.svg', '.env.local', 'auth.json', 'secrets.json', '.claude/.credentials.json', '.kube/config.yaml', 'node_modules/lib.js', '../outside.md']) assert.equal(eligible(file), false, file);
  for (const file of ['story.md', 'src/save.lua', 'src/hello.ts', 'README', '.gitignore']) assert.equal(eligible(file), true, file);
});

test('shadow snapshots isolate projects, refuse a replaced root, and detect damaged metadata', async t => {
  const { root, data, store, write } = fixture(t); write('a.md', 'original');
  const ref = await store.capture(root), another = path.join(path.dirname(root), 'another'); fs.mkdirSync(another);
  await assert.rejects(store.resolve(another, ref), /another project/);
  const [, , id, manifest] = ref.split(':');
  const file = path.join(data, id, 'manifests', `${manifest}.json`); const json = JSON.parse(fs.readFileSync(file)); json.tree = '0'.repeat(40); fs.writeFileSync(file, JSON.stringify(json));
  await assert.rejects(store.resolve(root, ref), /damaged/);
  fs.renameSync(root, `${root}-old`); fs.mkdirSync(root);
  await assert.rejects(store.capture(root), /replaced/);
});

test('shadow pruning keeps active baselines and rehashes unchanged files after eviction', async t => {
  const { root, store, write } = fixture(t, { limits: { manifests: 1, pinGraceMs: 0 } });
  write('story.md', 'one'); const one = await store.capture(root); store.pin(one);
  write('story.md', 'two'); const two = await store.capture(root);
  write('story.md', 'three'); await store.capture(root);
  assert.ok(await store.resolve(root, one)); store.release(one);
  const three = await store.capture(root); assert.ok(await store.resolve(root, three));
  await assert.rejects(store.resolve(root, one), /expired/);
  await assert.rejects(store.resolve(root, two), /expired/);
});

test('shadow pruning respects a baseline pinned by a different store instance', async t => {
  const {root,data,store,write}=fixture(t,{limits:{manifests:1,pinGraceMs:0}});
  const other=createShadowStore({dir:data,limits:{manifests:1,pinGraceMs:0},attributes:async paths=>paths.map(()=>0)});
  t.after(()=>other.close());
  write('story.md','original');const first=await store.capture(root);store.pin(first);
  write('story.md','second');await other.capture(root);
  write('story.md','third');await other.capture(root);
  assert.ok(await store.resolve(root,first),'a different writer retains the active baseline');
  store.release(first);await other.capture(root);
  await assert.rejects(store.resolve(root,first),/expired/);
});

test('shadow retained storage keeps an allocation allowance for many small Git objects', async t => {
  const {root,data,store,write}=fixture(t);
  for(let i=0;i<120;i++)write(`part-${i}.md`,require('crypto').randomBytes(1200).toString('base64'));
  const ref=await store.capture(root),saved=await store.resolve(root,ref);
  const count=Number(git(saved,['count-objects','-v']).match(/^count: (\d+)$/m)[1]);
  const index=JSON.parse(fs.readFileSync(path.join(data,ref.split(':')[2],'index.json')));
  assert.ok(index.bytes>=count*4096,'retained small objects cannot lose their filesystem allocation allowance');
});

test('shadow retention keeps unchanged file contents cached while their latest tree survives', async t => {
  const {root,store,write}=fixture(t,{limits:{manifests:2,pinGraceMs:0}});
  write('stable.md','unchanged text');
  for(const text of ['one','two','three']){write('changing.md',text);await store.capture(root);}
  const original=fs.promises.open,stable=path.join(root,'stable.md');let stableReads=0;
  fs.promises.open=async function(file,...args){if(file===stable)stableReads++;return original.call(this,file,...args);};
  try{write('changing.md','four');const saved=await store.resolve(root,await store.capture(root));
    assert.equal(git(saved,['show',`${saved.tree}:stable.md`]),'unchanged text');
    assert.equal(stableReads,0,'evicting old revisions does not repeatedly reread the whole project');
  }finally{fs.promises.open=original;}
});

test('shadow retention rehashes unchanged contents if every saved tree has expired', async t => {
  const {root,store,write}=fixture(t,{limits:{retainMs:0,pinGraceMs:0}});
  write('stable.md','still here');await store.capture(root);await new Promise(resolve=>setTimeout(resolve,5));
  const saved=await store.resolve(root,await store.capture(root));
  assert.equal(git(saved,['show',`${saved.tree}:stable.md`]),'still here');
});

test('shadow snapshots respect the storage cap before copying a large text file', async t => {
  const { root, data, store, write } = fixture(t, { limits: { projectBytes: 20000 } });
  write('large.md', 'x'.repeat(10000)); await assert.rejects(store.capture(root), /storage limit/);
  const id = fs.readdirSync(data)[0];
  assert.equal(fs.readdirSync(path.join(data, id, 'objects.git', 'objects')).filter(n => /^[a-f0-9]{2}$/.test(n)).length, 0);
});

test('shadow Windows metadata helper identifies existing and missing paths without reading contents', { skip: process.platform !== 'win32' }, async t => {
  const { root, write } = fixture(t); write('a.md', 'metadata');
  const store = createShadowStore({ dir: path.join(path.dirname(root), 'native-data') }); t.after(() => store.close());
  const attrs = await store.attributes([root, path.join(root, 'a.md'), path.join(root, 'missing.md')]);
  assert.equal(attrs.length, 3); assert.ok(attrs[0] >= 0); assert.ok(attrs[1] >= 0); assert.equal(attrs[2], -1);
  assert.ok(await store.capture(root));
});

test('shadow snapshots reject a broad folder reached through an ancestor alias', async t => {
  const { base, store } = fixture(t), real = path.join(base, 'real'), cloud = path.join(real, 'Cloud'), alias = path.join(base, 'alias');
  fs.mkdirSync(cloud, { recursive: true });
  try { fs.symlinkSync(real, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (err) { if (err.code === 'EPERM') { t.skip('directory links unavailable'); return; } throw err; }
  const old = process.env.OneDrive; process.env.OneDrive = cloud;
  try { await assert.rejects(store.capture(path.join(alias, 'Cloud')), /project folder/); }
  finally { if (old === undefined) delete process.env.OneDrive; else process.env.OneDrive = old; }
});

test('shadow capture never asks Git to reopen a file that grows after the checked read', async t => {
  const { root, store, write } = fixture(t, { limits: { projectBytes: 2 << 20, totalBytes: 2 << 20 } });
  write('grow.txt', 'small'); const source = path.join(root, 'grow.txt'), original = fs.promises.open;
  let changed = false;
  fs.promises.open = async function (file, ...args) {
    const handle = await original.call(this, file, ...args);
    if (file === source && !changed) {
      const close = handle.close.bind(handle);
      handle.close = async () => { await close(); if (!changed) { changed = true; fs.writeFileSync(source, Buffer.alloc(6 << 20, 1)); } };
    }
    return handle;
  };
  try { await assert.rejects(store.capture(root), /changed while/); }
  finally { fs.promises.open = original; }
  write('grow.txt', 'small again');
  const saved = await store.resolve(root, await store.capture(root));
  const size = Number(git(saved, ['count-objects', '-v']).match(/^size: (\d+)$/m)[1]) * 1024;
  assert.ok(size < 2 << 20, 'the rejected oversized source was never retained');
  assert.equal(git(saved, ['show', `${saved.tree}:grow.txt`]), 'small again', 'a failed capture does not permanently exhaust the quota');
});

test('shadow exclusion coverage follows Windows case-insensitive path identity', {skip:process.platform!=='win32'}, async t => {
  const {store}=fixture(t);
  assert.equal(store.covered({excluded:['assets']},'Assets/story.md'),false);
});

test('shadow-backed changes and Undo preserve raw bytes and never delete excluded files', async t => {
  const snapshots = require('../lib/snapshots');
  const { root, data, write } = fixture(t);
  snapshots.configure({dataDir:data,attributes:async paths=>paths.map(()=>0),limits:{fileBytes:100}});
  t.after(async()=>{await snapshots.configure({});});
  write('story.md','before\r\n'); write('picture.png','old asset'); write('too-big.txt','x'.repeat(101));
  write('.gitattributes','*.md text eol=lf\n');
  const before=await snapshots.snapshot(root,{shadow:true});
  write('story.md','after\r\n'); write('picture.png','new asset'); write('too-big.txt','small now');
  const after=await snapshots.snapshot(root,{shadow:true});
  assert.deepEqual((await snapshots.changes(root,before,after)).map(f=>f.path),['story.md']);
  assert.match(await snapshots.diff(root,before,after,'story.md'),/-before/);
  const result=await snapshots.restore(root,before,after,['story.md','picture.png','too-big.txt'],{force:true});
  assert.deepEqual(result.restored,['story.md']); assert.equal(result.skipped.length,2);
  assert.equal(fs.readFileSync(path.join(root,'story.md'),'utf8'),'before\r\n');
  assert.equal(fs.readFileSync(path.join(root,'picture.png'),'utf8'),'new asset');
  assert.equal(fs.readFileSync(path.join(root,'too-big.txt'),'utf8'),'small now');
});

test('shadow Force Undo still skips a later binary file with a NUL beyond the first block', async t => {
  const snapshots=require('../lib/snapshots'), {root,data,write}=fixture(t);
  snapshots.configure({dataDir:data,attributes:async paths=>paths.map(()=>0)});
  t.after(async()=>{await snapshots.configure({});});
  write('data.txt','before'); const before=await snapshots.snapshot(root,{shadow:true});
  write('data.txt','after'); const after=await snapshots.snapshot(root,{shadow:true});
  const binary=Buffer.alloc(10000,65); binary[9500]=0; write('data.txt',binary);
  const result=await snapshots.restore(root,before,after,['data.txt'],{force:true});
  assert.deepEqual(result.restored,[]); assert.equal(result.skipped.length,1);
  assert.deepEqual(fs.readFileSync(path.join(root,'data.txt')),binary);
});

test('shadow storage serializes separate app instances and clears only its own abandoned staging folders', async t => {
  const {root,data,store,write}=fixture(t); write('story.md','test');
  const ref=await store.capture(root), id=ref.split(':')[2], base=path.join(data,id);
  const stale=path.join(base,'capture-'+'a'.repeat(16)); fs.mkdirSync(stale); fs.writeFileSync(path.join(stale,'0'),'abandoned');
  const keep=path.join(base,'user-folder'); fs.mkdirSync(keep); fs.writeFileSync(path.join(keep,'note'),'keep');
  fs.writeFileSync(path.join(data,'capture.lock'),JSON.stringify({pid:process.pid,nonce:'other',at:Date.now()}));
  await assert.rejects(store.capture(root),/still being saved/);
  assert.equal(fs.existsSync(stale),true,'no cleanup while another writer owns the lock');
  fs.unlinkSync(path.join(data,'capture.lock'));
  await store.capture(root);
  assert.equal(fs.existsSync(stale),false); assert.equal(fs.readFileSync(path.join(keep,'note'),'utf8'),'keep');
});

test('shadow Force Undo cannot overwrite a file changed after its safety check', async t => {
  const snapshots=require('../lib/snapshots'), {root,data,write}=fixture(t);
  snapshots.configure({dataDir:data,attributes:async paths=>paths.map(()=>0)});
  t.after(async()=>{await snapshots.configure({});});
  write('story.txt','before'); const before=await snapshots.snapshot(root,{shadow:true});
  write('story.txt','after'); const after=await snapshots.snapshot(root,{shadow:true});
  const source=path.join(root,'story.txt'), original=fs.promises.open, binary=Buffer.alloc(6<<20,1); let changed=false;
  fs.promises.open=async function(file,...args) {
    const h=await original.call(this,file,...args);
    if(file===source&&!changed) { const close=h.close.bind(h); h.close=async()=>{await close();if(!changed){changed=true;fs.writeFileSync(source,binary);}}; }
    return h;
  };
  let result;
  try { result=await snapshots.restore(root,before,after,['story.txt'],{force:true}); }
  finally { fs.promises.open=original; }
  assert.deepEqual(result.restored,[]); assert.equal(result.skipped.length,1);
  assert.deepEqual(fs.readFileSync(source),binary);
});

test('shadow snapshots support generated Git ref paths beyond the legacy Windows path limit', async t => {
  const {base,root,write}=fixture(t);
  // The suite runner nests TEMP too. Keep Git's repository path below its own limit while
  // its generated ref/lock names deliberately exceed Windows' legacy MAX_PATH.
  const padding=Math.max(0,210-path.join(base,'nested-data-','a'.repeat(64),'objects.git').length);
  const dir=path.join(base,'nested-data-'+ 'a'.repeat(padding));
  const store=createShadowStore({dir,attributes:async paths=>paths.map(()=>0)});t.after(()=>store.close());
  write('story.md','a long data path');const saved=await store.resolve(root,await store.capture(root));
  assert.ok(path.join(saved.gitDir,'refs','snapshots','a'.repeat(64)+'.lock').length>260);
  assert.equal(git(saved,['show',`${saved.tree}:story.md`]),'a long data path');
});
