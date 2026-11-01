// The workspace's routes on the real server: the picture board, a project's state in git, and what can
// open outside the app. Started on a free port with a throwaway data folder and throwaway projects.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const APP = path.join(__dirname, '..');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==', 'base64');
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const tmp = name => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), name)));
const noGit = (() => { try { execFileSync('git', ['--version'], { windowsHide: true, stdio: 'pipe' }); return false; } catch { return true; } })();

async function startServer() {
  const port = await freePort(), dataDir = tmp('ss-ws-data-');
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: APP, stdio: 'ignore',
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^SWITCHER_/.test(k))), SWITCHER_PORT: String(port), SWITCHER_DATA_DIR: dataDir, SWITCHER_NO_BROWSER: '1', SWITCHER_DRY_RUN: '1' },
  });
  const base = `http://127.0.0.1:${port}`;
  let html = null;
  for (let i = 0; i < 100 && !html; i++) { try { html = await (await fetch(`${base}/`)).text(); } catch { await new Promise(r => setTimeout(r, 150)); } }
  if (!html) { proc.kill(); throw new Error('The server didn’t start.'); }
  const token = html.match(/TOKEN = '([a-f0-9]+)'/)[1];
  const call = async (p, body) => {
    const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'x-switcher-token': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const stop = async () => { await call('/api/quit', {}).catch(() => {}); await new Promise(r => { proc.on('exit', r); setTimeout(() => { proc.kill(); r(); }, 3000); }); };
  return { call, stop, base, token, html };
}
const put = (root, rel, data = PNG) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); return f; };

test('workspace: every address the page asks for is there, and can be reached', () => {
  const read = f => fs.readFileSync(path.join(APP, f), 'utf8');
  const server = read('server.js'), libs = fs.readdirSync(path.join(APP, 'lib')).filter(f => f.endsWith('.js')).map(f => read(`lib/${f}`)).join('\n');
  const at = server.indexOf('async function handleChat('), end = server.indexOf('\n}\n', at);
  assert.ok(at > 0 && end > at);
  const cases = s => [...s.matchAll(/case '(\/api\/[^']+)'/g)].map(m => m[1]);
  const listOf = name => JSON.parse(new RegExp(`const ${name} = (\\[[^\\]]*\\])`).exec(server)[1].replace(/'/g, '"'));
  const notIn = listOf('NOT_IN_HANDLE_CHAT'), alsoIn = listOf('IN_HANDLE_CHAT');
  // What handleChat answers has to reach it; what's elsewhere under /api/chat/ has to be let past it.
  for (const r of cases(server.slice(at, end))) assert.ok((r.startsWith('/api/chat/') && !notIn.includes(r)) || alsoIn.includes(r), `${r} is in handleChat, but nothing sends it there`);
  for (const r of cases(server.slice(0, at) + server.slice(end))) if (r.startsWith('/api/chat/')) assert.ok(notIn.includes(r), `${r} is outside handleChat, but handleChat takes everything under /api/chat/`);
  // And everything the page calls is somewhere.
  const pages = ['ui', 'ui-lite'].flatMap(d => fs.readdirSync(path.join(APP, d)).filter(f => f.endsWith('.js')).map(f => [`${d}/${f}`, read(`${d}/${f}`)]));
  const all = server + libs, missing = [];
  for (const [file, text] of pages) {
    for (const m of text.matchAll(/\b(?:api|fetch)\(\s*['`](\/api\/[\w/.-]*)/g)) {
      const addr = m[1].replace(/\/$/, '');
      if (!all.includes(addr)) missing.push(`${addr} (${file})`);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

// A name nothing defines only shows when its button is pressed ("compEntry is not defined").
test('workspace: every name the app’s code uses is defined somewhere', t => {
  const r = require('child_process').spawnSync(process.execPath, ['--expose-internals', path.join(__dirname, 'fixtures', 'page-names.js')], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  let found = null; try { found = JSON.parse(r.stdout); } catch { /* this Node won't lend its parser */ }
  if (!found || found.unavailable) { t.skip('no parser here'); return; }
  assert.deepEqual(found.missing, {});
});

test('workspace: a file a chat only names opens from where it really is, or asks which', async () => {
  const s = await startServer(), world = tmp('ss-ws-find-');
  try {
    put(world, 'docs/deep/plan.md', '# The plan\n');
    put(world, 'a/both.md', 'a'); put(world, 'b/both.md', 'b');
    const cwd = (await s.call('/api/project/create', { existing: world })).json.cwd;
    const one = await s.call(`/api/file?${new URLSearchParams({ cwd, path: 'plan.md' })}`);
    assert.equal(one.status, 200, JSON.stringify(one.json));
    assert.equal(one.json.path, path.join(world, 'docs', 'deep', 'plan.md'));
    const two = await s.call(`/api/file?${new URLSearchParams({ cwd, path: 'both.md' })}`);
    assert.equal(two.json.kind, 'choices');
    assert.equal(two.json.matches.length, 2);
    const pointed = new URLSearchParams({ cwd, path: 'both.md' }); pointed.append('near', path.join(world, 'b'));
    assert.equal((await s.call(`/api/file?${pointed}`)).json.path, path.join(world, 'b', 'both.md'), 'the folder the chat pointed to settles it');
    assert.equal((await s.call(`/api/file?${new URLSearchParams({ cwd, path: 'not-anywhere-at-all.md' })}`)).status, 404);
  } finally { await s.stop(); }
});

test('workspace: a project’s words and notes come from the real routes', async () => {
  const s = await startServer(), world = tmp('ss-ws-find-');
  try {
    put(world, 'lore/queen.md', 'The Queen rules.\n');
    put(world, 'auth.json', '{"token":"queen"}');
    const cwd = (await s.call('/api/project/create', { existing: world })).json.cwd;
    const q = new URLSearchParams({ cwd, q: 'queen' });
    const found = await s.call(`/api/project/find?${q}`);
    assert.equal(found.status, 200);
    assert.deepEqual(found.json.hits.map(h => h.rel), ['lore/queen.md'], 'and not the sign-in file');
    const memory = await s.call(`/api/project/memory?${new URLSearchParams({ cwd })}`);
    assert.equal(memory.status, 200);
    assert.deepEqual(memory.json.notes, []);
    assert.equal((await s.call(`/api/project/changes?${new URLSearchParams({ cwd })}`)).status, 200);
    assert.equal((await s.call(`/api/project/find?${new URLSearchParams({ cwd: path.join(os.tmpdir(), 'not-a-project'), q: 'x' })}`)).status, 404);
  } finally { await s.stop(); }
});

// The whole way through the real server, with stand-ins for all three: no usage, no accounts, no network.
test('workspace: a crew of stand-ins on the real server, and Keep working', { skip: process.platform !== 'win32' || !!process.versions.electron ? 'its launchers are Windows .cmd files, and it’s not for the installed app’s self-check' : false }, async () => {
  const { build } = require('./fake-world');
  const w = await build();
  try {
    const token = (await (await fetch(w.base)).text()).match(/TOKEN = '([a-f0-9]+)'/)[1];
    const call = async (p, body) => { const r = await fetch(w.base + p.slice(1), { method: body ? 'POST' : 'GET', headers: { 'x-switcher-token': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
    const until = async (what, fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; assert.ok(Date.now() - t0 < ms, `timed out: ${what}`); await new Promise(r => setTimeout(r, 150)); } };
    await until('all three signed in', async () => { const st = (await call('/api/state')).json; return st.codex && st.codex.signedIn && st.gemini && st.gemini.signedIn; });
    const lead = (await call('/api/chat/open', { account: 'main', cwd: w.tavern, mode: 'new' })).json;
    await until('Claude ready', async () => (await call('/api/chat/attach', { key: lead.key })).json.state === 'ready');
    assert.equal((await call('/api/chat/send', { key: lead.key, text: 'Hello there' })).status, 200);
    const rowOf = async key => (await call('/api/activity')).json.list.find(x => x.key === key);
    await until('Claude’s reply', async () => /Fake reply to: Hello there/.test((await rowOf(lead.key)).lastText || ''));
    const cx = await call('/api/chat/send', { key: lead.key, to: 'partner', kind: 'codex', text: 'Please write it' });
    assert.equal(cx.status, 200, JSON.stringify(cx.json));
    await until('Codex’s reply', async () => /Fake Codex reply/.test((await rowOf(cx.json.key)).lastText || ''));
    assert.ok(fs.existsSync(path.join(w.tavern, 'codex-note.txt')), 'and it wrote its file');
    const gm = await call('/api/chat/send', { key: lead.key, to: 'partner', kind: 'gemini', text: 'And you' });
    assert.equal(gm.status, 200, JSON.stringify(gm.json));
    await until('Gemini’s reply', async () => /And you/.test((await rowOf(gm.json.key)).lastText || ''));
    // All three at once, each caught up on the others.
    assert.equal((await call('/api/chat/send', { key: lead.key, to: 'group', how: 'parallel', kinds: ['claude', 'codex', 'gemini'], text: 'All together now' })).status, 200);
    await until('all three replied', async () => { const rows = await Promise.all([lead.key, cx.json.key, gm.json.key].map(rowOf)); return rows.every(x => /All together now/.test(x.lastText || '') && x.phase === 'idle'); });
    // Search every chat means every chat: a Codex chat of its own is found too, by what's known of it.
    const own = (await call('/api/chat/open', { provider: 'codex', cwd: w.courier, mode: 'new' })).json;
    await until('its own Codex chat ready', async () => (await call('/api/chat/attach', { key: own.key })).json.state === 'ready');
    assert.equal((await call('/api/chat/send', { key: own.key, text: 'Please write the sea shanty' })).status, 200);
    await until('its reply', async () => /Fake Codex reply/.test((await rowOf(own.key)).lastText || ''));
    const ownId = (await rowOf(own.key)).sessionId;
    await until('that chat in the search', async () => (await call(`/api/search?${new URLSearchParams({ q: 'sea shanty' })}`)).json.hits.some(h => h.id === ownId), 25000);
    // A Gemini one by what's in it, not only its first words.
    assert.equal((await call('/api/chat/send', { key: gm.json.key, text: 'And now the silver lantern' })).status, 200);
    const gmLead = (await rowOf(lead.key)).sessionId;
    await until('Gemini’s words, under the chat it belongs to', async () => (await call(`/api/search?${new URLSearchParams({ q: 'silver lantern' })}`)).json.hits.some(h => h.id === gmLead), 25000);
    // And the Commander can ask the same.
    const asked = (await call(`/api/commander/tool/search?${new URLSearchParams({ q: 'silver lantern', limit: 5 })}`)).json;
    assert.ok(asked.chats.some(x => x.id === gmLead && x.provider === 'claude' && x.title), JSON.stringify(asked).slice(0, 400));
    await call('/api/chat/stop', { key: own.key });
    // Keep working: turned on for the chat, off by Stop, and it's said so in the row.
    const on = await call('/api/chat/keep', { key: lead.key, until: Date.now() + 30 * 60e3, quiet: 1, note: 'Carry on.' });
    assert.equal(on.status, 200, JSON.stringify(on.json));
    assert.equal(on.json.keep.quietMinutes, 1);
    const rows = await Promise.all([lead.key, cx.json.key, gm.json.key].map(rowOf));
    assert.ok(rows.every(x => x.keep && x.keep.note === 'Carry on.'), 'each of the crew shows it');
    assert.equal((await call('/api/chat/interrupt', { key: gm.json.key })).status, 200);
    assert.equal((await rowOf(lead.key)).keep, undefined, 'Stop means stop, whichever of them it was');
  } finally { await w.done(); }
});

test('workspace: a folder written two ways is one project, with Codex and Gemini in it', { skip: process.platform !== 'win32' || !!process.versions.electron ? 'Windows only, and it’s not for the installed app’s self-check' : false }, async () => {
  const { build } = require('./fake-world');
  const w = await build();
  try {
    const token = (await (await fetch(w.base)).text()).match(/TOKEN = '([a-f0-9]+)'/)[1];
    const call = async (p, body) => { const r = await fetch(w.base + p.slice(1), { method: body ? 'POST' : 'GET', headers: { 'x-switcher-token': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
    const stamp = new Date().toISOString();
    const dir = path.join(w.home, '.claude', 'projects', w.tavern.replace(/[^a-zA-Z0-9]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'dddddddd-1111-4222-8333-444444444444.jsonl'), `${JSON.stringify({ type: 'user', cwd: w.tavern.replace(/\\/g, '/'), timestamp: stamp, message: { content: 'Written the other way' } })}\n`);
    // And what's asked for with forward slashes is the project's own text from then on.
    const asked = (await call('/api/chat/open', { account: 'main', cwd: w.tavern.replace(/\\/g, '/'), mode: 'new' }));
    assert.equal(asked.status, 200, JSON.stringify(asked.json));
    const row = (await call('/api/activity')).json.list.find(x => x.key === asked.json.key);
    assert.equal(row.cwd, w.tavern);
    let here = [];
    for (let i = 0; i < 40; i++) {   // (the list of chats is looked at again every few seconds)
      here = (await call('/api/sessions')).json.projects.filter(p => p.cwd.replace(/\//g, '\\').toLowerCase() === w.tavern.toLowerCase());
      if (here.some(p => p.sessions.some(s => s.id.startsWith('dddddddd')))) break;
      await new Promise(r => setTimeout(r, 250));
    }
    assert.equal(here.length, 1, JSON.stringify(here.map(p => p.cwd)));
    assert.equal(here[0].cwd, w.tavern);
    assert.ok(here[0].sessions.some(s => s.id.startsWith('dddddddd')), 'the chat written the other way is in it');
  } finally { await w.done(); }
});

test('workspace: rules and tools with Gemini in them, on the real server', { skip: process.platform !== 'win32' || !!process.versions.electron ? 'its launchers are Windows .cmd files, and it’s not for the installed app’s self-check' : false }, async () => {
  const { build } = require('./fake-world');
  const w = await build();
  try {
    const token = (await (await fetch(w.base)).text()).match(/TOKEN = '([a-f0-9]+)'/)[1];
    const call = async (p, body) => { const r = await fetch(w.base + p.slice(1), { method: body ? 'POST' : 'GET', headers: { 'x-switcher-token': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
    for (let i = 0; i < 40 && !((await call('/api/state')).json.gemini || {}).signedIn; i++) await new Promise(r => setTimeout(r, 200));
    // Every project: its own file.
    const saved = await call('/api/rules', { text: 'Be brief.', to: ['claude', 'codex', 'gemini'] });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(fs.readFileSync(path.join(w.home, '.gemini', 'GEMINI.md'), 'utf8'), 'Be brief.\n');
    assert.ok(saved.json.claude.exists && saved.json.codex.exists && saved.json.gemini.exists);
    // A project: AGENTS.md reaches it, so a Save doesn't write GEMINI.md too; one that's there is shown.
    await call('/api/rules', { cwd: w.tavern, text: 'Keep it short.', to: ['claude', 'codex', 'gemini'] });
    assert.equal(fs.existsSync(path.join(w.tavern, 'GEMINI.md')), false, 'it would read them twice');
    assert.ok(fs.existsSync(path.join(w.tavern, 'AGENTS.md')));
    fs.writeFileSync(path.join(w.tavern, 'GEMINI.md'), 'Only Gemini reads this.');
    const read = (await call(`/api/rules?${new URLSearchParams({ cwd: w.tavern })}`)).json;
    assert.equal(read.gemini.text, 'Only Gemini reads this.');
    // Its tools show beside the others', and one goes from Claude to Gemini, and from Gemini to Claude.
    fs.writeFileSync(path.join(w.home, '.claude.json'), JSON.stringify({ mcpServers: { Paint: { type: 'stdio', command: 'node', args: ['paint server.js', '--flag'], env: { COLOUR: 'red' } } } }));
    fs.mkdirSync(path.join(w.home, '.gemini', 'config'), { recursive: true });
    fs.writeFileSync(path.join(w.home, '.gemini', 'config', 'mcp_config.json'), JSON.stringify({ mcpServers: { Studio: { command: 'cmd.exe', args: ['/c', 'x.bat'], disabled: false } } }));
    let tools = (await call('/api/tools')).json;
    assert.equal(tools.geminiOn, true);
    assert.ok(tools.servers.find(r => r.name === 'Studio').gemini, JSON.stringify(tools.servers));
    const copied = await call('/api/tools/copy', { name: 'Paint', to: 'gemini' });
    assert.equal(copied.status, 200, JSON.stringify(copied.json));
    const after = JSON.parse(fs.readFileSync(path.join(w.home, '.gemini', 'config', 'mcp_config.json'), 'utf8')).mcpServers.Paint;
    assert.deepEqual(after, { disabled: false, env: { COLOUR: 'red' }, command: 'node', args: ['paint server.js', '--flag'] });
    assert.ok(copied.json.servers.find(r => r.name === 'Paint').gemini, 'the list says so');
    assert.equal((await call('/api/tools/copy', { name: 'Nope', to: 'gemini' })).status, 404);
  } finally { await w.done(); }
});

test('workspace: problems from an older version aren’t carried over; this version’s are', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const version = src.match(/APP_VERSION = '([^']+)'/)[1];
  // The same few lines as the server's, on files like the ones it would find.
  const load = saved => (saved.version === version ? saved.problems || [] : []);
  assert.deepEqual(load({ problems: [{ id: 'old' }] }), [], 'from before versions were written down');
  assert.deepEqual(load({ version: '0.0.1', problems: [{ id: 'old' }] }), []);
  assert.deepEqual(load({ version, problems: [{ id: 'new' }] }), [{ id: 'new' }]);
  assert.ok(src.includes('savedProblems.version === APP_VERSION'), 'and that is what the server does');
  assert.equal((src.match(/writeJsonAtomic\(PROBLEMS_FILE, \{ version: APP_VERSION, problems \}\)/g) || []).length, 2, 'both places it saves write the version');
});

test('workspace: a Gemini chat has its own terminal and command, on the real server', { skip: process.platform !== 'win32' || !!process.versions.electron ? 'its launchers are Windows .cmd files, and it’s not for the installed app’s self-check' : false }, async () => {
  const { build } = require('./fake-world');
  const w = await build();
  try {
    const token = (await (await fetch(w.base)).text()).match(/TOKEN = '([a-f0-9]+)'/)[1];
    const call = async (p, body) => { const r = await fetch(w.base + p.slice(1), { method: body ? 'POST' : 'GET', headers: { 'x-switcher-token': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
    const until = async (what, fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; assert.ok(Date.now() - t0 < ms, `timed out: ${what}`); await new Promise(r => setTimeout(r, 150)); } };
    await until('Gemini signed in', async () => { const st = (await call('/api/state')).json; return st.gemini && st.gemini.signedIn; });
    const own = (await call('/api/chat/open', { provider: 'gemini', cwd: w.courier, mode: 'new' })).json;
    assert.equal((await call('/api/chat/send', { key: own.key, text: 'Hello there, Gemini' })).status, 200);
    const rowOf = async () => (await call('/api/activity')).json.list.find(x => x.key === own.key);
    await until('its reply', async () => /Echo:/.test((await rowOf()).lastText || ''));
    const id = (await rowOf()).sessionId;
    const listed = await until('in the list', async () => (await call('/api/sessions')).json.projects.flatMap(p => p.sessions).find(s => s.id === id));
    assert.equal(listed.provider, 'gemini');
    assert.equal((await call('/api/open', { provider: 'gemini', sessionId: id })).status, 409, 'not while it’s open here');
    const cmd = await call('/api/command', { sessionId: id });
    assert.equal(cmd.status, 200, JSON.stringify(cmd.json));
    assert.ok(cmd.json.command.includes(`--conversation ${id}`) && cmd.json.command.includes('Neon Courier'), cmd.json.command);
    // Its details, and its folder, as its menu asks for them.
    assert.equal((await call(`/api/session?${new URLSearchParams({ id })}`)).status, 200, 'its details');
    await call('/api/chat/stop', { key: own.key });
    await until('stopped', async () => { const r = await rowOf(); return !r || r.phase === 'ended'; });
    const opened = await call('/api/open', { provider: 'gemini', sessionId: id });
    assert.equal(opened.status, 200, JSON.stringify(opened.json));
    assert.ok(opened.json.dryRun && /--conversation/.test(opened.json.script), JSON.stringify(opened.json).slice(0, 300));
    assert.equal((await call('/api/open', { provider: 'gemini', sessionId: 'x; calc.exe' })).status, 404, 'only ever a chat that’s in the list');
    assert.equal((await call('/api/open', { provider: 'gemini', sessionId: '00000000-1111-2222-3333-444444444444' })).status, 404);
  } finally { await w.done(); }
});

test('workspace: Mark done reaches the server', async () => {
  const s = await startServer();
  try {
    const id = 'aaaaaaaa-1111-4222-8333-444444444444';
    const done = await s.call('/api/chat/done', { id, done: true });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.ok(done.json.doneMarks[id].done > 0);
    const back = await s.call('/api/chat/done', { id, done: false });
    assert.equal(back.status, 200);
    assert.equal((await s.call('/api/chat/done', { id: 'x', done: true })).status, 400);
  } finally { await s.stop(); }
});

test('workspace: Run the project starts it, says what it printed, and stops it', async () => {
  const s = await startServer(), world = tmp('ss-ws-run-');
  try {
    const cwd = (await s.call('/api/project/create', { existing: world })).json.cwd;
    assert.equal((await s.call(`/api/run?${new URLSearchParams({ cwd })}`)).status, 200);
    const started = await s.call('/api/run', { cwd, command: 'node -e "console.log(\'hello from it\'); setInterval(() => {}, 1000)"', action: 'start' });
    assert.equal(started.status, 200, JSON.stringify(started.json));
    assert.equal(started.json.running, true);
    let st = started.json;
    for (let i = 0; i < 60 && !(st.lines || []).some(l => /hello from it/.test(l)); i++) { await new Promise(r => setTimeout(r, 250)); st = (await s.call(`/api/run?${new URLSearchParams({ cwd })}`)).json; }
    assert.ok(st.lines.some(l => /hello from it/.test(l)), JSON.stringify(st));
    const stopped = await s.call('/api/run', { cwd, action: 'stop' });
    assert.equal(stopped.status, 200);
    assert.equal(stopped.json.running, false);
  } finally { await s.stop(); }
});

test('workspace: the picture board on the real server', async () => {
  const s = await startServer(), world = tmp('ss-ws-world-');
  try {
    // A long way down: past where the project's own scan looks.
    const deep = put(world, 'a/b/c/d/e/f/g/deep.png');
    put(world, 'art/v1/aria.png'); put(world, 'art/v1/bob.png'); put(world, 'art/v2/aria.png');
    const made = await s.call('/api/project/create', { existing: world });
    assert.equal(made.status, 200);
    const cwd = made.json.cwd;
    const q = (dir, extra = '') => `/api/board?${new URLSearchParams({ cwd, dir })}${extra}`;

    const r = await s.call(q('art/v1'));
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.items.map(x => x.name), ['aria.png', 'bob.png']);
    assert.ok(r.json.dirs.some(d => d.rel === 'a/b/c/d/e/f/g'), 'every folder, however deep');
    assert.deepEqual(r.json.items[0].others, ['art/v2/aria.png']);
    assert.equal((await s.call(`/api/board?${new URLSearchParams({ cwd: path.join(os.tmpdir(), 'not-a-project') })}`)).status, 404);

    // Marks.
    assert.equal((await s.call('/api/board/mark', { cwd, rels: ['art/v1/aria.png'], mark: 'redo', note: 'too dark' })).status, 200);
    assert.equal((await s.call('/api/board/mark', { cwd, rels: ['art/v1/bob.png'], mark: 'keep' })).status, 200);
    assert.equal((await s.call('/api/board/mark', { cwd, rels: ['art/v1/bob.png'], mark: 'burn' })).status, 400);
    assert.equal((await s.call('/api/board/mark', { cwd, rels: ['../../outside.png'], mark: 'keep' })).status, 400);
    const redo = await s.call(q(':redo'));
    assert.deepEqual(redo.json.items.map(x => [x.rel, x.mark, x.note]), [['art/v1/aria.png', 'redo', 'too dark']]);
    assert.deepEqual(redo.json.totals, { keep: 1, redo: 1, again: 0 });

    // The newest, whichever folder; and copies of what's kept.
    assert.equal((await s.call(q(':new'))).json.items.length, 3, 'the same picture in two folders shows once');
    const out = await s.call('/api/board/export', { cwd, rels: ['art/v1/bob.png'] });
    assert.equal(out.status, 200);
    assert.ok(fs.existsSync(path.join(out.json.folder, 'bob.png')));
    assert.ok(/^Kept pictures\//.test(out.json.rel));

    // Any picture in the folder can be the banner; nothing outside it can.
    assert.equal((await s.call('/api/project/banner', { cwd, path: deep })).status, 200);
    assert.equal((await s.call('/api/project/banner', { cwd, path: put(tmp('ss-ws-else-'), 'x.png') })).status, 400);
  } finally { await s.stop(); }
});

test('workspace: pictures come through whole, with the token, and a big one doesn’t hold anything up', async () => {
  const s = await startServer(), world = tmp('ss-ws-world-');
  try {
    const big = Buffer.concat([PNG, Buffer.alloc(9 << 20, 7)]);
    const f = put(world, 'big.png', big);
    const cwd = (await s.call('/api/project/create', { existing: world })).json.cwd;
    const url = t => `${s.base}/api/image?${new URLSearchParams({ ...(t ? { token: t } : {}), path: f, cwd, v: '123' })}`;
    assert.equal((await fetch(url(null))).status, 403, 'not without the token');
    const r = await fetch(url(s.token));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.ok(Buffer.from(await r.arrayBuffer()).equals(big));
    assert.equal((await fetch(`${s.base}/api/image?${new URLSearchParams({ token: s.token, path: put(world, 'notes.txt', 'x'), cwd })}`)).status, 400);
  } finally { await s.stop(); }
});

test('workspace: a project’s state in git, and its uncommitted changes', { skip: noGit }, async () => {
  const s = await startServer(), world = tmp('ss-ws-git-');
  const git = (...a) => execFileSync('git', ['-C', world, ...a], { windowsHide: true, stdio: 'pipe' });
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'T'); git('config', 'commit.gpgsign', 'false');
    put(world, 'a.txt', 'one\n'); git('add', '.'); git('commit', '-qm', 'The start');
    put(world, 'a.txt', 'one\ntwo\n'); put(world, 'b.txt', 'new\n');
    const cwd = (await s.call('/api/project/create', { existing: world })).json.cwd;
    const now = await s.call(`/api/project/now?cwd=${encodeURIComponent(cwd)}`);
    assert.equal(now.status, 200);
    assert.equal(now.json.git.branch, 'main');
    assert.equal(now.json.git.changed, 2);
    assert.equal(now.json.git.commits[0].subject, 'The start');
    const told = await s.call(`/api/commander/tool/changes?${new URLSearchParams({ cwd })}`);
    assert.equal(told.status, 200, 'the Commander can ask what changed');
    assert.deepEqual(told.json.changes, []);
    assert.equal((await s.call(`/api/commander/tool/changes?${new URLSearchParams({ cwd: path.join(os.tmpdir(), 'nope') })}`)).status, 404);
    const diff = p => s.call(`/api/project/diff?${new URLSearchParams({ cwd, path: p })}`);
    assert.match((await diff('a.txt')).json.diff, /\+two/);
    assert.match((await diff('b.txt')).json.diff, /\+new/);
    assert.equal((await diff('../outside.txt')).status, 400);
    assert.equal((await s.call(`/api/project/now?cwd=${encodeURIComponent(path.join(os.tmpdir(), 'nope'))}`)).status, 404);
  } finally { await s.stop(); }
});

test('workspace: a page can be shown beside a chat with nothing running', async () => {
  const s = await startServer(), world = tmp('ss-ws-site-');
  try {
    const cwd = (await s.call('/api/project/create', { existing: world })).json.cwd;
    const page = put(world, 'site/index.html', '<h1>Mine</h1>');
    const r = await s.call('/api/file/preview', { path: page, cwd });
    assert.equal(r.status, 200);
    const u = new URL(r.json.url);
    assert.equal(u.hostname, '127.0.0.1');
    assert.match(r.json.url, /k=[a-f0-9]+/);
    assert.equal((await fetch(`${u.origin}/index.html`)).status, 403, 'not without its key');
    const first = await fetch(r.json.url, { redirect: 'manual' });
    assert.equal(first.status, 302);
    const body = await (await fetch(`${u.origin}/index.html`, { headers: { cookie: first.headers.get('set-cookie').split(';')[0] } })).text();
    assert.equal(body, '<h1>Mine</h1>');
    assert.equal((await s.call('/api/file/preview', { path: put(world, 'notes.md', 'x'), cwd })).status, 400);
  } finally { await s.stop(); }
});

test('workspace: only files of words open in an editor', async () => {
  const s = await startServer(), world = tmp('ss-ws-open-');
  try {
    const cwd = (await s.call('/api/project/create', { existing: world })).json.cwd;
    const ok = await s.call('/api/file/editor', { path: put(world, 'notes.md', 'x'), cwd });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.dryRun, true);
    for (const name of ['run.exe', 'run.bat', 'run.cmd', 'run.ps1', 'run.vbs', 'run.js', 'run.py', 'run.lnk']) {
      assert.equal((await s.call('/api/file/editor', { path: put(world, name, 'x'), cwd })).status, 400, name);
    }
  } finally { await s.stop(); }
});

test('workspace: a site can sit beside a chat, and only one on this computer', async () => {
  const s = await startServer();
  try {
    const r = await fetch(`${s.base}/`);
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /frame-src 'self' http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\*/);
    assert.match(csp, /frame-ancestors 'self'/);
    assert.equal(csp.match(/frame-src/g).length, 1, 'a rule given twice only counts once');
    const lite = (await fetch(`${s.base}/lite`)).headers.get('content-security-policy');
    assert.equal(lite.match(/frame-src/g).length, 1);
    assert.match(lite, /frame-src 'self' https:/, 'Lite’s own list of what it can frame');
  } finally { await s.stop(); }
});
