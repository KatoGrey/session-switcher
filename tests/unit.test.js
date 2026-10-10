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
  'chat-prefs.json', 'devices.json', 'tasks.json', 'races.json', 'open-chats.json', 'reopen.json', 'switcher.log', 'attachments/2026-10-09/clip.mp4', 'mobile/android/debug.keystore', '.claude/settings.local.json'];

test('share copy: personal files stay out', () => {
  const dir = tmp();
  for (const f of ['server.js', 'app.js', 'index.html', 'styles.css', 'README.md', 'lib/chat.js', 'Session Switcher.command', 'macos/icon.icns', 'sounds/rebel-reply.mp3', 'fonts/michroma.woff2']) put(dir, f);
  for (const f of PERSONAL) put(dir, f);
  put(dir, 'tests/unit.test.js');
  const names = appFiles(dir).map(f => f.name);
  for (const f of PERSONAL) assert.ok(!names.includes(f), `${f} must not be shared`);
  assert.ok(!names.some(n => n.startsWith('tests/')), 'the tests aren’t needed to run the app');
  for (const f of ['server.js', 'lib/chat.js', 'Session Switcher.command', 'macos/icon.icns', 'sounds/rebel-reply.mp3', 'fonts/michroma.woff2']) assert.ok(names.includes(f), `${f} should be shared`);
});

test('share copy: this repo’s own files are all safe to share', () => {
  const names = appFiles(APP).map(f => f.name);
  assert.ok(names.includes('server.js') && names.includes('index.html'));
  for (const n of names) assert.match(n, /\.(js|html|css|md|vbs|bat|command|ico|icns|woff2|mp3|txt)$/i, `${n} has an unexpected type`);
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

/* ---------- one conversation, two assistants: titles show what you wrote ---------- */
const { ownText } = require('../lib/shared');
const { readMeta } = require('../lib/sessions');

test('shared context: titles, previews and the board show only what you wrote', () => {
  const shared = '<shared-context items="2">\nYou and Codex share this chat; the user sees you both. Since your last message:\n\nCodex:\nHere it is.\n</shared-context>\n\n';
  assert.equal(ownText(`${shared}Use that art in the patch notes.`), 'Use that art in the patch notes.');
  assert.equal(ownText('<shared-context items="3">\nClaude:\nA preview cut off in the mid'), '', 'a cut-off preview has nothing of yours');
  assert.equal(ownText('Plain message, <shared-context> mentioned later.'), 'Plain message, <shared-context> mentioned later.');
  const file = path.join(tmp(), 'chat.jsonl');
  const line = (text, i) => JSON.stringify({ type: 'user', uuid: `u${i}`, cwd: 'C:\\Projects\\Demo', timestamp: new Date(Date.UTC(2026, 9, 9, 10, i)).toISOString(), message: { role: 'user', content: text } });
  fs.writeFileSync(file, [line(`${shared}Plan the 1.4 release.`, 0), line(`${shared}Now write the notes.`, 1)].join('\n') + '\n');
  const meta = readMeta(file, fs.statSync(file));
  assert.equal(meta.firstPrompt, 'Plan the 1.4 release.');
  assert.equal(meta.autoTitle, 'Plan the 1.4 release.');
  assert.equal(meta.lastPrompt, 'Now write the notes.');
});

/* ---------- out of usage ---------- */
const { translate } = require('../lib/chat');

test('limits: running out becomes a notice and an offer to carry on; nearly out is just a notice', () => {
  const resets = Math.floor(Date.parse('2026-10-09T15:36:00Z') / 1000);
  const out = translate({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: resets } }, {});
  assert.equal(out.length, 2);
  assert.equal(out[0].kind, 'notice');
  assert.match(out[0].text, /reached your 5-hour limit/);
  assert.deepEqual(out[1], { kind: 'limit', which: 'five_hour', resetsAt: '2026-10-09T15:36:00.000Z' });
  const warn = translate({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.91 } }, {});
  assert.deepEqual(warn.map(x => x.kind), ['notice']);
  assert.match(warn[0].text, /close to your weekly limit on this account \(91% used\)/);
  assert.deepEqual(translate({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }, {}), []);
});

/* ---------- rules and tools for both ---------- */
const rules = require('../lib/rules');

test('rules: one text saved to CLAUDE.md and AGENTS.md; the two compared', () => {
  const dir = tmp();
  const paths = rules.rulesPaths({ cwd: dir });
  assert.deepEqual([path.basename(paths.claude), path.basename(paths.codex)], ['CLAUDE.md', 'AGENTS.md']);
  let r = rules.readRules(paths);
  assert.equal(r.claude.exists || r.codex.exists, false);
  put(dir, 'CLAUDE.md', '# Rules\n\nRun the tests.\n');
  r = rules.readRules(paths);
  assert.equal(r.same, false, 'only one exists');
  rules.writeRules(paths, '# Rules\r\n\r\nRun the tests.');
  r = rules.readRules(paths);
  assert.equal(r.same, true);
  assert.equal(fs.readFileSync(paths.codex, 'utf8'), '# Rules\r\n\r\nRun the tests.\n', 'written as typed, with a final newline');
  rules.writeRules(paths, 'Only Claude', ['claude']);
  assert.equal(rules.readRules(paths).same, false);
  assert.throws(() => rules.writeRules(paths, 'x'.repeat(300 * 1024)), /256 KB/);
  const user = rules.rulesPaths({ claudeDir: path.join(dir, '.claude'), codexHome: path.join(dir, '.codex') });
  assert.equal(user.claude, path.join(dir, '.claude', 'CLAUDE.md'));
  assert.equal(user.codex, path.join(dir, '.codex', 'AGENTS.md'));
});

test('tools: both lists side by side, settings by name only (never their values)', () => {
  const dir = tmp(), proj = path.join(dir, 'proj');
  fs.mkdirSync(proj);
  const claudeJson = put(dir, '.claude.json', JSON.stringify({
    mcpServers: { latitude: { type: 'http', url: 'https://mcp.example.com/mcp' } },
    projects: { [proj]: { mcpServers: { local1: { command: 'npx', args: ['local-mcp'], env: { SECRET_TOKEN: 'hunter2' } } } } },
  }));
  put(proj, '.mcp.json', JSON.stringify({ mcpServers: { shared: { command: 'uvx', args: ['shared-mcp'] } } }));
  const claude = rules.claudeServers(claudeJson, proj);
  assert.deepEqual(claude.map(x => `${x.name}:${x.scope}`), ['latitude:user', 'local1:local', 'shared:project']);
  const codex = rules.codexServers([{ name: 'Blender', enabled: true, transport: { type: 'stdio', command: 'uvx', args: ['blender-mcp'], env: { BLENDER_PATH: 'C:\\Blender' } } }, { name: 'latitude', enabled: false, transport: { type: 'streamable_http', url: 'https://mcp.example.com/mcp' } }]);
  const rows = rules.merged(claude, codex);
  assert.deepEqual(rows.map(r => `${r.name}:${!!r.claude}:${!!r.codex}`), ['Blender:false:true', 'latitude:true:true', 'local1:true:false', 'shared:true:false']);
  const shown = JSON.stringify(rows);
  assert.ok(!shown.includes('hunter2') && !shown.includes('C:\\\\Blender'), 'no setting values');
  assert.deepEqual(rows.find(r => r.name === 'local1').claude.envNames, ['SECRET_TOKEN']);
  assert.equal(rows.find(r => r.name === 'latitude').codex.enabled, false);
});

test('tools: what can be copied across, and why not', () => {
  assert.deepEqual(rules.forCodex({ command: 'uvx', args: ['blender-mcp'], env: { PORT: '9876' } }), { value: { command: 'uvx', args: ['blender-mcp'], env: { PORT: '9876' } } });
  assert.deepEqual(rules.forCodex({ type: 'http', url: 'https://x.example/mcp' }), { value: { url: 'https://x.example/mcp' } });
  assert.match(rules.forCodex({ type: 'http', url: 'https://x.example/mcp', headers: { Authorization: 'Bearer abc' } }).why, /headers/);
  assert.deepEqual(rules.forClaude({ type: 'stdio', command: 'uvx', args: ['roblox-mcp'] }), { value: { type: 'stdio', command: 'uvx', args: ['roblox-mcp'] } });
  assert.deepEqual(rules.forClaude({ type: 'streamable_http', url: 'https://x.example/mcp', bearer_token_env_var: 'X_TOKEN' }), { value: { type: 'http', url: 'https://x.example/mcp', headers: { Authorization: 'Bearer ${X_TOKEN}' } } });
  assert.match(rules.forClaude({ command: 'node', args: ['repl.js'], env: { CODEX_HOME: 'C:\\x' } }).why, /part of Codex/);
  assert.match(rules.forClaude({ command: 'node', args: ['x.js'], cwd: 'C:\\tools' }).why, /folder of its own/);
  assert.ok(rules.NAME.test('Roblox_Studio') && !rules.NAME.test('bad.name') && !rules.NAME.test('a b'));
  assert.equal(rules.runnable(process.platform === 'win32' ? 'C:\\x\\claude.exe' : '/usr/local/bin/claude'), true);
  if (process.platform === 'win32') assert.equal(rules.runnable('C:\\x\\claude.cmd'), false, 'a .cmd needs a shell');
});

/* ---------- @ mentions: a project's files ---------- */
const { listFiles } = require('../lib/filelist');

test('mentions: a git project lists what git knows about, new files too, never ignored ones', async () => {
  const dir = repo();
  put(dir, '.gitignore', 'secret.env\nbuild/\n');
  put(dir, 'src/app.js'); put(dir, 'README.md'); gitIn(dir, 'add', '-A'); gitIn(dir, 'commit', '-qm', 'start');
  put(dir, 'src/new file.js'); put(dir, 'secret.env'); put(dir, 'build/out.js');
  const files = await listFiles(dir);
  assert.deepEqual([...files].sort(), ['.gitignore', 'README.md', 'src/app.js', 'src/new file.js']);
});

test('mentions: without git, a walk that skips package and build folders', async () => {
  const dir = tmp();
  put(dir, 'index.html'); put(dir, 'js/main.js'); put(dir, 'node_modules/x/index.js'); put(dir, 'dist/bundle.js'); put(dir, '.cache/x');
  assert.deepEqual([...(await listFiles(dir))].sort(), ['index.html', 'js/main.js']);
});

/* ---------- what a reply changed, and undoing it ---------- */
const snaps = require('../lib/snapshots');

test('snapshots: see what changed between two moments, without touching git’s own state', async () => {
  const dir = repo();
  put(dir, '.gitignore', 'secret.env\n');
  put(dir, 'a.js', 'one\n'); put(dir, 'b.js', 'keep\n'); gitIn(dir, 'add', '-A'); gitIn(dir, 'commit', '-qm', 'start');
  put(dir, 'staged.js', 'mine\n'); gitIn(dir, 'add', 'staged.js');           // you've staged something
  const top = await snaps.topOf(dir);
  // By real names: a temp folder can have two (/var is /private/var on a Mac; Windows has 8.3 names).
  assert.equal(fs.realpathSync.native(top).toLowerCase(), fs.realpathSync.native(dir).toLowerCase());
  const headBefore = gitIn(dir, 'rev-parse', 'HEAD'), indexBefore = gitIn(dir, 'diff', '--cached', '--name-only');
  const before = await snaps.snapshot(top);
  // "The reply": edits a.js, adds c.js, deletes b.js, writes an ignored file.
  put(dir, 'a.js', 'one\ntwo\n'); put(dir, 'c.js', 'new\n'); fs.rmSync(path.join(dir, 'b.js')); put(dir, 'secret.env', 'TOKEN=x');
  const after = await snaps.snapshot(top);
  const ch = await snaps.changes(top, before, after);
  assert.deepEqual(ch.map(c => `${c.status}:${c.path}:${c.add}:${c.del}`).sort(), ['added:c.js:1:0', 'changed:a.js:1:0', 'deleted:b.js:0:1']);
  assert.match(await snaps.diff(top, before, after, 'a.js'), /^\+two$/m);
  assert.equal(gitIn(dir, 'rev-parse', 'HEAD'), headBefore, 'no commits made');
  assert.equal(gitIn(dir, 'diff', '--cached', '--name-only'), indexBefore, 'what you staged is as it was');
  assert.equal(await snaps.topOf(tmp()), null, 'not a git project');
});

// (Compared without line endings: a restored file comes back the way git checks files out on this
// machine, which with core.autocrlf on Windows means CRLF.)
const readLF = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
test('snapshots: undo puts back exactly what the reply changed; later edits are kept unless you insist', async () => {
  const dir = repo();
  put(dir, 'a.js', 'one\n'); put(dir, 'b.js', 'keep\n'); put(dir, 'd.js', 'd\n'); gitIn(dir, 'add', '-A'); gitIn(dir, 'commit', '-qm', 'start');
  const top = await snaps.topOf(dir);
  const before = await snaps.snapshot(top);
  put(dir, 'a.js', 'one\ntwo\n'); put(dir, 'c.js', 'new\n'); fs.rmSync(path.join(dir, 'b.js')); put(dir, 'd.js', 'd2\n');
  const after = await snaps.snapshot(top);
  put(dir, 'd.js', 'd3 (you edited it after)\n');
  const files = (await snaps.changes(top, before, after)).map(c => c.path);
  const r = await snaps.restore(top, before, after, files);
  assert.deepEqual(r.restored.sort(), ['a.js', 'b.js', 'c.js']);
  assert.deepEqual(r.skipped, [{ path: 'd.js', why: 'changed since' }]);
  assert.equal(readLF(path.join(dir, 'a.js')), 'one\n');
  assert.equal(readLF(path.join(dir, 'b.js')), 'keep\n', 'a deleted file comes back');
  assert.ok(!fs.existsSync(path.join(dir, 'c.js')), 'an added file goes');
  assert.equal(readLF(path.join(dir, 'd.js')), 'd3 (you edited it after)\n');
  const forced = await snaps.restore(top, before, after, ['d.js'], { force: true });
  assert.deepEqual(forced.restored, ['d.js']);
  assert.equal(readLF(path.join(dir, 'd.js')), 'd\n');
  assert.deepEqual((await snaps.restore(top, before, after, ['../outside.js'])).skipped, [{ path: '../outside.js', why: 'outside the project' }]);
});

test('a chat: snapshot before your message, its changes when the reply ends, and undo', async () => {
  const { LiveChat } = require('../lib/chat');
  const dir = repo();
  put(dir, 'game.lua', 'rally = 0.15\n'); gitIn(dir, 'add', '-A'); gitIn(dir, 'commit', '-qm', 'start');
  // A chat that never starts Claude Code: just its bookkeeping.
  const chat = new LiveChat({ cfg: {}, account: { id: 'main', name: 'Main' }, cwd: dir, log: () => {} });
  chat.state = 'ready';
  await chat.beforeTurn();
  assert.ok(chat.snap.pending && chat.snap.top, 'a snapshot is taken');
  put(dir, 'game.lua', 'rally = 0.10\n'); put(dir, 'notes.md', 'Rally no longer stacks.\n');
  await chat.afterTurn();
  const ev = chat.buffer.find(e => e.kind === 'changes');
  assert.deepEqual(ev.files.map(f => `${f.status}:${f.path}`).sort(), ['added:notes.md', 'changed:game.lua']);
  assert.match(await chat.turnDiff(ev.turn, 'game.lua'), /^-rally = 0\.15$/m);
  await assert.rejects(chat.turnDiff(ev.turn, 'other.lua'), /wasn’t changed by this reply/);
  const r = await chat.undoTurn(ev.turn);
  assert.deepEqual(r.restored.sort(), ['game.lua', 'notes.md']);
  assert.equal(readLF(path.join(dir, 'game.lua')), 'rally = 0.15\n');
  assert.ok(!fs.existsSync(path.join(dir, 'notes.md')));
  assert.ok(chat.buffer.some(e => e.kind === 'undone' && e.turn === ev.turn));
  // A reply that changes nothing says nothing; a chat outside git never snapshots.
  await chat.beforeTurn(); await chat.afterTurn();
  assert.equal(chat.buffer.filter(e => e.kind === 'changes').length, 1);
  const plain = new LiveChat({ cfg: {}, account: { id: 'main', name: 'Main' }, cwd: tmp(), log: () => {} });
  plain.state = 'ready';
  await plain.beforeTurn();
  assert.equal(plain.snap.pending, null);
});

/* ---------- queued tasks ---------- */
const tasks = require('../lib/tasks');

test('tasks: checked when queued; started on the account with the most room, and only when it has some', () => {
  const projectAt = cwd => (cwd === 'C:\\Proj' ? { cwd: 'C:\\Proj', name: 'Proj', exists: true } : null);
  const accounts = [{ id: 'main', usable: true }, { id: 'work', usable: true }, { id: 'locked', usable: false }];
  const t = tasks.validTask({ cwd: 'C:\\Proj', provider: 'claude', accountId: 'auto', prompt: '  Write the tests  ', when: 'now' }, { projectAt, accounts });
  assert.equal(t.prompt, 'Write the tests');
  assert.equal(t.state, 'queued');
  assert.throws(() => tasks.validTask({ cwd: 'C:\\Elsewhere', prompt: 'x' }, { projectAt, accounts }), /Pick one of your projects/);
  assert.throws(() => tasks.validTask({ cwd: 'C:\\Proj', prompt: '   ' }, { projectAt, accounts }), /Write what the task should do/);
  assert.throws(() => tasks.validTask({ cwd: 'C:\\Proj', prompt: 'x', when: 'at', at: 'soon' }, { projectAt, accounts }), /Pick when/);
  const u = (five, week) => ({ data: { available: true, fiveHour: { used: five }, week: { used: week } } });
  // Auto: the one with the most room (main has 3% left of its week; work has 40%).
  let r = tasks.readyAccount(t, { accounts, usage: { main: u(10, 97), work: u(60, 20) } });
  assert.equal(r.account.id, 'work');
  // Nobody has room: it waits.
  r = tasks.readyAccount(t, { accounts, usage: { main: u(100, 50), work: u(10, 99) } });
  assert.deepEqual(r, { account: null, why: 'room' });
  // A set account waits for that account.
  const onMain = { ...t, accountId: 'main' };
  assert.equal(tasks.readyAccount(onMain, { accounts, usage: { main: u(100, 10), work: u(0, 0) } }).why, 'room');
  // Not before its time.
  const later = { ...t, when: 'at', at: new Date(Date.now() + 3600e3).toISOString() };
  assert.equal(tasks.readyAccount(later, { accounts, usage: {} }).why, 'time');
  // Codex: its own usage.
  const cx = { ...t, provider: 'codex', accountId: 'codex' };
  assert.equal(tasks.readyAccount(cx, { accounts, usage: { codex: u(50, 50) } }).account.id, 'codex');
  assert.equal(tasks.readyAccount(cx, { accounts, usage: { codex: u(99, 10) } }).why, 'room');
  // Finished tasks drop off after a while.
  const old = { ...t, state: 'started', doneAt: new Date(Date.now() - 7 * 3600e3).toISOString() };
  assert.deepEqual(tasks.tidy([t, old]).map(x => x.state), ['queued']);
});

/* ---------- race: two copies, keep one ---------- */
const race = require('../lib/race');

test('race: two copies from where the project is now; keep one, and both copies go', async () => {
  const dir = repo();
  put(dir, 'game/rally.lua', 'bonus = 0.15\nstacks = true\n'); put(dir, 'README.md', 'Game\n');
  gitIn(dir, 'add', '-A'); gitIn(dir, 'commit', '-qm', 'start');
  put(dir, 'game/wip.lua', 'unfinished\n');                 // uncommitted work comes along
  put(dir, 'staged.txt', 'mine\n'); gitIn(dir, 'add', 'staged.txt');
  const head = gitIn(dir, 'rev-parse', 'HEAD'), branches = gitIn(dir, 'branch', '--list'), staged = gitIn(dir, 'diff', '--cached', '--name-only');
  const r = await race.makeRace(path.join(dir, 'game'));
  assert.ok(race.isRaceDir(r.copies.claude.cwd) && race.isRaceDir(r.copies.codex.cwd));
  assert.equal(path.basename(r.copies.claude.cwd), 'game', 'each copy opens at the same place in the project');
  assert.equal(readLF(path.join(r.copies.codex.path, 'game', 'wip.lua')), 'unfinished\n');
  // Each one works.
  put(r.copies.claude.path, 'game/rally.lua', 'bonus = 0.15\nstacks = false\n');
  put(r.copies.codex.path, 'game/rally.lua', 'bonus = 0.10\nstacks = true\n'); put(r.copies.codex.path, 'game/notes.md', 'why\n');
  const c = await race.copyChanges(r, 'claude'), x = await race.copyChanges(r, 'codex');
  assert.deepEqual(c.files.map(f => f.path), ['game/rally.lua']);
  assert.deepEqual(x.files.map(f => f.path).sort(), ['game/notes.md', 'game/rally.lua']);
  assert.match(await race.copyDiff(r, 'claude', 'game/rally.lua'), /^\+stacks = false$/m);
  assert.equal(readLF(path.join(dir, 'game', 'rally.lua')), 'bonus = 0.15\nstacks = true\n', 'your folder untouched while they work');
  // Keep Claude's.
  const k = await race.keepCopy(r, 'claude');
  assert.equal(k.applied, true);
  assert.equal(readLF(path.join(dir, 'game', 'rally.lua')), 'bonus = 0.15\nstacks = false\n');
  assert.ok(!fs.existsSync(path.join(dir, 'game', 'notes.md')), 'only the kept one’s changes');
  await race.dropRace(r);
  assert.ok(!fs.existsSync(r.dir), 'the copies are gone');
  assert.equal(gitIn(dir, 'worktree', 'list').split('\n').length, 1, 'git forgets them');
  assert.equal(gitIn(dir, 'rev-parse', 'HEAD'), head, 'no commits on your branch');
  assert.equal(gitIn(dir, 'branch', '--list'), branches, 'no branches made');
  assert.equal(gitIn(dir, 'diff', '--cached', '--name-only'), staged, 'what you staged is as it was');
});

test('race: a project reached through another name for its folder still gets its copies right', async () => {
  // Like a Mac's /var (really /private/var) or a Windows short name: a link to the project.
  const dir = repo();
  put(dir, 'game/rally.lua', 'stacks = true\n'); gitIn(dir, 'add', '-A'); gitIn(dir, 'commit', '-qm', 'start');
  const link = path.join(tmp(), 'linked');
  fs.symlinkSync(dir, link, 'junction');
  const r = await race.makeRace(path.join(link, 'game'));
  try {
    assert.ok(race.isRaceDir(r.copies.claude.cwd) && race.isRaceDir(r.copies.codex.cwd), r.copies.claude.cwd);
    assert.equal(path.basename(r.copies.claude.cwd), 'game');
    assert.equal(readLF(path.join(r.copies.claude.cwd, 'rally.lua')), 'stacks = true\n');
  } finally { await race.dropRace(r); }
});

test('race: keeping waits if the project changed since the race began', async () => {
  const dir = repo();
  put(dir, 'a.txt', 'one\n'); gitIn(dir, 'add', '-A'); gitIn(dir, 'commit', '-qm', 'start');
  const r = await race.makeRace(dir);
  put(r.copies.codex.path, 'a.txt', 'codex\n');
  put(dir, 'a.txt', 'you changed it meanwhile\n');
  assert.deepEqual(await race.keepCopy(r, 'codex'), { applied: false, why: 'changed' });
  const forced = await race.keepCopy(r, 'codex', { force: true });
  assert.equal(forced.applied, false);
  assert.equal(forced.why, 'conflict', 'git says what it couldn’t apply, and leaves your edit alone');
  assert.equal(readLF(path.join(dir, 'a.txt')), 'you changed it meanwhile\n');
  assert.ok(!fs.existsSync(path.join(dir, 'a.txt.rej')), 'all or nothing: no leftovers');
  await race.dropRace(r);
  await assert.rejects(race.makeRace(tmp()), /needs a git project/);
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

/* ---------- starting while another copy runs: never an old server behind new pages ---------- */
const handover = require('../lib/handover');
const http = require('http');
// A stand-in for whatever is on the port. `answer` decides what /api/version returns.
function fakeServer(answer) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      if (req.url === '/api/quit' && req.method === 'POST') {
        const ok = srv.token && req.headers['x-switcher-token'] === srv.token;
        res.writeHead(ok ? 200 : 403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok }));
        if (ok) srv.close();
        return;
      }
      const [status, body] = answer();
      res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
const base = { version: '6.0.0', build: 'aaaa', appDir: path.join(os.tmpdir(), 'ss-app'), sys: {} };

test('handover: the same build just brings its window up', async () => {
  const srv = await fakeServer(() => [200, { app: 'session-switcher', version: '6.0.0', build: 'aaaa', pid: 1 }]);
  const r = await handover.takeOver({ ...base, port: srv.address().port, owner: async () => assert.fail('nothing to stop') });
  assert.equal(r, 'open'); srv.close();
});

test('handover: a copy started before an update asks it to quit, then starts', async () => {
  const srv = await fakeServer(() => [200, { app: 'session-switcher', version: '6.0.0', build: 'old-build', pid: 4242 }]);
  const port = srv.address().port;
  srv.token = 'secret-token';
  handover.writeLock(port, { pid: 4242, version: '6.0.0', build: 'old-build', token: 'secret-token' });
  const r = await handover.takeOver({ ...base, port, owner: async () => assert.fail('it should be asked, not stopped') });
  assert.equal(r, 'start');
  try { fs.unlinkSync(handover.lockFile(port)); } catch { /* gone */ }
});

test('handover: an older copy without the check is stopped by its process', async () => {
  const srv = await fakeServer(() => [403, { error: 'This page is out of date. Reload it.', reason: 'stale' }]);
  let killed = null;
  const r = await handover.takeOver({ ...base, port: srv.address().port, owner: async () => ({ pid: 777, name: 'node.exe', cmd: '"node" "C:\\Apps\\claude-switcher\\server.js"' }), kill: pid => { killed = pid; srv.close(); } });
  assert.equal(killed, 777); assert.equal(r, 'start');
});

test('handover: a newer version running is left alone', async () => {
  const srv = await fakeServer(() => [200, { app: 'session-switcher', version: '9.0.0', build: 'zzzz', pid: 1 }]);
  const r = await handover.takeOver({ ...base, port: srv.address().port, owner: async () => assert.fail('never stop a newer copy') });
  assert.equal(r, 'open'); srv.close();
});

test('handover: another program on the port is never stopped', async () => {
  const srv = await fakeServer(() => [200, '<html>someone else</html>']);
  let killed = false;
  const r = await handover.takeOver({ ...base, port: srv.address().port, owner: async () => ({ pid: 5, name: 'python.exe', cmd: 'python -m http.server' }), kill: () => { killed = true; } });
  assert.equal(r, 'busy'); assert.equal(killed, false); srv.close();
});

// Something on the port that takes the connection and hangs up without answering.
const silentServer = () => new Promise(resolve => { const srv = require('net').createServer(s => s.destroy()); srv.listen(0, '127.0.0.1', () => resolve(srv)); });

test('handover: a hung copy started as plain `node server.js` is known by its lock file', async () => {
  const srv = await silentServer();
  const port = srv.address().port;
  handover.writeLock(port, { pid: 888, version: '6.0.0', build: 'old-build', dir: base.appDir, token: 't' });
  let killed = null;
  const r = await handover.takeOver({ ...base, port, owner: async () => ({ pid: 888, name: 'node', cmd: 'node server.js' }), kill: pid => { killed = pid; srv.close(); } });
  assert.equal(killed, 888); assert.equal(r, 'start');
  try { fs.unlinkSync(handover.lockFile(port)); } catch { /* gone */ }
});

test('handover: the same code that is only slow to answer is left running', async () => {
  const srv = await silentServer();
  const port = srv.address().port;
  handover.writeLock(port, { pid: 889, version: '6.0.0', build: 'aaaa', dir: base.appDir, token: 't' });
  const r = await handover.takeOver({ ...base, port, owner: async () => ({ pid: 889, name: 'node', cmd: 'node server.js' }), kill: () => assert.fail('never stop the same code') });
  assert.equal(r, 'open'); srv.close();
  try { fs.unlinkSync(handover.lockFile(port)); } catch { /* gone */ }
});

test('handover: a hung copy from another folder is not stopped', async () => {
  const srv = await silentServer();
  const port = srv.address().port;
  handover.writeLock(port, { pid: 890, version: '6.0.0', build: 'old-build', dir: path.join(os.tmpdir(), 'elsewhere'), token: 't' });
  const r = await handover.takeOver({ ...base, port, owner: async () => ({ pid: 890, name: 'node', cmd: 'node server.js' }), kill: () => assert.fail('not this folder’s copy') });
  assert.equal(r, 'busy'); srv.close();
  try { fs.unlinkSync(handover.lockFile(port)); } catch { /* gone */ }
});

test('handover: the build fingerprint follows the code, not file dates', () => {
  const dir = tmp();
  put(dir, 'server.js', 'a'); put(dir, 'ui/base.js', 'b');
  const one = handover.buildId(dir);
  fs.utimesSync(path.join(dir, 'ui/base.js'), new Date(2000, 1, 1), new Date(2000, 1, 1));
  assert.equal(handover.buildId(dir), one);
  put(dir, 'ui/base.js', 'b2');
  assert.notEqual(handover.buildId(dir), one);
});
