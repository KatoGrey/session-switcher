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
    description: 'Lists the user’s chats (Claude Code, Codex and Gemini) with what each is doing: working, needs approval, has a question, idle (finished its turn and waiting), waiting in its terminal, or not running. Includes each chat’s group, the chat it was started from (parent), its last line and any pending permission requests. Start here.',
    inputSchema: { type: 'object', properties: {
      filter: { type: 'string', enum: ['all', 'active', 'working', 'waiting', 'idle', 'archived'], description: 'active (default): running or recently used chats. waiting: chats that need the user or a nudge. all: also older chats. archived: chats archived in Switcher Lite (every other filter leaves them out).' },
      group: { type: 'string', description: 'Only chats in this group (by name).' },
    } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'read_session',
    description: 'Reads a chat’s latest messages (the user’s prompts and the assistant’s replies), plus its state and any pending permission requests.',
    inputSchema: { type: 'object', properties: {
      session: { type: 'string', description: 'The chat id from list_sessions.' },
      count: { type: 'number', description: 'How many recent messages (1 to 14, default 6).' },
    }, required: ['session'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'search_chats',
    description: 'Find chats by what was said in them: every chat, Claude\'s, Codex\'s and Gemini\'s, by all the words you give, in their messages, names and folders. For "which chat was it where we talked about X?". Returns each chat\'s id (for read_session), title, folder and a snippet. stillReading means some chats haven\'t been read yet, so try again in a moment if it found nothing.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: 'The words to look for.' },
      limit: { type: 'number', description: 'How many chats at most (default 12, at most 30).' },
    }, required: ['query'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'recent_changes',
    description: 'What the chats in a project have changed lately, newest first: each reply that changed files, with the chat, who it was, when, and the files. For "what happened while I was away". Also says which files two chats were changing at the same time.',
    inputSchema: { type: 'object', properties: {
      cwd: { type: 'string', description: 'The project’s folder: a chat’s cwd from list_sessions.' },
      hours: { type: 'number', description: 'How far back (default 24).' },
    }, required: ['cwd'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'send_message',
    description: 'Nudges a chat: sends it a message, as if the user typed it, marked “From Commander”. Works on chats running in Session Switcher’s window and on idle chats (it opens them first). It can’t type into a chat running in a terminal. The chat shows a note that the Commander sent it.',
    inputSchema: { type: 'object', properties: {
      session: { type: 'string', description: 'The chat id from list_sessions.' },
      text: { type: 'string', description: 'The message. Keep it short and specific.' },
    }, required: ['session', 'text'] },
  },
  {
    name: 'keep_working',
    description: 'Keeps a chat, and everyone working in it, going until a time: once it’s been quiet for a few minutes it gets a short message to carry on. It waits for permission requests and for usage to come back, and stops at the time, when they all say they’re finished, after two check-ins with nothing done, or when the user presses Stop. Each check-in uses some of that account’s usage, so only do this when the user asked for it. minutes: 0 turns it off. Chats that are being kept going show keepWorkingUntil in list_sessions.',
    inputSchema: { type: 'object', properties: {
      session: { type: 'string', description: 'The chat id from list_sessions.' },
      minutes: { type: 'number', description: 'How long from now it keeps going. 0 turns it off.' },
      quiet_minutes: { type: 'number', description: 'How long it must have been quiet before a check-in (1 to 120; 5 if not given).' },
      note: { type: 'string', description: 'What it should carry on with, said each time. Optional.' },
    }, required: ['session', 'minutes'] },
  },
  {
    name: 'answer_permission',
    description: 'Allows or denies a chat’s pending permission request (a command, an edit…). Only works if the user turned on “Let the Commander answer permission requests”; otherwise tell the user what’s waiting instead.',
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
    description: 'Archives chats in Switcher Lite: they leave every list but are never deleted, and the user can bring any of them back from the Archived page. Use it for throwaway chats: finished helper and script runs, old routine runs, tests and probes ("Reply with OK"), and chats the user says are done with. Don\'t archive a chat that is working, waiting on the user, or has unmerged work, unless the user asks. Set restore to bring chats back.',
    inputSchema: { type: 'object', properties: {
      sessions: { type: 'array', items: { type: 'string' }, description: 'Chat ids from list_sessions (list_sessions with filter "archived" shows archived ones, to restore).' },
      restore: { type: 'boolean', description: 'Bring these chats back instead of archiving them.' },
    }, required: ['sessions'] },
  },
];
const ROUTINE_TOOL = {
  name: 'create_routine',
  description: 'Sets up a routine in Session Switcher: a prompt that runs on a schedule, in a new chat each time or continuing one chat. Ask the user before creating one.',
  inputSchema: { type: 'object', properties: {
    name: { type: 'string', description: 'A short name the user will recognize.' },
    prompt: { type: 'string', description: 'What to send each time it runs.' },
    cwd: { type: 'string', description: 'The folder it runs in: a chat’s cwd from list_sessions.' },
    session: { type: 'string', description: 'Optional: a chat id to continue each time, instead of starting a new chat.' },
    account: { type: 'string', description: 'Optional account id (e.g. main, codex). Defaults to the chat’s or the user’s current one.' },
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
    case 'search_chats': return text(await get('/api/commander/tool/search', { q: a.query, limit: a.limit }));
    case 'recent_changes': return text(await get('/api/commander/tool/changes', { cwd: a.cwd, hours: a.hours }));
    case 'send_message': return text(await post('/api/commander/tool/send', { id: a.session, text: a.text }));
    case 'keep_working': return text(await post('/api/commander/tool/keep', { id: a.session, minutes: a.minutes, quiet: a.quiet_minutes, note: a.note }));
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

const INSTRUCTIONS = 'You are the Commander in the user’s Session Switcher: you watch their other Claude Code, Codex and Gemini chats and help keep them moving. Use list_sessions first, read_session before nudging, keep nudges short and specific, and always tell the user what you did. Only answer permission requests when the tool allows it.';

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
