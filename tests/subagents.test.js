'use strict';
// Subagents (lib/subagents.js): what's saved, the environment a chat starts with, and the plugin Claude Code reads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sub = require('../lib/subagents');

const gone = [];
test.after(() => { for (const d of gone) fs.rmSync(d, { recursive: true, force: true }); });
const store = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'subagents-')); gone.push(d); return sub.createSubagents({ file: path.join(d, 'data', 'subagents.json'), tmp: d }); };

test('a first start has the starters, and chats get nothing extra until a default is chosen', () => {
  const s = store();
  assert.deepEqual(s.get().roster.map(a => [a.name, a.engine]), [['scout', 'claude'], ['reviewer', 'claude'], ['builder', 'claude'], ['verifier', 'claude'], ['codex-reviewer', 'codex']]);
  assert.deepEqual(s.envFor(), {});
  assert.deepEqual(s.envFor({ work: true }), {});
});

test('defaults reach chats as Claude Code’s subagent settings; Your work’s own win for its chats', () => {
  const s = store();
  s.save({ ...s.get(), defaults: { model: 'sonnet', effort: 'medium' }, work: { model: 'opus', effort: '' } });
  assert.deepEqual(s.envFor(), { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet', CLAUDE_CODE_SUBAGENT_EFFORT: 'medium' });
  assert.deepEqual(s.envFor({ work: true }), { CLAUDE_CODE_SUBAGENT_MODEL: 'opus', CLAUDE_CODE_SUBAGENT_EFFORT: 'medium' }, 'its effort falls back to every chat’s');
  s.save({ ...s.get(), defaults: { model: 'inherit', effort: 'nonsense' }, work: { model: 'gpt-9', effort: 'max' } });
  assert.deepEqual(s.envFor(), {}, 'same as the chat, and an unknown effort, add nothing');
  assert.deepEqual(s.envFor({ work: true }), { CLAUDE_CODE_SUBAGENT_EFFORT: 'max' });
  assert.equal(JSON.parse(fs.readFileSync(s.file, 'utf8')).work.model, '', 'only known models are kept');
});

test('saving says what’s wrong with a subagent instead of dropping it', () => {
  const s = store();
  const base = s.get();
  assert.throws(() => s.save({ ...base, roster: [...base.roster, { name: 'Has Spaces!', description: 'x' }] }), e => e.status === 400 && /can’t be a subagent’s name/.test(e.message));
  assert.throws(() => s.save({ ...base, roster: [{ name: 'quiet', description: '' }] }), e => e.status === 400 && /what quiet is for/.test(e.message));
  assert.throws(() => s.save({ ...base, roster: [{ name: 'twin', description: 'a' }, { name: 'twin', description: 'b' }] }), e => /Two subagents are called “twin”/.test(e.message));
  const v = s.save({ ...base, roster: [{ name: 'Log Reader', description: 'Reads logs', model: 'haiku', effort: 'low', tools: 'read', prompt: 'Only read.' }] });
  assert.deepEqual(v.roster, [{ name: 'log-reader', engine: 'claude', description: 'Reads logs', model: 'haiku', effort: 'low', tools: 'read', prompt: 'Only read.' }]);
  assert.deepEqual(s.save({ ...base, roster: [] }).roster, [], 'all of them can go');
});

test('the plugin: each subagent with its model, effort and tools, and the skill that explains them', () => {
  const s = store();
  s.save({ ...s.get(), defaults: { model: 'haiku', effort: 'low' } });
  const dir = s.pluginDir();
  assert.ok(dir && /subagents-[0-9a-f]{10}$/.test(dir));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).name, 'session-switcher');
  const scout = fs.readFileSync(path.join(dir, 'agents', 'scout.md'), 'utf8');
  assert.match(scout, /^---\nname: scout\ndescription: ".+"\nmodel: haiku\neffort: low\ntools: Read, Grep, Glob, WebFetch, WebSearch, Bash\n---\n/);
  const builder = fs.readFileSync(path.join(dir, 'agents', 'builder.md'), 'utf8');
  assert.doesNotMatch(builder, /^tools:/m, 'one that can change files keeps all the chat’s tools');
  const skill = fs.readFileSync(path.join(dir, 'skills', 'subagent-models', 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: subagent-models\ndescription: /);
  assert.match(skill, /`session-switcher:reviewer` \(Opus, high effort, reads only\)/);
  assert.match(skill, /run on Haiku at low effort/);
  assert.match(skill, /explicit instruction/);
  assert.equal(s.pluginDir(), dir, 'the same choices, the same folder');
  s.save({ ...s.get(), roster: s.get().roster.filter(a => a.name !== 'builder') });
  const next = s.pluginDir();
  assert.notEqual(next, dir, 'a change gets a folder of its own, so a running chat keeps what it started with');
  assert.ok(!fs.existsSync(path.join(next, 'agents', 'builder.md')));
  // A description with quotes and colons stays one YAML string.
  assert.match(sub.agentFile(sub.cleanAgent({ name: 'odd', description: 'Says "hi": twice' })), /description: "Says \\"hi\\": twice"/);
});

test('Codex and Gemini subagents: a relay in Claude chats, and Codex’s own roles in Codex chats', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'subagents-')); gone.push(d);
  const s = sub.createSubagents({ file: path.join(d, 's.json'), tmp: d, engines: () => ({ codex: { command: 'codex', home: 'C:/codex-home' }, gemini: { command: 'C:/agy/agy.exe' } }) });
  const v = s.save({ ...s.get(), codex: { model: 'gpt-6.1-sol', effort: 'low' }, roster: [
    { name: 'cx', engine: 'codex', description: 'Codex checks', model: 'gpt-6.1-sol', effort: 'ultra', tools: 'read', prompt: 'Be brief.' },
    { name: 'gm', engine: 'gemini', description: 'Gemini looks', model: 'gemini-4-argon', effort: 'ultra', tools: 'all' },
    { name: 'cl', engine: 'claude', description: 'Claude', model: 'gpt-6.1-sol', effort: 'ultra' },
    { name: 'bad-model', engine: 'codex', description: 'x', model: 'has spaces in it' },
  ] });
  assert.deepEqual(v.roster.map(a => [a.name, a.model, a.effort]), [['cx', 'gpt-6.1-sol', 'ultra'], ['gm', 'gemini-4-argon', ''], ['cl', 'inherit', ''], ['bad-model', '', '']], 'each assistant’s own models and efforts');
  assert.deepEqual(v.codex, { model: 'gpt-6.1-sol', effort: 'low' });

  const dir = s.pluginDir(), at = dir.replace(/\\/g, '/');
  const relayAgent = fs.readFileSync(path.join(dir, 'agents', 'cx.md'), 'utf8');
  assert.match(relayAgent, /^model: haiku$/m, 'the go-between is light');
  assert.ok(relayAgent.includes(`node "${at}/relay.js" cx`), 'it names the relay where it really is');
  const relay = JSON.parse(fs.readFileSync(path.join(dir, 'relay.json'), 'utf8'));
  assert.deepEqual(relay.codex, { command: 'codex', home: 'C:/codex-home' });
  assert.deepEqual(Object.keys(relay.agents), ['cx', 'gm', 'bad-model'], 'only the Codex and Gemini ones');
  require('node:child_process').execFileSync(process.execPath, ['--check', path.join(dir, 'relay.js')]);
  assert.match(fs.readFileSync(path.join(dir, 'skills', 'subagent-models', 'SKILL.md'), 'utf8'), /`session-switcher:cx` \(Codex gpt-6\.1-sol, ultra effort, reads only\)/);

  const role = fs.readFileSync(path.join(dir, 'codex', 'cx.toml'), 'utf8');
  assert.match(role, /^model = "gpt-6\.1-sol"$/m);
  assert.match(role, /^model_reasoning_effort = "ultra"$/m);
  assert.match(role, /^sandbox_mode = "read-only"$/m);
  assert.ok(!fs.existsSync(path.join(dir, 'codex', 'gm.toml')), 'Gemini ones aren’t Codex roles');
  const t = s.codexThread();
  assert.deepEqual(Object.keys(t.config).sort(), ['agents.bad-model.config_file', 'agents.bad-model.description', 'agents.cx.config_file', 'agents.cx.description']);
  assert.equal(t.config['agents.cx.config_file'], `${at}/codex/cx.toml`);
  assert.match(t.note, /agent_type/);
  assert.match(t.note, /- cx \(gpt-6\.1-sol, ultra effort, reads only\): Codex checks/);
  assert.match(t.note, /For any other sub-agent, set model to gpt-6\.1-sol and reasoning_effort to low/);

  s.save({ ...s.get(), codex: { model: '', effort: '' }, roster: s.get().roster.filter(a => a.engine !== 'codex') });
  assert.deepEqual(s.codexThread(), { config: {}, note: '' }, 'nothing to tell Codex: nothing added');
});

test('a Gemini subagent takes agy’s update check first, hidden, so agy doesn’t open a window for its own', { skip: process.platform !== 'win32' && 'only Windows opens a window for it' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagents-agy-')); gone.push(dir);
  const home = path.join(dir, 'home'), stamp = path.join(home, '.gemini', 'antigravity-cli', 'last_check.timestamp');
  fs.mkdirSync(path.dirname(stamp), { recursive: true });
  fs.writeFileSync(stamp, '');
  const old = new Date(Date.now() - 20 * 60e3); fs.utimesSync(stamp, old, old);
  // A stand-in agy: its update check is noted; anything else gets an answer.
  const record = path.join(dir, 'calls.txt'), stub = path.join(dir, 'stub-agy.js'), launcher = path.join(dir, 'agy.cmd');
  fs.writeFileSync(stub, "require('fs').appendFileSync(process.env.STUB_RECORD, process.argv[2] + '\\n'); console.log(process.argv[2] === 'update' ? 'You are already on the latest version.' : 'The answer.');\n");
  fs.writeFileSync(launcher, `@echo off\r\n${process.versions.electron ? 'set ELECTRON_RUN_AS_NODE=1\r\n' : ''}"${process.execPath}" "${stub}" %*\r\n`);
  const files = sub.pluginFiles({ defaults: {}, roster: [{ name: 'gm', engine: 'gemini', description: 'x', model: '', effort: '', tools: 'read', prompt: '' }] }, { gemini: { command: launcher } }, dir.replace(/\\/g, '/'));
  const plugin = path.join(dir, 'plugin');
  for (const [name, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(plugin, name)), { recursive: true }); fs.writeFileSync(path.join(plugin, name), text); }
  fs.writeFileSync(path.join(dir, 'task.txt'), 'Look it up.');
  const relay = () => require('node:child_process').spawnSync(process.execPath, [path.join(plugin, 'relay.js'), 'gm', path.join(dir, 'task.txt')], { encoding: 'utf8', cwd: dir, env: { ...process.env, USERPROFILE: home, HOME: home, STUB_RECORD: record } });
  let r = relay();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'The answer.');
  assert.deepEqual(fs.readFileSync(record, 'utf8').trim().split('\n').sort(), ['-p', 'update'], 'its update check, then the job');
  assert.ok(Date.now() - fs.statSync(stamp).mtimeMs < 60e3, 'marked, so the agy doing the job skips its own');
  r = relay();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readFileSync(record, 'utf8').trim().split('\n').sort(), ['-p', '-p', 'update'], 'not again while the mark is fresh');
});
