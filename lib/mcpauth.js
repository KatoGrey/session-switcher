'use strict';
// MCP sign-ins (OAuth), for servers like Latitude's, in Claude Code and in Codex.
//
// Claude Code keeps each sign-in in the account's own folder, so every account needs its own, and /mcp's
// sign-in can't run in the streaming mode the chats use (it needs a terminal to type in). Claude Code's own
// control requests do it instead:
//   mcp_status              which servers there are, and which need you (status "needs-auth")
//   mcp_authenticate        starts a sign-in: Claude Code answers with the link and waits on localhost for
//                           the browser to come back, then connects the server by itself
//   mcp_oauth_callback_url  finishes one opened on another device: the address that browser was sent to
//                           (and couldn't open, being another computer's localhost) is pasted back
//   mcp_reconnect           has a running chat connect again, after a sign-in made somewhere else
// A chat signs in through its own Claude Code, so the tools load right there. An account with no chat open
// gets a helper: Claude Code in the same mode with no message sent (so nothing is used), stopped after.
//
// Codex keeps its sign-ins in its home (one per Codex account). `codex mcp list --json` says which servers
// need one (auth_status, without starting any server), and its app server signs in: mcpServer/oauth/login
// gives the link and mcpServer/oauthLogin/completed says how it went. A sign-in opened on another device is
// finished by loading the pasted localhost address here, on the computer Codex is waiting on.
//
// Only one sign-in to a server at a time: each waits for the browser on the same local port.

const crypto = require('crypto');
const http = require('http');

const SIGN_IN = new Set(['http', 'sse', 'claudeai-proxy']);
const NAME = /^[^\u0000-\u001f"\\]{1,100}$/;
const WAIT_MS = 10 * 60 * 1000;       // how long a sign-in waits for you
const POLL_MS = 2000;                 // how often it looks whether it's done
const KEEP_DONE_MS = 2 * 60 * 1000;   // a finished one is still shown for a while
const CACHE_MS = 60 * 1000;           // each account's list, between looks

const hostOf = u => { try { return new URL(String(u)).host || null; } catch { return null; } };
const clip = (s, n = 300) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const bad = (status, message) => Object.assign(new Error(message), { status });

// What the page is told about one of Claude Code's servers: never its settings (headers can hold keys).
function view(s) {
  const x = s && typeof s === 'object' ? s : {};
  const transport = String(x.transport || (x.config && x.config.type) || 'stdio');
  return {
    name: String(x.name || ''),
    status: String(x.status || 'unknown'),   // connected, needs-auth, failed, pending, disabled
    transport,
    host: typeof x.urlHost === 'string' && x.urlHost ? x.urlHost : hostOf(x.config && x.config.url),
    scope: typeof x.scope === 'string' ? x.scope : null,
    claudeAi: transport === 'claudeai-proxy',
    canSignIn: SIGN_IN.has(transport),
    tools: Array.isArray(x.tools) ? x.tools.length : null,
    error: typeof x.error === 'string' ? clip(x.error) : null,
  };
}
// The same for one of Codex's, from `codex mcp list --json`. Codex says whether it's signed in, not
// whether it connects, so a signed-in one is "signed-in" rather than "connected".
function codexView(x) {
  const t = (x && x.transport) || {};
  const transport = t.type === 'streamable_http' ? 'http' : String(t.type || 'stdio');
  const auth = String((x && x.auth_status) || 'unknown');
  return {
    name: String((x && x.name) || ''),
    status: x && x.enabled === false ? 'disabled' : auth === 'not_logged_in' ? 'needs-auth' : auth === 'o_auth' || auth === 'bearer_token' ? 'signed-in' : 'unknown',
    transport, host: hostOf(t.url), scope: 'user', claudeAi: false,
    canSignIn: transport === 'http' && (auth === 'not_logged_in' || auth === 'o_auth'),
    auth, tools: null, error: null,
  };
}
// What a chat's card asks you about. claude.ai's own connectors (Gmail, Drive…) are connected on claude.ai, often on
// purpose not at all, so they don't raise a card in every chat; Connections and /mcp still list them.
const needsYou = s => s.status === 'needs-auth' && s.canSignIn && !s.claudeAi;

// Where a sign-in sends the browser back to (Claude Code's or Codex's own localhost address), from its link.
function redirectOf(authUrl) {
  try {
    const r = new URL(new URL(String(authUrl)).searchParams.get('redirect_uri') || '');
    return { port: Number(r.port) || (r.protocol === 'https:' ? 443 : 80), path: r.pathname };
  } catch { return null; }
}
// The address a browser on another device ended up on: that localhost address with the code (or the reason
// it was refused). Anything else is turned away before it goes near Claude Code or Codex.
function callbackUrl(text, flow) {
  let u;
  try { u = new URL(String(text || '').trim()); } catch { return null; }
  if (u.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return null;
  const want = flow && (flow.redirect || (flow.callbackPort ? { port: flow.callbackPort } : null));
  if (want && want.port && Number(u.port || 80) !== Number(want.port)) return null;
  if (want && want.path && u.pathname !== want.path) return null;
  if (!u.searchParams.get('code') && !u.searchParams.get('error')) return null;
  return u.toString();
}
// Loads that address here, where Codex is listening for it.
function loadLocal(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Codex didn’t answer the sign-in address.')));
    req.on('error', err => reject(new Error(/ECONNREFUSED/.test(err.message) ? 'Codex isn’t waiting for that sign-in any more. Start it again.' : err.message)));
  });
}

// Claude Code in its streaming mode, for asking and nothing else: control requests in, answers out.
function helperConn(proc, { label = 'helper', log = () => {}, kill = p => p.kill() } = {}) {
  const waiting = new Map();
  let seq = 0, buf = '', ended = false, stderr = '';
  const fail = msg => { for (const [, w] of waiting) { clearTimeout(w.timer); w.reject(new Error(msg)); } waiting.clear(); };
  const conn = {
    label, proc, helper: true,
    get ended() { return ended; },
    request(inner, timeoutMs = 15000) {
      return new Promise((resolve, reject) => {
        if (ended || !proc.stdin || !proc.stdin.writable) return reject(new Error('Claude Code stopped.'));
        const id = `mcp-${++seq}`;
        const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Claude Code didn’t answer in time.')); }, timeoutMs);
        waiting.set(id, { resolve, reject, timer });
        try { proc.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: id, request: inner })}\n`); }
        catch (err) { clearTimeout(timer); waiting.delete(id); reject(err); }
      });
    },
    stop() { if (ended) return; ended = true; try { proc.stdin.end(); } catch { /* gone */ } try { kill(proc); } catch { /* gone */ } fail('Claude Code stopped.'); },
    stderrTail: () => clip(stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(' '), 300),
  };
  proc.stdout.on('data', d => {
    buf += d;
    if (buf.length > 4 * 1024 * 1024) buf = buf.slice(-1024 * 1024);   // nothing it says here is that long
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line || line[0] !== '{') continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.type !== 'control_response') continue;
      const r = m.response || {}, w = waiting.get(r.request_id);
      if (!w) continue;
      clearTimeout(w.timer); waiting.delete(r.request_id);
      if (r.subtype === 'error') w.reject(new Error(r.error || 'Claude Code refused that.')); else w.resolve(r.response || {});
    }
  });
  if (proc.stderr) proc.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
  if (proc.stdin) proc.stdin.on('error', () => { /* it went away; exit says so */ });
  proc.on('error', err => { log(`MCP ${label}: ${err.message}`); ended = true; fail(`Couldn’t start Claude Code: ${err.message}`); });
  proc.on('exit', () => { ended = true; fail(stderr.trim() ? `Claude Code stopped: ${conn.stderrTail()}` : 'Claude Code stopped.'); });
  return conn;
}

// accounts(): the Claude accounts. spawnHelper(account, cwd): Claude Code in its streaming mode as that
// account. chatsOf(provider, accountId): its running chats (they have request() or nothing, and emit()).
// codex: { accounts(), server(accountId) (its app server: request() and listeners), list(accountId, cwd)
// (`codex mcp list --json`, parsed) }. openUrl(url): the default browser here. onChange(): something changed.
// kill(proc): stops a helper and what it started (on Windows, cmd.exe sits between us and Claude Code).
function createMcpAuth({ log = () => {}, accounts = () => [], spawnHelper, chatsOf = () => [], codex = null, openUrl = async () => ({}), onChange = () => {}, helperDir = null, now = () => Date.now(), waitMs = WAIT_MS, pollMs = POLL_MS, fetchLocal = loadLocal, kill = p => p.kill() } = {}) {
  const flows = new Map();      // id -> flow
  const helpers = new Set();    // helpers running now (stopped on quit)
  const lists = new Map();      // `${provider}\0${accountId}\0${cwd}` -> { at, servers, error }
  const pending = new Map();    // the same key -> the look in progress
  const chatState = new WeakMap();   // chat -> { need, servers, told, checkedAt, watching }
  const codexAccounts = () => (codex && codex.accounts ? codex.accounts() : []);

  async function startHelper(account, cwd) {
    const proc = spawnHelper(account, cwd || helperDir);
    const conn = helperConn(proc, { label: `helper for ${account.name}`, log, kill });
    helpers.add(conn);
    proc.on('exit', () => helpers.delete(conn));
    try { await conn.request({ subtype: 'initialize' }, 30000); }
    catch (err) { conn.stop(); throw err; }
    return conn;
  }

  // Asks Claude Code for the list, again for a few seconds while servers are still connecting (claude.ai's
  // own connectors join the list a moment after the rest).
  async function status(conn, { settleMs = 0, minMs = 0 } = {}) {
    const t0 = now();
    for (;;) {
      const r = await conn.request({ subtype: 'mcp_status' }, 15000);
      const servers = (Array.isArray(r.mcpServers) ? r.mcpServers : []).map(view).filter(s => s.name);
      const waited = now() - t0;
      if (waited >= settleMs || (waited >= minMs && !servers.some(s => s.status === 'pending'))) return servers;
      await new Promise(res => setTimeout(res, 700));
    }
  }

  // One account's servers, as its own Claude Code (a helper) or Codex says. Kept for a minute.
  function accountStatus(provider, account, cwd = null, { fresh = false } = {}) {
    const key = `${provider}\0${account.id}\0${cwd || ''}`;
    const hit = lists.get(key);
    if (!fresh && hit && now() - hit.at < CACHE_MS) return Promise.resolve(hit);
    if (pending.has(key)) return pending.get(key);
    const p = (async () => {
      let conn = null;
      try {
        let servers;
        if (provider === 'codex') servers = (await codex.list(account.id, cwd)).map(codexView).filter(s => s.name);
        else { conn = await startHelper(account, cwd); servers = await status(conn, { settleMs: 8000, minMs: 2500 }); }
        const out = { at: now(), servers, error: null };
        lists.set(key, out);
        return out;
      } catch (err) {
        const out = { at: now(), servers: hit ? hit.servers : [], error: clip(err.message) || 'It didn’t say.' };
        lists.set(key, out);
        return out;
      } finally { if (conn) conn.stop(); pending.delete(key); }
    })();
    pending.set(key, p);
    return p;
  }
  // Every account of both: [{ provider, accountId, accountName, at, error, servers }].
  async function allAccounts(cwd = null, opts = {}) {
    const all = [...accounts().map(a => ['claude', a]), ...codexAccounts().map(a => ['codex', a])];
    const got = await Promise.all(all.map(([p, a]) => accountStatus(p, a, cwd, opts)));
    return all.map(([provider, a], i) => ({ provider, accountId: a.id, accountName: a.name, at: got[i].at, error: got[i].error, servers: got[i].servers }));
  }
  const forget = (provider, accountId) => { for (const k of [...lists.keys()]) if ((!provider || k.startsWith(`${provider}\0`)) && (!accountId || k.split('\0')[1] === accountId)) lists.delete(k); };

  // ---------- sign-ins ----------

  const publicFlow = f => ({ id: f.id, provider: f.provider, accountId: f.accountId, accountName: f.accountName, name: f.name, chatKey: f.chatKey, state: f.state, authUrl: f.authUrl, host: f.host, callbackExpected: f.callbackExpected, opened: f.opened, error: f.error, startedAt: f.startedAt, endedAt: f.endedAt || null });
  function list() {
    const t = now();
    for (const [id, f] of flows) if (f.endedAt && t - f.endedAt > KEEP_DONE_MS) flows.delete(id);
    return [...flows.values()].map(publicFlow);
  }
  function changed(f) {
    onChange();
    if (f) for (const chat of chatsOf(f.provider, f.accountId)) tellChat(chat);
  }
  function end(f, state, error = null) {
    if (f.endedAt) return;
    Object.assign(f, { state, error, endedAt: now() });
    clearTimeout(f.timer); clearTimeout(f.poll);
    if (f.conn && f.conn.helper) f.conn.stop();
    if (f.unlisten) f.unlisten();
    log(`MCP sign-in to ${f.name} as ${f.accountName}: ${state}${error ? ` (${error})` : ''}`);
    if (state === 'done') afterSignIn(f).catch(err => log(`MCP: after signing in to ${f.name}: ${err.message}`));
    changed(f);
  }

  // Starts one, in a chat's own Claude Code, a helper, or Codex's app server. Another sign-in to the same
  // server, anywhere, gives way to it: both would wait for the browser on the same local port.
  async function start({ provider = 'claude', account, name, chat = null, cwd = null, local = true }) {
    if (!account) throw bad(400, 'Pick an account.');
    if (!NAME.test(String(name || ''))) throw bad(400, 'That server’s name can’t be used here.');
    if (provider === 'codex' && !codex) throw bad(409, 'Codex isn’t set up here.');
    for (const f of flows.values()) {
      if (f.name !== name || f.endedAt) continue;
      end(f, 'cancelled', f.provider === provider && f.accountId === account.id ? null : `A sign-in as ${account.name} took over.`);
    }
    // From Connections, with a chat open on the account that's waiting for this server: through that chat,
    // so its tools load right there (the account's other chats connect again afterwards either way).
    if (!chat && provider === 'claude') chat = chatsOf('claude', account.id).find(c => c.state !== 'ended' && typeof c.request === 'function' && ((chatState.get(c) || {}).need || []).some(s => s.name === name)) || null;
    const f = { id: crypto.randomBytes(6).toString('hex'), provider, accountId: account.id, accountName: account.name, name, chatKey: chat ? chat.key : null, state: 'starting', authUrl: null, host: null, callbackExpected: true, callbackPort: null, redirect: null, opened: false, error: null, startedAt: now(), conn: provider === 'claude' ? chat : null };
    flows.set(f.id, f);
    changed(f);
    try {
      if (provider === 'codex') await startCodex(f, account);
      else await startClaude(f, account, cwd);
      if (f.endedAt) return publicFlow(f);
      f.host = hostOf(f.authUrl);
      f.redirect = redirectOf(f.authUrl);
      if (local && /^https:\/\//i.test(f.authUrl || '')) {
        const o = await openUrl(f.authUrl).catch(err => ({ ok: false, error: err.message }));
        f.opened = !!(o && (o.ok || o.dryRun));
      }
      if (f.state === 'elsewhere') {
        // A claude.ai connector: it's connected on claude.ai, and new chats pick it up from there.
        if (f.conn && f.conn.helper) f.conn.stop();
        f.timer = setTimeout(() => end(f, 'elsewhere-done'), 20000);
      } else {
        f.timer = setTimeout(() => end(f, 'failed', 'The sign-in wasn’t finished in time. Start it again when you’re ready.'), waitMs);
        if (provider === 'claude') watch(f);
      }
      changed(f);
    } catch (err) {
      end(f, 'failed', clip(err.message) || 'The sign-in couldn’t start.');
    }
    return publicFlow(f);
  }
  async function startClaude(f, account, cwd) {
    if (!f.conn) f.conn = await startHelper(account, cwd);
    if (f.endedAt) return;
    const r = await f.conn.request({ subtype: 'mcp_authenticate', serverName: f.name }, 60000);
    if (f.endedAt) return;
    if (r.requiresUserAction === false || !r.authUrl) { end(f, 'done'); return; }
    Object.assign(f, { state: r.callbackExpected === false ? 'elsewhere' : 'waiting', authUrl: String(r.authUrl), callbackExpected: r.callbackExpected !== false, callbackPort: Number(r.callbackPort) || null });
  }
  async function startCodex(f, account) {
    const srv = codex.server(account.id);
    if (!srv) throw bad(404, 'That Codex account isn’t in the list any more.');
    // Its answer can come before the request's own reply does: listen first.
    let loginId = null;
    const early = [];
    const listener = {
      onNotify(method, p) {
        if (method !== 'mcpServer/oauthLogin/completed' || !p || p.name !== f.name) return;
        if (loginId === null) { early.push(p); return; }
        if (p.loginId && loginId && p.loginId !== loginId) return;
        settle(p);
      },
      onDied() { if (!f.endedAt) end(f, 'failed', 'Codex stopped before the sign-in finished.'); },
    };
    const settle = p => {
      if (f.endedAt) return;
      if (p.success) end(f, 'done'); else end(f, 'failed', clip(p.error) || 'Codex says the sign-in didn’t finish.');
    };
    srv.listeners.add(listener);
    f.unlisten = () => srv.listeners.delete(listener);
    const r = await srv.request('mcpServer/oauth/login', { name: f.name, timeoutSecs: Math.round(waitMs / 1000) }, 60000);
    loginId = (r && r.loginId) || '';
    if (f.endedAt) return;
    if (!r || !r.authorizationUrl) throw new Error('Codex didn’t give a sign-in link.');
    Object.assign(f, { state: 'waiting', authUrl: String(r.authorizationUrl) });
    for (const p of early.splice(0)) if (!p.loginId || !loginId || p.loginId === loginId) settle(p);
  }

  // Claude Code connects the server once the browser is back; this waits until it says so.
  function watch(f) {
    const tick = async () => {
      if (f.endedAt) return;
      if (f.conn.ended || f.conn.state === 'ended') return end(f, 'failed', 'Claude Code stopped before the sign-in finished.');
      try {
        const servers = await status(f.conn);
        const s = servers.find(x => x.name === f.name);
        if (s && s.status === 'connected') return end(f, 'done');
        if (s && s.status === 'failed') return end(f, 'failed', s.error || `Signed in, but ${f.name} didn’t connect.`);
      } catch { /* asked again next time */ }
      if (!f.endedAt) f.poll = setTimeout(tick, pollMs);
    };
    f.poll = setTimeout(tick, pollMs);
  }

  async function finish(id, text) {
    const f = flows.get(String(id || ''));
    if (!f || f.endedAt) throw bad(404, 'That sign-in has finished. Start it again.');
    const url = callbackUrl(text, f);
    if (!url) throw bad(400, 'That isn’t the address the sign-in sent your browser to. Copy the whole address from the page that wouldn’t load (it starts with http://localhost).');
    if (f.provider === 'codex') { await fetchLocal(url); return publicFlow(f); }
    await f.conn.request({ subtype: 'mcp_oauth_callback_url', serverName: f.name, callbackUrl: url }, 60000);
    clearTimeout(f.poll); watch(f);
    return publicFlow(f);
  }
  function cancel(id) {
    const f = flows.get(String(id || ''));
    if (f && !f.endedAt) end(f, 'cancelled');
    return f ? publicFlow(f) : null;
  }
  // Opens its page in this computer's browser again.
  async function reopen(id) {
    const f = flows.get(String(id || ''));
    if (!f || !f.authUrl || f.endedAt) throw bad(404, 'That sign-in has finished. Start it again.');
    const o = await openUrl(f.authUrl);
    if (o && o.ok === false) throw bad(500, o.error || 'Couldn’t open the browser.');
    f.opened = true;
    return publicFlow(f);
  }

  // Signed in: the account's list is out of date, and its other chats connect again (each one's Claude Code
  // reads the new sign-in when it reconnects; Codex reloads its servers); then each is asked how it went.
  async function afterSignIn(f) {
    forget(f.provider, f.accountId);
    if (f.provider === 'codex') {
      try { await codex.server(f.accountId).request('config/mcpServer/reload', {}, 30000); } catch (err) { log(`MCP: Codex didn’t reload its servers: ${err.message}`); }
    } else {
      const others = chatsOf('claude', f.accountId).filter(c => c !== f.conn && c.state !== 'ended');
      await Promise.all(others.map(async c => {
        const st = chatState.get(c);
        if (st && st.need && !st.need.some(s => s.name === f.name)) return;
        try { await c.request({ subtype: 'mcp_reconnect', serverName: f.name }, 30000); } catch (err) { log(`MCP: ${f.name} didn’t reconnect in chat ${c.key}: ${err.message}`); }
      }));
    }
    for (const c of chatsOf(f.provider, f.accountId)) setTimeout(() => recheck(c, { force: true, ask: f.provider === 'codex' }), c === f.conn ? 0 : 2500);
  }

  // ---------- chats ----------

  const chatProvider = chat => chat.provider || 'claude';
  // What a chat's card shows: the servers that need you, and this account's sign-ins.
  function chatView(chat) {
    const st = chatState.get(chat) || {};
    const p = chatProvider(chat);
    const mine = list().filter(f => f.provider === p && f.accountId === chat.account.id);
    return { kind: 'mcp', provider: p, accountId: chat.account.id, accountName: chat.account.name, need: st.need || [], flows: mine };
  }
  function tellChat(chat) {
    if (!chat || chat.state === 'ended' || typeof chat.emit !== 'function') return;
    const v = chatView(chat);
    const sig = JSON.stringify([v.need.map(s => s.name), v.flows.map(f => [f.id, f.state, f.error, f.opened])]);
    const st = chatState.get(chat) || {};
    if (st.told === sig) return;
    // Nothing to say, and nothing said before: no card at all.
    if (!st.told && !v.need.length && !v.flows.length) { st.told = sig; chatState.set(chat, st); return; }
    st.told = sig; chatState.set(chat, st);
    chat.emit(v);
  }
  // Looks at a chat's servers (as it starts, after a reply, after a sign-in). At most every 20 s unless forced.
  // A Codex chat goes by its account's list as Connections last saw it (Codex is only asked by /mcp, ask):
  // starting a Codex process every time a Codex chat opens would cost more than the card is worth.
  async function recheck(chat, { force = false, ask = false } = {}) {
    const p = chat && chatProvider(chat);
    if (!chat || chat.state === 'ended' || chat.state === 'starting' || (p !== 'claude' && p !== 'codex')) return null;
    if (p === 'claude' && typeof chat.request !== 'function') return null;
    if (p === 'codex' && !codex) return null;
    const st = chatState.get(chat) || {};
    if (!force && st.checkedAt && now() - st.checkedAt < 20000) return st.need || [];
    st.checkedAt = now(); chatState.set(chat, st);
    try {
      // (Codex's list is the same in every folder; asked from home, so nothing holds the chat's folder open.)
      let servers;
      if (p === 'codex') {
        const hit = lists.get(`codex\0${chat.account.id}\0`);
        if (!ask && !hit) return st.need || [];
        servers = ask ? (await accountStatus('codex', chat.account, null)).servers : hit.servers;
      } else servers = await status(chat);
      st.servers = servers;
      st.need = servers.filter(needsYou);
      tellChat(chat);
      return st.need;
    } catch { return st.need || []; }
  }
  // A chat that's just ready: now, and (Claude) again once slower servers have had a few seconds.
  function watchChat(chat) {
    const st = chatState.get(chat) || {};
    if (st.watching) return;
    st.watching = true; chatState.set(chat, st);
    recheck(chat, { force: true });
    if (chatProvider(chat) === 'claude') setTimeout(() => recheck(chat, { force: true }), 6000);
  }
  // The chat's own list, for /mcp in it.
  async function chatServers(chat) {
    await recheck(chat, { force: true, ask: true });
    const st = chatState.get(chat) || {};
    const p = chatProvider(chat);
    return { provider: p, accountId: chat.account.id, accountName: chat.account.name, servers: st.servers || [], flows: list().filter(f => f.provider === p && f.accountId === chat.account.id) };
  }
  async function reconnect(chat, name) {
    if (!NAME.test(String(name || ''))) throw bad(400, 'That server’s name can’t be used here.');
    if (chatProvider(chat) === 'codex') await codex.server(chat.account.id).request('config/mcpServer/reload', {}, 30000);
    else await chat.request({ subtype: 'mcp_reconnect', serverName: name }, 45000);
    return chatServers(chat);
  }

  function stopAll() {
    for (const f of flows.values()) if (!f.endedAt) { clearTimeout(f.timer); clearTimeout(f.poll); if (f.unlisten) f.unlisten(); }
    for (const h of [...helpers]) h.stop();
  }

  return { status, accountStatus, allAccounts, forget, start, finish, cancel, reopen, flows: list, chatView, recheck, watchChat, chatServers, reconnect, stopAll };
}

module.exports = { createMcpAuth, helperConn, view, codexView, callbackUrl, redirectOf, needsYou, NAME };
