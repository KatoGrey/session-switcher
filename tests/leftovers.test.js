'use strict';
// Chats the app left running when it was closed without stopping them (lib/system.js parseLeftovers):
// Claude Code started the way this app starts its chats, whose app is gone, and never one of the
// running app's own, a copy, or a Claude Code you started yourself.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLeftovers } = require('../lib/system');

const ours = id => `claude  --output-format stream-json --input-format stream-json --verbose --include-partial-messages --permission-prompt-tool stdio --resume ${id} --permission-mode auto`;

test('new Claude conversations have a recoverable id before their first message', t => {
  const { LiveChat } = require('../lib/chat'), sys = require('../lib/system');
  const original = sys.spawnClaude;
  let args;
  sys.spawnClaude = (cfg, account, cwd, actual) => { args = actual; throw new Error('test: do not launch'); };
  t.after(() => { sys.spawnClaude = original; });
  const chat = new LiveChat({ cfg: {}, account: { id: 'test' }, cwd: process.cwd() });
  chat.start();
  const cmd = `claude ${args.join(' ')}`;
  const id = args[args.indexOf('--session-id') + 1];
  assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.deepEqual(sys.parseProcessList(`902|${cmd}`, true), { [id]: [902] });
  assert.deepEqual(parseLeftovers(`902|1||${cmd}`, true, 600), [{ pid: 902, sessionId: id }]);
  assert.deepEqual(parseLeftovers(`902 1 ${cmd}`, false, 600), [{ pid: 902, sessionId: id }]);
});

test('leftovers: npm installs and quoted or equals session ids remain identifiable', () => {
  const id = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb';
  const cmd = ours(id).replace('claude ', 'node.exe "C:\\Tools\\node_modules\\@anthropic-ai\\claude-code\\cli.js" ').replace(`--resume ${id}`, `--session-id="${id}"`);
  assert.deepEqual(parseLeftovers(`901|1||${cmd}`, true, 600), [{ pid: 901, sessionId: id }]);
  assert.deepEqual(require('../lib/system').parseProcessList(`901|${cmd}`, true), { [id]: [901] });
  assert.deepEqual(parseLeftovers(`901|1||${cmd} --fork-session`, true, 600), []);
});

test('leftovers (Windows): a chat whose app is gone, through the cmd.exe it started in', () => {
  const server = 45048;
  const text = [
    `122184|1||${ours('6e54ffd2-da08-4300-abba-c0e27a4fe6c8')}`,                 // its cmd.exe and app are gone
    `91452|1|92868|${ours('aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb')}`,              // only its cmd.exe is left
    `125920|0|82696,${server}|${ours('e9aca452-5193-420c-a863-db3f49d7778f')}`,   // the running app's own
    `127492|1||${ours('6e54ffd2-da08-4300-abba-c0e27a4fe6c8')} --fork-session`,   // a copy: writes to a new chat
    `5555|1||claude --resume cccccccc-2222-4333-8444-dddddddddddd`,               // one you started in a terminal
  ].join('\r\n');
  assert.deepEqual(parseLeftovers(text, true, server), [
    { pid: 122184, sessionId: '6e54ffd2-da08-4300-abba-c0e27a4fe6c8' },
    { pid: 91452, sessionId: 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb' },
  ]);
});

test('leftovers (Mac, Linux): one taken over by the system (parent 1), directly or through its shell', () => {
  const server = 700;
  const text = [
    `  900   1 ${ours('11111111-1111-4111-8111-111111111111')}`,
    `  950 940 ${ours('22222222-2222-4222-8222-222222222222')}`,
    `  940   1 /bin/sh -c claude ...`,
    `  990 ${server} ${ours('33333333-3333-4333-8333-333333333333')}`,
    `  995   1 claude --resume 44444444-4444-4444-8444-444444444444`,
  ].join('\n');
  assert.deepEqual(parseLeftovers(text, false, server).map(x => x.sessionId), ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']);
});

test('leftovers: finished means quiet after a finished reply; mid-step it gets much longer', () => {
  const { leftoverFinished } = require('../lib/system');
  const now = 1e12, min = 60e3;
  const check = (o) => leftoverFinished({ now, since: now - 60 * min, ...o }).done;
  assert.equal(check({ written: now - 2 * min, phase: 'idle' }), true, 'a finished reply, quiet for two minutes');
  assert.equal(check({ written: now - 30e3, phase: 'idle' }), false, 'written to just now');
  assert.equal(check({ written: now - 5 * min, phase: 'tool' }), false, 'a long command writes nothing until it’s done');
  assert.equal(check({ written: now - 31 * min, phase: 'tool' }), true, 'but not for ever (it may be asking for an OK nobody can give)');
  assert.equal(leftoverFinished({ now, since: now - 30e3, written: 0, phase: 'idle' }).done, false, 'an unknown last write isn’t quiet: it was only just found');
  assert.equal(check({ written: 0, phase: null }), true, 'even unknown, an hour on');
  assert.equal(leftoverFinished({ now, since: now - 5 * min, written: 0, phase: null }).done, false);
});

test('a model name can have brackets (opus[1m], from Claude’s settings), and a chat with one starts', () => {
  const { shellArgs } = require('../lib/system');
  const line = shellArgs(['--resume', 'abc-123', '--model', 'opus[1m]']);
  assert.match(line, process.platform === 'win32' ? /--model opus\[1m\]$/ : /--model 'opus\[1m\]'$/);
  for (const bad of ['a b', 'a&b', 'a|b', 'a;b', '$(x)', 'a"b', "a'b", 'a>b', '%x%']) assert.throws(() => shellArgs([bad]), /Unsafe argument/, bad);
});
