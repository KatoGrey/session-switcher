#!/usr/bin/env node
'use strict';
// The Commander's tools: a small MCP server (stdio) that Claude Code starts for the Commander chat.
// It talks to the running Session Switcher at SWITCHER_URL with its per-launch SWITCHER_TOKEN, so
// it can only do what the app's own /api/commander/tool/* routes allow. No npm packages.
//
// Protocol: newline-delimited JSON-RPC 2.0 on stdin/stdout (MCP's stdio transport). Logs go to
// stderr, never stdout.
//
// Routines seam: if the app has a routines API (GET /api/routines answers), a `create_routine`
// tool appears that POSTs a routine to /api/routines ({ name, cwd, prompt, account?, chat,
// trigger: { type: 'schedule', schedule } }). Until then it's left out, so the Commander never
// offers something the app can't do.

const BASE = String(process.env.SWITCHER_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.SWITCHER_TOKEN || '';
const log = msg => process.stderr.write(`[commander-mcp] ${msg}\n`);

async function call(method, route, body) {
  if (!BASE || !TOKEN) throw new Error('Session Switcher’s address isn’t set. Restart the Commander from Session Switcher.');
  let r;
  try {
    r = await fetch(`${BASE}${route}`, { method, headers: { 'X-Switcher-Token': TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Session Switcher isn’t answering. It may have been closed or restarted; restart the Commander from it.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Session Switcher said ${r.status}.`);
  return j;
}
const get = (route, q = {}) => call('GET', `${route}?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''))}`);
const post = (route, body) => call('POST', route, body);

const TOOLS = [
  {
    name: 'list_sessions',
    description: 'Lists Ryan’s chats (Claude Code and Codex) with what each is doing: working, needs approval, has a question, idle (finished its turn and waiting), waiting in its terminal, or not running. Includes each chat’s group, the chat it was started from (parent), its last line and any pending permission requests. Start here.',
    inputSchema: { type: 'object', properties: {
      filter: { type: 'string', enum: ['all', 'active', 'working', 'waiting', 'idle', 'archived'], description: 'active (default): running or recently used chats. waiting: chats that need Ryan or a nudge. all: also older chats. archived: chats archived in Switcher Lite (every other filter leaves them out).' },
      group: { type: 'string', description: 'Only chats in this group (by name).' },
    } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'read_session',
    description: 'Reads a chat’s latest messages (Ryan’s prompts and the assistant’s replies), plus its state and any pending permission requests.',
    inputSchema: { type: 'object', properties: {
      session: { type: 'string', description: 'The chat id from list_sessions.' },
      count: { type: 'number', description: 'How many recent messages (1 to 14, default 6).' },
    }, required: ['session'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'send_message',
    description: 'Nudges a chat: sends it a message, as if Ryan typed it, marked “From Commander”. Works on chats running in Session Switcher’s window and on idle chats (it opens them first). It can’t type into a chat running in a terminal. The chat shows a note that the Commander sent it.',
    inputSchema: { type: 'object', properties: {
      session: { type: 'string', description: 'The chat id from list_sessions.' },
      text: { type: 'string', description: 'The message. Keep it short and specific.' },
    }, required: ['session', 'text'] },
  },
  {
    name: 'answer_permission',
    description: 'Allows or denies a chat’s pending permission request (a command, an edit…). Only works if Ryan turned on “Let the Commander answer permission requests”; otherwise tell Ryan what’s waiting instead.',
    inputSchema: { type: 'object', properties: {
      session: { type: 'string', description: 'The chat id.' },
      decision: { type: 'string', enum: ['allow', 'deny'] },
      request_id: { type: 'string', description: 'Which request, from list_sessions or read_session. Optional when only one is waiting.' },
      reason: { type: 'string', description: 'For deny: what the chat should do instead.' },
    }, required: ['session', 'decision'] },
  },
  {
    name: 'start_sub_session',
    description: 'Starts a sub-session: a new chat in the same folder as a parent chat, linked to it (it shows under the parent in the sidebar and joins its group), and sends it a task.',
    inputSchema: { type: 'object', properties: {
      parent: { type: 'string', description: 'The parent chat id.' },
      task: { type: 'string', description: 'What the sub-session should do. It’s sent as its first message.' },
      include_context: { type: 'boolean', description: 'Add the parent’s latest reply as context (default true).' },
    }, required: ['parent', 'task'] },
  },
  {
    name: 'archive_chats',
    description: 'Archives chats in Switcher Lite: they leave every list but are never deleted, and Ryan can bring any of them back from the Archived page. Use it for throwaway chats: finished helper and script runs, old routine runs, tests and probes ("Reply with OK"), and chats Ryan says he is done with. Don\'t archive a chat that is working, waiting on Ryan, or has unmerged work, unless Ryan asks. Set restore to bring chats back.',
    inputSchema: { type: 'object', properties: {
      sessions: { type: 'array', items: { type: 'string' }, description: 'Chat ids from list_sessions (list_sessions with filter "archived" shows archived ones, to restore).' },
      restore: { type: 'boolean', description: 'Bring these chats back instead of archiving them.' },
    }, required: ['sessions'] },
  },
];
const ROUTINE_TOOL = {
  name: 'create_routine',
  description: 'Sets up a routine in Session Switcher: a prompt that runs on a schedule, in a new chat each time or continuing one chat. Ask Ryan before creating one.',
  inputSchema: { type: 'object', properties: {
    name: { type: 'string', description: 'A short name Ryan will recognize.' },
    prompt: { type: 'string', description: 'What to send each time it runs.' },
    cwd: { type: 'string', description: 'The folder it runs in: a chat’s cwd from list_sessions.' },
    session: { type: 'string', description: 'Optional: a chat id to continue each time, instead of starting a new chat.' },
    account: { type: 'string', description: 'Optional account id (e.g. main, codex). Defaults to the chat’s or Ryan’s current one.' },
    schedule: { type: 'object', description: 'When it runs.', properties: {
      kind: { type: 'string', enum: ['daily', 'weekdays', 'every', 'cron'] },
      time: { type: 'string', description: 'For daily or weekdays: HH:MM, 24-hour.' },
      every: { type: 'number', description: 'For every: how many units.' },
      unit: { type: 'string', enum: ['minutes', 'hours'] },
      cron: { type: 'string', description: 'For cron: a five-field cron line.' },
    }, required: ['kind'] },
  }, required: ['name', 'prompt', 'cwd', 'schedule'] },
};

let routines = null; // null: not checked yet
async function hasRoutines() {
  if (routines !== null) return routines;
  try { await get('/api/routines'); routines = true; } catch { routines = false; }
  return routines;
}

const text = t => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] });
async function runTool(name, a = {}) {
  switch (name) {
    case 'list_sessions': return text(await get('/api/commander/tool/sessions', { filter: a.filter, group: a.group }));
    case 'read_session': return text(await get('/api/commander/tool/read', { id: a.session, count: a.count }));
    case 'send_message': return text(await post('/api/commander/tool/send', { id: a.session, text: a.text }));
    case 'answer_permission': return text(await post('/api/commander/tool/answer', { id: a.session, decision: a.decision, requestId: a.request_id, reason: a.reason }));
    case 'archive_chats': {
      const ids = (Array.isArray(a.sessions) ? a.sessions : []).map(String).filter(Boolean).slice(0, 500);
      if (!ids.length) throw new Error('Name at least one chat id.');
      await post('/api/lite/archive', { chats: ids, on: !a.restore });
      return text({ ok: true, [a.restore ? 'restored' : 'archived']: ids.length });
    }
    case 'start_sub_session': return text(await post('/api/commander/tool/sub', { parent: a.parent, task: a.task, includeContext: a.include_context !== false }));
    case 'create_routine': {
      // The routines API (POST /api/routines): see its hand-over note for the full shape.
      const spec = { name: a.name, cwd: a.cwd, prompt: a.prompt, permissionMode: 'default', chat: a.session ? { mode: 'continue', sessionId: a.session } : { mode: 'new', sessionId: null }, trigger: { type: 'schedule', schedule: a.schedule || {} } };
      if (a.account) spec.account = a.account;
      return text(await post('/api/routines', spec));
    }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

const INSTRUCTIONS = 'You are the Commander in Ryan’s Session Switcher: you watch his other Claude Code and Codex chats and help keep them moving. Use list_sessions first, read_session before nudging, keep nudges short and specific, and always tell Ryan what you did. Only answer permission requests when the tool allows it.';

function reply(id, result) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`); }
function replyError(id, code, message) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`); }

async function handle(msg) {
  const { id, method, params = {} } = msg;
  const isRequest = id !== undefined && id !== null;
  try {
    switch (method) {
      case 'initialize':
        return reply(id, { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'session-switcher', version: '1.0.0' }, instructions: INSTRUCTIONS });
      case 'ping': return reply(id, {});
      case 'tools/list': return reply(id, { tools: (await hasRoutines()) ? [...TOOLS, ROUTINE_TOOL] : TOOLS });
      case 'tools/call': {
        try { return reply(id, await runTool(params.name, params.arguments || {})); }
        catch (err) { return reply(id, { content: [{ type: 'text', text: err.message }], isError: true }); }
      }
      default:
        if (isRequest) return replyError(id, -32601, `Method not found: ${method}`);
        return undefined; // notifications (initialized, cancelled…)
    }
  } catch (err) {
    log(err.stack || err.message);
    if (isRequest) replyError(id, -32603, err.message);
  }
  return undefined;
}

let buf = '', busy = 0, ended = false;
const track = p => { busy++; p.finally(() => { busy--; if (ended && !busy) process.exit(0); }); };
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { log(`Couldn’t read: ${line.slice(0, 200)}`); continue; }
    for (const m of Array.isArray(msg) ? msg : [msg]) track(handle(m));
  }
});
process.stdin.on('end', () => { ended = true; if (!busy) process.exit(0); });
