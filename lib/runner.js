'use strict';
// Run the project: its dev server or start script, from the chat, so you can see what Claude or Codex
// built. One run per project; its output is kept (the last lines), and the first local address it
// prints (http://localhost:5173 and the like) is the preview. The command is the project's own
// (package.json's dev, start or serve script) unless you've set one; it's remembered per project.

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const store = require('./store');

const MAX_LINES = 400;
const URL_RE = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d{2,5})?(?:\/[^\s"'<>)\]]*)?/i;
// eslint-disable-next-line no-control-regex
const stripAnsi = s => String(s).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');

// What `npm run …` would start here, if the project says.
function guessCommand(cwd) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    const sc = pkg.scripts || {};
    const name = ['dev', 'start', 'serve', 'preview'].find(k => sc[k]);
    if (name) return name === 'start' ? 'npm start' : `npm run ${name}`;
  } catch { /* not a node project */ }
  if (fs.existsSync(path.join(cwd, 'manage.py'))) return 'python manage.py runserver';
  if (fs.existsSync(path.join(cwd, 'index.html'))) return 'npx --yes serve .';
  return null;
}

function createRunner({ dataDir, log = () => {}, onChange = () => {} }) {
  const file = path.join(dataDir, 'run.json');
  const saved = store.loadOwnJson(file, null, log) || {};
  const commands = saved.commands || {};   // cwd -> the command you set
  const runs = new Map();                  // cwd -> { proc, cmd, lines, url, started, exit }
  const key = cwd => (process.platform === 'win32' ? String(cwd).toLowerCase() : String(cwd));

  function status(cwd) {
    const r = runs.get(key(cwd));
    const cmd = commands[key(cwd)] || guessCommand(cwd);
    if (!r) return { running: false, cmd, custom: !!commands[key(cwd)], lines: [], url: null, exit: null };
    return { running: !!r.proc, cmd: r.cmd, custom: !!commands[key(cwd)], lines: r.lines.slice(-MAX_LINES), url: r.url, exit: r.exit, started: r.started };
  }
  function setCommand(cwd, cmd) {
    const c = String(cmd || '').trim().slice(0, 400);
    if (c) commands[key(cwd)] = c; else delete commands[key(cwd)];
    try { store.writeJsonAtomic(file, { commands }); } catch (err) { log(`Couldn’t save run.json: ${err.message}`); }
  }
  function start(cwd, cmd = null) {
    const k = key(cwd);
    const was = runs.get(k);
    if (was && was.proc) return status(cwd);
    const command = cmd || commands[k] || guessCommand(cwd);
    if (!command) throw Object.assign(new Error('This project doesn’t say how to run it. Set the command to use.'), { status: 400, reason: 'nocommand' });
    const r = { proc: null, cmd: command, lines: [], url: null, started: Date.now(), exit: null };
    runs.set(k, r);
    const proc = spawn(command, { cwd, shell: true, windowsHide: true, env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0' }, detached: process.platform !== 'win32' });
    r.proc = proc;
    let partial = '';
    const take = chunk => {
      const text = partial + stripAnsi(chunk.toString('utf8'));
      const parts = text.split('\n');
      partial = parts.pop();
      for (const l of parts) {
        r.lines.push(l);
        if (!r.url) { const m = l.match(URL_RE); if (m) r.url = m[0].replace('0.0.0.0', 'localhost').replace(/[.,;:]+$/, ''); }
      }
      if (r.lines.length > MAX_LINES * 2) r.lines.splice(0, r.lines.length - MAX_LINES);
      onChange(cwd);
    };
    proc.stdout.on('data', take);
    proc.stderr.on('data', take);
    proc.on('error', err => { r.lines.push(`Couldn’t start it: ${err.message}`); });
    proc.on('exit', code => { if (partial) r.lines.push(partial); r.proc = null; r.exit = code; onChange(cwd); });
    log(`Run: ${command} in ${cwd}`);
    onChange(cwd);
    return status(cwd);
  }
  // Stops it and everything it started (a dev server's own children too).
  function stop(cwd) {
    const r = runs.get(key(cwd));
    if (!r || !r.proc) return Promise.resolve(status(cwd));
    const pid = r.proc.pid;
    return new Promise(res => {
      const done = () => res(status(cwd));
      if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => setTimeout(done, 300));
      else { try { process.kill(-pid, 'SIGTERM'); } catch { try { r.proc.kill(); } catch { /* gone */ } } setTimeout(done, 300); }
    });
  }
  function stopAll() { for (const [, r] of runs) if (r.proc) { try { if (process.platform === 'win32') execFile('taskkill', ['/pid', String(r.proc.pid), '/T', '/F'], { windowsHide: true }, () => {}); else process.kill(-r.proc.pid, 'SIGTERM'); } catch { /* gone */ } } }
  return { status, start, stop, stopAll, setCommand };
}

module.exports = { createRunner, guessCommand, URL_RE };
