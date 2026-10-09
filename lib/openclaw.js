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
// A shell-quoted word, whatever the platform: cmd.exe verbatim style on Windows (what
// the other command lines here already do), POSIX single-quoting everywhere else.
const SHQ_SAFE = /^[A-Za-z0-9@%_+=:.,\/\-]+$/;
const shq = s => {
  const t = String(s);
  if (/^win/.test(process.platform)) return SHQ_SAFE.test(t) ? t : `"${t.replace(/"/g, '\\"')}"`;
  return SHQ_SAFE.test(t) ? t : `'${t.replace(/'/g, `'\\''`)}'`;
};
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
  // A configured name arrives however it was saved; a whole-lowercase one reads sloppy in a title.
  const configured = agents.nameOf(agent);
  const name = configured && configured === configured.toLowerCase() ? capital(configured) : configured;
  const label = [s.displayName, s.subject, s.label].find(x => typeof x === 'string' && x.trim());
  const cliLabeled = !!label;
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
    cliLabeled,
  };
}

// The text of a message's content (a string, or a list of blocks).
function textOf(c) {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter(b => b && /^(text|input_text|output_text)$/.test(b.type) && typeof b.text === 'string' && b.text.trim()).map(b => b.text).join('\n\n');
}

// One line of plain text, for a title, a sub-line or a preview.
const oneLine = s => String(s || '').replace(/\s+/g, ' ').trim();
// The human part of a user turn. Voice turns carry their words inside <input>…</input>;
// runs spawned or steered by other agents arrive with injected context blocks first,
// which aren't the speaker's words.
function unwrapUser(t) {
  let s = String(t || '');
  // Injected internal context (runtime notes, other-session relays) is never the speaker's words.
  if (/^\s*<{2,3}/.test(s)) return '';
  // A voice turn's actual words live in its <input> block.
  const inp = /<input>([\s\S]*?)<\/input>/.exec(s);
  if (inp) s = inp[1];
  // Leading wrapper blocks (<system>context</system>, <openclaw:attempt>…</openclaw:attempt>)
  // are injected, not spoken: drop them whole, tags and contents, then read what's left.
  let m;
  while ((m = /^<([a-zA-Z][\w:-]*)"?(?=[\s>])[^>]*>[\s\S]*?<\/\1>\s*/.exec(s))) s = s.slice(m[0].length);
  // A cron dispatch names its task: "[cron:<id> Nightly Cleanup] feed the dog".
  const ci = s.search(/\[cron:[0-9a-f-]+ /i);
  if (ci >= 0) {
    const end = s.indexOf(']', ci);
    if (end > ci) {
      const name = s.slice(s.indexOf(' ', ci) + 1, end).trim();
      const rest = s.slice(end + 1).replace(/^[-:|\s]+/, '').trim();
      s = rest ? `${name}: ${rest}` : name;
    }
  }
  s = s.replace(/\[(?:Subagent Task|Subagent Context|Inter-session[^\]\n]{0,40})[^\]\n]*\]/gi, ' ');
  return oneLine(s.replace(/<[^>\n]{1,60}>/g, ' '));
}
const isNoiseUser = t => !t || t.length < 8 || /^[<{]/.test(t) || /^\s*#{2,}\s/.test(t)
  || /^(OpenClaw runtime context|Disable automatic completion turns|This content was routed by OpenClaw|You are running as a subagent|Every subagent spawned from this session has now settled|Child completion results|Active exec sessions)/i.test(t);

// run(cmdline, opts) → { code, stdout, stderr } runs a command through the platform shell (so the
// npm shim openclaw.cmd is found on Windows too); found() says whether openclaw is installed at all.
function createOpenClaw({ log = () => {}, run, found = async () => true, home = os.homedir(), dataDir = null } = {}) {
  let cache = { rows: [], sig: '', at: 0 };
  let nextTry = 0, busy = null, lastErr = '', onChange = null;

  // Per-session titles and first/last prompts, kept on disk so rows describe sessions
  // without rescanning every transcript on each refresh. Versioned: an older file is
  // ignored rather than trusted.
  const TITLES_FILE = dataDir ? path.join(dataDir, 'openclaw-titles.json') : null;
  const TITLES_VERSION = 1;
  let titles = { version: TITLES_VERSION, byId: {} };
  let titlesDirty = false, titlesTimer = null;
  try { const saved = TITLES_FILE && fs.existsSync(TITLES_FILE) ? JSON.parse(fs.readFileSync(TITLES_FILE, 'utf8')) : null; if (saved && saved.version === TITLES_VERSION) titles = saved; } catch { /* unreadable: start fresh */ }
  const saveTitles = () => {
    titlesDirty = false;
    if (!TITLES_FILE) return;
    try {
      const ids = Object.keys(titles.byId);
      if (ids.length > 3000) { ids.sort((a, b) => (titles.byId[a].at || 0) - (titles.byId[b].at || 0)); for (const k of ids.slice(0, ids.length - 3000)) delete titles.byId[k]; }
      fs.writeFileSync(TITLES_FILE, JSON.stringify(titles));
    } catch { /* best effort */ }
  };
  // First derivation writes at once (the file's absence is the common cold-start case);
  // later refreshes debounce, so a burst of running-session updates writes once.
  const saveTitlesSoon = () => {
    if (!titlesDirty) return;
    if (!fs.existsSync(TITLES_FILE)) { saveTitles(); return; }
    if (!titlesTimer) titlesTimer = setTimeout(() => { titlesTimer = null; saveTitles(); }, 800);
  };

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
        use(enrich(r.list.filter(s => s && s.key).map(s => toRow(s, agents, now)).filter(x => x.cwd)));
      }).catch(err => { nextTry = Date.now() + FAILED_WAIT; log(`OpenClaw sessions: ${err.message}`); }).finally(() => { busy = null; });
    }
    return cache.rows;
  }
  // What each session is about: its conversation label (#channel) when it has one, else
  // its first real user prompt. First/last prompts also refresh while a session is in
  // use, so a running conversation's row keeps up. One read-only connection per store.
  function deriveBatch(agent, ids) {
    const out = new Map();
    if (!SAFE_ID.test(agent) || !ids.length) return out;
    const file = storePath(agent);
    if (!fs.existsSync(file)) return out;
    let db;
    try {
      db = new (require('node:sqlite').DatabaseSync)(file, { readOnly: true });
      db.exec('PRAGMA busy_timeout = 1500; PRAGMA query_only = ON;');
      // Older OpenClaw stores may not map sessions to conversations; that only costs the label.
      let labelStmt = null;
      try { labelStmt = db.prepare('SELECT c.label AS label FROM session_conversations sc JOIN conversations c ON c.conversation_id = sc.conversation_id WHERE sc.session_id = ? LIMIT 1'); } catch { /* no conversation mapping here */ }
      const headStmt = db.prepare('SELECT event_json FROM transcript_events WHERE session_id = ? ORDER BY seq ASC LIMIT 40');
      const tailStmt = db.prepare('SELECT event_json FROM transcript_events WHERE session_id = ? ORDER BY seq DESC LIMIT 30');
      const take = rows => {
        for (const r of rows) {
          let e; try { e = JSON.parse(r.event_json); } catch { continue; }
          const msg = e && e.message;
          if (!msg || msg.role !== 'user') continue;
          const u = unwrapUser(textOf(msg.content));
          if (isNoiseUser(u)) continue;
          return u;
        }
        return null;
      };
      // A label can also live in the store's own window table (newer OpenClaw); if this store
      // predates it, preparing fails and that route is simply unavailable.
      let winStmt = null;
      try { winStmt = db.prepare('SELECT label FROM session_windows WHERE current_session_id = ? LIMIT 1'); } catch { /* no windows in this store */ }
      for (const sid of ids) {
        const ent = { at: Date.now(), first: null, last: null, channelLabel: null };
        try {
          const l = labelStmt && labelStmt.get(sid);
          const lbl = l && l.label ? String(l.label) : '';
          if (lbl.includes('#')) ent.channelLabel = lbl.slice(lbl.indexOf('#')).slice(0, 40) || null;
        } catch { /* the mapping may simply not exist */ }
        if (!ent.channelLabel && winStmt) {
          try { const w = winStmt.get(sid); if (w && w.label) ent.channelLabel = oneLine(w.label).slice(0, 40) || null; }
          catch { /* no windows in this store */ }
        }
        try { ent.first = take(headStmt.all(sid)); ent.last = take(tailStmt.all(sid)); } catch { /* store moved away */ }
        out.set(sid, ent);
      }
    } catch (err) {
      log(`OpenClaw titles (${agent}): ${err.message}`);
    } finally { try { if (db) db.close(); } catch { /* already closed */ } }
    return out;
  }
  function enrich(rows) {
    const fresh = rows.filter(r => r.sessionId && !titles.byId[r.sessionId]);
    const live = rows.filter(r => r.sessionId && titles.byId[r.sessionId] && (r.status === 'running' || Date.now() - (r.updated || 0) < 15 * 60 * 1000)).slice(0, 60);
    const byAgent = new Map();
    for (const r of fresh.concat(live)) {
      if (!byAgent.has(r.agent)) byAgent.set(r.agent, []);
      byAgent.get(r.agent).push(r.sessionId);
    }
    for (const [agent, ids] of byAgent) {
      const got = deriveBatch(agent, ids);
      for (const [sid, ent] of got) if (ent.first || ent.last || ent.channelLabel) titles.byId[sid] = ent;
      if (got.size) titlesDirty = true;
    }
    saveTitlesSoon();
    for (const r of rows) {
      if (!r.sessionId) { delete r.cliLabeled; continue; }
      const labeled = !!r.cliLabeled;
      const c = titles.byId[r.sessionId];
      if (c) {
        r.firstPrompt = c.first || null; r.lastPrompt = c.last || null;
        // The store's conversation label is read fresh here, so it wins over the list's
        // snapshot; a CLI-provided label still beats a prompt-snippet title, though.
        if (c.channelLabel) r.title = `${r.agentName} · ${c.channelLabel}`;
        else if (!labeled && c.first) r.title = `${r.agentName} · ${oneLine(c.first).slice(0, 60)}`;
      }
      delete r.cliLabeled;
    }
    return rows;
  }
  const known = id => cache.rows.find(r => r.id === id || (r.sessionId && r.sessionId === id)) || null;
  const storePath = agent => path.join(home, '.openclaw', 'agents', agent, 'agent', 'openclaw-agent.sqlite');
  // A row whose CLI line went stale still resolves: its key is in the store, and so is
  // its transcript. Read-only, one connection, closed after.
  function storeRows(agent) {
    if (!SAFE_ID.test(agent)) return null;
    const file = storePath(agent);
    if (!fs.existsSync(file)) return null;
    try { return new (require('node:sqlite').DatabaseSync)(file, { readOnly: true }); } catch { return null; }
  }

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
        // Scaffolding OpenClaw adds (summaries, system notes, injected context) isn't part of the conversation.
        if (!text || /^<(COMPACTION|system|openclaw)/i.test(text)) continue;
        const clean = msg.role === 'user' ? unwrapUser(text) : text;
        if (!clean || (msg.role === 'user' && isNoiseUser(clean))) continue;
        const at = msOf(ev.timestamp || msg.timestamp) ? new Date(msOf(ev.timestamp || msg.timestamp)).toISOString() : null;
        const body = clean.length > TEXT_MAX ? `${clean.slice(0, TEXT_MAX - 1)}…` : clean;
        items.push(msg.role === 'user' ? { kind: 'user', text: body, at } : { kind: 'assistant', mid: `oc:${r.seq}`, blocks: [{ type: 'text', text: body }], at });
      }
      return { items: items.reverse(), start: 0, cursor: null };
    } catch (err) {
      log(`OpenClaw history (${row.agent}): ${err.message}`);
      return empty('read-failed');
    } finally { try { if (db) db.close(); } catch { /* already closed */ } }
  }

  // Archive stored sessions through the running gateway, the same CLI people use.
  // Keys are session keys as the app shows them; a dry run first would double the
  // round-trips, so the caller confirms and this reports what actually happened.
  async function archive(ids) {
    const keys = (Array.isArray(ids) ? ids : [ids]).map(id => String(id || '')).filter(Boolean);
    if (!keys.length) return { ok: false, error: 'nothing to archive' };
    const r = await run(`openclaw sessions archive --json ${keys.map(k => `'${String(k).replace(/'/g, `'\''`)}'`).join(' ')}`, { cwd: home, timeoutMs: 30000 });
    if (r.code !== 0) return { ok: false, error: (r.stderr || '').trim().slice(0, 200) || `exit ${r.code}` };
    try {
      const d = JSON.parse(r.stdout);
      const out = Array.isArray(d) ? d : (d && (d.results || d.sessions)) || [];
      return { ok: true, results: out.map(x => ({ key: x.key || x.sessionKey || null, archived: x.archived !== false && !x.error, error: x.error || null })) };
    } catch { return { ok: true, results: keys.map(k => ({ key: k, archived: true })) }; }
  }
  // A follow-up turn straight into a session, the same CLI people use in a terminal.
  // The reply is recorded in the session's transcript (so the read view shows it) and
  // comes back to the caller; it isn't delivered to any channel unless asked for.
  // The message goes over --message-file: no quoting rules to get wrong.
  async function sendMessage(id, text) {
    let row = known(String(id || ''));
    // A key the list hasn't produced yet (fresh app, stale list) still resolves when
    // the store knows it: the owning agent is in the key itself.
    if (!row) {
      const kp = keyParts(id);
      const agent = kp && kp.agent && SAFE_ID.test(kp.agent) ? kp.agent : null;
      const db = agent && storeRows(agent);
      if (db) {
        try {
          const w = db.prepare('SELECT current_session_id AS sid FROM session_windows WHERE session_key = ? LIMIT 1').get(String(id));
          if (w && w.sid) row = { id: String(id), sessionId: w.sid, agent, agentName: agentsFrom(home).nameOf(agent) };
        } finally { try { db.close(); } catch { /* closed */ } }
      }
    }
    if (!row || !row.sessionId || !SAFE_ID.test(row.agent)) return { ok: false, error: 'unknown-session' };
    const t = String(text || '').trim();
    if (!t) return { ok: false, error: 'nothing to send' };
    if (t.length > 40000) return { ok: false, error: 'that message is too long' };
    const dir = dataDir ? path.join(dataDir, 'openclaw-messages') : os.tmpdir();
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
    const file = path.join(dir, `msg-${Date.now()}-${Math.floor(Math.random() * 1e6)}.txt`);
    fs.writeFileSync(file, t, 'utf8');
    const cmdline = `openclaw agent --agent ${shq(row.agent)} --session-key ${shq(row.id)} --message-file ${shq(file)} --json --timeout 280000`;
    let r;
    try { r = await run(cmdline, { cwd: home, timeoutMs: 300000 }); }
    finally { try { fs.unlinkSync(file); } catch { /* best effort */ } }
    if (r.code !== 0) return { ok: false, error: (r.stderr || '').trim().slice(0, 200) || `exit ${r.code}` };
    // Pull the terminal reply out of the CLI's JSON answer, wherever the version nests it.
    let d = null;
    try { const m = /\{[\s\S]*\}/.exec(r.stdout); if (m) d = JSON.parse(m[0]); } catch { /* no readable reply */ }
    const findTr = o => { if (!o || typeof o !== 'object') return null; if (o.terminalReply) return o.terminalReply; for (const v of Object.values(o)) { const f = findTr(v); if (f) return f; } return null; };
    const tr = findTr(d) || {};
    return { ok: true, reply: typeof tr.text === 'string' && tr.text ? tr.text : null, disposition: tr.disposition || 'unknown' };
  }
  return { sessions, cached: () => cache.rows, known, history, archive, sendMessage, onSessionsChanged: fn => { onChange = fn; } };
}

module.exports = { createOpenClaw, keyParts, msOf, agentsFrom, LIST_CMD };
