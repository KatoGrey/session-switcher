#!/usr/bin/env node
'use strict';
// The built-in browser's tools for one chat: a small MCP server (stdio) that Claude Code or Codex starts. It
// passes each call to the running Session Switcher (SWITCHER_URL) with the chat's own key
// (SWITCHER_BROWSER_KEY), which only reaches that chat's tabs. No npm packages.
//
// Protocol: newline-delimited JSON-RPC 2.0 on stdin/stdout (MCP's stdio transport). Logs go to stderr.

const { TOOLS, SERVER } = require('./browser-tools');

const BASE = String(process.env.SWITCHER_URL || '').replace(/\/+$/, '');
const KEY = process.env.SWITCHER_BROWSER_KEY || '';
const log = msg => process.stderr.write(`[${SERVER}] ${msg}\n`);

// (Plain http, not fetch: fetch gives up on an answer after five minutes, and a Voyage turn can take longer.)
function post(body) {
  return new Promise((resolve, reject) => {
    const u = new URL(`${BASE}/api/browser/tool`);
    const data = JSON.stringify(body);
    const req = require('http').request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'X-Switcher-Browser': KEY } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', d => { text += d; });
      res.on('end', () => { let j = {}; try { j = JSON.parse(text); } catch { /* not JSON */ } resolve({ status: res.statusCode, json: j }); });
    });
    req.setTimeout(20 * 60e3, () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end(data);
  });
}
async function call(name, args) {
  if (!BASE || !KEY) return { content: [{ type: 'text', text: 'The browser’s address isn’t set. Reopen this chat from Session Switcher.' }], isError: true };
  let r;
  try {
    r = await post({ name, arguments: args || {} });
  } catch {
    return { content: [{ type: 'text', text: 'Session Switcher isn’t answering. It may be restarting; try again in a moment.' }], isError: true };
  }
  if (r.status !== 200) return { content: [{ type: 'text', text: r.json.error || `Session Switcher said ${r.status}.` }], isError: true };
  return r.json;
}

function send(msg) { process.stdout.write(`${JSON.stringify(msg)}\n`); }
async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  try {
    if (method === 'initialize') {
      return isRequest && send({ jsonrpc: '2.0', id, result: { protocolVersion: (params && params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: SERVER, version: '1.0.0' }, instructions: 'Session Switcher’s built-in browser. Its tabs belong to this chat and the user can watch them beside it. Prefer read_page, find, page_text and (on voyage.io) the voyage_* tools over screenshots: they cost far less.' } });
    }
    if (method === 'ping') return isRequest && send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return isRequest && send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      const r = await call(params && params.name, params && params.arguments);
      return isRequest && send({ jsonrpc: '2.0', id, result: r });
    }
    if (method && method.startsWith('notifications/')) return undefined;
    if (isRequest) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (err) {
    log(err.stack || err.message);
    if (isRequest) send({ jsonrpc: '2.0', id, error: { code: -32603, message: err.message } });
  }
  return undefined;
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { log(`Not JSON: ${line.slice(0, 200)}`); continue; }
    handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
