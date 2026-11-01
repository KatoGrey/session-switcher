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
const shadowLib = require('./shadow-snapshots');

const BIG = 20 * 1024 * 1024;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function git(cwd, args, { env, input, maxBuffer = 64 << 20, gitDir } = {}) {
  return new Promise(resolve => {
    const child = execFile('git', ['--literal-pathspecs', '-c', 'core.longpaths=true', '-C', cwd, ...(gitDir ? [`--git-dir=${gitDir}`, `--work-tree=${cwd}`] : []), ...args], { env: env || process.env, timeout: 60000, windowsHide: true, maxBuffer, encoding: 'buffer' }, (err, out, errOut) => {
      resolve({ ok: !err, out: out || Buffer.alloc(0), err: String(errOut || (err && err.message) || '') });
    });
    if (input !== undefined) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}
const text = r => r.out.toString('utf8');
let shadows = null;
const isShadow = shadowLib.isShadow;
function configure({ dataDir, ...opts } = {}) {
  const closing = shadows && shadows.close();
  shadows = dataDir ? shadowLib.createShadowStore({ dir: path.join(dataDir, '.shadow-snapshots'), ...opts }) : null;
  return closing;
}
async function targetOf(cwd) {
  const top = await topOf(cwd);
  if (top) return { top, shadow: false };
  return shadows && !shadowLib.broad(cwd) ? { top: path.resolve(cwd), shadow: true } : null;
}
async function backend(top, before, after) {
  if (!isShadow(before) && !isShadow(after)) return { before, after, opts: {} };
  if (!shadows || !isShadow(before) || !isShadow(after)) throw new Error('These local snapshots are unavailable or use different stores.');
  const [a, b] = await Promise.all([shadows.resolve(top, before), shadows.resolve(top, after)]);
  return { before: a.tree, after: b.tree, opts: { gitDir: a.gitDir, env: a.env }, shadow: true,
    covered: file => shadows.covered(a, file) && shadows.covered(b, file) };
}
function pin(ref) { if (shadows && isShadow(ref)) shadows.pin(ref); }
function release(ref) { if (shadows && isShadow(ref)) shadows.release(ref); }
function warm(cwd) {
  if (!shadows) return;
  targetOf(cwd).then(target => target && target.shadow ? snapshot(target.top, target) : null).catch(() => {});
}

// The project's git top folder, or null when it isn't in a git repository.
async function topOf(cwd) {
  const r = await git(cwd, ['rev-parse', '--show-toplevel']);
  return r.ok ? path.resolve(text(r).trim()) : null;
}

// A snapshot of everything in the project as it is now (what .gitignore leaves out stays out).
async function snapshot(top, { shadow = false, fresh = false } = {}) {
  if (shadow) { if (!shadows) throw new Error('Local text snapshots are not configured.'); return shadows.capture(top, { fresh }); }
  const tmpIndex = path.join(os.tmpdir(), `ss-index-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
  try {
    // Start from the real index, so only files that changed are read again.
    const real = text(await git(top, ['rev-parse', '--git-path', 'index'])).trim();
    const realPath = path.isAbsolute(real) ? real : path.join(top, real);
    // With the index's own time: git checks a file changed in the same second as the index was
    // written by its content, judging by that time (a new one would hide a same-size edit).
    if (fs.existsSync(realPath)) { fs.copyFileSync(realPath, tmpIndex); const st = fs.statSync(realPath); fs.utimesSync(tmpIndex, st.atime, st.mtime); }
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
  const b = await backend(top, before, after);
  const [status, numbers] = await Promise.all([
    git(top, ['diff-tree', '-r', '--no-renames', '--name-status', '-z', b.before, b.after], b.opts),
    git(top, ['diff-tree', '-r', '--no-renames', '--numstat', '-z', b.before, b.after], b.opts)]);
  if (!status.ok || !numbers.ok) throw new Error('The saved changes could not be read.');
  const st = text(status).split('\0').filter(Boolean), num = text(numbers).split('\0').filter(Boolean);
  const counts = new Map();
  for (const line of num) { const m = line.match(/^(\d+|-)\t(\d+|-)\t(.*)$/s); if (m) counts.set(m[3], { add: m[1] === '-' ? null : +m[1], del: m[2] === '-' ? null : +m[2] }); }
  const out = [];
  for (let i = 0; i + 1 < st.length; i += 2) {
    const p = st[i + 1], c = counts.get(p) || { add: null, del: null };
    if (b.shadow && !b.covered(p)) continue;
    out.push({ path: p, status: st[i] === 'A' ? 'added' : st[i] === 'D' ? 'deleted' : 'changed', ...c });
  }
  return out;
}

// One file's changes between two snapshots, as a unified diff (cut off at 400 KB).
async function diff(top, before, after, file) {
  const b = await backend(top, before, after);
  if (b.shadow && !b.covered(file)) throw new Error('That file was not covered by both text snapshots.');
  const r = await git(top, ['diff', '--no-color', '--no-ext-diff', '--no-renames', b.before, b.after, '--', file], { ...b.opts, maxBuffer: 8 << 20 });
  if (!r.ok) throw new Error('The saved changes could not be read.');
  const s = text(r);
  return s.length > 400000 ? `${s.slice(0, 400000)}\n… (cut off: the change is larger than this)` : s;
}

// The blob and file mode of a path in a snapshot, or null if it isn't there.
async function blobIn(top, tree, file, opts = {}) {
  const r = await git(top, ['ls-tree', '-z', tree, '--', file], opts);
  if (!r.ok) throw new Error(r.err.trim() || 'The snapshot could not be read.');
  const m = text(r).match(/^(\d+) blob ([0-9a-f]{40,64})\t/);
  return m ? { mode: m[1], blob: m[2] } : null;
}
// The blob and entry kind on disk now, or null if it's gone. Content equality alone is not enough:
// replacing a file with a link, or changing its executable bit, is also a later user edit.
async function blobNow(top, file, opts = {}) {
  const abs = path.join(top, file);
  let stat;
  try { stat = fs.lstatSync(abs, { bigint: true }); } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  const stamp = entryStamp(stat);
  const checked = value => {
    if (!stillEntry(abs, stamp)) throw new Error('changed while Undo was checking it');
    return { ...value, stamp };
  };
  if (stat.isSymbolicLink()) {
    const r = await git(top, ['hash-object', '--stdin'], { ...opts, input: fs.readlinkSync(path.join(top, file)) });
    if (!r.ok) throw new Error(r.err.trim() || 'The current link could not be checked.');
    return checked({ blob: text(r).trim(), mode: '120000' });
  }
  if (!stat.isFile()) return checked({ blob: null, mode: '040000' });
  const r = await git(top, ['hash-object', ...(opts.gitDir ? ['--no-filters'] : []), '--', file], opts);
  if (!r.ok) throw new Error(r.err.trim() || 'The current file could not be checked.');
  return checked({ blob: text(r).trim(), mode: stat.mode & 0o100n ? '100755' : '100644' });
}
const entryStamp = stat => [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs, stat.birthtimeNs].join(':');
function stillEntry(abs, stamp) {
  try { return entryStamp(fs.lstatSync(abs, { bigint: true })) === stamp; }
  catch (err) { return err.code === 'ENOENT' && stamp === null; }
}
const inside = (top, file) => {
  const abs = path.resolve(top, file), relative = path.relative(path.resolve(top), abs);
  return relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) ? abs : null;
};
function checkParents(top, abs) {
  let current = path.resolve(top);
  try { const root = fs.lstatSync(current); if (!root.isDirectory() || root.isSymbolicLink()) return 'the project folder is now a link or is unavailable'; }
  catch (err) { return err.message; }
  for (const part of path.relative(current, path.dirname(abs)).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) return 'a parent folder is now a link';
      if (!stat.isDirectory()) return 'a parent folder is now a file';
    } catch (err) { if (err.code !== 'ENOENT') return err.message; }
  }
  return null;
}

// Puts files back as they were in `before`, where they're still as `after` left them. A file changed
// since (by you, or the other assistant) is skipped unless force. Returns { restored, skipped }.
async function restore(top, before, after, files, { force = false } = {}) {
  const restored = [], skipped = [];
  const b = await backend(top, before, after);
  const allowed = b.shadow ? await shadows.currentAllowed(top, files) : new Map();
  const stillChecked = (file, now) => b.shadow ? shadows.stillChecked(top, file, now) : stillEntry(path.join(top, file), now ? now.stamp : null);
  const [links, modes] = await Promise.all(['core.symlinks', 'core.filemode'].map(key => git(top, ['config', '--bool', '--get', key], b.opts)));
  const linksAsFiles = text(links).trim() === 'false', filemode = text(modes).trim() !== 'false';
  const unchanged = (now, left) => {
    if (!now || !left) return now === left;
    if (now.blob !== left.blob) return false;
    if (now.mode === left.mode) return true;
    if (linksAsFiles && left.mode === '120000' && /^100/.test(now.mode)) return !filemode || now.mode === '100644';
    return !filemode && /^100/.test(now.mode) && /^100/.test(left.mode);
  };
  for (const file of files) {
    if (b.shadow && (!b.covered(file) || allowed.has(file))) { skipped.push({ path: file, why: allowed.get(file) || 'not covered by both text snapshots' }); continue; }
    const abs = inside(top, file);
    if (!abs) { skipped.push({ path: file, why: 'outside the project' }); continue; }
    const blocked = checkParents(top, abs);
    if (blocked) { skipped.push({ path: file, why: blocked }); continue; }
    let was, left, now;
    try { [was, left, now] = await Promise.all([blobIn(top, b.before, file, b.opts), blobIn(top, b.after, file, b.opts), b.shadow ? allowed.checked.get(file) : blobNow(top, file, b.opts)]); }
    catch (err) { skipped.push({ path: file, why: err.message }); continue; }
    if (!force && !unchanged(now, left)) { skipped.push({ path: file, why: 'changed since' }); continue; }
    const changedParent = checkParents(top, abs);
    if (changedParent) { skipped.push({ path: file, why: changedParent }); continue; }
    if (!stillChecked(file, now)) { skipped.push({ path: file, why: 'changed while Undo was checking it' }); continue; }
    if (!was) { try { fs.rmSync(abs, { force: true }); restored.push(file); } catch (err) { skipped.push({ path: file, why: err.message }); } continue; }
    // With the project's own filters, so line endings come back as they were on disk.
    const symlink = was.mode === '120000';
    const r = await git(top, symlink || b.shadow ? ['cat-file', 'blob', was.blob] : ['cat-file', '--filters', `--path=${file}`, was.blob], { ...b.opts, maxBuffer: b.shadow ? shadowLib.LIMITS.fileBytes + 1024 : 1 << 30 });
    if (!r.ok) { skipped.push({ path: file, why: 'its earlier version isn’t in the snapshot' }); continue; }
    let temporary;
    try {
      const why = checkParents(top, abs); if (why) throw new Error(why);
      if (!stillChecked(file, now)) throw new Error('changed while Undo was checking it');
      let existing; try { existing = fs.lstatSync(abs); } catch (err) { if (err.code !== 'ENOENT') throw err; }
      if (existing && existing.isDirectory()) throw new Error('the file is now a folder');
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      temporary = path.join(path.dirname(abs), `.ss-restore-${crypto.randomBytes(10).toString('hex')}`);
      if (symlink && !linksAsFiles) fs.symlinkSync(r.out.toString('utf8'), temporary);
      else {
        const oldMode = existing && !existing.isSymbolicLink() ? existing.mode & 0o777 : 0o666 & ~process.umask();
        const mode = !filemode && existing && !existing.isSymbolicLink() ? oldMode
          : was.mode === '100755' ? oldMode | ((oldMode & 0o444) >> 2) : oldMode & ~0o111;
        fs.writeFileSync(temporary, r.out, { flag: 'wx', mode });
        if (process.platform !== 'win32') fs.chmodSync(temporary, mode);
      }
      // Replacing the directory entry cannot follow a leaf symlink into another project's file.
      if (!stillChecked(file, now)) throw new Error('changed while Undo was checking it');
      fs.renameSync(temporary, abs);
      temporary = null;
      restored.push(file);
    } catch (err) { skipped.push({ path: file, why: err.message }); }
    finally { if (temporary) { try { fs.unlinkSync(temporary); } catch { /* already gone */ } } }
  }
  return { restored, skipped };
}

module.exports = { topOf, targetOf, configure, isShadow, pin, release, warm, snapshot, changes, diff, restore, EMPTY_TREE };
