#!/usr/bin/env node
// Hands a gathering task to a small model on Ollama (GLM 5.3 Flash by default), run through Claude
// Code so it has the same MCP tools (Latitude's slack, discord, linear, github…) as your Claude
// chats. It's for reading and summarising, not judging: the chat that calls it makes the calls.
//
//   node bin/switcher-glm.js --cd ~/Repos/GitHub/latitude "Read the last 3 days of … and report …"
//   node bin/switcher-glm.js --resume <session id> "Dig into the second one: is there a PR?"
//
// Options: --model (default glm-5.3-flash:cloud), --cd (the folder it works in; default here),
// --resume (a session id this printed before, to ask the same agent a follow-up), --tools (the
// tools it may use; default mcp__latitude__run,Read,Grep,Glob — no shell, no edits, and only the
// Latitude tools that read: see readonly-guard.js), --parent (the
// chat to file it under in Switcher; default the calling Claude chat).
// Prints the model's final message on stdout; the session id and progress go to stderr.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const cp = require('child_process');
const crypto = require('crypto');
const guard = require('./readonly-guard');

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(`--${name}`); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const model = opt('model', 'glm-5.3-flash:cloud');
const cwd = path.resolve(opt('cd', '.'));
const resume = opt('resume', null);
const tools = opt('tools', 'mcp__latitude__run,Read,Grep,Glob');
const parent = opt('parent', process.env.CLAUDE_CODE_SESSION_ID || null);
const port = Number(opt('port', process.env.SWITCHER_PORT || 4777));
const ollama = process.env.OLLAMA_HOST ? `http://${process.env.OLLAMA_HOST.replace(/^https?:\/\//, '')}` : 'http://127.0.0.1:11434';
let task = args.join(' ').trim();
if (!task && !process.stdin.isTTY) task = fs.readFileSync(0, 'utf8').trim();
if (!task) { console.error('Usage: switcher-glm.js [--cd folder] [--resume id] [--model glm-5.3-flash:cloud] "the task"'); process.exit(2); }

// Switcher's API, with the token from its lock file (the same way switcher-codex finds plans).
function api(p, body) {
  return new Promise(resolve => {
    let lock;
    try { lock = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `session-switcher-${port}.json`), 'utf8')); } catch { return resolve(null); }
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port, path: p, method: data ? 'POST' : 'GET', timeout: 15000,
      headers: { Host: `127.0.0.1:${port}`, 'X-Switcher-Token': lock.token, ...(data ? { 'Content-Type': 'application/json' } : {}) } }, res => {
      let s = ''; res.setEncoding('utf8'); res.on('data', d => { s += d; });
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(s) }); } catch { resolve({ status: res.statusCode, json: null }); } });
    });
    req.on('timeout', () => req.destroy()); req.on('error', () => resolve(null)); req.end(data || undefined);
  });
}

// Files the run under the chat that asked for it, once Switcher has noticed it (a few seconds).
async function fileUnder(id) {
  if (!parent || parent === id) return;
  for (let i = 0; i < 8; i++) {
    const r = await api('/api/lite/parent', { id, parent });
    if (r && r.status === 200) return;
    if (!r) return;
    await new Promise(ok => setTimeout(ok, 2500));
  }
}

(async () => {
  // Run as Claude Code on Ollama, not as whatever chat called this: drop the caller's Claude
  // settings (its account, proxy and config folder) so the main config, with its MCP servers, loads.
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_CONFIG_DIR$|CLAUDECODE$)/.test(k)) delete env[k];
  env.ANTHROPIC_BASE_URL = ollama;
  env.ANTHROPIC_AUTH_TOKEN = 'ollama';
  const id = resume || crypto.randomUUID();
  process.stderr.write(`[switcher-glm] ${model} on Ollama, in ${cwd}, tools ${tools}\n[switcher-glm] session ${id} (ask a follow-up with --resume ${id})\n`);
  const p = cp.spawn('claude', ['-p', '--model', model, '--output-format', 'json', ...(resume ? ['--resume', resume] : ['--session-id', id]),
    // Read-only toward Slack, Discord, Linear and GitHub too: a hook refuses Latitude tools that write.
    '--settings', guard.settingsFor(),
    '--allowedTools', tools, '--disallowedTools', 'Bash,Edit,Write,NotebookEdit,WebFetch'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  p.stdin.end(task); // on stdin: the tool lists above take every argument after them
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { if (!/connectors are disabled|unrecognized_model|Advisor disabled/.test(String(d))) process.stderr.write(d); });
  p.on('close', async code => {
    let j = null; try { j = JSON.parse(out); } catch { /* not JSON: print as is */ }
    process.stdout.write(`${(j ? j.result || '' : out).trim()}\n`);
    if (j) {
      const u = j.usage || {};
      // SWITCHER_GLM_USAGE_LOG: append each run's token use (one JSON line) for cost tracking.
      if (process.env.SWITCHER_GLM_USAGE_LOG) { try { fs.appendFileSync(process.env.SWITCHER_GLM_USAGE_LOG, `${JSON.stringify({ at: Date.now(), session: id, model, resumed: !!resume, turns: j.num_turns || 0, usage: u, ms: j.duration_ms || null })}\n`); } catch { /* best effort */ } }
      process.stderr.write(`[switcher-glm] ${j.num_turns || 0} turns${j.is_error ? ', ended with an error' : ''}; tokens in ${(u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)} (cached ${u.cache_read_input_tokens || 0}), out ${u.output_tokens || 0}\n`);
    }
    if (!resume) await fileUnder(id);
    process.exit(code || (j && j.is_error ? 1 : 0));
  });
})();
