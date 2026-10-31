'use strict';
// What Claude remembers about a project (lib/memories.js): read, and a wrong note forgotten, recoverably.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMemories, frontMatter, indexTitles } = require('../lib/memories');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ss-mem-'));
function world() {
  const root = tmp(), dir = path.join(root, 'C--Projects-Tavern', 'memory');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), '# Memory Index\n\nSome words first.\n\n- [Start here](handoffs.md) — where to begin\n- [No heredocs](heredoc.md) — they mangle backslashes\n');
  fs.writeFileSync(path.join(dir, 'handoffs.md'), '---\nname: claude-handoffs\ndescription: "The start-here documents, with \\"quotes\\""\nmetadata:\n  type: project\n---\n\nThe body.\n');
  fs.writeFileSync(path.join(dir, 'heredoc.md'), '---\nname: heredoc\ndescription: Plain words\ntype: feedback\n---\nBody\n');
  fs.writeFileSync(path.join(dir, 'bare.md'), 'A note with no top part.\n');
  fs.writeFileSync(path.join(dir, 'picture.png'), 'not a note');
  return { dir, data: tmp() };
}

test('memories: the top of a note says what it is', () => {
  const fm = frontMatter('---\nname: x\ndescription: "Say \\"this\\""\nmetadata:\n  type: user\n---\n\nBody');
  assert.equal(fm.name, 'x'); assert.equal(fm.description, 'Say "this"'); assert.equal(fm.type, 'user'); assert.equal(fm.body, '\nBody');
  assert.equal(frontMatter('No top part').body, 'No top part');
  assert.equal(indexTitles('- [A title](a.md) — hook\n* [Other](b.md)\nnot [this](c.md)').get('b.md'), 'Other');
  assert.equal(indexTitles('not [this](c.md)').size, 0);
});

test('memories: a project’s notes, with their names in plain words', async () => {
  const { dir, data } = world();
  const r = await createMemories({ dataDir: data }).list(dir);
  const by = f => r.notes.find(n => n.file === f);
  assert.equal(r.notes.length, 3, 'not the index, not a picture');
  assert.equal(r.index, path.join(dir, 'MEMORY.md'));
  assert.equal(by('handoffs.md').title, 'Start here', 'as the index names it');
  assert.equal(by('handoffs.md').description, 'The start-here documents, with "quotes"');
  assert.equal(by('handoffs.md').type, 'project');
  assert.equal(by('heredoc.md').type, 'feedback');
  assert.equal(by('bare.md').title, 'bare');
  assert.equal(by('bare.md').description, '');
  assert.ok(path.isAbsolute(by('bare.md').path));
});

test('memories: no folder, no notes', async () => {
  const m = createMemories({ dataDir: tmp() });
  assert.deepEqual(await m.list(null), { notes: [] });
  assert.deepEqual(await m.list(path.join(tmp(), 'nothing')), { notes: [] });
});

test('memories: forgetting sets a note aside and takes it out of the index; it can come back', async () => {
  const { dir, data } = world();
  const m = createMemories({ dataDir: data });
  const f = await m.forget(dir, 'heredoc.md');
  assert.ok(!fs.existsSync(path.join(dir, 'heredoc.md')));
  assert.ok(!fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8').includes('heredoc.md'));
  assert.ok(fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8').includes('handoffs.md'), 'the others stay');
  assert.match(f.line, /No heredocs/);
  assert.equal(fs.readFileSync(path.join(data, 'forgotten-notes', 'C--Projects-Tavern', f.kept), 'utf8').includes('Plain words'), true, 'kept');
  assert.equal((await m.list(dir)).notes.length, 2);
  await m.bringBack(dir, 'heredoc.md', f.kept, f.line);
  assert.ok(fs.existsSync(path.join(dir, 'heredoc.md')));
  assert.ok(fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8').includes('(heredoc.md)'));
  assert.equal((await m.list(dir)).notes.find(n => n.file === 'heredoc.md').title, 'No heredocs');
});

test('memories: only a note in that folder, and never the index', async () => {
  const { dir, data } = world();
  const m = createMemories({ dataDir: data });
  for (const bad of ['MEMORY.md', 'memory.md', '../other.md', '..\\other.md', 'a/b.md', 'picture.png', '', null]) await assert.rejects(m.forget(dir, bad), e => e.status === 400, String(bad));
  await assert.rejects(m.forget(dir, 'gone.md'), e => e.status === 404);
  assert.ok(fs.existsSync(path.join(dir, 'MEMORY.md')));
  const f = await m.forget(dir, 'bare.md');
  fs.writeFileSync(path.join(dir, 'bare.md'), 'A new one');
  await assert.rejects(m.bringBack(dir, 'bare.md', f.kept, null), e => e.status === 409, 'not over a new note of that name');
  assert.equal(fs.readFileSync(path.join(dir, 'bare.md'), 'utf8'), 'A new one');
  fs.rmSync(path.join(dir, 'bare.md'));
  await assert.rejects(m.bringBack(dir, 'bare.md', '../../nope', null), e => e.status === 404, 'only from where it was kept');
});

test('memories: a note with no index line, and no index at all', async () => {
  const { dir, data } = world();
  const m = createMemories({ dataDir: data });
  const f = await m.forget(dir, 'bare.md');
  assert.equal(f.line, null);
  fs.rmSync(path.join(dir, 'MEMORY.md'));
  const g = await m.forget(dir, 'heredoc.md');
  assert.equal(g.line, null);
  await m.bringBack(dir, 'heredoc.md', g.kept, '- [Back](heredoc.md)');
  assert.match(fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8'), /\[Back\]/);
});
