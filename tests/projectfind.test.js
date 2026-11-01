'use strict';
// Words in a project's files (lib/projectfind.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { find } = require('../lib/projectfind');

function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-find-'));
  const put = (rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  put('lore/queen.md', 'The Queen rules.\r\nNothing here.\nThe old queen and the young QUEEN met.\n');
  put('data/npcs.json', '{"name":"The Queen of Ash"}');
  put('notes.txt', 'a queen\nb queen\nc queen\nd queen\ne queen\n');
  put('node_modules/pkg/readme.md', 'queen');
  put('.hidden/secret.md', 'queen');
  put('art/queen.png', 'queen');
  put('big.md', `queen ${'x'.repeat(3 << 20)}`);
  put('other.md', 'Nothing to see.');
  return root;
}

test('find: which files have the words, in any case, documents first', async () => {
  const r = await find(world(), 'QUEEN');
  assert.deepEqual(r.hits.map(h => h.rel), ['notes.txt', 'lore/queen.md', 'data/npcs.json']);
  assert.equal(r.cut, false);
  assert.equal(r.files, 4, 'only files of words, and not the skipped folders, the hidden one or the too big one');
});

test('find: how many, and the first few lines with their numbers', async () => {
  const r = await find(world(), 'queen');
  const lore = r.hits.find(h => h.rel === 'lore/queen.md');
  assert.equal(lore.count, 3);
  assert.deepEqual(lore.lines.map(l => l.n), [1, 3]);
  assert.equal(lore.lines[0].text, 'The Queen rules.', 'without the line ending');
  const notes = r.hits.find(h => h.rel === 'notes.txt');
  assert.equal(notes.count, 5);
  assert.equal(notes.lines.length, 3, 'a few lines each');
  assert.ok(path.isAbsolute(notes.path));
});

test('find: a long line shows around the match', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-find-'));
  fs.writeFileSync(path.join(root, 'long.md'), `${'a'.repeat(500)} queen ${'b'.repeat(500)}`);
  const [hit] = (await find(root, 'queen')).hits;
  assert.ok(hit.lines[0].text.startsWith('…'));
  assert.ok(hit.lines[0].text.includes('queen'));
  assert.ok(hit.lines[0].text.length <= 210);
});

test('find: what the viewer wouldn’t open isn’t read here either', async () => {
  const root = world();
  const put = (rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  put('auth.json', '{"token":"queen"}');
  put('config/AUTH.JSON', '{"token":"queen"}');
  const r = await find(root, 'queen');
  assert.ok(!r.hits.some(h => /auth\.json$/i.test(h.rel)), r.hits.map(h => h.rel).join());
  assert.equal(r.files, 4, 'they aren’t even read');
});

test('find: doesn’t follow a link out of the project', { skip: process.platform !== 'win32' && 'a junction is a Windows thing' }, async () => {
  const root = world(), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-find-out-'));
  fs.writeFileSync(path.join(outside, 'elsewhere.md'), 'queen');
  fs.symlinkSync(outside, path.join(root, 'linked'), 'junction');
  assert.ok(!(await find(root, 'queen')).hits.some(h => /elsewhere/.test(h.rel)));
});

test('find: too little to go on, nothing found, or out of time', async () => {
  const root = world();
  assert.deepEqual(await find(root, ' a '), { hits: [], files: 0, cut: false });
  assert.deepEqual((await find(root, 'nobody here')).hits, []);
  const out = await find(root, 'queen', { budget: -1 });
  assert.equal(out.cut, true, 'it says it stopped early');
  const few = await find(root, 'queen', { maxFiles: 0 });
  assert.equal(few.cut, true);
});
