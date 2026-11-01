#!/usr/bin/env node
'use strict';
// Differential check for the async history reader against the committed reader, using generated
// transcripts only. Run manually after history changes: node tests/check-history-compat.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { readHistory } = require('../lib/chat');
const app = path.join(__dirname, '..'), root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-history-compat-'));
const filename = path.join(app, 'lib/chat.js'), previous = new Module(filename, module);
previous.filename = filename; previous.paths = Module._nodeModulePaths(path.dirname(filename));
previous._compile(execFileSync('git', ['show', 'HEAD:lib/chat.js'], {cwd:app,encoding:'utf8',windowsHide:true}), filename);
let seed = 0x4e81a12;
const random = n => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed%n; };
const stamp = i => new Date(1700000000000+i*1000).toISOString();
const line = x => JSON.stringify(x);
const picture = {type:'image',source:{type:'base64',media_type:'image/png',data:'aGVsbG8='}};

(async()=>{
  let pages = 0;
  for(let trial=0;trial<24;trial++) {
    const rows=[];
    for(let i=0;i<80;i++) {
      const timestamp=stamp(i), uuid=`u${trial}-${i}`;
      const text=`Question ${i}: accents é中🖼️. ${'padding '.repeat(trial%6===0?20000:random(80))}`;
      rows.push(line({type:'user',uuid,timestamp,message:{content:i%9===0?[{type:'text',text},picture]:text}}));
      const id=`m${trial}-${i}`, tool=`tool${i}`, name=['Read','Edit','Bash'][random(3)];
      rows.push(line({type:'assistant',uuid:`a${trial}-${i}`,timestamp,message:{id,model:'synthetic',content:[
        {type:'text',text:`Answer ${i} ${'more '.repeat(random(30))}`},
        {type:'tool_use',id:tool,name,input:name==='Bash'?{command:'echo synthetic'}:{file_path:`file-${i}.lua`,old_string:'before',new_string:'after'}},
      ]}}));
      rows.push(line({type:'user',timestamp,message:{content:[{type:'tool_result',tool_use_id:tool,content:i%7===0?[{type:'text',text:'Tool output'},picture]:'Tool output'}]}}));
      if(i%3===0) rows.push(line({type:'assistant',timestamp,message:{id,content:[{type:'text',text:'The same reply continues.'}]}}));
      if(i%13===0) rows.push('{unfinished invalid line');
      if(i%11===0) rows.push(line({type:'user',timestamp,isSidechain:true,message:{content:'ignore this helper'}}));
      if(i%17===0) rows.push(line({type:'user',timestamp,isCompactSummary:true,message:{content:'A compacted summary'}}));
    }
    const file=path.join(root,`transcript-${trial}.jsonl`);
    fs.writeFileSync(file,rows.join(trial%2?'\r\n':'\n')+'\n');
    let cursor=null;
    const limit=trial%6===0?60:[7,31,60][trial%3], until=trial%4===0?stamp(55):null;
    do {
      const opts={cursor,limit,until};
      const expected=await previous.exports.readHistory(file,opts), actual=await readHistory(file,opts);
      assert.deepEqual(actual,expected,`trial ${trial}, cursor ${cursor}`);
      assert.notEqual(actual.cursor,cursor||'start','pagination must advance');
      cursor=actual.cursor; pages++;
    } while(cursor);
  }
  console.log(JSON.stringify({state:'passed',seed:'0x4e81a12',transcripts:24,pages}));
})().catch(err=>{console.error(err);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
