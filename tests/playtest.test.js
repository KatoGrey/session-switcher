'use strict';
// Playtest (lib/playtest.js): the spec checked, the brief written from it, where the report goes, a project's files
// looked through (links, patch notes, whether it's a Voyage world), and links, presets and runs kept. Then the routes
// on the real server, in a pretend home (tests/fake-world.js) with stand-in assistants: no real chat starts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
require('../lib/electron-node');
const os = require('os');
const path = require('path');
const pt = require('../lib/playtest');

const tmp = name => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), name))); test.after(() => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }); return d; };
const put = (f, text, mtime) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); if (mtime) fs.utimesSync(f, mtime / 1000, mtime / 1000); return f; };
const SPEC = { url: 'https://voyage.io/world/abc123', goal: 'Do companions help in fights?', turns: 10 };

test('playtest: a spec is checked and filled in', () => {
  const s = pt.cleanSpec(SPEC);
  assert.deepEqual(s, { url: 'https://voyage.io/world/abc123', goal: 'Do companions help in fights?', turns: 10, opening: '', character: { kind: 'random' }, style: 'new', screen: 'desktop', stopAsk: true, pictures: false, report: ['bugs', 'rules', 'pacing'], extra: '' });
  assert.throws(() => pt.cleanSpec({ ...SPEC, url: '' }), /world’s link/);
  assert.throws(() => pt.cleanSpec({ ...SPEC, url: 'javascript:alert(1)' }), /web address/);
  assert.throws(() => pt.cleanSpec({ ...SPEC, goal: '  ' }), /goal/);
  assert.throws(() => pt.cleanSpec({ ...SPEC, character: { kind: 'saved', name: '' } }), /saved character/);
  assert.throws(() => pt.cleanSpec({ ...SPEC, style: 'custom', styleText: '' }), /player style/);
  assert.equal(pt.cleanSpec({ ...SPEC, url: 'voyage.io/world/x' }).url, 'https://voyage.io/world/x', 'a link without its https:// is fine');
  assert.equal(pt.cleanSpec({ ...SPEC, turns: 500 }).turns, pt.MAX_TURNS, 'a hard cap on turns');
  assert.equal(pt.cleanSpec({ ...SPEC, turns: 'goal' }).turns, 'goal');
  assert.equal(pt.cleanSpec({ ...SPEC, style: 'nonsense' }).style, 'new');
  assert.deepEqual(pt.cleanSpec({ ...SPEC, report: ['log', 'nope', 'log'] }).report, ['log']);
  assert.deepEqual(pt.cleanSpec({ ...SPEC, patchNotes: ['PATCH-NOTES-1.md', '../secret.md', 'C:\\x.md', '/etc/x.md'] }).patchNotes, ['PATCH-NOTES-1.md'], 'patch notes only from inside the project');
  assert.equal(pt.cleanSpec({ ...SPEC, chip: 'nope' }).chip, undefined);
});

test('playtest: names, file names and where the report goes', () => {
  const chip = pt.CHIPS.find(c => c.id === 'fights');
  assert.equal(pt.titleFor({ goal: chip.goal, chip: 'fights' }), 'Playtest · Fights & companions', 'a quick start keeps its name');
  assert.equal(pt.titleFor({ goal: `Only the summoner. ${chip.goal}`, chip: 'fights' }), 'Playtest · Only the summoner', 'an edited goal goes by its own first sentence');
  assert.equal(pt.shortGoal({ goal: 'Does the very long and winding opening sequence keep a brand new player interested for long?' }), 'Does the very long and winding opening…', 'cut at a word');
  assert.equal(pt.slugOf('Fights & companions'), 'fights-and-companions');
  assert.equal(pt.slugOf('¿¡!!'), 'playtest');
  const root = tmp('ss-pt-path-');
  const at = new Date(2026, 10, 17, 9, 5);
  const f = pt.reportPathFor(root, { goal: chip.goal, chip: 'fights' }, at);
  assert.equal(f, path.join(root, 'playtests', '2026-11-17-0905-fights-and-companions.md'));
  put(f, 'x');
  assert.equal(pt.reportPathFor(root, { goal: chip.goal, chip: 'fights' }, at), path.join(root, 'playtests', '2026-11-17-0905-fights-and-companions-2.md'), 'never over an earlier report');
});

test('playtest: the brief says what to do, how, and where the report goes', () => {
  const spec = pt.cleanSpec({ ...SPEC, turns: 'goal', opening: 'The Hollow Court', character: { kind: 'saved', name: 'Kato' }, style: 'fighter', screen: 'phone', stopAsk: false, pictures: true, report: ['bugs', 'log', 'score'], extra: 'Skip the tutorial.', patchNotes: ['PATCH-NOTES-9.md'] });
  const reportPath = path.win32.join('C:\\W', 'playtests', 'r.md');   // (a Windows path on a Mac too)
  const b = pt.composeBrief(spec, { cwd: 'C:\\W', reportPath, provider: 'claude', browser: 'app', at: new Date(2026, 10, 17, 14, 5), patchNotes: ['C:\\W\\PATCH-NOTES-9.md'] });
  for (const want of [/^# Playtest: Do companions help in fights/, /## The goal\n\nDo companions help in fights\?/, /Link: https:\/\/voyage\.io\/world\/abc123/, /“The Hollow Court”/, /saved character “Kato”/,
    /mcp__app-browser__voyage_act/, /`voyage_start`/, /`voyage_story`/, /set a phone size with `viewport`/, /until you can answer the goal \(at most 40 turns\)/, /aggressive fighter/,
    /screenshot`? only to check something visual/, /pictures at the key moments/, /Never publish, edit, delete/, /never buy anything/, /never change account or site settings/,
    /try once to get past it/, /C:\\W\\PATCH-NOTES-9\.md/, /## Also\n\nSkip the tutorial\./, /`C:\\W\\playtests\\r\.md`/, /Make the `playtests` folder/,
    /\*\*Bugs and errors\*\*/, /\*\*Turn by turn\*\*/, /\*\*Scores\*\*/, /2026-11-17 14:05/, /reply with a short summary/, /r-pictures/]) assert.match(b, want);
  assert.doesNotMatch(b, /\*\*Pacing and feel\*\*/, 'only the sections asked for');
  assert.doesNotMatch(b, /stop and ask the user before you go on/);
  assert.doesNotMatch(b, /claude-in-chrome/);
  // Stop and ask; Codex (its tools under the app-browser server); a set number of turns.
  const c = pt.composeBrief(pt.cleanSpec({ ...SPEC, turns: 5 }), { reportPath: 'r.md', provider: 'codex', browser: 'both' });
  assert.match(c, /stop and ask the user before you go on/);
  assert.match(c, /the `app-browser` MCP server/);
  assert.doesNotMatch(c, /mcp__app-browser__/);
  assert.match(c, /rather than Claude in Chrome/);
  assert.match(c, /Play 5 turns as a new player/);
  assert.doesNotMatch(c, /patch notes/i);
  // Chrome: Claude in Chrome's tools, played by hand.
  const k = pt.composeBrief(pt.cleanSpec({ ...SPEC, screen: 'phone' }), { reportPath: 'r.md', provider: 'claude', browser: 'chrome' });
  assert.match(k, /mcp__claude-in-chrome__/);
  assert.match(k, /resize_window/);
  assert.doesNotMatch(k, /voyage_act|app-browser/);
});

test('playtest: a project’s files: world links, patch notes, and whether it’s a Voyage world', async () => {
  const root = tmp('ss-pt-scan-');
  const t0 = Date.now() - 864e5;
  put(path.join(root, 'README.md'), 'Our Voyage world. Live: https://voyage.io/world/live-1). Test: https://beta.voyage.io/preview/test-2.\nPicture: https://images.aidungeon.com/user_content/1/x.png\n');
  put(path.join(root, 'notes.json'), JSON.stringify({ link: 'https://play.aidungeon.com/scenario/abc/xyz' }));
  put(path.join(root, 'PATCH-NOTES-old.md'), 'old', t0);
  put(path.join(root, 'PATCH-NOTES-batch9-part-1.md'), 'one', t0 + 3600e3);
  put(path.join(root, 'PATCH-NOTES-batch9-part-2.md'), 'two', t0 + 3600e3 + 60e3);
  put(path.join(root, 'sub', 'deep.md'), 'https://voyage.io/world/not-looked-at');
  const s = await pt.scan(root);
  assert.deepEqual(s.links.map(l => l.url).sort(), ['https://beta.voyage.io/preview/test-2', 'https://play.aidungeon.com/scenario/abc/xyz', 'https://voyage.io/world/live-1']);
  assert.equal(s.mentions, true);
  assert.equal(s.patchNotes.newest, 'PATCH-NOTES-batch9-part-2.md');
  assert.deepEqual(s.patchNotes.files, ['PATCH-NOTES-batch9-part-2.md', 'PATCH-NOTES-batch9-part-1.md'], 'a batch’s parts, not the old ones');
  const plain = tmp('ss-pt-plain-');
  put(path.join(plain, 'README.md'), '# A bakery game\n');
  const p = await pt.scan(plain);
  assert.deepEqual([p.mentions, p.links, p.patchNotes], [false, [], null]);
  const changelog = tmp('ss-pt-voyage-cl-');
  put(path.join(changelog, 'CHANGELOG.md'), 'x');
  assert.equal((await pt.scan(changelog)).patchNotes.newest, 'CHANGELOG.md');
  // Capped: only so many files, only the start of each.
  const big = tmp('ss-pt-big-');
  put(path.join(big, 'huge.json'), `${' '.repeat(200 * 1024)}https://voyage.io/world/too-far`);
  assert.deepEqual((await pt.scan(big, { bytes: 64 * 1024 })).links, []);
});

test('playtest: links, presets and runs are kept per project', async () => {
  const dataDir = tmp('ss-pt-data-'), root = tmp('ss-pt-proj-');
  const a = pt.createPlaytests({ dataDir });
  let v = await a.view(root);
  assert.deepEqual([v.links, v.presets, v.runs, v.voyage, v.last], [[], [], [], false, null]);
  assert.equal(v.chips.length, 7);
  a.saveLink(root, { url: 'https://voyage.io/world/one' });
  a.saveLink(root, { url: 'https://voyage.io/world/two', label: 'Test version', used: true });
  a.saveLink(root, { url: 'https://voyage.io/world/one', label: 'Live' });
  assert.throws(() => a.saveLink(root, { url: 'not a link at all' }), /web address/);
  v = await a.view(root);
  assert.deepEqual(v.links.map(l => [l.url, l.label]), [['https://voyage.io/world/two', 'Test version'], ['https://voyage.io/world/one', 'Live']], 'last used first');
  assert.equal(v.last, 'https://voyage.io/world/two');
  assert.equal(v.voyage, true, 'a saved link makes it a Voyage world');
  a.forgetLink(root, 'https://voyage.io/world/two');
  assert.deepEqual((await a.view(root)).links.map(l => l.url), ['https://voyage.io/world/one']);

  const { preset } = a.savePreset(root, { name: 'Fights on test', spec: { ...SPEC, style: 'fighter' } });
  assert.equal(preset.spec.style, 'fighter');
  a.savePreset(root, { name: 'fights on TEST', spec: { ...SPEC, turns: 20 } });
  assert.equal((await a.view(root)).presets.length, 1, 'the same name replaces it');
  assert.equal((await a.view(root)).presets[0].spec.turns, 20);
  assert.throws(() => a.savePreset(root, { name: '', spec: SPEC }), /Name the preset/);
  assert.throws(() => a.savePreset(root, { name: 'Bad', spec: { goal: 'x' } }), /link/);

  for (let i = 0; i < 12; i++) a.noteRun(root, { spec: pt.cleanSpec(SPEC), title: `Run ${i}`, key: `k${i}` });
  const runs = (await a.view(root)).runs;
  assert.equal(runs.length, 10, 'the last ten');
  assert.equal(runs[0].title, 'Run 11');
  a.updateRun(root, runs[0].at, { sessionId: 'sess-1' });

  // Kept on disk, and read back by the next start.
  const b = pt.createPlaytests({ dataDir });
  const again = await b.view(root);
  if (process.platform === 'win32') assert.equal((await b.view(root.toUpperCase())).presets.length, 1, 'the same folder, however it’s written');
  assert.equal(again.presets[0].name, 'fights on TEST');
  assert.equal(again.runs[0].sessionId, 'sess-1');
  b.forgetPreset(root, again.presets[0].id);
  assert.deepEqual((await b.view(root)).presets, []);
  assert.ok(fs.existsSync(path.join(dataDir, 'playtests.json')));
});

test('playtest: the routes on the real server start a chat with the brief, named for it', {
  skip: process.platform !== 'win32' ? 'the stand-in assistants’ launchers are Windows .cmd files' : process.versions.electron ? 'not for the installed app’s self-check' : false,
}, async () => {
  const { build } = require('./fake-world');
  const w = await build();
  try {
    const token = (await (await fetch(w.base)).text()).match(/TOKEN = '([a-f0-9]+)'/)[1];
    const call = async (p, body) => { const r = await fetch(w.base + p.slice(1), { method: body ? 'POST' : 'GET', headers: { 'x-switcher-token': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
    const until = async (what, fn, ms = 30000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; assert.ok(Date.now() - t0 < ms, `timed out: ${what}\n${w.serverLog().slice(-1500)}`); await new Promise(r => setTimeout(r, 200)); } };
    // The tavern, as a Voyage world: a link in its notes, and patch notes.
    fs.writeFileSync(path.join(w.tavern, 'WORLD.md'), 'Play it at https://voyage.io/world/tavern-live\n');
    fs.writeFileSync(path.join(w.tavern, 'PATCH-NOTES-7.md'), '- Companions join fights now.\n');
    const q = `/api/playtest?cwd=${encodeURIComponent(w.tavern)}`;
    const view = await call(q);
    assert.equal(view.status, 200, JSON.stringify(view.json));
    assert.equal(view.json.voyage, true);
    assert.deepEqual(view.json.found.map(l => l.url), ['https://voyage.io/world/tavern-live']);
    assert.equal(view.json.patchNotes.newest, 'PATCH-NOTES-7.md');
    assert.equal(view.json.browser, 'chrome', 'run outside the desktop app, there is no built-in browser: Chrome, as chats get');
    assert.equal((await call(`/api/playtest?cwd=${encodeURIComponent(path.join(w.world, 'Nowhere'))}`)).status, 404);
    // A link named, a preset saved, a bad spec refused.
    const named = await call('/api/playtest/link', { cwd: w.tavern, url: 'https://voyage.io/world/tavern-live', label: 'Live' });
    assert.deepEqual(named.json.links.map(l => l.label), ['Live']);
    const spec = { url: 'https://voyage.io/world/tavern-live', goal: pt.CHIPS[0].goal, chip: 'fights', turns: 5, patchNotes: ['PATCH-NOTES-7.md'], report: ['bugs', 'log'] };
    assert.equal((await call('/api/playtest/preset', { cwd: w.tavern, name: 'Quick fights', spec })).json.presets[0].name, 'Quick fights');
    const refused = await call('/api/playtest/start', { cwd: w.tavern, spec: { ...spec, goal: '' }, provider: 'claude' });
    assert.equal(refused.status, 400); assert.match(refused.json.error, /goal/);
    // The brief, seen first.
    const brief = await call('/api/playtest/brief', { cwd: w.tavern, spec, provider: 'claude' });
    assert.equal(brief.status, 200, JSON.stringify(brief.json));
    assert.match(brief.json.brief, /mcp__claude-in-chrome__/, 'so the brief names the tools the chat really has (the built-in browser’s brief is checked above)');
    assert.ok(brief.json.brief.includes(path.join(w.tavern, 'PATCH-NOTES-7.md')));
    assert.equal(brief.json.title, 'Playtest · Fights & companions');
    // Started: a new Claude chat (as the second account), its first message the brief, named for it.
    const started = await call('/api/playtest/start', { cwd: w.tavern, spec, where: 'new', provider: 'claude', account: 'two' });
    assert.equal(started.status, 200, JSON.stringify(started.json));
    assert.equal(started.json.where, 'new');
    assert.ok(started.json.key && started.json.reportPath.startsWith(path.join(w.tavern, 'playtests')), JSON.stringify(started.json));
    assert.match(path.basename(started.json.reportPath), /^\d{4}-\d\d-\d\d-\d{4}-fights-and-companions\.md$/);
    const key = started.json.key;
    const id = await until('its id', async () => (await call('/api/chat/attach', { key })).json.sessionId);
    assert.equal((await call('/api/chat/attach', { key })).json.accountId, 'two');
    await until('the brief in its transcript', async () => {
      const h = await call(`/api/chat/history?id=${encodeURIComponent(id)}`);
      return h.status === 200 && (h.json.items || []).find(i => i.kind === 'user' && /# Playtest: Fights & companions/.test(i.text || '') && /tavern-live/.test(i.text || ''));
    });
    await until('named “Playtest · Fights & companions”', async () => {
      const s = await call('/api/sessions');
      return (s.json.projects || []).flatMap(p => p.sessions || []).some(x => x.id === id && x.title === 'Playtest · Fights & companions');
    }, 40000);
    const after = (await call(q)).json;
    assert.equal(after.runs[0].sessionId, id, 'the run remembers its chat');
    assert.equal(after.runs[0].who.provider, 'claude');
    assert.equal(after.links[0].url, 'https://voyage.io/world/tavern-live');
    assert.ok(after.links[0].lastUsed, 'the link is marked as used');
    // In that chat now, as its next message.
    await until('ready', async () => (await call('/api/chat/attach', { key })).json.state === 'ready');
    const here = await call('/api/playtest/start', { spec: { ...spec, goal: 'Is the bar fight fair?', chip: undefined }, where: 'this', key });
    assert.equal(here.status, 200, JSON.stringify(here.json));
    assert.equal(here.json.key, key);
    await until('the second brief in the same chat', async () => {
      const h = await call(`/api/chat/history?id=${encodeURIComponent(id)}`);
      return (h.json.items || []).find(i => i.kind === 'user' && /# Playtest: Is the bar fight fair/.test(i.text || ''));
    });
    assert.equal((await call('/api/playtest/start', { spec, where: 'this', key: 'no-such-chat' })).status, 404);
  } finally { await w.done(); }
});

test('playtest: two reports never get one name, and a report never goes outside the project', () => {
  const cwd = tmp('ss-pt-paths-');
  const at = new Date(2026, 10, 17, 14, 5);
  const a = pt.reportPathFor(cwd, SPEC, at);
  const b = pt.reportPathFor(cwd, SPEC, at, [a]);
  assert.notEqual(a, b, 'a run started a moment ago (its report not written yet) keeps its name');
  assert.match(b, /-2\.md$/);
  assert.equal(pt.inside(cwd, path.join(cwd, 'notes', 'x.md')), true, 'a file to be made inside is inside');
  const outside = tmp('ss-pt-out-');
  fs.symlinkSync(outside, path.join(cwd, 'playtests'), 'junction');
  assert.equal(pt.inside(cwd, path.join(cwd, 'playtests', 'x.md')), false, 'a link out of the project is outside');
  assert.throws(() => pt.reportPathFor(cwd, SPEC, at), /leads outside the project/);
});
