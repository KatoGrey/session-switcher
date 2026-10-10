'use strict';
// Signing a Claude account in from Switcher Lite, without a terminal: `claude auth login` runs in
// the background as that account; the page shows its link (to copy or open in the right browser)
// and a box for the code the browser shows; the code goes to the same login, and the account is
// checked afterwards. The browser isn't opened by itself, so you can pick a window that's signed in
// to the right claude.ai account (the default one often isn't).

const cp = require('child_process');
const crypto = require('crypto');

const URL_RE = /(https:\/\/claude\.(?:com|ai)\/[^\s]*oauth\/authorize\?[^\s]+)/;
const strip = s => String(s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

function createSignin({ log = () => {}, config, acc, overrideVars = [], afterSignIn = () => {} }) {
  const runs = new Map(); // id -> run

  function envFor(cfg, a) {
    const env = { ...process.env, BROWSER: '/usr/bin/true' };
    if (a.isDefault) delete env.CLAUDE_CONFIG_DIR; else env.CLAUDE_CONFIG_DIR = a.configDir;
    if (cfg.prefs && cfg.prefs.cleanEnv) for (const v of overrideVars) delete env[v];
    return env;
  }
  const view = r => ({ id: r.id, account: r.accountId, email: r.email, url: r.url, state: r.state, error: r.error, signedInAs: r.signedInAs || null });

  function stop(r) { if (r.proc && r.proc.exitCode === null) { try { process.kill(-r.proc.pid, 'SIGTERM'); } catch { try { r.proc.kill(); } catch { /* gone */ } } } clearTimeout(r.timer); }

  // Starts a login and resolves once its link is known.
  function start(accountId) {
    const cfg = config();
    const a = acc.findAccount(cfg, accountId);
    for (const r of runs.values()) if (r.accountId === a.id) { stop(r); runs.delete(r.id); }
    if (!a.isDefault) acc.ensureLinks(cfg, a);
    const email = a.expectEmail || null;
    const args = ['auth', 'login', ...(email ? ['--email', email] : [])];
    // The command and its arguments are passed as separate words, so nothing in them is read as shell syntax.
    const proc = cp.spawn('sh', ['-c', 'exec "$0" "$@"', cfg.claudeCommand || 'claude', ...args], { env: envFor(cfg, a), cwd: require('os').homedir(), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    const r = { id: crypto.randomBytes(6).toString('hex'), accountId: a.id, email, proc, url: null, state: 'starting', error: null, out: '' };
    runs.set(r.id, r);
    const onData = d => { r.out = (r.out + strip(d)).slice(-8000); const m = URL_RE.exec(r.out); if (m && !r.url) { r.url = m[1]; r.state = 'waiting'; } };
    proc.stdout.on('data', onData); proc.stderr.on('data', onData);
    proc.on('error', err => { r.state = 'failed'; r.error = err.message; });
    proc.on('close', code => { r.exit = code; if (r.state !== 'done') { r.state = 'failed'; r.error = r.error || lastLine(r.out) || `It stopped (${code}).`; } });
    proc.stdin.on('error', () => {});
    r.timer = setTimeout(() => { if (r.state === 'waiting' || r.state === 'starting') { r.state = 'failed'; r.error = 'That sign-in waited too long. Start again.'; stop(r); } }, 10 * 60e3);
    r.timer.unref && r.timer.unref();
    log(`Lite: signing in ${a.name}${email ? ` (${email})` : ''}`);
    return new Promise(resolve => {
      const t0 = Date.now();
      const tick = () => (r.url || r.state === 'failed' || Date.now() - t0 > 20000 ? resolve(view(r)) : setTimeout(tick, 150));
      tick();
    });
  }
  const lastLine = s => strip(s).split('\n').map(x => x.trim()).filter(Boolean).filter(x => !/^Paste code here/i.test(x)).pop() || '';

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
    r.state = 'done';
    const cfg = config(), a = acc.findAccount(cfg, r.accountId);
    afterSignIn(a);
    const st = await acc.verify(cfg, a, { maxAgeMs: 0 }).catch(() => null);
    r.signedInAs = st && st.email ? st.email : (acc.signInInfo(a) || {}).email || null;
    if (r.email && r.signedInAs && !acc.sameEmail(r.email, r.signedInAs)) { r.state = 'wrong'; r.error = `It signed in as ${r.signedInAs}, not ${r.email}. The browser used the claude.ai account it was signed in to. Start again and open the link in a private window.`; }
    log(`Lite: ${a.name} signed in as ${r.signedInAs || 'unknown'}`);
    return view(r);
  }
  function cancel(id) { const r = runs.get(id); if (r) { stop(r); runs.delete(id); } return { ok: true }; }
  return { start, code, cancel };
}

module.exports = { createSignin, URL_RE };
