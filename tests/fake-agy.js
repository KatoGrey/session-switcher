'use strict';
// A stand-in for Google's `agy` in its streaming mode, for tests: it reads one message per line and
// answers the way the real one does (recorded from agy 1.3.5). A message containing "write" makes it
// write a file; "run" makes it try a command, refused unless it was started with full access.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const args = process.argv.slice(2);
// Its other two answers: who it is, and which models it has (how the app knows it's signed in).
if (args[0] === '--version') { console.log('1.3.5'); process.exit(0); }
if (args[0] === 'models') { console.log('gemini-4-argon-medium\tGemini 4 Argon (Medium)\ngemini-4-argon-high\tGemini 4 Argon (High)'); process.exit(0); }
if (args[0] === 'mcp' && args[1] === 'add') {
  const file = path.join(require('os').homedir(), '.gemini', 'config', 'mcp_config.json');
  let j = { mcpServers: {} };
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none yet */ }
  const rest = args.slice(2), spec = { disabled: false };
  while (rest[0] === '--env' || rest[0] === '--header') {
    const flag = rest.shift(), v = rest.shift();
    if (flag === '--env') (spec.env = spec.env || {})[v.slice(0, v.indexOf('='))] = v.slice(v.indexOf('=') + 1);
    else (spec.headers = spec.headers || {})[v.slice(0, v.indexOf(':'))] = v.slice(v.indexOf(':') + 1).trim();
  }
  const name = rest.shift();
  if (rest[0] === '--') rest.shift();
  if (/^https?:/.test(rest[0])) spec.serverUrl = rest[0]; else { spec.command = rest[0]; spec.args = rest.slice(1); }
  j.mcpServers[name] = spec;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(j, null, 2));
  console.log(`Added MCP server "${name}" (${spec.serverUrl ? 'http' : 'stdio'})`);
  process.exit(0);
}
// In the pretend computer (tests/fake-world.js) each new chat is its own conversation, kept where the real one keeps it.
const inWorld = !!process.env.FAKE_AGY_WORLD;
const conv = (args[args.indexOf('--conversation') + 1] && args.includes('--conversation')) ? args[args.indexOf('--conversation') + 1] : inWorld ? require('crypto').randomUUID() : 'conv-1234-5678';
const keep = o => {
  if (!inWorld) return;
  const dir = path.join(require('os').homedir(), '.gemini', 'antigravity-cli', 'brain', conv, '.system_generated', 'logs');
  try { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, 'transcript.jsonl'), `${JSON.stringify({ created_at: new Date().toISOString(), ...o })}\n`); } catch { /* it's only a record */ }
};
const full = args.includes('--dangerously-skip-permissions');
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'gemini-4-argon-medium';
const out = o => process.stdout.write(`${JSON.stringify(o)}\n`);
let step = 0;
out({ event: 'init', conversation_id: conv, init: { model, cwd: process.cwd(), tools: ['run_command', 'write_to_file'], permission_mode: full ? 'always-proceed' : 'request-review' } });
const su = o => out({ event: 'step_update', step_update: { conversation_id: conv, ...o } });
readline.createInterface({ input: process.stdin }).on('line', line => {
  const msg = JSON.parse(line);
  const text = typeof msg.message.content === 'string' ? msg.message.content : msg.message.content.map(c => c.text).join('');
  su({ step_index: step++, state: 'DONE', step_type: 'user_input' });
  keep({ type: 'USER_INPUT', content: text });
  if (/slow/.test(text)) { su({ step_index: step++, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Working on it' }); return; }   // never finishes (for Stop)
  if (/quota/.test(text)) { out({ event: 'result', result: { conversation_id: conv, status: 'ERROR', error: 'RESOURCE_EXHAUSTED: You have exhausted your capacity on this model. Your quota will reset after 2h30m0s.', num_turns: 1 } }); return; }
  if (/write/.test(text)) {
    const i = step++;
    const target = path.join(process.cwd(), 'note.txt');
    su({ step_index: i, state: 'ACTIVE', step_type: 'tool', tool_name: 'write_to_file', tool_info: { name: 'write_to_file', parameters: { TargetFile: target } } });
    fs.writeFileSync(target, 'written by argon\n');
    su({ step_index: i, state: 'DONE', step_type: 'tool', tool_name: 'write_to_file', tool_info: { name: 'write_to_file', parameters: { TargetFile: target } } });
  }
  if (/run/.test(text)) {
    const i = step++;
    const p = { CommandLine: 'node --version' };
    su({ step_index: i, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: p } });
    if (full) su({ step_index: i, state: 'DONE', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: p, output: 'v24.0.0\r\n' } });
    else {
      su({ step_index: i, state: 'ERROR', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: p, error: { type: 'TOOL_ERROR', message: 'permission check failed for command "node --version": user denied permission to run command:\nnode --version\nDo not attempt to circumvent this denial.' } } });
      process.stderr.write('jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.\n');
    }
  }
  const r = step++;
  su({ step_index: r, state: 'ACTIVE', step_type: 'agent_response', text_delta: `Echo: ${text}` });
  su({ step_index: r, state: 'DONE', step_type: 'agent_response', text_delta: '\n', usage: { input_tokens: 100, output_tokens: 7, cache_read_tokens: 20, total_tokens: 107 } });
  out({ event: 'result', result: { conversation_id: conv, status: 'SUCCESS', response: `Echo: ${text}\n`, num_turns: 1, usage: { input_tokens: 100, output_tokens: 7, cache_read_tokens: 20, total_tokens: 107 } } });
});
