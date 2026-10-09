'use strict';
// OpenClaw session integration: surfaces Gateway agent sessions (Discord channels,
// crons, subagents, voice rooms, direct chats) as read-only rows in Session Switcher,
// and reads their transcripts node-side from the live session store.
//
// Data sources (both local, no secrets handled):
//  - `openclaw sessions --json --all-agents` for the session list (same CLI humans use)
//  - the session store SQLite (WAL, opened read-only per request, closed after) for history
//
// v1 is deliberately view-only: no session creation, no message sending.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const zlib = require('zlib');

const AGENT_NAMES = { main: 'Celeste' };
const prettyAgent = id => AGENT_NAMES[id] || (id ? id.charAt(0).toUpperCase() + id.slice(1) : 'Agent');

// Surface naming from session keys like agent:<id>:<surface>:<rest>
function keyParts(key) {
  const m = /^agent:([^:]+):([^:]+):?([\s\S]*)$/.exec(String(key || ''));
  return m ? { agent: m[1], surface: m[2], rest: m[3] } : null;
}
function surfaceLabel(surface, rest) {
  switch (surface) {
    case 'discord': return /channel/.test(rest) ? 'Discord channel' : /thread/.test(rest) ? 'Discord thread' : 'Discord';
    case 'cron': return 'Cron run';
    case 'subagent': return 'Subagent';
    case 'voice': return 'Voice room';
    case 'direct': return 'Direct chat';
    case 'test': return 'Test';
    default: return surface.charAt(0).toUpperCase() + surface.slice(1);
  }
}
const shortHash = key => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 5);
};

// agentId -> workspace folder, from the OpenClaw config on disk. Sessions group into
// their agent's real workspace folder so they appear inside existing projects.
function workspaces() {
  const out = {};
  try {
    const cfgPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const entries = (cfg.agents && cfg.agents.entries) || {};
    for (const [id, e] of Object.entries(entries)) {
      const w = e && e.workspace && typeof e.workspace === 'string' && e.workspace.trim();
      if (w) out[id] = w;
    }
    const def = (cfg.agents && cfg.agents.defaults && cfg.agents.defaults.workspace) || null;
    if (def) out.__default = def;
  } catch { /* no config, no grouping */ }
  if (!out.main) out.main = path.join(os.homedir(), 'clawd');
  return out;
}

function toRow(s, ws) {
  const p = keyParts(s.key) || { agent: s.agentId, surface: 'session', rest: '' };
  const surface = surfaceLabel(p.surface, p.rest);
  const agent = p.agent || s.agentId || 'main';
  const name = AGENT_NAMES[agent] || prettyAgent(agent);
  const running = s.status === 'running';
  const title = `${name} · ${surface}`;
  const cwd = ws[agent] || ws.__default;
  return {
    id: s.key,
    provider: 'openclaw',
    sessionId: s.sessionId || null,
    agent,
    title,
    autoTitle: title,
    preview: running ? 'Session is live right now' : (s.kind === 'group' ? 'Group session' : 'Stored session'),
    updated: s.updatedAt || s.ageMs ? Date.now() - (s.ageMs || 0) : 0,
    cwd: cwd && fs.existsSync(cwd) ? cwd : null,
    status: s.status || 'idle',
    model: s.model || s.modelOverride || null,
    totalTokens: s.totalTokens || 0,
    channel: p.surface,
    folderExists: !!(cwd && fs.existsSync(cwd)),
  };
}

function createOpenClaw({ log = () => {}, dataDir } = {}) {
  let cache = null;            // { rows, sig }
  let pending = null;

  function list(limit = 200) {
    const args = ['sessions', '--json', '--all-agents', '--limit', String(limit)];
    return new Promise(resolve => {
      let out = '', err = '';
      const child = spawn('openclaw', args, { cwd: dataDir || os.homedir() });
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { err += d; });
      child.on('error', e => resolve(null));
      child.on('close', code => {
        if (code !== 0) { if (err.trim()) log(`openclaw sessions: ${err.trim().slice(0, 200)}`); return resolve(null); }
        try { resolve(JSON.parse(out)); } catch { resolve(null); }
      });
      setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 20000);
    });
  }

  // Refresh like codexSessions does: resolve fast with the cache, update in background.
  async function sessions(maxAgeMs = 20000) {
    if (pending) return cache ? cache.rows : [];
    const stale = !cache || Date.now() - cache.at > maxAgeMs;
    if (stale) {
      pending = true;
      list().then(d => {
        pending = null;
        if (!d) return;
        const ws = workspaces();
        const rows = (d.sessions || []).map(s => toRow(s, ws)).filter(r => r.cwd);
        const sig = rows.map(r => `${r.id}:${r.updated}:${r.status}`).join('|');
        if (!cache || cache.sig !== sig) { cache = { at: Date.now(), sig, rows }; if (onChange) onChange(); }
        else cache.at = Date.now();
      }).catch(() => { pending = null; });
    }
    return cache ? cache.rows : [];
  }
  let onChange = null;

  const known = keyOrId => (cache ? cache.rows.find(r => r.id === keyOrId || r.sessionId === keyOrId) : null);
  const cached = () => (cache ? cache.rows : []);

  // ---- transcript history (live store, read-only per request) ----
  function agentStorePath(agentId) {
    return path.join(os.homedir(), '.openclaw', 'agents', agentId || 'main', 'agent', 'openclaw-agent.sqlite');
  }

  function flattenContent(c) {
    if (typeof c === 'string') return c;
    if (!Array.isArray(c)) return '';
    return c.filter(b => b && (b.type === 'text' || b.type === 'input_text') && typeof b.text === 'string' && b.text.trim()).map(b => b.text).join('\n\n');
  }

  async function history(id, { limit = 200 } = {}) {
    const row = known(id);
    const sessionId = row ? row.sessionId : null;
    if (!sessionId) return { items: [], start: null, cursor: null, error: 'unknown-session' };
    const file = agentStorePath(row.agent);
    if (!fs.existsSync(file)) return { items: [], start: null, cursor: null, error: 'no-store' };
    let db;
    try {
      db = new (require('node:sqlite').DatabaseSync)(file, { readOnly: true });
      db.exec('PRAGMA busy_timeout=1500');
      const rows = db.prepare(
        'SELECT seq, event_json, event_zstd FROM transcript_events WHERE session_id = ? ORDER BY seq DESC LIMIT ?'
      ).all(sessionId, limit * 4);   // headroom: some rows are thinking/system events
      const items = [];
      for (const r of rows) {
        if (items.length >= limit) break;
        let ev = null;
        try { ev = r.event_zstd ? JSON.parse(zlib.zstdDecompressSync(Buffer.from(r.event_zstd)).toString('utf8')) : JSON.parse(r.event_json); } catch { continue; }
        const msg = ev && ev.message;
        if (!msg || typeof msg !== 'object') continue;
        const role = msg.role;
        if (role !== 'user' && role !== 'assistant') continue;
        const text = flattenContent(msg.content).replace(/\s+\n/g, '\n').trim();
        if (!text) continue;
        // Skip injected scaffolding we'd never want to show
        if (/^<(COMPACTION|system|openclaw)/i.test(text.slice(0, 60))) continue;
        items.push({ role, text: text.length > 4000 ? text.slice(0, 3999) + '…' : text, at: ev.timestamp || null });
      }
      items.reverse();
      return { items, start: null, cursor: null };
    } catch (err) {
      log(`openclaw history ${row.agent}: ${err.message}`);
      return { items: [], start: null, cursor: null, error: 'read-failed' };
    } finally { try { if (db) db.close(); } catch { /* already closed */ } }
  }

  return { sessions, cached, known, history, onSessionsChanged: fn => { onChange = fn; } };
}

module.exports = { createOpenClaw, prettyAgent };