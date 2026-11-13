'use strict';
// Latitude's 1Password tokens on this PC. Latitude's local tools find AWS (feedback saves, game states) and their
// other secrets through 1Password service-account tokens in the clone's .env.local; nobody needs an AWS user of
// their own. This fills those tokens from your own 1Password (the 1Password app plus its CLI, `op`, which asks
// Windows Hello or your password), writes them to .env.local, and checks they work with the 1Password library
// the clone already has. The values never leave this PC's .env.local files: they aren't logged, shown, sent to the
// page or given to chats.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

// Each token, the vault it lives in (by name: Latitude calls it Dev_Secrets, and Agents or Agent Tools), and
// what it's for. The item in the vault has the variable's own name (Latitude's README says so for the agent ones).
const TOKENS = [
  { key: 'ONEPASS_TOKEN', vault: /dev[ _-]?secrets/i, vaultName: 'Dev_Secrets', service: true },
  { key: 'ONEPASS_CONNECT_TOKEN', vault: /dev[ _-]?secrets/i, vaultName: 'Dev_Secrets' },
  { key: 'ONEPASS_AGENT_TOKEN', vault: /^agent/i, vaultName: 'Agents', service: true },
  { key: 'ONEPASS_AGENT_VAULT_ID', vault: /^agent/i, vaultName: 'Agents' },
];
// Left as it is when it's there (Latitude's team asks that); taken from .env.local.example when it isn't.
const VAULT_ID = 'ONEPASS_VAULT_ID';
const KEYS = [...TOKENS.map(t => t.key), VAULT_ID];
// The values .env.local.example ships with, which aren't real ones.
const PLACEHOLDER = /^(?:ops_)?\.\.\.|your_|^$/i;

/* ---------- .env.local ---------- */

// KEY=value lines (the first of each key), without quotes.
function readEnv(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}
const real = v => typeof v === 'string' && !PLACEHOLDER.test(v.trim());

// The text with these keys set: each existing line replaced where it is, the rest added at the end.
function mergeEnv(text, values) {
  const nl = /\r\n/.test(text || '') ? '\r\n' : '\n';
  const lines = String(text || '').split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const left = new Map(Object.entries(values));
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(lines[i]);
    if (m && left.has(m[1])) { lines[i] = `${m[1]}=${left.get(m[1])}`; left.delete(m[1]); }
  }
  if (left.size) {
    if (lines.length && lines[lines.length - 1].trim()) lines.push('');
    lines.push('# Latitude’s 1Password tokens (Session Switcher filled these from 1Password: Your work → This PC)');
    for (const [k, v] of left) lines.push(`${k}=${v}`);
  }
  return lines.join(nl) + nl;
}
// A value that can go on one KEY=value line as it is.
const safeValue = v => typeof v === 'string' && v.length > 0 && v.length < 20000 && !/[\s"'`$\\]/.test(v);

/* ---------- running things ---------- */

const run = (file, args, opts = {}) => new Promise(resolve => {
  execFile(file, args, { timeout: 30000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...opts }, (err, out, errText) =>
    resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, out: String(out || ''), err: String(errText || '').trim(), killed: !!(err && err.killed) }));
});
// Nothing of a token in what's shown or logged.
const scrub = s => String(s || '').replace(/\bops_[A-Za-z0-9_\-+/=.]{8,}/g, 'ops_…').replace(/\beyJ[A-Za-z0-9_\-.]{20,}/g, '…').slice(0, 300);

// The 1Password CLI: on PATH, or where its installers put it (this app may have started before it was installed).
function findOp({ env = process.env, platform = process.platform } = {}) {
  const exe = platform === 'win32' ? 'op.exe' : 'op';
  const dirs = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    dirs.push(path.join(local, 'Microsoft', 'WinGet', 'Links'), path.join(env.ProgramFiles || 'C:\\Program Files', '1Password CLI'));
    try {
      const pk = path.join(local, 'Microsoft', 'WinGet', 'Packages');
      for (const d of fs.readdirSync(pk)) if (/^AgileBits\.1Password\.CLI/i.test(d)) dirs.push(path.join(pk, d));
    } catch { /* no winget packages */ }
  } else dirs.push('/usr/local/bin', '/opt/homebrew/bin');
  for (const d of dirs) { const f = path.join(d, exe); try { if (fs.statSync(f).isFile()) return f; } catch { /* not here */ } }
  return null;
}
// op, signed in through the 1Password app (never a service account token from this app's environment).
function opEnv(env = process.env) {
  const e = { ...env };
  for (const k of Object.keys(e)) if (/^OP_(SERVICE_ACCOUNT_TOKEN|CONNECT_|SESSION)/i.test(k)) delete e[k];
  return e;
}
async function opJson(op, args, env, timeout = 30000) {
  const r = await run(op, [...args, '--format', 'json'], { env: opEnv(env), timeout });
  if (r.code !== 0) {
    const msg = scrub(r.err) || (r.killed ? 'it timed out (was a 1Password prompt left open?)' : `exit ${r.code}`);
    throw Object.assign(new Error(msg), { op: true });
  }
  try { return JSON.parse(r.out || 'null'); } catch { throw new Error('1Password’s CLI gave an answer this app can’t read.'); }
}
const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
// The field holding an item's secret: its password, else a field named for one, else its only concealed field.
function secretOf(item) {
  const fields = (item && item.fields || []).filter(f => typeof f.value === 'string' && f.value);
  return (fields.find(f => f.purpose === 'PASSWORD')
    || fields.find(f => /^(password|credential|token|value|secret)$/i.test(f.label || f.id || ''))
    || fields.filter(f => f.type === 'CONCEALED')[0] || {}).value || null;
}

// The tokens from your 1Password: { values, found: [{ key, vault }], notFound: [{ key, vaultName }] }.
async function fromOp(op, { env = process.env } = {}) {
  // The first call may wait on Windows Hello or your 1Password password.
  const vaults = await opJson(op, ['vault', 'list'], env, 180000);
  const values = {}, found = [], notFound = [];
  const items = new Map();   // vault id -> its items
  const itemsOf = async v => { if (!items.has(v.id)) items.set(v.id, await opJson(op, ['item', 'list', '--vault', v.id], env)); return items.get(v.id); };
  for (const t of TOKENS) {
    // Its own vault first, then any other you can see.
    const order = [...vaults.filter(v => t.vault.test(v.name)), ...vaults.filter(v => !t.vault.test(v.name))];
    let got = null;
    for (const v of order) {
      const hit = (await itemsOf(v)).find(i => norm(i.title) === t.key);
      if (!hit) continue;
      const value = secretOf(await opJson(op, ['item', 'get', hit.id, '--vault', v.id, '--reveal'], env));
      if (value && safeValue(value.trim())) { got = { value: value.trim(), vault: v.name }; break; }
    }
    if (got) { values[t.key] = got.value; found.push({ key: t.key, vault: got.vault }); } else notFound.push({ key: t.key, vaultName: t.vaultName });
  }
  return { values, found, notFound, vaults: vaults.map(v => v.name) };
}

/* ---------- do they work? ---------- */

// Asks 1Password with each service-account token (through the clone's own @1password/sdk), and whether each vault
// ID is one that token can see. { [key]: { ok, error? } }, or null when the clone's dependencies aren't installed.
const VERIFY = `
const { createRequire } = require('module');
const path = require('path');
(async () => {
  let sdk; try { sdk = createRequire(path.join(process.cwd(), 'package.json'))('@1password/sdk'); } catch { console.log('null'); return; }
  const out = {};
  for (const [key, vaultKey] of [['ONEPASS_TOKEN', 'ONEPASS_VAULT_ID'], ['ONEPASS_AGENT_TOKEN', 'ONEPASS_AGENT_VAULT_ID']]) {
    const auth = process.env['SS_' + key];
    if (!auth) continue;
    try {
      const c = await sdk.createClient({ auth, integrationName: 'Session Switcher', integrationVersion: '1.0' });
      const ids = (await c.vaults.list()).map(v => v.id);
      out[key] = { ok: true };
      const want = process.env['SS_' + vaultKey];
      if (want) out[vaultKey] = ids.includes(want) ? { ok: true } : { ok: false, error: 'not a vault this token can open' };
    } catch (e) { out[key] = { ok: false, error: String(e && e.message || e) }; }
  }
  console.log(JSON.stringify(out));
})();`;
const verified = new Map();   // hash of the values -> { at, result }
async function verify(root, values, { env = process.env, fresh = false } = {}) {
  const pass = {};
  for (const k of ['ONEPASS_TOKEN', 'ONEPASS_AGENT_TOKEN', VAULT_ID, 'ONEPASS_AGENT_VAULT_ID']) if (real(values[k])) pass[`SS_${k}`] = values[k];
  if (!pass.SS_ONEPASS_TOKEN && !pass.SS_ONEPASS_AGENT_TOKEN) return {};
  const id = crypto.createHash('sha256').update(root + JSON.stringify(pass)).digest('hex');
  const hit = verified.get(id);
  if (!fresh && hit && Date.now() - hit.at < 60 * 60000) return hit.result;
  const r = await run('node', ['-e', VERIFY], { cwd: root, env: { ...env, ...pass }, timeout: 45000 });
  let result = null;
  try { result = JSON.parse(r.out.trim().split(/\r?\n/).pop()); } catch { result = { error: scrub(r.err) || 'The check didn’t finish.' }; }
  if (result && typeof result === 'object') for (const v of Object.values(result)) if (v && v.error) v.error = scrub(v.error);
  verified.set(id, { at: Date.now(), result });
  return result;
}
const revoked = e => /\b40[13]\b|unauthori|forbidden|invalid|revoked|expired|signature/i.test(String(e || ''));

/* ---------- writing them ---------- */

// The clone's other checkouts (git worktrees) that have a .env.local of their own: theirs gets the same tokens, or
// they'd keep the old ones (Latitude's scripts only fall back to the main checkout's when a worktree has none).
async function worktreeEnvs(root) {
  const r = await run('git', ['-C', root, 'worktree', 'list', '--porcelain']);
  const dirs = [...r.out.matchAll(/^worktree (.+)$/gm)].map(m => path.resolve(m[1].trim()));
  const self = path.resolve(root).toLowerCase();
  return dirs.filter(d => d.toLowerCase() !== self).map(d => path.join(d, '.env.local')).filter(f => fs.existsSync(f));
}
// Sets the tokens in the clone's .env.local (made from the example if there's none) and the worktrees' copies.
async function save(root, values) {
  const set = {};
  for (const k of KEYS) if (Object.hasOwn(values, k) && values[k] != null && String(values[k]).trim()) {
    const v = String(values[k]).trim();
    if (!safeValue(v)) throw Object.assign(new Error(`${k} doesn’t look like a 1Password value (it has spaces or quotes).`), { status: 400 });
    set[k] = v;
  }
  const file = path.join(root, '.env.local');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* none yet */ }
  const have = readEnv(text);
  // The vault ID stays as it is; when there's none, the example's (Latitude's team keeps the right one there).
  if (!real(have[VAULT_ID]) && !set[VAULT_ID]) {
    try { const ex = readEnv(fs.readFileSync(path.join(root, '.env.local.example'), 'utf8'))[VAULT_ID]; if (real(ex) && safeValue(ex)) set[VAULT_ID] = ex; } catch { /* no example */ }
  }
  if (!Object.keys(set).length) return { file, keys: [], worktrees: 0 };
  writeKeeping(file, mergeEnv(text, set));
  let worktrees = 0;
  for (const f of await worktreeEnvs(root)) {
    try {
      const t = fs.readFileSync(f, 'utf8'), theirs = readEnv(t);
      // Only the keys this one has (a copy without the agent ones doesn't gain them), plus the tokens it lacks.
      const sub = Object.fromEntries(Object.entries(set).filter(([k]) => k in theirs || k !== VAULT_ID));
      writeKeeping(f, mergeEnv(t, sub)); worktrees++;
    } catch { /* that one's left as it was */ }
  }
  return { file, keys: Object.keys(set), worktrees };
}
// Written through a temporary file beside it, so a crash never leaves half a .env.local.
function writeKeeping(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/* ---------- the row on This PC ---------- */

// { id: 'onepass', label, state, detail, fix } for the setup check.
async function check(root, { env = process.env, platform = process.platform, fresh = false, verifyFn = verify } = {}) {
  let text = ''; try { text = fs.readFileSync(path.join(root, '.env.local'), 'utf8'); } catch { /* none */ }
  const have = readEnv(text);
  const missing = KEYS.filter(k => !real(have[k]));
  const op = findOp({ env, platform });
  const how = op ? 'Fill from 1Password reads them from your vaults (Dev_Secrets and Agents).' : 'Install the 1Password app and its CLI (winget install AgileBits.1Password.CLI), turn on Settings → Developer → Integrate with 1Password CLI, then Fill from 1Password.';
  const row = (state, detail) => ({ id: 'onepass', label: '1Password (AWS and feedback saves)', state, detail, fix: state === 'ok' ? null : 'onepass', op: !!op });
  if (missing.length) return row('fix', `Missing from .env.local: ${missing.join(', ')}. Latitude’s local tools get AWS through these; no AWS user of your own is needed. ${how}`);
  let v = null;
  try { v = await verifyFn(root, have, { env, fresh }); } catch { v = null; }
  if (!v) return row('info', 'All in .env.local. They couldn’t be tested: the clone’s dependencies (yarn) aren’t installed.');
  if (v.error) return row('info', `All in .env.local, but the test didn’t finish: ${v.error}`);
  const bad = Object.entries(v).filter(([, x]) => x && !x.ok);
  if (bad.length) return row('fix', `${bad.map(([k, x]) => `${k}: ${revoked(x.error) ? '1Password refused it (an old or revoked one?)' : x.error}`).join('; ')}. ${how}`);
  return row('ok', 'In .env.local, and 1Password accepts them. Agents can reach AWS (feedback saves) through them.');
}

module.exports = { TOKENS, KEYS, VAULT_ID, readEnv, mergeEnv, safeValue, secretOf, findOp, fromOp, verify, save, check, worktreeEnvs, scrub };
