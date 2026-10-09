'use strict';
// Extra Codex accounts. Codex keeps everything in CODEX_HOME (~/.codex): the ChatGPT sign-in
// (auth.json) next to the chats, the thread index (state_*.sqlite), config, skills and so on.
// An extra account gets a home of its own, ~/.codex-<id>, with its own auth.json, and links to
// everything else in the main home, so all accounts see one chat list and one history. (SQLite
// resolves the links, so its -wal/-shm files stay beside the real database and locking works.)
//
// What stays per account: the sign-in, and the files a running Codex keeps for itself (its
// daemon socket, process bookkeeping, logs, caches, temporary files). Sharing the daemon socket
// would let one account's Codex talk to another account's daemon, signed in as someone else.
//
// An Ollama account is the same, plus a config.toml of its own that points Codex at the Ollama
// app on this computer (cloud models through your ollama.com account), the way `ollama launch
// codex` does. It needs no ChatGPT sign-in.

const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./store');

const HOME = os.homedir();
const MAIN_HOME = () => process.env.CODEX_HOME || path.join(HOME, '.codex');
const OLLAMA_URL = 'http://127.0.0.1:11434';

// Never linked: the sign-in, and what each running Codex keeps for itself.
const OWN = new Set(['auth.json', 'ipc', 'app-server-daemon', 'process_manager', '.tmp', 'tmp', 'log', 'cache',
  'installation_id', 'models_cache.json', 'version.json', '.codex-global-state.json', '.codex-global-state.json.bak']);
const isOwn = name => OWN.has(name) || /^logs_\d+\.sqlite/.test(name) || /\.sqlite-(wal|shm|journal)$/.test(name) || /\.tmp$/.test(name);

const slug = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'account';
const homeFor = id => path.join(HOME, `.${id}`); // id is "codex-<slug>", so ~/.codex-<slug>

// The provider block `ollama launch codex` writes. If the main home already has the
// ollama-launch.config.toml that `ollama launch codex` leaves behind, that file is used instead.
function ollamaConfig(model) {
  return [
    '# Written by Session Switcher: Codex through the Ollama app on this computer (ollama.com cloud models).',
    `model = "${model || 'gpt-oss:120b-cloud'}"`,
    'model_provider = "ollama-launch"',
    '',
    '[model_providers.ollama-launch]',
    'name = "Ollama"',
    `base_url = "${OLLAMA_URL}/v1/"`,
    'wire_api = "responses"',
    '',
  ].join('\n');
}

// Makes sure an extra account's home exists and links to the main home. Never overwrites or
// deletes anything: an entry that's already there (a link, or a file Codex replaced) is left alone.
function ensureHome(acct, mainHome = MAIN_HOME()) {
  const done = [], separate = [], errors = [];
  if (!acct || !acct.home) return { done, separate, errors };
  fs.mkdirSync(acct.home, { recursive: true, mode: 0o700 });
  let entries = [];
  try { entries = fs.readdirSync(mainHome); } catch (err) { errors.push(`${mainHome}: ${err.message}`); }
  for (const name of entries) {
    if (isOwn(name)) continue;
    if (acct.kind === 'ollama' && name === 'config.toml') continue; // it has its own
    const dest = path.join(acct.home, name);
    const st = store.lstatOrNull(dest);
    if (st) { if (!st.isSymbolicLink()) separate.push(name); continue; }
    try { fs.symlinkSync(path.join(mainHome, name), dest); done.push(name); } catch (err) { errors.push(`${name}: ${err.message}`); }
  }
  if (acct.kind === 'ollama') {
    const cfgFile = path.join(acct.home, 'config.toml');
    if (!store.lstatOrNull(cfgFile)) {
      const launch = path.join(mainHome, 'ollama-launch.config.toml');
      try {
        if (fs.existsSync(launch)) fs.copyFileSync(launch, cfgFile);
        else fs.writeFileSync(cfgFile, ollamaConfig(), { mode: 0o600 });
        done.push('config.toml (Ollama)');
      } catch (err) { errors.push(`config.toml: ${err.message}`); }
    }
  }
  return { done, separate, errors };
}

// Is the Ollama app running, and which ollama.com account is it signed in to?
async function ollamaStatus() {
  const get = async (p, ms = 2500) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try { const r = await fetch(OLLAMA_URL + p, { signal: ctl.signal }); return r.ok ? r.json() : null; } catch { return null; } finally { clearTimeout(t); }
  };
  const version = await get('/api/version');
  if (!version) return { running: false, error: 'The Ollama app isn’t running. Start it (or run “ollama serve”), then check again.' };
  const me = await fetch(`${OLLAMA_URL}/api/me`, { method: 'POST' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const tags = await get('/api/tags');
  const cloud = ((tags && tags.models) || []).map(m => m.name || m.model).filter(n => /cloud/i.test(n || ''));
  return { running: true, version: version.version || null, email: (me && (me.email || me.name)) || null, signedIn: !!(me && (me.email || me.name)), plan: (me && me.plan) || null, cloudModels: cloud };
}

module.exports = { ensureHome, homeFor, slug, isOwn, ollamaStatus, ollamaConfig, MAIN_HOME, OLLAMA_URL };
