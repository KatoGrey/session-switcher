'use strict';
// Accounts: where each one keeps its sign-in, who it is signed in as (verified through
// Claude Code's own `claude auth status`), plan locks, and keeping extra accounts in step
// with the main one (shared chats, checkpoints, tasks, settings, MCP servers, folder trust).

const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./store');
const sys = require('./system');

const HOME = os.homedir();

// Folders every extra account shares with the main one. Chats live in projects/, and a resumed
// chat also needs its checkpoints (file-history/), task lists (tasks/) and plans (plans/).
const SHARED_DIRS = ['projects', 'file-history', 'tasks', 'plans', 'agents', 'commands', 'skills', 'rules', 'output-styles', 'plugins'];
// Files copied from the main account whenever the main copy is newer.
const SYNCED_FILES = ['settings.json', 'CLAUDE.md', 'keybindings.json'];
// Per-folder state in .claude.json worth carrying over: trust, approved tools, MCP servers.
const PROJECT_KEYS = ['hasTrustDialogAccepted', 'allowedTools', 'mcpServers', 'enabledMcpjsonServers', 'disabledMcpjsonServers',
  'mcpContextUris', 'hasClaudeMdExternalIncludesApproved', 'hasClaudeMdExternalIncludesWarningShown', 'hasCompletedProjectOnboarding'];

const DEFAULT_PREFS = { terminal: 'auto', syncSettings: true, syncState: true, cleanEnv: true, appWindow: true, openIn: 'app' };
const TERMINALS = ['auto', 'wt-tab', 'wt-window', 'console'];

// ---------- config ----------

function loadConfig(file, log) {
  const raw = store.loadOwnJson(file, {}, log) || {};
  const cfg = { ...raw };
  cfg.mainConfigDir = raw.mainConfigDir || path.join(HOME, '.claude');
  cfg.claudeCommand = raw.claudeCommand || 'claude';
  cfg.prefs = { ...DEFAULT_PREFS, ...(raw.prefs || {}) };
  if (!TERMINALS.includes(cfg.prefs.terminal)) cfg.prefs.terminal = 'auto';
  cfg.accounts = Array.isArray(raw.accounts) ? raw.accounts.filter(a => a && a.id && a.configDir && a.name) : [];
  const cx = raw.codex && typeof raw.codex === 'object' ? raw.codex : {};
  cfg.codex = { enabled: cx.enabled !== false, command: typeof cx.command === 'string' && cx.command.trim() ? cx.command.trim() : 'codex', home: typeof cx.home === 'string' && cx.home.trim() ? cx.home.trim() : null };
  if (!cfg.accounts.some(a => a.isDefault)) {
    cfg.accounts.unshift({ id: 'main', name: 'Main account', configDir: cfg.mainConfigDir, isDefault: true });
  }
  return cfg;
}

function saveConfig(file, cfg) {
  store.writeJsonAtomic(file, cfg, { keepBackup: true });
}

function findAccount(cfg, id) {
  const a = cfg.accounts.find(x => x.id === id);
  if (!a) throw Object.assign(new Error('That account isn’t in the list any more. Refresh the page.'), { status: 400 });
  return a;
}

// ---------- who is it signed in as ----------

function planLabel(sub, tier) {
  const t = `${sub || ''} ${tier || ''}`.toLowerCase();
  if (t.includes('20x')) return 'Max 20x';
  if (t.includes('5x')) return 'Max 5x';
  const s = String(sub || '').toLowerCase().replace(/^claude[_ ]?/, '');
  const map = { max: 'Max', pro: 'Pro', team: 'Team', enterprise: 'Enterprise', free: 'Free' };
  for (const k of Object.keys(map)) if (s === k || s.startsWith(k)) return map[k];
  return s ? s[0].toUpperCase() + s.slice(1) : null;
}

const kindOf = sub => {
  const s = String(sub || '').toLowerCase();
  return s ? (/team|enterprise/.test(s) ? 'team' : 'personal') : null;
};

// Reads only non-secret fields from Claude Code's files. Tokens never leave this function.
function signInFromFiles(a) {
  const cred = store.readJson(path.join(a.configDir, '.credentials.json'));
  const oauth = (cred && cred.claudeAiOauth) || null;
  const candidates = a.isDefault
    ? [path.join(HOME, '.claude.json'), path.join(a.configDir, '.claude.json')]
    : [path.join(a.configDir, '.claude.json')];
  let acct = null;
  for (const c of candidates) {
    const j = store.readJson(c);
    if (j && j.oauthAccount) { acct = j.oauthAccount; break; }
  }
  return {
    signedIn: !!(oauth && (oauth.accessToken || oauth.refreshToken)),
    email: (acct && acct.emailAddress) || null,
    orgName: (acct && acct.organizationName) || null,
    orgId: (acct && acct.organizationUuid) || null,
    subscription: (oauth && oauth.subscriptionType) || null,
    tier: (oauth && oauth.rateLimitTier) || null,
  };
}

// `claude auth status` prints JSON; its exact field names aren't documented, so look for them by meaning.
function parseStatus(stdout, code) {
  const text = String(stdout || '');
  const start = text.indexOf('{');
  let j = null;
  if (start >= 0) { try { j = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1)); } catch { j = null; } }
  if (!j || typeof j !== 'object') return null;
  const flat = [];
  (function walk(o, prefix) {
    for (const [k, v] of Object.entries(o)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, key);
      else flat.push([key, v]);
    }
  })(j, '');
  const find = re => { const hit = flat.find(([k, v]) => re.test(k) && typeof v === 'string' && v.trim()); return hit ? hit[1].trim() : null; };
  const bool = re => { const hit = flat.find(([k, v]) => re.test(k) && typeof v === 'boolean'); return hit ? hit[1] : null; };
  const loggedIn = bool(/(^|\.)(loggedIn|isLoggedIn|authenticated|signedIn)$/i);
  return {
    ok: true,
    loggedIn: loggedIn !== null ? loggedIn : code === 0,
    authMethod: find(/(^|\.)authMethod$/i),
    email: find(/email/i),
    orgName: find(/org[a-z]*[._]?name$/i),
    orgId: find(/org[a-z]*[._]?(uuid|id)$/i),
    subscription: find(/(subscription[a-z]*|plan[a-z]*)$/i),
    configDirectory: find(/configDirectory$/i),
  };
}

const statusCache = new Map(); // account id -> { at, sig, value, pending }

// Fingerprint of the files a sign-in writes. If any changes, a cached check is out of date.
function signInFiles(a) {
  return [path.join(a.configDir, '.credentials.json'), path.join(a.configDir, '.claude.json'), ...(a.isDefault ? [path.join(HOME, '.claude.json')] : [])];
}
function filesSig(a) {
  return signInFiles(a).map(p => { const st = store.statOrNull(p); return st ? `${st.mtimeMs}:${st.size}` : '-'; }).join('|');
}

async function fetchStatus(cfg, a) {
  const r = await sys.runClaude(cfg, a, 'auth status', { timeoutMs: 25000 });
  const parsed = parseStatus(r.stdout, r.code);
  if (parsed) return { ...parsed, at: Date.now() };
  const why = r.timedOut ? 'Claude Code took too long to answer.' : (r.stderr || r.stdout || '').trim().split(/\r?\n/).pop() || 'No answer from Claude Code.';
  return { ok: false, error: why.slice(0, 240), at: Date.now() };
}

// Asks Claude Code who this account is signed in as. Cached; concurrent callers share one run.
function verify(cfg, a, { maxAgeMs = 60000 } = {}) {
  const hit = statusCache.get(a.id) || {};
  const sig = filesSig(a);
  if (hit.value && hit.sig === sig && Date.now() - hit.at < maxAgeMs) return Promise.resolve(hit.value);
  if (hit.pending && hit.pendingSig === sig) return hit.pending;
  const pending = fetchStatus(cfg, a)
    .catch(err => ({ ok: false, error: err.message, at: Date.now() }))
    .then(value => { statusCache.set(a.id, { at: Date.now(), sig, value }); return value; });
  statusCache.set(a.id, { ...hit, pending, pendingSig: sig });
  return pending;
}
// A cached answer only counts while the sign-in files are unchanged since it was taken.
const cachedStatus = a => { const h = statusCache.get(a.id); return h && h.value && h.sig === filesSig(a) ? h.value : null; };
const statusAge = a => { const h = statusCache.get(a.id); return h && h.value && h.sig === filesSig(a) ? Date.now() - h.at : Infinity; };
const forgetStatus = id => statusCache.delete(id);

function signInInfo(a) {
  const f = signInFromFiles(a);
  const st = cachedStatus(a);
  const fromFiles = {
    signedIn: f.signedIn, authMethod: f.signedIn ? 'claude.ai' : 'none', email: f.email, orgName: f.orgName, orgId: f.orgId,
    plan: f.signedIn ? planLabel(f.subscription, f.tier) : null, kind: f.signedIn ? kindOf(f.subscription) : null,
    verified: false, verifiedAt: null, verifyError: st && !st.ok ? st.error : null,
  };
  if (!st || !st.ok) return fromFiles;
  const sub = st.subscription || f.subscription;
  return {
    signedIn: !!st.loggedIn,
    authMethod: st.authMethod || (st.loggedIn ? 'claude.ai' : 'none'),
    email: st.loggedIn ? (st.email || f.email) : null,
    orgName: st.loggedIn ? (st.orgName || f.orgName) : null,
    orgId: st.loggedIn ? (st.orgId || f.orgId) : null,
    plan: st.loggedIn ? planLabel(sub, f.tier) : null,
    kind: st.loggedIn ? kindOf(sub) : null,
    verified: true, verifiedAt: st.at, verifyError: null,
  };
}

const sameEmail = (x, y) => String(x || '').trim().toLowerCase() === String(y || '').trim().toLowerCase();
// authMethod is documented as none, claude.ai, oauth_token, api_key, api_key_helper or third_party.
const isSubscriptionLogin = m => !m || /claude\.ai/i.test(m);

function lockCheck(a, info) {
  const pin = a.pinnedOrg;
  if (!pin && !a.expectEmail) return { ok: true };
  if (!info.signedIn) return { ok: false, reason: 'signed-out' };
  if (!isSubscriptionLogin(info.authMethod)) return { ok: false, reason: 'not-subscription' };
  if (a.expectEmail) {
    if (!info.email) return { ok: false, reason: 'unknown' };
    if (!sameEmail(a.expectEmail, info.email)) return { ok: false, reason: 'wrong-account' };
  }
  if (!pin) return { ok: true };
  if (pin.id && info.orgId) return info.orgId === pin.id ? { ok: true } : { ok: false, reason: 'wrong-org' };
  if (pin.kind && info.kind) return info.kind === pin.kind ? { ok: true } : { ok: false, reason: 'wrong-org' };
  return { ok: false, reason: 'unknown' };
}

function lockError(a, info, reason) {
  const pin = a.pinnedOrg || {};
  const target = pin.name || 'its locked plan';
  const who = a.expectEmail || 'the right account';
  switch (reason) {
    case 'signed-out': return `${a.name} isn’t signed in. Sign in as ${who}${a.pinnedOrg ? ` and choose ${target}` : ''}.`;
    case 'wrong-account': return `${a.name} is signed in as ${info.email}, not ${a.expectEmail}. Sign in as ${a.expectEmail} to open chats with it.`;
    case 'not-subscription': return `${a.name} is using ${info.authMethod === 'api_key' ? 'an API key' : 'a token'} instead of a Claude subscription sign-in. Sign in as ${who} to fix it.`;
    case 'wrong-org': return `${a.name} is signed into ${info.orgName || 'a different organization'}${info.plan ? ` (${info.plan})` : ''}, not ${target}. Sign in again and choose ${target}.`;
    default: return `Can’t confirm which account ${a.name} is signed into. Sign in again as ${who}.`;
  }
}

// ---------- sharing with the main account ----------

function sharingReport(cfg, a) {
  if (a.isDefault) return SHARED_DIRS.map(dir => ({ dir, state: 'main' }));
  return SHARED_DIRS.map(dir => {
    const main = path.join(cfg.mainConfigDir, dir);
    const dest = path.join(a.configDir, dir);
    const l = store.lstatOrNull(dest);
    if (!l) return { dir, state: 'missing' };
    const rm = store.realOrNull(main), rd = store.realOrNull(dest);
    return { dir, state: rm && rd === rm ? 'shared' : 'separate' };
  });
}

function link(target, at) {
  fs.symlinkSync(target, at, sys.IS_WIN ? 'junction' : 'dir');
}

// Creates any missing links. Never touches a folder that already exists.
function ensureLinks(cfg, a) {
  const done = [], errors = [];
  if (a.isDefault) return { done, errors };
  fs.mkdirSync(a.configDir, { recursive: true });
  for (const dir of SHARED_DIRS) {
    const main = path.join(cfg.mainConfigDir, dir);
    const dest = path.join(a.configDir, dir);
    try {
      if (store.lstatOrNull(dest)) continue;
      fs.mkdirSync(main, { recursive: true });
      link(main, dest);
      done.push(dir);
    } catch (err) { errors.push(`${dir}: ${err.message}`); }
  }
  return { done, errors };
}

// Moves entries from src into dst where dst doesn't have them. Nothing is deleted.
function mergeMove(src, dst, stats) {
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name), d = path.join(dst, name);
    const ss = store.lstatOrNull(s), ds = store.lstatOrNull(d);
    if (!ds) {
      try { fs.renameSync(s, d); stats.moved++; }
      catch { try { fs.cpSync(s, d, { recursive: true, errorOnExist: true }); stats.copied++; } catch { stats.conflicts++; } }
    } else if (ss.isDirectory() && ds.isDirectory() && !ss.isSymbolicLink()) {
      mergeMove(s, d, stats);
    } else {
      stats.conflicts++;
    }
  }
}

// Brings an account that kept its own folders back in line with the main account.
function fixSharing(cfg, a) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const result = { linked: [], merged: [], keptAside: [], errors: [], moved: 0, conflicts: 0 };
  if (a.isDefault) return result;
  for (const { dir, state } of sharingReport(cfg, a)) {
    if (state !== 'separate') continue;
    const main = path.join(cfg.mainConfigDir, dir);
    const dest = path.join(a.configDir, dir);
    try {
      fs.mkdirSync(main, { recursive: true });
      const l = fs.lstatSync(dest);
      if (!l.isSymbolicLink()) {
        const stats = { moved: 0, copied: 0, conflicts: 0 };
        mergeMove(dest, main, stats);
        result.moved += stats.moved + stats.copied;
        result.conflicts += stats.conflicts;
        result.merged.push(dir);
      }
      const aside = `${dest}.switcher-old-${stamp}`;
      fs.renameSync(dest, aside);
      result.keptAside.push(aside);
      link(main, dest);
      result.linked.push(dir);
    } catch (err) { result.errors.push(`${dir}: ${err.message}`); }
  }
  const more = ensureLinks(cfg, a);
  result.linked.push(...more.done);
  result.errors.push(...more.errors);
  return result;
}

// Copies settings files from the main account when the main copy is newer.
function syncSettings(cfg, a) {
  const changed = [];
  if (a.isDefault || !cfg.prefs.syncSettings) return changed;
  for (const f of SYNCED_FILES) {
    const src = path.join(cfg.mainConfigDir, f), dest = path.join(a.configDir, f);
    const ss = store.statOrNull(src);
    if (!ss) continue;
    const ds = store.statOrNull(dest);
    if (ds && ss.mtimeMs <= ds.mtimeMs + 1000) continue;
    try {
      if (ds) fs.copyFileSync(dest, `${dest}.switcher-bak`);
      fs.copyFileSync(src, dest);
      fs.utimesSync(dest, ss.atime, ss.mtime);
      changed.push(f);
    } catch { /* leave it; next launch retries */ }
  }
  return changed;
}

function mainStateFile(cfg) {
  return [path.join(HOME, '.claude.json'), path.join(cfg.mainConfigDir, '.claude.json')].find(p => fs.existsSync(p)) || null;
}

// Carries user MCP servers and per-folder trust/tools from the main account's .claude.json.
// Only adds what's missing; never removes or overwrites the account's own values.
function syncState(cfg, a) {
  const out = { mcpServers: [], folders: 0 };
  if (a.isDefault || !cfg.prefs.syncState) return out;
  const srcFile = mainStateFile(cfg);
  const destFile = path.join(a.configDir, '.claude.json');
  if (!srcFile || !fs.existsSync(destFile)) return out;
  const src = store.readJson(srcFile);
  const dest = store.readJson(destFile);
  if (!src || !dest) return out;
  let changed = false;
  const clone = v => JSON.parse(JSON.stringify(v));

  if (src.mcpServers && typeof src.mcpServers === 'object') {
    dest.mcpServers = dest.mcpServers && typeof dest.mcpServers === 'object' ? dest.mcpServers : {};
    for (const [k, v] of Object.entries(src.mcpServers)) {
      if (!(k in dest.mcpServers)) { dest.mcpServers[k] = clone(v); out.mcpServers.push(k); changed = true; }
    }
  }
  if (src.projects && typeof src.projects === 'object') {
    dest.projects = dest.projects && typeof dest.projects === 'object' ? dest.projects : {};
    for (const [folder, entry] of Object.entries(src.projects)) {
      if (!entry || typeof entry !== 'object') continue;
      const had = folder in dest.projects;
      const te = had ? dest.projects[folder] : {};
      let touched = false;
      for (const key of PROJECT_KEYS) {
        if (entry[key] === undefined) continue;
        if (key === 'mcpServers' && te.mcpServers && typeof te.mcpServers === 'object' && typeof entry.mcpServers === 'object') {
          for (const [k, v] of Object.entries(entry.mcpServers)) if (!(k in te.mcpServers)) { te.mcpServers[k] = clone(v); touched = true; }
        } else if (key === 'hasTrustDialogAccepted') {
          if (entry[key] === true && te[key] !== true) { te[key] = true; touched = true; }
        } else if (te[key] === undefined) {
          te[key] = clone(entry[key]); touched = true;
        }
      }
      if (touched) { dest.projects[folder] = te; out.folders++; changed = true; }
    }
  }
  if (!changed) return out;
  const fresh = store.statOrNull(destFile);
  if (fresh && Date.now() - fresh.mtimeMs < 1500) return { mcpServers: [], folders: 0, deferred: true }; // Claude Code is writing it right now; next launch retries.
  try { fs.copyFileSync(destFile, `${destFile}.switcher-bak`); } catch { /* best effort */ }
  store.writeJsonAtomic(destFile, dest);
  return out;
}

// Everything to do right before opening a chat with an extra account.
function prepareForLaunch(cfg, a) {
  if (a.isDefault) return {};
  const links = ensureLinks(cfg, a);
  const settings = syncSettings(cfg, a);
  let state = { mcpServers: [], folders: 0 };
  try { state = syncState(cfg, a); } catch { /* never block a launch on this */ }
  return { links, settings, state };
}

// ---------- account list ----------

function createAccount(cfg, name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'account';
  // A folder left behind by a removed account is reused, so its sign-in comes back with it.
  const inUse = id => cfg.accounts.some(a => a.id === id || a.configDir === path.join(HOME, `.claude-${id}`));
  let id = slug;
  for (let n = 2; inUse(id); n++) id = `${slug}-${n}`;
  const configDir = path.join(HOME, `.claude-${id}`);
  const account = { id, name, configDir };
  fs.mkdirSync(configDir, { recursive: true });
  const links = ensureLinks(cfg, account);
  for (const f of SYNCED_FILES) {
    const src = path.join(cfg.mainConfigDir, f), dest = path.join(configDir, f);
    if (fs.existsSync(src) && !fs.existsSync(dest)) { try { fs.copyFileSync(src, dest); } catch { /* optional */ } }
  }
  cfg.accounts.push(account);
  return { account, links };
}

function publicAccount(cfg, a) {
  const info = signInInfo(a);
  const sharing = sharingReport(cfg, a);
  const lock = lockCheck(a, info);
  return {
    id: a.id, name: a.name, configDir: a.configDir, isDefault: !!a.isDefault,
    ...info,
    expectEmail: a.expectEmail || null,
    pinnedOrg: a.pinnedOrg || null,
    lock,
    lockMessage: lock.ok ? null : lockError(a, info, lock.reason),
    shared: sharing.every(s => s.state === 'shared' || s.state === 'main'),
    sharing,
  };
}

module.exports = {
  SHARED_DIRS, SYNCED_FILES, DEFAULT_PREFS, TERMINALS,
  loadConfig, saveConfig, findAccount, createAccount, publicAccount,
  signInFromFiles, signInInfo, parseStatus, verify, cachedStatus, statusAge, forgetStatus, planLabel,
  lockCheck, lockError, sameEmail,
  sharingReport, ensureLinks, fixSharing, syncSettings, syncState, prepareForLaunch, mainStateFile,
};
