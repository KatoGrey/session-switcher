'use strict';
/* Connections: signing in to the tools (MCP servers) that need it, like Latitude's, for every Claude account
   and every Codex account, in one table. In a chat, a card offers the sign-in when one of its servers needs
   you, and /mcp lists the chat's servers. The sign-ins happen in Claude Code and Codex themselves
   (lib/mcpauth.js): the page they give opens in your browser, and once you approve, the tools are there. */

const Conn = { cwd: null, data: null, flows: [], err: null, loading: false, mode: 'all', chatKey: null, chatSrc: 'main', chat: null, queue: [], qFlow: null };
const MCP_WHO = { claude: 'Claude', codex: 'Codex' };
const flowLive = f => f && (f.state === 'starting' || f.state === 'waiting' || f.state === 'elsewhere');
// The sign-in for this account and server worth showing: one going on, or one that ended a moment ago.
function mcpFlowFor(flows, provider, accountId, name) {
  const mine = (flows || []).filter(f => f.provider === provider && f.accountId === accountId && f.name === name && f.state !== 'cancelled');
  return mine.find(flowLive) || mine.filter(f => f.endedAt && Date.now() - f.endedAt < 90000).sort((a, b) => b.endedAt - a.endedAt)[0] || null;
}

// One sign-in, as the dialog, the chat card and /mcp show it. at: the attribute their buttons use.
function mcpFlowHtml(f, at = 'data-cn') {
  const who = `<b>${esc(f.name)}</b>`;
  if (f.state === 'starting') return `<p class="mcp-wait"><span class="gen-spin" aria-hidden="true"></span><span>Asking ${esc(MCP_WHO[f.provider] || 'it')} for ${who}’s sign-in page…</span></p>`;
  if (f.state === 'done') return `<p class="mcp-ok">✓ Signed in to ${who} as ${esc(f.accountName)}.</p>`;
  if (f.state === 'failed') return `<p class="mcp-err">${esc(f.error || 'The sign-in didn’t finish.')}</p>`;
  if (f.state === 'elsewhere' || f.state === 'elsewhere-done') return `<p class="mcp-wait"><span>${who} is a claude.ai connector: connect it on claude.ai, and new chats pick it up from there.</span></p><div class="lm-b"><a class="btn sm" href="${esc(f.authUrl)}" target="_blank" rel="noopener noreferrer">Open claude.ai</a></div>`;
  if (f.state !== 'waiting') return '';
  const link = `<a class="btn ${f.opened ? '' : 'prime '}sm" href="${esc(f.authUrl)}" target="_blank" rel="noopener noreferrer">${f.opened ? 'Open the page again' : 'Open the sign-in page'}</a>`;
  return `<p class="mcp-wait"><span class="gen-spin" aria-hidden="true"></span><span>${f.opened ? `The sign-in page for ${who} opened in your browser` : `Sign in to ${who} on its page`}${f.host ? ` (${esc(f.host)})` : ''}. Approve it there; this updates by itself.</span></p>
    <div class="lm-b">${link}<button type="button" class="btn quiet sm" ${at}="mcpcopy" data-url="${esc(f.authUrl)}">Copy link</button><button type="button" class="btn quiet sm" ${at}="mcpcancel" data-id="${esc(f.id)}">Cancel</button></div>
    <details class="mcp-paste"${window.REMOTE ? ' open' : ''}><summary>Signing in on another device?</summary>
      <p>Open the link there and approve. That browser then lands on a page that won’t load (its address starts with <code>http://localhost</code>). Copy that whole address and paste it here:</p>
      <div class="mcp-paste-row"><input type="url" spellcheck="false" autocomplete="off" placeholder="http://localhost:…/callback?code=…" aria-label="The address the browser landed on" data-paste="${esc(f.id)}"><button type="button" class="btn sm" ${at}="mcppaste" data-id="${esc(f.id)}">Finish</button></div>
    </details>`;
}
// The buttons every sign-in has, wherever it's shown.
async function mcpFlowAction(act, b) {
  if (act === 'mcpcopy') { const ok = await copyText(b.dataset.url, null); if (ok) { b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = 'Copy link'; }, 1500); } return true; }
  if (act === 'mcpcancel') { await api('/api/connections/cancel', { id: b.dataset.id }); return true; }
  if (act === 'mcppaste') {
    const box = b.closest('.mcp-paste-row').querySelector('input');
    const url = box.value.trim();
    if (!url) { box.focus(); toast('Paste the address your browser landed on first.'); return true; }
    b.disabled = true;
    try { await api('/api/connections/finish', { id: b.dataset.id, url }); box.value = ''; toast('Got it. Finishing the sign-in…', 4000); } finally { b.disabled = false; }
    return true;
  }
  return false;
}

// Linear, as the work board reads it: whose key, and who you are there.
function linearLine() {
  const l = Conn.linear;
  if (!l) return '<p class="loading">Asking Linear…</p>';
  const go = '<button type="button" class="btn sm" data-cn="work">Your work board</button>';
  if (!l.connected) return `<p class="rd-state">Not connected${l.error ? ` (${esc(l.error)})` : ''}. The work board can take a Linear API key of your own.</p><div class="lm-b">${go}</div>`;
  return `<div class="gh-who"><span class="cn-yes">✓</span><span>${l.me ? `You’re <b>${esc(l.me.name || l.me.displayName)}</b> in Linear` : 'Connected, but it doesn’t know which Linear person you are yet'}<small>${esc(l.source === 'yours' ? 'your own key' : l.source === 'repo' ? `the agents’ key in Latitude’s repo (${l.keyOwner || 'shared'})` : 'LINEAR_API_KEY')}</small></span><span class="spacer"></span>${go}</div>`;
}

/* ---------- the dialog ---------- */

function connDialog() {
  let d = $('connDlg');
  if (d) return d;
  document.body.insertAdjacentHTML('beforeend', `<dialog id="connDlg" class="wide conn-dlg" aria-labelledby="cnTitle">
    <div class="setup-head"><h3 id="cnTitle">Connections</h3><button class="icon" data-cn="close" aria-label="Close">✕</button></div>
    <div class="rd-body" id="cnBody"><p class="loading">Asking your accounts…</p></div></dialog>`);
  d = $('connDlg');
  d.addEventListener('click', wrap(async e => {
    if (e.target === d) return d.close();
    const b = e.target.closest('[data-cn]'); if (!b) return undefined;
    const act = b.dataset.cn;
    if (act === 'close') return d.close();
    if (await mcpFlowAction(act, b)) return undefined;
    if (act === 'refresh') return Conn.mode === 'chat' ? connChatLoad() : connLoad(true);
    if (act === 'all') return openConnections(Conn.cwd);
    if (act === 'signin') return connSignIn({ provider: b.dataset.provider, account: b.dataset.account, name: b.dataset.name });
    if (act === 'everywhere') return connEverywhere();
    if (act === 'stopqueue') { Conn.queue = []; return connRender(); }
    if (act === 'rules') { d.close(); return openRules(Conn.cwd, 'tools'); }
    if (act === 'work') { d.close(); return go('work'); }
    // From /mcp: through the chat itself, so its tools load right there.
    if (act === 'chatsignin') { b.disabled = true; try { await connSignIn({ key: Conn.chatKey, name: b.dataset.name }); } finally { b.disabled = false; } return connRender(); }
    if (act === 'add') return connAdd(b.dataset.name, b.dataset.to);
    if (act === 'reconnect') { b.disabled = true; try { Conn.chat = await api('/api/chat/mcp-reconnect', { key: Conn.chatKey, name: b.dataset.name }); } finally { b.disabled = false; } return connRender(); }
    return undefined;
  }));
  d.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-paste]')) { e.preventDefault(); e.target.closest('.mcp-paste-row').querySelector('[data-cn="mcppaste"]').click(); } });
  d.addEventListener('close', () => { Conn.queue = []; Conn.qFlow = null; });
  return d;
}

// cwd: a project, whose own servers (.mcp.json and local ones) come along; nothing for just yours.
async function openConnections(cwd = null) {
  const d = connDialog();
  Object.assign(Conn, { mode: 'all', cwd: cwd || null, data: null, err: null, chatKey: null, chat: null });
  if (!d.open) d.showModal();
  connRender();
  ghLoad().then(prsRedraw).catch(() => {});
  api('/api/linear/status').then(st => { Conn.linear = st; const box = $('cnLinear'); if (box) box.innerHTML = linearLine(); }).catch(err => { Conn.linear = { connected: false, error: err.message }; });
  return connLoad(false);
}
async function connLoad(fresh) {
  Conn.loading = true; connRender();
  const q = new URLSearchParams();
  if (Conn.cwd) q.set('cwd', Conn.cwd);
  if (fresh) q.set('fresh', '1');
  try { Conn.data = await api(`/api/connections/mcp${q.toString() ? `?${q}` : ''}`); Conn.flows = Conn.data.flows || []; Conn.err = null; }
  catch (err) { Conn.err = err.message; }
  Conn.loading = false;
  connRender();
}

// The servers that sign in, one row each, with a column for each account.
function connTable(d) {
  const cols = d.accounts || [];
  const names = new Map();
  for (const a of cols) for (const s of a.servers) if (s.canSignIn && !names.has(s.name)) names.set(s.name, s);
  const has = (provider, name) => cols.some(a => a.provider === provider && a.servers.some(s => s.name === name));
  const cell = (a, name) => {
    const f = mcpFlowFor(Conn.flows, a.provider, a.accountId, name);
    if (f && f.state !== 'done') return `<div class="cn-flow">${mcpFlowHtml(f)}${f.state === 'failed' ? signBtn(a, name, 'Try again') : ''}</div>`;
    const s = a.servers.find(x => x.name === name);
    if (!s) {
      // Not set up for this one: Codex (or the main Claude account) can have it added in a click.
      const from = a.provider === 'codex' ? 'claude' : 'codex';
      if ((a.provider === 'codex' || a.isMain) && has(from, name) && !names.get(name).claudeAi && !window.REMOTE) return `<button type="button" class="btn quiet sm" data-cn="add" data-name="${esc(name)}" data-to="${a.provider}">Add to ${MCP_WHO[a.provider]}</button>`;
      return '<span class="rd-no" title="Not set up for this account">—</span>';
    }
    if (f && f.state === 'done') return '<span class="cn-yes">✓ Signed in</span>';
    if (s.status === 'connected') return `<span class="cn-yes">✓ Connected</span>${s.tools ? `<small>${s.tools} tool${s.tools === 1 ? '' : 's'}</small>` : ''}`;
    if (s.status === 'signed-in') return '<span class="cn-yes">✓ Signed in</span>';
    if (s.status === 'needs-auth') return signBtn(a, name, s.claudeAi ? 'Connect' : 'Sign in', true);
    if (s.status === 'failed') return `<span class="cn-bad" title="${esc(s.error || '')}">Didn’t connect</span>${s.canSignIn ? signBtn(a, name, 'Sign in again') : ''}`;
    if (s.status === 'pending') return '<span class="rd-note">Connecting…</span>';
    if (s.status === 'disabled') return '<span class="rd-note">Turned off</span>';
    return '<span class="rd-note">Set up</span>';
  };
  const rows = [...names.values()].sort((x, y) => Number(x.claudeAi) - Number(y.claudeAi) || x.name.localeCompare(y.name));
  if (!rows.length) return `<p class="rd-state">None of your tools needs a sign-in${cols.some(a => a.error) ? ' (as far as the accounts that answered say)' : ''}. Add one in <button type="button" class="linkish" data-cn="rules">Rules and tools → Tools</button>.</p>`;
  return `<div class="cn-wrap"><table class="rd-tools cn-table"><thead><tr><th>Tool</th>${cols.map(a => `<th><span class="cn-prov ${a.provider}">${MCP_WHO[a.provider]}</span>${esc(a.accountName)}${a.error ? `<small class="cn-bad" title="${esc(a.error)}">didn’t answer</small>` : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(s => `<tr><td><b>${esc(s.name)}</b>${s.host ? `<small>${esc(s.host)}</small>` : ''}</td>${cols.map(a => `<td data-who="${esc(`${MCP_WHO[a.provider]} · ${a.accountName}`)}">${cell(a, s.name)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const signBtn = (a, name, label, prime = false) => `<button type="button" class="btn ${prime ? 'gilt ' : 'quiet '}sm" data-cn="signin" data-provider="${a.provider}" data-account="${esc(a.accountId)}" data-name="${esc(name)}">${esc(label)}</button>`;
// Every account and server that's waiting for a sign-in.
function connNeeded() {
  const out = [];
  for (const a of (Conn.data && Conn.data.accounts) || []) for (const s of a.servers) if (s.status === 'needs-auth' && s.canSignIn && !s.claudeAi && !flowLive(mcpFlowFor(Conn.flows, a.provider, a.accountId, s.name))) out.push({ provider: a.provider, account: a.accountId, accountName: a.accountName, name: s.name });
  return out;
}

function connRender() {
  const box = $('cnBody'); if (!box || !$('connDlg').open) return;
  if (Conn.mode === 'chat') return connChatRender(box);
  $('cnTitle').textContent = 'Connections';
  const d = Conn.data;
  if (!d) { box.innerHTML = Conn.err ? `<p class="rd-state warn">${esc(Conn.err)}</p><div class="d-row"><button class="btn" data-cn="refresh">Try again</button></div>` : '<p class="loading">Asking each of your accounts which tools it can use…</p>'; return; }
  for (const a of d.accounts || []) a.isMain = a.provider === 'claude' && !!(S.accounts || []).find(x => x.id === a.accountId && x.isDefault);
  const need = connNeeded();
  const queued = Conn.queue.length || Conn.qFlow;
  box.innerHTML = `<h4 class="cn-h">GitHub</h4><div id="cnGitHub" class="gh-box">${ghHtml(PRS.gh, { inConnections: true })}</div>
    <h4 class="cn-h">Linear</h4><div class="gh-box" id="cnLinear">${linearLine()}</div>
    <h4 class="cn-h">Tools that sign in (MCP)</h4>
    <p class="rd-intro">Tools (MCP servers) like Latitude’s need you to sign in once for each account: Claude Code and Codex each keep their own sign-in, and so does every Claude account. Sign in here and every chat on that account can use the tool${Conn.cwd ? '' : ', in every project'}.</p>
    ${need.length > 1 && !queued ? `<div class="cn-all"><button type="button" class="btn gilt" data-cn="everywhere">Sign in everywhere it’s needed</button><span>${need.length} sign-ins, one after another. Each opens its page in your browser; if you’re signed in there already, it’s a click each.</span></div>` : ''}
    ${queued ? `<p class="rd-state">Signing in one after another: ${Conn.queue.length} more after this one. <button type="button" class="linkish" data-cn="stopqueue">Stop after this one</button></p>` : ''}
    ${connTable(d)}
    <div class="cn-foot"><button type="button" class="btn quiet sm" data-cn="refresh"${Conn.loading ? ' disabled' : ''}>${Conn.loading ? 'Checking…' : 'Check again'}</button>${d.codexOn ? '' : '<span class="rd-note">Codex is off (Setup turns it on).</span>'}</div>`;
}

async function connSignIn({ provider, account, name, key = null }) {
  try { localStorage.removeItem(mcpSkipKey(account || (C.info && C.info.accountId), name)); } catch { /* fine */ }
  const r = key ? await api('/api/chat/mcp-signin', { key, name }) : await api('/api/connections/signin', { provider, account, name, cwd: Conn.cwd });
  mcpFlowsChanged([...Conn.flows.filter(f => f.id !== r.flow.id), r.flow]);
  return r.flow;
}
// One after another (two at once would both wait on the same local port).
async function connEverywhere() {
  Conn.queue = connNeeded();
  return connNext();
}
async function connNext() {
  const next = Conn.queue.shift();
  if (!next) { Conn.qFlow = null; connRender(); return; }
  try { Conn.qFlow = (await connSignIn(next)).id; } catch (err) { Conn.queue = []; Conn.qFlow = null; toast(err.message, 8000); }
  connRender();
}
async function connAdd(name, to) {
  const target = to === 'claude' ? 'Claude Code' : 'Codex';
  if (!(await appConfirm(`Add ${name} to ${target}?\n\nIt’s set up with the same settings, for every project. Then sign in to it here.`, { ok: `Add to ${MCP_WHO[to]}` }))) return;
  await api('/api/tools/copy', { name, to, cwd: Conn.cwd });
  toast(`${name} is in ${target} now. Sign in to it when it shows up below.`, 6000);
  await connLoad(true);
}

// The sign-ins changed (the PC says so to every window): redraw, and carry on down the list.
function mcpFlowsChanged(flows) {
  Conn.flows = Array.isArray(flows) ? flows : Conn.flows;
  if (Conn.qFlow) {
    const f = Conn.flows.find(x => x.id === Conn.qFlow);
    if (f && !flowLive(f)) {
      Conn.qFlow = null;
      if (f.state === 'done') connNext().catch(() => {});
      else if (Conn.queue.length) { toast(`Stopped signing in one after another: ${f.name} as ${f.accountName} didn’t finish.`, 8000); Conn.queue = []; }
    }
  }
  // A finished one means a list is out of date: ask again (a moment later, as Claude Code connects it).
  const ended = Conn.flows.some(f => f.state === 'done' && f.endedAt && Date.now() - f.endedAt < 5000);
  if ($('connDlg') && $('connDlg').open) {
    connRender();
    if (ended && !Conn.loading) setTimeout(() => (Conn.mode === 'chat' ? connChatLoad() : connLoad(true)), 1500);
  }
}

/* ---------- in a chat ---------- */

// "Not now" on a chat's card: that tool isn't asked about again in chats on that account (this browser remembers).
const mcpSkipKey = (accountId, name) => `mcp-skip:${accountId || ''}:${name}`;
function mcpSkipped(accountId, name) { try { return localStorage.getItem(mcpSkipKey(accountId, name)) === '1'; } catch { return false; } }
function mcpSkip(accountId, name) { try { localStorage.setItem(mcpSkipKey(accountId, name), '1'); } catch { /* fine */ } }

// /mcp in a chat: its own servers, as its Claude Code (or Codex) has them right now.
async function openChatMcp(src = 'main') {
  const key = keyFor(src);
  if (!key) { toast('This chat isn’t running. Start it again first.'); return; }
  const d = connDialog();
  Object.assign(Conn, { mode: 'chat', chatKey: key, chatSrc: src, chat: null, err: null, cwd: (C.info && C.info.cwd) || null });
  if (!d.open) d.showModal();
  connRender();
  return connChatLoad();
}
async function connChatLoad() {
  Conn.loading = true; connRender();
  try { Conn.chat = await api('/api/chat/mcp', { key: Conn.chatKey }); Conn.flows = mergeFlows(Conn.flows, Conn.chat.flows); Conn.err = null; } catch (err) { Conn.err = err.message; }
  Conn.loading = false; connRender();
}
const mergeFlows = (a, b) => [...(a || []).filter(f => !(b || []).some(x => x.id === f.id)), ...(b || [])];
const MCP_STATUS = { connected: '✓ Connected', 'signed-in': '✓ Signed in', 'needs-auth': 'Needs you to sign in', failed: 'Didn’t connect', pending: 'Connecting…', disabled: 'Turned off', unknown: 'Set up' };
function connChatRender(box) {
  const ch = Conn.chat;
  $('cnTitle').textContent = 'Tools in this chat';
  if (!ch) { box.innerHTML = Conn.err ? `<p class="rd-state warn">${esc(Conn.err)}</p>` : '<p class="loading">Asking this chat which tools it has…</p>'; return; }
  const who = MCP_WHO[ch.provider] || 'Claude';
  const row = s => {
    const f = mcpFlowFor(Conn.flows, ch.provider, ch.accountId, s.name);
    const acts = [];
    if (s.canSignIn && (s.status === 'needs-auth' || s.status === 'failed') && !flowLive(f)) acts.push(`<button type="button" class="btn ${s.status === 'needs-auth' ? 'gilt' : 'quiet'} sm" data-cn="chatsignin" data-name="${esc(s.name)}">${s.status === 'needs-auth' ? (s.claudeAi ? 'Connect' : 'Sign in') : 'Sign in again'}</button>`);
    if (ch.provider === 'claude' && (s.status === 'failed' || s.status === 'connected') && !s.claudeAi) acts.push(`<button type="button" class="btn quiet sm" data-cn="reconnect" data-name="${esc(s.name)}">Connect again</button>`);
    return `<li class="cn-srv"><div class="cn-srv-h"><b>${esc(s.name)}</b><span class="cn-st ${esc(s.status)}">${esc(MCP_STATUS[s.status] || s.status)}</span>${s.tools ? `<small>${s.tools} tool${s.tools === 1 ? '' : 's'}</small>` : ''}<small>${esc(s.host || (s.transport === 'stdio' ? 'runs on this computer' : s.transport))}</small><span class="spacer"></span>${acts.join('')}</div>
      ${f && f.state !== 'cancelled' ? `<div class="cn-flow">${mcpFlowHtml(f)}</div>` : ''}${s.error && s.status === 'failed' ? `<p class="mcp-err">${esc(s.error)}</p>` : ''}</li>`;
  };
  box.innerHTML = `<p class="rd-intro">The tools (MCP servers) ${who} has in this chat, as <b>${esc(ch.accountName)}</b>. A sign-in here is kept for the account, so its other chats have it too.</p>
    ${ch.servers.length ? `<ul class="cn-list">${ch.servers.map(row).join('')}</ul>` : `<p class="rd-state">${who} has no tools set up${ch.provider === 'codex' ? '' : ' for this chat'}.</p>`}
    <div class="cn-foot"><button type="button" class="btn quiet sm" data-cn="refresh"${Conn.loading ? ' disabled' : ''}>${Conn.loading ? 'Checking…' : 'Check again'}</button><button type="button" class="btn quiet sm" data-cn="all">All your accounts…</button></div>`;
}

// The card in a chat when one of its servers needs you (lib/mcpauth.js sends the whole picture each time).
function renderMcpCard(ev, src = 'main') {
  if (C.watch) return;
  const feed = $c('cFeed');
  let card = cardsOf('.mcp-card', src)[0];
  const who = PROV_NAME[provFor(src)] || 'Claude';
  const flows = ev.flows || [];
  const need = ev.need || [];
  const rows = [];
  for (const s of need) {
    if (mcpSkipped(ev.accountId, s.name)) continue;
    const f = mcpFlowFor(flows, ev.provider, ev.accountId, s.name);
    if (f && f.state !== 'failed' && f.state !== 'done') { rows.push(`<div class="mcp-row">${mcpFlowHtml(f, 'data-c')}</div>`); continue; }
    rows.push(`<div class="mcp-row"><p class="lm-h"><b>${esc(s.name)} needs you to sign in</b> before ${esc(who)} can use it${s.host ? ` (${esc(s.host)})` : ''}.</p>${f && f.state === 'failed' ? mcpFlowHtml(f, 'data-c') : ''}
      <div class="lm-b"><button type="button" class="btn gilt" data-c="mcpsign" data-name="${esc(s.name)}">${s.claudeAi ? 'Connect' : 'Sign in to'} ${esc(s.name)}</button><button type="button" class="btn quiet" data-c="mcpskip" data-name="${esc(s.name)}" title="Don’t ask in chats as ${esc(ev.accountName || 'this account')}; Connections still has it">Not now</button></div></div>`);
  }
  // Just signed in (it's not in the list that needs you any more): say so for a moment.
  for (const f of flows) {
    if (f.state === 'done' && f.endedAt && Date.now() - f.endedAt < 90000 && !need.some(s => s.name === f.name)) rows.push(`<div class="mcp-row"><p class="mcp-ok">✓ ${esc(f.name)} is connected${ev.accountName ? ` for ${esc(ev.accountName)}` : ''}. ${esc(who)} can use its tools ${ev.provider === 'codex' ? 'from its next reply' : 'in this chat now'}.</p></div>`);
  }
  if (!rows.length) { if (card) card.remove(); return; }
  if (!card) {
    card = document.createElement('div');
    card.className = `limit-card mcp-card${liveRender ? ' fresh' : ''}`; card.dataset.src = src; card._kind = compKind(src); card.setAttribute('role', 'status');
    withStick(() => feed.appendChild(card));
  }
  card._ev = ev;
  card.innerHTML = `${rows.join('')}<p class="mcp-more">Each account signs in once, and its other chats have it too. <button type="button" class="linkish" data-c="mcpall">Your other accounts…</button></p>`;
  const done = rows.length && !need.length;
  if (done) setTimeout(() => { if (card.isConnected && card._ev === ev) card.remove(); }, 20000);
}
// Its buttons (ui/chat.js hands them over).
async function mcpCardAction(act, b) {
  const card = b.closest('.mcp-card');
  if (act === 'mcpall') return openConnections((C.info && C.info.cwd) || null);
  if (act === 'mcpskip') { mcpSkip(card && card._ev && card._ev.accountId, b.dataset.name); if (card && card._ev) renderMcpCard(card._ev, card.dataset.src || 'main'); toast(`Not asking about ${b.dataset.name} in chats on this account. Connections (Ctrl+K) still signs in to it.`, 6000); return undefined; }
  if (await mcpFlowAction(act, b)) return undefined;
  if (act === 'mcpsign') {
    b.disabled = true;
    try { await connSignIn({ key: keyOfCard(card, (card && card.dataset.src) || 'main'), name: b.dataset.name }); } finally { b.disabled = false; }
  }
  return undefined;
}
