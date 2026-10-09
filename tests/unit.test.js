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

/* ---------- the page's scripts share one scope: no name may be declared twice ---------- */
test('page scripts: every ui/ file is loaded, and no top-level name is declared twice', () => {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const loaded = [...html.matchAll(/<script src="\/(ui\/[a-z0-9-]+\.js)"><\/script>/g)].map(m => m[1]);
  const present = fs.readdirSync(path.join(APP, 'ui')).filter(f => f.endsWith('.js')).map(f => `ui/${f}`);
  assert.deepEqual([...loaded].sort(), [...present].sort(), 'index.html loads exactly the files in ui/');
  const seen = new Map();
  const decl = /^(?:async\s+)?function\s*\*?\s*([\w$]+)|^(?:const|let|var|class)\s+([\w$]+)/;
  for (const f of ['theme.js', ...loaded]) {
    fs.readFileSync(path.join(APP, f), 'utf8').split('\n').forEach((line, i) => {
      const m = line.match(decl);
      if (!m) return;
      const name = m[1] || m[2];
      assert.ok(!seen.has(name), `${name} is declared in both ${seen.get(name)} and ${f}:${i + 1}; the later one would silently replace the earlier`);
      seen.set(name, `${f}:${i + 1}`);
    });
  }
});

/* ---------- Codex's code review, read into findings ---------- */
const { parseReview } = require('../lib/codex');

test('review: Codex’s real review text becomes a summary and findings', () => {
  // Exactly what Codex returned for a cart total that skipped its last item.
  const text = 'The loop introduces an off-by-one error that drops the last cart item. Direct execution confirmed incorrect totals and averages for single-item and multi-item carts.\n\nReview comment:\n\n- [P1] Include the last item when calculating the total — C:\\Users\\demo\\AppData\\Local\\Temp\\review-demo\\cart.js:4-4\n  For any nonempty cart, the new loop bound skips the last item, undercounting both `total()` and `average()`. Restore `i < items.length` so every item contributes before applying the discount.\n';
  const r = parseReview(text);
  assert.match(r.overall, /^The loop introduces an off-by-one error/);
  assert.equal(r.findings.length, 1);
  const f = r.findings[0];
  assert.equal(f.priority, 'P1');
  assert.equal(f.title, 'Include the last item when calculating the total');
  assert.equal(f.file, 'C:\\Users\\demo\\AppData\\Local\\Temp\\review-demo\\cart.js');
  assert.deepEqual([f.start, f.end], [4, 4]);
  assert.match(f.body, /^For any nonempty cart/);
});

test('review: several findings, ranges, and findings without a place', () => {
  const r = parseReview('Two problems.\n\nFull review comments:\n\n- [P0] Guard against a missing token — /srv/app/auth.js:10-18\n  The handler reads `req.token.id`\n  before checking it exists.\n\n- [P3] Prefer a named constant\n  Magic number 86400.\n');
  assert.equal(r.overall, 'Two problems.');
  assert.equal(r.findings.length, 2);
  assert.deepEqual([r.findings[0].priority, r.findings[0].file, r.findings[0].start, r.findings[0].end], ['P0', '/srv/app/auth.js', 10, 18]);
  assert.equal(r.findings[0].body, 'The handler reads `req.token.id`\nbefore checking it exists.');
  assert.deepEqual([r.findings[1].priority, r.findings[1].title, r.findings[1].file], ['P3', 'Prefer a named constant', null]);
});

/* ---------- what a review looks at ---------- */
const { reviewTarget, EMPTY_TREE } = require('../lib/review');
const { execFileSync } = require('child_process');
const gitIn = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' }).toString().trim();
function repo() {
  const dir = tmp();
  gitIn(dir, 'init', '-q'); gitIn(dir, 'config', 'user.email', 'demo@example.com'); gitIn(dir, 'config', 'user.name', 'Demo');
  return dir;
}

test('review target: uncommitted changes, rechecked from where they started', async () => {
  const dir = repo();
  put(dir, 'a.js', 'one'); gitIn(dir, 'add', '-A'); gitIn(dir, 'commit', '-qm', 'one');
  const head = gitIn(dir, 'rev-parse', 'HEAD');
  put(dir, 'a.js', 'two');
  const t = await reviewTarget(dir, []);
  assert.deepEqual(t.target, { type: 'uncommittedChanges' });
  assert.equal(t.base, head, 'a recheck starts from the commit the changes sit on');
  // Claude commits its fixes meanwhile: the recheck still covers everything since then.
  gitIn(dir, 'commit', '-qam', 'fix');
  const again = await reviewTarget(dir, [], t.base);
  assert.equal(again.target.type, 'custom');
  assert.match(again.target.instructions, new RegExp(`git diff ${head}`));
  assert.equal(again.base, head);
});

test('review target: a clean project reviews its last commit; a first commit reviews everything', async () => {
  const dir = repo();
  put(dir, 'a.js', 'one'); gitIn(dir, 'add', '-A'); gitIn(dir, 'commit', '-qm', 'one');
  const first = await reviewTarget(dir, []);
  assert.equal(first.target.type, 'commit');
  assert.equal(first.base, EMPTY_TREE, 'the first commit has no parent');
  put(dir, 'a.js', 'two'); gitIn(dir, 'commit', '-qam', 'two');
  const second = await reviewTarget(dir, []);
  assert.equal(second.target.sha, gitIn(dir, 'rev-parse', 'HEAD'));
  assert.equal(second.base, gitIn(dir, 'rev-parse', 'HEAD^'));
  assert.match(second.what, /^the last commit \([0-9a-f]{7}\)$/);
});

test('review target: without git, the files the chat changed; nothing changed is said plainly', async () => {
  const dir = tmp();
  const t = await reviewTarget(dir, [path.join(dir, 'songs.lua'), path.join(dir, 'party.json')]);
  assert.equal(t.target.type, 'custom');
  assert.match(t.target.instructions, /songs\.lua[\s\S]*party\.json/);
  assert.equal(t.what, '2 changed files');
  assert.equal(t.base, null);
  await assert.rejects(reviewTarget(dir, []), /nothing to review yet/);
  await assert.rejects(reviewTarget(dir, [], 'not-a-sha'), /nothing to review yet/, 'a bad starting point is ignored');
});

test('review: a clean review has no findings', () => {
  const r = parseReview('I didn’t find any issues in these changes. The new loop bound and discount handling look correct.');
  assert.equal(r.findings.length, 0);
  assert.match(r.overall, /didn’t find any issues/);
});
