'use strict';
// Gemini chats, through Google's Antigravity CLI (`agy`), on your Google AI plan's sign-in.
//
// Each chat runs `agy` in its streaming mode: messages go in one per line, and it reports what it
// does as it goes (text as it's written, each tool step, one result per reply). The conversation is
// Antigravity's own (~/.gemini/antigravity-cli), so a chat opened again continues it by its id.
//
// What `agy` can't do from here: stop and ask before a command (it has no way to ask another app),
// so a chat runs in a set mode: plan only, edit files, or full access. A command it was refused
// becomes a "wants to run" card after the reply (the same Allow / Always / Deny as Claude's): Allow
// lets it run that in its next reply, Always gives the chat full access. Pictures go as files it
// opens with its own viewer. To stop a reply, the process is ended; the next message carries on.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { LiveChat, notice, clip, one, stripAnsi, LIMITS } = require('./chat');
const sys = require('./system');

const ACCOUNT = { id: 'gemini', name: 'Gemini', provider: 'gemini' };
const MODES = [
  { value: 'plan', label: 'Plan only', args: ['--mode', 'plan'] },
  { value: 'accept-edits', label: 'Edit files', args: ['--mode', 'accept-edits'] },
  { value: 'full', label: 'Full access', args: ['--dangerously-skip-permissions'] },
];
const modeOf = v => MODES.find(m => m.value === v) || MODES[1];
// A partner follows the chat it works in (lib/codex.js has the same for Codex).
const FROM_CLAUDE = { plan: 'plan', acceptEdits: 'accept-edits', auto: 'full', dontAsk: 'full', bypassPermissions: 'full' };
const MODEL_RE = /^[\w.-]{2,80}$/;
const HOME = () => path.join(os.homedir(), '.gemini', 'antigravity-cli');
// Pictures you attach: files in a folder of their own that Gemini may read (kept a day).
const picDir = () => { const d = path.join(os.tmpdir(), 'claude-switcher', 'gemini-pictures'); fs.mkdirSync(d, { recursive: true }); return d; };
function savePic(img) {
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[img && img.mediaType];
  if (!ext || !img.data) return null;
  const dir = picDir();
  try { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (Date.now() - fs.statSync(p).mtimeMs > 864e5) fs.unlinkSync(p); } } catch { /* tidy later */ }
  const f = path.join(dir, `pic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.${ext}`);
  try { fs.writeFileSync(f, Buffer.from(img.data, 'base64')); return f; } catch { return null; }
}

// Where `agy` is: the command in Setup, else on the PATH, else where Google's installer puts it.
function agyPath(command) {
  const c = String(command || 'agy').trim() || 'agy';
  if (/[\\/]/.test(c)) return c;
  const places = sys.IS_WIN
    ? [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe')]
    : [path.join(os.homedir(), '.local', 'bin', 'agy')];
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    for (const ext of sys.IS_WIN ? ['.exe', '.cmd', ''] : ['']) { const f = path.join(dir, c + ext); try { if (fs.statSync(f).isFile()) return f; } catch { /* not here */ } }
  }
  return places.find(p => p && fs.existsSync(p)) || c;
}

// A tool step as the chat window shows it. Antigravity's tool arguments are JSON in strings.
const arg = v => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return v; } };
function argsOf(params) { const out = {}; for (const [k, v] of Object.entries(params || {})) out[k] = arg(v); return out; }
function toolBlock(id, name, params) {
  const a = argsOf(params);
  const file = a.TargetFile || a.AbsolutePath || a.FilePath || a.Path || null;
  switch (name) {
    case 'run_command': { const c = String(a.CommandLine || ''); return { type: 'tool', id, name: 'Bash', summary: one(c, 220), detail: clip(c, LIMITS.toolDetail), detailKind: 'command', meta: null }; }
    case 'write_to_file': return { type: 'tool', id, name: 'Write', summary: one(file || '', 220), detail: clip(String(a.CodeContent || ''), LIMITS.toolDetail), detailKind: 'text', meta: { path: file, paths: file ? [file] : [] } };
    case 'replace_file_content': case 'multi_replace_file_content': case 'edit_file':
      return { type: 'tool', id, name: 'Edit', summary: one(file || '', 220), detail: clip(JSON.stringify(a, null, 2), LIMITS.toolDetail), detailKind: 'json', meta: { path: file, paths: file ? [file] : [] } };
    case 'view_file': case 'read_file': return { type: 'tool', id, name: 'Read', summary: one(file || '', 220), detail: '', detailKind: 'text', meta: null };
    case 'grep_search': case 'find_by_name': case 'list_dir': return { type: 'tool', id, name: name === 'list_dir' ? 'LS' : 'Grep', summary: one(String(a.Query || a.Pattern || a.SearchPath || a.DirectoryPath || ''), 200), detail: clip(JSON.stringify(a, null, 2), LIMITS.toolDetail), detailKind: 'json', meta: null };
    case 'search_web': case 'read_url_content': return { type: 'tool', id, name: name === 'search_web' ? 'WebSearch' : 'WebFetch', summary: one(String(a.query || a.Query || a.Url || ''), 200), detail: '', detailKind: 'text', meta: null };
    default: return { type: 'tool', id, name: name.replace(/_/g, ' '), summary: one(JSON.stringify(a), 200), detail: clip(JSON.stringify(a, null, 2), LIMITS.toolDetail), detailKind: 'json', meta: null };
  }
}
const resultOf = (info, status) => {
  const err = info && info.error;
  const text = err ? `${err.message || 'The step failed.'}` : String((info && info.output) || '');
  return { text: clip(stripAnsi(text).replace(/\r/g, '').replace(/\nDo not attempt to circumvent[\s\S]*$/, ''), LIMITS.toolResult), isError: !!err || status === 'ERROR', images: [] };
};
// Your words, without the wrapping Antigravity adds around them in its own record.
const ownWords = s => { const m = String(s || '').match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/); return (m ? m[1] : String(s || '')).trim(); };

class GeminiChat extends LiveChat {
  constructor(opts) {
    super(opts);
    this.provider = 'gemini';
    this.gemini = opts.gemini;
    this.modes = MODES.map(({ value, label }) => ({ value, label }));
    this.permissionMode = MODES.some(m => m.value === opts.permissionMode) ? opts.permissionMode : 'accept-edits';
    this.companion = !!opts.companion;
    this.queue = [];
    this.turn = null;            // the reply being written: { steps: Map(step -> mid/tool id), text: Map }
  }
  effortsFor() { return []; }   // Antigravity's models carry their effort in their name

  start() {
    const known = this.gemini.models();
    if (known.length) { this.models = known; if (!this.model) this.model = (known.find(m => m.isDefault) || known[0]).value; }
    this.resolvedModel = this.model;
    if (this.sessionId) this.emit({ kind: 'init', sessionId: this.sessionId, model: this.model, permissionMode: this.permissionMode });
    this.emitModel();
    this.setState('ready');
    // The list of models, if it wasn't known yet.
    if (!known.length) this.gemini.refreshModels().then(list => { if (list.length) { this.models = list; if (!this.model) { this.model = (list.find(m => m.isDefault) || list[0]).value; this.resolvedModel = this.model; } this.emitModel(); } }).catch(() => {});
  }

  // One running `agy` per chat, started on the first message (and again after a stop, or a change of
  // model or mode), continuing the conversation by its id.
  proc_() {
    if (this.proc && !this.proc.killed && this.proc.exitCode === null) return this.proc;
    const mode = this.fullOnce ? modeOf('full') : modeOf(this.permissionMode);
    const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', ...mode.args, '--add-dir', picDir()];
    this.procFull = !!this.fullOnce;
    if (this.model) args.push('--model', this.model);
    if (this.sessionId) args.push('--conversation', this.sessionId);
    args.push('-p=');
    const p = this.gemini.spawnAgy(args, this.cwd);
    this.proc = p;
    this.stderr = '';
    p.on('error', err => { this.emit(notice('warning', `Couldn’t start Gemini (Antigravity CLI): ${err.message}. Check it in Setup.`)); this.procGone(p, null); });
    p.on('exit', code => this.procGone(p, code));
    p.stdin.on('error', () => { /* it went away; the exit handler says so */ });
    p.stderr.on('data', d => {
      this.stderr = (this.stderr + d).slice(-LIMITS.stderr);
    });
    readline.createInterface({ input: p.stdout, crlfDelay: Infinity }).on('line', line => {
      const s = line.trim();
      if (!s || s[0] !== '{') return;
      let msg; try { msg = JSON.parse(s); } catch { return; }
      try { this.handle(msg); } catch (err) { this.log(`Gemini chat ${this.key}: couldn’t handle a message (${err.message})`); }
    });
    return p;
  }
  procGone(p, code) {
    if (this.proc !== p) return;
    this.proc = null;
    if (this.state === 'ended') return;
    // It stopped in the middle of a reply (stopped by you, or it failed): the reply ends here; the
    // next message starts it again on the same conversation.
    if (this.turn) {
      const why = this.stopped ? '' : stripAnsi(this.stderr).trim().split(/\r?\n/).filter(l => l && !/^warning:/i.test(l)).slice(-3).join('\n');
      if (!this.stopped) this.emit(notice('warning', `Gemini stopped${code ? ` (code ${code})` : ''}.${why ? `\n${why}` : ''}`));
      this.finishTurn({ ok: false, interrupted: !!this.stopped, errors: [] });
    }
    this.stopped = false;
    if (this.stopping) this.end(code);
  }

  handle(msg) {
    if (msg.event === 'init') {
      const id = msg.conversation_id;
      if (id && id !== this.sessionId) { this.sessionId = id; this.emit({ kind: 'init', sessionId: id, model: this.model, permissionMode: this.permissionMode }); this.onSession(this); }
      if (msg.init && msg.init.model) this.resolvedModel = msg.init.model;
      return;
    }
    if (msg.event === 'step_update') return this.step(msg.step_update || {});
    if (msg.event === 'result') {
      const r = msg.result || {};
      const tokens = r.usage ? (Number(r.usage.input_tokens) || 0) - (Number(r.usage.cache_read_tokens) || 0) + (Number(r.usage.output_tokens) || 0) : 0;
      // Out of quota: the same card as Claude's and Codex's.
      if (r.status === 'ERROR' && /quota|rate limit|resource.?exhausted|usage limit/i.test(String(r.error || ''))) this.emit({ kind: 'limit', which: null, resetsAt: null, text: String(r.error) });
      else if (r.status === 'ERROR' && r.error) this.emit(notice('warning', String(r.error)));
      this.finishTurn({ ok: r.status === 'SUCCESS', errors: [], tokens, interrupted: r.status === 'CANCELED' || r.status === 'INTERRUPTED' });
    }
    return undefined;
  }

  step(s) {
    const t = this.turn || (this.turn = { mids: new Map(), text: new Map() });
    const idx = s.step_index;
    if (s.step_type === 'user_input' || s.step_type === 'checkpoint') return;
    if (s.step_type === 'agent_response') {
      let mid = t.mids.get(idx);
      if (!mid) { mid = `${this.key}:${idx}:${Date.now().toString(36)}`; t.mids.set(idx, mid); this.emit({ kind: 'stream_start', mid }); }
      if (s.thinking_delta || s.thought_delta) this.emit({ kind: 'delta', mid, text: '', thinking: true });
      if (s.text_delta) { t.text.set(idx, (t.text.get(idx) || '') + s.text_delta); if (s.state !== 'DONE' || s.text_delta.trim()) this.emit({ kind: 'delta', mid, text: s.text_delta }); }
      if (s.state === 'DONE') { const text = (t.text.get(idx) || '').replace(/\s+$/, ''); this.emit({ kind: 'assistant', mid, blocks: text ? [{ type: 'text', text: clip(text, LIMITS.text) }] : [] }); }
      return;
    }
    if (s.step_type === 'tool' || s.tool_name || s.tool_info) {
      const info = s.tool_info || {};
      const id = `${this.key}:t${idx}`;
      if (!t.mids.has(idx)) {
        t.mids.set(idx, id);
        const b = toolBlock(id, info.name || s.tool_name || 'tool', info.parameters);
        this.emit({ kind: 'assistant', mid: `${this.key}:${idx}:tool`, blocks: [b] });
        this.emit({ kind: 'tool_start', name: b.name, toolUseId: id });
      }
      if (s.state === 'DONE' || s.state === 'ERROR') this.emit({ kind: 'tool_result', toolUseId: id, result: resultOf(info, s.state) });
      const denied = s.state === 'ERROR' && info.error && String(info.error.message || '').match(/permission check failed for command "([\s\S]*?)": user denied/);
      if (denied) { t.refused = t.refused || []; if (!t.refused.some(r => r.cmd === denied[1])) t.refused.push({ cmd: denied[1], toolUseId: id }); }
    }
    return undefined;
  }

  finishTurn({ ok, errors, tokens = 0, interrupted = false }) {
    const refused = (this.turn && this.turn.refused) || [];
    this.turn = null;
    this.emit({ kind: 'result', ok, errors, text: '', interrupted, ...(tokens > 0 ? { tokens } : {}) });
    this.afterTurn();
    // Full access for one reply (a command you allowed) ends with it.
    if (this.procFull) { this.fullOnce = false; this.restartAfter = true; }
    // A change of model or mode waits for the reply to finish: the next message starts it fresh.
    if (this.restartAfter && this.proc) { this.restartAfter = false; this.quiet({ detach: true }); }
    if (refused.length && !interrupted && !this.stopping && !this.queue.length) return this.askAfter(refused);
    this.setState(this.queue.length ? 'busy' : 'ready');
    this.flush();
  }

  // What it was refused, as the same card Claude's and Codex's approvals use, after the reply.
  askAfter(refused) {
    const cmd = refused.map(r => r.cmd).join('\n');
    const id = `gr-${Date.now().toString(36)}`;
    const event = { kind: 'permission', requestId: id, toolName: 'Bash', toolUseId: refused[refused.length - 1].toolUseId, title: refused.length > 1 ? `${refused.length} commands` : null, description: null,
      reason: `Gemini can’t stop and ask you mid-reply, so in “${modeOf(this.permissionMode).label}” it was refused. Allow lets it run ${refused.length > 1 ? 'these' : 'this'} in its next reply; Always gives this chat Full access.`,
      blockedPath: null, view: { summary: one(cmd.replace(/\n/g, ' · '), 220), detail: clip(cmd, LIMITS.toolDetail), detailKind: 'command' }, canAlways: true, defaultToNo: false, questions: null };
    this.pending.set(id, { event, cmds: refused.map(r => r.cmd) });
    this.emit(event);
    this.setState('waiting');
    this.onChange(this);
  }
  answer(requestId, { decision, message }) {
    const p = this.pending.get(requestId);
    if (!p) throw Object.assign(new Error('That request isn’t waiting any more.'), { status: 404 });
    this.pending.delete(requestId);
    this.emit({ kind: 'permission_done', requestId, decision });
    this.setState('ready');
    if (decision === 'deny') { if (message) this.send(message); return; }
    if (decision === 'always') this.setMode('full'); else this.fullOnce = true;
    this.quiet({ detach: true });   // it starts again with the access just given
    const list = p.cmds.map(c => '`' + c + '`').join(', ');
    this.send(`Allowed: you may run ${list} now. Go ahead with what you were doing.${message ? `\n\n${message}` : ''}`, [], { approval: true });
  }

  send(text, images = [], { relay = false, approval = false } = {}) {
    if (this.state === 'ended') throw Object.assign(new Error('This chat has stopped. Start it again to keep going.'), { status: 409 });
    // A new message answers a waiting card too: it's put away (Deny, in effect).
    for (const [id] of this.pending) { this.pending.delete(id); this.emit({ kind: 'permission_cancel', requestId: id }); }
    this.emit({ kind: 'user', text: clip(text, LIMITS.text), images: images.map(i => ({ src: `data:${i.mediaType};base64,${i.data}` })), at: new Date().toISOString(), local: true, ...(relay ? { relay: true } : {}), ...(approval ? { approval: true } : {}) });
    // Pictures: saved as files Gemini opens with its own viewer (it takes words only).
    const pics = images.map(img => savePic(img)).filter(Boolean);
    if (pics.length) text = `${String(text || '').trim()}\n\n[${pics.length === 1 ? 'A picture is' : `${pics.length} pictures are`} attached. Open ${pics.length === 1 ? 'it' : 'each'} with your file viewing tool before answering: ${pics.join(', ')}]`;
    if (!String(text || '').trim()) { if (this.state !== 'busy') this.setState('ready'); return; }
    this.queue.push(String(text));
    this.setState('busy');
    this.flush();
  }
  flush() {
    if (this.turn || !this.queue.length || this.state === 'ended') return;
    const text = this.queue.splice(0).join('\n\n');
    this.turn = { mids: new Map(), text: new Map() };
    try { this.proc_().stdin.write(`${JSON.stringify({ event: 'user', message: { content: text } })}\n`); } catch (err) {
      this.emit(notice('warning', `Couldn’t send that to Gemini: ${err.message}`));
      this.finishTurn({ ok: false, errors: [] });
    }
  }
  steer(text) { this.send(text); }

  // Stopping a reply ends the process; the conversation is Antigravity's and picks up from there.
  // detach: between replies, let go of it at once (the next message starts a new one, even before
  // the old one has finished closing).
  quiet({ detach = false } = {}) { const p = this.proc; if (!p) return; if (detach) this.proc = null; try { sys.killTree(p); } catch { /* gone */ } }
  async interrupt() {
    if (!this.turn) return {};
    this.stopped = true;
    this.queue = [];
    this.emit(notice('info', 'You stopped Gemini.'));
    this.quiet();
    return {};
  }

  async setMode(mode) {
    if (!MODES.some(m => m.value === mode)) throw Object.assign(new Error('Unknown mode.'), { status: 400 });
    this.permissionMode = mode;
    this.emit({ kind: 'status', permissionMode: mode });
    this.changed();
  }
  async setModel(model) {
    if (!MODEL_RE.test(String(model || ''))) throw Object.assign(new Error('Unknown model.'), { status: 400 });
    if (this.models.length && !this.models.some(m => m.value === model)) throw Object.assign(new Error('Gemini doesn’t offer that model on this plan.'), { status: 400 });
    this.model = model; this.resolvedModel = model;
    this.emitModel();
    this.changed();
  }
  async setEffort() { throw Object.assign(new Error('Pick the effort with the model (Low, Medium or High).'), { status: 400 }); }
  // Mode and model are set when `agy` starts: from the next message (now, if nothing's running).
  changed() { if (this.turn) this.restartAfter = true; else this.quiet({ detach: true }); }
  refreshContext() {}
  compact() { throw Object.assign(new Error('Gemini summarizes by itself when it needs to.'), { status: 400 }); }

  stop() {
    if (this.state === 'ended') return this.exited;
    this.stopping = true;
    if (this.proc) this.quiet(); else this.end(null);
    setTimeout(() => this.end(null), 3000).unref();
    return this.exited;
  }
}

// ---------- the Gemini manager ----------

function createGemini({ chats, getConfig, dataDir, log = () => {} }) {
  const cfg = () => (getConfig() || {}).gemini || {};
  const command = () => cfg().command || 'agy';
  const RECORD = path.join(dataDir, 'gemini-chats.json');
  let record = {};
  try { record = JSON.parse(fs.readFileSync(RECORD, 'utf8')) || {}; } catch { /* none yet */ }
  const saveRecord = () => { try { fs.writeFileSync(RECORD, JSON.stringify(record)); } catch (err) { log(`Couldn’t save gemini-chats.json: ${err.message}`); } };
  let st = { checked: false, installed: null, signedIn: false, version: null, error: null, checkedAt: 0 };
  let modelList = [];

  function run(args, timeoutMs = 60000) {
    return new Promise(resolve => {
      let out = '', err = '';
      let p;
      try { p = spawn(agyPath(command()), args, { windowsHide: true, env: { ...process.env } }); } catch (e) { resolve({ code: -1, out, err: e.message, missing: true }); return; }
      const t = setTimeout(() => { try { sys.killTree(p); } catch { /* gone */ } }, timeoutMs);
      p.stdout.on('data', d => { out += d; });
      p.stderr.on('data', d => { err += d; });
      p.on('error', e => { clearTimeout(t); resolve({ code: -1, out, err: e.message, missing: e.code === 'ENOENT' }); });
      p.on('exit', code => { clearTimeout(t); resolve({ code, out, err }); });
    });
  }
  // "gemini-4-argon-high<TAB>Gemini 4 Argon (High)", one a line. Argon (Medium) first, if it's there.
  function parseModels(text) {
    const list = String(text).split(/\r?\n/).map(l => l.split('\t')).filter(p => p.length >= 2 && MODEL_RE.test(p[0].trim())).map(([v, l]) => ({ value: v.trim(), label: l.trim(), description: '', efforts: [], isDefault: false }));
    const def = list.find(m => /argon-medium/.test(m.value)) || list.find(m => /argon/.test(m.value)) || list[0];
    if (def) def.isDefault = true;
    return list;
  }
  async function refreshModels() {
    const r = await run(['models']);
    const list = parseModels(r.out);
    if (list.length) modelList = list;
    return modelList;
  }
  // Installed, and signed in: listing the models needs both.
  async function refreshAccount() {
    if (!cfg().enabled) { st = { ...st, checked: true }; return publicState(); }
    const v = await run(['--version'], 20000);
    if (v.missing || v.code !== 0) { st = { checked: true, installed: false, signedIn: false, version: null, error: null, checkedAt: Date.now() }; return publicState(); }
    const version = String(v.out).trim().split(/\s+/)[0] || null;
    const r = await run(['models']);
    const list = parseModels(r.out);
    if (list.length) modelList = list;
    const why = stripAnsi(`${r.err}\n${r.out}`).trim();
    st = { checked: true, installed: true, signedIn: list.length > 0, version, error: list.length ? null : (/auth|sign.?in|log.?in|credential/i.test(why) ? 'Not signed in.' : one(why, 200) || 'It didn’t list any models.'), checkedAt: Date.now() };
    return publicState();
  }
  function publicState() {
    return { ...ACCOUNT, kind: 'gemini', enabled: !!cfg().enabled, command: command(), checked: st.checked, installed: st.installed, signedIn: st.signedIn, version: st.version, error: st.error, models: modelList.length, hasArgon: modelList.some(m => /argon/.test(m.value)) };
  }

  // The conversations it knows about: the ones started here (with their folder), and Antigravity's own
  // note of the latest conversation in each folder.
  function noteChat(id, info) { if (!id) return; record[id] = { ...(record[id] || {}), ...info, at: Date.now() }; saveRecord(); }
  function brainDir(id) { return path.join(HOME(), 'brain', id, '.system_generated', 'logs'); }
  function titleOf(id) {
    try { const m = fs.readFileSync(path.join(HOME(), 'annotations', `${id}.pbtxt`), 'utf8').match(/title:"((?:[^"\\]|\\.)*)"/); if (m) return JSON.parse(`"${m[1]}"`); } catch { /* no title yet */ }
    return null;
  }
  function list() {
    const out = new Map();
    let latest = {};
    try { latest = JSON.parse(fs.readFileSync(path.join(HOME(), 'cache', 'last_conversations.json'), 'utf8')) || {}; } catch { /* none */ }
    for (const [cwd, id] of Object.entries(latest)) if (id && !record[id]) out.set(id, { id, cwd });
    for (const [id, r] of Object.entries(record)) out.set(id, { id, cwd: r.cwd, title: r.title });
    const rows = [];
    for (const x of out.values()) {
      const f = path.join(brainDir(x.id), 'transcript.jsonl');
      let stat; try { stat = fs.statSync(f); } catch { continue; }
      let first = '';
      try { const head = fs.readFileSync(f, 'utf8').slice(0, 8000).split('\n'); for (const l of head) { if (!l) continue; const j = JSON.parse(l); if (j.type === 'USER_INPUT') { first = ownWords(j.content); break; } } } catch { /* unreadable */ }
      rows.push({ id: x.id, provider: 'gemini', cwd: x.cwd || null, title: titleOf(x.id) || x.title || one(first, 80) || 'Gemini chat', firstPrompt: one(first, 200), updated: stat.mtimeMs, sizeKB: Math.round(stat.size / 1024) });
    }
    return rows.sort((a, b) => b.updated - a.updated);
  }
  const known = id => !!id && (!!record[id] || fs.existsSync(path.join(brainDir(id), 'transcript.jsonl')));

  // A conversation's earlier messages, from Antigravity's own record of it.
  function history(id, until = null) {
    let lines = [];
    try { lines = fs.readFileSync(path.join(brainDir(id), 'transcript.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { return { items: [], start: 0, cursor: null }; }
    const untilMs = until ? Date.parse(until) : null;
    const items = [];
    let cur = null, pendingTools = [];
    const flush = () => { if (cur && cur.blocks.length) items.push(cur); cur = null; };
    for (const l of lines) {
      let j; try { j = JSON.parse(l); } catch { continue; }
      const at = j.created_at || null;
      if (untilMs && at && Date.parse(at) >= untilMs) break;
      if (j.type === 'USER_INPUT') { flush(); pendingTools = []; items.push({ kind: 'user', text: clip(ownWords(j.content), LIMITS.text), images: [], at }); continue; }
      if (j.type === 'PLANNER_RESPONSE') {
        if (!cur) cur = { kind: 'assistant', mid: `${id}:${j.step_index}`, blocks: [], at };
        if (j.content && String(j.content).trim()) cur.blocks.push({ type: 'text', text: clip(String(j.content).trim(), LIMITS.text) });
        for (const [i, tc] of (j.tool_calls || []).entries()) { const b = toolBlock(`${id}:${j.step_index}:${i}`, tc.name, tc.args); cur.blocks.push(b); pendingTools.push(b); }
        continue;
      }
      if (j.type === 'GENERIC' && pendingTools.length) {
        const b = pendingTools.shift();
        b.result = { text: clip(String(j.error || j.content || '').replace(/^Created At:.*\nCompleted At:.*\n/, ''), LIMITS.toolResult), isError: j.status === 'ERROR', images: [] };
      }
    }
    flush();
    return { items, start: 0, cursor: null };
  }

  // Signing in: Antigravity's own sign-in, in a terminal window (it opens your browser).
  async function login(c) {
    return sys.runInTerminal(c, os.homedir(), 'Sign in to Gemini', sys.IS_WIN
      ? `@echo off\r\ntitle Sign in to Gemini\r\necho Sign in with the Google account that has your Google AI plan, in the browser that opens.\r\necho When it says you're signed in, type /quit (or close this window) and click Check again in Session Switcher.\r\necho.\r\n"${agyPath(command())}"\r\n`
      : `#!/bin/sh\necho "Sign in with the Google account that has your Google AI plan, in the browser that opens."\necho "When it says you're signed in, type /quit and click Check again in Session Switcher."\n"${agyPath(command())}"\n`);
  }

  // Starting `agy` (tests start a stand-in that replays what the real one says).
  const spawnAgy = (args, cwd) => spawn(agyPath(command()), args, { cwd, env: { ...process.env }, windowsHide: true });
  const api = {
    ACCOUNT, MODES, command, spawnAgy, models: () => modelList, refreshModels, refreshAccount, publicState, list, known, history, noteChat, login,
    open({ cfg: c, cwd, sessionId = null, mode, model, title, folder, companion = false }) {
      return chats.open({ Chat: GeminiChat, gemini: api, cfg: c, account: ACCOUNT, cwd, sessionId, permissionMode: mode, model, title, folder, companion });
    },
  };
  return api;
}

module.exports = { createGemini, GeminiChat, MODES, FROM_CLAUDE, ACCOUNT, agyPath, toolBlock, ownWords };
