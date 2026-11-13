'use strict';
// Latitude tool calls that only read go ahead without asking; anything else still asks (lib/mcpsafe.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../lib/mcpsafe');

const read = (category, tool, name = 'mcp__latitude__run') => m.classify(name, { category, tool, params: {} }).read;

test('the look-ups chats really make go ahead: Athena, Postgres (read-only), Datadog, Sentry, GitHub reads', () => {
  for (const [c, t] of [['athena', 'query'], ['postgres', 'query'], ['datadog', 'search-logs'], ['datadog', 'search-traces'], ['sentry', 'list-projects'], ['sentry', 'get-event'], ['sentry', 'list-replays'], ['github', 'list-open-prs'], ['github', 'get-run'], ['github', 'get-pr-failed-logs'], ['github', 'check-pr-readiness'], ['linear', 'getIssue']]) assert.equal(read(c, t), true, `${c}/${t}`);
  assert.equal(read('datadog', 'search-logs', 'mcp__latitude-remote__run'), true, 'under either server name');
});

test('anything that changes, sends, runs or costs still asks, and so do the categories that always ask', () => {
  for (const [c, t] of [['github', 'trigger-workflow'], ['github', 'rerun-pr-checks'], ['github', 'create-pr'], ['github', 'create-commit-and-push'], ['github', 'nudge-reviewers'], ['github', 'pr-author-reminders'], ['github', 'review_comment'], ['github', 'update-pr'], ['datadog', 'submit-metric'], ['slack', 'send-message'], ['ai-eval', 'action-eval'], ['image', 'generate-image'], ['github', 'get-and-delete'], ['postgres-admin', 'query'], ['agent-browser', 'get-page'], ['local', 'list-files'], ['schedule', 'list-jobs']]) assert.equal(read(c, t), false, `${c}/${t}`);
});

test('only Latitude’s tool, and only a call that says what it is', () => {
  assert.equal(read('datadog', 'search-logs', 'mcp__other__run'), false);
  assert.equal(read('datadog', 'search-logs', 'Bash'), false);
  assert.equal(m.classify('mcp__latitude__run', null).read, false);
  assert.equal(m.classify('mcp__latitude__run', { category: 'datadog' }).read, false);
  assert.match(m.classify('mcp__latitude__run', { category: 'github', tool: 'create-pr' }).why, /create-pr/);
  assert.deepEqual(m.words('get-pr_failedLogs'), ['get', 'pr', 'failed', 'logs']);
});

test('a chat answers a Latitude read itself and shows you a card for one that changes something', () => {
  const { LiveChat } = require('../lib/chat');
  const run = prefs => {
    const chat = new LiveChat({ cfg: { prefs }, account: { id: 'a' }, cwd: process.cwd() });
    const wrote = [], shown = [];
    chat.write = o => wrote.push(o);
    chat.emit = e => shown.push(e);
    chat.setState = () => {};
    const ask = (id, tool) => chat.handleControl({ request_id: id, request: { subtype: 'can_use_tool', tool_name: 'mcp__latitude__run', tool_use_id: `t${id}`, input: { category: 'github', tool } } });
    ask('1', 'list-open-prs'); ask('2', 'create-pr');
    return { wrote, shown };
  };
  const on = run({});
  assert.equal(on.wrote.length, 1);
  assert.deepEqual(on.wrote[0].response, { subtype: 'success', request_id: '1', response: { behavior: 'allow', updatedInput: { category: 'github', tool: 'list-open-prs' }, toolUseID: 't1' } });
  assert.deepEqual(on.shown.filter(e => e.kind === 'permission').map(e => e.requestId), ['2'], 'only the one that changes something asks');
  const off = run({ latitudeReadsClaude: false });
  assert.equal(off.wrote.length, 0, 'Setup’s switch off keeps every one asking');
  assert.deepEqual(off.shown.filter(e => e.kind === 'permission').map(e => e.requestId), ['1', '2']);
});

test('a Codex chat answers Codex’s approval for a Latitude read itself, shows a card for the rest, and Setup can turn it off', () => {
  const { CodexChat } = require('../lib/codex');
  const ask = (prefs, tool, server = 'latitude') => {
    const responded = [], shown = [];
    const srv = { listeners: new Set(), respond: (rid, r) => responded.push([rid, r]), respondError: (rid, e) => responded.push([rid, { error: e }]), request: () => new Promise(() => {}) };
    const chat = new CodexChat({ cfg: { prefs }, account: { id: 't', name: 'T' }, cwd: process.cwd(), codex: { server: () => srv, models: async () => [] } });
    chat.srv = srv; chat.emit = e => shown.push(e); chat.setState = () => {};
    chat.onRequest({ id: 0, method: 'mcpServer/elicitation/request', params: { threadId: 'x', serverName: server, mode: 'form', message: `Allow the ${server} MCP server to run tool "run"?`, requestedSchema: { type: 'object', properties: {} }, _meta: { codex_approval_kind: 'mcp_tool_call', tool_name: 'run', tool_params: { category: 'sentry', tool } } } });
    return { chat, responded, cards: shown.filter(e => e.kind === 'permission') };
  };
  const read = ask({}, 'list-projects');
  assert.deepEqual(read.responded, [[0, { action: 'accept', content: {} }]], 'id 0 is answered too');
  assert.equal(read.cards.length, 0);
  const write = ask({}, 'create-issue');
  assert.equal(write.responded.length, 0);
  assert.equal(write.cards.length, 1);
  assert.equal(write.cards[0].toolName, 'mcp__latitude__run');
  assert.match(write.cards[0].view.summary, /sentry · create-issue/);
  write.chat.answer('0', { decision: 'allow' });
  assert.deepEqual(write.responded, [[0, { action: 'accept', content: {} }]]);
  const off = ask({ latitudeReadsCodex: false }, 'list-projects');
  assert.equal(off.cards.length, 1, 'Setup’s switch off: it asks');
  off.chat.answer('0', { decision: 'deny' });
  assert.deepEqual(off.responded, [[0, { action: 'decline' }]]);
  assert.equal(ask({}, 'list-projects', 'other').cards.length, 1, 'another server’s tools always ask');
});
