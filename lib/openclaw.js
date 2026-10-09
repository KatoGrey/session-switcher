'use strict';
// OpenClaw (openclaw.ai) agent sessions: Discord channels, cron runs, subagents, voice rooms and
// direct chats, listed among the other chats in their agent's workspace folder and read here
// (read-only: nothing is sent to them and nothing is changed).
//
// Both sources are local:
//  - `openclaw sessions --json --all-agents` for the list (the same command people use);
//  - each agent's session store (SQLite) for a transcript, opened read-only per request and closed after.
// Without OpenClaw installed the list is empty, and the command is only tried again now and then.

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const LIST_CMD = 'openclaw sessions --json --all-agents --limit 200';
const MISSING_WAIT = 10 * 60 * 1000;  // not installed: look again in ten minutes
const FAILED_WAIT = 60 * 1000;        // it failed: try again in a minute
const SAFE_ID = /^(?!\.{1,2}$)[\w.-]{1,80}$/; // an agent id is a folder name in the store
const TEXT_MAX = 4000;

const capital = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// A time as milliseconds, from a number (seconds or milliseconds) or a date string.
function msOf(x) {
  if (typeof x === 'number' && Number.isFinite(x) && x > 0) return x < 1e12 ? x * 1000 : x;
  if (typeof x === 'string' && x) { const t = Date.parse(x); return Number.isFinite(t) ? t : 0; }
  return 0;
}

// A session key looks like agent:<id>:<surface>:<rest>.
function keyParts(key) {
  const m = /^agent:([^:]+):([^:]+):?([\s\S]*)$/.exec(String(key || ''));
  return m ? { agent: m[1], surface: m[2], rest: m[3] } : null;
}
function surfaceLabel(surface, rest) {
  switch (surface) {
    case 'discord': return /thread/.test(rest) ? 'Discord thread' : /channel/.test(rest) ? 'Discord channel' : 'Discord';
    case 'cron': return 'Cron run';
    case 'subagent': return 'Subagent';
    case 'voice': return 'Voice room';
    case 'direct': return 'Direct chat';
    default: return capital(surface || 'session');
  }
}

// Each agent's name and workspace folder, from OpenClaw's own settings.
function agentsFrom(home) {
  const names = {}, folders = {};
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(path.join(home, '.openclaw', 'openclaw.json'), 'utf8')); } catch { /* no settings */ }
  const agents = (cfg && cfg.agents) || {};
  // Agents are a list ({ id, name, workspace }) or a map keyed by id, depending on the version.
  const list = Array.isArray(agents.list) ? agents.list : Object.entries(agents.entries || {}).map(([id, e]) => ({ id, ...(e || {}) }));
  for (const e of list) {
    if (!e || typeof e.id !== 'string') continue;
    const name = e.name || (e.identity && e.identity.name);
    if (typeof name === 'string' && name.trim()) names[e.id] = name.trim();
    if (typeof e.workspace === 'string' && e.workspace.trim()) folders[e.id] = e.workspace.trim();
  }
  const def = agents.defaults && typeof agents.defaults.workspace === 'string' ? agents.defaults.workspace.trim() : '';
  const fallback = def || [path.join(home, '.openclaw', 'workspace'), path.join(home, 'clawd')].find(d => fs.existsSync(d)) || '';
  const expand = p => (p.startsWith('~') ? path.join(home, p.slice(1)) : p);
  return { nameOf: id => names[id] || capital(id) || 'Agent', folderOf: id => expand(folders[id] || fallback) };
}

function toRow(s, agents, now) {
  const p = keyParts(s.key) || { agent: s.agentId, surface: 'session', rest: '' };
  const agent = p.agent || s.agentId || 'main';
  const name = agents.nameOf(agent);
  const label = [s.displayName, s.subject, s.label].find(x => typeof x === 'string' && x.trim());
  const title = `${name} · ${label ? label.trim().slice(0, 80) : surfaceLabel(p.surface, p.rest)}`;
  const cwd = agents.folderOf(agent);
  const exists = !!(cwd && fs.existsSync(cwd));
  const running = s.status === 'running';
  return {
    id: String(s.key),
    provider: 'openclaw',
    sessionId: s.sessionId || null,
    agent,
    agentName: name,
    title,
    autoTitle: title,
    preview: running ? 'Running right now' : (s.kind === 'group' ? 'Group session' : 'Stored session'),
    updated: msOf(s.updatedAt) || (Number.isFinite(s.ageMs) ? now - s.ageMs : 0),
    cwd: exists ? cwd : null,
    folderExists: exists,
    status: s.status || 'idle',
    model: s.model || s.modelOverride || null,
    totalTokens: s.totalTokens || 0,
    channel: p.surface,
  };
}

// The text of a message's content (a string, or a list of blocks).
function textOf(c) {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter(b => b && /^(text|input_text|output_text)$/.test(b.type) && typeof b.text === 'string' && b.text.trim()).map(b => b.text).join('\n\n');
}

// run(cmdline, opts) → { code, stdout, stderr } runs a command through the platform shell (so the
// npm shim openclaw.cmd is found on Windows too); found() says whether openclaw is installed at all.
function createOpenClaw({ log = () => {}, run, found = async () => true, home = os.homedir() } = {}) {
  let cache = { rows: [], sig: '', at: 0 };
  let nextTry = 0, busy = null, lastErr = '', onChange = null;

  async function fetchList() {
    const r = await run(LIST_CMD, { cwd: home, timeoutMs: 20000 });
    if (r.code !== 0) {
      // A POSIX shell says 127 when there's no such command; cmd.exe just fails, so look it up.
      if (r.code === 127 || !(await found())) return { missing: true };
      return { error: (r.stderr || '').trim().slice(0, 200) || `exit ${r.code}` };
    }
    try { const d = JSON.parse(r.stdout); return { list: Array.isArray(d) ? d : (d && d.sessions) || [] }; } catch { return { error: 'its output wasn’t JSON' }; }
  }
  function use(rows) {
    // Whole minutes, so the same list read twice is the same (an age is measured from a moment that moves).
    const sig = rows.map(r => `${r.id}:${Math.round(r.updated / 60000)}:${r.status}:${r.title}`).join('|');
    const changed = sig !== cache.sig;
    cache = { rows, sig, at: Date.now() };
    if (changed && onChange) onChange();
  }
  // The rows now; looks again in the background when they're older than maxAgeMs.
  function sessions(maxAgeMs = 20000) {
    const t = Date.now();
    if (!busy && t >= nextTry && t - cache.at >= maxAgeMs) {
      busy = fetchList().then(r => {
        if (r.missing) { nextTry = Date.now() + MISSING_WAIT; if (cache.rows.length) use([]); return; }
        if (r.error) {
          nextTry = Date.now() + FAILED_WAIT;
          if (r.error !== lastErr) { lastErr = r.error; log(`OpenClaw sessions: ${r.error}`); }
          return;
        }
        nextTry = 0; lastErr = '';
        const agents = agentsFrom(home), now = Date.now();
        use(r.list.filter(s => s && s.key).map(s => toRow(s, agents, now)).filter(x => x.cwd));
      }).catch(err => { nextTry = Date.now() + FAILED_WAIT; log(`OpenClaw sessions: ${err.message}`); }).finally(() => { busy = null; });
    }
    return cache.rows;
  }
  const known = id => cache.rows.find(r => r.id === id || (r.sessionId && r.sessionId === id)) || null;
  const storePath = agent => path.join(home, '.openclaw', 'agents', agent, 'agent', 'openclaw-agent.sqlite');

  // A session's messages (yours and the agent's), in the shape the chat window shows.
  function history(id, { limit = 200 } = {}) {
    const empty = error => ({ items: [], start: 0, cursor: null, ...(error ? { error } : {}) });
    const row = known(String(id || ''));
    if (!row || !row.sessionId) return empty('unknown-session');
    if (!SAFE_ID.test(row.agent)) return empty('unknown-session');
    const file = storePath(row.agent);
    if (!fs.existsSync(file)) return empty('no-store');
    let sqlite;
    try { sqlite = require('node:sqlite'); } catch { return empty('needs-newer-node'); }
    let db;
    try {
      db = new sqlite.DatabaseSync(file, { readOnly: true });
      db.exec('PRAGMA busy_timeout = 1500; PRAGMA query_only = ON;');
      // Room to spare: some rows are thinking or system events.
      const rows = db.prepare('SELECT seq, event_json, event_zstd FROM transcript_events WHERE session_id = ? ORDER BY seq DESC LIMIT ?').all(row.sessionId, limit * 4);
      const items = [];
      for (const r of rows) {
        if (items.length >= limit) break;
        let ev;
        try {
          if (r.event_zstd) { if (typeof zlib.zstdDecompressSync !== 'function') continue; ev = JSON.parse(zlib.zstdDecompressSync(Buffer.from(r.event_zstd)).toString('utf8')); }
          else ev = JSON.parse(r.event_json);
        } catch { continue; }
        const msg = ev && ev.message;
        if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) continue;
        const text = textOf(msg.content).replace(/[ \t]+\n/g, '\n').trim();
        // Scaffolding OpenClaw adds (summaries, system notes) isn't part of the conversation.
        if (!text || /^<(COMPACTION|system|openclaw)/i.test(text)) continue;
        const at = msOf(ev.timestamp || msg.timestamp) ? new Date(msOf(ev.timestamp || msg.timestamp)).toISOString() : null;
        const body = text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX - 1)}…` : text;
        items.push(msg.role === 'user' ? { kind: 'user', text: body, at } : { kind: 'assistant', mid: `oc:${r.seq}`, blocks: [{ type: 'text', text: body }], at });
      }
      return { items: items.reverse(), start: 0, cursor: null };
    } catch (err) {
      log(`OpenClaw history (${row.agent}): ${err.message}`);
      return empty('read-failed');
    } finally { try { if (db) db.close(); } catch { /* already closed */ } }
  }

  return { sessions, cached: () => cache.rows, known, history, onSessionsChanged: fn => { onChange = fn; } };
}

module.exports = { createOpenClaw, keyParts, msOf, agentsFrom, LIST_CMD };
