'use strict';
// The models each assistant offers, by their real names, and what a new chat gets by default (model
// and effort), so Lite's model and effort chips say something true before a chat is running.
// Claude: asked once from Claude Code (initialize + get_settings, no message sent). Codex and Ollama:
// from each Codex account's model list. Kept for six hours.

const cp = require('child_process');
const os = require('os');
const readline = require('readline');

const KEEP_MS = 6 * 3600e3;

function askClaude(cfg, account, overrideVars = []) {
  return new Promise(resolve => {
    const env = { ...process.env };
    if (account.isDefault) delete env.CLAUDE_CONFIG_DIR; else env.CLAUDE_CONFIG_DIR = account.configDir;
    if (cfg.prefs && cfg.prefs.cleanEnv) for (const v of overrideVars) delete env[v];
    let p;
    try { p = cp.spawn('sh', ['-c', 'exec "$0" "$@"', cfg.claudeCommand || 'claude', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', '--strict-mcp-config'], { env, cwd: os.homedir(), stdio: ['pipe', 'pipe', 'ignore'], detached: true }); } catch { return resolve(null); }
    const out = { models: [], model: null, effort: null };
    const done = v => { clearTimeout(t); try { p.stdin.end(); } catch { /* closed */ } setTimeout(() => { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* gone */ } }, 300); resolve(v); };
    const t = setTimeout(() => done(out.models.length ? out : null), 25000);
    p.on('error', () => done(null));
    p.stdin.on('error', () => {});
    readline.createInterface({ input: p.stdout }).on('line', line => {
      let m; try { m = JSON.parse(line); } catch { return; }
      if (m.type !== 'control_response' || !m.response) return;
      const r = m.response.response || {};
      if (m.response.request_id === 'm-init') {
        out.models = (r.models || []).filter(x => x && x.value).map(x => ({ value: String(x.value), label: String(x.displayName || x.value), note: String(x.description || ''), efforts: Array.isArray(x.supportedEffortLevels) ? x.supportedEffortLevels : [] }));
        p.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'm-set', request: { subtype: 'get_settings' } }) + '\n');
      } else if (m.response.request_id === 'm-set') {
        const ap = r.applied || {}, eff = r.effective || {};
        out.model = ap.model || eff.model || null;
        out.effort = ap.effort || null;
        done(out);
      }
    });
    p.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'm-init', request: { subtype: 'initialize' } }) + '\n');
  });
}

// The few to offer first: the current Opus, Sonnet and Fable (Claude); everything else under "More".
function shapeClaude(raw) {
  if (!raw) return null;
  const ms = raw.models.filter(m => m.value !== 'default');
  const def = raw.models.find(m => m.value === 'default');
  const defName = def && /^([A-Z][\w]* [\d.]+)/.exec(def.note) ? /^([A-Z][\w]* [\d.]+)/.exec(def.note)[1] : null;
  const main = ['opus', 'sonnet', 'fable'].map(v => ms.find(m => m.value === v)).filter(Boolean);
  const more = ms.filter(m => !main.includes(m));   // the page picks what to offer (ui-lite/chat.js offered)
  // Settings name a model by alias (opus, opus[1m]) or full id; only an exact alias match names it,
  // otherwise the "Default" entry says which model that is.
  const alias = raw.model ? String(raw.model).replace(/\[1m\]$/, '') : null;
  const resolved = alias ? ms.find(m => m.value === alias) || null : null;
  return { models: main, more, defaultModel: resolved ? `${resolved.label}${/\[1m\]$/.test(raw.model) ? ' 1M' : ''}` : defName, defaultEffort: raw.effort, efforts: (main[0] && main[0].efforts.length ? main[0].efforts : ['low', 'medium', 'high', 'xhigh', 'max']) };
}
function shapeCodex(list) {
  const ms = (list || []).map(m => ({ value: m.value, label: m.label || m.value, note: m.description || '', efforts: m.efforts || [], isDefault: !!m.isDefault, defaultEffort: m.defaultEffort || null }));
  const def = ms.find(m => m.isDefault) || ms[0] || null;
  return { models: ms.slice(0, 8), more: ms.slice(8), defaultModel: def ? def.label : null, defaultEffort: def && def.defaultEffort && def.defaultEffort !== 'none' ? def.defaultEffort : null, efforts: def && def.efforts.length ? def.efforts : ['low', 'medium', 'high', 'xhigh'] };
}

// The models pulled into the local Ollama (names like glm-5.3-flash:cloud), or none if it isn't running.
function ollamaTags() {
  return new Promise(resolve => {
    const req = require('http').get({ host: '127.0.0.1', port: 11434, path: '/api/tags', timeout: 3000 }, res => {
      let s = ''; res.setEncoding('utf8'); res.on('data', d => { s += d; });
      res.on('end', () => { try { resolve((JSON.parse(s).models || []).map(m => m.name || m.model).filter(Boolean)); } catch { resolve([]); } });
    });
    req.on('timeout', () => req.destroy()); req.on('error', () => resolve([]));
  });
}
function createModels({ config, acc, codexAll, overrideVars, log = () => {} }) {
  let cache = { at: 0, value: null }, pending = null;
  async function load() {
    const cfg = config();
    const main = cfg.accounts.find(a => a.isDefault) || cfg.accounts[0];
    const out = { claude: null, codex: null, ollama: null };
    if (main) out.claude = shapeClaude(await askClaude(cfg, main, overrideVars));
    for (const x of codexAll()) {
      const st = x.publicState();
      if (!st.signedIn) continue;
      const fam = st.kind === 'ollama' ? 'ollama' : 'codex';
      if (out[fam]) continue;
      try { out[fam] = shapeCodex(await x.models()); } catch (err) { log(`Lite: ${st.name} models: ${err.message}`); }
    }
    // Codex lists only the Ollama models it was set up with; everything pulled into Ollama can run.
    if (out.ollama) {
      const have = new Set([...out.ollama.models, ...out.ollama.more].map(m => m.value));
      for (const name of await ollamaTags()) if (!have.has(name)) out.ollama.more.push({ value: name, label: name.replace(/:cloud$/, ''), note: 'In Ollama', efforts: [], isDefault: false, defaultEffort: null });
    }
    return out;
  }
  function get({ fresh = false } = {}) {
    if (!fresh && cache.value && Date.now() - cache.at < KEEP_MS) return Promise.resolve(cache.value);
    if (pending) return pending;
    // A list that's missing an assistant (still signing in at startup, say) is only kept a minute.
    pending = load().then(v => { cache = { at: Date.now() - (v.claude && v.codex ? 0 : KEEP_MS - 60e3), value: v }; return v; }).finally(() => { pending = null; });
    return pending;
  }
  return { get };
}

module.exports = { createModels, shapeClaude, shapeCodex };
