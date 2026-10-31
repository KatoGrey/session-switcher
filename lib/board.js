'use strict';
// The picture board: every picture under a project's folder, folder by folder however many there are,
// each markable keep or redo with a note. Marks are kept on the PC (board.json) by folder and file, along
// with the file's size and time: a picture that's been made again counts as not reviewed yet and says
// what you'd asked for, which is what you want after asking for a redo.
//
// A folder's pictures are read when you open it. The whole tree is only walked for its folders and
// picture counts (no looking at each file), a few folders at a time, so a project with 20,000 pictures
// opens quickly and nothing else waits for it.
//
//   :new    the newest pictures, wherever they are
//   :redo   everything marked redo, and what's come back since
//   :keep   everything marked keep
//   :find   pictures with these words in their names, in any folder

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const store = require('./store');

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
const KEPT_DIR = 'Kept pictures';
const SKIP = new Set(['node_modules', 'bower_components', 'site-packages', '__pycache__', 'venv', 'vendor', 'target', 'coverage', KEPT_DIR.toLowerCase()]);
const MAX_ENTRIES = 400000, MAX_DEPTH = 12, TTL = 60e3, KEEP_SCANS = 4, NEWEST = 300, NEWEST_DIRS = 40, MAX_FOUND = 600;
const fail = (status, message) => Object.assign(new Error(message), { status });
const isPic = name => !name.startsWith('.') && IMG_EXT.has(path.extname(name).toLowerCase());
const byName = new Intl.Collator(undefined, { numeric: true }).compare;   // much quicker than localeCompare, on 16,000 folders

// Forward slashes, whichever computer: "." for the folder itself.
const relOf = (root, abs) => { const r = path.relative(root, abs).split(path.sep).join('/'); return r || '.'; };
const rootKey = root => (process.platform === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root));
// What makes two pictures versions of one: the same name, give or take its type and a version on the end
// ("aria.png", "aria-v2.webp", "aria (3).png"). Numbers alone don't count: portrait-01 and portrait-02 are
// two different people.
const stemOf = name => name.toLowerCase().replace(/\.[^.]+$/, '').replace(/[-_ ]*(v\d+|\(\d+\)|copy( \d+)?)$/, '');
// A mark stands for as long as the file is the one that was marked.
const sameFile = (m, st) => m.size === st.size && Math.abs(m.mtime - st.mtimeMs) < 1;

async function statAll(files) {
  const out = [];
  for (let i = 0; i < files.length; i += 32) {
    const part = await Promise.all(files.slice(i, i + 32).map(async f => {
      try { const st = await fsp.stat(f); return st.isFile() ? [f, st] : null; } catch { return null; }
    }));
    for (const x of part) if (x) out.push(x);
  }
  return out;
}
async function picturesIn(dir) {
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { /* gone */ }
  return entries.filter(e => e.isFile() && isPic(e.name)).map(e => path.join(dir, e.name));
}

const boards = new Set();
process.once('exit', () => { for (const b of boards) b.flush(); });

function createBoard({ dataDir, allowed = () => true, broad = () => false, newest = () => [], log = () => {}, patience = 1500 }) {
  const file = path.join(dataDir, 'board.json');
  const marks = store.loadOwnJson(file, {}, log) || {};
  const scans = new Map();   // root -> { at, data, pending }

  let saveTimer = null, dirty = false;
  const flush = () => {
    clearTimeout(saveTimer); saveTimer = null;
    if (!dirty) return;
    try { store.writeJsonAtomic(file, marks, { keepBackup: true }); dirty = false; }
    catch (err) {
      // Something had the file for a moment: it's still to be saved.
      log(`Couldn’t save the picture marks: ${err.message}`);
      saveTimer = setTimeout(flush, 3000); if (saveTimer.unref) saveTimer.unref();
    }
  };
  const saveSoon = () => { dirty = true; if (!saveTimer) { saveTimer = setTimeout(flush, 400); if (saveTimer.unref) saveTimer.unref(); } };

  function checkRoot(root) {
    const abs = path.resolve(String(root || ''));
    if (!root || !allowed(abs, abs)) throw fail(403, 'That’s a private place, so Session Switcher won’t open it.');
    let st;
    try { st = fs.statSync(abs); } catch { throw fail(404, `There’s no folder at ${abs}.`); }
    if (!st.isDirectory()) throw fail(400, 'That isn’t a folder.');
    return abs;
  }
  // Inside the folder, or not at all.
  function inside(root, rel) {
    const abs = path.resolve(root, String(rel || '.'));
    const r = path.relative(root, abs);
    if (r.startsWith('..') || path.isAbsolute(r)) throw fail(400, 'That’s outside this folder.');
    return abs;
  }

  async function walk(root) {
    const dirs = [], names = new Map();
    const maxDepth = broad(root) ? 1 : MAX_DEPTH;   // your user folder or a drive isn't a project: its top only
    let seen = 0, capped = false;
    let level = [[root, 0]];
    while (level.length && !capped) {
      const next = [];
      for (let i = 0; i < level.length && !capped; i += 16) {
        await Promise.all(level.slice(i, i + 16).map(async ([dir, depth]) => {
          let entries;
          try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
          let n = 0;
          for (const e of entries) {
            if (++seen > MAX_ENTRIES) { capped = true; break; }
            if (e.isDirectory()) { if (depth < maxDepth && !e.name.startsWith('.') && !SKIP.has(e.name.toLowerCase())) next.push([path.join(dir, e.name), depth + 1]); continue; }
            if (!e.isFile() || !isPic(e.name)) continue;
            n++;
            const stem = stemOf(e.name), p = path.join(dir, e.name), at = names.get(stem);
            if (at) at.push(p); else names.set(stem, [p]);
          }
          if (n) { let mtime = 0; try { mtime = (await fsp.stat(dir)).mtimeMs; } catch { /* gone */ } dirs.push({ rel: relOf(root, dir), n, mtime }); }
        }));
      }
      level = next;
    }
    dirs.sort((a, b) => byName(a.rel, b.rel));
    return { dirs, names, capped, ...(await checkMarks(root)) };
  }
  // Which marks don't stand any more: the picture's been made again (old) or isn't there (gone).
  async function checkMarks(root) {
    const mine = marks[rootKey(root)] || {}, rels = Object.keys(mine);
    const found = new Map((await statAll(rels.map(r => inside(root, r)))).map(([f, st]) => [relOf(root, f), st]));
    const old = new Set(), gone = new Set();
    for (const r of rels) { const st = found.get(r); if (!st) gone.add(r); else if (!sameFile(mine[r], st)) old.add(r); }
    return { old, gone };
  }
  function scan(root, fresh) {
    const hit = scans.get(root);
    if (hit && hit.data && !fresh && Date.now() - hit.at < TTL) return Promise.resolve(hit.data);
    if (hit && hit.pending) return hit.pending;
    const pending = walk(root).then(data => {
      data.at = Date.now();
      scans.delete(root); scans.set(root, { at: data.at, data });
      if (scans.size > KEEP_SCANS) scans.delete(scans.keys().next().value);
      return data;
    }, err => { scans.delete(root); throw err; });
    scans.set(root, { ...(hit || {}), pending, at: hit ? hit.at : 0 });
    return pending;
  }

  const markOf = (m, st) => {
    if (!m) return { mark: null };
    // Made again since you marked it: to review again, and it says what you'd said.
    return sameFile(m, st) ? { mark: m.mark, note: m.note || '' } : { mark: null, was: m.mark, note: m.note || '' };
  };
  // The folder rows' counts, and the whole project's.
  function tally(root, data) {
    const mine = marks[rootKey(root)] || {}, byDir = {}, all = { keep: 0, redo: 0, again: 0 };
    for (const [rel, m] of Object.entries(mine)) {
      if (data.gone.has(rel)) continue;
      if (data.old.has(rel)) { all.again++; continue; }
      if (m.mark !== 'keep' && m.mark !== 'redo') continue;
      const d = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '.';
      const c = byDir[d] || (byDir[d] = { keep: 0, redo: 0 });
      c[m.mark]++; all[m.mark]++;
    }
    return { byDir, all };
  }
  // The folders changed last and what near the top changed last: quick, however big the project is.
  async function newestFiles(root, data) {
    const recent = [...data.dirs].sort((a, b) => b.mtime - a.mtime).slice(0, NEWEST_DIRS);
    const lists = await Promise.all(recent.map(d => picturesIn(inside(root, d.rel))));
    let near = [];
    try { near = (newest(root) || []).map(x => x.path); } catch { /* the folders are enough */ }
    return [...new Set([...lists.flat().slice(0, 4000), ...near])];
  }

  // The folders with pictures, and the pictures in one of them (or in :new, :redo, :keep).
  async function list(rootArg, dirArg, { fresh = false, q = '', have = null } = {}) {
    const root = checkRoot(rootArg);
    // A huge project takes a while to walk: what can be shown meanwhile is, and it says it's still reading.
    let timer;
    const walked = scan(root, fresh);
    const data = await Promise.race([walked, new Promise(res => { timer = setTimeout(() => res(null), patience); })]) || { partial: true, dirs: [], names: new Map(), old: new Set(), gone: new Set(), capped: false };
    clearTimeout(timer);
    walked.catch(() => {});
    const mine = marks[rootKey(root)] || {};
    const smart = dirArg === ':new' || dirArg === ':redo' || dirArg === ':keep' || dirArg === ':find';
    const chosen = smart || (dirArg && (data.partial || data.dirs.some(d => d.rel === dirArg))) ? dirArg
      : data.partial ? ':new'
      : data.dirs.length ? [...data.dirs].sort((a, b) => b.mtime - a.mtime)[0].rel : '.';
    const words = String(q || '').trim().toLowerCase();
    const files = chosen === ':find' ? (words ? [...data.names.values()].flat().filter(f => path.basename(f).toLowerCase().includes(words)).slice(0, MAX_FOUND) : [])
      : chosen === ':new' ? await newestFiles(root, data)
      : chosen === ':redo' ? Object.keys(mine).filter(r => mine[r].mark === 'redo').map(r => inside(root, r))
        : chosen === ':keep' ? Object.keys(mine).filter(r => mine[r].mark === 'keep').map(r => inside(root, r))
          : await picturesIn(inside(root, chosen));
    let items = (await statAll(files)).map(([p, st]) => {
      const rel = relOf(root, p), name = path.basename(p), m = mine[rel];
      if (m) { data.gone.delete(rel); if (sameFile(m, st)) data.old.delete(rel); else data.old.add(rel); }
      const others = (data.names.get(stemOf(name)) || []).filter(f => f !== p).slice(0, 6).map(f => relOf(root, f));
      return { rel, path: p, name, size: st.size, mtime: st.mtimeMs, ...markOf(m, st), ...(others.length ? { others } : {}) };
    });
    // Whatever's on :keep has to still be kept, and only the kept: a picture made again goes back to review.
    if (chosen === ':keep') items = items.filter(x => x.mark === 'keep');
    if (chosen === ':new') {
      // A site's build copies its pictures: the same name and size is the same picture, shown once.
      const seen = new Set();
      items = items.sort((a, b) => b.mtime - a.mtime).filter(x => { const k = `${x.name.toLowerCase()}|${x.size}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, NEWEST);
    }
    else items.sort((a, b) => byName(a.rel, b.rel));
    const here = data.dirs.find(d => d.rel === chosen);
    if (here) here.n = items.length;
    const { byDir, all } = tally(root, data);
    const same = have && data.at && String(data.at) === String(have) && !dirty && !fresh;
    return { root, dir: chosen, ...(same ? {} : { dirs: data.dirs.map(d => ({ ...d, ...(byDir[d.rel] || {}) })) }), scanAt: data.at || null, items, totals: all, capped: data.capped, ...(data.partial ? { reading: true } : {}) };
  }

  // mark: 'keep', 'redo' or null (take it back). rels: one or many.
  function mark(rootArg, rels, what, note = '') {
    const root = checkRoot(rootArg);
    if (what !== null && what !== 'keep' && what !== 'redo') throw fail(400, 'Keep or redo?');
    const key = rootKey(root), mine = marks[key] || (marks[key] = {});
    const data = (scans.get(root) || {}).data;
    const text = String(note || '').slice(0, 2000), done = [];
    for (const rel of (Array.isArray(rels) ? rels : [rels]).slice(0, 20000)) {
      const r = relOf(root, inside(root, rel));
      if (data) { data.old.delete(r); data.gone.delete(r); }
      if (what === null) { delete mine[r]; done.push({ rel: r, mark: null, note: '' }); continue; }
      let st; try { st = fs.statSync(inside(root, r)); } catch { continue; }
      if (!st.isFile()) continue;
      mine[r] = { mark: what, size: st.size, mtime: st.mtimeMs, at: Date.now(), ...(text ? { note: text } : {}) };
      done.push({ rel: r, mark: what, note: text });
    }
    if (!Object.keys(mine).length) delete marks[key];
    waitingMemo = null;
    saveSoon();
    return { root, done, totals: data ? tally(root, data).all : null };
  }

  // Copies in a folder of their own, to share or hand on: "Kept pictures/2026-10-31" in the project. The
  // same name twice gets a number; nothing is overwritten, and the originals aren't touched.
  async function exportTo(rootArg, rels, now = new Date()) {
    const root = checkRoot(rootArg);
    const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const folder = path.join(root, KEPT_DIR, d);
    // Where they go has to be a real folder here: a link in the way could put them anywhere.
    for (const p of [path.join(root, KEPT_DIR), folder]) {
      let st = null;
      try { st = await fsp.lstat(p); } catch (err) { if (err.code !== 'ENOENT') throw err; }
      if (!st) await fsp.mkdir(p);
      else if (st.isSymbolicLink() || !st.isDirectory()) throw fail(400, `${relOf(root, p)} isn’t an ordinary folder, so nothing was copied.`);
    }
    const realRoot = await fsp.realpath(root);
    // A picture that's really here, however it's named: not one a link leads to, nor anywhere private.
    const reallyHere = async f => {
      try { const r = path.relative(realRoot, await fsp.realpath(f)); return !r.startsWith('..') && !path.isAbsolute(r); } catch { return false; }
    };
    let copied = 0;
    const failed = [];
    for (const rel of (Array.isArray(rels) ? rels : [rels]).slice(0, 20000)) {
      const from = inside(root, rel);
      if (!isPic(path.basename(from)) || !allowed(from, root) || !(await reallyHere(from))) { failed.push(rel); continue; }
      const { name, ext } = path.parse(from);
      try {
        for (let n = 1; ; n++) {
          try { await fsp.copyFile(from, path.join(folder, n === 1 ? `${name}${ext}` : `${name} (${n})${ext}`), fs.constants.COPYFILE_EXCL); copied++; break; }
          catch (err) { if (err.code !== 'EEXIST') throw err; }
        }
      } catch (err) { log(`Couldn’t copy ${rel}: ${err.message}`); failed.push(rel); }
    }
    return { folder, rel: relOf(root, folder), copied, failed };
  }

  // Pictures you asked to redo that have been made again, project by project: there's something to look at.
  let waitingMemo = null;
  async function waiting() {
    if (waitingMemo && Date.now() - waitingMemo.at < 20e3) return waitingMemo.list;
    const list = [];
    for (const [root, mine] of Object.entries(marks)) {
      const rels = Object.keys(mine).filter(r => mine[r].mark === 'redo');
      if (!rels.length) continue;
      let again = 0, still = 0;
      for (const [f, st] of await statAll(rels.map(r => inside(root, r)))) { if (sameFile(mine[relOf(root, f)], st)) still++; else again++; }
      if (again) list.push({ root, again, still });
    }
    waitingMemo = { at: Date.now(), list };
    return list;
  }

  // Is this a picture in this folder? (A banner can be any of them, not just the newest.)
  function holds(rootArg, p) {
    try {
      const root = checkRoot(rootArg), abs = inside(root, p);
      return isPic(path.basename(abs)) && allowed(abs, root) && fs.statSync(abs).isFile();
    } catch { return false; }
  }

  const me = { list, mark, exportTo, waiting, holds, flush };
  boards.add(me);
  return me;
}

module.exports = { createBoard, IMG_EXT };
