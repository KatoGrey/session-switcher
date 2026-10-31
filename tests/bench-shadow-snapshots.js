'use strict';
// Optional synthetic benchmark. No real project, account, chat, or asset is read.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {createShadowStore}=require('../lib/shadow-snapshots');
const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?Number(process.argv[i+1]):fallback;};
const count=option('--files',6000),assets=option('--assets',10000),bytes=option('--bytes',32768);
if(!Number.isInteger(count)||count<1||count>10000||!Number.isInteger(assets)||assets<0||assets>20000||!Number.isInteger(bytes)||bytes<16||bytes>1048576)throw new Error('Invalid benchmark bounds.');
const base=fs.mkdtempSync(path.join(os.tmpdir(),'ss-shadow-benchmark-')),root=path.join(base,'project');
fs.mkdirSync(root);let store;
(async()=>{
  const built=performance.now();
  for(let i=0;i<count;i++) {const dir=path.join(root,'docs',String(Math.floor(i/100)));fs.mkdirSync(dir,{recursive:true});const text=`# Synthetic document ${i}\n`+crypto.randomBytes(Math.ceil(bytes*0.75)).toString('base64');fs.writeFileSync(path.join(dir,`note-${i}.md`),text.slice(0,bytes));}
  for(let i=0;i<assets;i++) {const dir=path.join(root,'pictures',String(Math.floor(i/100)));fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,`image-${i}.png`),'');}
  console.log(JSON.stringify({phase:'fixture',files:count,excludedAssets:assets,textMiB:count*bytes/1048576,ms:Math.round(performance.now()-built)}));
  store=createShadowStore({dir:path.join(base,'data'),trace:process.argv.includes('--trace')?info=>console.log(JSON.stringify({timing:info})):undefined});
  for(const phase of ['cold','warm','one-edit']) {
    if(phase==='one-edit')fs.appendFileSync(path.join(root,'docs','0','note-0.md'),'\nEdited once.\n');
    const started=performance.now(),ref=await store.capture(root),resolved=await store.resolve(root,ref);
    console.log(JSON.stringify({phase,ms:Math.round(performance.now()-started),heapMiB:Math.round(process.memoryUsage().heapUsed/1048576),tree:resolved.tree}));
  }
})().catch(err=>{console.error(err.stack);process.exitCode=1;}).finally(async()=>{if(store)await store.close();if(!path.resolve(base).startsWith(path.resolve(os.tmpdir())+path.sep))throw new Error('Unexpected benchmark directory');fs.rmSync(base,{recursive:true,force:true});});
