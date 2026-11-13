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
