'use strict';
// Snapshots of a git project's files, to show what a reply changed and to undo it. A snapshot is a
// git tree object, written through a separate, throwaway index: your own index (what you've staged),
// your branch and your history are never touched. Files over 20 MB aren't copied (they stay as git
// last knew them), so a big video doesn't bloat the project's .git folder.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const BIG = 20 * 1024 * 1024;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function git(cwd, args, { env, input, maxBuffer = 64 << 20 } = {}) {
  return new Promise(resolve => {
    const child = execFile('git', ['-C', cwd, ...args], { env: env || process.env, timeout: 60000, windowsHide: true, maxBuffer, encoding: 'buffer' }, (err, out, errOut) => {
      resolve({ ok: !err, out: out || Buffer.alloc(0), err: String(errOut || (err && err.message) || '') });
    });
    if (input !== undefined) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}
const text = r => r.out.toString('utf8');

// The project's git top folder, or null when it isn't in a git repository.
async function topOf(cwd) {
  const r = await git(cwd, ['rev-parse', '--show-toplevel']);
  return r.ok ? path.resolve(text(r).trim()) : null;
}

// A snapshot of everything in the project as it is now (what .gitignore leaves out stays out).
async function snapshot(top) {
  const tmpIndex = path.join(os.tmpdir(), `ss-index-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
  try {
    // Start from the real index, so only files that changed are read again.
    const real = text(await git(top, ['rev-parse', '--git-path', 'index'])).trim();
    const realPath = path.isAbsolute(real) ? real : path.join(top, real);
    if (fs.existsSync(realPath)) fs.copyFileSync(realPath, tmpIndex);
    const changed = text(await git(top, ['ls-files', '-z', '-m', '-o', '-d', '--exclude-standard'], { env })).split('\0').filter(Boolean);
    const paths = [...new Set(changed)].filter(p => { try { const st = fs.statSync(path.join(top, p)); return !st.isFile() || st.size <= BIG; } catch { return true; } });
    if (paths.length) {
      const r = await git(top, ['update-index', '--add', '--remove', '-z', '--stdin'], { env, input: paths.join('\0') });
      if (!r.ok) throw new Error(r.err.trim() || 'git couldn’t read the files.');
    }
    const t = await git(top, ['write-tree'], { env });
    if (!t.ok) throw new Error(t.err.trim() || 'git couldn’t take a snapshot.');
    return text(t).trim();
  } finally { fs.rm(tmpIndex, { force: true }, () => {}); }
}

// What changed between two snapshots: [{ path, status: 'added' | 'changed' | 'deleted', add, del }].
async function changes(top, before, after) {
  if (before === after) return [];
  const st = text(await git(top, ['diff-tree', '-r', '--no-renames', '--name-status', '-z', before, after])).split('\0').filter(Boolean);
  const num = text(await git(top, ['diff-tree', '-r', '--no-renames', '--numstat', '-z', before, after])).split('\0').filter(Boolean);
  const counts = new Map();
  for (const line of num) { const m = line.match(/^(\d+|-)\t(\d+|-)\t(.*)$/s); if (m) counts.set(m[3], { add: m[1] === '-' ? null : +m[1], del: m[2] === '-' ? null : +m[2] }); }
  const out = [];
  for (let i = 0; i + 1 < st.length; i += 2) {
    const p = st[i + 1], c = counts.get(p) || { add: null, del: null };
    out.push({ path: p, status: st[i] === 'A' ? 'added' : st[i] === 'D' ? 'deleted' : 'changed', ...c });
  }
  return out;
}

// One file's changes between two snapshots, as a unified diff (cut off at 400 KB).
async function diff(top, before, after, file) {
  const r = await git(top, ['diff', '--no-color', '--no-ext-diff', '--no-renames', before, after, '--', file], { maxBuffer: 8 << 20 });
  const s = text(r);
  return s.length > 400000 ? `${s.slice(0, 400000)}\n… (cut off: the change is larger than this)` : s;
}

// The blob id of a path in a snapshot, or null if it isn't there.
async function blobIn(top, tree, file) {
  const r = await git(top, ['ls-tree', '-z', tree, '--', file]);
  const m = text(r).match(/^\d+ blob ([0-9a-f]{40,64})\t/);
  return m ? m[1] : null;
}
// The blob id of a file as it is on disk now, or null if it's gone.
async function blobNow(top, file) {
  if (!fs.existsSync(path.join(top, file))) return null;
  const r = await git(top, ['hash-object', '--', file]);
  return r.ok ? text(r).trim() : null;
}
const inside = (top, file) => { const abs = path.resolve(top, file); return (abs.toLowerCase().startsWith(path.resolve(top).toLowerCase() + path.sep.toLowerCase())) ? abs : null; };

// Puts files back as they were in `before`, where they're still as `after` left them. A file changed
// since (by you, or the other assistant) is skipped unless force. Returns { restored, skipped }.
async function restore(top, before, after, files, { force = false } = {}) {
  const restored = [], skipped = [];
  for (const file of files) {
    const abs = inside(top, file);
    if (!abs) { skipped.push({ path: file, why: 'outside the project' }); continue; }
    const [was, left, now] = await Promise.all([blobIn(top, before, file), blobIn(top, after, file), blobNow(top, file)]);
    if (!force && now !== left) { skipped.push({ path: file, why: 'changed since' }); continue; }
    if (!was) { try { fs.rmSync(abs, { force: true }); restored.push(file); } catch (err) { skipped.push({ path: file, why: err.message }); } continue; }
    // With the project's own filters, so line endings come back as they were on disk.
    const r = await git(top, ['cat-file', '--filters', `--path=${file}`, was], { maxBuffer: 1 << 30 });
    if (!r.ok) { skipped.push({ path: file, why: 'its earlier version isn’t in the snapshot' }); continue; }
    try { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, r.out); restored.push(file); } catch (err) { skipped.push({ path: file, why: err.message }); }
  }
  return { restored, skipped };
}

module.exports = { topOf, snapshot, changes, diff, restore, EMPTY_TREE };
