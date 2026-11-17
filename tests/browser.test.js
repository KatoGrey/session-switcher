'use strict';
// The built-in browser's server side (lib/browser.js): which chats get its tools and how, whose tabs a key reaches,
// and the tools themselves, against a stand-in for the desktop app's tabs (desktop/shell/browser.js). Then the MCP
// server a chat starts (lib/browser-mcp.js), against a stand-in for the app's route. The tabs themselves (offscreen
// rendering, input, frames) need Electron, so they're checked in a real desktop copy, not here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
require('../lib/electron-node');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const browserLib = require('../lib/browser');
const S = require('../lib/browser-scripts');
const { TOOLS } = require('../lib/browser-tools');

const tmp = name => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), name))); test.after(() => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }); return d; };

// The desktop app's tabs, pretend: answers the ops lib/browser.js sends over IPC.
function standIn() {
  const tabs = [], calls = [];
  let n = 0;
  const host = {
    calls, tabs,
    isolated: () => null, // set per test: (code) => value
    handle(op, a) {
      calls.push([op, a]);
      const info = t => ({ ...t, current: t.current });
      switch (op) {
        case 'list': return tabs.filter(t => !a.owner || t.owner === a.owner).map(info);
        case 'current': {
          if (a.id) { for (const t of tabs) if (t.owner === a.owner || t.id === a.id) t.current = t.id === a.id; return info(tabs.find(t => t.id === a.id)); }
          const t = tabs.find(x => x.owner === a.owner && x.current); return t ? info(t) : null;
        }
        case 'create': { for (const t of tabs) if (t.owner === a.owner) t.current = false; const t = { id: `t${++n}`, owner: a.owner, url: a.url || 'about:blank', title: '', current: true, size: { w: 1280, h: 800, preset: 'desktop', mobile: false }, created: Date.now(), lastAgent: 0 }; tabs.push(t); return info(t); }
        case 'navigate': { const t = tabs.find(x => x.id === a.id); t.url = a.where; t.title = 'A page'; return { ok: true, url: a.where, title: 'A page' }; }
        case 'close': tabs.splice(tabs.findIndex(x => x.id === a.id), 1); return true;
        case 'isolated': return host.isolated(a.code);
        case 'cdp': return a.method === 'Runtime.evaluate' ? { result: { type: 'number', value: 42 } } : {};
        case 'capture': return { data: Buffer.from('jpeg').toString('base64'), width: a.width || 1280, height: 800, viewport: { w: 1280, h: 800 } };
        case 'logs': return a.kind === 'network' ? [{ rid: '1', method: 'POST', url: 'https://api.example/graphql', status: 500, type: 'Fetch', ms: 30, at: 1 }, { rid: '2', method: 'GET', url: 'https://x/ok', status: 200, type: 'Fetch', ms: 3, at: 2 }] : [];
        case 'activity': case 'resize': case 'dialogs': return true;
        default: throw new Error(`stand-in: no ${op}`);
      }
    },
  };
  return host;
}
// lib/browser.js running as if under the desktop app: its process.send reaches the stand-in.
function withHost(t, opts = {}) {
  const host = standIn();
  const dataDir = tmp('ss-br-data-');
  const had = process.send;
  let br;
  process.send = msg => { setImmediate(() => { let r; try { r = { ok: true, result: host.handle(msg.op, msg.args || {}) }; } catch (err) { r = { ok: false, error: err.message }; } Promise.resolve(r.result).then(result => br.onMessage({ type: 'browser:result', id: msg.id, ...r, result })); }); };
  t.after(() => { process.send = had; });
  br = browserLib.createBrowser({ dataDir, port: 4799, execPath: '/node', shell: 'electron', getPrefs: () => opts.prefs || {}, chatByKey: opts.chatByKey || (() => null) });
  return { br, host, dataDir };
}
const chatLike = (o = {}) => ({ key: o.key || 'k1', sessionId: o.sessionId === undefined ? 'AAAA-1111' : o.sessionId, account: { id: 'main', provider: o.provider }, extraArgs: o.extraArgs || [], ...o });

test('browser: which browser chats get, from Setup’s choice', () => {
  assert.equal(browserLib.browserPref({}, true), 'both', 'in the desktop app: its own browser, and Chrome for anyone who uses it');
  assert.equal(browserLib.browserPref({ chromeInChats: false }, true), 'app', 'Chrome turned off before: just its own');
  assert.equal(browserLib.browserPref({}, false), 'chrome', 'elsewhere: Chrome, as before');
  assert.equal(browserLib.browserPref({ chromeInChats: false }, false), 'off', 'the old "no Chrome" still holds');
  assert.equal(browserLib.browserPref({ browser: 'both' }, true), 'both');
  assert.equal(browserLib.browserPref({ browser: 'app' }, false), 'chrome', 'no built-in browser without the desktop app');
  assert.equal(browserLib.browserPref({ browser: 'off' }, true), 'off');
});

test('browser: Claude and Codex chats get the tools, each with its own key; others don’t', t => {
  const { br, dataDir } = withHost(t);
  const claude = chatLike();
  br.prepare(claude);
  const i = claude.extraArgs.indexOf('--mcp-config');
  assert.ok(i >= 0, 'a Claude chat gets an MCP config');
  const cfg = JSON.parse(fs.readFileSync(claude.extraArgs[i + 1], 'utf8'));
  const srv = cfg.mcpServers['app-browser'];
  assert.equal(srv.env.SWITCHER_BROWSER_KEY, claude.browserKey);
  assert.match(srv.args[0], /browser-mcp\.js$/);
  assert.equal(srv.env.SWITCHER_URL, 'http://127.0.0.1:4799');
  assert.deepEqual(claude.extraArgs.slice(i + 2), ['--allowedTools', 'mcp__app-browser'], 'its tools never ask');
  const codex = chatLike({ key: 'k2', sessionId: null, provider: 'codex' });
  br.prepare(codex);
  assert.equal(codex.threadConfig['mcp_servers.app-browser'].env.SWITCHER_BROWSER_KEY, codex.browserKey, 'a Codex chat gets it in its thread’s config');
  assert.notEqual(codex.browserKey, claude.browserKey);
  for (const other of [chatLike({ provider: 'gemini' }), chatLike({ aide: true }), chatLike({ extraArgs: ['--strict-mcp-config'] }), chatLike({ extraArgs: ['--mcp-config', 'x.json'] })]) {
    const before = [...other.extraArgs];
    br.prepare(other);
    assert.deepEqual(other.extraArgs, before, 'Gemini, the companion and the Commander keep their own tools');
    assert.equal(other.threadConfig, undefined);
  }
  // Carried over a restart: the key is known again, nothing is added twice.
  const again = chatLike({ browserKey: claude.browserKey, extraArgs: [...claude.extraArgs] });
  br.prepare(again, true);
  assert.deepEqual(again.extraArgs, claude.extraArgs);
  assert.equal(br.ownerOf(claude.browserKey), 'aaaa-1111', 'and its key still reaches its tabs');
  void dataDir;
});

test('browser: a key reaches its own chat’s tabs; a partner shares its lead’s; an unknown key nothing', async t => {
  const lead = chatLike({ key: 'lead', sessionId: 'LEAD-1' });
  const partner = chatLike({ key: 'p', sessionId: 'PARTNER-2', provider: 'codex', parentKey: 'lead' });
  const fresh = chatLike({ key: 'new', sessionId: null });
  const byKey = { lead, p: partner, new: fresh };
  const { br } = withHost(t, { chatByKey: k => byKey[k] || null });
  for (const c of [lead, partner, fresh]) br.prepare(c);
  assert.equal(br.ownerOf(lead.browserKey), 'lead-1');
  assert.equal(br.ownerOf(partner.browserKey), 'lead-1', 'Claude and Codex in one chat use one set of tabs');
  assert.equal(br.ownerOf(fresh.browserKey), 'key:new', 'before its session id is known');
  fresh.sessionId = 'NEW-3';
  assert.equal(br.ownerOf(fresh.browserKey), 'new-3', 'and its own once it is');
  assert.throws(() => br.ownerOf('f'.repeat(40)), e => e.status === 403);
  const r = await br.callTool.call(null, lead.browserKey, 'nope', {});
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /no browser tool called nope/);
});

test('browser: the tools, against a stand-in for the tabs', async t => {
  const c = chatLike({ key: 'c', sessionId: 'S-1' });
  const { br, host } = withHost(t, { chatByKey: k => (k === 'c' ? c : null) });
  br.prepare(c);
  const call = (name, args) => br.callTool(c.browserKey, name, args);
  const text = r => r.content.map(x => x.text || '').join('\n');

  let r = await call('screenshot', {});
  assert.equal(r.isError, true, 'nothing to look at before a tab is open');
  assert.match(text(r), /no tab open yet/);

  r = await call('navigate', { url: 'voyage.io' });
  assert.ok(!r.isError, text(r));
  assert.match(text(r), /Opened: A page \(voyage\.io\)/);
  assert.equal(host.tabs.length, 1, 'navigate opens a tab when there is none');
  assert.equal(host.tabs[0].owner, 's-1');

  // click by ref: the page says where the element is, and real mouse events go there.
  host.isolated = code => (/function pointOf/.test(code) ? { __ok: { x: 210, y: 150, label: 'button "Press me"', ref: 'e4', covered: null, disabled: false } } : { __ok: null });
  host.calls.length = 0;
  r = await call('click', { ref: 'e4' });
  assert.match(text(r), /Clicked button "Press me" \[e4\] at 210,150/);
  const mouse = host.calls.filter(([op, a]) => op === 'cdp' && a.method === 'Input.dispatchMouseEvent').map(([, a]) => `${a.params.type}@${a.params.x},${a.params.y}`);
  assert.deepEqual(mouse, ['mouseMoved@210,150', 'mousePressed@210,150', 'mouseReleased@210,150']);
  assert.ok(host.calls.some(([op, a]) => op === 'activity' && a.kind === 'click' && a.x === 210), 'the page beside the chat is told where it clicked');

  // A page script's own error comes back in its own words.
  host.isolated = () => ({ __err: 'There’s no element e9 on this page' });
  r = await call('click', { ref: 'e9' });
  assert.equal(r.isError, true);
  assert.match(text(r), /no element e9/);

  // Keys: names, modifiers, characters.
  host.calls.length = 0;
  await call('key', { keys: 'ctrl+a Enter space' });
  const keys = host.calls.filter(([op, a]) => op === 'cdp' && a.method === 'Input.dispatchKeyEvent').map(([, a]) => `${a.params.type}:${a.params.key}:${a.params.modifiers}${a.params.text ? `:${JSON.stringify(a.params.text)}` : ''}`);
  assert.deepEqual(keys, ['rawKeyDown:a:2', 'keyUp:a:2', 'keyDown:Enter:0:"\\r"', 'keyUp:Enter:0', 'keyDown: :0:" "', 'keyUp: :0']);
  r = await call('key', { keys: 'hyper+q' });
  assert.equal(r.isError, true, 'an unknown key name says so');

  // Off the page: a click outside it is refused.
  r = await call('click', { x: 5000, y: 10 });
  assert.match(text(r), /outside the page/);

  // A screenshot: the picture, and how its coordinates map.
  r = await call('screenshot', { scale: 0.5 });
  assert.equal(r.content[1].type, 'image');
  assert.match(text(r), /the page is 1280×800, so to click what you see at x,y use x\/0\.50/);

  // Network: failed requests first-class, and a body on request.
  r = await call('network', { failed_only: true });
  assert.match(text(r), /#0 POST https:\/\/api\.example\/graphql → 500/);
  assert.doesNotMatch(text(r), /x\/ok/);

  // JavaScript runs in the page and its value comes back.
  r = await call('javascript', { code: '6*7' });
  assert.equal(text(r), '42');

  // A batch: in order, stopping at the first that fails.
  host.isolated = code => (/function pointOf/.test(code) ? { __err: 'Nothing clickable on the page says “Missing”.' } : { __ok: 'Page text' });
  r = await call('batch', { actions: [{ tool: 'page_text' }, { tool: 'click', text: 'Missing' }, { tool: 'page_text' }] });
  const lines = text(r).split('\n');
  assert.match(lines[0], /^1\. page_text: /);
  assert.match(text(r), /2\. click failed: Nothing clickable on the page says “Missing”\. Stopped\./);
  assert.doesNotMatch(text(r), /^3\./m, 'nothing after a failure');

  // Tabs: listed, and only this chat's.
  host.tabs.push({ id: 't99', owner: 'someone-else', url: 'https://other', title: 'Not mine', current: true, size: { w: 1280, h: 800, preset: 'desktop' }, created: 0 });
  r = await call('tabs', {});
  assert.match(text(r), /t1 \(current\)/);
  assert.doesNotMatch(text(r), /Not mine/);
  r = await call('close_tab', { tab: 't99' });
  assert.equal(r.isError, true, 'another chat’s tab can’t be closed from here');
  assert.ok(host.tabs.some(x => x.id === 't99'));
});

test('browser: every tool has a description and an input schema, and the page scripts compile', () => {
  for (const tool of TOOLS) {
    assert.ok(tool.description && tool.description.length > 20, tool.name);
    assert.equal(tool.inputSchema.type, 'object', tool.name);
  }
  for (const fn of [S.readPage, S.findEls, S.pointOf, S.focusField, S.setValue, S.pageText, S.waitCheck, S.scrollInfo, S.voyageStatus, S.voyagePhase, S.voyageSkip, S.voyageStory, S.voyageInput, S.voyageSent, S.voyageSetupStep]) assert.doesNotThrow(() => new Function(S.call(fn, {})), fn.name);
  assert.equal(S.unwrap({ __ok: 3 }), 3);
  assert.throws(() => S.unwrap({ __err: 'said so' }), /said so/);
});

test('browser: the MCP server a chat starts passes calls on with the chat’s key', async t => {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      seen.push({ url: req.url, key: req.headers['x-switcher-browser'], body: JSON.parse(body) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'text', text: 'done it' }] }));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  const key = 'a'.repeat(40);
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'lib', 'browser-mcp.js')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SWITCHER_URL: `http://127.0.0.1:${srv.address().port}`, SWITCHER_BROWSER_KEY: key }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { try { p.kill(); } catch { /* gone */ } });
  const replies = [];
  let buf = '';
  p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { replies.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const ask = msg => p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
  const reply = async id => { for (let i = 0; i < 200; i++) { const r = replies.find(x => x.id === id); if (r) return r; await new Promise(res => setTimeout(res, 25)); } throw new Error(`no reply ${id}`); };
  ask({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal((await reply(1)).result.serverInfo.name, 'app-browser');
  ask({ method: 'notifications/initialized' });
  ask({ id: 2, method: 'tools/list' });
  const names = (await reply(2)).result.tools.map(x => x.name);
  assert.ok(names.includes('navigate') && names.includes('voyage_act'));
  ask({ id: 3, method: 'tools/call', params: { name: 'navigate', arguments: { url: 'voyage.io' } } });
  assert.equal((await reply(3)).result.content[0].text, 'done it');
  assert.deepEqual(seen[0], { url: '/api/browser/tool', key, body: { name: 'navigate', arguments: { url: 'voyage.io' } } });
});

test('browser: in Plan mode (or Codex read-only) the browser only reads; a fork gets tabs of its own', async t => {
  const c = chatLike({ key: 'p', sessionId: 'S-PLAN', permissionMode: 'plan' });
  const { br, host } = withHost(t, { chatByKey: k => (k === 'p' ? c : null) });
  br.prepare(c);
  const call = (name, args) => br.callTool(c.browserKey, name, args);
  const text = r => r.content.map(x => x.text || '').join('\n');
  let r = await call('navigate', { url: 'voyage.io' });
  assert.ok(!r.isError, 'opening a page to read is fine');
  host.isolated = () => ({ __ok: 'some text' });
  r = await call('page_text', {});
  assert.ok(!r.isError);
  for (const [name, args] of [['click', { x: 5, y: 5 }], ['type', { text: 'hi' }], ['javascript', { code: '1' }], ['voyage_act', { action: 'I wave' }], ['batch', { actions: [{ tool: 'page_text' }, { tool: 'click', x: 1, y: 1 }] }]]) {
    r = await call(name, args);
    assert.equal(r.isError, true, name);
    assert.match(text(r), /Plan mode/, name);
  }
  r = await call('batch', { actions: [{ tool: 'page_text' }, { tool: 'read_page' }] });
  assert.ok(!r.isError, 'a batch that only reads goes ahead');
  c.permissionMode = 'default';
  r = await call('click', { x: 5, y: 5 });
  assert.ok(!r.isError, text(r));
  // Forked (or cleared): the chat now has an id of its own, and so do its tabs.
  c.sessionId = 'S-FORK';
  assert.equal(br.ownerOf(c.browserKey), 's-fork');
});
