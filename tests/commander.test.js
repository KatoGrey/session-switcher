'use strict';
// The Commander's tools (lib/commander-config.js, lib/commander-mcp.js): its settings start the
// switcher tools with the app's own program, and in the desktop app that needs ELECTRON_RUN_AS_NODE,
// or Session Switcher.exe started a second copy of the app and the tools never connected.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { commanderMcpConfig } = require('../lib/commander-config');

const SCRIPT = path.join(__dirname, '..', 'lib', 'commander-mcp.js');

test('commander: under the desktop app its tools are run as plain Node (ELECTRON_RUN_AS_NODE); elsewhere nothing extra', () => {
  const desk = commanderMcpConfig({ execPath: 'C:\\Programs\\Session Switcher.exe', script: SCRIPT, port: 4777, token: 'abc', runAsNode: { ELECTRON_RUN_AS_NODE: '1' } });
  const s = desk.mcpServers.switcher;
  assert.equal(s.command, 'C:\\Programs\\Session Switcher.exe');
  assert.deepEqual(s.args, [SCRIPT]);
  assert.equal(s.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(s.env.SWITCHER_URL, 'http://127.0.0.1:4777'); assert.equal(s.env.SWITCHER_TOKEN, 'abc');
  const plain = commanderMcpConfig({ execPath: '/usr/bin/node', script: SCRIPT, port: 4777, token: 'abc' }).mcpServers.switcher;
  assert.equal('ELECTRON_RUN_AS_NODE' in plain.env, false);
});

// Starts the tools the way Claude Code does from the settings (the server's own environment, which
// has ELECTRON_RUN_AS_NODE taken out, plus the settings' env), and asks for its tools.
function askTools(execPath, runAsNode) {
  const s = commanderMcpConfig({ execPath, script: SCRIPT, port: 9, token: 'test', runAsNode }).mcpServers.switcher;
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    const p = spawn(s.command, s.args, { env: { ...env, ...s.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error(`no answer; it said: ${out.slice(0, 300)}`)); }, 20000);
    p.stdout.on('data', d => {
      out += d;
      const lines = out.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const list = lines.find(m => m.id === 2);
      if (list) { clearTimeout(timer); p.kill(); resolve({ init: lines.find(m => m.id === 1), tools: (list.result && list.result.tools) || [] }); }
    });
    p.on('error', err => { clearTimeout(timer); reject(err); });
    p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })}\n`);
    p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
  });
}

test('commander: started from its settings, the tools answer and list what the Commander can do', async () => {
  // The program running these tests, as the app would: under the desktop app (the nightly self-check)
  // that's Session Switcher.exe itself.
  const runAsNode = process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {};
  const r = await askTools(process.execPath, runAsNode);
  assert.ok(r.init && r.init.result, 'it answers initialize');
  for (const name of ['list_sessions', 'read_session', 'send_message']) assert.ok(r.tools.some(t => t.name === name), `${name} is there`);
});

// With Electron here (a developer's copy), the desktop app's own case: Electron running the script.
const electron = (() => { try { const p = require(path.join(__dirname, '..', 'desktop', 'node_modules', 'electron')); return typeof p === 'string' && fs.existsSync(p) ? p : null; } catch { return null; } })();
test('commander: run by Electron, as in the desktop app, the tools still answer', { skip: electron ? false : 'Electron isn’t installed beside the app here' }, async () => {
  const r = await askTools(electron, { ELECTRON_RUN_AS_NODE: '1' });
  assert.ok(r.init && r.init.result, 'it answers initialize');
  assert.ok(r.tools.some(t => t.name === 'list_sessions'), 'and lists its tools');
});
