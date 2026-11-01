'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureHome, syncAuth } = require('../lib/codexhomes');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-account-links-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const main = path.join(root, 'main'), extra = path.join(root, 'extra');
  fs.mkdirSync(main); fs.mkdirSync(extra);
  return { root, main, extra };
}

test('Codex account homes share transcript folders without requiring Windows file symlink privileges', t => {
  const { main, extra } = fixture(t);
  fs.mkdirSync(path.join(main, 'sessions'));
  fs.writeFileSync(path.join(main, 'sessions', 'conversation.jsonl'), 'original');
  fs.writeFileSync(path.join(main, 'state_5.sqlite'), 'database');
  fs.writeFileSync(path.join(main, 'auth.json'), 'main-only');
  fs.writeFileSync(path.join(main, 'state_5.sqlite-wal'), 'main-only');
  const original = fs.symlinkSync;
  const attempted = [];
  t.mock.method(fs, 'symlinkSync', (source, dest, type) => {
    attempted.push({ source, dest, type });
    if (type === 'file') throw Object.assign(new Error('File symlinks not permitted'), { code: 'EPERM' });
    return original(source, dest, type);
  });
  const links = ensureHome({ home: extra }, main);
  assert.equal(fs.readFileSync(path.join(extra, 'sessions', 'conversation.jsonl'), 'utf8'), 'original');
  assert.equal(attempted.find(x => x.dest.endsWith('sessions')).type, process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(links.done, ['sessions']);
  assert.equal(links.errors.length, 1);
  assert.match(links.errors[0], /state_5.sqlite/);
  assert.equal(fs.existsSync(path.join(extra, 'auth.json')), false);
  assert.equal(fs.existsSync(path.join(extra, 'state_5.sqlite-wal')), false);
  assert.deepEqual(ensureHome({ home: extra }, main).done, []);
});

test('Codex auth remains usable if Windows refuses a replacement link', t => {
  const { main, extra } = fixture(t);
  const authFile = path.join(main, 'imported-auth.json'), here = path.join(extra, 'auth.json');
  fs.writeFileSync(authFile, 'old'); fs.writeFileSync(here, 'fresh');
  fs.utimesSync(authFile, new Date(1000), new Date(1000));
  t.mock.method(fs, 'symlinkSync', () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); });
  assert.throws(() => syncAuth({ home: extra, authFile, name: 'Test' }), /EPERM/);
  assert.equal(fs.readFileSync(here, 'utf8'), 'fresh');
  assert.equal(fs.readFileSync(authFile, 'utf8'), 'fresh', 'the rotated token was copied back');
  assert.deepEqual(fs.readdirSync(extra), ['auth.json']);
});

test('Codex account home never replaces existing account files or directories', t => {
  const { main, extra } = fixture(t);
  fs.mkdirSync(path.join(main, 'sessions')); fs.mkdirSync(path.join(extra, 'sessions'));
  fs.writeFileSync(path.join(main, 'config.toml'), 'main');
  fs.writeFileSync(path.join(extra, 'config.toml'), 'own');
  const links = ensureHome({ home: extra }, main);
  assert.deepEqual(links.separate.sort(), ['config.toml', 'sessions']);
  assert.equal(fs.readFileSync(path.join(extra, 'config.toml'), 'utf8'), 'own');
});

test('Codex auth recognizes the same linked file across normalized path spellings', t => {
  const {main,extra}=fixture(t), source=path.join(main,'imported-auth.json'), here=path.join(extra,'auth.json');
  fs.writeFileSync(source,'synthetic credentials');
  try { fs.symlinkSync(source,here,'file'); }
  catch(err) { if(err.code==='EPERM') { t.skip('file symlinks unavailable'); return; } throw err; }
  const authFile=process.platform==='win32'?source.replace(/\\/g,'/').toUpperCase():path.join(main,'..','main','imported-auth.json');
  for(let i=0;i<3;i++) syncAuth({home:extra,authFile,name:'Test'});
  assert.deepEqual(fs.readdirSync(extra),['auth.json'],'an unchanged link creates no replacement backups');
  assert.equal(fs.readFileSync(here,'utf8'),'synthetic credentials');
});
