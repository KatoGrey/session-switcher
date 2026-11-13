'use strict';
// Latitude's agent tools (the `latitude` MCP server: one tool, run(category, tool, params)) run with Latitude's
// shared agent credentials. The Latitude clone asks before every one of them (an `ask` rule on mcp__latitude__*),
// which is right for a tool that changes something and slow for the many that only read: a PR review can make
// dozens of Datadog, Athena and Sentry look-ups. This says which calls only read, so a chat can let those through
// and still ask you about the rest.
//
// A call only reads when its tool's name starts with a reading word (list, get, search, query…) and no part of it
// is a changing word (create, update, trigger, send…), and its category isn't one that always asks. Anything that
// isn't plainly a read asks, as before.

// MCP tools this applies to: Latitude's server, by either of the names it's added under.
const LATITUDE_TOOL = /^mcp__latitude(?:-remote)?__run$/;
const READ_FIRST = new Set(['list', 'get', 'search', 'query', 'read', 'find', 'check', 'analyze', 'analyse', 'describe', 'count', 'fetch', 'lookup', 'view', 'show', 'explain', 'inspect', 'summarize', 'summarise', 'compare', 'status', 'stats', 'top', 'recent', 'browse', 'diff', 'validate', 'resolve', 'whoami', 'health', 'ping', 'schema', 'tail', 'trace', 'traces', 'logs', 'metrics']);
const CHANGES = new Set(['create', 'update', 'upsert', 'delete', 'remove', 'trigger', 'rerun', 'push', 'send', 'post', 'nudge', 'triage', 'reminder', 'reminders', 'set', 'add', 'write', 'commit', 'publish', 'approve', 'merge', 'deploy', 'execute', 'exec', 'upload', 'submit', 'cancel', 'restart', 'rotate', 'grant', 'revoke', 'insert', 'edit', 'patch', 'move', 'rename', 'archive', 'close', 'reopen', 'assign', 'dispatch', 'invite', 'ban', 'kick', 'reply', 'notify', 'purge', 'flush', 'reset', 'seed', 'migrate', 'sync', 'start', 'stop', 'kill', 'scale', 'enable', 'disable', 'mute', 'unmute', 'resolve-incident', 'acknowledge', 'ack', 'generate', 'eval', 'banish', 'summon', 'provision', 'import', 'export', 'download', 'save', 'claim', 'lock', 'unlock', 'transfer', 'pay', 'refund', 'charge']);
// Categories that always ask, whatever the tool's called: admin database access, a browser that acts, this PC,
// and the ones that start or schedule work.
const ALWAYS_ASK = new Set(['postgres-admin', 'agent-browser', 'local', 'orchestrator', 'schedule', 'familiar']);

// "get-pr-failed-logs", "searchPRs", "list_open_prs" -> its words, lower case.
const words = name => String(name || '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// Does this tool call only read? { read: true } or { read: false, why }.
function classify(toolName, input) {
  if (!LATITUDE_TOOL.test(String(toolName || ''))) return { read: false, why: 'not a Latitude tool' };
  const category = String(input && input.category || '').toLowerCase().trim();
  const tool = String(input && input.tool || '').trim();
  if (!category || !tool) return { read: false, why: 'no category or tool' };
  if (ALWAYS_ASK.has(category)) return { read: false, why: `${category} always asks` };
  const w = words(tool);
  if (!w.length || !READ_FIRST.has(w[0])) return { read: false, why: `${tool} doesn’t start with a reading word` };
  const changing = w.find(x => CHANGES.has(x));
  if (changing) return { read: false, why: `${tool} has “${changing}” in it` };
  return { read: true };
}

// Is letting reads through turned on for this assistant's chats? (Setup: on unless turned off.)
const PREF = { claude: 'latitudeReadsClaude', codex: 'latitudeReadsCodex' };
const autoAllow = (cfg, who) => !(cfg && cfg.prefs && cfg.prefs[PREF[who]] === false);
// Codex asks before an MCP tool call with an elicitation (codex_approval_kind mcp_tool_call): the same call, in
// Claude Code's naming, so one classification covers both.
function codexCall(p) {
  const m = (p && p._meta) || {};
  if (m.codex_approval_kind !== 'mcp_tool_call') return null;
  return { toolName: `mcp__${String(p.serverName || '')}__${String(m.tool_name || '')}`, input: m.tool_params || {} };
}

module.exports = { classify, words, autoAllow, codexCall, PREF, LATITUDE_TOOL, ALWAYS_ASK };
