'use strict';
// A stand-in for `claude` (tests/fake-world.js): answers who it is, and in its streaming mode replies to each message
// and writes the transcript where the real one does. Never touches the network. A message with RUN OUT in it, to any
// account but the second, is refused for usage.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), readline = require('readline');
const args = process.argv.slice(2);
if (args[0] === '--version' || args[0] === '-v') { console.log('2.1.99 (Claude Code)'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'tester@example.com', orgName: 'Test Org', orgId: 'org-1', subscriptionType: 'max' })); process.exit(0); }
if (args[0] === 'auth' || args[0] === 'mcp' || args[0] === 'update' || args[0] === 'plugin') { console.log('{}'); process.exit(0); }
if (args.includes('-p') || args.includes('--print')) {
  if (args.includes('--output-format') && args[args.indexOf('--output-format') + 1] === 'text') { console.log('A short name'); process.exit(0); }
  console.log(JSON.stringify({ type: 'result', subtype: 'success', result: 'ok', session_id: crypto.randomUUID() }));
  process.exit(0);
}
const val = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const session = val('--resume') || val('--session-id') || crypto.randomUUID();
const out = o => process.stdout.write(`${JSON.stringify(o)}\n`);
const cwd = process.cwd();
const dir = path.join(os.homedir(), '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
const file = path.join(dir, `${session}.jsonl`);
const write = o => { try { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(file, `${JSON.stringify({ sessionId: session, cwd, timestamp: new Date().toISOString(), uuid: crypto.randomUUID(), ...o })}\n`); } catch { /* fine */ } };
readline.createInterface({ input: process.stdin }).on('line', line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.type === 'control_request') {
    const r = m.request || {};
    const response = r.subtype === 'initialize' ? { commands: [{ name: 'compact', description: 'Compact', argumentHint: '' }], models: [{ value: 'default', displayName: 'Default', description: 'The default' }, { value: 'opus', displayName: 'Opus', description: 'Complex work' }, { value: 'sonnet', displayName: 'Sonnet', description: 'Everyday' }, { value: 'fable', displayName: 'Fable', description: 'Toughest' }, { value: 'haiku', displayName: 'Haiku', description: 'Fast' }], account: { email: 'tester@example.com' } } : {};
    return out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response } });
  }
  if (m.type === 'control_response') return undefined;
  if (m.type !== 'user') return undefined;
  const content = m.message && m.message.content;
  const text = typeof content === 'string' ? content : (content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  write({ type: 'user', message: { role: 'user', content: text } });
  out({ type: 'system', subtype: 'init', session_id: session, cwd, model: 'claude-fake', tools: ['Edit', 'Read', 'Bash'], mcp_servers: [], slash_commands: ['compact'], permissionMode: val('--permission-mode') || 'default', apiKeySource: 'none' });
  if (/RUN OUT/.test(text) && !/claude-two/.test(process.env.CLAUDE_CONFIG_DIR || '')) {
    out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: Math.floor(Date.now() / 1000) + 3 * 3600, utilization: 1 } });
    out({ type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 5, num_turns: 1, result: 'limit reached', session_id: session, errors: ['limit reached'] });
    return undefined;
  }
  const id = `msg_${crypto.randomBytes(6).toString('hex')}`;
  const message = { id, role: 'assistant', model: 'claude-fake', content: [{ type: 'text', text: `Fake reply to: ${text.slice(-200)}` }], usage: { input_tokens: 10, output_tokens: 5 } };
  write({ type: 'assistant', message });
  out({ type: 'assistant', message, session_id: session });
  out({ type: 'result', subtype: 'success', is_error: false, duration_ms: 5, num_turns: 1, result: 'ok', session_id: session, usage: { input_tokens: 10, output_tokens: 5 } });
  return undefined;
}).on('close', () => process.exit(0));
