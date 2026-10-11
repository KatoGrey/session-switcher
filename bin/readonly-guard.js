#!/usr/bin/env node
// A Claude Code PreToolUse hook that keeps a chat read-only toward the outside world: Latitude's
// `run` tool only for tools that read (Slack history, Discord messages, Linear lookups, PR lists…),
// and the shell only for a few read commands plus switcher-glm (a read-only helper itself).
// Anything else is refused with a reason the model sees. switcher-glm turns it on for every run;
// pass it to any `claude -p` with --settings (see settingsFor below).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const READ = {
  slack: ['get-channel-history', 'get-message-by-permalink', 'get-thread-replies', 'get-user-profile', 'get-users', 'list-channels', 'read-file', 'search-messages'],
  discord: ['get-channel-messages', 'get-channel', 'get-message', 'get-pins', 'get-server', 'list-channels', 'list-roles', 'list-threads', 'search-messages'],
  tala: ['describe-table', 'list-schemas', 'list-tables', 'query'],
  linear: ['get-issue', 'get-project', 'list-issues', 'search-issues', 'community-qa-get-project'],
  github: ['get-file', 'get-pr', 'get-pr-checks', 'get-pr-reviews', 'get-failing-jobs', 'get-job-logs', 'get-pr-failed-logs', 'get-run', 'list-directory', 'list-merged-prs', 'list-open-prs', 'list-recent-deploys', 'list-workflow-runs', 'search-prs', 'team-roster'],
  preview: ['check-health', 'get-info'],
};
const SHELL_OK = [
  /^\s*node\s+\S*bin\/switcher-glm\.js\b/,
  /^\s*gh\s+(pr\s+(list|view|checks|diff)|search\s+(prs|issues)|issue\s+(list|view))\b/,
  /^\s*(git\s+(log|show|diff|status|grep|branch)|rg|grep|ls|cat|head|tail|wc|date)\b/,
];

// Is this call allowed? Pure, for tests: { ok } or { ok: false, why }.
function check(tool, input) {
  const i = input || {};
  if (tool === 'mcp__latitude__run') {
    const cat = String(i.category || ''), name = String(i.tool || '');
    if ((READ[cat] || []).includes(name)) return { ok: true };
    return { ok: false, why: `This run is read-only: ${cat}/${name} isn’t one of the read tools allowed here.` };
  }
  if (tool === 'Bash') {
    const cmd = String(i.command || '');
    // One command at a time, no redirection into files, no chaining into something else.
    if (/[;&|`$><]|\n/.test(cmd.replace(/\|\s*(head|tail|wc|grep|jq)\b[^|;&]*/g, '').replace(/2>&1|2>\/dev\/null/g, '').replace(/"[^"]*"|'[^']*'/g, '""'))) return { ok: false, why: 'This run is read-only: run one plain read command at a time (no ;, &&, redirects or substitutions).' };
    if (SHELL_OK.some(re => re.test(cmd))) return { ok: true };
    return { ok: false, why: 'This run is read-only: that shell command isn’t allowed here (gh pr list/view, git log/show, grep and switcher-glm are).' };
  }
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return { ok: false, why: 'This run is read-only: no file changes.' };
  if (/^mcp__/.test(tool) && !/^mcp__latitude__run$/.test(tool)) return { ok: false, why: 'This run is read-only: only the Latitude read tools are allowed.' };
  return { ok: true };
}

// A --settings JSON for `claude -p` that runs this guard before every tool.
function settingsFor() {
  const file = path.join(os.tmpdir(), 'switcher-readonly-guard.settings.json');
  const json = JSON.stringify({ hooks: { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: `node ${JSON.stringify(__filename)}` }] }] } });
  try { if (fs.readFileSync(file, 'utf8') === json) return file; } catch { /* write it */ }
  fs.writeFileSync(file, json);
  return file;
}

if (require.main === module) {
  let s = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { s += d; });
  process.stdin.on('end', () => {
    let j = {}; try { j = JSON.parse(s); } catch { process.exit(0); }
    const r = check(j.tool_name, j.tool_input);
    if (r.ok) process.exit(0);
    process.stderr.write(r.why);
    process.exit(2); // blocks the call; the model sees the reason
  });
}
module.exports = { check, settingsFor, READ };
