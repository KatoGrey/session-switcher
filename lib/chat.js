'use strict';
// The chat window's engine.
//  - readHistory(): turns a session file into display items (messages, tool steps paired with
//    their results, images, notices).
//  - LiveChat: runs Claude Code itself in its streaming mode (`--input-format stream-json
//    --output-format stream-json --permission-prompt-tool stdio`), as the chosen account, and
//    translates its messages and permission requests for the page.

const fs = require('fs');
const readline = require('readline');
const crypto = require('crypto');
const sys = require('./system');
const { isRealPrompt, messageText } = require('./sessions');

const LIMITS = { text: 40000, toolDetail: 8000, toolResult: 8000, imageBytes: 5 * 1024 * 1024, buffer: 5000, stderr: 20000 };
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MODES = ['default', 'acceptEdits', 'plan', 'auto'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const MODEL_RE = /^[\w.:\[\]-]{1,80}$/;

// Claude Code's model list (from its handshake), in the shape the model picker shows.
function modelsView(list) {
  return (Array.isArray(list) ? list : []).slice(0, 40).filter(m => m && m.value).map(m => ({
    value: String(m.value), label: String(m.displayName || m.value), description: String(m.description || ''),
    resolved: m.resolvedModel || null, efforts: Array.isArray(m.supportedEffortLevels) ? m.supportedEffortLevels.filter(e => EFFORTS.includes(e)) : [],
  }));
}

const stripAnsi = s => String(s ?? '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n)}\n… (${(s.length - n).toLocaleString()} more characters not shown)` : s; };
const one = (s, n = 200) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// ---------- shared views ----------

function imageFrom(block) {
  if (!block || block.type !== 'image' || !block.source) return null;
  const src = block.source;
  if (src.type === 'base64' && IMAGE_TYPES.has(src.media_type) && typeof src.data === 'string') {
    if (src.data.length * 0.75 > LIMITS.imageBytes) return { tooLarge: true };
    return { src: `data:${src.media_type};base64,${src.data}` };
  }
  if (src.type === 'url' && /^https:\/\//.test(src.url || '')) return { url: src.url };
  return null;
}
const contentImages = content => (Array.isArray(content) ? content.map(imageFrom).filter(Boolean) : []);

// What a tool call did, in a form the page can show without knowing every tool.
function toolView(name, input) {
  const i = input && typeof input === 'object' ? input : {};
  let summary;
  switch (name) {
    case 'Bash': case 'PowerShell': summary = i.description || i.command; break;
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit': summary = i.file_path || i.notebook_path; break;
    case 'Glob': summary = i.pattern; break;
    case 'Grep': summary = `${i.pattern || ''}${i.path ? ` in ${i.path}` : ''}`; break;
    case 'WebFetch': summary = i.url; break;
    case 'WebSearch': summary = i.query; break;
    case 'Agent': case 'Task': summary = i.description || i.prompt; break;
    case 'TodoWrite': summary = `${(i.todos || []).length} items`; break;
    case 'Artifact': summary = [i.action || 'publish', i.title || i.url || i.file_path].filter(Boolean).join(': '); break;
    case 'AskUserQuestion': summary = (i.questions || []).map(q => q.question).join(' / '); break;
    default: summary = i.description || i.title || i.file_path || i.path || i.url || i.query || i.command || i.prompt || '';
  }
  let detail, kind = 'json';
  if ((name === 'Bash' || name === 'PowerShell') && i.command) { detail = clip(i.command, LIMITS.toolDetail); kind = 'command'; }
  else if (name === 'Edit' && (i.old_string !== undefined || i.new_string !== undefined)) { detail = { old: clip(i.old_string, LIMITS.toolDetail / 2), new: clip(i.new_string, LIMITS.toolDetail / 2) }; kind = 'diff'; }
  else if (name === 'Write' && typeof i.content === 'string') { detail = clip(i.content, LIMITS.toolDetail); kind = 'text'; }
  else if (name === 'TodoWrite' && Array.isArray(i.todos)) { detail = i.todos.map(t => `${t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '○'} ${t.content || t.activeForm || ''}`).join('\n'); kind = 'text'; }
  else { try { detail = clip(JSON.stringify(i, null, 2), LIMITS.toolDetail); } catch { detail = ''; } }
  // A few structured facts for the chat window's ledger (files touched, tasks).
  let meta = null;
  if (name === 'TodoWrite' && Array.isArray(i.todos)) meta = { todos: i.todos.slice(0, 60).map(t => ({ content: one(t.content || t.activeForm || '', 160), status: t.status || 'pending' })) };
  else if (name === 'TaskCreate') meta = { subject: one(i.subject || i.description || '', 160) };
  else if (name === 'TaskUpdate') meta = { taskId: String(i.taskId || i.id || ''), status: i.status || null, subject: i.subject ? one(i.subject, 160) : null };
  else if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name)) meta = { path: i.file_path || i.notebook_path || null };
  return { summary: one(stripAnsi(summary), 220), detail, detailKind: kind, title: i.title || null, meta };
}

// lazy: keep the picture blocks as they are, to be turned into data addresses later (history).
function resultView(block, lazy = false) {
  const c = block.content;
  let text = '', images = [], imgRaw = null;
  if (typeof c === 'string') text = c;
  else if (Array.isArray(c)) {
    text = c.filter(b => b && b.type === 'text').map(b => b.text).join('\n');
    if (lazy) imgRaw = c.some(b => b && b.type === 'image') ? c : null; else images = contentImages(c);
  }
  const out = { text: clip(stripAnsi(text).replace(/\r/g, ''), LIMITS.toolResult), isError: !!block.is_error, images };
  if (lazy) out.imgRaw = imgRaw;
  return out;
}

function assistantBlocks(content) {
  const out = [];
  if (!Array.isArray(content)) return typeof content === 'string' && content.trim() ? [{ type: 'text', text: clip(content, LIMITS.text) }] : out;
  for (const b of content) {
    if (!b) continue;
    if (b.type === 'text' && b.text && b.text.trim()) out.push({ type: 'text', text: clip(b.text, LIMITS.text) });
    else if (b.type === 'thinking' && b.thinking && b.thinking.trim()) out.push({ type: 'thinking', text: clip(b.thinking, LIMITS.text) });
    else if (b.type === 'tool_use' || b.type === 'server_tool_use') out.push({ type: 'tool', id: b.id, name: b.name, ...toolView(b.name, b.input) });
  }
  return out;
}

const notice = (level, text, extra = {}) => ({ kind: 'notice', level, text: clip(stripAnsi(text).trim(), 3000), ...extra });

function commandNotice(e) {
  const t = messageText(e.message).trim();
  const name = t.match(/<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/);
  if (name) return `You ran /${name[1]}`;
  const out = t.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
  if (out && stripAnsi(out[1]).trim()) return stripAnsi(out[1]).trim();
  return null;
}

// ---------- history ----------

// Reads a chat's messages from the end of its transcript backwards, a page at a time, so a chat
// of any length opens at once. `cursor` is the byte offset the previous page started at;
// `until` stops at a time (what's newer arrives live). Pictures are only turned into data
// addresses for the messages actually returned.
async function readHistory(file, { until = null, cursor = null, limit = 60 } = {}) {
  const size = fs.statSync(file).size;
  const end = cursor !== null && cursor !== undefined && cursor !== '' ? Math.max(0, Math.min(size, Number(cursor) || 0)) : size;
  const untilMs = until ? Date.parse(until) : null;
  let span = 2 * 1024 * 1024, parsed;
  for (;;) {
    parsed = parseRange(file, Math.max(0, end - span), end, untilMs);
    if (parsed.items.length > limit || parsed.from === 0 || span >= 64 * 1024 * 1024) break;
    span *= 4;
  }
  const { items } = parsed;
  const first = Math.max(0, items.length - limit);
  const page = items.slice(first);
  const more = first > 0 || parsed.from > 0;
  const next = first > 0 ? page[0].off : parsed.from;
  for (const it of page) materialize(it);
  return { items: page, start: more ? 1 : 0, cursor: more ? String(next) : null };
}

// Parses the complete lines between two byte offsets into display items (each remembers the byte
// offset it started at, for paging).
function parseRange(file, from, to, untilMs) {
  const len = Math.max(0, to - from);
  const buf = Buffer.alloc(len);
  if (len) { const fd = fs.openSync(file, 'r'); try { fs.readSync(fd, buf, 0, len, from); } finally { fs.closeSync(fd); } }
  let pos = 0;
  if (from > 0) { const nl = buf.indexOf(10); pos = nl === -1 ? len : nl + 1; }
  const start = from + pos;
  const items = [];
  const tools = new Map();
  let cur = null;
  while (pos < len) {
    let nl = buf.indexOf(10, pos);
    if (nl === -1) nl = len;
    const off = from + pos;
    const line = buf.toString('utf8', pos, nl).trim();
    pos = nl + 1;
    if (!line || line[0] !== '{') continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (untilMs && e.timestamp && Date.parse(e.timestamp) >= untilMs) break;
    if (e.isSidechain) continue;
    const at = e.timestamp || null;

    if (e.type === 'user' && e.message) {
      const content = e.message.content;
      const results = Array.isArray(content) ? content.filter(b => b && b.type === 'tool_result') : [];
      if (results.length) {
        for (const r of results) { const t = tools.get(r.tool_use_id); if (t) t.result = resultView(r, true); }
        continue;
      }
      if (e.isCompactSummary) { cur = null; items.push(notice('info', 'The conversation was summarized here to free up space.', { at, off })); continue; }
      const cmd = commandNotice(e);
      if (cmd) { items.push(notice('info', cmd, { at, off })); continue; }
      const hasImages = Array.isArray(content) && content.some(b => b && b.type === 'image');
      if (isRealPrompt(e) || hasImages) {
        cur = null;
        items.push({ kind: 'user', uuid: e.uuid, at, off, text: clip(messageText(e.message), LIMITS.text), imgRaw: hasImages ? content : null });
      }
      continue;
    }

    if (e.type === 'assistant' && e.message) {
      if (e.isApiErrorMessage) { items.push(notice('warning', messageText(e.message) || 'Claude’s request failed.', { at, off })); cur = null; continue; }
      const m = e.message;
      const mid = m.id || e.uuid;
      if (!cur || cur.mid !== mid) { cur = { kind: 'assistant', mid, uuid: e.uuid, at, off, model: m.model || null, blocks: [] }; items.push(cur); }
      for (const b of assistantBlocks(m.content)) { cur.blocks.push(b); if (b.type === 'tool') tools.set(b.id, b); }
      continue;
    }

    if (e.type === 'system') {
      if (e.subtype === 'compact_boundary') { cur = null; items.push(notice('info', 'The conversation was summarized here to free up space.', { at, off })); continue; }
      if (typeof e.content === 'string' && e.content.trim() && e.level !== 'debug') items.push(notice(e.level || 'info', e.content, { at, off }));
    }
  }
  return { items, from: start };
}

// Turns the kept picture blocks of one item into what the page shows, and drops paging details.
function materialize(it) {
  if (it.kind === 'user') { it.images = it.imgRaw ? contentImages(it.imgRaw) : []; delete it.imgRaw; }
  if (it.kind === 'assistant') for (const b of it.blocks) if (b.result && b.result.imgRaw !== undefined) { b.result.images = b.result.imgRaw ? contentImages(b.result.imgRaw) : []; delete b.result.imgRaw; }
  delete it.off;
  return it;
}

// ---------- live stream ----------

function rateText(i) {
  const which = { five_hour: '5-hour', seven_day: 'weekly', seven_day_opus: 'weekly Opus', seven_day_sonnet: 'weekly Sonnet', overage: 'extra usage' }[i.rateLimitType] || 'usage';
  const when = i.resetsAt ? ` It resets ${new Date(i.resetsAt * (i.resetsAt < 1e12 ? 1000 : 1)).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.` : '';
  if (i.status === 'rejected') return `You’ve reached your ${which} limit on this account.${when}`;
  const pct = typeof i.utilization === 'number' ? ` (${Math.round(i.utilization * (i.utilization <= 1 ? 100 : 1))}% used)` : '';
  return `You’re close to your ${which} limit on this account${pct}.${when}`;
}

function translate(msg, st) {
  switch (msg.type) {
    case 'system': {
      switch (msg.subtype) {
        case 'init': {
          const out = [{ kind: 'init', sessionId: msg.session_id, model: msg.model, permissionMode: msg.permissionMode, version: msg.claude_code_version, cwd: msg.cwd }];
          const failed = (msg.mcp_servers || []).filter(s => s.status === 'failed').map(s => s.name);
          if (failed.length) out.push(notice('warning', `These MCP servers didn’t connect: ${failed.join(', ')}.`));
          return out;
        }
        case 'notification': return [notice(msg.priority === 'high' || msg.priority === 'immediate' ? 'warning' : 'notice', msg.text)];
        case 'informational': return [notice(msg.level || 'info', msg.content)];
        case 'api_retry': return [notice('notice', `Claude’s request didn’t go through (${String(msg.error || 'error').replace(/_/g, ' ')}). Trying again in ${Math.ceil((msg.retry_delay_ms || 0) / 1000)}s, attempt ${msg.attempt} of ${msg.max_retries}.`)];
        case 'compact_boundary': return [notice('info', 'The conversation was summarized here to free up space.')];
        case 'status': {
          const out = [{ kind: 'status', status: msg.status || null, permissionMode: msg.permissionMode || null }];
          if (msg.compact_result === 'failed') out.push(notice('warning', `Summarizing the conversation failed${msg.compact_error ? `: ${msg.compact_error}` : '.'}`));
          return out;
        }
        case 'permission_denied': return [notice('warning', `${msg.tool_name} was blocked: ${msg.message || msg.decision_reason || 'not allowed.'}`)];
        case 'task_notification': return [notice('info', `Background task ${msg.status}: ${msg.summary || ''}`)];
        case 'local_command_output': return msg.content && msg.content.trim() ? [notice('info', msg.content)] : [];
        case 'mirror_error': return [notice('warning', msg.error)];
        default: return [];
      }
    }
    case 'assistant': {
      if (msg.parent_tool_use_id) return [];
      const m = msg.message || {};
      if (msg.error && !Array.isArray(m.content)) return [notice('warning', `Claude’s reply failed: ${msg.error}`)];
      const blocks = assistantBlocks(m.content);
      if (!blocks.length && !msg.aborted) return [];
      return [{ kind: 'assistant', mid: m.id || msg.uuid, uuid: msg.uuid, model: m.model || null, blocks, at: new Date().toISOString(), aborted: !!msg.aborted }];
    }
    case 'user': {
      if (msg.parent_tool_use_id) return [];
      const content = msg.message && msg.message.content;
      const results = Array.isArray(content) ? content.filter(b => b && b.type === 'tool_result') : [];
      return results.map(r => ({ kind: 'tool_result', toolUseId: r.tool_use_id, result: resultView(r) }));
    }
    case 'stream_event': {
      if (msg.parent_tool_use_id) return [];
      const ev = msg.event || {};
      if (ev.type === 'message_start') { st.mid = ev.message && ev.message.id; return [{ kind: 'stream_start', mid: st.mid }]; }
      if (ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'tool_use') return [{ kind: 'tool_start', mid: st.mid, name: ev.content_block.name }];
      if (ev.type === 'content_block_delta' && ev.delta) {
        if (ev.delta.type === 'text_delta') return [{ kind: 'delta', mid: st.mid, index: ev.index, text: ev.delta.text }];
        if (ev.delta.type === 'thinking_delta') return [{ kind: 'delta', mid: st.mid, index: ev.index, thinking: true, text: ev.delta.thinking }];
      }
      return [];
    }
    case 'tool_progress': return msg.parent_tool_use_id ? [] : [{ kind: 'tool_progress', toolUseId: msg.tool_use_id, name: msg.tool_name, seconds: Math.round(msg.elapsed_time_seconds || 0) }];
    case 'rate_limit_event': { const i = msg.rate_limit_info || {}; return i.status && i.status !== 'allowed' ? [notice(i.status === 'rejected' ? 'warning' : 'notice', rateText(i))] : []; }
    case 'result': return [{ kind: 'result', ok: msg.subtype === 'success' && !msg.is_error, subtype: msg.subtype, durationMs: msg.duration_ms || 0, errors: (msg.errors || []).map(stripAnsi), text: msg.is_error ? stripAnsi(msg.result || '') : '' }];
    default: return [];
  }
}

function questionsView(input) {
  const qs = Array.isArray(input && input.questions) ? input.questions : [];
  return qs.slice(0, 6).map(q => ({
    question: String(q.question || ''), header: String(q.header || ''), multiSelect: !!q.multiSelect,
    options: (Array.isArray(q.options) ? q.options : []).slice(0, 8).map(o => ({ label: String(o.label || ''), description: String(o.description || '') })),
  }));
}

// How full a chat's context window is, from Claude Code's own count (what /context shows).
function contextView(r) {
  const cats = Array.isArray(r.categories) ? r.categories : [];
  const buffer = cats.filter(c => c && c.kind === 'buffer').reduce((n, c) => n + (Number(c.tokens) || 0), 0);
  return {
    used: r.totalTokens, max: r.maxTokens, percent: Math.min(100, Math.round((r.totalTokens / r.maxTokens) * 100)),
    // Claude Code summarizes the conversation by itself once it gets this full.
    autoAt: buffer ? r.maxTokens - buffer : null,
    parts: cats.filter(c => c && c.kind === 'used' && c.tokens > 0).map(c => ({ name: String(c.name), tokens: c.tokens })),
  };
}

// ---------- one running chat ----------

class LiveChat {
  constructor({ cfg, account, cwd, sessionId = null, fork = false, permissionMode = null, model = null, effort = null, title = null, folder = null, log = () => {}, onChange = () => {}, onSession = () => {}, onActivity = () => {}, onRateLimit = () => {} }) {
    this.key = crypto.randomBytes(9).toString('hex');
    Object.assign(this, { cfg, account, cwd, sessionId, fork, permissionMode, title, folder, log, onChange, onSession, onActivity, onRateLimit });
    this.model = model && MODEL_RE.test(model) ? model : null;   // what was asked for (an alias like "sonnet", or a full name)
    this.resolvedModel = null;                                   // what Claude Code says it's running
    this.effort = EFFORTS.includes(effort) ? effort : null;
    this.models = [];
    this.companionKey = null; this.parentKey = null;
    // What the chat is doing right now, for the "running now" board.
    this.activity = { phase: 'starting', tool: null, detail: null, lastText: '', lastPrompt: '', turnStartedAt: null, lastEventAt: Date.now(), finishedAt: null, ok: true, steps: 0 };
    this.spark = new Map(); // 5-second bucket -> event count
    this.clients = new Set();
    this.buffer = [];
    this.seq = 0;
    this.pending = new Map();   // permission request id -> { input, suggestions, toolUseId, event }
    this.waiting = new Map();   // our control request id -> { resolve, reject, timer }
    this.state = 'starting';
    this.startedAt = new Date().toISOString();
    this.lastActivity = Date.now();
    this.stderr = '';
    this.st = {};
    this.reqSeq = 0;
    this.exited = new Promise(r => { this.markExited = r; });
    this.context = null;      // how full the context window is (see contextView)
    this.contextOK = true;    // false once Claude Code says it can't tell us
  }

  info() {
    return { key: this.key, provider: this.provider || 'claude', sessionId: this.sessionId, accountId: this.account.id, accountName: this.account.name, state: this.state, startedAt: this.startedAt, bufferFrom: this.trimmed && this.buffer[0] ? this.buffer[0].at : this.startedAt, cwd: this.cwd, fork: this.fork, permissionMode: this.permissionMode, modes: this.modes || null, title: this.title, folder: this.folder, ...this.modelInfo(), companionKey: this.companionKey, parentKey: this.parentKey, context: this.context };
  }
  modelInfo() { return { model: this.model, resolvedModel: this.resolvedModel, replyModel: this.replyModel || null, effort: this.effort, models: this.models, efforts: this.effortsFor ? this.effortsFor() : EFFORTS }; }
  emitModel() { this.emit({ kind: 'model', ...this.modelInfo() }); this.onChange(this); }

  // A compact picture of what this chat is doing, for the board and the switching rail.
  summary() {
    const now = Date.now(), bucket = Math.floor(now / 5000);
    const spark = [];
    for (let b = bucket - 35; b <= bucket; b++) spark.push(this.spark.get(b) || 0);
    const a = this.activity;
    return {
      source: 'app', provider: this.provider || 'claude', key: this.key, parentKey: this.parentKey, companionKey: this.companionKey, model: this.resolvedModel || this.model, sessionId: this.sessionId, title: this.title, folder: this.folder, cwd: this.cwd,
      accountId: this.account.id, accountName: this.account.name, state: this.state, permissionMode: this.permissionMode,
      phase: this.state === 'ended' ? 'ended' : this.pending.size ? 'waiting' : a.phase,
      tool: a.tool, detail: a.detail, lastText: a.lastText.slice(-240), lastPrompt: a.lastPrompt,
      turnStartedAt: a.turnStartedAt, lastEventAt: a.lastEventAt, finishedAt: a.finishedAt, ok: a.ok, steps: a.steps,
      pending: [...this.pending.entries()].map(([id, p]) => ({ requestId: id, toolName: p.event.toolName, summary: p.event.view && p.event.view.summary, detail: p.event.view && p.event.view.detailKind === 'command' ? p.event.view.detail : null, question: !!p.event.questions, canAlways: p.event.canAlways })),
      spark,
    };
  }

  track(ev) {
    const a = this.activity, now = Date.now();
    a.lastEventAt = now;
    const b = Math.floor(now / 5000);
    this.spark.set(b, (this.spark.get(b) || 0) + (ev.kind === 'delta' ? 0.2 : 1));
    for (const k of this.spark.keys()) if (k < b - 40) this.spark.delete(k);
    switch (ev.kind) {
      case 'user': Object.assign(a, { phase: 'thinking', tool: null, detail: null, turnStartedAt: now, finishedAt: null, lastPrompt: one(ev.text, 160), lastText: '', steps: 0 }); break;
      case 'delta': if (ev.thinking) a.phase = 'thinking'; else { a.phase = 'writing'; a.lastText = (a.lastText + ev.text).slice(-600); } break;
      case 'assistant':
        for (const blk of ev.blocks) {
          if (blk.type === 'text') { a.lastText = blk.text.slice(-600); a.phase = 'writing'; }
          if (blk.type === 'tool') { a.phase = 'tool'; a.tool = blk.name; a.detail = blk.summary; a.steps++; }
        }
        break;
      case 'tool_start': a.phase = 'tool'; a.tool = ev.name; break;
      case 'tool_result': a.phase = 'thinking'; break;
      case 'result': Object.assign(a, { phase: 'idle', tool: null, detail: null, finishedAt: now, ok: ev.ok }); break;
      case 'state': if (ev.state === 'ready' && a.phase === 'starting') a.phase = 'idle'; if (ev.state === 'ended') a.phase = 'ended'; break;
      case 'stream_start': if (a.phase === 'idle') a.phase = 'thinking'; break;
      default: break;
    }
    if (ev.kind !== 'delta' || now - (this.lastActivityPing || 0) > 700) { this.lastActivityPing = now; this.onActivity(this); }
  }

  emit(ev) {
    this.track(ev);
    ev.seq = ++this.seq;
    if (!ev.at) ev.at = new Date().toISOString();
    // Streamed pieces of a reply are only needed until the finished reply arrives; dropping them
    // keeps the replay buffer to whole messages, so it reaches much further back.
    if (ev.kind === 'assistant' && ev.mid) this.buffer = this.buffer.filter(x => !(x.kind === 'delta' && x.mid === ev.mid));
    // Likewise a review's progress, once it's finished.
    if (ev.kind === 'review' && ev.state !== 'running') this.buffer = this.buffer.filter(x => !(x.kind === 'review' && x.id === ev.id));
    this.buffer.push(ev);
    if (this.buffer.length > LIMITS.buffer) { this.buffer.splice(0, this.buffer.length - LIMITS.buffer); this.trimmed = true; }
    const data = `id: ${ev.seq}\nevent: chat\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const res of this.clients) { try { res.write(data); } catch { this.clients.delete(res); } }
    this.lastActivity = Date.now();
  }

  setState(s) {
    if (this.state === s || this.state === 'ended') return;
    this.state = s;
    this.emit({ kind: 'state', state: s });
    this.onChange(this);
  }

  start() {
    const args = ['--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-prompt-tool', 'stdio'];
    if (this.sessionId) args.push('--resume', this.sessionId);
    if (this.sessionId && this.fork) args.push('--fork-session');
    if (MODES.includes(this.permissionMode)) args.push('--permission-mode', this.permissionMode);
    if (this.model) args.push('--model', this.model);
    if (this.effort) args.push('--effort', this.effort);
    try {
      this.proc = sys.spawnClaude(this.cfg, this.account, this.cwd, args);
    } catch (err) {
      this.emit(notice('warning', `Couldn’t start Claude Code: ${err.message}`));
      return this.end(null);
    }
    this.proc.on('error', err => { this.emit(notice('warning', `Couldn’t start Claude Code: ${err.message}. Check the Claude Code command in Setup.`)); this.end(null); });
    this.proc.on('exit', code => this.end(code));
    this.proc.stdin.on('error', () => { /* the process went away; exit handler reports it */ });
    this.proc.stderr.on('data', d => { this.stderr = (this.stderr + d).slice(-LIMITS.stderr); });
    const rl = readline.createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
    rl.on('line', line => {
      const s = line.trim();
      if (!s || s[0] !== '{') return;
      let msg; try { msg = JSON.parse(s); } catch { return; }
      try { this.handle(msg); } catch (err) { this.log(`Chat ${this.key}: couldn’t handle a message (${err.message})`); }
    });
    // Handshake. Older versions may not answer; the chat becomes usable either way.
    const ready = () => { if (this.state === 'starting') this.setState('ready'); };
    this.request({ subtype: 'initialize' }, 20000).then(r => {
      ready();
      this.models = modelsView(r && r.models);
      // Which model and effort are in effect (settings, flags and all), for the model picker.
      return this.request({ subtype: 'get_settings' }, 15000).then(s => {
        const ap = (s && s.applied) || {}, eff = (s && s.effective) || {};
        if (!this.model && typeof eff.model === 'string' && MODEL_RE.test(eff.model)) this.model = eff.model;
        if (ap.model) this.resolvedModel = ap.model;
        if (!this.effort && EFFORTS.includes(ap.effort)) this.effort = ap.effort;
      }).catch(() => {}).finally(() => { this.emitModel(); this.refreshContext(); });
    }, ready);
    setTimeout(ready, 4000);
  }

  end(code) {
    if (this.state === 'ended') return;
    for (const [, w] of this.waiting) { clearTimeout(w.timer); w.reject(new Error('Claude Code stopped.')); }
    this.waiting.clear();
    for (const [id] of this.pending) this.emit({ kind: 'permission_cancel', requestId: id });
    this.pending.clear();
    const tail = stripAnsi(this.stderr).trim().split(/\r?\n/).slice(-8).join('\n');
    this.emit({ kind: 'ended', code, stopped: !!this.stopping, detail: code && !this.stopping ? tail : '' });
    this.state = 'ended';
    this.endedAt = Date.now();
    this.markExited();
    this.onChange(this);
  }

  write(obj) {
    if (this.state === 'ended' || !this.proc || !this.proc.stdin.writable) throw Object.assign(new Error('This chat has stopped. Start it again to keep going.'), { status: 409 });
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  request(inner, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const id = `sw-${++this.reqSeq}`;
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error('Claude Code didn’t answer in time.')); }, timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
      try { this.write({ type: 'control_request', request_id: id, request: inner }); }
      catch (err) { clearTimeout(timer); this.waiting.delete(id); reject(err); }
    });
  }

  handle(msg) {
    if (msg.type === 'control_response') {
      const r = msg.response || {};
      const w = this.waiting.get(r.request_id);
      if (!w) return;
      clearTimeout(w.timer); this.waiting.delete(r.request_id);
      return r.subtype === 'error' ? w.reject(new Error(r.error || 'Claude Code refused that.')) : w.resolve(r.response || {});
    }
    if (msg.type === 'control_request') return this.handleControl(msg);
    if (msg.type === 'control_cancel_request') {
      if (this.pending.delete(msg.request_id)) this.emit({ kind: 'permission_cancel', requestId: msg.request_id });
      if (!this.pending.size && this.state === 'waiting') this.setState('busy');
      return;
    }
    if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
      const changed = msg.session_id !== this.sessionId;
      this.sessionId = msg.session_id;
      if (msg.model) this.resolvedModel = msg.model;
      if (msg.permissionMode) this.permissionMode = msg.permissionMode;
      if (changed) this.onSession(this);
    }
    if (msg.type === 'system' && msg.subtype === 'status' && msg.permissionMode) this.permissionMode = msg.permissionMode;
    if (msg.type === 'rate_limit_event' && msg.rate_limit_info) this.onRateLimit(this, msg.rate_limit_info);
    // The model that actually answered (Claude Code may use a stronger one, e.g. in plan mode).
    if (msg.type === 'assistant' && !msg.parent_tool_use_id && msg.message && msg.message.model && msg.message.model !== this.replyModel && msg.message.model !== '<synthetic>') { this.replyModel = msg.message.model; this.emitModel(); }
    for (const ev of translate(msg, this.st)) this.emit(ev);
    if (msg.type === 'result') { this.setState(this.pending.size ? 'waiting' : 'ready'); this.refreshContext(); }
    else if ((msg.type === 'assistant' || msg.type === 'stream_event') && this.state === 'ready') this.setState('busy');
  }

  handleControl(msg) {
    const r = msg.request || {};
    if (r.subtype === 'can_use_tool') {
      const event = {
        kind: 'permission', requestId: msg.request_id, toolName: r.tool_name, toolUseId: r.tool_use_id || null,
        title: r.title ? stripAnsi(r.title) : null, description: r.description ? stripAnsi(r.description) : null,
        reason: r.decision_reason ? stripAnsi(r.decision_reason) : null, blockedPath: r.blocked_path || null,
        view: toolView(r.tool_name, r.input), canAlways: !r.suppress_always_allow_rule && Array.isArray(r.permission_suggestions) && r.permission_suggestions.length > 0,
        defaultToNo: !!r.default_to_no, questions: r.tool_name === 'AskUserQuestion' ? questionsView(r.input) : null,
      };
      this.pending.set(msg.request_id, { input: r.input || {}, suggestions: r.permission_suggestions || [], toolUseId: r.tool_use_id, event });
      this.emit(event);
      this.setState('waiting');
      return;
    }
    // Anything else needs a host feature this app doesn't have; say so instead of leaving Claude Code waiting.
    try { this.write({ type: 'control_response', response: { subtype: 'error', request_id: msg.request_id, error: `Session Switcher can’t handle “${r.subtype}” requests.` } }); } catch { /* ended */ }
  }

  send(text, images = []) {
    const content = images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } }));
    if (text) content.push({ type: 'text', text });
    this.write({ type: 'user', session_id: this.sessionId || '', message: { role: 'user', content }, parent_tool_use_id: null });
    this.emit({ kind: 'user', text: clip(text, LIMITS.text), images: images.map(i => ({ src: `data:${i.mediaType};base64,${i.data}` })), at: new Date().toISOString(), local: true });
    if (this.state !== 'waiting') this.setState('busy');
  }

  answer(requestId, { decision, message, answers }) {
    const p = this.pending.get(requestId);
    if (!p) throw Object.assign(new Error('That request isn’t waiting any more.'), { status: 404 });
    let response;
    if (decision === 'deny') response = { behavior: 'deny', message: message || 'The user declined this.', toolUseID: p.toolUseId };
    else {
      response = { behavior: 'allow', updatedInput: answers ? { ...p.input, answers } : p.input, toolUseID: p.toolUseId };
      if (decision === 'always' && p.suggestions.length) response.updatedPermissions = p.suggestions;
    }
    this.write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
    this.pending.delete(requestId);
    this.emit({ kind: 'permission_done', requestId, decision });
    this.setState(this.pending.size ? 'waiting' : 'busy');
  }

  // Asks Claude Code how full the context is (after each reply; it doesn't call the model).
  refreshContext() {
    if (!this.contextOK || this.state === 'ended' || this.contextBusy) return;
    this.contextBusy = true;
    this.request({ subtype: 'get_context_usage' }, 15000).then(r => {
      if (r && typeof r.totalTokens === 'number' && r.maxTokens > 0) this.setContext(contextView(r));
    }).catch(err => { if (!/in time|stopped/.test(err.message)) this.contextOK = false; })
      .finally(() => { this.contextBusy = false; });
  }
  setContext(c) {
    const was = this.context;
    this.context = c;
    if (!was || was.used !== c.used || was.max !== c.max) this.emit({ kind: 'context', ...c });
  }

  // Summarizes the conversation now (what /compact does), so it doesn't happen in the middle of a task.
  compact() {
    if (this.state !== 'ready') throw Object.assign(new Error('Wait for the reply to finish, then summarize.'), { status: 409 });
    this.write({ type: 'user', session_id: this.sessionId || '', message: { role: 'user', content: [{ type: 'text', text: '/compact' }] }, parent_tool_use_id: null });
    this.emit({ kind: 'status', status: 'compacting', text: 'Summarizing the conversation…' });
    this.setState('busy');
  }

  async interrupt() {
    const r = await this.request({ subtype: 'interrupt' }, 15000);
    this.emit(notice('info', 'You stopped Claude.'));
    return r;
  }

  async setMode(mode) {
    if (!MODES.includes(mode)) throw Object.assign(new Error('Unknown mode.'), { status: 400 });
    await this.request({ subtype: 'set_permission_mode', mode }, 15000);
    this.permissionMode = mode;
    this.emit({ kind: 'status', permissionMode: mode });
  }

  // Switches the model for the next replies. Takes an alias ("sonnet") or a full model name.
  async setModel(model) {
    if (!MODEL_RE.test(String(model || ''))) throw Object.assign(new Error('Unknown model.'), { status: 400 });
    await this.request({ subtype: 'set_model', model }, 15000);
    this.model = model;
    const m = this.models.find(x => x.value === model);
    this.resolvedModel = (m && m.resolved) || model;
    // Keep the effort if the new model supports it; otherwise let Claude Code pick.
    if (m && m.efforts.length && this.effort && !m.efforts.includes(this.effort)) this.effort = null;
    this.emitModel();
  }

  async setEffort(effort) {
    if (!EFFORTS.includes(effort)) throw Object.assign(new Error('Unknown effort level.'), { status: 400 });
    await this.request({ subtype: 'apply_flag_settings', settings: { effortLevel: effort } }, 15000);
    this.effort = effort;
    this.emitModel();
  }

  // Ends the chat: closes its input so Claude Code finishes cleanly, then makes sure it's gone.
  stop() {
    if (this.state === 'ended') return this.exited;
    this.stopping = true;
    try { this.proc.stdin.end(); } catch { /* already closed */ }
    setTimeout(() => { if (this.state !== 'ended') sys.killTree(this.proc); }, 4000);
    setTimeout(() => { if (this.state !== 'ended') this.end(null); }, 8000);
    return this.exited;
  }
}

// ---------- all running chats ----------

function createChatManager({ log = () => {}, onChange = () => {}, onSession = () => {}, onActivity = () => {}, onRateLimit = () => {} } = {}) {
  const chats = new Map();

  function open(opts) {
    const Kind = opts.Chat || LiveChat;
    const chat = new Kind({ ...opts, log, onChange, onSession, onActivity, onRateLimit });
    chats.set(chat.key, chat);
    chat.start();
    onChange(chat);
    return chat;
  }
  function get(key) {
    const c = chats.get(String(key || ''));
    if (!c) throw Object.assign(new Error('That chat isn’t running any more. Open it again.'), { status: 404 });
    return c;
  }
  function bySession(id) {
    const want = String(id || '').toLowerCase();
    for (const c of chats.values()) if (c.state !== 'ended' && c.sessionId && c.sessionId.toLowerCase() === want) return c;
    return null;
  }
  function live() {
    const out = {};
    for (const c of chats.values()) if (c.state !== 'ended' && c.sessionId) out[c.sessionId.toLowerCase()] = c.info();
    return out;
  }
  function stopAll() { for (const c of chats.values()) if (c.state !== 'ended') { try { c.stop(); sys.killTree(c.proc); } catch { /* best effort */ } } }
  // Running chats plus ones that finished in the last two minutes, so a finish doesn't vanish instantly.
  function summaries() {
    const now = Date.now(), out = [];
    for (const c of chats.values()) if (c.state !== 'ended' || now - (c.endedAt || 0) < 2 * 60 * 1000) out.push(c.summary());
    return out;
  }
  // A running chat signed in as this account, if any (used to ask for usage without starting another process).
  function forAccount(id) { for (const c of chats.values()) if (c.state !== 'ended' && c.state !== 'starting' && c.account.id === id) return c; return null; }

  // Chats nobody is looking at are stopped after a while; finished ones are forgotten.
  setInterval(() => {
    const now = Date.now();
    for (const [key, c] of chats) {
      if (c.state === 'ended' && !c.clients.size && now - (c.endedAt || 0) > 10 * 60 * 1000) chats.delete(key);
      else if (c.state === 'ready' && !c.clients.size && now - c.lastActivity > 30 * 60 * 1000) { log(`Stopping idle chat ${c.sessionId || c.key}`); c.stop(); }
    }
  }, 60 * 1000).unref();

  return { open, get, bySession, live, stopAll, summaries, forAccount, chats };
}

// What a session file says the chat is doing, for chats running outside the app (terminals, desktop app).
function tailActivity(file, stat) {
  const size = stat.size, len = Math.min(size, 160 * 1024);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, len, size - len); } finally { fs.closeSync(fd); }
  const lines = buf.toString('utf8').split('\n');
  if (size > len) lines.shift();
  let lastTool = null, lastText = '', lastPrompt = '', lastKind = null, steps = 0;
  const results = new Set();
  for (const line of lines) {
    if (!line || line[0] !== '{') continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain) continue;
    if (e.type === 'user' && e.message) {
      const c = e.message.content;
      const res = Array.isArray(c) ? c.filter(b => b && b.type === 'tool_result') : [];
      if (res.length) { res.forEach(r => results.add(r.tool_use_id)); lastKind = 'result'; continue; }
      if (isRealPrompt(e)) { lastPrompt = messageText(e.message); lastKind = 'prompt'; steps = 0; lastText = ''; }
    } else if (e.type === 'assistant' && e.message && e.message.content) {
      const blocks = typeof e.message.content === 'string' ? [{ type: 'text', text: e.message.content }] : Array.isArray(e.message.content) ? e.message.content : [];
      for (const b of blocks) {
        if (!b) continue;
        if (b.type === 'text' && b.text && b.text.trim()) { lastText = b.text; lastKind = 'text'; }
        if (b.type === 'tool_use') { lastTool = { id: b.id, name: b.name, ...toolView(b.name, b.input) }; lastKind = 'tool'; steps++; }
      }
    }
  }
  const pendingTool = lastKind === 'tool' && lastTool && !results.has(lastTool.id);
  return {
    phase: pendingTool ? 'tool' : lastKind === 'text' ? 'idle' : lastKind ? 'thinking' : 'idle',
    tool: pendingTool ? lastTool.name : null, detail: pendingTool ? lastTool.summary : null,
    lastText: one(stripAnsi(lastText), 240), lastPrompt: one(lastPrompt, 160), steps,
  };
}

module.exports = { contextView, readHistory, createChatManager, translate, toolView, tailActivity, LiveChat, notice, clip, one, stripAnsi, LIMITS, IMAGE_TYPES, MODES, EFFORTS };
