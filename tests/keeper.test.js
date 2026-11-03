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
// The keeper's socket lives in the temp folder, and a socket's path can't be longer than about 104
// characters on a Mac. The full run's own temp folder (tests/run.js) is too deep for it, so then /tmp.
if (process.platform !== 'win32' && path.join(os.tmpdir(), 'switcher-keeper-000', 'k-000000000000.sock').length > 100) process.env.TMPDIR = '/tmp';
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

test('keeper: a line too long to hold is skipped, the chat hears how it began and its size, and the keeper carries on', { skip: process.platform === 'win32' }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-'));
  // The keeper starts with this environment: a 64 KB limit stands in for the real one.
  const was = process.env.SWITCHER_KEEPER_LINE_MAX;
  process.env.SWITCHER_KEEPER_LINE_MAX = String(64 * 1024);
  const a = createKeeperClient({ dataDir, appDir: APP });
  const hello = await a.ready().finally(() => { if (was === undefined) delete process.env.SWITCHER_KEEPER_LINE_MAX; else process.env.SWITCHER_KEEPER_LINE_MAX = was; });
  assert.ok(hello, 'a keeper starts and answers');
  try {
    // A stand-in for an answer full of pictures: one line far over the limit, between two ordinary ones.
    const say = 'for (const [id, result] of [[1, "first"], [2, "x".repeat(300 * 1024)], [3, "after"]]) console.log(JSON.stringify({ id, result }));';
    const pr = a.spawnKept({ file: process.execPath, args: ['-e', say], env: process.env, cwd: dataDir });
    const seen = [], skipped = [];
    pr.onLine(s => seen.push(JSON.parse(s).id), (head, size) => skipped.push({ head, size }));
    await Promise.race([new Promise(r => pr.on('exit', r)), wait(5000)]);
    assert.deepStrictEqual(seen, [1, 3], 'the lines around it arrive, in order');
    assert.strictEqual(skipped.length, 1, 'the chat hears of the skipped line');
    assert.match(skipped[0].head, /^\{"id":2,/, 'with how it began (which answer it was)');
    assert.ok(skipped[0].size > 300 * 1024, 'and its size');
    process.kill(hello.pid, 0);   // throws if the keeper has gone
    assert.ok(a.usable(), 'the keeper is still there');
    a.pause();
  } finally {
    try { process.kill(hello.pid, 'SIGTERM'); } catch { /* gone */ }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('keeper: a chat carried over a restart keeps talking, with its replay measured again', () => {
  const { LiveChat } = require('../lib/chat');
  const make = () => new LiveChat({ cfg: {}, account: { id: 'acct', name: 'Main' }, cwd: os.tmpdir() });
  const a = make();
  a.emit({ kind: 'user', text: 'hello' });
  a.emit({ kind: 'notice', level: 'info', text: 'working on it' });
  // Mid-reply, change tracking holds a promise, other chats, and the snapshot from before the reply.
  const peer = make();
  Object.assign(a.snap, { preparing: Promise.resolve(), knownPeers: new Set([peer]), pending: { before: { top: '/work', shadow: false }, at: 'now', peers: new Set([peer]) } });
  const snap = a.snapshot();
  assert.ok(!('replaySizes' in snap), 'weak maps aren’t written into the saved state');
  const b = make();
  b.restoreFrom(snap, null);
  assert.ok(b.replaySizes instanceof WeakMap, 'the restored chat has its own weak map, not {}');
  assert.strictEqual(b.replayBytes, a.replayBytes, 'the events carried over are measured again');
  b.emit({ kind: 'notice', level: 'info', text: 'after the restart' });
  assert.strictEqual(b.buffer.length, 3, 'and new events join them');
  assert.deepStrictEqual(b.snap.pending, { before: { top: '/work', shadow: false }, at: 'now' }, 'the snapshot from before the reply comes along, without the other chats');
  assert.ok(!b.snap.preparing && !b.snap.knownPeers, 'promises and other chats stay behind (they’d come back as {})');
  b.markSharedWith([peer]);
  assert.ok(b.snap.knownPeers.has(peer), 'and sharing work with another chat still works');
});

test('keeper: a Codex chat carried over from a copy before 6.6 still sends what you write', async () => {
  const { CodexChat } = require('../lib/codex');
  const calls = [];
  const srv = { listeners: new Set(), initialized: true, request: method => { calls.push(method); return Promise.resolve(method === 'turn/start' ? { turn: { id: 't1' } } : {}); } };
  const chat = new CodexChat({ cfg: {}, account: { id: 'cx', name: 'Codex', provider: 'codex' }, cwd: os.tmpdir(), codex: { server: () => srv } });
  // Saved by an older copy: its thread was going, but the saved state doesn't say so (no threadReady).
  chat.restoreFrom({ key: chat.key, sessionId: 'thread-1', state: 'ready', buffer: [], queue: [] });
  chat.send('carry on');
  await wait(50);
  assert.ok(calls.includes('turn/start'), 'the message goes to Codex instead of waiting for ever');
});
