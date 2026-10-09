'use strict';
// One set of rules and tools for both assistants. Claude Code reads CLAUDE.md and Codex reads
// AGENTS.md (in the project, and in their own folders for every project); each has its own MCP
// servers (tools). These read them side by side, write the rules to both, and copy a tool across.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MAX_RULES = 256 * 1024;

// The two files for a project (or, with no project, for every project).
function rulesPaths({ cwd, claudeDir, codexHome }) {
  return cwd
    ? { claude: path.join(cwd, 'CLAUDE.md'), codex: path.join(cwd, 'AGENTS.md') }
    : { claude: path.join(claudeDir, 'CLAUDE.md'), codex: path.join(codexHome, 'AGENTS.md') };
}
const readText = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const norm = s => String(s || '').replace(/\r\n/g, '\n').replace(/\s+$/, '');

function readRules(paths) {
  const one = p => { const text = readText(p); return { path: p, exists: text !== null, text: text || '' }; };
  const claude = one(paths.claude), codex = one(paths.codex);
  return { claude, codex, same: claude.exists && codex.exists && norm(claude.text) === norm(codex.text) };
}

// Writes the rules to the chosen files (both, normally), each replaced in one step.
function writeRules(paths, text, to = ['claude', 'codex']) {
  const body = String(text || '');
  if (Buffer.byteLength(body) > MAX_RULES) throw Object.assign(new Error('That’s longer than these files should be (256 KB).'), { status: 400 });
  const written = [];
  for (const k of to) {
    const p = paths[k]; if (!p) continue;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body.endsWith('\n') || !body ? body : `${body}\n`);
    fs.renameSync(tmp, p);
    written.push(p);
  }
  return written;
}

/* ---------- tools (MCP servers) ---------- */

const samePath = (a, b) => path.resolve(a).replace(/[\\/]+$/, '').toLowerCase() === path.resolve(b).replace(/[\\/]+$/, '').toLowerCase();
const NAME = /^[A-Za-z0-9_-]{1,64}$/;

// Claude Code's servers: ~/.claude.json (yours, and this project's private ones) and the project's .mcp.json.
function claudeServers(claudeJson, cwd) {
  const out = [];
  let j = {};
  try { j = JSON.parse(fs.readFileSync(claudeJson, 'utf8')) || {}; } catch { /* none yet */ }
  for (const [name, spec] of Object.entries(j.mcpServers || {})) out.push({ name, scope: 'user', spec });
  if (cwd) {
    const proj = Object.entries(j.projects || {}).find(([k]) => samePath(k, cwd));
    for (const [name, spec] of Object.entries((proj && proj[1] && proj[1].mcpServers) || {})) out.push({ name, scope: 'local', spec });
    let m = {};
    try { m = JSON.parse(fs.readFileSync(path.join(cwd, '.mcp.json'), 'utf8')) || {}; } catch { /* none */ }
    for (const [name, spec] of Object.entries(m.mcpServers || {})) out.push({ name, scope: 'project', spec });
  }
  return out;
}
// Codex's servers, from `codex mcp list --json`.
function codexServers(list) {
  return (Array.isArray(list) ? list : []).filter(x => x && x.name).map(x => ({ name: x.name, scope: 'user', spec: { ...(x.transport || {}) }, enabled: x.enabled !== false }));
}

// What a server is, without its secrets: how it runs, and the names (never the values) of its settings.
function view(spec) {
  const s = spec || {};
  const url = s.url || null;
  return {
    transport: url ? 'http' : 'stdio',
    command: url ? null : s.command || null, args: url ? [] : Array.isArray(s.args) ? s.args.map(String) : [], url,
    envNames: Object.keys(s.env || {}), headerNames: Object.keys(s.headers || s.http_headers || {}),
    tokenVar: s.bearer_token_env_var || null, cwd: s.cwd || null,
    // Codex's own built-ins (its app, its browser helpers) only work inside Codex.
    own: Object.keys(s.env || {}).some(k => /^CODEX_(HOME|CLI_PATH)$/.test(k)),
  };
}

// The same server as the other one wants it, or why it can't be copied.
function forCodex(spec) {
  const v = view(spec);
  if (v.transport === 'http') {
    if (v.headerNames.length) return { why: 'It sends sign-in headers, which Codex sets up differently. Add it to Codex by hand.' };
    return { value: { url: v.url } };
  }
  if (!v.command) return { why: 'It has no command to run.' };
  return { value: { command: v.command, args: v.args, ...(spec.env && Object.keys(spec.env).length ? { env: { ...spec.env } } : {}) } };
}
function forClaude(spec) {
  const v = view(spec);
  if (v.own) return { why: 'It’s part of Codex itself, so it only works there.' };
  if (v.cwd) return { why: 'It runs from a folder of its own, which Claude Code can’t set. Add it to Claude by hand.' };
  if (v.transport === 'http') {
    if (v.headerNames.length) return { why: 'It sends custom headers. Add it to Claude by hand.' };
    return { value: { type: 'http', url: v.url, ...(v.tokenVar ? { headers: { Authorization: `Bearer \${${v.tokenVar}}` } } : {}) } };
  }
  if (!v.command) return { why: 'It has no command to run.' };
  return { value: { type: 'stdio', command: v.command, args: v.args, ...(spec.env && Object.keys(spec.env).length ? { env: { ...spec.env } } : {}) } };
}

// Both lists, side by side by name.
function merged(claudeList, codexList) {
  const rows = new Map();
  for (const x of claudeList) { const r = rows.get(x.name) || { name: x.name, claude: null, codex: null }; r.claude = r.claude || { scope: x.scope, ...view(x.spec) }; rows.set(x.name, r); }
  for (const x of codexList) { const r = rows.get(x.name) || { name: x.name, claude: null, codex: null }; r.codex = { scope: x.scope, enabled: x.enabled, ...view(x.spec) }; rows.set(x.name, r); }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

// Runs a program directly with its arguments (no shell, so nothing in them is ever interpreted).
function runDirect(file, args, { env, cwd, timeoutMs = 30000 } = {}) {
  return new Promise(resolve => {
    let child;
    try { child = spawn(file, args, { env, cwd, windowsHide: true, shell: false }); } catch (err) { return resolve({ code: -1, stdout: '', stderr: err.message }); }
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, timeoutMs);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', err => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: err.message }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
// A program file that can run without a shell (claude.exe, or claude on a Mac), not a .cmd/.bat shim.
const runnable = p => !!p && (process.platform !== 'win32' || /\.exe$/i.test(p));

module.exports = { rulesPaths, readRules, writeRules, claudeServers, codexServers, view, forCodex, forClaude, merged, runDirect, runnable, NAME };
