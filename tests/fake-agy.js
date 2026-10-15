'use strict';
// A stand-in for Google's `agy` in its streaming mode, for tests: it reads one message per line and
// answers the way the real one does (recorded from agy 1.3.5). A message containing "write" makes it
// write a file; "run" makes it try a command, refused unless it was started with full access.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const args = process.argv.slice(2);
const conv = (args[args.indexOf('--conversation') + 1] && args.includes('--conversation')) ? args[args.indexOf('--conversation') + 1] : 'conv-1234-5678';
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
  if (/slow/.test(text)) { su({ step_index: step++, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Working on it' }); return; }   // never finishes (for Stop)
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
