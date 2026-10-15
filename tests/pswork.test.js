// The PowerShell that stays running for the running-chats check (Windows): right answers in order,
// any text, a fresh one after a hang or a crash, and it never outlives the app.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');
const { createPsWorker } = require('../lib/pswork');

const WIN = { skip: process.platform !== 'win32' && 'PowerShell is a Windows thing here', timeout: 120000 };
// A call that starts PowerShell gets longer: that's slow on a busy machine (GitHub's especially).
const START = { timeoutMs: 60000 };
const PSWORK = path.join(__dirname, '..', 'lib', 'pswork.js');
const own = async () => ({ code: 0, stdout: 'fallback\r\n', stderr: '' });
// By PID only: is that process still there? (Signal 0 only asks.)
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function goneSoon(pid, ms = 8000) {
  for (const until = Date.now() + ms; Date.now() < until; await new Promise(r => setTimeout(r, 100))) if (!alive(pid)) return true;
  return !alive(pid);
}

test('ps worker: one after another and all at once, each call gets its own answer, in order', WIN, async () => {
  const w = createPsWorker({ fallback: own });
  try {
    assert.equal((await w.run("'one'", START)).stdout, 'one\r\n');
    const pid = w.pid();
    assert.ok(pid, 'it stays running');
    assert.equal((await w.run("1..3 | ForEach-Object { 'line ' + $_ }")).stdout, 'line 1\r\nline 2\r\nline 3\r\n');
    const all = await Promise.all(Array.from({ length: 8 }, (_, i) => w.run(`Start-Sleep -Milliseconds ${(8 - i) * 15}; 'answer ${i}'`)));
    assert.deepEqual(all.map(r => r.stdout), Array.from({ length: 8 }, (_, i) => `answer ${i}\r\n`));
    assert.equal(w.pid(), pid, 'the same PowerShell answered them all');
    // A script that stops with an error says so, and the next one runs as usual; nothing is kept between them.
    const bad = await w.run("$kept = 'x'; throw 'it broke'");
    assert.equal(bad.stdout, ''); assert.match(bad.stderr, /it broke/);
    assert.equal((await w.run("'[' + $kept + ']'")).stdout, '[]\r\n');
    assert.equal((await w.run("[Console]::Out.Write('no line end')")).stdout, 'no line end');
    assert.equal(w.pid(), pid);
  } finally { w.stop(); }
});

test('ps worker: text that isn’t ASCII comes back as it was', WIN, async () => {
  const w = createPsWorker({ fallback: own });
  try {
    const s = 'C:\\Users\\Zoë\\Projets\\café – 日本語 ✓ 🚀';
    assert.equal((await w.run(`'${s}'`, START)).stdout, `${s}\r\n`);
    assert.equal((await w.run("[string]::new([char[]]@(0x00E9, 0x65E5))")).stdout, 'é日\r\n');
  } finally { w.stop(); }
});

test('ps worker: a call that hangs times out, that PowerShell goes, and a fresh one answers the next', WIN, async () => {
  const w = createPsWorker({ fallback: own });
  try {
    await w.run("'warm'", START);
    const first = w.pid();
    const r = await w.run("'partial'; Start-Sleep -Seconds 30; 'never'", { timeoutMs: 1500 });
    assert.equal(r.timedOut, true); assert.equal(r.code, -1);
    assert.match(r.stdout, /partial/); assert.doesNotMatch(r.stdout, /never/);
    assert.ok(await goneSoon(first), 'the stuck PowerShell was stopped');
    assert.equal((await w.run("'fresh'", START)).stdout, 'fresh\r\n');
    assert.ok(w.pid() && w.pid() !== first, 'a new one started');
  } finally { w.stop(); }
});

test('ps worker: if it dies mid-call, that call is made the usual way, and the next starts a new one', WIN, async () => {
  const w = createPsWorker({ fallback: own });
  try {
    await w.run("'warm'", START);
    const first = w.pid();
    const r = w.run('Start-Sleep -Seconds 30');
    setTimeout(() => process.kill(first), 300); // only the PowerShell this test started
    assert.equal((await r).stdout, 'fallback\r\n');
    assert.equal((await w.run("'back'", START)).stdout, 'back\r\n');
    assert.ok(w.pid() !== first);
  } finally { w.stop(); }
});

test('ps worker: after stop() its PowerShell is gone', WIN, async () => {
  const w = createPsWorker({ fallback: own });
  await w.run("'hi'", START);
  const pid = w.pid();
  assert.ok(alive(pid));
  w.stop();
  assert.equal(w.pid(), null);
  assert.ok(await goneSoon(pid));
});

test('ps worker: it never keeps the app running, and never outlives it, even when the app is killed outright', WIN, async () => {
  const kid = code => {
    const p = spawn(process.execPath, ['-e', `const w = require(${JSON.stringify(PSWORK)}).createPsWorker({ fallback: async () => ({}) }); ${code}`], { stdio: ['ignore', 'pipe', 'inherit'] });
    const pid = new Promise(res => { let s = ''; p.stdout.on('data', d => { s += d; if (s.includes('\n')) res(Number(s.trim()) || 0); }); p.on('exit', () => res(0)); });
    const exited = new Promise(res => p.on('exit', () => res(true)));
    return { p, pid, exited };
  };
  // Left alone, Node finishes (the worker doesn't hold it), and its PowerShell goes too.
  const a = kid("w.run('1', { timeoutMs: 60000 }).then(() => console.log(w.pid()))");
  const pidA = await a.pid;
  assert.ok(pidA, 'it answered');
  const byItself = await Promise.race([a.exited, new Promise(res => setTimeout(res, 15000, false))]);
  if (!byItself) a.p.kill();
  assert.ok(byItself, 'Node finished by itself');
  assert.ok(await goneSoon(pidA), 'its PowerShell went with it');
  // Killed outright (no exit handlers run): PowerShell sees its stdin close and exits.
  const b = kid("w.run('1', { timeoutMs: 60000 }).then(() => { console.log(w.pid()); setInterval(() => {}, 1000); })");
  const pidB = await b.pid;
  assert.ok(alive(pidB));
  b.p.kill(); await b.exited;
  assert.ok(await goneSoon(pidB), 'its PowerShell went with it');
});

test('ps worker: if PowerShell can’t start, calls are made the usual way, and after three misses it stops trying for a while', async () => {
  let asked = 0;
  const w = createPsWorker({ command: 'no-such-powershell-here.exe', fallback: async (script, opts) => { asked++; return { code: 0, stdout: `${script}|${opts.timeoutMs}`, stderr: '' }; } });
  for (let i = 1; i <= 4; i++) assert.equal((await w.run(`call ${i}`, { timeoutMs: 1234 })).stdout, `call ${i}|1234`);
  assert.equal(asked, 4);
  assert.equal(w.pid(), null, 'resting: no PowerShell was started for the fourth');
  w.stop();
});
