'use strict';
// Chats the app left running when it was closed without stopping them (lib/system.js parseLeftovers):
// Claude Code started the way this app starts its chats, whose app is gone, and never one of the
// running app's own, a copy, or a Claude Code you started yourself.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLeftovers } = require('../lib/system');

const ours = id => `claude  --output-format stream-json --input-format stream-json --verbose --include-partial-messages --permission-prompt-tool stdio --resume ${id} --permission-mode auto`;

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
