// Checks of the app's own logic that need no browser: privacy, security and history paging.
// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ss-unit-'));
const put = (dir, rel, text = 'x') => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };

/* ---------- "Make a copy to share" never takes anything personal ---------- */
const { appFiles, zip } = require('../lib/sharecopy');
const PERSONAL = ['accounts.json', 'accounts.json.bak', 'history.json', 'chat-names.json', 'projects.json', 'banners.json', 'prompts.json',
  'chat-prefs.json', 'devices.json', 'switcher.log', 'attachments/2026-10-09/clip.mp4', 'mobile/android/debug.keystore', '.claude/settings.local.json'];

test('share copy: personal files stay out', () => {
  const dir = tmp();
  for (const f of ['server.js', 'app.js', 'index.html', 'styles.css', 'README.md', 'lib/chat.js', 'Session Switcher.command', 'macos/icon.icns']) put(dir, f);
  for (const f of PERSONAL) put(dir, f);
  put(dir, 'tests/unit.test.js');
  const names = appFiles(dir).map(f => f.name);
  for (const f of PERSONAL) assert.ok(!names.includes(f), `${f} must not be shared`);
  assert.ok(!names.some(n => n.startsWith('tests/')), 'the tests aren’t needed to run the app');
  for (const f of ['server.js', 'lib/chat.js', 'Session Switcher.command', 'macos/icon.icns']) assert.ok(names.includes(f), `${f} should be shared`);
});

test('share copy: this repo’s own files are all safe to share', () => {
  const names = appFiles(APP).map(f => f.name);
  assert.ok(names.includes('server.js') && names.includes('index.html'));
  for (const n of names) assert.match(n, /\.(js|html|css|md|vbs|bat|command|ico|icns|woff2|txt)$/i, `${n} has an unexpected type`);
  assert.ok(!names.some(n => /\.json$|\.log$|\.bak$|keystore/i.test(n)), 'no settings, logs or keys');
});

test('share copy: the Mac launcher unzips as runnable', () => {
  const buf = zip([{ name: 'Session Switcher.command', data: Buffer.from('#!/bin/sh\n') }, { name: 'app.js', data: Buffer.from('x') }]);
  const modes = {};
  for (let i = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); i !== -1; i = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), i + 4)) {
    const nameLen = buf.readUInt16LE(i + 28);
    modes[buf.toString('utf8', i + 46, i + 46 + nameLen)] = (buf.readUInt32LE(i + 38) >>> 16) & 0o777;
  }
  assert.equal(modes['Session Switcher.command'], 0o755);
  assert.equal(modes['app.js'], 0o644);
});

/* ---------- the file viewer never opens sign-in files or private folders ---------- */
const files = require('../lib/files');

test('file viewer: sign-in files and keys are refused everywhere', () => {
  const home = os.homedir();
  const project = path.join(home, 'Projects', 'Demo');
  for (const p of [
    path.join(home, '.codex', 'auth.json'),
    path.join(home, '.codex-work', 'auth.json'),
    path.join(home, '.claude', '.credentials.json'),
    path.join(home, '.claude-personal', '.credentials.json'),
    path.join(project, 'deploy.pem'),
    path.join(project, 'auth.json'),
    path.join(home, '.ssh', 'id_ed25519'),
  ]) assert.equal(files.allowed(p, project), false, p);
});

test('file viewer: the project, the user folder and Claude/Codex folders open', () => {
  const home = os.homedir();
  const project = path.join(home, 'Projects', 'Demo');
  for (const p of [path.join(project, 'README.md'), path.join(home, 'Documents', 'notes.md'), path.join(home, '.claude', 'CLAUDE.md'), path.join(home, '.codex', 'AGENTS.md')]) {
    assert.equal(files.allowed(p, project), true, p);
  }
  for (const p of [path.join(home, '.ssh', 'config'), path.join(home, '.aws', 'credentials'), path.join(home, 'Documents', '.hidden', 'x.txt')]) {
    assert.equal(files.allowed(p, project), false, `${p} is a private folder`);
  }
  const outside = process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/hosts';
  assert.equal(files.allowed(outside, project), false, 'outside the user folder');
});

/* ---------- phone pairing ---------- */
const { createRemote } = require('../lib/remote');
const remote = () => createRemote({ dataDir: tmp(), appDir: tmp(), version: 'test', getPrefs: () => ({}), handle: () => {} });
const reqWith = cookie => ({ headers: { cookie: `sw_device=${cookie}` }, socket: { remoteAddress: '127.0.0.1' } });

test('pairing: a code works once, and only for the phone that used it', () => {
  const r = remote();
  const { code } = r.startPairing();
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.ok(r.pair('WRONGCDE', 'Phone').error, 'a wrong code is refused');
  const ok = r.pair(code.toLowerCase(), 'Pixel', '10.0.0.5');
  assert.ok(ok.cookie && !ok.error, 'the right code pairs (in any case)');
  assert.ok(r.pair(code, 'Another').error, 'the code can’t be used twice');
  assert.equal(r.deviceFor(reqWith(ok.cookie)).name, 'Pixel');
  const [id, secret] = ok.cookie.split('.');
  assert.equal(r.deviceFor(reqWith(`${id}.${secret.slice(0, -2)}xx`)), null, 'a changed secret is refused');
  r.forget(id);
  assert.equal(r.deviceFor(reqWith(ok.cookie)), null, 'a removed phone can’t connect');
});

test('pairing: too many wrong codes cancel the code', () => {
  const r = remote();
  const { code } = r.startPairing();
  for (let i = 0; i < 8; i++) r.pair('AAAAAAAA', 'Phone');
  assert.ok(r.pair(code, 'Phone').error, 'after 8 wrong tries even the right code is refused');
});

test('pairing: phone names are cleaned', () => {
  const r = remote();
  const { code } = r.startPairing();
  const ok = r.pair(code, '<img src=x onerror=alert(1)>');
  assert.doesNotMatch(ok.device.name, /[<>=]/);
});

/* ---------- long chats page back without gaps or repeats ---------- */
const { readHistory } = require('../lib/chat');

test('history: paging back through a long chat returns every message once, in order', async () => {
  const file = path.join(tmp(), 'chat.jsonl');
  const lines = [];
  const t0 = Date.parse('2026-10-01T10:00:00Z');
  for (let i = 0; i < 150; i++) {
    lines.push(JSON.stringify({ type: 'user', uuid: `u${i}`, timestamp: new Date(t0 + i * 60000).toISOString(), message: { role: 'user', content: `question ${i}` } }));
    lines.push(JSON.stringify({ type: 'assistant', uuid: `a${i}`, timestamp: new Date(t0 + i * 60000 + 30000).toISOString(), message: { id: `msg_${i}`, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: `answer ${i}` }] } }));
  }
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  const seen = [];
  let cursor = null, pages = 0;
  do {
    const r = await readHistory(file, { cursor, limit: 40 });
    seen.unshift(...r.items);
    cursor = r.cursor; pages++;
    assert.ok(pages < 20, 'paging must end');
  } while (cursor);
  const texts = seen.map(it => (it.kind === 'user' ? it.text : it.blocks.map(b => b.text).join('')));
  assert.equal(texts.length, 300);
  assert.deepEqual(texts.slice(0, 4), ['question 0', 'answer 0', 'question 1', 'answer 1']);
  assert.equal(new Set(texts).size, 300, 'no message twice');
  assert.equal(texts.at(-1), 'answer 149');
});
