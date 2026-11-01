'use strict';
// A whole pretend computer for the real server: its own home folder (no real accounts or chats can be seen), a
// signed-in stand-in Claude (tests/fake-claude.js), Codex (tests/fake-codex.js) and Gemini (tests/fake-agy.js), and projects with chats,
// pictures, documents and notes. For what tests/demo.js can't show: its answers stand in for the server's, so a route
// that doesn't exist, or can't be reached, looks fine there. Windows for now (it writes .cmd launchers).
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');
const net = require('net');
const APP = path.join(__dirname, '..');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==', 'base64');
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const put = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
const enc = cwd => cwd.replace(/[^a-zA-Z0-9]/g, '-');
const uuid = () => crypto.randomUUID();

function transcript(home, cwd, title, { ago = 60, edits = [], reply = 'Done.' } = {}) {
  const id = uuid(), file = path.join(home, '.claude', 'projects', enc(cwd), `${id}.jsonl`);
  const at = n => new Date(Date.now() - (ago - n) * 60e3).toISOString();
  const lines = [];
  const add = (o, n) => lines.push(JSON.stringify({ sessionId: id, cwd, version: '2.1.99', gitBranch: 'main', timestamp: at(n), uuid: uuid(), ...o }));
  add({ type: 'user', message: { role: 'user', content: title } }, 0);
  const uses = edits.map((f, i) => ({ type: 'tool_use', id: `tu_${i}`, name: 'Edit', input: { file_path: f, old_string: 'a', new_string: 'b' } }));
  add({ type: 'assistant', message: { id: `msg_${id.slice(0, 8)}`, role: 'assistant', model: 'claude-fake', content: [{ type: 'text', text: 'Looking into it.' }, ...uses], usage: { input_tokens: 10, output_tokens: 5 } } }, 1);
  if (uses.length) add({ type: 'user', message: { role: 'user', content: uses.map(u => ({ type: 'tool_result', tool_use_id: u.id, content: 'ok' })) } }, 2);
  add({ type: 'assistant', message: { id: `msg2_${id.slice(0, 8)}`, role: 'assistant', model: 'claude-fake', content: [{ type: 'text', text: reply }], usage: { input_tokens: 10, output_tokens: 5 } } }, 3);
  put(file, `${lines.join('\n')}\n`);
  return id;
}

async function build() {
  const W = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-fw-')));
  const home = path.join(W, 'home'), world = path.join(W, 'world'), bin = path.join(W, 'bin'), dataDir = path.join(W, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  // Signed in, as far as the files say.
  put(path.join(home, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'fake', refreshToken: 'fake', subscriptionType: 'max', rateLimitTier: 'default_claude_max_5x', expiresAt: Date.now() + 864e5 } }));
  put(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'tester@example.com', organizationName: 'Test Org', organizationUuid: 'org-1' }, hasCompletedOnboarding: true }));
  const nodeExe = process.execPath;
  // (Run from the installed app's own Node, the program would start the app without this, and the server takes it out of
  // what its children inherit.)
  const asNode = process.versions.electron ? '@set ELECTRON_RUN_AS_NODE=1\r\n' : '';
  put(path.join(bin, 'claude.cmd'), `${asNode}@"${nodeExe}" "${path.join(__dirname, 'fake-claude.js')}" %*\r\n`);
  put(path.join(bin, 'codex.cmd'), `${asNode}@"${nodeExe}" "${path.join(__dirname, 'fake-codex.js')}" %*\r\n`);
  put(path.join(bin, 'agy.cmd'), `${asNode}@"${nodeExe}" "${path.join(__dirname, 'fake-agy.js')}" %*\r\n`);
  put(path.join(home, '.claude-two', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'fake2', refreshToken: 'fake2', subscriptionType: 'pro', expiresAt: Date.now() + 864e5 } }));
  put(path.join(home, '.claude-two', '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'second@example.com', organizationName: 'Second Org', organizationUuid: 'org-2' }, hasCompletedOnboarding: true }));
  put(path.join(dataDir, 'accounts.json'), JSON.stringify({ accounts: [{ id: 'two', name: 'Second', configDir: path.join(home, '.claude-two') }], claudeCommand: path.join(bin, 'claude.cmd'), codex: { enabled: true, command: path.join(bin, 'codex.cmd') }, gemini: { enabled: true, command: path.join(bin, 'agy.cmd') } }));

  // A project of words and pictures, not in git, as most are.
  const tavern = path.join(world, 'Starfall Tavern');
  put(path.join(tavern, 'README.md'), '# Starfall Tavern\n\nA tavern at the end of the world. See [the lore](lore/queen.md).\n');
  put(path.join(tavern, 'lore', 'queen.md'), '---\ntitle: The Queen\n---\n# The Queen\n\nThe Queen of Ash rules.\n\nShe has a [link](../README.md) and a ![picture](../art/hero-v1.png).\n');
  put(path.join(tavern, 'notes.txt'), 'A note about the queen.\n');
  put(path.join(tavern, 'auth.json'), '{"token":"queen"}');
  put(path.join(tavern, 'site', 'index.html'), '<!doctype html><title>Site</title><h1>Hello</h1>');
  for (const n of ['hero-v1', 'hero-v2', 'hero-v3', 'villain', 'map']) put(path.join(tavern, 'art', `${n}.png`), PNG);
  for (const n of ['a', 'b', 'c']) put(path.join(tavern, 'art', 'shops', `${n}.png`), PNG);
  const memory = path.join(home, '.claude', 'projects', enc(tavern), 'memory');
  put(path.join(memory, 'MEMORY.md'), '- [Short replies](short.md) — keep replies short\n');
  put(path.join(memory, 'short.md'), '---\nname: short\ndescription: keep replies short\nmetadata:\n  type: feedback\n---\nKeep replies short.\n');
  const ids = {};
  ids.quest = transcript(home, tavern, 'Write the side-quest dialogue', { ago: 30, edits: [path.join(tavern, 'lore', 'queen.md')], reply: `Wrote it. See [the queen](${path.join(tavern, 'lore', 'queen.md').replace(/\\/g, '/')}).` });
  ids.art = transcript(home, tavern, 'Key art for the Harvest Festival', { ago: 200 });
  ids.save = transcript(home, tavern, 'Fix the save file on Steam Deck', { ago: 2000 });
  // One in git, with work under way.
  const courier = path.join(world, 'Neon Courier');
  put(path.join(courier, 'src', 'main.js'), 'console.log("one");\n');
  put(path.join(courier, 'README.md'), '# Neon Courier\n');
  const git = (...a) => spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...a], { cwd: courier, windowsHide: true });
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'first');
  put(path.join(courier, 'src', 'main.js'), 'console.log("two");\n');
  put(path.join(courier, 'src', 'new.js'), 'console.log("new");\n');
  ids.route = transcript(home, courier, 'Route-finding with live traffic', { ago: 45, edits: [path.join(courier, 'src', 'main.js')] });
  fs.mkdirSync(path.join(world, 'Empty One'), { recursive: true });

  const port = await freePort();
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SWITCHER_|CLAUDE|CODEX_|ANTHROPIC_|OPENAI_|GEMINI_|GOOGLE_)/.test(k))),
    USERPROFILE: home, HOME: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), HOMEPATH: home.slice(2), HOMEDRIVE: home.slice(0, 2),
    PATH: `${bin};${process.env.PATH}`, SWITCHER_PORT: String(port), SWITCHER_DATA_DIR: dataDir, SWITCHER_NO_BROWSER: '1', SWITCHER_DRY_RUN: '1', FAKE_AGY_WORLD: '1' };
  fs.mkdirSync(env.APPDATA, { recursive: true }); fs.mkdirSync(env.LOCALAPPDATA, { recursive: true });
  const server = spawn(process.execPath, ['server.js'], { cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  const done = async () => {
    // Asked to quit, it stops its chats itself, so nothing's left running behind it.
    const gone = new Promise(r => server.once('exit', r));
    try {
      const token = (await (await fetch(base)).text()).match(/TOKEN = '([a-f0-9]+)'/)[1];
      await fetch(`${base}api/quit`, { method: 'POST', headers: { 'x-switcher-token': token, 'content-type': 'application/json' }, body: '{}' });
    } catch { /* it's stopped already, or won't answer */ }
    await Promise.race([gone, new Promise(r => setTimeout(r, 5000))]);
    if (server.exitCode === null) server.kill();
    await new Promise(r => setTimeout(r, 800));
    try { fs.rmSync(W, { recursive: true, force: true }); } catch { /* something still has a file open; it's in temp */ }
  };
  return { W, home, world, tavern, courier, empty: path.join(world, 'Empty One'), ids, base, port, server, serverLog: () => log, done };
}

module.exports = { build };
