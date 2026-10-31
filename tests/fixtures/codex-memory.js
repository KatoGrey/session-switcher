'use strict';
// Synthetic notifications only: no provider process, account, project scan or filesystem write.
const assert = require('node:assert/strict'), os = require('node:os');
const snapshots = require('../../lib/snapshots');
snapshots.warm = () => {};
const { CodexChat } = require('../../lib/codex');
(async () => {
  const chat = new CodexChat({ cfg: {}, account: { id: 'test', name: 'Test' }, cwd: os.tmpdir(), codex: {} });
  chat.srv = { listeners: new Set(), respond() {} };
  chat.state = 'ready'; chat.beginTurn('memory-turn');
  const collect = async () => {
    await new Promise(resolve => setImmediate(resolve));
    for (let i = 0; i < 3; i++) global.gc();
    const m = process.memoryUsage(); return m.heapUsed + m.external;
  };
  const baseline = await collect();
  function large(type, id) {
    const payload = id + ' ' + 'x'.repeat(4 * 1024 * 1024);
    if (type === 'commandExecution') {
      const item = { id, type, command: 'echo approval-command', status: 'inProgress' };
      chat.itemStarted(item);
      chat.onRequest({ id: 'approve-command', method: 'item/commandExecution/requestApproval', params: { itemId: id } });
      assert.match(chat.pending.get('approve-command').event.view.detail, /echo approval-command/);
      chat.answer('approve-command', { decision: 'allow' });
      chat.itemCompleted({ ...item, status: 'completed', exitCode: 0, aggregatedOutput: payload });
    } else if (type === 'fileChange') {
      const item = { id, type, status: 'inProgress', changes: [{ path: 'one.txt', kind: { type: 'update' }, diff: payload }] };
      chat.itemStarted(item);
      chat.onRequest({ id: 'approve-file', method: 'item/fileChange/requestApproval', params: { itemId: id } });
      assert.match(chat.pending.get('approve-file').event.view.detail, /one\.txt\nfile-result /);
      chat.answer('approve-file', { decision: 'allow' });
      chat.itemCompleted({ ...item, status: 'completed' });
    } else if (type === 'mcpToolCall') {
      const item = { id, type, server: 'fake', tool: 'read', arguments: {}, status: 'inProgress' };
      chat.itemStarted(item);
      chat.itemCompleted({ ...item, status: 'completed', result: { content: [{ type: 'text', text: payload }] } });
    } else {
      const item = { id, type, tool: 'fake_read', arguments: {}, status: 'inProgress' };
      chat.itemStarted(item);
      chat.itemCompleted({ ...item, status: 'completed', success: true, contentItems: [{ type: 'text', text: payload }] });
    }
  }
  large('commandExecution', 'command-result');
  large('mcpToolCall', 'mcp-result');
  large('dynamicToolCall', 'dynamic-result');
  large('fileChange', 'file-result');
  const completedMiB = ((await collect()) - baseline) / 1048576;
  const results = chat.buffer.filter(e => e.kind === 'tool_result');
  assert.equal(results.length, 4);
  for (const event of results.slice(0, 3)) assert.ok(event.result.text.startsWith(event.toolUseId + ' '));
  assert.match(results[3].result.text, /Changed 1 file/);
  assert.ok(chat.replayBytes < 256 * 1024);
  // Closing before an active tool finishes must release its raw approval input too.
  function leaveActive() {
    chat.itemStarted({ id: 'unfinished-edit', type: 'fileChange', status: 'inProgress', changes: [{ path: 'two.txt', kind: { type: 'update' }, diff: 'unfinished ' + 'z'.repeat(8 * 1024 * 1024) }] });
  }
  leaveActive(); chat.end(null);
  assert.equal(chat.items.size, 0); assert.equal(chat.itemMids.size, 0);
  assert.equal(chat.buffer.filter(e => e.kind === 'tool_result').length, 4, 'closing keeps the displayed bounded results');
  const closedMiB = ((await collect()) - baseline) / 1048576;
  console.log(JSON.stringify({ results: results.length, completedMiB, closedMiB, replayBytes: chat.replayBytes }));
})().catch(err => { console.error(err); process.exitCode = 1; });
