'use strict';
// A project's state in git, for the top of its page: which branch, what isn't committed, the last few
// commits. Only ever reads, and doesn't take git's locks: chats are often using git in the same folder,
// and a status that held the index for a moment could make one of their commands fail.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const snaps = require('./snapshots');
const { allowed } = require('./files');

const TTL = 15e3, MAX_FILES = 200, COMMITS = 5, TIMEOUT = 8000, DIFF_MAX = 400000;
const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };

const git = (cwd, args) => new Promise(res => {
  execFile('git', ['--literal-pathspecs', '-C', cwd, ...args], { env: ENV, timeout: TIMEOUT, windowsHide: true, maxBuffer: 16 << 20 }, (err, out) => res(err ? null : String(out)));
});

// "## main...origin/main [ahead 1, behind 2]", or "## HEAD (no branch)", or "## No commits yet on main".
function parseBranch(line) {
  const s = line.replace(/^## /, '');
  const none = /^No commits yet on (.+)$/.exec(s);
  if (none) return { branch: none[1], ahead: 0, behind: 0, upstream: null };
  if (/^HEAD \(no branch\)/.test(s)) return { branch: null, ahead: 0, behind: 0, upstream: null };
  const m = /^(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(s) || [];
  const num = w => { const x = new RegExp(`${w} (\\d+)`).exec(m[3] || ''); return x ? Number(x[1]) : 0; };
  return { branch: m[1] || s, upstream: m[2] || null, ahead: num('ahead'), behind: num('behind') };
}
const STATUS = { M: 'changed', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'in conflict', '?': 'new' };

async function read(cwd) {
  const [top, st] = await Promise.all([git(cwd, ['rev-parse', '--show-toplevel']), git(cwd, ['status', '--porcelain=v1', '--branch', '-z', '--no-renames', '--', '.'])]);
  if (top === null || st === null) return { git: null };
  const root = top.trim();
  // git answers with where the folder really is; the project may be reached through a link or a short name.
  let real = cwd;
  try { real = fs.realpathSync.native(cwd); } catch { /* gone since: names come out as they are */ }
  const parts = st.split('\0').filter(Boolean);
  const head = parts[0] && parts[0].startsWith('## ') ? parseBranch(parts.shift()) : { branch: null, ahead: 0, behind: 0, upstream: null };
  const files = parts.map(line => {
    const xy = line.slice(0, 2), name = line.slice(3), dir = name.endsWith('/'), rel = path.relative(real, path.resolve(root, name));
    const code = xy.includes('U') || xy === 'AA' || xy === 'DD' ? 'U' : xy[1] !== ' ' ? xy[1] : xy[0];
    return { file: path.resolve(cwd, rel), rel: `${rel.split(path.sep).join('/')}${dir ? '/' : ''}`, status: STATUS[code] || 'changed', ...(dir ? { dir: true } : {}) };
  });
  const log = await git(cwd, ['log', `-${COMMITS}`, '--format=%h%x00%ct%x00%s%x1e', '--', '.']);
  const commits = (log || '').split('\x1e').map(x => x.trim()).filter(Boolean).map(x => { const [hash, at, subject] = x.split('\0'); return { hash, at: Number(at) * 1000, subject }; });
  return { git: { ...head, changed: files.length, files: files.slice(0, MAX_FILES), commits } };
}

// What isn't committed in one file: a new file is all additions. git says 1 when it found differences.
const gitDiff = (cwd, args) => new Promise(res => {
  execFile('git', ['--literal-pathspecs', '-C', cwd, 'diff', '--no-color', '--no-ext-diff', '--no-renames', ...args], { env: ENV, timeout: TIMEOUT, windowsHide: true, maxBuffer: 16 << 20 }, (err, out) => res(err && err.code !== 1 ? null : String(out)));
});
// Where a path really leads, from its nearest part that exists (a deleted file has none of its own).
function reallyInside(cwd, abs) {
  let root;
  try { root = fs.realpathSync.native(cwd); } catch { return false; }
  let cur = abs, rest = '';
  for (let i = 0; i < 64; i++) {
    try {
      const r = path.relative(root, path.join(fs.realpathSync.native(cur), rest));
      return !r.startsWith('..') && !path.isAbsolute(r);
    } catch { /* not there: go up */ }
    const up = path.dirname(cur);
    if (up === cur) return false;
    rest = path.join(path.basename(cur), rest); cur = up;
  }
  return false;
}
async function fileDiff(cwd, rel) {
  const abs = path.resolve(cwd, String(rel || ''));
  const r = path.relative(cwd, abs);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) throw Object.assign(new Error('That’s outside this folder.'), { status: 400 });
  // What the file viewer won't show, this doesn't either: sign-ins and keys, and what a link leads to.
  if (!allowed(abs, cwd) || !reallyInside(cwd, abs)) throw Object.assign(new Error('That’s a private place, so Session Switcher won’t open it.'), { status: 403 });
  const tracked = (await git(cwd, ['ls-files', '--error-unmatch', '--', abs])) !== null;
  // With no commit yet there's nothing to compare it with: all of it is new.
  const hasHead = tracked && (await git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])) !== null;
  const out = (hasHead ? await gitDiff(cwd, ['HEAD', '--', abs]) : await gitDiff(cwd, ['--no-index', '--', '/dev/null', abs])) || '';
  return out.length > DIFF_MAX ? `${out.slice(0, DIFF_MAX)}\n… (cut off: the change is larger than this)` : out;
}

// Everything a chat has changed, its partners' work with it, as those files stand now against how they
// were before its first change: a reply that was undone doesn't count, and a later fix shows as the fix.
// Only files its own edits touched; others that moved meanwhile aren't its doing.
async function soFar(list) {
  const all = [];
  for (const c of list) {
    if (c.restoreTurns) c.restoreTurns();
    const s = c.snap;
    if (!s) continue;
    for (const t of s.turns) if (t && (t.top || s.top)) all.push({ ...t, top: t.top || s.top });
  }
  if (!all.length) return { top: null, files: [] };
  // A project that's since gained git, or a partner in another repository: only what's kept in the same
  // place can be compared, so it's those of the latest reply.
  const shadowOf = t => (typeof snaps.isShadow === 'function' ? !!snaps.isShadow(t.before) : false);
  const at = t => Date.parse(t.at) || 0;
  const latest = all.reduce((a, b) => (at(b) >= at(a) ? b : a));
  const turns = all.filter(t => t.top === latest.top && shadowOf(t) === shadowOf(latest));
  const first = turns.reduce((a, b) => (at(b) < at(a) ? b : a));
  const top = first.top, shadow = shadowOf(first);
  const own = new Set(turns.flatMap(t => (t.files || []).filter(f => !f.meanwhile).map(f => f.path)));
  const after = await (shadow ? snaps.snapshot(top, { shadow: true, fresh: true }) : snaps.snapshot(top));
  const files = (await snaps.changes(top, first.before, after)).filter(f => own.has(f.path));
  return { top, before: first.before, after, files, scope: shadow ? 'text' : null };
}

// What the chats in a project have changed, newest first: every reply that changed something, from what
// each conversation keeps (lib/extras.js), whether the chat's open or not. So it answers "what happened
// while I was away". chats: [{ id, by, chat }]: a conversation, who it is, and the chat it belongs to.
function history(chats, extras, { limit = 200, since = 0 } = {}) {
  const out = [];
  for (const { id, by, chat } of chats) {
    const undone = new Set();
    const list = extras.list(id);
    for (const ev of list) if (ev.kind === 'undone' && ev.restored && ev.restored.length) undone.add(ev.turn);
    for (const ev of list) {
      if (ev.kind !== 'changes' || !Array.isArray(ev.files)) continue;
      const at = Date.parse(ev.at) || 0;
      if (at < since) continue;
      const own = ev.files.filter(f => !f.meanwhile);
      if (!own.length) continue;
      out.push({ at, id, by: by || null, chat: chat || id, turn: ev.turn, files: own.slice(0, 40), more: Math.max(0, own.length - 40) + (ev.more || 0), add: own.reduce((n, f) => n + (f.add || 0), 0), del: own.reduce((n, f) => n + (f.del || 0), 0), scope: ev.scope || null, undone: undone.has(ev.turn) });
    }
  }
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}

function createProjectNow() {
  const memo = new Map();   // cwd -> { at, data, pending }
  const sofar = new Map();  // chat key -> what soFar last said, for its file-by-file diffs
  return {
    fileDiff,
    async soFar(key, list) {
      const r = await soFar(list);
      sofar.set(key, r);
      if (sofar.size > 40) sofar.delete(sofar.keys().next().value);
      return { files: r.files, scope: r.scope || null };
    },
    history,
    // One file's change from one reply, whether its chat is open or not.
    async replyDiff(extras, id, turn, file) {
      const t = extras.turns(id)[Number(turn)];
      if (!t || !t.top || !(t.files || []).some(f => f.path === file)) throw Object.assign(new Error('That reply’s changes aren’t known any more.'), { status: 404 });
      return snaps.diff(t.top, t.before, t.after, file);
    },
    async soFarDiff(key, file) {
      const r = sofar.get(key);
      if (!r || !r.files.some(f => f.path === file)) throw Object.assign(new Error('Open the list of changes again.'), { status: 404 });
      return snaps.diff(r.top, r.before, r.after, file);
    },
    read(cwd) {
      const hit = memo.get(cwd);
      if (hit && hit.pending) return hit.pending;
      if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.data);
      const pending = read(cwd).then(data => { memo.set(cwd, { at: Date.now(), data }); if (memo.size > 40) memo.delete(memo.keys().next().value); return data; }, err => { memo.delete(cwd); throw err; });
      memo.set(cwd, { ...(hit || {}), pending });
      return pending;
    },
  };
}

module.exports = { createProjectNow, parseBranch };
