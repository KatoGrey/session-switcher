const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjects, autoCrest, crestResult } = require('../lib/projects');

test('project crest: small icons are found, choices persist, and banners remain independent', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-crest-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data'), cwd = path.join(root, 'project');
  fs.mkdirSync(dataDir); fs.mkdirSync(cwd);
  const crest = path.join(cwd, 'crest.png'), other = path.join(cwd, 'painting.webp');
  fs.writeFileSync(crest, Buffer.alloc(400)); fs.writeFileSync(other, Buffer.alloc(7000));
  const art = createProjects({ dataDir });
  assert.equal(art.info(cwd).crest, crest);
  assert.equal(art.info(cwd).banner, null, 'a new crest does not replace the wide banner');
  art.setBanner(cwd, other); art.setCrest(cwd, other);
  const again = createProjects({ dataDir });
  assert.equal(again.info(cwd).crest, other);
  assert.equal(again.info(cwd).crestPicked, true);
  assert.equal(again.setCrest(cwd, null).crest, crest);
  assert.equal(again.info(cwd).banner, other);
  assert.throws(() => again.setCrest(cwd, path.join(root, 'outside.png')), /not in this project/);
  for (let i = 0; i < 305; i++) fs.writeFileSync(path.join(cwd, `photo-${i}.png`), Buffer.alloc(7000));
  const many = again.info(cwd, { maxAgeMs: 0 });
  assert.equal(many.images.length, 300);
  assert.equal(many.crest, crest, 'the crest survives the gallery limit');
  fs.unlinkSync(crest);
  assert.equal(again.info(cwd, { maxAgeMs: 0 }).crest, null);
});

test('automatic crest favours the project root over a nested dependency logo', () => {
  const im = (name, depth, mtime) => ({ name, depth, mtime, path: `${depth}/${name}` });
  assert.equal(autoCrest([im('logo.png', 3, 9), im('crest.png', 0, 1)]), '0/crest.png');
  assert.equal(autoCrest([im('crest-old.png', 0, 1), im('crest-new.png', 0, 2)]), '0/crest-new.png');
});

test('a pending crest checks only its exact root filename and rejects paths or directories', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-crest-result-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  assert.equal(crestResult(cwd, 'crest-123-test.png'), null);
  for (const name of ['../crest-123.png', 'crest-../test.png', 'C:\\crest-123.png', 'logo.png', null]) assert.throws(() => crestResult(cwd, name), /Invalid crest filename/);
  fs.mkdirSync(path.join(cwd, 'crest-directory.png'));
  assert.equal(crestResult(cwd, 'crest-directory.png'), null);
  fs.writeFileSync(path.join(cwd, 'crest-123-test.png'), 'image bytes');
  const found = crestResult(cwd, 'crest-123-test.png');
  assert.equal(found.name, 'crest-123-test.png'); assert.equal(found.depth, 0); assert.equal(found.size, 11);
});
