'use strict';
// MCP sign-ins (lib/mcpauth.js): through a chat's own Claude Code, a helper, or Codex's app server; one sign-in
// to a server at a time; the address pasted from another device; and the card a chat is sent.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createMcpAuth, helperConn, view, codexView, callbackUrl, redirectOf } = require('../lib/mcpauth');

const AUTH = 'https://mcp.example.com/authorize?response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A45069%2Fcallback&state=s1';
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
async function until(what, fn, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return; await tick(10); }
  assert.fail(`waited for ${what}`);
}

// A running Claude chat, as far as sign-ins go: control requests in, events out.
function fakeChat({ account = { id: 'personal', name: 'Personal' }, servers = [{ name: 'latitude', status: 'needs-auth', transport: 'http', urlHost: 'mcp.example.com' }] } = {}) {
  const chat = { key: `k${Math.random()}`, account, state: 'ready', cwd: 'C:\\work', events: [], asked: [], servers };
  chat.emit = ev => chat.events.push(ev);
  chat.request = async inner => {
    chat.asked.push(inner);
    if (inner.subtype === 'mcp_status') return { mcpServers: chat.servers };
    if (inner.subtype === 'mcp_authenticate') return { authUrl: AUTH, requiresUserAction: true, callbackExpected: true, redirectScheme: 'localhost', state: 's1', callbackPort: 45069 };
    if (inner.subtype === 'mcp_oauth_callback_url') return {};
    if (inner.subtype === 'mcp_reconnect') return {};
    throw new Error(`unexpected ${inner.subtype}`);
  };
  return chat;
}
const signedIn = chat => { chat.servers = chat.servers.map(s => ({ ...s, status: 'connected', tools: [{ name: 'run' }] })); };

test('mcpauth: what the page is told about a server, without its settings', () => {
  const v = view({ name: 'latitude', status: 'needs-auth', transport: 'http', urlHost: 'mcp.example.com', config: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer secret' } }, scope: 'user' });
  assert.deepEqual(v, { name: 'latitude', status: 'needs-auth', transport: 'http', host: 'mcp.example.com', scope: 'user', claudeAi: false, canSignIn: true, tools: null, error: null });
  assert.ok(!JSON.stringify(v).includes('secret'));
  assert.equal(view({ name: 'blender', status: 'connected', transport: 'stdio', tools: [{}, {}] }).canSignIn, false);
  assert.equal(view({ name: 'claude.ai Gmail', status: 'needs-auth', config: { type: 'claudeai-proxy' } }).claudeAi, true);
  const cx = codexView({ name: 'latitude', enabled: true, transport: { type: 'streamable_http', url: 'https://mcp.example.com/mcp', bearer_token_env_var: null }, auth_status: 'not_logged_in' });
  assert.equal(cx.status, 'needs-auth'); assert.equal(cx.transport, 'http'); assert.equal(cx.canSignIn, true); assert.equal(cx.host, 'mcp.example.com');
  assert.equal(codexView({ name: 'latitude', enabled: true, transport: { type: 'streamable_http', url: 'https://x' }, auth_status: 'o_auth' }).status, 'signed-in');
  assert.equal(codexView({ name: 'Blender', enabled: true, transport: { type: 'stdio', command: 'b.exe' }, auth_status: 'unsupported' }).canSignIn, false);
  assert.equal(codexView({ name: 'off', enabled: false, transport: { type: 'stdio' }, auth_status: 'unsupported' }).status, 'disabled');
});

test('mcpauth: only the sign-in’s own localhost address is taken back from another device', () => {
  const f = { redirect: redirectOf(AUTH) };
  assert.deepEqual(f.redirect, { port: 45069, path: '/callback' });
  assert.equal(callbackUrl('http://localhost:45069/callback?code=abc&state=s1', f), 'http://localhost:45069/callback?code=abc&state=s1');
  assert.ok(callbackUrl('  http://127.0.0.1:45069/callback?error=access_denied  ', f));
  assert.equal(callbackUrl('http://localhost:45070/callback?code=abc', f), null, 'another port');
  assert.equal(callbackUrl('http://localhost:45069/elsewhere?code=abc', f), null, 'another path');
  assert.equal(callbackUrl('https://evil.example/callback?code=abc', f), null, 'not localhost');
  assert.equal(callbackUrl('http://localhost:45069/callback', f), null, 'no code');
  assert.equal(callbackUrl('not a url', f), null);
});

test('mcpauth: a chat signs in through its own Claude Code; the page opens here, and the card follows along', async () => {
  const chat = fakeChat();
  const opened = [];
  const m = createMcpAuth({ chatsOf: (p, id) => (p === 'claude' && id === 'personal' ? [chat] : []), openUrl: async u => { opened.push(u); return { ok: true }; }, pollMs: 10 });
  await m.recheck(chat, { force: true });
  assert.equal(chat.events.at(-1).kind, 'mcp');
  assert.deepEqual(chat.events.at(-1).need.map(s => s.name), ['latitude']);
  const f = await m.start({ account: chat.account, name: 'latitude', chat, local: true });
  assert.equal(f.state, 'waiting');
  assert.equal(f.host, 'mcp.example.com');
  assert.equal(f.opened, true);
  assert.deepEqual(opened, [AUTH]);
  assert.equal(chat.events.at(-1).flows[0].state, 'waiting');
  signedIn(chat);   // the browser came back; Claude Code connected it
  await until('done', () => m.flows()[0].state === 'done');
  await until('the card says it’s connected', () => chat.events.at(-1).need.length === 0 && chat.events.at(-1).flows[0].state === 'done');
});

test('mcpauth: from a phone, the page isn’t opened here, and the pasted address goes to Claude Code', async () => {
  const chat = fakeChat();
  const opened = [];
  const m = createMcpAuth({ chatsOf: () => [chat], openUrl: async u => { opened.push(u); return { ok: true }; }, pollMs: 10 });
  const f = await m.start({ account: chat.account, name: 'latitude', chat, local: false });
  assert.equal(f.opened, false);
  assert.equal(opened.length, 0);
  await assert.rejects(m.finish(f.id, 'https://evil.example/callback?code=1'), /isn’t the address/);
  await m.finish(f.id, 'http://localhost:45069/callback?code=abc&state=s1');
  const sent = chat.asked.find(x => x.subtype === 'mcp_oauth_callback_url');
  assert.deepEqual(sent, { subtype: 'mcp_oauth_callback_url', serverName: 'latitude', callbackUrl: 'http://localhost:45069/callback?code=abc&state=s1' });
  m.cancel(f.id);
  await assert.rejects(m.finish(f.id, 'http://localhost:45069/callback?code=abc'), /finished/);
});

test('mcpauth: one sign-in to a server at a time, across accounts; a new one takes over', async () => {
  const a = fakeChat({ account: { id: 'main', name: 'Main' } }), b = fakeChat({ account: { id: 'personal', name: 'Personal' } });
  const m = createMcpAuth({ chatsOf: (p, id) => [a, b].filter(c => c.account.id === id), pollMs: 10 });
  const f1 = await m.start({ account: a.account, name: 'latitude', chat: a, local: false });
  const f2 = await m.start({ account: b.account, name: 'latitude', chat: b, local: false });
  const byId = Object.fromEntries(m.flows().map(f => [f.id, f]));
  assert.equal(byId[f1.id].state, 'cancelled');
  assert.match(byId[f1.id].error, /Personal took over/);
  assert.equal(byId[f2.id].state, 'waiting');
  m.stopAll();
});

test('mcpauth: signed in on one chat, the account’s other chats connect again', async () => {
  const a = fakeChat(), b = fakeChat();
  const m = createMcpAuth({ chatsOf: () => [a, b], pollMs: 10 });
  await m.recheck(b, { force: true });
  await m.start({ account: a.account, name: 'latitude', chat: a, local: false });
  signedIn(a);
  await until('the other chat is asked to reconnect', () => b.asked.some(x => x.subtype === 'mcp_reconnect' && x.serverName === 'latitude'));
  assert.ok(!a.asked.some(x => x.subtype === 'mcp_reconnect'), 'the one that signed in connected by itself');
});

test('mcpauth: from Connections, an open chat that’s waiting for the server signs in itself, so its tools load there', async () => {
  const chat = fakeChat();
  let spawned = 0;
  const m = createMcpAuth({ chatsOf: () => [chat], spawnHelper: () => { spawned++; throw new Error('no helper wanted'); }, pollMs: 10 });
  await m.recheck(chat, { force: true });
  const f = await m.start({ account: chat.account, name: 'latitude', local: false });
  assert.equal(f.chatKey, chat.key);
  assert.equal(f.state, 'waiting');
  assert.equal(spawned, 0);
  m.stopAll();
});

test('mcpauth: no card for a chat whose servers are all fine', async () => {
  // (claude.ai's own connectors, often left unconnected on purpose, don't raise a card in every chat.)
  const chat = fakeChat({ servers: [{ name: 'latitude', status: 'connected', transport: 'http' }, { name: 'blender', status: 'failed', transport: 'stdio' }, { name: 'claude.ai Gmail', status: 'needs-auth', transport: 'claudeai-proxy' }] });
  const m = createMcpAuth({ chatsOf: () => [chat] });
  assert.deepEqual(await m.recheck(chat, { force: true }), []);
  assert.equal(chat.events.length, 0);
  const codexChat = { ...fakeChat(), provider: 'gemini' };
  assert.equal(await m.recheck(codexChat, { force: true }), null, 'Gemini’s aren’t looked at');
});

test('mcpauth: Codex signs in through its app server, even when its answer beats the reply', async () => {
  const listeners = new Set();
  const asked = [];
  const srv = {
    listeners,
    async request(method, params) {
      asked.push([method, params]);
      if (method === 'mcpServer/oauth/login') {
        // Codex says it's done before the request's own reply arrives.
        for (const l of [...listeners]) l.onNotify('mcpServer/oauthLogin/completed', { name: params.name, success: true, loginId: 'L1' });
        return { authorizationUrl: AUTH, loginId: 'L1' };
      }
      if (method === 'config/mcpServer/reload') return {};
      throw new Error(method);
    },
  };
  const m = createMcpAuth({ codex: { accounts: () => [{ id: 'codex', name: 'Codex' }], server: () => srv, list: async () => [] }, pollMs: 10 });
  await m.start({ provider: 'codex', account: { id: 'codex', name: 'Codex' }, name: 'latitude', local: false });
  await until('done', () => m.flows()[0].state === 'done');
  await until('reloaded', () => asked.some(([x]) => x === 'config/mcpServer/reload'));
  assert.equal(listeners.size, 0, 'stopped listening');
});

test('mcpauth: a Codex sign-in that fails says why; one from a phone is finished by loading the address here', async () => {
  const listeners = new Set();
  const srv = { listeners, request: async method => (method === 'mcpServer/oauth/login' ? { authorizationUrl: AUTH, loginId: 'L2' } : {}) };
  const loaded = [];
  const m = createMcpAuth({ codex: { accounts: () => [], server: () => srv, list: async () => [] }, fetchLocal: async u => { loaded.push(u); return 200; } });
  const f = await m.start({ provider: 'codex', account: { id: 'codex', name: 'Codex' }, name: 'latitude', local: false });
  assert.equal(f.state, 'waiting');
  await m.finish(f.id, 'http://localhost:45069/callback?code=zz&state=s1');
  assert.deepEqual(loaded, ['http://localhost:45069/callback?code=zz&state=s1']);
  for (const l of [...listeners]) l.onNotify('mcpServer/oauthLogin/completed', { name: 'other', success: true, loginId: 'L9' });
  assert.equal(m.flows()[0].state, 'waiting', 'another server’s news is ignored');
  for (const l of [...listeners]) l.onNotify('mcpServer/oauthLogin/completed', { name: 'latitude', success: false, error: 'access denied', loginId: 'L2' });
  assert.equal(m.flows()[0].state, 'failed');
  assert.equal(m.flows()[0].error, 'access denied');
});

test('mcpauth: each account’s list, from a helper that is stopped after, and kept for a minute', async () => {
  let spawned = 0, killed = 0;
  const spawnHelper = () => {
    spawned++;
    const proc = new EventEmitter();
    proc.stdin = new PassThrough(); proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
    proc.stdin.on('data', d => {
      for (const line of String(d).split('\n').filter(Boolean)) {
        const m = JSON.parse(line);
        const response = m.request.subtype === 'mcp_status' ? { mcpServers: [{ name: 'latitude', status: 'needs-auth', transport: 'http' }] } : {};
        proc.stdout.write(`${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response } })}\n`);
      }
    });
    return proc;
  };
  const m = createMcpAuth({ accounts: () => [{ id: 'main', name: 'Main' }], spawnHelper, kill: p => { killed++; p.emit('exit', 0); } });
  const all = await m.allAccounts();
  assert.deepEqual(all.map(a => [a.provider, a.accountName, a.servers.map(s => s.status)]), [['claude', 'Main', ['needs-auth']]]);
  assert.equal(spawned, 1); assert.equal(killed, 1);
  await m.allAccounts();
  assert.equal(spawned, 1, 'kept');
  await m.allAccounts(null, { fresh: true });
  assert.equal(spawned, 2);
});

test('mcpauth: a helper that stops fails what it was asked', async () => {
  const proc = new EventEmitter();
  proc.stdin = new PassThrough(); proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
  const conn = helperConn(proc, { kill: () => {} });
  const p = conn.request({ subtype: 'mcp_status' }, 2000);
  proc.stderr.write('Error: not signed in\n');
  proc.emit('exit', 1);
  await assert.rejects(p, /not signed in/);
  await assert.rejects(conn.request({ subtype: 'mcp_status' }), /stopped/);
});
