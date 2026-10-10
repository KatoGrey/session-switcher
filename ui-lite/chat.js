'use strict';
/* A chat in Lite: its conversation, and one quiet input bar.
   Reading a chat never starts anything: the history comes from disk, and the live stream is joined
   only if the chat is already running here. The chat is resumed on the first message you send.
   New chat is the same input bar on its own page, with the project, the assistant and how much it
   may do on its own as chips above it. */

const PERM_LABELS = {
  default: 'Ask before edits', acceptEdits: 'Accept edits', plan: 'Plan only', auto: 'Auto', bypassPermissions: 'Bypass permissions',
  ask: 'Ask before acting', agent: 'Agent', 'read-only': 'Read only', full: 'Full access',
};
const permFam = provider => (provider === 'codex' ? 'codex' : 'claude');
const permDefault = provider => { const f = permFam(provider); return (S.lite.permissions && S.lite.permissions[f]) || (S.appPermissions && S.appPermissions[f]) || (f === 'claude' ? 'default' : 'agent'); };

/* ---------- Markdown, just enough (escaped first; links only to http(s)) ---------- */
function mdHtml(src) {
  const blocks = [];
  let t = String(src || '').replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (m, lang, code) => { blocks.push(`<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  const inline = x => esc(x)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, '$1<i>$2</i>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${i}</li>`).join('')}</${list.tag}>`); list = null; } };
  for (const line of t.split('\n')) {
    const code = /^\u0000(\d+)\u0000$/.exec(line.trim());
    if (code) { flush(); out.push(blocks[Number(code[1])]); continue; }
    let m;
    if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) { if (!list || list.tag !== 'ul') { flush(); list = { tag: 'ul', items: [] }; } list.items.push(inline(m[1])); continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { if (!list || list.tag !== 'ol') { flush(); list = { tag: 'ol', items: [] }; } list.items.push(inline(m[1])); continue; }
    flush();
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) { out.push(`<p class="h">${inline(m[2])}</p>`); continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { out.push('<hr>'); continue; }
    if (!line.trim()) { out.push(''); continue; }
    out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return out.join('').replace(/\u0000(\d+)\u0000/g, (m, i) => blocks[Number(i)]);
}

/* ---------- what a turn did, in one line ---------- */
const STEP_WORDS = { Read: ['read', 'file', 'files'], Edit: ['edited', 'file', 'files'], MultiEdit: ['edited', 'file', 'files'], Write: ['wrote', 'file', 'files'], Bash: ['ran', 'command', 'commands'], Grep: ['searched', 'time', 'times'], Glob: ['looked for files', '', ''], WebSearch: ['searched the web', '', ''], WebFetch: ['opened', 'page', 'pages'], Task: ['started', 'helper', 'helpers'], Agent: ['started', 'helper', 'helpers'] };
function stepLine(tools) {
  const n = new Map();
  for (const t of tools) { const k = STEP_WORDS[t.name] ? t.name.replace('MultiEdit', 'Edit') : 'other'; n.set(k, (n.get(k) || 0) + 1); }
  const parts = [];
  for (const [k, c] of n) {
    if (k === 'other') { parts.push(`${c} other step${c === 1 ? '' : 's'}`); continue; }
    const [verb, one1, many] = STEP_WORDS[k];
    parts.push(one1 ? `${verb} ${c} ${c === 1 ? one1 : many}` : verb);
  }
  const s = parts.join(' · ');
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

/* ---------- the chat's state ---------- */
const CV = { id: null, key: null, info: null, items: [], cursor: null, es: null, live: '', status: '', pending: new Map(), busy: false, startedAt: 0, loading: false, error: null, readOnly: null, provider: 'claude', perm: null, sending: false };

function chatTitle() { const c = chatBy.get(CV.id); return c ? c.title : (CV.info && CV.info.title) || 'New chat'; }

async function openChatView(id, { key = null } = {}) {
  if (CV.es) { CV.es.close(); CV.es = null; }
  Object.assign(CV, { id, key, info: null, items: [], cursor: null, live: '', status: '', pending: new Map(), busy: false, startedAt: 0, loading: true, error: null, readOnly: null, perm: null, sending: false });
  const c = chatBy.get(id);
  CV.provider = c ? c.provider : 'claude';
  markSeen(id);
  const x = S.live.find(l => l.sessionId && l.sessionId.toLowerCase() === String(id).toLowerCase());
  if (!key && x && x.key && x.source === 'app') CV.key = x.key;
  if (!CV.key && x && x.source !== 'app' && x.working) CV.readOnly = x.source === 'terminal' ? 'It’s running in a terminal. Answer it there, or wait for it to finish.' : 'It’s running in another app (like the Claude desktop app). Answer it there, or wait for it to finish.';
  try {
    let until = null;
    if (CV.key) { CV.info = await api('/api/chat/attach', { key: CV.key }); until = CV.info.bufferFrom || CV.info.startedAt || null; CV.provider = CV.info.provider; }
    const q = new URLSearchParams({ id });
    if (until) q.set('until', until);
    if (CV.provider === 'codex') q.set('provider', 'codex');
    const h = await api(`/api/chat/history?${q}`);
    let items = h.items || [];
    // The live stream replays everything since this run started; history stops where that begins.
    if (until) { const bf = Date.parse(until) - 1000; const i = items.findIndex(it => it.at && Date.parse(it.at) >= bf); if (i >= 0) items = items.slice(0, i); }
    CV.items = items; CV.cursor = h.cursor || null;
  } catch (err) { CV.error = err.message; }
  CV.loading = false;
  if (S.view !== 'chat' || CV.id !== id) return;
  paintChat();
  if (CV.key) listen(CV.key);
}
async function loadEarlier() {
  if (!CV.cursor) return;
  const q = new URLSearchParams({ id: CV.id, cursor: CV.cursor });
  if (CV.provider === 'codex') q.set('provider', 'codex');
  const h = await api(`/api/chat/history?${q}`);
  const sc = $('feed'), before = sc ? sc.scrollHeight - sc.scrollTop : 0;
  CV.items = [...(h.items || []), ...CV.items]; CV.cursor = h.cursor || null;
  paintFeed();
  if (sc) sc.scrollTop = sc.scrollHeight - before;
}

function listen(key) {
  if (CV.es) CV.es.close();
  const es = new EventSource(`/api/chat/events?key=${encodeURIComponent(key)}&token=${TOKEN}`);
  CV.es = es;
  es.addEventListener('hello', e => { try { CV.info = JSON.parse(e.data); CV.busy = ['busy', 'waiting', 'starting'].includes(CV.info.state); paintBar(); const h = $('chatHead'); if (h) h.outerHTML = chatHead(); } catch { /* fine */ } });
  es.addEventListener('chat', e => { let ev; try { ev = JSON.parse(e.data); } catch { return; } onEvent(ev); });
}
function onEvent(ev) {
  switch (ev.kind) {
    case 'state':
      CV.busy = ['busy', 'waiting', 'starting'].includes(ev.state);
      if (CV.info) CV.info.state = ev.state;
      if (ev.state === 'busy' && !CV.startedAt) CV.startedAt = Date.now();
      if (ev.state === 'ended') { CV.busy = false; CV.status = ''; if (CV.es) { CV.es.close(); CV.es = null; } CV.key = null; }
      paintBar(); paintStatus(); break;
    case 'init': if (ev.sessionId && !CV.id) CV.id = ev.sessionId; break;
    case 'model': if (CV.info) Object.assign(CV.info, ev); paintBar(); break;
    case 'status': if (ev.permissionMode && CV.info) { CV.info.permissionMode = ev.permissionMode; paintBar(); } break;
    case 'user': CV.items.push(ev); CV.live = ''; CV.startedAt = Date.now(); appendItem(ev); break;
    case 'delta': if (!ev.thinking) { CV.live += ev.text || ''; CV.status = 'Writing'; } else CV.status = 'Thinking'; paintLive(); paintStatus(); break;
    case 'assistant': { CV.live = ''; const last = CV.items[CV.items.length - 1]; if (last && last.kind === 'assistant' && last.mid === ev.mid) last.blocks = ev.blocks; else CV.items.push(ev); paintFeed(); const tool = (ev.blocks || []).filter(b => b.type === 'tool').pop(); if (tool) CV.status = `${tool.name}${tool.summary ? ` · ${tool.summary}` : ''}`; paintStatus(); break; }
    case 'tool_start': CV.status = `Using ${ev.name}`; paintStatus(); break;
    case 'notice': CV.items.push(ev); appendItem(ev); break;
    case 'permission': CV.pending.set(ev.requestId, ev); paintPending(); break;
    case 'permission_cancel': case 'permission_done': CV.pending.delete(ev.requestId); paintPending(); break;
    case 'result': CV.busy = false; CV.status = ''; CV.startedAt = 0; CV.live = ''; markSeen(CV.id); if (!ev.ok && (ev.errors || []).length) { const n = { kind: 'notice', level: 'warning', text: ev.errors.join(' ') }; CV.items.push(n); appendItem(n); } paintLive(); paintStatus(); paintBar(); break;
    default: break;
  }
}

/* ---------- painting ---------- */
function itemHtml(it) {
  if (it.kind === 'user') {
    const text = String(it.text || '');
    const cmdr = /^From Commander:\s*/.test(text);
    return `<div class="msg-you${cmdr ? ' from-cmdr' : ''}">${cmdr ? '<span class="tag">from Commander</span> ' : ''}${esc(text.replace(/^From Commander:\s*/, '')).replace(/\n/g, '<br>')}</div>`;
  }
  if (it.kind === 'assistant') {
    const blocks = it.blocks || [];
    const tools = blocks.filter(b => b.type === 'tool');
    const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n\n');
    const steps = tools.length ? `<details class="step"><summary>${esc(stepLine(tools))}</summary><ul>${tools.map(t => `<li><b>${esc(t.name)}</b> ${esc(t.summary || '')}</li>`).join('')}</ul></details>` : '';
    return `${steps}${text ? `<div class="msg-ai">${mdHtml(text)}</div>` : ''}`;
  }
  if (it.kind === 'notice') return `<div class="notice ${esc(it.level || 'info')}">${esc(it.text || '')}</div>`;
  return '';
}
// Consecutive tool-only replies read as one step line; the text between them stays.
function feedHtml() {
  let html = '', tools = [];
  const flushTools = () => { if (tools.length) { html += `<details class="step"><summary>${esc(stepLine(tools))}</summary><ul>${tools.map(t => `<li><b>${esc(t.name)}</b> ${esc(t.summary || '')}</li>`).join('')}</ul></details>`; tools = []; } };
  for (const it of CV.items) {
    if (it.kind === 'assistant') {
      const bl = it.blocks || [];
      const text = bl.filter(b => b.type === 'text').map(b => b.text).join('\n\n');
      tools.push(...bl.filter(b => b.type === 'tool'));
      if (text) { flushTools(); html += `<div class="msg-ai">${mdHtml(text)}</div>`; }
      continue;
    }
    flushTools();
    html += itemHtml(it);
  }
  flushTools();
  return html;
}

function chatHead() {
  const c = chatBy.get(CV.id);
  // A chat the list hasn't caught up with yet still shows where it runs.
  const p = c ? projOf(c) : CV.info && CV.info.cwd ? S.projects.find(x => x.cwd === CV.info.cwd && !x.key.includes('#')) || null : null;
  const st = c ? stageById(stageOf(c)) : null;
  return `<div class="chat-h" id="chatHead"><button class="iconbtn back" data-go="back" aria-label="Back">‹</button>
      <div style="min-width:0;flex:1;display:flex;flex-direction:column"><div class="crumb">${p ? `<span>${esc(bucketName(p.bucket))}</span>›<button data-project="${esc(p.key)}">${esc(p.name)}</button>` : ''}</div><span class="ttl" id="chatTitle">${esc(chatTitle())}</span></div>
      ${st ? `<button class="stage" data-rowmenu="${esc(c.id)}" aria-haspopup="menu" title="Stage (s)"><span class="dot" style="background:${st.c}"></span>${st.name}</button>` : ''}
      <button class="iconbtn" data-chatmenu="1" aria-haspopup="menu" aria-label="More">${IC.dots}</button></div>`;
}
function chatView() {
  return `<div class="chat" id="chatView">${chatHead()}
    <div class="feed" id="feed" tabindex="-1"><div class="inner" id="feedInner"></div></div>
    <div class="composer">${composerHtml()}</div>
  </div>`;
}
function paintChat() {
  if (S.view !== 'chat' || !$('chatView')) return;
  paintFeed(); paintPending(); paintBar(); paintStatus();
  const f = $('feed'); f.scrollTop = f.scrollHeight;
  if (!REMOTE && !matchMedia('(max-width: 760px)').matches) $('msgBox')?.focus();
}
const nearBottom = () => { const f = $('feed'); return !f || f.scrollHeight - f.scrollTop - f.clientHeight < 160; };
function paintFeed() {
  const el = $('feedInner'); if (!el) return;
  const stick = nearBottom();
  el.innerHTML = `${CV.cursor ? '<button class="linkish earlier" data-earlier="1">Earlier messages</button>' : ''}
    ${CV.loading ? '<p class="empty-note">Loading…</p>' : CV.error ? `<p class="empty-note">${esc(CV.error)}</p>` : !CV.items.length ? '<p class="empty-note">Nothing here yet.</p>' : ''}
    ${feedHtml()}<div id="liveText" class="msg-ai live"></div><div id="pendingBox"></div><div id="statusLine" class="step live-status"></div>`;
  paintLive(); paintPending(); paintStatus();
  if (stick) $('feed').scrollTop = $('feed').scrollHeight;
}
function appendItem() { paintFeed(); }
function paintLive() { const el = $('liveText'); if (!el) return; const stick = nearBottom(); el.innerHTML = CV.live ? mdHtml(CV.live) : ''; el.hidden = !CV.live; if (stick) $('feed').scrollTop = $('feed').scrollHeight; }
function paintStatus() {
  const el = $('statusLine'); if (!el) return;
  el.hidden = !CV.busy;
  el.innerHTML = CV.busy ? `<span class="live-dot"></span><span>${esc(String(CV.status || 'Thinking').replace(/^mcp__(.+?)__/, '$1: '))}</span><span style="margin-left:auto">${CV.startedAt ? since(CV.startedAt) : ''}</span>` : '';
}
function paintPending() {
  const el = $('pendingBox'); if (!el) return;
  el.innerHTML = [...CV.pending.values()].map(p => {
    if (p.questions && p.questions.length) {
      return `<div class="ask-card" data-req="${esc(p.requestId)}">${p.questions.map((q, qi) => `<p class="q"><b>${esc(q.header || 'Question')}</b> ${esc(q.question)}</p><div class="opts">${q.options.map((o, oi) => `<button class="btn" data-answer="${esc(p.requestId)}" data-q="${qi}" data-o="${oi}" title="${esc(o.description)}">${esc(o.label)}</button>`).join('')}</div>`).join('')}<button class="linkish" data-perm-c="deny" data-req="${esc(p.requestId)}">Skip</button></div>`;
    }
    const v = p.view || {};
    return `<div class="ask-card" data-req="${esc(p.requestId)}"><p class="q">Wants to ${esc(wantsTo(p.toolName))}</p>${v.detail || v.summary ? `<code class="ask-code">${esc(v.detail || v.summary)}</code>` : ''}
      <div class="opts"><button class="btn prime" data-perm-c="allow" data-req="${esc(p.requestId)}">Allow <kbd>a</kbd></button>${p.canAlways ? `<button class="btn" data-perm-c="always" data-req="${esc(p.requestId)}">Always allow</button>` : ''}<button class="btn" data-perm-c="deny" data-req="${esc(p.requestId)}">Deny <kbd>d</kbd></button></div></div>`;
  }).join('');
  if (CV.pending.size && nearBottom()) $('feed').scrollTop = $('feed').scrollHeight;
}
const wantsTo = name => ({ Bash: 'run a command', PowerShell: 'run a command', Edit: 'edit a file', MultiEdit: 'edit a file', Write: 'create or overwrite a file', WebFetch: 'open a web page', WebSearch: 'search the web', NotebookEdit: 'edit a notebook' })[name] || `use ${String(name || 'a tool').replace(/^mcp__(.+?)__/, '$1: ')}`;

/* ---------- the input bar ---------- */
function composerHtml({ fresh = false } = {}) {
  return `<form class="box" id="composer" autocomplete="off">
    ${fresh ? '' : '<div class="readonly-note" id="roNote" hidden></div>'}
    <textarea id="msgBox" rows="1" placeholder="${fresh ? 'What should it do?' : 'Reply…'}" aria-label="Message"></textarea>
    <div class="tools" id="barTools"></div>
  </form>`;
}
function paintBar() {
  const t = $('barTools'); if (!t || S.view !== 'chat') return;
  const info = CV.info;
  const mode = (info && info.permissionMode) || CV.perm || null;
  const modelName = info && (info.replyModel || info.resolvedModel || info.model);
  const ro = $('roNote');
  if (ro) { ro.hidden = !CV.readOnly; ro.textContent = CV.readOnly || ''; }
  t.innerHTML = `<button type="button" class="model" data-barmodel="1" aria-haspopup="menu" title="Model">${esc(modelName ? prettyModel(modelName) : CV.provider === 'codex' ? 'Codex' : 'Claude')}<span>▾</span></button>
    <button type="button" class="model" data-barperm="1" aria-haspopup="menu" title="What it may do without asking">${esc(PERM_LABELS[mode] || (CV.key ? 'Permissions' : `${PERM_LABELS[permDefault(CV.provider)]}`))}<span>▾</span></button>
    <span class="bar-hint"></span>
    ${CV.busy ? '<button type="button" class="send stop" data-stopchat="1" aria-label="Stop (⌘.)" title="Stop (⌘.)">■</button>' : '<button type="submit" class="send" aria-label="Send (↵)" title="Send (↵)">↑</button>'}`;
  const box = $('msgBox'); if (box) box.disabled = !!CV.readOnly;
}
const prettyModel = m => String(m).replace(/^claude-/, '').replace(/-(\d)-(\d)/, ' $1.$2').replace(/\[1m\]$/, ' 1M').replace(/^(\w)/, c => c.toUpperCase());
function autosize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 280) + 'px'; }

async function sendInChat() {
  const box = $('msgBox'); const text = box.value.trim();
  if (!text || CV.sending) return;
  CV.sending = true;
  try {
    if (!CV.key) {
      // First message: resume it here (as the account it last ran as), in your permission default
      // unless you chose one for this chat before.
      const info = await api('/api/chat/open', { sessionId: CV.id, mode: 'resume', ...(CV.provider === 'codex' ? { provider: 'codex' } : {}), ...(CV.perm ? { permissionMode: CV.perm } : {}) });
      CV.key = info.key; CV.info = info;
      if (!CV.perm && !info.remembered && info.permissionMode !== permDefault(CV.provider)) await api('/api/chat/mode', { key: info.key, mode: permDefault(CV.provider) }).then(() => { CV.info.permissionMode = permDefault(CV.provider); }).catch(() => {});
      listen(info.key);
      await waitReady();
    }
    box.value = ''; autosize(box);
    await api('/api/chat/send', { key: CV.key, text });
    CV.busy = true; CV.startedAt = Date.now(); paintBar(); paintStatus();
  } catch (err) { toast(err.message); } finally { CV.sending = false; }
}
const waitReady = () => new Promise(res => { const t0 = Date.now(); const tick = () => ((CV.info && CV.info.state && CV.info.state !== 'starting') || Date.now() - t0 > 45e3 ? res() : setTimeout(tick, 300)); tick(); });

function chatMenu(anchor) {
  const c = chatBy.get(CV.id);
  pop(anchor, `<button data-v="full">Open in the full app<small>images, files, diffs</small></button>${c ? '<button data-v="wait">Waiting on…<kbd>w</kbd></button><button data-v="arch">Archive<kbd>e</kbd></button>' : ''}${CV.key ? '<hr><button data-v="stop">Stop it running here</button>' : ''}`, v => {
    if (v === 'full') return openChat(CV.id, { full: true });
    if (v === 'wait') return askWaiting([CV.id]);
    if (v === 'arch') return wrap(archiveChats)([CV.id]).then(() => go('back'));
    if (v === 'stop') return wrap(async () => { await api('/api/chat/stop', { key: CV.key }); toast('Stopped. It stays in the list; send a message to pick it up again.'); })();
    return undefined;
  });
}
function modelMenu(anchor) {
  const info = CV.info;
  if (!CV.key || !info || !info.models || !info.models.length) return toast('Pick a model once the chat is running: send a message first.');
  pop(anchor, `<div class="ph">Model</div>${info.models.map(m => { const v = typeof m === 'string' ? m : m.value || m.id; const label = typeof m === 'string' ? prettyModel(m) : m.label || m.displayName || prettyModel(v); return `<button data-v="${esc(v)}" role="menuitemradio" aria-checked="${v === info.model}">${esc(label)}</button>`; }).join('')}`,
    v => wrap(async () => { Object.assign(CV.info, await api('/api/chat/model', { key: CV.key, model: v })); paintBar(); })());
}
function permMenu(anchor, { provider = CV.provider, current = null, onPick } = {}) {
  const modes = (S.permissionModes || {})[permFam(provider)] || [];
  const def = permDefault(provider);
  pop(anchor, `<div class="ph">What it may do without asking</div>${modes.map(m => `<button data-v="${esc(m)}" role="menuitemradio" aria-checked="${m === (current || def)}">${esc(PERM_LABELS[m] || m)}${m === def ? '<small>your default</small>' : ''}</button>`).join('')}<hr><button data-v="__default">Make the selected one my default</button>`,
    v => {
      if (v === '__default') return wrap(setLook)({ permissions: { [permFam(provider)]: current || def } }).then(() => toast(`New ${permFam(provider) === 'claude' ? 'Claude' : 'Codex'} chats start in ${PERM_LABELS[current || def]}.`));
      return onPick(v);
    });
}

/* ---------- New chat: the same input bar, centered ---------- */
const NC = { project: null, who: 'claude', perm: null };
function accountFor(who) {
  if (who === 'ollama') { const o = plans().find(p => p.family === 'ollama' && !p.broken); return o ? o.id : null; }
  const p = useNext(who === 'claude' ? 'claude' : 'chatgpt');
  return p ? p.id : null;
}
const ncProjects = () => S.projects.filter(p => p.cwd && p.exists && !p.archived && !p.loose).sort((a, b) => (b.bucket ? 1 : 0) - (a.bucket ? 1 : 0) || b.updated - a.updated);
function newChatView() {
  const ps = ncProjects();
  if (!NC.project || !ps.some(p => p.key === NC.project)) NC.project = (ps[0] || {}).key || null;
  return `<div class="newchat"><div class="nc-inner">
    <h1 class="nc-h">What should we work on?</h1>
    <div class="nc-chips" id="ncChips"></div>
    ${composerHtml({ fresh: true })}
    <p class="hint-line nc-foot"><kbd>↵</kbd> start · <kbd>⇧↵</kbd> new line · <kbd>⌘P</kbd> project · <kbd>esc</kbd> back</p>
  </div></div>`;
}
function paintNewChat() {
  const p = projBy.get(NC.project);
  const prov = NC.who === 'claude' ? 'claude' : 'codex';
  const perm = NC.perm || permDefault(prov);
  const acc = accountFor(NC.who), plan = acc && planById(acc);
  $('ncChips').innerHTML = `<button type="button" class="chip big" data-ncproject="1">${p ? `<span class="thumb-xs" style="${artStyle(p)};width:16px;height:16px;border-radius:4px"></span>${esc(p.name)}` : 'Pick a project'} ▾</button>
    <button type="button" class="chip big" data-ncwho="1">${NC.who === 'claude' ? 'Claude' : NC.who === 'ollama' ? 'Codex on Ollama' : 'Codex'}${plan ? ` <small>${esc(plan.label)}${typeof plan.left === 'number' ? ` · ${plan.left}%` : ''}</small>` : ''} ▾</button>
    <button type="button" class="chip big" data-ncperm="1">${esc(PERM_LABELS[perm] || perm)} ▾</button>`;
  $('barTools').innerHTML = `<span class="bar-hint">${NC.who === 'ollama' ? 'Runs on Ollama, outside your plan limits' : plan ? `Runs on ${esc(plan.label)} ${esc(famName(plan.family))}, next in the use-next order` : 'Runs on the full app’s active account'}</span><button type="submit" class="send" aria-label="Start (↵)">↑</button>`;
}
async function startNewChat() {
  const box = $('msgBox'); const text = box.value.trim();
  const p = projBy.get(NC.project);
  if (!text) return box.focus();
  if (!p) return toast('Pick a project first.');
  const prov = NC.who === 'claude' ? 'claude' : 'codex';
  const perm = NC.perm || permDefault(prov);
  const send = $('composer').querySelector('.send'); if (send) send.disabled = true;
  box.disabled = true;
  try {
    const account = accountFor(NC.who);
    const info = await api('/api/chat/open', { mode: 'new', cwd: p.cwd, provider: prov, ...(account ? { account } : {}), permissionMode: perm });
    const id = await startAndSend(info.key, text);
    NC.perm = null;
    go('chat', { chat: id || null, chatKey: info.key });
  } catch (err) { toast(err.message); box.disabled = false; if (send) send.disabled = false; }
}
// Waits for a new chat to be ready, sends its first message, and returns its id once it has one.
function startAndSend(key, text) {
  return new Promise((resolve, reject) => {
    const es = new EventSource(`/api/chat/events?key=${encodeURIComponent(key)}&token=${TOKEN}`);
    let state = 'starting', id = null, sent = false;
    const finish = (err, v) => { clearTimeout(timer); es.close(); if (err) reject(err); else resolve(v); };
    const timer = setTimeout(() => finish(null, id), 60e3);
    const maybeSend = () => {
      if (sent || state === 'starting') return;
      if (state === 'ended') { finish(new Error('The chat stopped as it started. Open the full app to see why.')); return; }
      sent = true;
      api('/api/chat/send', { key, text }).catch(err => finish(err));
      if (id) finish(null, id);
    };
    es.addEventListener('hello', e => { try { const i = JSON.parse(e.data); state = i.state; id = i.sessionId || id; } catch { /* fine */ } maybeSend(); });
    es.addEventListener('chat', e => {
      let ev; try { ev = JSON.parse(e.data); } catch { return; }
      if (ev.kind === 'state') state = ev.state;
      if (ev.kind === 'init' && ev.sessionId) id = ev.sessionId;
      maybeSend();
      if (sent && id) finish(null, id);
    });
  });
}
function pickProject(anchor, onPick) {
  const ps = ncProjects();
  pop(anchor, `<div class="ph">Project</div><input class="pop-q" id="ppQ" placeholder="Type to filter" aria-label="Filter projects"><div id="ppList">${ps.map(p => `<button data-v="${esc(p.key)}">${esc(p.name)}<small>${esc(bucketName(p.bucket))}</small></button>`).join('')}</div>`, onPick);
  const q = $('ppQ'); if (!q) return;
  q.focus();
  q.addEventListener('input', () => { const t = q.value.toLowerCase(); for (const b of $('ppList').querySelectorAll('button')) b.hidden = !b.textContent.toLowerCase().includes(t); });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') { const b = [...$('ppList').querySelectorAll('button')].find(x => !x.hidden); if (b) { e.preventDefault(); b.click(); } } });
}
