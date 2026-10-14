'use strict';
// One PowerShell kept running, for a check that comes back every few seconds (which chats are open in
// a terminal, on Windows). Starting PowerShell costs 2-3 s of a core; the check itself, a fraction of
// a second. Scripts go in on its stdin one at a time, and each answer ends with a line of its own.
// If it can't start, dies or stops answering, that call is made the usual way (a PowerShell of its
// own, `fallback`), and a fresh one starts next time. It never keeps the app running, and goes with
// it: killed when the app exits, and it exits by itself when its stdin closes (the app is gone).
const crypto = require('crypto');
const { spawn } = require('child_process');

const ARGS = ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'];
const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');

function createPsWorker({ fallback, command = 'powershell.exe', restMs = 5 * 60 * 1000 } = {}) {
  const tag = crypto.randomBytes(6).toString('hex');
  const queue = [];
  let child = null, current = null, out = '', err = '', n = 0, fails = 0, restUntil = 0, hooked = false;

  function start() {
    let c;
    try { c = spawn(command, ARGS, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); } catch { return null; }
    out = '';
    c.stdout.setEncoding('utf8'); c.stderr.setEncoding('utf8');
    c.stdout.on('data', d => { if (child === c) { out += d; answered(); } });
    c.stderr.on('data', d => { if (child === c) err += d; });
    c.stdin.on('error', () => { /* it just died: 'exit' says so */ });
    c.on('error', () => gone(c));
    c.on('exit', () => gone(c));
    c.unref(); for (const s of [c.stdin, c.stdout, c.stderr]) s.unref();
    if (!hooked) { hooked = true; process.once('exit', stop); }
    // UTF-8 out (command lines can hold any path). Nothing else is kept from one script to the next.
    c.stdin.write('[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false\n');
    return c;
  }
  // Only this PowerShell, by its own process.
  function kill() {
    const c = child; child = null;
    if (c) try { c.kill(); } catch { /* gone */ }
  }
  // Three misses in a row (it couldn't start, died or hung): a PowerShell of its own each time, for a while.
  function missed() { if (++fails >= 3) restUntil = Date.now() + restMs; }
  const viaOwn = job => fallback(job.script, job.opts).then(job.resolve, e => job.resolve({ code: -1, stdout: '', stderr: String(e && e.message) }));

  function finish(r) {
    const job = current; current = null;
    clearTimeout(job.timer); job.resolve(r);
    next();
  }
  function answered() {
    if (!current) { out = ''; return; }
    const at = out.indexOf(current.mark), eol = at < 0 ? -1 : out.indexOf('\n', at);
    if (eol >= 0) { const stdout = out.slice(0, at); out = out.slice(eol + 1); fails = 0; return finish({ code: 0, stdout, stderr: err }); }
    if (out.length > 2e6) { const stdout = out; kill(); finish({ code: -1, stdout, stderr: err }); }
  }
  // It died or couldn't start: the call it had is made the usual way.
  function gone(c) {
    if (child !== c) return;
    child = null; missed();
    if (!current) return;
    const job = current; current = null;
    clearTimeout(job.timer); viaOwn(job);
    next();
  }

  function next() {
    if (current || !queue.length) return;
    if (!child && Date.now() >= restUntil && !(child = start())) missed();
    if (!child) { for (const job of queue.splice(0)) viaOwn(job); return; }
    const job = current = queue.shift();
    job.mark = `@@END:${tag}:${++n}@@`;
    err = '';
    job.timer = setTimeout(() => { const stdout = out; kill(); missed(); finish({ code: -1, stdout, stderr: `${err}\n(timed out)`, timedOut: true }); }, job.opts.timeoutMs || 12000);
    // Base64, so no quoting or line breaks can go wrong; the script runs in a scope of its own, and an
    // error that stops it is told on stderr, like a PowerShell of its own would.
    child.stdin.write(`try { & ([scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(job.script)}')))) } catch { [Console]::Error.WriteLine($_) }; '${job.mark}'\n`);
  }

  // Answers like runPowerShell: { code, stdout, stderr, timedOut? }.
  function run(script, opts = {}) {
    return new Promise(resolve => { queue.push({ script, opts, resolve }); next(); });
  }
  function stop() {
    kill();
    const left = [...(current ? [current] : []), ...queue.splice(0)]; current = null;
    for (const job of left) { clearTimeout(job.timer); job.resolve({ code: -1, stdout: '', stderr: 'PowerShell stopped.' }); }
  }
  return { run, stop, pid: () => (child ? child.pid : null) };
}

module.exports = { createPsWorker };
