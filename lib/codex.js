'use strict';
// Codex (OpenAI's coding agent) support, through `codex app-server`.
//
// The app server speaks newline-delimited JSON over stdio: requests {id, method, params}, responses
// {id, result | error}, notifications {method, params}, and requests from Codex (approvals,
// questions) that we answer with {id, result}. One app-server process serves everything: the chat
// list, ChatGPT sign-in, usage, and every Codex chat open in the app window (each one is a
// "thread"; notifications carry its threadId).
//
// Codex keeps its sign-in and chats in CODEX_HOME (~/.codex by default), so chats started with the
// Codex CLI in a terminal show up here, and chats started here can be resumed with `codex resume`.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const readline = require('readline');
const sys = require('./system');
const homes = require('./codexhomes');
const { LiveChat, notice, clip, one, stripAnsi, LIMITS } = require('./chat');

const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const MODEL_RE = /^[\w.:\/-]{1,80}$/;
// What a Codex helper paired with a Claude chat is told about its role.
const COMPANION_NOTE = 'You are working alongside Claude (Anthropic’s assistant) in the same project folder, inside Session Switcher. The user sends you the parts of the work they want from you, such as generating or editing images, a second opinion, or a quick test. When you make an image for the project, also save a copy inside the project folder (for example in an "art" or "images" folder) and say where you saved it. Keep replies short; Claude has the wider conversation.';

const CLIENT = { name: 'session_switcher', title: 'Session Switcher', version: '4.1.0' };
const SOURCES = ['cli', 'vscode', 'exec', 'appServer'];
const ACCOUNT = { id: 'codex', name: 'Codex', provider: 'codex' };
const MODES = [
  { value: 'ask', label: 'Ask before acting', approval: 'untrusted', sandbox: 'workspace-write' },
  { value: 'agent', label: 'Agent', approval: 'on-request', sandbox: 'workspace-write' },
  { value: 'read-only', label: 'Read only', approval: 'on-request', sandbox: 'read-only' },
  { value: 'full', label: 'Full access', approval: 'never', sandbox: 'danger-full-access' },
];
const modeOf = v => MODES.find(m => m.value === v) || MODES[1];
const sandboxPolicy = m => (m.sandbox === 'read-only' ? { type: 'readOnly', networkAccess: false }
  : m.sandbox === 'danger-full-access' ? { type: 'dangerFullAccess' }
  : { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false });
const PLAN_LABELS = { free: 'ChatGPT Free', go: 'ChatGPT Go', plus: 'ChatGPT Plus', pro: 'ChatGPT Pro', prolite: 'ChatGPT Pro Lite', promax: 'ChatGPT Pro Max', team: 'ChatGPT Team', business: 'ChatGPT Business', enterprise: 'ChatGPT Enterprise', edu: 'ChatGPT Edu' };
const planLabel = p => (p ? PLAN_LABELS[p] || `ChatGPT ${String(p).replace(/_/g, ' ')}` : null);
const pct = v => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(100, v)) : null);

// ---------- the app-server connection ----------

class CodexServer {
  constructor(cfg, log) {
    Object.assign(this, { cfg, log, proc: null, seq: 0, waiting: new Map(), listeners: new Set(), ready: null, stderr: '', info: null });
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      let proc;
      try { proc = sys.spawnCodex(this.cfg, os.homedir(), ['app-server']); } catch (err) { return reject(err); }
      this.proc = proc;
      proc.on('error', err => { reject(err); this.died(err); });
      proc.on('exit', code => {
        const last = stripAnsi(this.stderr).trim().split(/\r?\n/).filter(l => !/bubblewrap|PATH aliases/i.test(l)).pop() || '';
        const err = new Error(code ? (last || `Codex stopped (code ${code}).`) : 'Codex stopped.');
        if (code === 9009 || /not recognized|not found/i.test(last)) err.missing = true;
        reject(err); this.died(err);
      });
      proc.stdin.on('error', () => { /* exit reports it */ });
      proc.stderr.on('data', d => { this.stderr = (this.stderr + d).slice(-6000); });
      const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
      rl.on('line', line => {
        const s = line.trim();
        if (!s || s[0] !== '{') return;
        let m; try { m = JSON.parse(s); } catch { return; }
        try { this.handle(m); } catch (err) { this.log(`Codex: couldn’t handle a message (${err.message})`); }
      });
      this.call('initialize', { clientInfo: CLIENT, capabilities: { experimentalApi: true } }, 45000)
        .then(r => { this.info = r; this.write({ method: 'initialized' }); resolve(r); })
        .catch(err => { reject(err); this.stop(); });
    });
    this.ready.catch(() => { this.ready = null; });
    return this.ready;
  }

  died(err) {
    if (!this.proc) return;
    this.proc = null; this.ready = null;
    for (const [, w] of this.waiting) { clearTimeout(w.timer); w.reject(err); }
    this.waiting.clear();
    for (const l of [...this.listeners]) if (l.onDied) l.onDied(err);
  }

  write(obj) {
    if (!this.proc || !this.proc.stdin.writable) throw Object.assign(new Error('Codex isn’t running.'), { status: 409 });
    this.proc.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  call(method, params, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`Codex didn’t answer in time (${method}).`)); }, timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (err) { clearTimeout(timer); this.waiting.delete(id); reject(err); }
    });
  }

  async request(method, params = {}, timeoutMs) { await this.start(); return this.call(method, params, timeoutMs); }
  respond(id, result) { try { this.write({ id, result }); } catch { /* gone */ } }
  respondError(id, message) { try { this.write({ id, error: { code: -32601, message } }); } catch { /* gone */ } }

  handle(m) {
    if (m.id !== undefined && m.id !== null && m.method) {
      for (const l of this.listeners) if (l.onRequest && l.onRequest(m)) return;
      this.respondError(m.id, `Session Switcher can’t answer “${m.method}”.`);
      return;
    }
    if (m.id !== undefined && m.id !== null) {
      const w = this.waiting.get(m.id);
      if (!w) return;
      clearTimeout(w.timer); this.waiting.delete(m.id);
      if (m.error) w.reject(Object.assign(new Error(m.error.message || 'Codex refused that.'), { code: m.error.code }));
      else w.resolve(m.result);
      return;
    }
    if (m.method) for (const l of [...this.listeners]) if (l.onNotify) l.onNotify(m.method, m.params || {});
  }

  stop() {
    const p = this.proc;
    if (!p) return;
    try { p.stdin.end(); } catch { /* closed */ }
    setTimeout(() => sys.killTree(p), 1500);
  }
}

// ---------- turning Codex items into what the chat window shows ----------

// Codex runs commands through a shell; show the command itself.
function shortCmd(cmd) {
  const s = String(cmd || '').trim();
  const m = s.match(/^(?:\/bin\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/) || s.match(/^(?:pwsh|powershell)(?:\.exe)?\s+(?:-NoProfile\s+)?-Command\s+(['"])([\s\S]*)\1$/i);
  return m ? m[2] : s;
}
const userView = content => {
  const list = Array.isArray(content) ? content : [];
  return {
    text: clip(list.filter(c => c && c.type === 'text').map(c => c.text).join('\n'), LIMITS.text),
    images: list.filter(c => c && (c.type === 'image' || c.type === 'localImage')).map(c => (c.type === 'localImage' ? { path: c.path } : /^(data:image|https:)/.test(c.url || '') ? { src: c.url } : {})),
  };
};
function imageBlock(item) {
  const result = String(item.result || '');
  let src = null;
  if (/^data:image\//.test(result) || /^https:\/\//.test(result)) src = result;
  else if (!item.savedPath && result.length > 64 && result.length < 12 * 1024 * 1024 && /^[A-Za-z0-9+/=\s]+$/.test(result.slice(0, 256))) src = `data:image/png;base64,${result.replace(/\s+/g, '')}`;
  const failed = !!item.failure || /fail/i.test(item.status || '');
  return {
    type: 'image', id: item.id, status: failed ? 'failed' : (item.savedPath || src) ? 'done' : 'generating',
    prompt: item.revisedPrompt ? one(item.revisedPrompt, 600) : null, path: item.savedPath || null, src,
    failure: item.failure ? (item.failure.type === 'usageLimitExceeded' ? 'Image generation hit its usage limit.' : 'The image couldn’t be made.') : null,
  };
}
function toolBlock(item) {
  switch (item.type) {
    case 'commandExecution': { const c = shortCmd(item.command); return { type: 'tool', id: item.id, name: 'Bash', summary: one(c, 220), detail: clip(c, LIMITS.toolDetail), detailKind: 'command', meta: null }; }
    case 'fileChange': {
      const changes = item.changes || [];
      const first = changes[0] || {};
      const adding = changes.length === 1 && first.kind && first.kind.type === 'add';
      return { type: 'tool', id: item.id, name: adding ? 'Write' : 'Edit', summary: one(changes.map(c => c.path).join(', '), 220), detail: clip(changes.map(c => `${c.path}\n${c.diff || ''}`).join('\n\n'), LIMITS.toolDetail), detailKind: 'text', meta: { path: first.path || null } };
    }
    case 'mcpToolCall': return { type: 'tool', id: item.id, name: `${item.server}: ${item.tool}`, summary: one(JSON.stringify(item.arguments || {}), 200), detail: clip(JSON.stringify(item.arguments || {}, null, 2), LIMITS.toolDetail), detailKind: 'json', meta: null };
    case 'dynamicToolCall': return { type: 'tool', id: item.id, name: item.tool, summary: one(JSON.stringify(item.arguments || {}), 200), detail: clip(JSON.stringify(item.arguments || {}, null, 2), LIMITS.toolDetail), detailKind: 'json', meta: null };
    case 'webSearch': return { type: 'tool', id: item.id, name: 'WebSearch', summary: one(item.query || '', 200), detail: '', detailKind: 'text', meta: null };
    case 'imageView': return { type: 'tool', id: item.id, name: 'Read', summary: one(item.path || '', 220), detail: '', detailKind: 'text', meta: null, viewPath: item.path || null };
    case 'collabAgentToolCall': return { type: 'tool', id: item.id, name: 'Agent', summary: one(item.prompt || item.tool || 'Helper agent', 200), detail: clip(item.prompt || '', LIMITS.toolDetail), detailKind: 'text', meta: null };
    default: return null;
  }
}
function resultOf(item) {
  switch (item.type) {
    case 'commandExecution': {
      const failed = item.status === 'failed' || item.status === 'declined' || (typeof item.exitCode === 'number' && item.exitCode !== 0);
      const text = item.status === 'declined' ? 'You declined this command.' : clip(stripAnsi(item.aggregatedOutput || '').replace(/\r/g, ''), LIMITS.toolResult);
      return { text: text || (failed ? `Exited with code ${item.exitCode}` : ''), isError: failed, images: [] };
    }
    case 'fileChange': return { text: item.status === 'completed' ? `Changed ${(item.changes || []).length} file${(item.changes || []).length === 1 ? '' : 's'}.` : item.status === 'declined' ? 'You declined this change.' : 'The change wasn’t applied.', isError: item.status !== 'completed', images: [] };
    case 'mcpToolCall': {
      const parts = item.result && Array.isArray(item.result.content) ? item.result.content : [];
      const text = parts.filter(p => p && p.type === 'text').map(p => p.text).join('\n');
      return { text: clip(item.error ? (item.error.message || 'The tool failed.') : text, LIMITS.toolResult), isError: !!item.error, images: [] };
    }
    case 'dynamicToolCall': return { text: clip((item.contentItems || []).map(c => c.text || '').join('\n'), LIMITS.toolResult), isError: item.success === false, images: [] };
    case 'webSearch': return { text: item.query ? `Searched for “${item.query}”.` : 'Searched the web.', isError: false, images: [] };
    case 'imageView': return { text: '', isError: false, images: item.path ? [{ path: item.path }] : [] };
    case 'collabAgentToolCall': return { text: '', isError: /fail/i.test(item.status || ''), images: [] };
    default: return null;
  }
}
function blocksOf(item) {
  if (item.type === 'agentMessage') return item.text && item.text.trim() ? [{ type: 'text', text: clip(item.text, LIMITS.text) }] : [];
  if (item.type === 'reasoning') { const t = [...(item.summary || [])].join('\n\n').trim(); return t ? [{ type: 'thinking', text: clip(t, LIMITS.text) }] : []; }
  if (item.type === 'plan') return item.text ? [{ type: 'text', text: clip(item.text, LIMITS.text) }] : [];
  if (item.type === 'imageGeneration') return [imageBlock(item)];
  const b = toolBlock(item);
  if (!b) return [];
  b.result = resultOf(item);
  return [b];
}
// A list of turns (oldest first) as chat-window items.
function historyItems(turns) {
  const out = [];
  for (const t of turns) {
    let cur = null, n = 0;
    const flush = () => { if (cur && cur.blocks.length) out.push(cur); cur = null; };
    for (const it of t.items || []) {
      if (!it) continue;
      if (it.type === 'userMessage') { flush(); out.push({ kind: 'user', ...userView(it.content), at: t.startedAt ? new Date(t.startedAt * 1000).toISOString() : null }); continue; }
      if (it.type === 'contextCompaction') { flush(); out.push(notice('info', 'Codex summarized the conversation to save space.')); continue; }
      const blocks = blocksOf(it);
      if (!blocks.length) continue;
      if (it.type === 'agentMessage' && cur && cur.blocks.some(b => b.type === 'text')) flush();
      if (!cur) cur = { kind: 'assistant', mid: `${t.id}:${n++}`, blocks: [] };
      cur.blocks.push(...blocks);
    }
    if (cur && t.status === 'interrupted') cur.aborted = true;
    flush();
    if (t.status === 'failed' && t.error) out.push(notice('warning', t.error.message || 'Codex stopped with an error.'));
  }
  return out;
}

// ---------- usage ----------

function windowFrom(w) { return w ? { used: pct(w.usedPercent), resetsAt: w.resetsAt ? new Date(w.resetsAt * 1000).toISOString() : null, mins: w.windowDurationMins || null } : null; }
function normalizeRate(snap, byId) {
  if (!snap) return null;
  const wins = [snap.primary, snap.secondary].map(windowFrom).filter(w => w && w.used !== null);
  let five = wins.find(w => w.mins && w.mins <= 6 * 60) || null;
  let week = wins.find(w => w.mins && w.mins >= 24 * 60) || null;
  if (!five && !week) { five = wins[0] || null; week = wins[1] || null; }
  const strip = w => (w ? { used: w.used, resetsAt: w.resetsAt } : null);
  const models = [];
  for (const [k, s] of Object.entries(byId || {})) {
    if (!s || k === (snap.limitId || 'codex')) continue;
    const w = windowFrom(s.secondary || s.primary);
    if (w && w.used !== null) models.push({ name: s.limitName || k, used: w.used, resetsAt: w.resetsAt });
  }
  return {
    available: !!(five || week), subscription: snap.planType || null, fiveHour: strip(five), week: strip(week), models,
    extra: snap.credits && snap.credits.hasCredits ? { used: null, credits: snap.credits.balance, unlimited: !!snap.credits.unlimited } : null,
  };
}

// ---------- a Codex chat in the app window ----------

class CodexChat extends LiveChat {
  constructor(opts) {
    super(opts);
    this.provider = 'codex';
    this.codex = opts.codex;
    this.modes = MODES.map(({ value, label }) => ({ value, label }));
    this.permissionMode = MODES.some(m => m.value === opts.permissionMode) ? opts.permissionMode : 'agent';
    this.model = opts.model && MODEL_RE.test(opts.model) ? opts.model : null;
    this.effort = EFFORTS.includes(opts.effort) ? opts.effort : null;
    this.companion = !!opts.companion;
    Object.assign(this, { turnId: null, turnStarting: false, queue: [], seg: null, segN: 0, segHasText: false, segTextItem: null, items: new Map(), uploads: [], lastProgress: 0 });
  }

  start() {
    this.srv = this.codex.server();
    this.listener = {
      onNotify: (method, p) => { if (p && p.threadId && p.threadId === this.sessionId && this.state !== 'ended') this.onNotify(method, p); },
      onRequest: msg => {
        const p = msg.params || {};
        if (!p.threadId || p.threadId !== this.sessionId || this.state === 'ended') return false;
        this.onRequest(msg);
        return true;
      },
      onDied: err => { this.stderr = err.message; this.end(1); },
    };
    this.srv.listeners.add(this.listener);
    const m = modeOf(this.permissionMode);
    const common = { cwd: this.cwd, approvalPolicy: m.approval, sandbox: m.sandbox, ...(this.model ? { model: this.model } : {}) };
    this.codex.models().then(list => { this.models = list; this.emitModel(); }).catch(() => {});
    if (this.companion && !this.sessionId) common.developerInstructions = COMPANION_NOTE;
    const go = !this.sessionId ? this.srv.request('thread/start', common, 60000)
      : this.fork ? this.srv.request('thread/fork', { threadId: this.sessionId, ...common, excludeTurns: true }, 60000)
      : this.srv.request('thread/resume', { threadId: this.sessionId, ...common, excludeTurns: true }, 60000);
    go.then(r => {
      const t = r.thread;
      const changed = t.id !== this.sessionId;
      this.sessionId = t.id;
      this.resolvedModel = r.model || t.model || null;
      if (!this.model) this.model = this.resolvedModel;
      if (!this.effort && EFFORTS.includes(r.reasoningEffort)) this.effort = r.reasoningEffort;
      if (t.name) this.title = t.name;
      this.emit({ kind: 'init', sessionId: t.id, model: this.resolvedModel, permissionMode: this.permissionMode });
      this.emitModel();
      if (changed) this.onSession(this);
      this.setState(this.queue.length ? 'busy' : 'ready');
      this.flush();
    }).catch(err => {
      this.emit(notice('warning', `Couldn’t start Codex: ${err.message}${err.missing ? ' Install it from Setup.' : ''}`));
      this.end(null);
    });
  }

  end(code) {
    if (this.state === 'ended') return;
    if (this.srv && this.listener) this.srv.listeners.delete(this.listener);
    super.end(code);
    for (const f of this.uploads) fs.unlink(f, () => {});
  }

  write() { throw Object.assign(new Error('This chat has stopped. Start it again to keep going.'), { status: 409 }); }
  request() { return Promise.reject(new Error('Not supported for Codex chats.')); }

  newSeg() { this.segN++; this.seg = `${this.turnId || 'turn'}:${this.segN}`; this.segHasText = false; this.segTextItem = null; }
  textSeg(itemId) {
    if (!this.seg) this.newSeg();
    if (this.segTextItem === itemId) return;
    if (this.segHasText || this.segTextItem) this.newSeg();
    this.segTextItem = itemId;
  }

  onNotify(method, p) {
    switch (method) {
      case 'turn/started': this.turnId = p.turn.id; this.newSeg(); this.setState(this.pending.size ? 'waiting' : 'busy'); break;
      case 'item/started': this.itemStarted(p.item); break;
      case 'item/agentMessage/delta': this.textSeg(p.itemId); this.emit({ kind: 'delta', mid: this.seg, text: p.delta || '' }); break;
      case 'item/reasoning/summaryTextDelta': case 'item/reasoning/textDelta': this.emit({ kind: 'delta', mid: this.seg, text: '', thinking: true }); break;
      case 'item/completed': this.itemCompleted(p.item); break;
      case 'item/commandExecution/outputDelta': {
        const now = Date.now();
        if (now - this.lastProgress < 1000) break;
        this.lastProgress = now;
        const it = this.items.get(p.itemId);
        this.emit({ kind: 'tool_progress', toolUseId: p.itemId, name: 'Command', seconds: it && it._started ? Math.round((now - it._started) / 1000) : 0 });
        break;
      }
      case 'turn/plan/updated': this.emit({ kind: 'plan', steps: (p.plan || []).map(s => ({ content: one(s.step, 200), status: s.status === 'inProgress' ? 'in_progress' : s.status })) }); break;
      case 'turn/completed': {
        const t = p.turn || {};
        this.turnId = null;
        this.items.clear();
        this.emit({ kind: 'result', ok: t.status === 'completed', errors: t.error ? [t.error.message] : [], text: '', interrupted: t.status === 'interrupted' });
        this.setState(this.pending.size ? 'waiting' : this.queue.length ? 'busy' : 'ready');
        this.flush();
        break;
      }
      case 'error':
        if (p.willRetry) this.emit({ kind: 'status', text: `Reconnecting to Codex… ${one((p.error && p.error.message) || '', 60)}` });
        else this.emit(notice('warning', (p.error && (p.error.message + (p.error.additionalDetails ? `\n${p.error.additionalDetails}` : ''))) || 'Codex hit an error.'));
        break;
      case 'warning': if (p.message || p.summary) this.emit(notice('info', p.message || p.summary)); break;
      case 'thread/name/updated': if (p.threadName) { this.title = p.threadName; this.onChange(this); } break;
      case 'thread/compacted': this.emit(notice('info', 'Codex summarized the conversation to save space.')); break;
      case 'serverRequest/resolved': {
        const id = String(p.requestId);
        if (this.pending.delete(id)) { this.emit({ kind: 'permission_cancel', requestId: id }); this.setState(this.pending.size ? 'waiting' : this.turnId ? 'busy' : 'ready'); }
        break;
      }
      case 'thread/closed': if (!this.stopping) this.end(null); break;
      default: break;
    }
  }

  itemStarted(item) {
    if (!item || item.type === 'userMessage') return; // shown when it was sent
    if (item.type === 'agentMessage') { this.textSeg(item.id); this.emit({ kind: 'stream_start', mid: this.seg }); return; }
    if (item.type === 'reasoning') { this.emit({ kind: 'delta', mid: this.seg || 'turn', text: '', thinking: true }); return; }
    if (!this.seg) this.newSeg();
    if (item.type === 'imageGeneration') { this.items.set(item.id, item); this.emit({ kind: 'assistant', mid: this.seg, blocks: [{ type: 'image', id: item.id, status: 'generating', prompt: item.revisedPrompt ? one(item.revisedPrompt, 600) : null }] }); return; }
    const b = toolBlock(item);
    if (!b) return;
    item._started = Date.now();
    this.items.set(item.id, item);
    this.emit({ kind: 'assistant', mid: this.seg, blocks: [b] });
    this.emit({ kind: 'tool_start', name: b.name, toolUseId: item.id });
  }

  itemCompleted(item) {
    if (!item || item.type === 'userMessage' || item.type === 'contextCompaction') return;
    if (!this.seg) this.newSeg();
    if (item.type === 'agentMessage') {
      this.textSeg(item.id);
      const blocks = blocksOf(item);
      if (blocks.length) this.emit({ kind: 'assistant', mid: this.seg, blocks });
      this.segHasText = true;
      return;
    }
    if (item.type === 'reasoning' || item.type === 'plan' || item.type === 'imageGeneration') {
      const blocks = blocksOf(item);
      if (blocks.length) this.emit({ kind: 'assistant', mid: this.seg, blocks });
      return;
    }
    const r = resultOf(item);
    if (!r) return;
    if (this.items.has(item.id)) this.emit({ kind: 'tool_result', toolUseId: item.id, result: r });
    else { const blocks = blocksOf(item); if (blocks.length) this.emit({ kind: 'assistant', mid: this.seg, blocks }); }
    this.items.set(item.id, item);
  }

  onRequest(msg) {
    const p = msg.params || {};
    const id = String(msg.id);
    let event;
    switch (msg.method) {
      case 'item/commandExecution/requestApproval': {
        const cmd = shortCmd(p.command || (this.items.get(p.itemId) || {}).command || '');
        event = { kind: 'permission', requestId: id, toolName: 'Bash', toolUseId: p.itemId || null, title: p.networkApprovalContext ? 'Network access' : null, description: null, reason: p.reason ? stripAnsi(p.reason) : null, blockedPath: null, view: { summary: one(cmd, 220), detail: clip(cmd, LIMITS.toolDetail), detailKind: 'command' }, canAlways: true, defaultToNo: false, questions: null };
        break;
      }
      case 'item/fileChange/requestApproval': {
        const changes = ((this.items.get(p.itemId) || {}).changes) || [];
        event = { kind: 'permission', requestId: id, toolName: 'Edit', toolUseId: p.itemId || null, title: null, description: null, reason: p.reason || (p.grantRoot ? `It wants to write inside ${p.grantRoot}.` : null), blockedPath: null, view: { summary: one(changes.map(c => c.path).join(', '), 220), detail: clip(changes.map(c => `${c.path}\n${c.diff || ''}`).join('\n\n'), 6000), detailKind: 'text' }, canAlways: true, defaultToNo: false, questions: null };
        break;
      }
      case 'item/tool/requestUserInput':
        event = { kind: 'permission', requestId: id, toolName: 'AskUserQuestion', toolUseId: p.itemId || null, view: {}, canAlways: false, defaultToNo: false,
          questions: (p.questions || []).map(q => ({ id: q.id, header: q.header || '', question: q.question || '', multiSelect: false, options: (q.options || []).map(o => ({ label: o.label, description: o.description || '' })) })) };
        break;
      case 'item/permissions/requestApproval':
        event = { kind: 'permission', requestId: id, toolName: 'Permissions', toolUseId: p.itemId || null, title: 'More access', description: null, reason: p.reason || null, blockedPath: null, view: { summary: 'more access', detail: clip(JSON.stringify(p.permissions || {}, null, 2), 4000), detailKind: 'json' }, canAlways: true, defaultToNo: false, questions: null };
        break;
      default:
        this.srv.respondError(msg.id, `Session Switcher can’t answer “${msg.method}” yet.`);
        return;
    }
    this.pending.set(id, { method: msg.method, rawId: msg.id, params: p, event });
    this.emit(event);
    this.setState('waiting');
  }

  answer(requestId, { decision, message, answers }) {
    const p = this.pending.get(requestId);
    if (!p) throw Object.assign(new Error('That request isn’t waiting any more.'), { status: 404 });
    let result;
    switch (p.method) {
      case 'item/commandExecution/requestApproval':
      case 'item/fileChange/requestApproval':
        result = { decision: decision === 'deny' ? 'decline' : decision === 'always' ? 'acceptForSession' : 'accept' };
        break;
      case 'item/tool/requestUserInput': {
        const out = {};
        for (const q of p.event.questions) {
          const a = answers && answers[q.question];
          out[q.id] = { answers: decision === 'deny' || !a ? [] : String(a).split(', ').filter(Boolean) };
        }
        result = { answers: out };
        break;
      }
      case 'item/permissions/requestApproval':
        result = decision === 'deny' ? { permissions: {}, scope: 'turn' } : { permissions: { ...(p.params.permissions && p.params.permissions.network ? { network: p.params.permissions.network } : {}), ...(p.params.permissions && p.params.permissions.fileSystem ? { fileSystem: p.params.permissions.fileSystem } : {}) }, scope: decision === 'always' ? 'session' : 'turn' };
        break;
      default: result = {};
    }
    this.srv.respond(p.rawId, result);
    this.pending.delete(requestId);
    this.emit({ kind: 'permission_done', requestId, decision });
    this.setState(this.pending.size ? 'waiting' : 'busy');
    if (decision === 'deny' && message) this.steer(message);
  }

  // Adds a message to the turn that's running (used for "tell Codex what to do instead").
  steer(text) {
    this.emit({ kind: 'user', text: clip(text, LIMITS.text), images: [], at: new Date().toISOString(), local: true });
    const input = [{ type: 'text', text, text_elements: [] }];
    if (!this.turnId) { this.queue.push(input); this.flush(); return; }
    this.srv.request('turn/steer', { threadId: this.sessionId, input, expectedTurnId: this.turnId }).catch(() => { this.queue.push(input); });
  }

  send(text, images = []) {
    if (this.state === 'ended') throw Object.assign(new Error('This chat has stopped. Start it again to keep going.'), { status: 409 });
    const input = [];
    if (text) input.push({ type: 'text', text, text_elements: [] });
    for (const img of images) {
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[img.mediaType] || 'png';
      const dir = path.join(os.tmpdir(), 'claude-switcher');
      fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, `codex-${crypto.randomBytes(6).toString('hex')}.${ext}`);
      fs.writeFileSync(f, Buffer.from(img.data, 'base64'));
      this.uploads.push(f);
      input.push({ type: 'localImage', path: f });
    }
    this.emit({ kind: 'user', text: clip(text, LIMITS.text), images: images.map(i => ({ src: `data:${i.mediaType};base64,${i.data}` })), at: new Date().toISOString(), local: true });
    this.queue.push(input);
    if (this.state !== 'waiting') this.setState('busy');
    this.flush();
  }

  flush() {
    if (this.turnId || this.turnStarting || !this.queue.length || !this.sessionId || this.state === 'ended' || this.state === 'starting') return;
    const input = this.queue.splice(0).flat();
    const m = modeOf(this.permissionMode);
    this.turnStarting = true;
    this.srv.request('turn/start', { threadId: this.sessionId, input, approvalPolicy: m.approval, sandboxPolicy: sandboxPolicy(m), ...(this.model ? { model: this.model } : {}), ...(this.effort ? { effort: this.effort } : {}) }, 60000)
      .then(r => { this.turnStarting = false; if (r && r.turn && !this.turnId) { this.turnId = r.turn.id; this.newSeg(); } })
      .catch(err => {
        this.turnStarting = false;
        this.emit(notice('warning', `Codex couldn’t start that: ${err.message}`));
        this.emit({ kind: 'result', ok: false, errors: [], text: '' });
        this.setState('ready');
      });
  }

  async interrupt() {
    if (!this.turnId) return {};
    const r = await this.srv.request('turn/interrupt', { threadId: this.sessionId, turnId: this.turnId }, 15000);
    this.emit(notice('info', 'You stopped Codex.'));
    return r;
  }

  async setMode(mode) {
    if (!MODES.some(m => m.value === mode)) throw Object.assign(new Error('Unknown mode.'), { status: 400 });
    this.permissionMode = mode;
    this.emit({ kind: 'status', permissionMode: mode });
  }

  // Codex takes the model and effort with each turn, so a switch applies from the next message.
  effortsFor() {
    const m = (this.models || []).find(x => x.value === this.model) || (this.models || []).find(x => x.isDefault);
    return m && m.efforts.length ? m.efforts : EFFORTS.slice(1, 4);
  }
  async setModel(model) {
    if (!MODEL_RE.test(String(model || ''))) throw Object.assign(new Error('Unknown model.'), { status: 400 });
    const m = (this.models || []).find(x => x.value === model);
    if (this.models && this.models.length && !m) throw Object.assign(new Error('Codex doesn’t offer that model.'), { status: 400 });
    this.model = model; this.resolvedModel = model;
    if (m && this.effort && !m.efforts.includes(this.effort)) this.effort = m.defaultEffort || null;
    this.emitModel();
  }
  async setEffort(effort) {
    if (!EFFORTS.includes(effort)) throw Object.assign(new Error('Unknown effort level.'), { status: 400 });
    this.effort = effort;
    this.emitModel();
  }

  stop() {
    if (this.state === 'ended') return this.exited;
    this.stopping = true;
    if (this.turnId) this.srv.request('turn/interrupt', { threadId: this.sessionId, turnId: this.turnId }, 5000).catch(() => {});
    if (this.sessionId) this.srv.request('thread/unsubscribe', { threadId: this.sessionId }, 5000).catch(() => {});
    this.end(null);
    return this.exited;
  }
}

// ---------- the Codex manager ----------

// One per Codex account. The main one (ACCOUNT) uses the Codex home from Setup (~/.codex by
// default); extra ones ({ id, name, home, kind }) use their own home (see codexhomes.js).
function createCodex({ getConfig, log = () => {}, onChange = () => {}, usage, chats, account = ACCOUNT }) {
  const acct = { ...ACCOUNT, ...account };
  const isOllama = acct.kind === 'ollama';
  let server = null, serverSig = '';
  const state = { checked: false, installed: null, signedIn: false, authMode: null, email: null, plan: null, planType: null, error: null, at: 0, signingIn: false };
  let threads = { at: 0, list: [], error: null };
  let listing = null;

  const enabled = () => (getConfig().codex || {}).enabled !== false;
  const changed = () => { try { onChange(); } catch { /* ignore */ } };
  const listener = {
    onNotify(method, p) {
      if (method === 'account/rateLimits/updated' && p.rateLimits) setUsage(p.rateLimits, null, true);
      else if (method === 'account/login/completed') {
        state.signingIn = false; pendingLogin = null;
        state.error = p.success ? null : (p.error || 'Sign-in didn’t finish.');
        refreshAccount().then(() => refreshUsage()).catch(() => {});
        changed();
      } else if (method === 'account/updated') refreshAccount().catch(() => {});
      else if (method === 'thread/started' || method === 'thread/name/updated' || method === 'turn/completed') threads.at = 0;
    },
    onDied(err) { if (!state.error && err && err.message !== 'Codex stopped.') state.error = err.message; },
  };

  // The config this account's Codex runs with: the shared settings, with its own home.
  function acctConfig() {
    const cfg = getConfig();
    return acct.home ? { ...cfg, codex: { ...(cfg.codex || {}), home: acct.home } } : cfg;
  }
  function srv() {
    const cfg = acctConfig();
    const sig = JSON.stringify({ c: cfg.codex || {}, e: cfg.prefs.cleanEnv });
    if (server && sig !== serverSig) { server.stop(); server = null; }
    if (!server) {
      if (acct.home) {
        const r = homes.ensureHome(acct, (getConfig().codex || {}).home || homes.MAIN_HOME());
        if (r.done.length) log(`${acct.name}: linked ${r.done.join(', ')}`);
        if (r.errors.length) log(`${acct.name}: couldn’t link ${r.errors.join('; ')}`);
      }
      server = new CodexServer(cfg, log); serverSig = sig; server.listeners.add(listener);
    }
    return server;
  }

  function failed(err) {
    state.checked = true;
    if (err.missing || err.code === 'ENOENT') { state.installed = false; state.error = 'Codex isn’t installed on this PC yet. Install it from Setup.'; }
    else state.error = err.message;
    changed();
  }

  async function refreshAccount() {
    if (!enabled()) return state;
    if (isOllama) return refreshOllama();
    try {
      const r = await srv().request('account/read', { refreshToken: false }, 30000);
      const a = r && r.account;
      Object.assign(state, {
        checked: true, installed: true, at: Date.now(), error: null,
        signedIn: !!a, authMode: a ? a.type : null, email: a && a.email ? a.email : null, planType: a && a.planType ? a.planType : null,
        plan: a ? (a.type === 'chatgpt' ? planLabel(a.planType) : a.type === 'apiKey' ? 'API key' : a.type) : null,
      });
      changed();
    } catch (err) { failed(err); }
    return state;
  }

  // Ollama: "signed in" means the Ollama app is running and signed in to ollama.com. Codex itself
  // needs no ChatGPT sign-in for it.
  async function refreshOllama() {
    const st = await homes.ollamaStatus();
    Object.assign(state, {
      checked: true, installed: true, at: Date.now(), signingIn: false,
      signedIn: st.running, authMode: 'ollama', email: st.email || (st.running ? 'Ollama app running' : null),
      plan: st.running ? (st.signedIn ? `Ollama ${st.plan ? st.plan[0].toUpperCase() + st.plan.slice(1) : 'Cloud'}` : 'Ollama (local)') : null, planType: 'ollama',
      error: st.running ? (st.signedIn ? null : 'The Ollama app is running but not signed in to ollama.com, so cloud models won’t work. Run “ollama signin”.') : st.error,
      cloudModels: st.cloudModels || [],
    });
    changed();
    return state;
  }

  function setUsage(snapshot, byId, live) {
    const data = normalizeRate(snapshot, byId);
    if (!data) return;
    const prev = usage.get(acct.id);
    if (live && prev && prev.data && !byId) data.models = prev.data.models || [];
    usage.set(acct.id, data);
  }

  async function refreshUsage() {
    if (!enabled() || !state.signedIn || isOllama) return null; // ollama.com shows its own usage; there's no API for it
    usage.mark(acct.id, true);
    try {
      const r = await srv().request('account/rateLimits/read', {}, 30000);
      setUsage(r.rateLimits, r.rateLimitsByLimitId, false);
    } catch (err) { usage.fail(acct.id, err.message); }
    return usage.get(acct.id);
  }

  const toSession = (t, lastOpened) => {
    const updated = (t.updatedAt || t.createdAt || 0) * 1000;
    return {
      id: t.id, provider: 'codex', title: t.name || one(t.preview || '', 90) || 'Codex chat', autoTitle: one(t.preview || '', 90) || 'Codex chat',
      firstPrompt: one(t.preview || '', 240), lastPrompt: null, cwd: t.cwd, updated, created: (t.createdAt || 0) * 1000,
      active: Date.now() - updated < 3 * 60 * 1000, sizeKB: 0, branch: t.gitInfo && t.gitInfo.branch ? t.gitInfo.branch : null,
      model: t.model || null, renamed: !!t.name, lastOpened: lastOpened(t.id), source: typeof t.source === 'string' ? t.source : 'other',
      running: t.status && t.status.type === 'active',
    };
  };

  // Codex chats on this PC, newest first. Cached for a few seconds; refreshes in the background.
  async function list({ maxAgeMs = 15000, lastOpened = () => null } = {}) {
    if (!enabled() || state.installed === false) return [];
    if (Date.now() - threads.at < maxAgeMs) return threads.list.map(t => toSession(t, lastOpened));
    if (!listing) {
      listing = (async () => {
        const all = [];
        let cursor = null;
        for (let page = 0; page < 5; page++) {
          const r = await srv().request('thread/list', { limit: 100, sortKey: 'updated_at', sourceKinds: SOURCES, ...(cursor ? { cursor } : {}) }, 45000);
          all.push(...(r.data || []).filter(t => !t.ephemeral && !t.parentThreadId));
          cursor = r.nextCursor;
          if (!cursor) break;
        }
        threads = { at: Date.now(), list: all, error: null };
        state.installed = true; state.checked = true;
      })().catch(err => { threads = { ...threads, at: Date.now(), error: err.message }; failed(err); })
        .finally(() => { listing = null; });
    }
    await listing;
    return threads.list.map(t => toSession(t, lastOpened));
  }
  const known = id => threads.list.find(t => t.id === id) || null;

  async function history(threadId, cursor, until = null) {
    let r;
    try {
      r = await srv().request('thread/turns/list', { threadId, limit: 12, itemsView: 'full', sortDirection: 'desc', ...(cursor ? { cursor } : {}) }, 45000);
    } catch (err) {
      // A thread that was started but never sent a message (like a Codex helper you opened and
      // didn't use) has no history yet.
      if (/not materialized|thread not loaded/i.test(err.message)) return { items: [], start: 0, cursor: null };
      throw err;
    }
    // Turns from after `until` are shown live by the open chat, so they're left out here.
    const untilS = until ? Date.parse(until) / 1000 : null;
    const turns = (r.data || []).slice().reverse().filter(t => !untilS || !t.startedAt || t.startedAt < untilS);
    return { items: historyItems(turns), start: r.nextCursor ? 1 : 0, cursor: r.nextCursor || null };
  }

  async function preview(threadId) {
    const h = await history(threadId);
    const messages = [];
    for (const it of h.items) {
      if (it.kind === 'user' && it.text) messages.push({ role: 'you', text: clip(it.text, 900), at: it.at });
      else if (it.kind === 'assistant') { const t = it.blocks.filter(b => b.type === 'text').map(b => b.text).join('\n\n'); if (t) messages.push({ role: 'claude', text: clip(t, 900), at: null, who: 'Codex' }); }
    }
    return messages.slice(-12);
  }

  // ChatGPT sign-in. "browser" gives a link to OpenAI's sign-in page (Codex listens for the reply on
  // this PC); "code" gives a short code to enter on OpenAI's site, which works from any browser.
  let pendingLogin = null;
  const OPENAI_HOST = /(^|\.)(openai\.com|chatgpt\.com)$/i;
  async function login(method = 'browser') {
    if (isOllama) throw Object.assign(new Error('Ollama doesn’t use a ChatGPT sign-in. Start the Ollama app and run “ollama signin” to use cloud models.'), { status: 400 });
    if (pendingLogin) { await srv().request('account/login/cancel', { loginId: pendingLogin }, 10000).catch(() => {}); pendingLogin = null; }
    const r = await srv().request('account/login/start', { type: method === 'code' ? 'chatgptDeviceCode' : 'chatgpt' }, 30000);
    const link = r.authUrl || r.verificationUrl || '';
    let host = '';
    try { host = new URL(link).hostname; } catch { /* checked below */ }
    log(`Codex sign-in started (${method}) on ${host || 'an unknown address'}`);
    if (!OPENAI_HOST.test(host)) {
      if (r.loginId) srv().request('account/login/cancel', { loginId: r.loginId }, 10000).catch(() => {});
      throw Object.assign(new Error(`The Codex command answered with a sign-in page on “${host || link || 'nothing'}”, which isn’t OpenAI’s. Check the Codex command in Setup: it should be OpenAI’s Codex (npm package @openai/codex).`), { status: 502 });
    }
    pendingLogin = r.loginId || null;
    state.signingIn = true; state.error = null; changed();
    return { type: r.type, loginId: r.loginId, authUrl: r.authUrl || null, verificationUrl: r.verificationUrl || null, userCode: r.userCode || null, host };
  }
  async function cancelLogin() {
    if (pendingLogin) await srv().request('account/login/cancel', { loginId: pendingLogin }, 10000).catch(() => {});
    pendingLogin = null; state.signingIn = false; changed();
  }
  async function logout() {
    await srv().request('account/logout', {}, 30000);
    usage.forget(acct.id);
    await refreshAccount();
  }
  async function rename(threadId, name) {
    await srv().request('thread/name/set', { threadId, name: String(name || '').slice(0, 120) }, 30000);
    threads.at = 0;
  }

  function open({ cfg, cwd, threadId = null, fork = false, mode = null, model = null, effort = null, companion = false, title = null, folder = null }) {
    return chats.open({ Chat: CodexChat, codex: api, cfg: acctConfig(), account: { id: acct.id, name: acct.name, provider: 'codex' }, cwd, sessionId: threadId, fork, permissionMode: mode, model, effort, companion, title, folder });
  }

  // The models Codex offers on this plan, for the model picker. Cached for ten minutes.
  let modelList = { at: 0, list: [] }, modelLoading = null;
  async function models() {
    if (Date.now() - modelList.at < 10 * 60 * 1000 && modelList.list.length) return modelList.list;
    if (!modelLoading) {
      modelLoading = srv().request('model/list', {}, 30000).then(r => {
        const list = ((r && r.data) || []).filter(m => m && !m.hidden).slice(0, 40).map(m => ({
          value: m.id || m.model, label: m.displayName || m.id, description: m.description || '', isDefault: !!m.isDefault,
          efforts: (m.supportedReasoningEfforts || []).map(e => e.reasoningEffort || e).filter(e => EFFORTS.includes(e)), defaultEffort: m.defaultReasoningEffort || null,
        }));
        modelList = { at: Date.now(), list };
        return list;
      }).finally(() => { modelLoading = null; });
    }
    return modelLoading;
  }

  function publicState() {
    const cfg = getConfig();
    return { id: acct.id, name: acct.name, provider: 'codex', kind: acct.kind || 'chatgpt', main: !acct.home, cloudModels: state.cloudModels || null,
      enabled: enabled(), command: (cfg.codex && cfg.codex.command) || 'codex', home: acct.home || (cfg.codex && cfg.codex.home) || null, checked: state.checked, installed: state.installed, signedIn: state.signedIn, authMode: state.authMode, email: state.email, plan: state.plan, planType: state.planType, error: state.error, signingIn: state.signingIn, checkedAt: state.at || null };
  }

  function stop() { if (server) server.stop(); server = null; }

  const cached = lastOpened => threads.list.map(t => toSession(t, lastOpened || (() => null)));
  const api = { server: srv, config: acctConfig, refreshAccount, refreshUsage, list, cached, known, history, preview, login, cancelLogin, logout, rename, open, models, publicState, stop, ACCOUNT: acct, MODES };
  return api;
}

module.exports = { createCodex, CodexServer, CodexChat, historyItems, normalizeRate, shortCmd, MODES, ACCOUNT, EFFORTS };
