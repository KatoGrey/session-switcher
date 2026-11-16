'use strict';
// PC check-up (lib/pccheck.js): what's running read into lines (a program's processes together, Session Switcher's
// own apart and kept, Windows' own kept, a runtime's one by one with its script's name and never its command line),
// space that can be freed, Claude's word read back, and closing and clearing only what the check found. The real
// check closes nothing but a throwaway process of its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { readProcesses, pickProcesses, spaceItems, explainPrompt, parseExplain, createPcCheck } = require('../lib/pccheck');

const T0 = Date.parse('2026-11-16T08:00:00Z');
const proc = (pid, name, extra = {}) => ({ pid, ppid: 1, name, exe: `C:\\Program Files\\${name}`, cmd: name, start: T0, mem: 100 * 1024 * 1024, cpu: 0, session: 1, ...extra });
const raw = (a, { b = [], g = [] } = {}) => ({ a, b, g, cores: 4 });

test('pc check: a program’s processes are one line, with memory, CPU, since when, and a window not responding', () => {
  const lines = readProcesses(raw([
    proc(10, 'chrome.exe', { ppid: 2, cpu: 0 }), proc(11, 'chrome.exe', { ppid: 10, cpu: 0 }), proc(12, 'chrome.exe', { ppid: 10, start: T0 - 3600e3 }),
    proc(20, 'Slack.exe'),
  ], { b: [{ pid: 10, cpu: 3e6 }, { pid: 11, cpu: 3e6 }, { pid: 12, cpu: 0 }, { pid: 20, cpu: 0 }], g: [{ pid: 20, responding: false, title: 'Slack | general' }] }));
  const chrome = lines.find(l => l.name === 'chrome.exe'), slack = lines.find(l => l.name === 'Slack.exe');
  assert.equal(chrome.count, 3);
  assert.equal(chrome.memMB, 300);
  assert.equal(chrome.cpu, 10);   // 0.6 s of CPU over 1.5 s on 4 cores
  assert.equal(chrome.since, T0 - 3600e3);
  assert.deepEqual(chrome.roots.map(r => r.pid), [10], 'closing the top of its tree closes the rest');
  assert.equal(slack.hung, true);
  assert.equal(slack.title, 'Slack | general');
  assert.equal(chrome.protected, null);
});

test('pc check: Windows’ own, Session Switcher’s own and any Claude Code or Codex chat can’t be ticked; the Claude desktop app can', () => {
  const code = 'C:\\Users\\me\\.local\\bin\\claude.exe', desktopApp = 'C:\\Users\\me\\AppData\\Local\\AnthropicClaude\\app-1.0\\claude.exe';
  const lines = readProcesses(raw([
    proc(4, 'System'), proc(30, 'svchost.exe'),
    proc(100, 'Session Switcher.exe', { ppid: 1 }), proc(101, 'Session Switcher.exe', { ppid: 100 }),
    proc(102, 'claude.exe', { ppid: 101, exe: code }),                       // a chat this app started
    proc(200, 'claude.exe', { ppid: 300, exe: code }),                       // a Claude Code chat in a terminal
    proc(201, 'node.exe', { ppid: 200, cmd: 'node mcp-server.js' }),         // a tool that chat started
    proc(202, 'node.exe', { ppid: 1, cmd: 'node C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js' }),   // a Codex chat
    proc(210, 'claude.exe', { ppid: 1, exe: desktopApp }),                   // the Claude desktop app
    proc(40, 'SearchApp.exe', { session: 0 }),
  ]), { selfPids: new Set([101]) });
  const of = (name, test = () => true) => lines.filter(l => l.name === name && test(l));
  assert.equal(of('System')[0].protected, 'Windows needs this');
  assert.equal(of('svchost.exe')[0].protected, 'Windows needs this');
  assert.ok(of('Session Switcher.exe').every(l => l.protected === 'Session Switcher’s own'));
  const claudes = of('claude.exe');
  assert.equal(claudes.length, 3, 'its own chats, a terminal’s chat and the desktop app are three lines');
  assert.equal(claudes.filter(l => l.protected === 'Session Switcher’s own').length, 1);
  assert.equal(claudes.filter(l => /Claude Code or Codex chat/.test(l.protected || '')).length, 1, 'a chat in a terminal');
  assert.equal(claudes.filter(l => l.protected === null).length, 1, 'the Claude desktop app');
  assert.ok(of('node.exe').every(l => /Claude Code or Codex chat/.test(l.protected || '')), 'a chat’s tool, and a Codex chat');
  assert.equal(of('SearchApp.exe')[0].protected, 'A Windows service');
});

test('pc check: a runtime’s processes are a line each, named by their script, and no command line reaches Claude', () => {
  const lines = readProcesses(raw([
    proc(50, 'node.exe', { cmd: '"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\me\\site\\node_modules\\vite\\bin\\vite.js --token=SECRET123' }),
    proc(51, 'node.exe', { cmd: 'node server.js --password hunter2', mem: 2048 * 1024 * 1024 }),
  ]));
  assert.deepEqual(lines.map(l => [l.id, l.script]).sort(), [['p:node.exe#50', 'vite.js'], ['p:node.exe#51', 'server.js']]);
  const prompt = explainPrompt(pickProcesses(lines));
  assert.match(prompt, /"script":"vite\.js"/);
  assert.match(prompt, /"script":"server\.js"/);
  assert.doesNotMatch(prompt, /SECRET123|hunter2|--token|--password/);
});

test('pc check: a window’s title never reaches Claude, and the user folder is ~', () => {
  const home = os.homedir();
  const lines = readProcesses(raw([proc(20, 'Slack.exe', { exe: path.join(home, 'AppData', 'Local', 'slack', 'slack.exe') })], { g: [{ pid: 20, responding: true, title: 'Re: salary review - Outlook' }] }));
  lines[0].path = path.join(home, 'AppData', 'Local', 'slack');
  const prompt = explainPrompt(lines);
  assert.doesNotMatch(prompt, /salary/);
  assert.ok(!prompt.toLowerCase().includes(home.toLowerCase().replace(/\\/g, '\\\\')), 'no user folder');
  assert.match(prompt, /"folder":"~/);
});

test('pc check: the busiest, the biggest and anything not responding are shown', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `p:${i}`, memMB: i * 10, cpu: i === 3 ? 40 : 0, hung: i === 1 }));
  const shown = pickProcesses(many).map(x => x.id);
  assert.ok(shown.includes('p:1'), 'not responding');
  assert.ok(shown.includes('p:3'), 'busy');
  assert.ok(shown.includes('p:29') && !shown.includes('p:10'), 'the biggest twelve');
});

test('pc check: Claude’s word is read back, and a bad answer is no word', () => {
  assert.deepEqual(parseExplain('Here you go:\n[{"id":"p:slack.exe","what":"Slack, the chat app","advice":"close","why":"Idle"},{"id":"s:npm","what":"A cache","advice":"weird"}]'), {
    'p:slack.exe': { what: 'Slack, the chat app', advice: 'close', why: 'Idle' },
    's:npm': { what: 'A cache', advice: 'careful', why: '' },
  });
  assert.deepEqual(parseExplain('Sorry, I can’t.'), {});
  assert.deepEqual(parseExplain('[not json'), {});
});

// A sandbox: a temp folder with this app's old test leftovers, one in use, an old file and a new one; a cache; Downloads.
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pccheck-test-'));
  const tmp = path.join(root, 'temp'), local = path.join(root, 'local'), dl = path.join(root, 'Downloads');
  for (const d of [tmp, local, dl]) fs.mkdirSync(d, { recursive: true });
  const old = Date.now() / 1000 - 10 * 86400;
  const big = Buffer.alloc(21 * 1024 * 1024, 1);
  const leftover = path.join(tmp, 'ss-run-1'); fs.mkdirSync(leftover); fs.writeFileSync(path.join(leftover, 'a.bin'), big); fs.utimesSync(path.join(leftover, 'a.bin'), old, old); fs.utimesSync(leftover, old, old);
  const inUse = path.join(tmp, 'ss-run-2'); fs.mkdirSync(inUse); fs.writeFileSync(path.join(inUse, 'a.bin'), big);
  const oldFile = path.join(tmp, 'old.bin'); fs.writeFileSync(oldFile, big); fs.utimesSync(oldFile, old, old);
  const newFile = path.join(tmp, 'new.bin'); fs.writeFileSync(newFile, big);
  const npm = path.join(local, 'npm-cache'); fs.mkdirSync(path.join(npm, '_cacache'), { recursive: true }); fs.writeFileSync(path.join(npm, '_cacache', 'x.bin'), big);
  return { root, tmp, local, dl, leftover, inUse, oldFile, newFile, npm, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('pc check: space to free: old test leftovers, old temporary files and caches; what’s in use is left out', async () => {
  const s = sandbox();
  try {
    const items = await spaceItems({ tmp: s.tmp, env: { LOCALAPPDATA: s.local }, downloads: s.dl, budgetMs: 8000 });
    const by = id => items.find(x => x.id === id);
    assert.deepEqual(by('s:tests').paths, [s.leftover], 'the in-use leftover is left out');
    assert.deepEqual(by('s:temp').paths, [s.oldFile], 'a new temporary file is left out');
    assert.deepEqual(by('s:npm').paths, [s.npm]);
    for (const x of items) assert.equal(x.how, 'delete');
  } finally { s.cleanup(); }
});

test('pc check: clearing deletes only what the check found, inside the places it may clear', async () => {
  const s = sandbox();
  try {
    const pc = createPcCheck({ runPowerShell: async script => (/Win32_Process -Filter/.test(script) ? { stdout: '[]' } : { stdout: JSON.stringify({ a: [], b: [], g: [], drives: [], recycle: 0, cores: 4, mem: 0 }) }), env: { LOCALAPPDATA: s.local }, tmp: s.tmp, downloads: s.dl, selfPids: () => new Set() });
    if (process.platform !== 'win32') { assert.equal((await pc.scan()).supported, false); return; }
    const scan = await pc.scan();
    assert.ok(scan.space.some(x => x.id === 's:tests'));
    const r = await pc.act({ free: ['s:tests', 's:npm', 's:made-up'] });
    assert.equal(fs.existsSync(s.leftover), false, 'the old leftover is gone');
    assert.equal(fs.existsSync(s.inUse), true, 'the one in use is still there');
    assert.equal(fs.existsSync(s.npm), true, 'a cache keeps its folder');
    assert.deepEqual(fs.readdirSync(s.npm), [], 'and its insides go');
    assert.equal(fs.existsSync(s.oldFile), true, 'what wasn’t ticked stays');
    assert.ok(r.freed >= 40 * 1024 * 1024);
    assert.deepEqual(r.results.map(x => x.id).sort(), ['s:npm', 's:tests'], 'an id the check didn’t find does nothing');
  } finally { s.cleanup(); }
});

test('pc check: a real close, of a throwaway process of its own: asked first, then forced only when told', { skip: process.platform !== 'win32', timeout: 180000 }, async () => {
  const s = sandbox();
  const dummy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  try {
    await new Promise(r => setTimeout(r, 800));
    const pc = createPcCheck({ runPowerShell: require('../lib/system').runPowerShell, env: { LOCALAPPDATA: s.local }, tmp: s.tmp, downloads: s.dl, selfPids: () => new Set() });
    const id = `p:${path.basename(process.execPath).toLowerCase()}#${dummy.pid}`;
    await pc.scan();
    // Small as it is, it's not among the programs shown, and only those can be acted on: so it's added to the check's
    // list here, as the check would have read it (its start time is what proves it's still the same process).
    if (!pc.last().processes.some(p => p.id === id)) {
      const r = await require('../lib/system').runPowerShell(`$d = (Get-CimInstance Win32_Process -Filter "ProcessId=${dummy.pid}").CreationDate; [int64](($d.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds)`, { timeoutMs: 30000 });
      pc.last().processes.push({ id, name: 'node.exe', roots: [{ pid: dummy.pid, start: Number(String(r.stdout).trim()) }], protected: null });
    }
    const asked = await pc.act({ close: [id] });
    assert.equal(asked.results[0].ok, false, 'a process with no window can’t be asked to close');
    assert.match(asked.results[0].said, /still open/);
    assert.equal(dummy.exitCode, null);
    const forced = await pc.act({ close: [id], force: true });
    assert.equal(forced.results[0].ok, true, forced.results[0].said);
    await new Promise(r => setTimeout(r, 500));
    assert.notEqual(dummy.exitCode === null && dummy.signalCode === null, true, 'it has ended');
  } finally { try { dummy.kill(); } catch { /* gone */ } s.cleanup(); }
});

test('pc check: a race’s working copies, a test run still going and a folder not looked at in full are never offered', async () => {
  const s = sandbox();
  try {
    const old = Date.now() / 1000 - 10 * 86400;
    const race = path.join(s.tmp, 'ss-race'); fs.mkdirSync(path.join(race, 'r1'), { recursive: true }); fs.writeFileSync(path.join(race, 'r1', 'x.bin'), Buffer.alloc(21 * 1024 * 1024)); fs.utimesSync(path.join(race, 'r1', 'x.bin'), old, old); fs.utimesSync(race, old, old);
    const relay = path.join(s.tmp, 'ss-relay-abc'); fs.mkdirSync(relay); fs.utimesSync(relay, old, old);
    const going = path.join(s.tmp, `ss-run-${process.pid}-abc`); fs.mkdirSync(going); fs.writeFileSync(path.join(going, 'x.bin'), Buffer.alloc(21 * 1024 * 1024)); fs.utimesSync(path.join(going, 'x.bin'), old, old); fs.utimesSync(going, old, old);
    const items = await spaceItems({ tmp: s.tmp, env: { LOCALAPPDATA: s.local }, downloads: s.dl });
    const tests = items.find(x => x.id === 's:tests');
    assert.deepEqual(tests.paths, [s.leftover], 'only the old leftover: not the race, the relay or the run still going');
    // Out of time before a folder is looked at in full: it isn't offered, and the note says there's more to look at.
    const hurried = await spaceItems({ tmp: s.tmp, env: { LOCALAPPDATA: s.local }, downloads: s.dl, budgetMs: 0 });
    const t2 = hurried.find(x => x.id === 's:tests');
    assert.ok(!t2 || !t2.paths.length, 'nothing offered unseen');
  } finally { s.cleanup(); }
});

test('pc check: the Recycle Bin is emptied before a download goes into it, and a file’s name never goes into PowerShell’s text', async () => {
  const s = sandbox();
  try {
    const calls = [];
    const fake = async (script, opts = {}) => { calls.push({ script, env: opts.env && opts.env.PCK_PATH }); return /Win32_Process -Filter/.test(script) ? { stdout: '[]' } : { stdout: JSON.stringify({ a: [], b: [], g: [], drives: [], recycle: 0, cores: 4, mem: 0 }) }; };
    const pc = createPcCheck({ runPowerShell: fake, env: { LOCALAPPDATA: s.local }, tmp: s.tmp, downloads: s.dl, selfPids: () => new Set() });
    if (process.platform !== 'win32') return;
    await pc.scan();
    const file = path.join(s.dl, "John's a'); Remove-Item -Recurse x; #.iso");
    fs.writeFileSync(file, 'x');
    pc.last().space.push({ id: 's:dl:x', label: 'x.iso', how: 'recycle', bytes: 1, paths: [file] }, { id: 's:recycle', label: 'The Recycle Bin', how: 'empty', bytes: 1, paths: [] });
    calls.length = 0;
    await pc.act({ free: ['s:dl:x', 's:recycle'] });
    const empty = calls.findIndex(c => /Clear-RecycleBin/.test(c.script)), recycle = calls.findIndex(c => /SendToRecycleBin/.test(c.script));
    assert.ok(empty >= 0 && recycle > empty, 'emptied first');
    assert.ok(!calls[recycle].script.includes('John'), 'the name isn’t in the script');
    assert.equal(calls[recycle].env, file, 'it goes by the environment');
  } finally { s.cleanup(); }
});

test('pc check: npm’s _npx folder is kept; an out-of-date list, or two clean-ups at once, are refused; two checks at once are one', async () => {
  const s = sandbox();
  try {
    let scans = 0;
    const fake = async script => { if (/Start-Sleep/.test(script)) { scans++; await new Promise(r => setTimeout(r, 50)); } return /Win32_Process -Filter/.test(script) ? { stdout: '[]' } : { stdout: JSON.stringify({ a: [], b: [], g: [], drives: [], recycle: 0, cores: 4, mem: 0 }) }; };
    const pc = createPcCheck({ runPowerShell: fake, env: { LOCALAPPDATA: s.local }, tmp: s.tmp, downloads: s.dl, selfPids: () => new Set() });
    if (process.platform !== 'win32') return;
    const npx = path.join(s.npm, '_npx', 'tool'); fs.mkdirSync(npx, { recursive: true }); fs.writeFileSync(path.join(npx, 'x.js'), 'x');
    const [a, b] = await Promise.all([pc.scan(), pc.scan()]);
    assert.equal(scans, 1, 'asked together: one check');
    assert.equal(a.at, b.at);
    await assert.rejects(pc.act({ free: ['s:npm'], at: a.at - 1 }), /changed since/);
    await pc.act({ free: ['s:npm'], at: a.at });
    assert.ok(fs.existsSync(path.join(npx, 'x.js')), 'the tools chats run with npx stay');
    assert.ok(!fs.existsSync(path.join(s.npm, '_cacache')), 'the rest of the cache goes');
  } finally { s.cleanup(); }
});

test('pc check: what a chat or this app runs inside (a terminal, an editor) can’t be ticked; a service’s copy is never closed; an old parent number isn’t a parent', () => {
  const code = 'C:\\Users\\me\\.local\\bin\\claude.exe';
  const lines = readProcesses(raw([
    proc(500, 'WindowsTerminal.exe'), proc(501, 'pwsh.exe', { ppid: 500 }), proc(502, 'claude.exe', { ppid: 501, exe: code }),
    proc(510, 'Code.exe', { exe: 'C:\\Apps\\VS Code\\Code.exe' }), proc(511, 'node.exe', { ppid: 510, cmd: 'node server.js' }),   // this app, run from an editor
    proc(900, 'claude.exe', { exe: code, start: T0 }), proc(950, 'Spotify.exe', { ppid: 900, start: T0 - 1e6 }),   // started before the chat: not its child
    proc(60, 'nvcontainer.exe', { exe: 'C:\\Apps\\NVIDIA\\nvcontainer.exe', session: 0 }), proc(61, 'nvcontainer.exe', { ppid: 60, exe: 'C:\\Apps\\NVIDIA\\nvcontainer.exe', session: 1 }),
  ]), { selfPids: new Set([511]) });
  const of = name => lines.find(l => l.name === name);
  assert.match(of('WindowsTerminal.exe').protected, /chat runs inside it/);
  assert.match(lines.find(l => l.name === 'pwsh.exe').protected, /chat runs inside it/);
  assert.equal(of('Code.exe').protected, 'Session Switcher runs inside it');
  assert.equal(of('Spotify.exe').protected, null, 'a parent number reused by a later process isn’t its parent');
  const nv = of('nvcontainer.exe');
  assert.equal(nv.protected, null, 'your own copy can be closed');
  assert.deepEqual(nv.roots.map(r => r.pid), [61], 'and only that: never the service');
});

test('pc check: right before closing, each is checked again: a chat started inside it since, or its number now another program’s, and it isn’t touched', async () => {
  if (process.platform !== 'win32') return;
  const s = sandbox();
  try {
    const T = Date.now() - 3600e3, code = 'C:\\Users\\me\\.local\\bin\\claude.exe';
    const p = (pid, name, extra = {}) => ({ pid, ppid: 4, name, exe: `C:\\Apps\\${name}`, cmd: name, start: T, mem: 300 * 1024 * 1024, cpu: 0, session: 1, ...extra });
    const base = [p(600, 'notepad.exe'), p(610, 'mspaint.exe'), p(620, 'calc.exe')];
    let nowList = base;
    const kills = [];
    const fake = async script => {
      if (/Start-Sleep/.test(script)) return { stdout: JSON.stringify({ a: base, b: [], g: [], drives: [], recycle: 0, cores: 4, mem: 0 }) };
      if (/taskkill/.test(script)) { kills.push(Number(/\/PID (\d+)/.exec(script)[1])); return { stdout: 'asked' }; }
      if (/CommandLine/.test(script)) return { stdout: JSON.stringify(nowList) };
      return { stdout: '[]' };
    };
    const pc = createPcCheck({ runPowerShell: fake, env: { LOCALAPPDATA: s.local }, tmp: s.tmp, downloads: s.dl, selfPids: () => new Set() });
    const scan = await pc.scan();
    const id = name => scan.processes.find(x => x.name === name).id;
    // Since the check: a chat started inside Notepad (as one would in a terminal), and Paint closed and its number went
    // to a new process.
    nowList = [p(600, 'notepad.exe'), p(700, 'claude.exe', { ppid: 600, exe: code, start: T + 5000 }), p(610, 'mspaint.exe', { start: T + 9000 }), p(620, 'calc.exe')];
    const r = await pc.act({ close: [id('notepad.exe'), id('mspaint.exe'), id('calc.exe')], at: scan.at });
    assert.deepEqual(kills, [620], 'only the one still as the check found it, with nothing inside it that must stay');
    const said = n => r.results.find(x => x.name === n).said;
    assert.match(said('notepad.exe'), /chat runs inside it/);
    assert.equal(said('mspaint.exe'), 'already closed');
    assert.equal(said('calc.exe'), 'closed');
  } finally { s.cleanup(); }
});

test('pc check: what’s cleared is the list that was ticked, even if a check from a phone lands meanwhile; the app’s own temp files are never old', async () => {
  if (process.platform !== 'win32') return;
  const s = sandbox();
  try {
    const old = Date.now() / 1000 - 30 * 86400;
    for (const n of ['session-switcher-3456.json', 'claude-switcher', 'claude']) { const f = path.join(s.tmp, n); if (n.endsWith('.json')) fs.writeFileSync(f, Buffer.alloc(21 * 1024 * 1024)); else { fs.mkdirSync(f); fs.writeFileSync(path.join(f, 'x.bin'), Buffer.alloc(21 * 1024 * 1024)); fs.utimesSync(path.join(f, 'x.bin'), old, old); } fs.utimesSync(f, old, old); }
    let pc = null, again = null;
    const fake = async script => {
      if (/Start-Sleep/.test(script)) return { stdout: JSON.stringify({ a: [{ pid: 600, ppid: 4, name: 'notepad.exe', exe: 'C:\\Apps\\notepad.exe', cmd: 'notepad', start: 1, mem: 1, cpu: 0, session: 1 }], b: [], g: [], drives: [], recycle: 0, cores: 4, mem: 0 }) };
      if (/taskkill/.test(script)) {
        // While it's closing: a new old file turns up, and a check from a phone lands.
        const later = path.join(s.tmp, 'later.bin'); fs.writeFileSync(later, Buffer.alloc(21 * 1024 * 1024)); fs.utimesSync(later, old, old);
        again = await pc.scan();
        return { stdout: 'asked' };
      }
      if (/CommandLine/.test(script)) return { stdout: JSON.stringify([{ pid: 600, ppid: 4, name: 'notepad.exe', start: 1 }]) };
      return { stdout: '[]' };
    };
    pc = createPcCheck({ runPowerShell: fake, env: { LOCALAPPDATA: s.local }, tmp: s.tmp, downloads: s.dl, selfPids: () => new Set() });
    const scan = await pc.scan();
    assert.deepEqual(pc.last().space.find(x => x.id === 's:temp').paths, [s.oldFile], 'the lock file, the launch folder and Claude Code’s folder aren’t offered');
    await pc.act({ close: [scan.processes[0].id], free: ['s:temp'], at: scan.at });
    assert.ok(again && again.at !== scan.at, 'a check landed meanwhile');
    assert.equal(fs.existsSync(s.oldFile), false, 'what was ticked went');
    assert.equal(fs.existsSync(path.join(s.tmp, 'later.bin')), true, 'what the later check found, nobody ticked');
    for (const n of ['session-switcher-3456.json', 'claude-switcher', 'claude']) assert.ok(fs.existsSync(path.join(s.tmp, n)), n);
  } finally { s.cleanup(); }
});
