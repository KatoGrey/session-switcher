'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const snapshots = require('../lib/snapshots');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-restore-links-'));
  const repo = path.join(root, 'project'), outside = path.join(root, 'outside');
  fs.mkdirSync(repo); fs.mkdirSync(outside);
  execFileSync('git', ['init', '-q', repo], { windowsHide: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, repo, outside };
}

test('git Undo preserves edits made during either its content check or restore read, even with force', t => {
  const {repo}=fixture(t);
  const source=String.raw`
    const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict');
    const original=cp.execFile;let armed;
    cp.execFile=function(exe,args,opts,callback){return original.call(this,exe,args,opts,(...result)=>{
      if(armed&&args.includes(armed.command)){const file=armed.file;armed=null;fs.writeFileSync(file,'concurrent user edit');}
      callback(...result);
    });};
    const snapshots=require('./lib/snapshots'),repo=process.argv[1],file=path.join(repo,'entry.txt');
    (async()=>{
      for(const force of [false,true])for(const command of ['hash-object','cat-file']){
        fs.rmSync(file,{force:true});
        if(command==='cat-file')fs.writeFileSync(file,'before');
        const before=await snapshots.snapshot(repo);
        fs.writeFileSync(file,'after');const after=await snapshots.snapshot(repo);
        armed={command,file};const result=await snapshots.restore(repo,before,after,['entry.txt'],{force});
        assert.equal(armed,null);assert.deepEqual(result.restored,[]);assert.equal(result.skipped.length,1);
        assert.equal(fs.readFileSync(file,'utf8'),'concurrent user edit');
      }
    })().catch(err=>{console.error(err);process.exitCode=1;});
  `;
  execFileSync(process.execPath,['-e',source,repo],{cwd:path.resolve(__dirname,'..'),windowsHide:true,timeout:30000});
});

test('undo never writes through a replaced parent folder into another project, even with force', async t => {
  const { repo, outside } = fixture(t), folder = path.join(repo, 'assets');
  fs.mkdirSync(folder); fs.writeFileSync(path.join(folder, 'picture.txt'), 'before');
  const before = await snapshots.snapshot(repo);
  fs.writeFileSync(path.join(folder, 'picture.txt'), 'after');
  const after = await snapshots.snapshot(repo);
  fs.rmSync(folder, { recursive: true });
  fs.writeFileSync(path.join(outside, 'picture.txt'), 'another project');
  fs.symlinkSync(outside, folder, process.platform === 'win32' ? 'junction' : 'dir');
  const result = await snapshots.restore(repo, before, after, ['assets/picture.txt'], { force: true });
  assert.equal(fs.readFileSync(path.join(outside, 'picture.txt'), 'utf8'), 'another project');
  assert.deepEqual(result.restored, []);
  assert.equal(result.skipped.length, 1);
});

test('undo containment keeps differently cased sibling folders separate on case-sensitive systems', { skip: process.platform === 'win32' }, async t => {
  const { root, repo } = fixture(t);
  const sibling = path.join(root, 'Project');
  try { fs.mkdirSync(sibling); } catch (err) { if (err.code === 'EEXIST') { t.skip('case-insensitive filesystem'); return; } throw err; }
  fs.writeFileSync(path.join(sibling, 'keep.txt'), 'keep');
  const tree = await snapshots.snapshot(repo);
  const result = await snapshots.restore(repo, tree, tree, ['../Project/keep.txt'], { force: true });
  assert.equal(fs.readFileSync(path.join(sibling, 'keep.txt'), 'utf8'), 'keep');
  assert.equal(result.skipped.length, 1);
});

test('undo replaces a leaf link without modifying its target', async t => {
  const { repo, outside } = fixture(t), file = path.join(repo, 'saved.txt'), target = path.join(outside, 'keep.txt');
  fs.writeFileSync(file, 'before'); const before = await snapshots.snapshot(repo);
  fs.writeFileSync(file, 'after'); const after = await snapshots.snapshot(repo);
  fs.unlinkSync(file); fs.writeFileSync(target, 'untouched');
  try { fs.symlinkSync(target, file, 'file'); }
  catch (err) { if (err.code === 'EPERM') { t.skip('file symlinks unavailable'); return; } throw err; }
  const result = await snapshots.restore(repo, before, after, ['saved.txt'], { force: true });
  assert.equal(fs.readFileSync(target, 'utf8'), 'untouched');
  assert.deepEqual(result.restored, ['saved.txt']);
  assert.equal(fs.lstatSync(file).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'before');
});

test('undo restores a symbolic link as a link and does not dereference it', async t => {
  const { repo } = fixture(t), file = path.join(repo, 'shortcut');
  execFileSync('git', ['-C', repo, 'config', 'core.symlinks', 'true'], { windowsHide: true });
  try { fs.symlinkSync('missing-one', file, 'file'); }
  catch (err) { if (err.code === 'EPERM') { t.skip('file symlinks unavailable'); return; } throw err; }
  const before = await snapshots.snapshot(repo);
  fs.unlinkSync(file); fs.symlinkSync('missing-two', file, 'file');
  const after = await snapshots.snapshot(repo);
  const result = await snapshots.restore(repo, before, after, ['shortcut']);
  assert.deepEqual(result.restored, ['shortcut']);
  assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(file), 'missing-one');
});

test('undo restores executable mode while preserving private file permissions', { skip: process.platform === 'win32' }, async t => {
  const { repo } = fixture(t), file = path.join(repo, 'run.sh');
  fs.writeFileSync(file, '#!/bin/sh\necho before\n', { mode: 0o700 });
  const before = await snapshots.snapshot(repo);
  fs.writeFileSync(file, '#!/bin/sh\necho after\n'); fs.chmodSync(file, 0o600);
  const after = await snapshots.snapshot(repo);
  assert.deepEqual((await snapshots.restore(repo, before, after, ['run.sh'])).restored, ['run.sh']);
  assert.ok(fs.statSync(file).mode & 0o100);
  assert.equal(fs.statSync(file).mode & 0o077, 0, 'a private file remains inaccessible to others');
});

test('undo preserves a new link even when its target text equals the earlier file content', async t => {
  const {repo}=fixture(t), file=path.join(repo,'entry');
  fs.writeFileSync(file,'original'); const before=await snapshots.snapshot(repo);
  fs.writeFileSync(file,'other.txt'); const after=await snapshots.snapshot(repo);
  fs.unlinkSync(file); fs.writeFileSync(path.join(repo,'other.txt'),'separate content');
  try { fs.symlinkSync('other.txt',file,'file'); }
  catch(err) { if(err.code==='EPERM') { t.skip('file symlinks unavailable'); return; } throw err; }
  const result=await snapshots.restore(repo,before,after,['entry']);
  assert.deepEqual(result.restored,[]); assert.equal(result.skipped[0].why,'changed since');
  assert.equal(fs.lstatSync(file).isSymbolicLink(),true);
});

test('undo respects a later executable-bit change when git tracks modes', {skip:process.platform==='win32'}, async t => {
  const {repo}=fixture(t), file=path.join(repo,'run.sh');
  execFileSync('git',['-C',repo,'config','core.filemode','true'],{windowsHide:true});
  fs.writeFileSync(file,'before',{mode:0o644}); const before=await snapshots.snapshot(repo);
  fs.writeFileSync(file,'after'); const after=await snapshots.snapshot(repo);
  fs.chmodSync(file,0o755);
  const result=await snapshots.restore(repo,before,after,['run.sh']);
  assert.deepEqual(result.restored,[]); assert.equal(result.skipped[0].why,'changed since');
  assert.equal(fs.readFileSync(file,'utf8'),'after');
});

test('undo recognizes git link placeholders when core.symlinks is disabled', async t => {
  const {repo}=fixture(t), file=path.join(repo,'shortcut');
  execFileSync('git',['-C',repo,'config','core.symlinks','true'],{windowsHide:true});
  try { fs.symlinkSync('old-target',file,'file'); }
  catch(err) { if(err.code==='EPERM') { t.skip('file symlinks unavailable'); return; } throw err; }
  const before=await snapshots.snapshot(repo);
  fs.unlinkSync(file); fs.symlinkSync('new-target',file,'file'); const after=await snapshots.snapshot(repo);
  fs.unlinkSync(file); fs.writeFileSync(file,'new-target');
  execFileSync('git',['-C',repo,'config','core.symlinks','false'],{windowsHide:true});
  assert.deepEqual((await snapshots.restore(repo,before,after,['shortcut'])).restored,['shortcut']);
  assert.equal(fs.lstatSync(file).isFile(),true); assert.equal(fs.readFileSync(file,'utf8'),'old-target');
});

test('undo never mistakes a failed content check for a missing file', async t => {
  const {repo}=fixture(t), file=path.join(repo,'entry');
  fs.writeFileSync(file,'original'); const before=await snapshots.snapshot(repo);
  fs.unlinkSync(file); const after=await snapshots.snapshot(repo);
  fs.writeFileSync(file,'new user content');
  fs.writeFileSync(path.join(repo,'.gitattributes'),'entry filter=reject\n');
  for(const [key,value] of [['filter.reject.required','true'],['filter.reject.clean','false'],['filter.reject.smudge','cat']])
    execFileSync('git',['-C',repo,'config',key,value],{windowsHide:true});
  const result=await snapshots.restore(repo,before,after,['entry']);
  assert.deepEqual(result.restored,[]); assert.equal(result.skipped.length,1);
  assert.equal(fs.readFileSync(file,'utf8'),'new user content');
});

test('undo preserves existing permissions when git does not track executable bits', {skip:process.platform==='win32'}, async t => {
  const {repo}=fixture(t), file=path.join(repo,'run.sh');
  execFileSync('git',['-C',repo,'config','core.filemode','false'],{windowsHide:true});
  fs.writeFileSync(file,'before',{mode:0o644}); const before=await snapshots.snapshot(repo);
  fs.writeFileSync(file,'after'); const after=await snapshots.snapshot(repo);
  fs.chmodSync(file,0o700);
  assert.deepEqual((await snapshots.restore(repo,before,after,['run.sh'])).restored,['run.sh']);
  assert.equal(fs.statSync(file).mode&0o777,0o700);
});

test('a filename with brackets selects only its own saved diff and Undo', async t => {
  const {repo}=fixture(t);
  for(const name of ['notes[1].txt','notes1.txt'])fs.writeFileSync(path.join(repo,name),`before ${name}`);
  const before=await snapshots.snapshot(repo);
  for(const name of ['notes[1].txt','notes1.txt'])fs.writeFileSync(path.join(repo,name),`after ${name}`);
  const after=await snapshots.snapshot(repo),diff=await snapshots.diff(repo,before,after,'notes[1].txt');
  assert.match(diff,/notes\[1\]\.txt/);assert.doesNotMatch(diff,/notes1\.txt/);
  assert.deepEqual((await snapshots.restore(repo,before,after,['notes[1].txt'])).restored,['notes[1].txt']);
  assert.equal(fs.readFileSync(path.join(repo,'notes1.txt'),'utf8'),'after notes1.txt');
});
