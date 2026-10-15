'use strict';
// Signing a Claude account in from Switcher Lite, without a terminal: `claude auth login` runs in
// the background as that account; the page shows its link (to copy or open in the right browser)
// and a box for the code the browser shows; the code goes to the same login, and the account is
// checked afterwards. The browser isn't opened by itself, so you can pick a window that's signed in
// to the right claude.ai account (the default one often isn't).

const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnWin, stopTree } = require('./lite-spawn');

const IS_WIN = process.platform === 'win32';
const URL_RE = /(https:\/\/claude\.(?:com|ai)\/[^\s]*oauth\/authorize\?[^\s]+)/;
const strip = s => String(s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

// Windows: $BROWSER is a batch file that hands the link to this, run by Node from a file of its own.
// A link with & in it can reach a batch file unquoted, and cmd.exe cuts it there, so the whole command
// line cmd.exe was started with comes along too (LITE_RAW), and the longest link wins.
function writeLink() {
  const seen = [process.argv[2] || '', process.env.LITE_RAW || ''].map(s => s.replace(/\^/g, ''));
  const url = seen.map(s => (/https:\/\/[^\s"]+/.exec(s) || [''])[0]).sort((a, b) => b.length - a.length)[0];
  if (url && process.env.LITE_URL_FILE) require('fs').writeFileSync(process.env.LITE_URL_FILE, `${url}\n`);
}
function captureScriptWin() {
  const js = path.join(os.tmpdir(), 'switcher-lite-browser.js'), cmd = path.join(os.tmpdir(), 'switcher-lite-browser.cmd');
  const v = s => String(s).replace(/%/g, '%%');
  const jsBody = `'use strict';\n// Switcher Lite's sign-in: writes down the link Claude Code opens (lib/lite-signin.js).\n(${writeLink})();\n`;
  const cmdBody = ['@echo off', 'setlocal EnableDelayedExpansion', 'set "LITE_RAW=!CMDCMDLINE!"', 'setlocal DisableDelayedExpansion',
    ...(process.versions.electron ? ['set "ELECTRON_RUN_AS_NODE=1"'] : []), `"${v(process.execPath)}" "${v(js)}" %1`, ''].join('\r\n');
  try {
    for (const [f, body] of [[js, jsBody], [cmd, cmdBody]]) if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== body) fs.writeFileSync(f, body);
  } catch { return null; }
  return cmd;
}

// Claude Code "opens the browser" through $BROWSER. Lite points that at a tiny script that only
// writes the link down, so the page can offer it: that link reports back to this Mac by itself
// (localhost), so there's no code to paste when it's opened on this computer.
function captureScript() {
  if (IS_WIN) return captureScriptWin();
  const f = path.join(os.tmpdir(), 'switcher-lite-browser.sh');
  const body = '#!/bin/sh\nprintf \'%s\\n\' "$1" > "$LITE_URL_FILE"\n';
  try { if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== body) { fs.writeFileSync(f, body, { mode: 0o700 }); fs.chmodSync(f, 0o700); } } catch { return '/usr/bin/true'; }
  return f;
}

function createSignin({ log = () => {}, config, acc, overrideVars = [], afterSignIn = () => {} }) {
  const runs = new Map(); // id -> run

  function envFor(cfg, a, urlFile) {
    const env = { ...process.env, BROWSER: captureScript(), LITE_URL_FILE: urlFile };
    if (!env.BROWSER) delete env.BROWSER;   // Windows, when the temp folder can't be written
    if (a.isDefault) delete env.CLAUDE_CONFIG_DIR; else env.CLAUDE_CONFIG_DIR = a.configDir;
    if (cfg.prefs && cfg.prefs.cleanEnv) for (const v of overrideVars) delete env[v];
    return env;
  }
  const view = r => ({ id: r.id, account: r.accountId, email: r.email, url: r.autoUrl || r.url, manualUrl: r.url, auto: !!r.autoUrl, state: r.state, error: r.error, signedInAs: r.signedInAs || null });

  function stop(r) {
    if (r.proc && r.proc.exitCode === null) { if (IS_WIN) stopTree(r.proc); else { try { process.kill(-r.proc.pid, 'SIGTERM'); } catch { try { r.proc.kill(); } catch { /* gone */ } } } }
    clearTimeout(r.timer);
  }

  // Starts a login and resolves once its link is known.
  function start(accountId) {
    const cfg = config();
    const a = acc.findAccount(cfg, accountId);
    for (const r of runs.values()) if (r.accountId === a.id) { stop(r); runs.delete(r.id); }
    if (!a.isDefault) acc.ensureLinks(cfg, a);
    const email = a.expectEmail || null;
    const args = ['auth', 'login', ...(email ? ['--email', email] : [])];
    // The command and its arguments are passed as separate words, so nothing in them is read as shell syntax.
    const id = crypto.randomBytes(6).toString('hex');
    const urlFile = path.join(os.tmpdir(), `switcher-lite-signin-${id}.txt`);
    // Windows has no sh: claude.exe starts directly, an npm install through its Node script (lib/lite-spawn.js).
    const proc = IS_WIN ? spawnWin(cfg.claudeCommand || 'claude', args, { env: envFor(cfg, a, urlFile), cwd: os.homedir(), stdio: ['pipe', 'pipe', 'pipe'] })
      : cp.spawn('sh', ['-c', 'exec "$0" "$@"', cfg.claudeCommand || 'claude', ...args], { env: envFor(cfg, a, urlFile), cwd: os.homedir(), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    const r = { id, accountId: a.id, email, proc, url: null, autoUrl: null, urlFile, state: 'starting', error: null, out: '' };
    runs.set(r.id, r);
    const onData = d => { r.out = (r.out + strip(d)).slice(-8000); const m = URL_RE.exec(r.out); if (m && !r.url) { r.url = m[1]; r.urlAt = Date.now(); r.state = 'waiting'; } };
    proc.stdout.on('data', onData); proc.stderr.on('data', onData);
    proc.on('error', err => { r.state = 'failed'; r.error = err.message; });
    // Finished by itself: the browser came back to this Mac with the approval.
    proc.on('close', code => {
      r.exit = code;
      try { fs.unlinkSync(urlFile); } catch { /* gone */ }
      if (code === 0 && r.state === 'waiting') { r.state = 'checking'; finish(r).catch(() => {}); return; }
      if (r.state !== 'done' && r.state !== 'checking' && r.state !== 'wrong') { r.state = 'failed'; const said = lastLine(r.out); r.error = r.error || (said ? `The sign-in didn’t go through (${said.replace(/^Login failed:\s*/i, '')}). Start again for a fresh link.` : `It stopped (${code}). Start again.`); }
    });
    proc.stdin.on('error', () => {});
    r.timer = setTimeout(() => { if (r.state === 'waiting' || r.state === 'starting') { r.state = 'failed'; r.error = 'That sign-in waited too long. Start again.'; stop(r); } }, 10 * 60e3);
    r.timer.unref && r.timer.unref();
    log(`Lite: signing in ${a.name}${email ? ` (${email})` : ''}`);
    return new Promise(resolve => {
      const t0 = Date.now();
      // On Windows the link may never be written down (if Claude Code can't run a batch file as
      // $BROWSER), so the one it printed is offered a few seconds after it shows up.
      const gaveUp = () => IS_WIN && r.urlAt && Date.now() - r.urlAt > 4000;
      const tick = () => {
        if (!r.autoUrl) { try { const u = fs.readFileSync(urlFile, 'utf8').trim(); if (/^https:\/\/claude\.(com|ai)\//.test(u)) r.autoUrl = u; } catch { /* not yet */ } }
        return (r.url && (r.autoUrl || gaveUp())) || r.state === 'failed' || Date.now() - t0 > 20000 ? resolve(view(r)) : setTimeout(tick, 150);
      };
      tick();
    });
  }
  const lastLine = s => strip(s).split('\n').map(x => x.replace(/^Paste code here if prompted >\s*/i, '').trim()).filter(x => x && !/^(If the browser didn|Opening browser)/i.test(x)).pop() || '';

  // Gives the code to the same login, waits for it to finish, then checks who it signed in as.
  async function code(id, text) {
    const r = runs.get(id);
    if (!r) throw Object.assign(new Error('That sign-in isn’t running any more. Start again.'), { status: 404 });
    const c = String(text || '').trim().replace(/\s+/g, '');
    if (!c) throw Object.assign(new Error('Paste the code the browser showed.'), { status: 400 });
    if (r.state !== 'waiting') throw Object.assign(new Error(r.error || 'That sign-in has finished. Start again.'), { status: 409 });
    r.state = 'checking';
    const before = r.out.length;
    r.proc.stdin.write(`${c}\n`);
    const exit = await new Promise(resolve => { if (r.exit !== undefined) return resolve(r.exit); r.proc.once('close', resolve); setTimeout(() => resolve(null), 45000); });
    const said = lastLine(r.out.slice(before));
    if (exit !== 0) {
      r.state = 'failed';
      r.error = /400|invalid/i.test(said) ? 'That code didn’t work. A code only works with the link from the same attempt, copied whole (it’s long and ends after a #). Start again for a fresh link.' : (said || 'Sign-in didn’t finish.');
      stop(r);
      return view(r);
    }
    await finish(r);
    return view(r);
  }
  async function finish(r) {
    r.state = 'checking';
    const cfg = config(), a = acc.findAccount(cfg, r.accountId);
    afterSignIn(a);
    const st = await acc.verify(cfg, a, { maxAgeMs: 0 }).catch(() => null);
    r.signedInAs = st && st.email ? st.email : (acc.signInInfo(a) || {}).email || null;
    r.state = 'done';
    if (r.email && r.signedInAs && !acc.sameEmail(r.email, r.signedInAs)) { r.state = 'wrong'; r.error = `It signed in as ${r.signedInAs}, not ${r.email}. The browser used the claude.ai account it was signed in to. Start again and open the link in a private window.`; }
    log(`Lite: ${a.name} signed in as ${r.signedInAs || 'unknown'}`);
  }
  function status(id) { const r = runs.get(id); if (!r) throw Object.assign(new Error('That sign-in isn’t running any more.'), { status: 404 }); return view(r); }
  function cancel(id) { const r = runs.get(id); if (r) { stop(r); runs.delete(id); } return { ok: true }; }
  return { start, code, cancel, status };
}

module.exports = { createSignin, URL_RE, captureScript };
