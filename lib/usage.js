'use strict';
// Plan usage for each account: the same numbers Claude Code's /usage screen shows (5-hour and weekly
// windows, per-model weekly limits, extra-usage credits), with their reset times.
//
// It asks Claude Code with the `get_usage` control request. When the account already has a chat
// running in the app, that chat is asked; otherwise a short-lived Claude Code process is started in
// streaming mode, asked, and closed. No message is sent, so checking usage uses no usage.

const os = require('os');
const readline = require('readline');
const sys = require('./system');

const cache = new Map(); // account id -> { at, data, error, pending }

const pct = v => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(100, v)) : null);
const windowOf = w => (w ? { used: pct(w.utilization), resetsAt: w.resets_at || null } : null);

function normalize(r) {
  if (!r) return null;
  const rl = r.rate_limits || null;
  const models = [];
  if (rl) {
    if (rl.seven_day_opus) models.push({ name: 'Opus', ...windowOf(rl.seven_day_opus) });
    if (rl.seven_day_sonnet) models.push({ name: 'Sonnet', ...windowOf(rl.seven_day_sonnet) });
    for (const m of rl.model_scoped || []) models.push({ name: m.display_name, used: pct(m.utilization), resetsAt: m.resets_at || null });
  }
  const extra = rl && rl.extra_usage && rl.extra_usage.is_enabled
    ? { used: pct(rl.extra_usage.utilization), credits: rl.extra_usage.used_credits, limit: rl.extra_usage.monthly_limit, currency: rl.extra_usage.currency || null }
    : null;
  return {
    available: !!r.rate_limits_available && !!rl,
    subscription: r.subscription_type || null,
    fiveHour: rl ? windowOf(rl.five_hour) : null,
    week: rl ? windowOf(rl.seven_day) : null,
    models: models.filter(m => m.used !== null || m.resetsAt),
    extra,
  };
}

// Starts Claude Code in streaming mode just long enough to ask for usage.
function probe(cfg, account, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = sys.spawnClaude(cfg, account, os.homedir(), ['--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', '--strict-mcp-config']);
    } catch (err) { return reject(err); }
    let done = false, stderr = '';
    const finish = (err, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { proc.stdin.end(); } catch { /* closed */ }
      setTimeout(() => sys.killTree(proc), 1500);
      return err ? reject(err) : resolve(val);
    };
    const timer = setTimeout(() => finish(new Error('Claude Code took too long to report usage.')), timeoutMs);
    proc.on('error', err => finish(err));
    proc.on('exit', code => finish(new Error(code ? (stderr.trim().split(/\r?\n/).pop() || `Claude Code exited (${code}).`) : 'Claude Code closed before reporting usage.')));
    proc.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
    proc.stdin.on('error', () => {});
    const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
    rl.on('line', line => {
      let m; try { m = JSON.parse(line.trim()); } catch { return; }
      if (m.type === 'control_response' && m.response && m.response.request_id === 'usage-1') {
        if (m.response.subtype === 'error') return finish(new Error(m.response.error || 'Claude Code couldn’t report usage.'));
        return finish(null, m.response.response || {});
      }
      if (m.type === 'control_response' && m.response && m.response.request_id === 'init-1') {
        proc.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'usage-1', request: { subtype: 'get_usage', skip_behaviors: true } }) + '\n');
      }
    });
    proc.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'init-1', request: { subtype: 'initialize' } }) + '\n');
  });
}

function createUsage({ log = () => {}, onChange = () => {}, chats }) {
  async function fetchFor(cfg, account) {
    const live = chats && chats.forAccount(account.id);
    const raw = live ? await live.request({ subtype: 'get_usage', skip_behaviors: true }, 30000) : await probe(cfg, account);
    return normalize(raw);
  }

  // Refreshes one account's usage. Concurrent calls share one check.
  function refresh(cfg, account, { maxAgeMs = 0 } = {}) {
    const hit = cache.get(account.id) || {};
    if (hit.data && Date.now() - hit.at < maxAgeMs) return Promise.resolve(hit);
    if (hit.pending) return hit.pending;
    const pending = fetchFor(cfg, account)
      .then(data => { const v = { at: Date.now(), data, error: null }; cache.set(account.id, v); onChange(account.id); return v; })
      .catch(err => {
        const v = { at: Date.now(), data: hit.data || null, error: /unsupported|unknown|can.t handle/i.test(err.message) ? 'This version of Claude Code can’t report usage. Update it from Setup.' : err.message };
        cache.set(account.id, v); onChange(account.id);
        log(`Usage for ${account.name}: ${err.message}`);
        return v;
      });
    cache.set(account.id, { ...hit, pending });
    return pending;
  }

  // Live limit warnings from a running chat update the matching window straight away.
  function fromRateLimit(accountId, info) {
    if (!info || typeof info !== 'object') return;
    const hit = cache.get(accountId) || { at: 0, data: null, error: null };
    const data = hit.data ? JSON.parse(JSON.stringify(hit.data)) : { available: true, subscription: null, fiveHour: null, week: null, models: [], extra: null };
    const w = { used: typeof info.utilization === 'number' ? pct(info.utilization <= 1 ? info.utilization * 100 : info.utilization) : null,
      resetsAt: info.resetsAt ? new Date(info.resetsAt * (info.resetsAt < 1e12 ? 1000 : 1)).toISOString() : null };
    if (info.rateLimitType === 'five_hour') data.fiveHour = { ...(data.fiveHour || {}), ...Object.fromEntries(Object.entries(w).filter(([, v]) => v !== null)) };
    else if (info.rateLimitType === 'seven_day') data.week = { ...(data.week || {}), ...Object.fromEntries(Object.entries(w).filter(([, v]) => v !== null)) };
    else return;
    if (info.status === 'rejected') (info.rateLimitType === 'five_hour' ? data.fiveHour : data.week).used = 100;
    cache.set(accountId, { ...hit, at: Date.now(), data, live: true });
    onChange(accountId);
  }

  // For accounts whose usage comes from elsewhere (Codex).
  function get(id) { return cache.get(id) || null; }
  function set(id, data) { cache.set(id, { at: Date.now(), data, error: null }); onChange(id); }
  function mark(id, checking) { const v = cache.get(id) || { at: 0, data: null, error: null }; cache.set(id, { ...v, pending: checking ? true : null }); onChange(id); }
  function fail(id, message) { const v = cache.get(id) || {}; cache.set(id, { at: Date.now(), data: v.data || null, error: message }); onChange(id); }

  function snapshot() {
    const out = {};
    for (const [id, v] of cache) out[id] = { at: v.at || null, data: v.data || null, error: v.error || null, checking: !!v.pending };
    return out;
  }
  function forget(id) { cache.delete(id); }

  return { refresh, fromRateLimit, snapshot, forget, normalize, get, set, mark, fail };
}

module.exports = { createUsage, normalize, probe };
