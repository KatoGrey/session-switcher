'use strict';
// One decision control (ui/decision.js) on the PC's side: an answer goes to exactly the request it was
// drawn for, never to whichever is waiting now, and the hub and the phone get the same facts the chat's
// card shows (why it's asking, a path outside the project, what Always allow covers, the safe default).
const test = require('node:test');
const assert = require('node:assert/strict');
const { LiveChat, alwaysScope, waitingRequest } = require('../lib/chat');

function claude() {
  const chat = new LiveChat({ cfg: {}, account: { id: 'a', name: 'A' }, cwd: process.cwd(), log: () => {} });
  const wrote = [], shown = [];
  chat.write = o => wrote.push(o);
  chat.emit = e => shown.push(e);
  chat.setState = () => {};
  return { chat, wrote, shown };
}
const ask = (chat, id, extra = {}) => chat.handleControl({ request_id: id, request: { subtype: 'can_use_tool', tool_name: 'Bash', tool_use_id: `t${id}`, input: { command: 'npm test', description: 'Run the tests' }, ...extra } });
const stale = e => e.status === 409 && e.reason === 'answered' && /already answered/i.test(e.message);

test('an answer for a request that’s gone says “already answered”, and the one waiting now is left alone', () => {
  const { chat, wrote, shown } = claude();
  ask(chat, 'r1'); ask(chat, 'r2');
  chat.answer('r1', { decision: 'allow' });
  assert.equal(wrote.length, 1);
  assert.equal(wrote[0].response.request_id, 'r1');
  shown.length = 0;
  assert.throws(() => chat.answer('r1', { decision: 'allow' }), stale, 'r1 was answered already');
  assert.throws(() => chat.answer('', { decision: 'deny' }), stale, 'no id is never “the first one”');
  assert.equal(wrote.length, 1, 'nothing more went to Claude Code');
  assert.deepEqual([...chat.pending.keys()], ['r2'], 'the next request is still waiting');
  assert.equal(shown.length, 0, 'and nothing was said to the page');
});

test('Codex and Gemini say the same for a request that’s gone, and touch nothing', () => {
  const { CodexChat } = require('../lib/codex');
  const { GeminiChat } = require('../lib/gemini');
  for (const Chat of [CodexChat, GeminiChat]) {
    const responded = [], said = [];
    const live = { method: 'item/commandExecution/requestApproval', rawId: 7, params: {}, event: { questions: null }, cmds: ['npm test'] };
    const fake = { pending: new Map([['live', live]]), srv: { respond: (...a) => responded.push(a) }, emit: e => said.push(e), setState() {}, send() { said.push('send'); }, quiet() {}, setMode() {} };
    assert.throws(() => Chat.prototype.answer.call(fake, 'gone', { decision: 'allow' }), stale, Chat.name);
    assert.deepEqual(responded, [], `${Chat.name}: nothing answered`);
    assert.deepEqual(said, [], `${Chat.name}: nothing said`);
    assert.ok(fake.pending.has('live'), `${Chat.name}: the waiting one stays`);
  }
  assert.equal(waitingRequest(new Map([['5', 'x']]), 5), 'x', 'ids are compared as text (Codex’s are numbers)');
});

test('answers only go to a question: on an approval they’d change what runs', () => {
  const { chat, wrote } = claude();
  ask(chat, 'r1');
  assert.throws(() => chat.answer('r1', { decision: 'allow', answers: { 'Which one?': 'A' } }), e => e.status === 400);
  assert.equal(wrote.length, 0);
  assert.ok(chat.pending.has('r1'));
  chat.handleControl({ request_id: 'q1', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', tool_use_id: 'tq', input: { questions: [{ question: 'Which one?', header: 'Pick', options: [{ label: 'A' }, { label: 'B' }] }] } } });
  chat.answer('q1', { decision: 'allow', answers: { 'Which one?': 'B' } });
  assert.deepEqual(wrote[0].response.response.updatedInput.answers, { 'Which one?': 'B' });
});

test('Deny with a note tells Claude what to do instead', () => {
  const { chat, wrote } = claude();
  ask(chat, 'r1');
  chat.answer('r1', { decision: 'deny', message: 'Use the dry run instead.' });
  assert.equal(wrote[0].response.response.behavior, 'deny');
  assert.equal(wrote[0].response.response.message, 'Use the dry run instead.');
});

test('the hub gets what the chat’s card shows: why, the path, what Always covers, the safe default, the question', () => {
  const { chat, shown } = claude();
  ask(chat, 'r1', { decision_reason: 'It reaches outside the project.', blocked_path: 'D:\\Elsewhere\\notes.txt', default_to_no: true, permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' }] });
  chat.handleControl({ request_id: 'q1', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', tool_use_id: 'tq', input: { questions: [{ question: 'Which save format?', header: 'Format', multiSelect: false, options: [{ label: 'JSON', description: 'Readable' }, { label: 'Binary' }] }] } } });
  const card = shown.find(e => e.kind === 'permission' && e.requestId === 'r1');
  assert.equal(card.alwaysScope, 'commands that start with “npm test” in this project', 'the chat’s card says it too');
  const [p, q] = chat.summary().pending;
  assert.equal(p.requestId, 'r1');
  assert.equal(p.reason, 'It reaches outside the project.');
  assert.equal(p.blockedPath, 'D:\\Elsewhere\\notes.txt');
  assert.equal(p.defaultToNo, true);
  assert.equal(p.canAlways, true);
  assert.equal(p.alwaysScope, 'commands that start with “npm test” in this project');
  assert.equal(p.detail, 'npm test');
  assert.equal(q.question, true);
  assert.deepEqual(q.questions, [{ question: 'Which save format?', header: 'Format', multiSelect: false, options: [{ label: 'JSON', description: 'Readable' }, { label: 'Binary', description: '' }] }]);
  assert.equal(q.alwaysScope, null, 'a question has no Always');
});

test('Always allow, in words', () => {
  const rules = (destination, ...list) => [{ type: 'addRules', rules: list, behavior: 'allow', destination }];
  assert.equal(alwaysScope(rules('localSettings', { toolName: 'Bash', ruleContent: 'npm test:*' })), 'commands that start with “npm test” in this project');
  assert.equal(alwaysScope(rules('userSettings', { toolName: 'Bash', ruleContent: 'git status' })), 'the command “git status” in all your projects');
  assert.equal(alwaysScope(rules('session', { toolName: 'Bash' })), 'any command for the rest of this chat');
  assert.equal(alwaysScope(rules('projectSettings', { toolName: 'WebFetch', ruleContent: 'domain:example.com' }, { toolName: 'mcp__latitude__run' })), 'opening pages on example.com and latitude’s “run” tool in this project, for everyone who works on it');
  assert.equal(alwaysScope([{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]), 'file edits without asking for the rest of this chat');
  assert.equal(alwaysScope([{ type: 'addDirectories', directories: ['D:\\Art'], destination: 'session' }]), 'working in “D:\\Art” for the rest of this chat');
  assert.equal(alwaysScope([{ type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'deny', destination: 'session' }]), null, 'a rule that blocks isn’t what Always allows');
  assert.equal(alwaysScope([]), null);
  assert.equal(alwaysScope(null), null);
});

test('Always only saves rules when Claude Code offered it for that request', () => {
  const { chat, wrote } = claude();
  const rules = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' }];
  chat.handleControl({ request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Bash', tool_use_id: 't1', input: { command: 'npm test' }, permission_suggestions: rules, suppress_always_allow_rule: true } });
  chat.answer('r1', { decision: 'always' });
  assert.equal(wrote[0].response.response.behavior, 'allow');
  assert.equal(wrote[0].response.response.updatedPermissions, undefined, 'suppressed: allowed once, no rules saved');
  chat.handleControl({ request_id: 'r2', request: { subtype: 'can_use_tool', tool_name: 'Bash', tool_use_id: 't2', input: { command: 'npm test' }, permission_suggestions: rules } });
  chat.answer('r2', { decision: 'always' });
  assert.deepEqual(wrote[1].response.response.updatedPermissions, rules, 'offered: the rules are saved');
});
