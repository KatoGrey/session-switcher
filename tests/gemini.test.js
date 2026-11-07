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
const { createGemini, toolBlock, ownWords, resetFrom, parseUsage, FROM_CLAUDE, MODES } = require('../lib/gemini');

const FAKE = path.join(__dirname, 'fake-agy.js');
function setup() {
  // Its real name: on a Mac the temp folder is /var/… to us but /private/var/… to the CLI it starts.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-gemini-')));
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

test('gemini: out of quota shows on its account with the reset time, until a reply on that model works', async () => {
  const { dir, gemini } = setup();
  const chat = gemini.open({ cfg: {}, cwd: dir, title: 'Gemini', model: 'gemini-4-argon-medium' });
  assert.deepEqual(gemini.publicState().limits, [], 'nothing ran out yet');
  const t0 = Date.now();
  chat.send('use up the quota');
  const card = await until(chat, e => e.kind === 'limit');
  const back = Date.parse(card.resetsAt) - t0;
  assert.ok(back > 2.4 * 3600e3 && back < 2.6 * 3600e3, `the card says when it resets (${card.resetsAt})`);
  assert.ok(!chat.buffer.some(e => e.kind === 'notice' && /exhausted/.test(e.text || '')), 'one out-of-quota card, not a warning as well');
  const [l] = gemini.publicState().limits;
  assert.equal(l.model, 'gemini-4-argon-medium');
  assert.equal(l.resetsAt, card.resetsAt, 'the account shows the same reset time');
  chat.send('hello again');
  await until(chat, () => results(chat).length === 2);
  assert.deepEqual(gemini.publicState().limits, [], 'a reply that works clears it');
  await chat.stop();
});

test('gemini: how much of the plan is left, from Antigravity’s own /usage, with no turn', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-gemini-usage-')));
  // The stand-in as a command of its own, the way the app starts a real agy.
  const asNode = process.versions.electron ? 'ELECTRON_RUN_AS_NODE=1' : '';
  const launcher = process.platform === 'win32' ? path.join(dir, 'agy.cmd') : path.join(dir, 'agy');
  if (process.platform === 'win32') fs.writeFileSync(launcher, `@echo off\r\n${asNode ? `set ${asNode}\r\n` : ''}"${process.execPath}" "${FAKE}" %*\r\n`);
  else { fs.writeFileSync(launcher, `#!/bin/sh\n${asNode ? `export ${asNode}\n` : ''}exec "${process.execPath}" "${FAKE}" "$@"\n`); fs.chmodSync(launcher, 0o755); }
  const gemini = createGemini({ chats: createChatManager(), getConfig: () => ({ gemini: { enabled: true, command: launcher } }), dataDir: dir });
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(gemini.publicState().usage, false, 'not asked before it’s known to be signed in');
  await gemini.refreshAccount();
  assert.equal(gemini.publicState().usage, true);
  const u = await gemini.usage();
  assert.equal(u.available, true);
  assert.equal(Math.round(u.fiveHour.used), 38, 'the Gemini group’s 5-hour window, as used');
  assert.equal(Math.round(u.week.used), 10);
  assert.ok(Date.parse(u.fiveHour.resetsAt) > Date.now());
  assert.deepEqual(u.groups.map(g => g.name), ['Gemini Models', 'Claude and GPT models']);
  assert.equal(u.groups[1].models, 'Claude Opus, Claude Sonnet, GPT-OSS');
  // An agy that answers "/usage" as a question (a turn, a conversation) isn't read as usage.
  assert.equal(parseUsage(JSON.stringify({ conversation_id: 'abc', status: 'SUCCESS', response: 'It looks like…', num_turns: 1 })), null);
  assert.equal(parseUsage('not json'), null);
});

test('gemini: reset times are read from the ways quota messages say them', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const at = s => resetFrom(s, now);
  assert.equal(at('Your quota will reset after 2h31m5s.'), '2026-10-14T14:31:05.000Z');
  assert.equal(at('Quota exceeded. Resets in 45m.'), '2026-10-14T12:45:00.000Z');
  assert.equal(at('Usage limit reached, resets in 3 hours and 10 minutes'), '2026-10-14T15:10:00.000Z');
  assert.equal(at('Rate limit. Resets at 2026-10-14T18:00:00Z.'), '2026-10-14T18:00:00.000Z');
  assert.equal(at('RESOURCE_EXHAUSTED'), null, 'no time given: none made up');
  assert.equal(at('Resets at 2026-10-13T18:00:00Z'), null, 'a time already past is no reset time');
});

test('gemini: Antigravity’s wording is read right; a partner follows Claude’s mode', () => {
  assert.equal(ownWords('<USER_REQUEST>\nHi there\n</USER_REQUEST>\n<ADDITIONAL_METADATA>x</ADDITIONAL_METADATA>'), 'Hi there');
  assert.equal(toolBlock('t', 'run_command', { CommandLine: '"node --version"' }).summary, 'node --version', 'arguments arrive as JSON in strings');
  const wb = toolBlock('t2', 'write_file', { Path: '"C:\\\\p\\\\new.txt"', Content: '"hello"' });
  assert.equal(wb.name, 'Write');
  assert.equal(wb.meta.path, 'C:\\p\\new.txt');
  const ext = toolBlock('t3', 'call_mcp_tool', { ServerName: '"srv"', ToolName: '"mutate"' });
  assert.deepEqual(ext.meta, { unknownWrites: true }, 'unknown/external tools mark unknownWrites for parallel undo safety');
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
    // A short look (for the Commander): your words and Gemini's.
    assert.deepEqual(gemini.preview('c1').map(m => [m.role, m.text]), [['you', 'Write the note'], ['gemini', 'done']]);
    // A long turn, all one item: reading it shows where it's got to, not how it began.
    fs.appendFileSync(path.join(logs, 'transcript.jsonl'), `\n${[{ type: 'USER_INPUT', content: 'Keep going', created_at: '2026-01-01T00:00:00Z', step_index: 100 }, { type: 'PLANNER_RESPONSE', content: `The start. ${'x'.repeat(3000)}`, step_index: 101, created_at: '2026-01-01T00:01:00Z' }, { type: 'PLANNER_RESPONSE', content: `${'y'.repeat(3000)} The latest.`, step_index: 102, created_at: '2026-01-01T05:00:00Z' }].map(l => JSON.stringify(l)).join('\n')}\n`);
    const long = gemini.preview('c1').pop();
    assert.ok(long.text.endsWith('The latest.'), long.text.slice(-40));
    assert.ok(long.text.length <= 901 && long.text.startsWith('…'));
    assert.equal(long.at, '2026-01-01T05:00:00Z', 'carries the timestamp of the latest response in the turn');
    // Renamed here: that name wins over Antigravity's, and the chat's own title doesn't write over it.
    assert.equal(gemini.rename('c1', 'Lore notes'), 'Lore notes');
    gemini.noteChat('c1', { cwd: 'C:\\p', title: 'New Gemini chat' });
    assert.equal(gemini.list().find(r => r.id === 'c1').title, 'Lore notes');
    assert.throws(() => gemini.rename('c1', '   '), /name/);
  } finally { os.homedir = real; }
});

test('gemini: a late step after its process is gone can’t leave the chat Working for good', () => {
  const { GeminiChat } = require('../lib/gemini');
  const chat = { turn: null, emit() { throw new Error('nothing to say'); } };
  GeminiChat.prototype.step.call(chat, { step_type: 'agent_response', step_index: 3, text_delta: 'late words' });
  assert.equal(chat.turn, null, 'no turn is started by a step');
});

test('gemini: Stop counts as stopped for a round, and Deny with nothing further ends its turn', async () => {
  const { GeminiChat } = require('../lib/gemini');
  const idle = { turn: null };
  await GeminiChat.prototype.interrupt.call(idle);
  assert.ok(idle.interruptedAt > 0);
  const said = [], states = [];
  const chat = { pending: new Map([['r1', { event: {}, cmds: ['x'] }]]), emit: e => said.push(e), setState: s => states.push(s) };
  GeminiChat.prototype.answer.call(chat, 'r1', { decision: 'deny' });
  assert.deepEqual(states, ['ready']);
  assert.ok(said.some(e => e.kind === 'result'), 'whatever waits on it (“When Gemini is done”) is told');
});

test('gemini: flush waits for finalizer snapshot, and interrupt recovers queued messages', async () => {
  const { GeminiChat } = require('../lib/gemini');
  let resumeFn = null, cleared = 0;
  const events = [], states = [], written = [];
  const fakeChat = Object.assign(Object.create(GeminiChat.prototype), {
    state: 'ready',
    turn: null,
    queue: [],
    pending: new Map(),
    parentKey: 'lead-1',
    waitForSnapshot(cb) { if (!resumeFn) { resumeFn = cb; return true; } return false; },
    clearPendingSnapshot() { cleared++; },
    emit: e => events.push(e),
    setState: s => { fakeChat.state = s; states.push(s); },
    proc_: () => ({ stdin: { write: s => written.push(s) } }),
  });
  fakeChat.send('<shared-context>\nctx\n</shared-context>\n\nHello Gemini', [{ mediaType: 'image/png', data: 'AAAA' }]);
  assert.equal(written.length, 0, 'held while finalizer snapshot finishes');
  assert.equal(fakeChat.queue.length, 1);
  await fakeChat.interrupt();
  assert.equal(cleared, 1);
  assert.equal(fakeChat.state, 'ready');
  const unsent = events.find(e => e.kind === 'unsent');
  assert.ok(unsent, 'emits unsent for queued message');
  assert.equal(unsent.text, 'Hello Gemini', 'shared-context stripped from recovered text');
  assert.equal(unsent.images.length, 1);
  assert.deepEqual(unsent.request, { to: 'other', kind: 'gemini' });

  // Also verify resumeFn flushes when not interrupted, and queued messages wait for queued snapshot:
  resumeFn = null;
  let queuedNoted = 0, queuedResumeFn = null;
  fakeChat.noteQueuedSnapshot = () => { queuedNoted++; };
  fakeChat.waitForQueuedSnapshot = cb => { if (queuedNoted && !queuedResumeFn) { queuedResumeFn = cb; return true; } return false; };
  fakeChat.snap = { finishing: true };
  fakeChat.send('Second message');
  assert.equal(queuedNoted, 1, 'notes queued snapshot when sending during finishing');
  assert.equal(written.length, 0);
  resumeFn();
  assert.equal(written.length, 0, 'still waits for queued snapshot after finalizer finishes');
  queuedResumeFn();
  assert.equal(written.length, 1);
  assert.match(written[0], /Second message/);
});
