'use strict';
// The picture board (lib/board.js): folders and counts without reading every file, marks that know
// when a picture has been made again, and nothing outside the folder or in a private place.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBoard } = require('../lib/board');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ss-board-'));
function world() {
  const root = tmp();
  const put = (rel, text = 'x') => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
  put('cover.png'); put('art/v1/aria.png'); put('art/v1/bob.jpg'); put('art/v1/notes.md'); put('art/v2/aria.png', 'newer'); put('node_modules/pkg/logo.png'); put('.hidden/secret.png'); put('art/v2/empty.txt');
  return { root, put };
}

test('board: lists the folders with pictures, and a folder’s pictures', async () => {
  const { root } = world();
  const b = createBoard({ dataDir: tmp() });
  const r = await b.list(root, 'art/v1');
  assert.deepEqual(r.dirs.map(d => [d.rel, d.n]).sort(), [['.', 1], ['art/v1', 2], ['art/v2', 1]]);
  assert.equal(r.dir, 'art/v1');
  assert.deepEqual(r.items.map(i => i.name).sort(), ['aria.png', 'bob.jpg']);
  const aria = r.items.find(i => i.name === 'aria.png');
  assert.deepEqual(aria.others, ['art/v2/aria.png'], 'the same name elsewhere: another version to compare with');
  assert.equal(aria.rel, 'art/v1/aria.png');
  assert.ok(path.isAbsolute(aria.path));
  assert.equal(r.items.find(i => i.name === 'bob.jpg').others, undefined);
});

test('board: opens on the folder changed last when you don’t say which', async () => {
  const { root } = world();
  const old = path.join(root, 'art', 'v1'), when = new Date(Date.now() - 864e5);
  fs.utimesSync(old, when, when); fs.utimesSync(root, when, when);
  const r = await createBoard({ dataDir: tmp() }).list(root);
  assert.equal(r.dir, 'art/v2');
});

test('board: a mark sticks, comes back in the counts, and survives a restart', async () => {
  const { root } = world(), data = tmp();
  const b = createBoard({ dataDir: data });
  b.mark(root, 'art/v1/aria.png', 'redo', 'too dark');
  b.mark(root, ['art/v1/bob.jpg'], 'keep');
  let r = await b.list(root, 'art/v1');
  const by = n => r.items.find(i => i.name === n);
  assert.equal(by('aria.png').mark, 'redo'); assert.equal(by('aria.png').note, 'too dark');
  assert.equal(by('bob.jpg').mark, 'keep');
  const d = r.dirs.find(x => x.rel === 'art/v1');
  assert.equal(d.keep, 1); assert.equal(d.redo, 1);
  b.flush();
  r = await createBoard({ dataDir: data }).list(root, 'art/v1');
  assert.equal(r.items.find(i => i.name === 'aria.png').mark, 'redo', 'kept on the PC');
});

test('board: a picture that’s been made again is to review again, and says what you’d said', async () => {
  const { root, put } = world();
  const b = createBoard({ dataDir: tmp() });
  b.mark(root, 'art/v1/aria.png', 'redo', 'too dark');
  put('art/v1/aria.png', 'a whole new picture');
  const r = await b.list(root, 'art/v1');
  const a = r.items.find(i => i.name === 'aria.png');
  assert.equal(a.mark, null);
  assert.equal(a.was, 'redo');
  assert.equal(a.note, 'too dark');
});

test('board: taking a mark back; many at once', async () => {
  const { root } = world();
  const b = createBoard({ dataDir: tmp() });
  const m = b.mark(root, ['art/v1/aria.png', 'art/v1/bob.jpg'], 'keep');
  assert.equal(m.done.length, 2);
  b.mark(root, 'art/v1/aria.png', null);
  const r = await b.list(root, 'art/v1');
  assert.equal(r.items.find(i => i.name === 'aria.png').mark, null);
  assert.equal(r.items.find(i => i.name === 'bob.jpg').mark, 'keep');
});

test('board: nothing outside the folder, nothing private, nothing that isn’t there', async () => {
  const { root } = world();
  const b = createBoard({ dataDir: tmp(), allowed: p => !/private/.test(p) });
  assert.throws(() => b.mark(root, '../outside.png', 'keep'), e => e.status === 400);
  assert.throws(() => b.mark(root, 'art/v1/aria.png', 'burn'), e => e.status === 400);
  await assert.rejects(b.list(path.join(os.tmpdir(), 'private-folder')), e => e.status === 403);
  await assert.rejects(b.list(path.join(root, 'no-such-folder')), e => e.status === 404);
  await assert.rejects(b.list(path.join(root, 'cover.png')), e => e.status === 400);
  // A folder that isn't on the list is ignored, not read.
  const r = await b.list(root, '../..');
  assert.notEqual(r.dir, '../..');
});

test('board: what’s kept can be copied to a folder of its own, overwriting nothing', async () => {
  const { root, put } = world();
  put('art/v2/bob.jpg', 'another bob');
  const b = createBoard({ dataDir: tmp() });
  const when = new Date(2026, 9, 31, 12);
  const r = await b.exportTo(root, ['art/v1/aria.png', 'art/v1/bob.jpg', 'art/v2/bob.jpg'], when);
  assert.equal(r.copied, 3);
  assert.deepEqual(r.failed, []);
  assert.equal(r.rel, 'Kept pictures/2026-10-31');
  assert.deepEqual(fs.readdirSync(r.folder).sort(), ['aria.png', 'bob (2).jpg', 'bob.jpg']);
  assert.equal(fs.readFileSync(path.join(r.folder, 'bob (2).jpg'), 'utf8'), 'another bob');
  assert.ok(fs.existsSync(path.join(root, 'art', 'v1', 'aria.png')), 'the original stays');
  // A second go doesn't overwrite the first, and the copies don't show up as more to review.
  const again = await b.exportTo(root, ['art/v1/aria.png'], when);
  assert.equal(again.copied, 1);
  assert.ok(fs.existsSync(path.join(r.folder, 'aria (2).png')));
  const l = await b.list(root, 'art/v1', { fresh: true });
  assert.ok(!l.dirs.some(d => /Kept pictures/.test(d.rel)));
  assert.deepEqual(l.items.find(i => i.name === 'aria.png').others, ['art/v2/aria.png']);
  await assert.rejects(b.exportTo(root, ['../outside.png'], when), e => e.status === 400);
  const odd = await b.exportTo(root, ['art/v1/notes.md'], when);
  assert.deepEqual(odd.failed, ['art/v1/notes.md'], 'pictures only');
});

test('board: Newest shows a picture once, however many folders it’s been copied to', async () => {
  const { root, put } = world();
  put('site/dist/img/hero.png', 'same bytes'); put('site/img/hero.png', 'same bytes'); put('site/other/hero.png', 'different bytes');
  const r = await createBoard({ dataDir: tmp() }).list(root, ':new');
  const heroes = r.items.filter(i => i.name === 'hero.png');
  assert.equal(heroes.length, 2, 'the copy goes, a different picture of that name stays');
  assert.equal((await createBoard({ dataDir: tmp() }).list(root, 'site/img')).items.length, 1, 'in a folder, everything shows');
});

test('board: pictures you asked to redo that are back are counted, project by project', async () => {
  const { root, put } = world();
  const b = createBoard({ dataDir: tmp() });
  assert.deepEqual(await b.waiting(), []);
  b.mark(root, ['art/v1/aria.png', 'art/v1/bob.jpg'], 'redo');
  b.mark(root, 'cover.png', 'keep');
  assert.deepEqual(await b.waiting(), [], 'nothing’s been made again yet');
  put('art/v1/aria.png', 'made again');
  b.mark(root, 'cover.png', null);   // anything marked asks again
  const w = await b.waiting();
  assert.equal(w.length, 1);
  assert.equal(w[0].again, 1);
  assert.equal(w[0].still, 1);
  assert.equal(path.resolve(w[0].root).toLowerCase(), path.resolve(root).toLowerCase());
  b.mark(root, 'art/v1/aria.png', 'keep');
  assert.deepEqual(await b.waiting(), [], 'marking it answers it');
});

test('board: copies are only of what’s really there, and only go into a real folder', { skip: process.platform === 'win32' ? false : 'junctions are for Windows' }, async () => {
  const { root } = world();
  const outside = tmp();
  fs.writeFileSync(path.join(outside, 'private.png'), 'secret');
  fs.symlinkSync(outside, path.join(root, 'shortcut'), 'junction');
  const b = createBoard({ dataDir: tmp() });
  const when = new Date(2026, 9, 31, 12);
  const r = await b.exportTo(root, ['shortcut/private.png', 'art/v1/aria.png'], when);
  assert.deepEqual(r.failed, ['shortcut/private.png'], 'a picture a link leads to isn’t copied');
  assert.equal(r.copied, 1);
  assert.ok(!fs.existsSync(path.join(r.folder, 'private.png')));
  // The folder they go in, a link to somewhere else.
  const { root: root2 } = world();
  fs.symlinkSync(outside, path.join(root2, 'Kept pictures'), 'junction');
  await assert.rejects(b.exportTo(root2, ['art/v1/aria.png'], when), e => e.status === 400 && /ordinary folder/.test(e.message));
  assert.deepEqual(fs.readdirSync(outside), ['private.png'], 'nothing written there');
  // And a private place by name, as the viewer would refuse it.
  const { root: root3 } = world();
  const strict = createBoard({ dataDir: tmp(), allowed: p => !/art.v1.aria/.test(p) });
  const s = await strict.exportTo(root3, ['art/v1/aria.png', 'art/v1/bob.jpg'], when);
  assert.deepEqual(s.failed, ['art/v1/aria.png']);
});

test('board: a mark that couldn’t be saved is saved next time, not lost', async () => {
  const { root } = world(), data = tmp();
  const store = require('../lib/store');
  const real = store.writeJsonAtomic;
  let refused = 0;
  store.writeJsonAtomic = (...a) => { if (!refused++) throw Object.assign(new Error('in use'), { code: 'EPERM' }); return real(...a); };
  try {
    const logs = [];
    const b = createBoard({ dataDir: data, log: m => logs.push(m) });
    b.mark(root, 'art/v1/aria.png', 'keep');
    b.flush();
    assert.equal(fs.existsSync(path.join(data, 'board.json')), false);
    assert.match(logs[0], /Couldn’t save/);
    b.flush();
    assert.equal(refused, 2);
    assert.match(fs.readFileSync(path.join(data, 'board.json'), 'utf8'), /aria\.png/);
  } finally { store.writeJsonAtomic = real; }
});

test('board: a picture written over at once, the same size, isn’t still the one you marked', async () => {
  const { root, put } = world();
  const b = createBoard({ dataDir: tmp() });
  const f = put('art/v1/same.png', 'AAAA');
  b.mark(root, 'art/v1/same.png', 'keep');
  const st = fs.statSync(f);
  put('art/v1/same.png', 'BBBB');
  fs.utimesSync(f, st.atime, new Date(st.mtimeMs + 500));
  const r = await b.list(root, 'art/v1');
  const x = r.items.find(i => i.name === 'same.png');
  assert.equal(x.mark, null);
  assert.equal(x.was, 'keep');
});

test('board: versions of a picture are the same name, give or take a version on the end', async () => {
  const { root, put } = world();
  put('art/v1/aria-v2.png'); put('art/v1/aria_V3.webp'); put('art/v1/aria (4).png'); put('art/v1/portrait-01.png'); put('art/v1/portrait-02.png');
  const r = await createBoard({ dataDir: tmp() }).list(root, 'art/v1');
  const by = n => r.items.find(i => i.name === n);
  assert.deepEqual([...by('aria.png').others].sort(), ['art/v1/aria (4).png', 'art/v1/aria-v2.png', 'art/v1/aria_V3.webp', 'art/v2/aria.png'].sort());
  assert.ok(by('aria-v2.png').others.includes('art/v1/aria.png'), 'either way round');
  assert.equal(by('portrait-01.png').others, undefined, 'numbers alone are different pictures');
});

test('board: a project that takes a while to walk still shows what it can, and says it’s reading', async () => {
  const { root } = world();
  const b = createBoard({ dataDir: tmp(), patience: 0, newest: () => [{ path: path.join(root, 'cover.png') }] });
  const fsp = require('node:fs').promises, real = fsp.readdir;
  // Slow only for the walk's own look at the folders.
  fsp.readdir = async (...a) => { await new Promise(r => setTimeout(r, 40)); return real.apply(fsp, a); };
  try {
    const first = await b.list(root, ':new');
    assert.equal(first.reading, true);
    assert.deepEqual(first.items.map(i => i.name), ['cover.png'], 'the newest it knows of already');
    const folder = await b.list(root, 'art/v1');
    assert.deepEqual(folder.items.map(i => i.name).sort(), ['aria.png', 'bob.jpg'], 'a folder you ask for is read at once');
    await assert.rejects(b.list(root, '../../outside'), e => e.status === 400, 'and only one in here');
  } finally { fsp.readdir = real; }
  await new Promise(r => setTimeout(r, 400));
  const done = await createBoard({ dataDir: tmp() }).list(root, ':new');
  assert.equal(done.reading, undefined);
  assert.ok(done.dirs.length >= 3);
});

test('board: the list of folders isn’t sent again until it’s changed', async () => {
  const { root } = world();
  const b = createBoard({ dataDir: tmp() });
  const first = await b.list(root, 'art/v1');
  assert.ok(first.dirs.length >= 3);
  assert.ok(first.scanAt);
  const again = await b.list(root, 'art/v1', { have: first.scanAt });
  assert.equal(again.dirs, undefined);
  assert.equal(again.items.length, 2, 'the pictures still come');
  assert.ok((await b.list(root, 'art/v1', { have: first.scanAt - 1 })).dirs, 'an older list is replaced');
  assert.ok((await b.list(root, 'art/v1', { have: first.scanAt, fresh: true })).dirs, 'and looking again sends it');
  b.mark(root, 'art/v1/aria.png', 'keep');
  assert.ok((await b.list(root, 'art/v1', { have: first.scanAt })).dirs, 'so does a new mark, for its counts');
});

test('board: a picture by its name, in any folder', async () => {
  const { root } = world();
  const b = createBoard({ dataDir: tmp() });
  const r = await b.list(root, ':find', { q: 'ARIA' });
  assert.equal(r.dir, ':find');
  assert.deepEqual(r.items.map(i => i.rel), ['art/v1/aria.png', 'art/v2/aria.png']);
  assert.deepEqual((await b.list(root, ':find', { q: '' })).items, []);
  assert.deepEqual((await b.list(root, ':find', { q: 'nobody' })).items, []);
});

test('board: an empty folder is fine', async () => {
  const r = await createBoard({ dataDir: tmp() }).list(tmp());
  assert.deepEqual(r.dirs, []);
  assert.deepEqual(r.items, []);
});
