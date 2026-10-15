// Switcher Lite's housekeeping on real (throwaway) git repos, and web push encryption.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const cp = require('child_process');
const lite = require('../lib/lite');
const { createLiteOps, worktreeOf, freeTargets } = require('../lib/lite-ops');

const sh = (cwd, ...args) => cp.execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString();
const write = (p, s = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

// A repo with a worktree holding: ignored node_modules (and a nested one), ignored .next, a committed
// build/ folder, source, and a link to a folder outside.
function makeRepo() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lite-wt-')));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  sh(repo, 'init', '-q', '-b', 'main');
  write(path.join(repo, '.gitignore'), 'node_modules/\n.next/\n');
  write(path.join(repo, 'src/app.js'), 'code');
  write(path.join(repo, 'build/keep.txt'), 'committed build output');
  sh(repo, 'add', '-A'); sh(repo, 'commit', '-qm', 'init');
  const wt = path.join(base, 'wt-feature');
  sh(repo, 'worktree', 'add', '-q', '-b', 'feature', wt);
  write(path.join(wt, 'node_modules/pkg/index.js'), 'dep');
  write(path.join(wt, 'apps/web/node_modules/x.js'), 'dep');
  write(path.join(wt, '.next/cache.bin'), 'cache');
  const outside = path.join(base, 'outside');
  write(path.join(outside, 'precious.txt'), 'never delete');
  // A junction on Windows: plain links need Developer Mode there (GitHub's machines don't have it). Node
  // reads both as links, so it's the same check: nothing is followed through one.
  fs.symlinkSync(outside, path.join(wt, 'dist'), process.platform === 'win32' ? 'junction' : 'dir');
  return { base, repo, wt, outside };
}

test('Free space removes ignored dependencies and build output only', async () => {
  const { repo, wt, outside } = makeRepo();
  assert.equal(await worktreeOf(repo), null, 'the main checkout is never treated as a worktree');
  const w = await worktreeOf(wt);
  assert.ok(w && w.branch === 'feature');
  const { targets } = await freeTargets(wt);
  assert.deepEqual(targets.sort(), ['.next', 'apps/web/node_modules', 'node_modules'].sort(), 'not the committed build/, not the dist link');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lite-data-'));
  const ops = createLiteOps({ dataDir: dir, store: lite.createLite({ dataDir: dir }) });
  const [r] = await ops.freeSpace([wt]);
  assert.deepEqual(r.removed.sort(), targets.sort());
  assert.ok(!fs.existsSync(path.join(wt, 'node_modules')) && !fs.existsSync(path.join(wt, '.next')));
  assert.ok(fs.existsSync(path.join(wt, 'src/app.js')), 'code stays');
  assert.ok(fs.existsSync(path.join(wt, 'build/keep.txt')), 'a committed build folder stays');
  assert.ok(fs.existsSync(path.join(outside, 'precious.txt')), 'nothing through a link');
  const [again] = await ops.freeSpace([path.join(repo)]);
  assert.match(again.skipped, /Not a git worktree/, 'the main checkout is refused');
});

test('Remove worktree: archived chats only, never with uncommitted changes; the branch stays; rebuild brings it back', async () => {
  const { repo, wt } = makeRepo();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lite-data-'));
  const st = lite.createLite({ dataDir: dir });
  const ops = createLiteOps({ dataDir: dir, store: st });
  await assert.rejects(ops.removeWorktree('c1', wt), /Archive the chat first/);
  st.archive({ chats: ['c0'], records: { c0: { title: 'Another chat' } } });
  await assert.rejects(ops.removeWorktree('c0', wt), /no worktree on record/, 'an archived chat can’t remove a worktree that isn’t its own');
  st.archive({ chats: ['c2'], records: { c2: { title: 'Elsewhere', worktree: path.join(path.dirname(wt), 'other') } } });
  await assert.rejects(ops.removeWorktree('c2', wt), /isn’t this chat’s worktree/);
  st.archive({ chats: ['c1'], records: { c1: { title: 'A chat', worktree: wt } } });
  write(path.join(wt, 'src/new.js'), 'uncommitted');
  await assert.rejects(ops.removeWorktree('c1', wt), /uncommitted/);
  assert.ok(fs.existsSync(wt));
  fs.rmSync(path.join(wt, 'src/new.js'));
  await assert.rejects(ops.removeWorktree('c1', wt), /uncommitted/, 'an untracked link counts too');
  fs.unlinkSync(path.join(wt, 'dist'));
  const r = await ops.removeWorktree('c1', wt);
  assert.equal(r.branch, 'feature');
  assert.ok(!fs.existsSync(wt));
  assert.match(sh(repo, 'branch', '--list', 'feature'), /feature/, 'the branch stays');
  assert.equal(st.get().archived.chats.c1.worktreeRemoved, true);
  const b = await ops.rebuildWorktree('c1');
  assert.ok(b.ok && fs.existsSync(path.join(wt, 'src/app.js')), 'rebuilt from the branch');
});


test('worktree sizes are counted with Node where there’s no du: files and folders, never through a link', async () => {
  const { sizeKB, walkKB } = require('../lib/lite-ops');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lite-size-')));
  const tree = path.join(base, 'tree'), outside = path.join(base, 'outside');
  write(path.join(tree, 'a.txt'), 'x'.repeat(5000));                      // 5000 bytes
  write(path.join(tree, 'node_modules', 'pkg', 'b.bin'), 'y'.repeat(9000)); // 9000 bytes, two folders down
  write(path.join(tree, 'node_modules', 'pkg', 'c.txt'), 'z');
  write(path.join(outside, 'huge.bin'), 'h'.repeat(400 * 1024));            // never counted: only reached through the link
  fs.symlinkSync(outside, path.join(tree, 'node_modules', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const fileKB = n => (process.platform === 'win32' ? Math.ceil(n / 4096) * 4 : null);
  const t = await walkKB(tree), nm = await walkKB(path.join(tree, 'node_modules'));
  assert.equal(t.approx, false);
  assert.ok(t.kb > 0 && t.kb < 200, `the link isn’t followed (${t.kb} KB)`);
  assert.ok(nm.kb > 0 && nm.kb <= t.kb);
  if (process.platform === 'win32') {
    assert.equal(t.kb, fileKB(5000) + fileKB(9000) + fileKB(1), 'Windows: each file in whole 4 KB clusters');
    assert.equal(nm.kb, fileKB(9000) + fileKB(1));
  } else assert.ok(t.kb >= 14, 'what du would count: at least the bytes, in KB');
  assert.ok(fs.existsSync(path.join(outside, 'huge.bin')), 'counting touches nothing');
  // sizeKB: the same shape as du gave ({ [path]: kb }), a folder inside another measured once.
  const both = await sizeKB([tree, path.join(tree, 'node_modules'), path.join(base, 'missing')]);
  assert.deepEqual(Object.keys(both).sort(), [tree, path.join(tree, 'node_modules'), path.join(base, 'missing')].sort());
  assert.deepEqual(both.approx, []);
  assert.equal(both[path.join(base, 'missing')], 0);
  if (process.platform === 'win32') assert.deepEqual([both[tree], both[path.join(tree, 'node_modules')]], [t.kb, nm.kb]);
  // A giant tree stops being counted and says so, instead of holding things up.
  const many = path.join(base, 'many');
  for (let i = 0; i < 30; i++) write(path.join(many, `d${i % 3}`, `f${i}.txt`), 'q');
  const capped = await walkKB(many, { max: { entries: 10, ms: 60e3 } });
  assert.equal(capped.approx, true);
  const capped2 = await sizeKB([many], { max: { entries: 10, ms: 60e3 } });
  if (process.platform === 'win32') assert.deepEqual(capped2.approx, [many], 'marked approximate');
});

test('Free space removes a dependency folder with a link inside it, never what the link points to', async () => {
  const { repo, wt, outside } = makeRepo();
  fs.symlinkSync(outside, path.join(wt, 'node_modules', 'pkg', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lite-data-'));
  const ops = createLiteOps({ dataDir: dir, store: lite.createLite({ dataDir: dir }) });
  const [r] = await ops.freeSpace([wt]);
  assert.ok(r.removed.includes('node_modules'));
  assert.ok(!fs.existsSync(path.join(wt, 'node_modules')));
  assert.ok(fs.existsSync(path.join(outside, 'precious.txt')), 'the link went, not what it pointed to');
  assert.ok(fs.existsSync(path.join(repo, 'src/app.js')));
});

test('Windows: claude and codex start without sh, npm shims through their Node script, arguments exactly as given', { skip: process.platform !== 'win32' && 'Windows only' }, async () => {
  const { planWindows, findOnWindows, cmdArg, spawnWin } = require('../lib/lite-spawn');
  const bin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lite-bin-')));
  // An npm shim, as npm writes them, for a script that prints its arguments.
  write(path.join(bin, 'node_modules', 'faketool', 'cli.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
  write(path.join(bin, 'faketool.cmd'), '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\faketool\\cli.js" %*\r\n');
  write(path.join(bin, 'faketool'), '#!/bin/sh\n');   // npm's sh version sits beside it; Windows never runs that
  const env = { ...process.env, Path: `${bin};${process.env.PATH}` };
  delete env.PATH;
  assert.equal(findOnWindows('faketool', env), path.join(bin, 'faketool.cmd'));
  const plan = planWindows('faketool', ['a'], env);
  assert.equal(plan.args[0], path.join(bin, 'node_modules', 'faketool', 'cli.js'));
  assert.ok(!plan.verbatim && /node(\.exe)?$/i.test(plan.file), 'started with Node, no cmd.exe');
  const weird = ['plain', 'two words', 'quote"inside', 'a & b | c > d', '100%', 'line\nbreak', 'C:\\dir with space\\'];
  const out = await new Promise((resolve, reject) => {
    const p = spawnWin('faketool', weird, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let s = ''; p.stdout.on('data', d => { s += d; }); p.on('error', reject); p.on('close', () => resolve(s));
  });
  assert.deepEqual(JSON.parse(out), weird);
  // A real program starts directly.
  assert.equal(planWindows(process.execPath, ['-v']).file, process.execPath);
  // Anything else goes through cmd.exe, quoted, and refuses what cmd.exe would still read.
  assert.equal(cmdArg('--model'), '--model');
  assert.equal(cmdArg('two words'), '"two words"');
  assert.equal(cmdArg('model_reasoning_effort="medium"'), '"model_reasoning_effort=\\"medium\\""');
  assert.equal(cmdArg('C:\\a b\\'), '"C:\\a b\\\\"');
  for (const bad of ['100%', 'hi!', 'a\nb', '"x" & y']) assert.throws(() => cmdArg(bad), /cmd\.exe/);
  const viaCmd = planWindows('no-such-tool-here', ['x y'], env);
  assert.deepEqual([viaCmd.file, viaCmd.verbatim, viaCmd.args[0]], ['cmd.exe', true, '/d /s /c "no-such-tool-here "x y""']);
});

test('Windows: switcher-codex and switcher-glm reach npm’s codex.cmd and claude.cmd, the task intact', { skip: process.platform !== 'win32' && 'Windows only' }, async () => {
  const bin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lite-fakes-')));
  const shim = name => `@ECHO off\r\nSETLOCAL\r\nSET "dp0=%~dp0"\r\n"node"  "%dp0%\\node_modules\\${name}\\cli.js" %*\r\n`;
  // Fake codex: writes what it got to its -o file. Fake claude: answers like claude -p --output-format json.
  write(path.join(bin, 'node_modules', 'codex', 'cli.js'), "let s = ''; process.stdin.on('data', d => { s += d; }); process.stdin.on('end', () => { const a = process.argv.slice(2); require('fs').writeFileSync(a[a.indexOf('-o') + 1], JSON.stringify({ args: a, stdin: s })); });");
  write(path.join(bin, 'node_modules', 'claude', 'cli.js'), "let s = ''; process.stdin.on('data', d => { s += d; }); process.stdin.on('end', () => { process.stdout.write(JSON.stringify({ result: JSON.stringify({ args: process.argv.slice(2), stdin: s }), num_turns: 1, usage: {} })); });");
  write(path.join(bin, 'codex.cmd'), shim('codex'));
  write(path.join(bin, 'claude.cmd'), shim('claude'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SWITCHER_|PATH$|CLAUDE_CODE_SESSION_ID$)/i.test(k)));
  env.PATH = `${bin};${process.env.PATH}`;
  const task = 'Find why "save" & load fail at 100% | <b> on line\n2';
  const runBin = (script, args) => new Promise(resolve => {
    const p = cp.spawn(process.execPath, [path.join(__dirname, '..', 'bin', script), '--port', '1', ...args, task], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    p.on('close', code => resolve({ code, out, err }));
  });
  const cx = await runBin('switcher-codex.js', ['--cd', bin, '--effort', 'high']);
  assert.equal(cx.code, 0, cx.err);
  const got = JSON.parse(cx.out);
  assert.equal(got.stdin, task, 'the task arrives whole, on stdin');
  assert.equal(got.args[got.args.length - 1], '-');
  assert.ok(got.args.includes('model_reasoning_effort="high"') && got.args.includes(bin));
  const glm = await runBin('switcher-glm.js', ['--cd', bin]);
  assert.equal(glm.code, 0, glm.err);
  const g = JSON.parse(glm.out);
  assert.equal(g.stdin, task);
  assert.ok(g.args.includes('--allowedTools') && g.args.includes('mcp__latitude__run,Read,Grep,Glob'));
});

test('Windows: the sign-in link is written down whether $BROWSER gets it quoted or not', { skip: process.platform !== 'win32' && 'Windows only' }, async () => {
  const { captureScript } = require('../lib/lite-signin');
  const cmd = captureScript();
  assert.match(cmd, /switcher-lite-browser\.cmd$/);
  const url = 'https://claude.com/cai/oauth/authorize?code=true&client_id=abc&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A54545%2Fcallback&scope=user%3Aprofile&state=xyz';
  const ways = [
    ['cmd.exe', [`/d /s /c ""${cmd}" "${url}""`], true],   // quoted, the way cross-spawn and the app pass it
    ['cmd.exe', [`/d /c "${cmd}" ${url}`], true],         // not quoted: cmd.exe cuts it at the first &
  ];
  for (const [file, args, verbatim] of ways) {
    const out = path.join(os.tmpdir(), `ss-lite-url-${crypto.randomBytes(4).toString('hex')}.txt`);
    await new Promise(resolve => { const p = cp.spawn(file, args, { env: { ...process.env, LITE_URL_FILE: out }, windowsVerbatimArguments: verbatim, windowsHide: true, stdio: 'ignore' }); p.on('close', resolve); p.on('error', resolve); });
    assert.equal(fs.readFileSync(out, 'utf8').trim(), url, args[0]);
    fs.unlinkSync(out);
  }
});

test('phone alerts: a phone can switch kinds off, hackathon alerts only when switched on, and Lite sign-ups open Lite', () => {
  const { cleanPrefs, wants } = require('../lib/push');
  const p = cleanPrefs({ kinds: { reply: false, floor: true, bogus: true }, app: 'lite' });
  assert.deepEqual(p.kinds, { reply: false, floor: true });
  assert.equal(p.app, 'lite');
  assert.equal(wants(p, { kind: 'reply' }), false);
  assert.equal(wants(p, { kind: 'needs' }), true);
  assert.equal(wants(p, { kind: 'hack' }), false);
  assert.equal(wants(cleanPrefs({ kinds: { hack: true } }), { kind: 'hack' }), true);
});
