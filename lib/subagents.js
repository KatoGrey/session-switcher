'use strict';
// Subagents: which assistant, model and reasoning effort each helper a chat starts gets. Chats here delegate parts of
// a job to subagents (searches, reviews, checks); by default each one is a copy of the chat on the chat's own model.
// This lets you choose:
//  - defaults: Claude chats' subagents (Claude Code's CLAUDE_CODE_SUBAGENT_MODEL and CLAUDE_CODE_SUBAGENT_EFFORT), one
//    set for every chat and one for chats started from Your work; and Codex chats' subagents (told to Codex);
//  - a roster of named subagents, each run by Claude, Codex or Gemini, with its own model, effort, purpose and tools;
//  - a skill that tells Claude how to use them, and to give a subagent the model and effort you ask for in words.
// How each chat gets them:
//  - Claude chats: the roster and the skill come as a small plugin of the app's own (--plugin-dir), written to the
//    temp folder. A Claude subagent is a Claude Code agent. A Codex or Gemini one is a light Claude agent that hands
//    the task to `codex exec` or `agy -p` (relay.js, in the plugin) with the chosen model and effort, and returns
//    the answer.
//  - Codex chats: the Codex subagents become Codex agent roles (spawn_agent's agent_type), each with a role file of
//    its own model, effort, sandbox and instructions, given with the thread; and Codex is told about them and about
//    the default model and effort for any other subagent.
//  - Gemini chats: Antigravity has no subagents to set, so nothing.
// Nothing is written into your projects, or Claude's or Codex's settings.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ENGINES = ['claude', 'codex', 'gemini'];
const ENGINE_LABEL = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' };
const MODELS = ['inherit', 'fable', 'opus', 'sonnet', 'haiku'];   // Claude's
const MODEL_LABEL = { inherit: 'Same as the chat', fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' };
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];       // Claude's and Gemini's (agy --effort)
const CODEX_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const effortsOf = engine => (engine === 'codex' ? CODEX_EFFORTS : EFFORTS);
// A Codex or Gemini model's name, as their model lists give it ('' is the assistant's own default).
const MODEL_ID = /^[\w.:[\]-]{1,80}$/;
// Tool sets a subagent may have: all of the chat's, or reading only (it can look but not change anything).
const TOOLSETS = { all: null, read: ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Bash'] };
const PLUGIN = 'session-switcher';

// A starting roster: each one is yours to change or remove.
const STARTERS = [
  { name: 'scout', engine: 'claude', description: 'Fast look-ups: find files, functions, usages and facts across the code, logs or docs, and report back briefly. Use for searches and reading, never for changes.', model: 'haiku', effort: 'low', tools: 'read', prompt: 'You find things quickly and report only what was asked: file paths with line numbers, short quotes, and a one-line conclusion. Never edit files.' },
  { name: 'reviewer', engine: 'claude', description: 'A careful second opinion on a change or PR: correctness bugs, missed cases, broken conventions. Use before calling work done.', model: 'opus', effort: 'high', tools: 'read', prompt: 'Review the change you are given for real defects first (wrong behaviour, crashes, missed cases, security), then for broken conventions of this codebase. Cite file:line for each finding and say how sure you are. Do not edit files.' },
  { name: 'builder', engine: 'claude', description: 'Focused implementation of one well-defined piece of a larger task, with its tests.', model: 'sonnet', effort: 'medium', tools: 'all', prompt: 'Make the one change you are given, following this repository\'s instructions and existing patterns. Run the relevant tests. Report what you changed and what you ran.' },
  { name: 'verifier', engine: 'claude', description: 'Runs the checks for a change (tests, typecheck, lint, builds) and reports exactly what passed and failed.', model: 'sonnet', effort: 'low', tools: 'read', prompt: 'Run the checks you are asked to (or the ones this repository uses for the changed files) and report each command with its result. Quote failures exactly. Do not fix anything.' },
  { name: 'codex-reviewer', engine: 'codex', description: 'A second opinion from a different model family (OpenAI\'s, through Codex): reviews a change or PR for defects Claude might miss. Use alongside the reviewer for important changes.', model: '', effort: 'high', tools: 'read', prompt: 'Review the change you are given for real defects first (wrong behaviour, crashes, missed cases, security), then for broken conventions of this codebase. Cite file:line for each finding and say how sure you are. Do not edit files.' },
];

const blank = () => ({ defaults: { model: 'inherit', effort: '' }, work: { model: '', effort: '' }, codex: { model: '', effort: '' }, roster: STARTERS.map(a => ({ ...a })) });

// ---------- checking what's saved ----------

const NAME = /^[a-z][a-z0-9-]{1,39}$/;
function cleanAgent(a) {
  const name = String(a && a.name || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (!NAME.test(name)) throw Object.assign(new Error(`“${name || '(no name)'}” can’t be a subagent’s name: 2–40 lower-case letters, digits or dashes, starting with a letter.`), { status: 400 });
  const description = String(a.description || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!description) throw Object.assign(new Error(`Say what ${name} is for: the chat picks a subagent by that.`), { status: 400 });
  const engine = ENGINES.includes(a.engine) ? a.engine : 'claude';
  const m = String(a.model || '').trim();
  const model = engine === 'claude' ? (MODELS.includes(m) ? m : 'inherit') : (MODEL_ID.test(m) ? m : '');
  const effort = effortsOf(engine).includes(a.effort) ? a.effort : '';
  const tools = Object.hasOwn(TOOLSETS, a.tools) ? a.tools : 'all';
  const prompt = String(a.prompt || '').trim().slice(0, 4000);
  return { name, engine, description, model, effort, tools, prompt };
}
const pickModel = (m, allowEmpty) => (MODELS.includes(m) ? m : allowEmpty ? '' : 'inherit');
const pickEffort = (e, engine = 'claude') => (effortsOf(engine).includes(e) ? e : '');
function clean(v) {
  const b = blank();
  if (!v || typeof v !== 'object') return b;
  const roster = Array.isArray(v.roster) ? v.roster : b.roster;
  const seen = new Set(), out = [];
  for (const a of roster.slice(0, 30)) { try { const c = cleanAgent(a); if (!seen.has(c.name)) { seen.add(c.name); out.push(c); } } catch { /* a bad one is dropped */ } }
  const cm = String(v.codex && v.codex.model || '').trim();
  return {
    defaults: { model: pickModel(v.defaults && v.defaults.model, false), effort: pickEffort(v.defaults && v.defaults.effort) },
    work: { model: pickModel(v.work && v.work.model, true), effort: pickEffort(v.work && v.work.effort) },
    codex: { model: MODEL_ID.test(cm) ? cm : '', effort: pickEffort(v.codex && v.codex.effort, 'codex') },
    roster: out,
  };
}

// ---------- the store ----------

// engines(): how to run Codex and Gemini for a subagent: { codex: { command, home }, gemini: { command } }.
function createSubagents({ file, tmp = os.tmpdir(), log = () => {}, engines = () => ({}) } = {}) {
  let cache = null;
  function get() {
    if (cache) return cache;
    try { cache = clean(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { cache = blank(); }
    return cache;
  }
  function save(next) {
    // Names must be unique: two with one name is a mistake, not something to drop quietly.
    const names = (next.roster || []).map(a => String(a && a.name || '').trim().toLowerCase());
    const dup = names.find((n, i) => n && names.indexOf(n) !== i);
    if (dup) throw Object.assign(new Error(`Two subagents are called “${dup}”.`), { status: 400 });
    for (const a of next.roster || []) cleanAgent(a);   // (says what's wrong with one, rather than dropping it)
    const v = clean(next);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(v, null, 2)); fs.renameSync(`${file}.tmp`, file);
    cache = v;
    return v;
  }

  // The environment a Claude chat starts with: its subagents' default model and effort. work: a chat started from
  // Your work, which uses Your work's choice where there is one.
  function envFor({ work = false } = {}) {
    const v = get(), env = {};
    const model = (work && v.work.model) || v.defaults.model;
    const effort = (work && v.work.effort) || v.defaults.effort;
    if (model && model !== 'inherit') env.CLAUDE_CODE_SUBAGENT_MODEL = model;
    if (effort) env.CLAUDE_CODE_SUBAGENT_EFFORT = effort;
    return env;
  }

  // The plugin every Claude chat gets (and the Codex role files): written again only when something changes. Its
  // folder is named for what's in it, so a chat that's running keeps the files it started with.
  function pluginDir() {
    const files = pluginFiles(get(), engines(), DIR_MARK);
    const id = crypto.createHash('sha1').update(JSON.stringify(files)).digest('hex').slice(0, 10);
    const dir = path.join(tmp, 'claude-switcher', `subagents-${id}`);
    const at = dir.replace(/\\/g, '/');
    try {
      for (const [rel, raw] of Object.entries(files)) {
        const text = raw.split(DIR_MARK).join(at);
        const f = path.join(dir, rel);
        if (fs.existsSync(f) && fs.readFileSync(f, 'utf8') === text) continue;
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, text);
      }
    } catch (err) { log(`Subagents: couldn’t write the plugin (${err.message})`); return null; }
    return dir;
  }

  // What a Codex chat's thread starts with: { config, note }. config gives Codex its agent roles (the Codex subagents,
  // each pointing at its role file); note tells it about them and about the defaults ('' when there's nothing to say).
  function codexThread() {
    const v = get(), mine = v.roster.filter(a => a.engine === 'codex');
    const dir = mine.length ? pluginDir() : null;
    const config = {};
    if (dir) for (const a of mine) { config[`agents.${a.name}.description`] = a.description; config[`agents.${a.name}.config_file`] = path.join(dir, 'codex', `${a.name}.toml`).replace(/\\/g, '/'); }
    return { config: dir ? config : {}, note: codexNote(v, dir ? mine : []) };
  }
  return { get, save, envFor, pluginDir, codexThread, file };
}
const DIR_MARK = '\u0000PLUGIN_DIR\u0000';

// ---------- what Claude Code reads ----------

const yamlStr = s => JSON.stringify(String(s));   // a YAML double-quoted string is JSON's
const label = a => `${a.engine === 'claude' ? MODEL_LABEL[a.model] || a.model : `${ENGINE_LABEL[a.engine]} ${a.model || '(its default model)'}`}${a.effort ? `, ${a.effort} effort` : ''}`;
function agentFile(a) {
  if (a.engine !== 'claude') return relayAgentFile(a);
  const tools = TOOLSETS[a.tools];
  return ['---', `name: ${a.name}`, `description: ${yamlStr(a.description)}`, ...(a.model && a.model !== 'inherit' ? [`model: ${a.model}`] : []), ...(a.effort ? [`effort: ${a.effort}`] : []), ...(tools ? [`tools: ${tools.join(', ')}`] : []), '---', '', a.prompt || a.description, ''].join('\n');
}
// A Codex or Gemini subagent, as seen by Claude: a light Claude agent that hands the task over and brings back the
// answer. It runs on Haiku, low effort: it only passes the task on.
function relayAgentFile(a) {
  const who = ENGINE_LABEL[a.engine];
  return ['---', `name: ${a.name}`, `description: ${yamlStr(`${a.description} (Runs on ${label(a)}.)`)}`, 'model: haiku', 'effort: low', 'tools: Write, Bash, Read', '---', '',
    `You hand a task to ${label(a)} and bring back its answer. Do not do the task yourself.`,
    '',
    '1. Write the complete task you were given, with every detail and file path it needs, to a new text file in the system temp folder using the Write tool (a name like ' + `${a.name}-task-<random>.md` + ').',
    `2. Run it with Bash (allow up to 20 minutes: timeout 1200000): node "${DIR_MARK}/relay.js" ${a.name} "<that file's full path>"`,
    `3. Reply with ${who}'s answer exactly as it came back. If the command failed, say so and quote its error.`,
    ''].join('\n');
}
function skillFile(v) {
  const roster = v.roster.length ? v.roster.map(a => `- \`${PLUGIN}:${a.name}\` (${label(a)}${a.tools === 'read' ? ', reads only' : ''}): ${a.description}`).join('\n') : '- (none: the user removed them all)';
  const d = v.defaults;
  return `---
name: subagent-models
description: Choose the assistant, model and reasoning effort for each subagent you start. Use whenever you delegate to a subagent (the Agent tool), and whenever the user names a model, effort or assistant for subagents ("use haiku for searches", "have Codex review it", "reviewers on opus, high").
---

# Subagent models and effort

The user set these up in Session Switcher. This skill is their explicit instruction about subagent models and effort, so follow it when you call the Agent tool.

## The user's subagents

${roster}

Pick the one whose purpose fits the job and use its agent type. Each already runs on the assistant, model and effort listed, so don't pass \`model\` or \`effort\` for them unless the user asks for something else. The Codex and Gemini ones hand the job to that assistant and return its answer: use them when the user asks for Codex or Gemini, or for a second opinion from another model family.

## Any other subagent

Subagents not listed above (Explore, general-purpose, Plan, a project's own) run on ${d.model && d.model !== 'inherit' ? MODEL_LABEL[d.model] : 'the chat’s own model'}${d.effort ? ` at ${d.effort} effort` : ''} unless a call says otherwise.

## When the user asks

When the user names a model or effort for subagents, in this chat or for one job ("do the searches on haiku, low effort", "review it with opus at max"), pass that on each matching Agent call: \`model\` is one of fable, opus, sonnet or haiku, and \`effort\` one of low, medium, high, xhigh or max. Keep using it for the rest of the chat unless they change it, and say once which model and effort you used.

Match the model to the work when the user leaves it to you: quick look-ups need little; careful review, hard debugging and design need more. A cheaper subagent that has to be redone costs more than a stronger one used once.
`;
}

// ---------- what Codex reads ----------

const tomlStr = s => JSON.stringify(String(s));   // a TOML basic string takes JSON's escapes
function codexRoleFile(a) {
  return [`# Session Switcher: the ${a.name} subagent (Your subagents)`,
    ...(a.model ? [`model = ${tomlStr(a.model)}`] : []),
    ...(a.effort ? [`model_reasoning_effort = ${tomlStr(a.effort)}`] : []),
    `sandbox_mode = ${tomlStr(a.tools === 'read' ? 'read-only' : 'workspace-write')}`,
    `developer_instructions = ${tomlStr(`${a.prompt || a.description}${a.tools === 'read' ? '\n\nYou only read: never change files.' : ''}`)}`, ''].join('\n');
}
function codexNote(v, mine) {
  const d = v.codex;
  if (!mine.length && !d.model && !d.effort) return '';
  const lines = ['Sub-agents (the user set these up in Session Switcher): you may use spawn_agent when the user asks for sub-agents, delegation or parallel work, and when a well-scoped part of the job clearly fits one of the roles below.'];
  if (mine.length) lines.push('Roles (pass the name as agent_type; each already has its own model and reasoning effort):', ...mine.map(a => `- ${a.name} (${a.model || 'your model'}${a.effort ? `, ${a.effort} effort` : ''}${a.tools === 'read' ? ', reads only' : ''}): ${a.description}`));
  if (d.model || d.effort) lines.push(`For any other sub-agent, set ${[d.model ? `model to ${d.model}` : '', d.effort ? `reasoning_effort to ${d.effort}` : ''].filter(Boolean).join(' and ')} unless the user asks for something else.`);
  lines.push('When the user names a model or reasoning effort for sub-agents, pass it as model and reasoning_effort on each matching spawn_agent call.');
  return lines.join('\n');
}

// ---------- the relay (Codex and Gemini subagents in Claude chats) ----------

// relay.js <name> <task file>: runs that subagent's assistant with the task and prints its final answer.
const RELAY = `'use strict';
// Session Switcher: hands a task to Codex or Gemini for one of your subagents, and prints the answer.
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const [name, taskFile] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'relay.json'), 'utf8'));
const a = cfg.agents[name];
if (!a) { console.error('No subagent called ' + name + '.'); process.exit(2); }
let task; try { task = fs.readFileSync(taskFile, 'utf8'); } catch (e) { console.error('Can\\'t read the task file: ' + e.message); process.exit(2); }
const win = process.platform === 'win32';
const q = s => (win ? '"' + String(s).replace(/"/g, '') + '"' : "'" + String(s).replace(/'/g, "'\\\\''") + "'");
function run(cmd, args, opts) {
  return new Promise(resolve => {
    const line = [q(cmd), ...args.map(q)].join(' ');
    // A program (.exe) runs as it is; a .cmd launcher (npm's codex.cmd) needs cmd.exe.
    const p = win && /\\.exe$/i.test(cmd) ? spawn(cmd, args, { ...opts, windowsHide: true })
      : win ? spawn('cmd.exe', ['/d', '/s', '/c', '"' + line + '"'], { ...opts, windowsVerbatimArguments: true, windowsHide: true }) : spawn('sh', ['-c', line], opts);
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    if (opts.input != null) { p.stdin.end(opts.input); } else p.stdin.end();
    const t = setTimeout(() => { try { p.kill(); } catch {} }, 20 * 60000);
    p.on('close', code => { clearTimeout(t); resolve({ code, out, err }); });
    p.on('error', e => { clearTimeout(t); resolve({ code: -1, out, err: e.message }); });
  });
}
(async () => {
  if (a.engine === 'codex') {
    const c = cfg.codex || {};
    const last = path.join(os.tmpdir(), 'ss-relay-' + process.pid + '-' + Date.now() + '.txt');
    const env = { ...process.env }; if (c.home) env.CODEX_HOME = c.home;
    const args = ['exec', '--ephemeral', '--skip-git-repo-check', '-s', a.tools === 'read' ? 'read-only' : 'workspace-write', ...(a.model ? ['-m', a.model] : []), ...(a.effort ? ['-c', 'model_reasoning_effort=' + a.effort] : []), '-o', last, '-'];
    const prompt = (a.prompt ? a.prompt + '\\n\\n' : '') + task;
    const r = await run(c.command || 'codex', args, { cwd: process.cwd(), env, input: prompt });
    let answer = ''; try { answer = fs.readFileSync(last, 'utf8'); fs.unlinkSync(last); } catch {}
    if (answer.trim()) { process.stdout.write(answer.trim() + '\\n'); process.exit(0); }
    console.error('Codex gave no answer (exit ' + r.code + ').\\n' + (r.err || r.out).slice(-3000)); process.exit(1);
  }
  if (a.engine === 'gemini') {
    const g = cfg.gemini || {};
    const ask = (a.prompt ? a.prompt + ' ' : '') + 'Do the task written in this file, then give your answer: ' + taskFile;
    const args = ['-p', ask, '--output-format', 'text', '--mode', a.tools === 'read' ? 'plan' : 'accept-edits', ...(a.model ? ['--model', a.model] : []), ...(a.effort ? ['--effort', a.effort] : [])];
    // agy keeps each run as a conversation (it would show up in your chat list): the one this run made is removed
    // afterwards, and the folder's "last conversation" goes back to what it was.
    const home = path.join(os.homedir(), '.gemini', 'antigravity-cli'), cacheFile = path.join(home, 'cache', 'last_conversations.json');
    let before = null; try { before = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
    const t0 = Date.now() - 2000;
    const r = await run(g.command || 'agy', args, { cwd: process.cwd(), env: process.env, input: null });
    try {
      const dir = path.join(home, 'conversations');
      for (const f of fs.readdirSync(dir).filter(x => /\\.db$/.test(x))) {
        const full = path.join(dir, f);
        if (fs.statSync(full).birthtimeMs < t0) continue;
        if (!fs.readFileSync(full).includes(Buffer.from(taskFile))) continue;
        const cid = f.slice(0, -3);
        for (const x of fs.readdirSync(dir).filter(y => y.startsWith(cid + '.db'))) fs.rmSync(path.join(dir, x), { force: true });
        fs.rmSync(path.join(home, 'brain', cid), { recursive: true, force: true });
        fs.rmSync(path.join(home, 'annotations', cid + '.pbtxt'), { force: true });
        const now = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        for (const [k, v] of Object.entries(now)) if (v === cid) { if (before && before[k]) now[k] = before[k]; else delete now[k]; }
        fs.writeFileSync(cacheFile, JSON.stringify(now, null, 2) + '\\n');
      }
    } catch {}
    if (r.code === 0 && r.out.trim()) { process.stdout.write(r.out.trim() + '\\n'); process.exit(0); }
    console.error('Gemini gave no answer (exit ' + r.code + ').\\n' + (r.err || r.out).slice(-3000)); process.exit(1);
  }
  console.error('Not a Codex or Gemini subagent.'); process.exit(2);
})();
`;

function pluginFiles(v, engines = {}, dirMark = DIR_MARK) {
  const files = {
    '.claude-plugin/plugin.json': JSON.stringify({ name: PLUGIN, version: '1.0.0', description: 'Session Switcher: your subagents, with their assistants, models and effort, and how to assign them.' }, null, 2) + '\n',
    'skills/subagent-models/SKILL.md': skillFile(v),
  };
  for (const a of v.roster) files[`agents/${a.name}.md`] = agentFile(a).split(DIR_MARK).join(dirMark);
  const relayed = v.roster.filter(a => a.engine !== 'claude');
  if (relayed.length) {
    files['relay.js'] = RELAY;
    files['relay.json'] = JSON.stringify({ codex: engines.codex || {}, gemini: engines.gemini || {}, agents: Object.fromEntries(relayed.map(a => [a.name, { engine: a.engine, model: a.model, effort: a.effort, tools: a.tools, prompt: a.prompt }])) }, null, 2) + '\n';
  }
  for (const a of v.roster.filter(x => x.engine === 'codex')) files[`codex/${a.name}.toml`] = codexRoleFile(a);
  return files;
}

module.exports = { createSubagents, clean, cleanAgent, agentFile, skillFile, pluginFiles, codexRoleFile, codexNote, ENGINES, ENGINE_LABEL, MODELS, MODEL_LABEL, EFFORTS, CODEX_EFFORTS, TOOLSETS, STARTERS, PLUGIN };
