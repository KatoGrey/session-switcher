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
// The address other devices can use ("Network: http://192.168.1.20:5173/"), for the phone.
const LAN_RE = /\bhttps?:\/\/(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7]))(?:\.\d{1,3}){2,3}:\d{2,5}(?:\/[^\s"'<>)\]]*)?/;
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
    return { running: !!r.proc, cmd: r.cmd, custom: !!commands[key(cwd)], lines: r.lines.slice(-MAX_LINES), url: r.url, lanUrl: r.lanUrl || null, exit: r.exit, started: r.started };
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
    const r = { proc: null, cmd: command, lines: [], url: null, lanUrl: null, started: Date.now(), exit: null, exited: null };
    runs.set(k, r);
    const proc = spawn(command, { cwd, shell: true, windowsHide: true, env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0' }, detached: process.platform !== 'win32' });
    r.proc = proc;
    r.exited = new Promise(res => { r.markExited = res; });
    // The page hears at most four times a second, however chatty the output.
    let told = 0, tellTimer = null;
    const tell = () => { const now = Date.now(); if (now - told >= 250) { told = now; onChange(cwd); } else if (!tellTimer) tellTimer = setTimeout(() => { tellTimer = null; told = Date.now(); onChange(cwd); }, 250 - (now - told)); };
    let partial = '';
    const LINE_MAX = 4000;
    const take = chunk => {
      // A progress bar redraws its line with \r: each redraw is a line of its own, and no line runs on for ever.
      const text = partial + stripAnsi(chunk.toString('utf8').replace(/\r(?!\n)/g, '\n'));
      const parts = text.split('\n');
      partial = parts.pop().slice(-LINE_MAX);
      for (const raw of parts) {
        const l = raw.length > LINE_MAX ? `${raw.slice(0, LINE_MAX)}…` : raw;
        if (!l.trim() && r.lines.length && !r.lines[r.lines.length - 1].trim()) continue;   // runs of blank lines as one
        r.lines.push(l);
        if (!r.url) { const m = l.match(URL_RE); if (m) r.url = m[0].replace('0.0.0.0', 'localhost').replace(/[.,;:]+$/, ''); }
        if (!r.lanUrl) { const m = l.match(LAN_RE); if (m) r.lanUrl = m[0].replace(/[.,;:]+$/, ''); }
      }
      if (r.lines.length > MAX_LINES * 2) r.lines.splice(0, r.lines.length - MAX_LINES);
      tell();
    };
    proc.stdout.on('data', take);
    proc.stderr.on('data', take);
    const ended = code => { if (r.proc !== proc) return; if (partial) r.lines.push(partial); partial = ''; r.proc = null; r.exit = code; r.markExited(); clearTimeout(tellTimer); onChange(cwd); };
    // It couldn't start at all: that's an end too (otherwise it would look like it runs for ever).
    proc.on('error', err => { r.lines.push(`Couldn’t start it: ${err.message}`); ended(-1); });
    proc.on('exit', code => ended(code));
    log(`Run: ${command} in ${cwd}`);
    onChange(cwd);
    return status(cwd);
  }
  // Stops it and everything it started (a dev server's own children too), and waits until it has
  // gone (Restart starts it again only then); if it won't go, it's killed outright.
  function stop(cwd) {
    const r = runs.get(key(cwd));
    if (!r || !r.proc || !r.proc.pid) return Promise.resolve(status(cwd));
    const proc = r.proc, pid = proc.pid;
    if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
    else { try { process.kill(-pid, 'SIGTERM'); } catch { try { proc.kill(); } catch { /* gone */ } } }
    const hard = setTimeout(() => { try { if (process.platform !== 'win32') process.kill(-pid, 'SIGKILL'); else proc.kill(); } catch { /* gone */ } }, 4000);
    return Promise.race([r.exited, new Promise(res => setTimeout(res, 8000))]).then(() => { clearTimeout(hard); return status(cwd); });
  }
  function stopAll() { for (const [, r] of runs) if (r.proc && r.proc.pid) { try { if (process.platform === 'win32') execFile('taskkill', ['/pid', String(r.proc.pid), '/T', '/F'], { windowsHide: true }, () => {}); else process.kill(-r.proc.pid, 'SIGTERM'); } catch { /* gone */ } } }
  return { status, start, stop, stopAll, setCommand };
}

module.exports = { createRunner, guessCommand, URL_RE, LAN_RE };
