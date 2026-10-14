'use strict';
// Gemini chats (lib/gemini.js), against a stand-in for Google's `agy` that answers the way the real
// one does: replies stream in, steps show, the conversation is kept, modes decide what it may do.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { createChatManager } = require('../lib/chat');
const { createGemini, toolBlock, ownWords, FROM_CLAUDE, MODES } = require('../lib/gemini');

const FAKE = path.join(__dirname, 'fake-agy.js');
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-gemini-'));
  const chats = createChatManager();
  const gemini = createGemini({ chats, getConfig: () => ({ gemini: { enabled: true } }), dataDir: dir });
  const started = [];
  const open = gemini.open;
  gemini.open = o => { const c = open(o); test.after(() => c.stop()); return c; };
  gemini.spawnAgy = (args, cwd) => { started.push(args); return spawn(process.execPath, [FAKE, ...args], { cwd }); };
  return { dir, chats, gemini, started };
}
const until = (chat, pred, ms = 8000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const tick = () => { const ev = chat.buffer.find(pred); if (ev) return resolve(ev); if (Date.now() - t0 > ms) return reject(new Error('timed out')); return setTimeout(tick, 30); };
  tick();
});
const results = chat => chat.buffer.filter(e => e.kind === 'result');

test('gemini: a reply streams in, and the conversation’s id is kept', async () => {
  const { dir, gemini } = setup();
  const chat = gemini.open({ cfg: {}, cwd: dir, title: 'Gemini' });
  assert.equal(chat.provider, 'gemini');
  assert.equal(chat.state, 'ready', 'ready at once (agy starts with the first message)');
  chat.send('hello');
  await until(chat, e => e.kind === 'result');
  assert.equal(chat.sessionId, 'conv-1234-5678');
  assert.ok(chat.buffer.some(e => e.kind === 'stream_start'), 'streamed (its pieces are tidied away once the reply is whole)');
  const a = chat.buffer.find(e => e.kind === 'assistant' && e.blocks.some(b => b.type === 'text'));
  assert.equal(a.blocks[0].text, 'Echo: hello', 'the finished reply, without the trailing newline');
  assert.equal(results(chat)[0].ok, true);
  assert.equal(results(chat)[0].tokens, 87, 'tokens counted (cached input left out)');
  // A second message goes to the same running agy.
  chat.send('again');
  await until(chat, () => results(chat).length === 2);
  assert.equal(chat.buffer.filter(e => e.kind === 'assistant' && e.blocks.some(b => b.type === 'text')).length, 2);
  await chat.stop();
});

test('gemini: modes decide what it may do: edits in Edit files, commands only with Full access', async () => {
  const { dir, gemini, started } = setup();
  const chat = gemini.open({ cfg: {}, cwd: dir, title: 'Gemini', mode: 'accept-edits' });
  chat.send('write a note and run a command');
  await until(chat, e => e.kind === 'result');
  assert.ok(started[0].includes('--mode') && started[0].includes('accept-edits'));
  const tools = chat.buffer.filter(e => e.kind === 'assistant').flatMap(e => e.blocks).filter(b => b.type === 'tool');
  assert.deepEqual(tools.map(b => b.name), ['Write', 'Bash']);
  assert.equal(tools[0].meta.path, path.join(dir, 'note.txt'), 'its edit is known, for the changes and Undo');
  const res = chat.buffer.filter(e => e.kind === 'tool_result');
  assert.equal(res[0].result.isError, false);
  assert.equal(res[1].result.isError, true, 'the command was refused');
  assert.ok(!/circumvent/.test(res[1].result.text), 'without agy’s note to the model');
  // Refused, it becomes a card after the reply: the same Allow / Always / Deny as Claude's.
  const card = chat.buffer.find(e => e.kind === 'permission');
  assert.ok(card && card.view.summary === 'node --version' && card.canAlways, JSON.stringify(card));
  assert.equal(chat.state, 'waiting', 'it waits for you (the hub and the phone say it needs your OK)');
  assert.equal(chat.summary().pending.length, 1);
  // Allow: it runs that in its next reply, with full access for that reply only.
  chat.answer(card.requestId, { decision: 'allow' });
  await until(chat, () => results(chat).length === 2);
  let last = started[started.length - 1];
  assert.ok(last.includes('--dangerously-skip-permissions') && last.includes('--conversation') && last.includes('conv-1234-5678'), JSON.stringify(last));
  assert.equal(chat.buffer.filter(e => e.kind === 'tool_result').pop().result.text.trim(), 'v24.0.0', 'it ran');
  assert.ok(chat.buffer.some(e => e.kind === 'user' && e.approval && /Allowed: you may run `node --version`/.test(e.text)));
  assert.equal(chat.permissionMode, 'accept-edits', 'the chat’s own mode stays as it was');
  chat.send('hello again');
  await until(chat, () => results(chat).length === 3);
  last = started[started.length - 1];
  assert.ok(!last.includes('--dangerously-skip-permissions') && last.includes('accept-edits'), 'and the next reply is back to Edit files');
  // Always: the chat gets full access from then on.
  chat.send('run another');
  await until(chat, () => chat.buffer.filter(e => e.kind === 'permission').length === 2);
  const card2 = chat.buffer.filter(e => e.kind === 'permission').pop();
  chat.answer(card2.requestId, { decision: 'always' });
  await until(chat, () => results(chat).length === 5);
  assert.equal(chat.permissionMode, 'full');
  await chat.stop();
});

test('gemini: a picture you attach goes as a file it opens with its own viewer', async () => {
  const { dir, gemini, started } = setup();
  const chat = gemini.open({ cfg: {}, cwd: dir, title: 'Gemini' });
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  chat.send('what is in this picture?', [{ mediaType: 'image/png', data: png }]);
  await until(chat, e => e.kind === 'result');
  const echo = chat.buffer.find(e => e.kind === 'assistant' && e.blocks.some(b => b.type === 'text')).blocks[0].text;
  const m = echo.match(/Open it with your file viewing tool before answering: (\S+\.png)/);
  assert.ok(m, echo);
  assert.ok(fs.existsSync(m[1]) && fs.readFileSync(m[1]).toString('base64') === png, 'the picture, as a file');
  assert.ok(started[0].includes('--add-dir'), 'in a folder it may read');
  const you = chat.buffer.find(e => e.kind === 'user');
  assert.equal(you.text, 'what is in this picture?', 'your message shows as you wrote it');
  assert.equal(you.images.length, 1, 'with the picture');
  await chat.stop();
});

test('gemini: Stop ends the reply, and the next message carries on with the conversation', async () => {
  const { dir, gemini, started } = setup();
  const chat = gemini.open({ cfg: {}, cwd: dir, title: 'Gemini' });
  chat.send('first');
  await until(chat, e => e.kind === 'result');
  chat.send('be slow');
  await until(chat, e => e.kind === 'delta' && /Working on it/.test(e.text));
  await chat.interrupt();
  await until(chat, () => results(chat).length === 2);
  assert.equal(results(chat)[1].interrupted, true);
  assert.equal(chat.state, 'ready', 'ready for the next message, not ended');
  chat.send('after the stop');
  await until(chat, () => results(chat).length === 3);
  assert.ok(started.length >= 2 && started[started.length - 1].includes('conv-1234-5678'), 'started again on the same conversation');
  await chat.stop();
});

test('gemini: Antigravity’s wording is read right; a partner follows Claude’s mode', () => {
  assert.equal(ownWords('<USER_REQUEST>\nHi there\n</USER_REQUEST>\n<ADDITIONAL_METADATA>x</ADDITIONAL_METADATA>'), 'Hi there');
  assert.equal(toolBlock('t', 'run_command', { CommandLine: '"node --version"' }).summary, 'node --version', 'arguments arrive as JSON in strings');
  for (const v of Object.values(FROM_CLAUDE)) assert.ok(MODES.some(m => m.value === v), v);
  assert.equal(FROM_CLAUDE.bypassPermissions, 'full');
});

test('gemini: a conversation’s history reads back from Antigravity’s own record', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-gemini-home-'));
  const real = os.homedir;
  os.homedir = () => home;
  try {
    const logs = path.join(home, '.gemini', 'antigravity-cli', 'brain', 'c1', '.system_generated', 'logs');
    fs.mkdirSync(logs, { recursive: true });
    const lines = [
      { step_index: 0, type: 'USER_INPUT', status: 'DONE', created_at: '2026-10-14T17:44:21Z', content: '<USER_REQUEST>\nWrite the note\n</USER_REQUEST>\n<ADDITIONAL_METADATA>t</ADDITIONAL_METADATA>' },
      { step_index: 1, type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-10-14T17:44:21Z', tool_calls: [{ name: 'write_to_file', args: { TargetFile: '"C:\\\\p\\\\note.txt"', CodeContent: '"hi"' } }] },
      { step_index: 2, type: 'GENERIC', status: 'DONE', created_at: '2026-10-14T17:44:24Z', content: 'Created At: x\nCompleted At: y\nCreated file note.txt.' },
      { step_index: 3, type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-10-14T17:44:26Z', content: 'done' },
    ];
    fs.writeFileSync(path.join(logs, 'transcript.jsonl'), lines.map(l => JSON.stringify(l)).join('\n'));
    fs.mkdirSync(path.join(home, '.gemini', 'antigravity-cli', 'annotations'), { recursive: true });
    fs.writeFileSync(path.join(home, '.gemini', 'antigravity-cli', 'annotations', 'c1.pbtxt'), 'title:"Creating Note Text File"\n');
    const { gemini } = setup();
    gemini.noteChat('c1', { cwd: 'C:\\p' });
    const h = gemini.history('c1');
    assert.deepEqual(h.items.map(i => i.kind), ['user', 'assistant']);
    assert.equal(h.items[0].text, 'Write the note');
    const blocks = h.items[1].blocks;
    assert.equal(blocks[0].name, 'Write');
    assert.match(blocks[0].result.text, /Created file note\.txt/);
    assert.equal(blocks[1].text, 'done');
    const row = gemini.list().find(r => r.id === 'c1');
    assert.equal(row.title, 'Creating Note Text File');
    assert.equal(row.cwd, 'C:\\p');
    assert.ok(gemini.known('c1') && !gemini.known('nope'));
  } finally { os.homedir = real; }
});
