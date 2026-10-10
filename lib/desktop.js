'use strict';
// Chats started in the Claude desktop app (its Code tab). Claude Code writes their transcripts
// like any other chat, but the desktop app keeps what you see in its sidebar in a record of its
// own, one small JSON file per session:
//
//   ~/Library/Application Support/Claude/claude-code-sessions/<org>/<account>/local_<id>.json
//     { cliSessionId, title, cwd, originCwd, isArchived, lastActivityAt,
//       spawnedFrom: { sessionId: 'local_…' } }   // a session started from another one
//
// Read-only: Session Switcher never writes there. From it we take the titles, the folder a
// session belongs to (originCwd, even when it ran in a worktree), its parent session, and whether
// it's archived in the desktop app.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = process.env.SWITCHER_DESKTOP_SESSIONS
  || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions')
    : process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'claude-code-sessions')
      : path.join(os.homedir(), '.config', 'Claude', 'claude-code-sessions'));

// The project a worktree folder belongs to, or null if it isn't one:
//  - <project>/.claude/worktrees/<name> (Claude Code's worktrees);
//  - any folder whose .git file says "gitdir: <project>/.git/worktrees/<name>";
//  - ~/.codex/worktrees/<id>/<name> (the Codex app's), once deleted: the one project called <name>.
const CLAUDE_WT = /^(.*?)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+[\\/]*$/;
const CODEX_WT = /[\\/]\.codex[\\/]worktrees[\\/][^\\/]+[\\/]([^\\/]+)[\\/]*$/;
const ownerMemo = new Map();
function worktreeOwner(cwd, projectNamed = () => null) {
  const c = String(cwd || '');
  if (!c) return null;
  const m = CLAUDE_WT.exec(c);
  if (m) return m[1];
  if (!ownerMemo.has(c)) {
    let owner = null;
    try {
      const g = /^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/]/m.exec(fs.readFileSync(path.join(c, '.git'), 'utf8'));
      if (g) owner = g[1];
    } catch { /* not a worktree, or it's gone */ }
    ownerMemo.set(c, owner);
  }
  if (ownerMemo.get(c)) return ownerMemo.get(c);
  const cx = CODEX_WT.exec(c);
  return cx ? projectNamed(cx[1]) : null;
}

const memo = new Map(); // file -> { mtimeMs, rec }
let cache = { at: 0, byCli: new Map() };

function listFiles() {
  const out = [];
  let orgs = [];
  try { orgs = fs.readdirSync(ROOT); } catch { return out; }
  for (const org of orgs) {
    let accts = [];
    try { accts = fs.readdirSync(path.join(ROOT, org)); } catch { continue; }
    for (const acct of accts) {
      let files = [];
      try { files = fs.readdirSync(path.join(ROOT, org, acct)); } catch { continue; }
      for (const f of files) if (/^local_[\w-]+\.json$/.test(f)) out.push(path.join(ROOT, org, acct, f));
    }
  }
  return out;
}

function readRecord(file) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const hit = memo.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.rec;
  let j = null;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return hit ? hit.rec : null; } // mid-write: keep the last
  const rec = j && j.cliSessionId ? {
    desktopId: j.sessionId || path.basename(file, '.json'),
    cli: String(j.cliSessionId).toLowerCase(),
    title: typeof j.title === 'string' && j.title.trim() ? j.title.trim().slice(0, 140) : null,
    cwd: j.cwd || null,
    originCwd: j.originCwd || j.cwd || null,
    archived: !!j.isArchived,
    lastActivityAt: j.lastActivityAt || 0,
    parentDesktopId: j.spawnedFrom && j.spawnedFrom.sessionId ? j.spawnedFrom.sessionId : (j.forkedFromSessionId || null),
  } : null;
  memo.set(file, { mtimeMs: st.mtimeMs, rec });
  return rec;
}

// cli session id (lowercase) -> record, with parentCli filled in. Re-read at most every few seconds.
function records(maxAgeMs = 5000) {
  if (Date.now() - cache.at < maxAgeMs) return cache.byCli;
  const files = listFiles();
  const live = new Set(files);
  for (const f of memo.keys()) if (!live.has(f)) memo.delete(f);
  const recs = files.map(readRecord).filter(Boolean);
  const cliByDesktop = new Map(recs.map(r => [r.desktopId, r.cli]));
  const byCli = new Map();
  for (const r of recs) byCli.set(r.cli, { ...r, parentCli: r.parentDesktopId ? cliByDesktop.get(r.parentDesktopId) || null : null });
  cache = { at: Date.now(), byCli };
  return byCli;
}

const get = id => records().get(String(id || '').toLowerCase()) || null;

// Sub-sessions as { child id: parent id }, for chats whose parent is known.
function parents() {
  const out = {};
  for (const r of records().values()) if (r.parentCli) out[r.cli] = r.parentCli;
  return out;
}

// Looks like a worktree folder at all (whether or not its project can be found).
const isWorktree = cwd => CLAUDE_WT.test(String(cwd || '')) || CODEX_WT.test(String(cwd || '')) || !!worktreeOwner(cwd);

module.exports = { records, get, parents, worktreeOwner, isWorktree, ROOT };
