'use strict';
// The keeper (lib/keeper.js): a chat process it holds keeps running while Switcher is away, and the
// copy that comes back gets every line it missed, once, then can write to it and stop it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createKeeperClient } = require('../lib/keeper');

const APP = path.join(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));
// A stand-in for Claude Code: a numbered line every 50 ms, and each line it's sent comes back as "echo …".
const FAKE = 'let n=0;setInterval(()=>console.log(JSON.stringify({n:++n})),50);process.stdin.setEncoding("utf8");let b="";process.stdin.on("data",d=>{b+=d;let i;while((i=b.indexOf("\\n"))>=0){console.log("echo "+b.slice(0,i));b=b.slice(i+1);}});process.stdin.on("end",()=>process.exit(0));';

test('keeper: a chat process outlives Switcher, and the next copy gets what it missed', { skip: process.platform === 'win32' }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-'));
  const a = createKeeperClient({ dataDir, appDir: APP });
  const hello = await a.ready();
  assert.ok(hello, 'a keeper starts and answers');
  const keeperPid = hello.pid;
  try {
    const pr = a.spawnKept({ file: process.execPath, args: ['-e', FAKE], env: process.env, cwd: dataDir });
    const seen1 = [];
    pr.onLine(s => seen1.push(s));
    await wait(400);
    pr.stdin.write('hi\n');
    await wait(200);
    assert.ok(seen1.length >= 4, `lines arrive (${seen1.length})`);
    assert.ok(seen1.includes('echo hi'), 'writing reaches it');
    assert.ok(pr.pid > 0, 'its pid is known');

    // A restart: the old copy stops reading at a known line, and goes.
    const handled = pr.handled, lastSeen = JSON.parse(seen1.filter(s => s[0] === '{').pop()).n;
    a.pause();
    await wait(500);   // it keeps talking meanwhile

    const b = createKeeperClient({ dataDir, appDir: APP });
    const h2 = await b.ready();
    assert.strictEqual(h2.pid, keeperPid, 'the same keeper');
    assert.ok(h2.kids.some(k => k.id === pr.id && k.alive), 'it still holds the chat');
    const pr2 = b.adopt(pr.id, handled);
    const seen2 = [];
    pr2.onLine(s => seen2.push(s));
    await wait(300);
    const nums = seen2.filter(s => s[0] === '{').map(s => JSON.parse(s).n);
    assert.strictEqual(nums[0], lastSeen + 1, 'it picks up right after the last line handled');
    for (let i = 1; i < nums.length; i++) assert.strictEqual(nums[i], nums[i - 1] + 1, 'no line lost or repeated');
    assert.ok(nums.length >= 8, `including the ones said while away (${nums.length})`);

    pr2.stdin.write('again\n');
    await wait(200);
    assert.ok(seen2.includes('echo again'), 'the new copy can write to it');

    const gone = new Promise(r => pr2.on('exit', (code, sig) => r({ code, sig })));
    pr2.stdin.end();
    const ex = await Promise.race([gone, wait(3000).then(() => null)]);
    assert.ok(ex, 'closing its input ends it, and the exit is reported');
    assert.strictEqual(ex.code, 0);
    b.pause();
  } finally {
    try { process.kill(keeperPid, 'SIGTERM'); } catch { /* gone */ }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('keeper: a Switcher on another protocol version retires it, and its chats end', { skip: process.platform === 'win32' }, async () => {
  const net = require('net');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-'));
  const a = createKeeperClient({ dataDir, appDir: APP });
  const hello = await a.ready();
  try {
    const pr = a.spawnKept({ file: process.execPath, args: ['-e', FAKE], env: process.env, cwd: dataDir });
    pr.onLine(() => {});
    await wait(300);
    const childPid = pr.pid;
    a.pause();
    // A "future" Switcher says hello on version 99: refused, saying why.
    const token = fs.readFileSync(path.join(dataDir, 'keeper-token'), 'utf8').trim();
    const reply = await new Promise(resolve => {
      const c = net.createConnection(a.paths.sock);
      let buf = '';
      c.setEncoding('utf8');
      c.on('connect', () => c.write(`${JSON.stringify({ op: 'hello', token, v: 99 })}\n`));
      c.on('data', d => { buf += d; });
      c.on('close', () => resolve(buf.trim() ? JSON.parse(buf.trim().split('\n')[0]) : null));
    });
    assert.strictEqual(reply.ev, 'refused');
    assert.strictEqual(reply.reason, 'version');
    await new Promise(resolve => {
      const c = net.createConnection(a.paths.sock);
      c.on('connect', () => c.write(`${JSON.stringify({ op: 'retire', token, v: 99 })}\n`));
      c.resume();
      c.on('close', resolve); c.on('error', resolve);
    });
    await wait(2500);
    const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
    assert.ok(!alive(childPid), 'its chat process ended');
    assert.ok(!alive(hello.pid), 'and the keeper itself went');
  } finally {
    try { process.kill(hello.pid, 'SIGKILL'); } catch { /* gone */ }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
