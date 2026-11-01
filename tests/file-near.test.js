'use strict';
// A file a chat only names, or a folder it shortens: found where it's likely to be, and only there.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const files = require('../lib/files');

function world(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-near-')));
  const home = path.join(root, 'Users', 'me'), cloud = path.join(home, 'OneDrive'), project = path.join(root, 'work', 'Rebirth');
  const was = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME, OneDrive: process.env.OneDrive, OneDriveConsumer: process.env.OneDriveConsumer, OneDriveCommercial: process.env.OneDriveCommercial };
  Object.assign(process.env, { USERPROFILE: home, HOME: home, OneDrive: cloud });
  delete process.env.OneDriveConsumer; delete process.env.OneDriveCommercial;
  t.after(() => {
    for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const put = (...parts) => { const f = path.join(...parts); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); return f; };
  fs.mkdirSync(project, { recursive: true });
  return { root, home, cloud, project, put };
}

test('near: the Rebirth case, a zip named by itself, and a folder that’s really in OneDrive', async t => {
  const { cloud, project, put } = world(t);
  const zip = put(cloud, 'Documents', 'Rebirth World Tempting', 'site-deploy.zip');
  assert.deepEqual(await files.findNear(project, 'site-deploy.zip'), [zip], 'by its name alone');
  assert.deepEqual(await files.findNear(project, 'Documents\\Rebirth World Tempting'.replace(/\\/g, path.sep)), [path.dirname(zip)], 'the shortened folder');
  assert.deepEqual(await files.findNear(project, 'site-deploy.zip', { near: ['Documents/Rebirth World Tempting'] }), [zip], 'with the folder the reply named');
});

test('near: the chat’s own folder comes first, however deep', async t => {
  const { cloud, project, put } = world(t);
  const mine = put(project, 'docs', 'deep', 'plan.md');
  put(cloud, 'Documents', 'Other', 'plan.md');
  assert.deepEqual(await files.findNear(project, 'plan.md'), [mine]);
  assert.deepEqual(await files.findNear(project, path.join('deep', 'plan.md')), [mine], 'a part of its path too');
});

test('near: a folder the chat pointed to beats looking elsewhere; two equally likely are both offered', async t => {
  const { root, cloud, project, put } = world(t);
  const there = put(root, 'Sites', 'one', 'notes.txt');
  put(cloud, 'Documents', 'Other', 'notes.txt');
  assert.deepEqual(await files.findNear(project, 'notes.txt', { near: [path.dirname(there)] }), [there]);
  const a = put(cloud, 'Documents', 'A', 'both.txt'), b = put(cloud, 'Documents', 'B', 'both.txt');
  assert.deepEqual((await files.findNear(project, 'both.txt')).sort(), [a, b].sort());
});

test('near: only names, and never a private place', async t => {
  const { home, cloud, project, put } = world(t);
  const secret = put(home, 'Documents', '.ssh', 'server.txt');
  put(cloud, 'Documents', 'keys', 'auth.json');
  put(project, 'node_modules', 'x', 'lib.txt');
  assert.deepEqual(await files.findNear(project, 'server.txt'), [], 'not looked for in a hidden folder');
  assert.deepEqual(await files.findNear(project, 'auth.json'), [], 'sign-in files never open');
  assert.deepEqual(await files.findNear(project, 'lib.txt'), [], 'nor through node_modules');
  assert.deepEqual(await files.findNear(project, 'server.txt', { near: [path.dirname(secret)] }), [], 'nor by being pointed there');
  for (const raw of ['../server.txt', path.join(home, 'gone.txt'), '~/gone.txt', '']) assert.deepEqual(await files.findNear(project, raw), [], raw);
  assert.deepEqual(await files.findNear(project, 'nowhere.zip'), []);
});

test('near: looking is bounded, and doesn’t go through a link', async t => {
  const { root, cloud, project, put } = world(t);
  for (let i = 0; i < 30; i++) fs.mkdirSync(path.join(cloud, 'Documents', `d${i}`), { recursive: true });
  put(cloud, 'Documents', 'd29', 'far.txt');
  assert.deepEqual(await files.findNear(project, 'far.txt', { maxDirs: 3 }), [], 'it stops when it’s looked at enough');
  const outside = put(root, 'outside', 'linked.txt'), link = path.join(cloud, 'Documents', 'through');
  try { fs.symlinkSync(path.dirname(outside), link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (err) { if (err.code === 'EPERM') return; throw err; }
  assert.deepEqual(await files.findNear(project, 'linked.txt'), []);
});
