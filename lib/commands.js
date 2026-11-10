'use strict';
// Claude Code's own slash commands that a chat can run, for the / menu: skills (<dir>/skills/<name>/SKILL.md)
// and commands (<dir>/commands/**/*.md), yours (~/.claude, shared by every account) and the project's
// (<folder>/.claude). Each comes with the description and argument hint its frontmatter gives. Picking one
// types "/name " in the box; Claude Code itself runs it when the message goes (it does in the streaming mode
// the chats use).

const fs = require('fs');
const path = require('path');

const NAME = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/;
const HEAD_BYTES = 16 * 1024;   // the frontmatter is at the top; no need to read a long skill whole
const MAX_EACH = 200;           // per folder, in case one holds a whole library

function head(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.slice(0, n).toString('utf8').replace(/^﻿/, '');
  } catch { return ''; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ } }
}

// The simple YAML Claude Code's frontmatter uses: "key: value", quoted values, and | or > blocks.
function frontmatter(text) {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  const out = {};
  if (!m) return { fields: out, body: text };
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^[|>][-+]?$/.test(v)) {
      const block = [];
      while (i + 1 < lines.length && (/^[ \t]+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].trim());
      v = block.join(' ').replace(/\s+/g, ' ').trim();
    } else if (/^"(.*)"$/.test(v)) v = v.slice(1, -1).replace(/\\"/g, '"');
    else if (/^'(.*)'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'");
    out[kv[1].toLowerCase()] = v;
  }
  return { fields: out, body: text.slice(m[0].length) };
}

const oneLine = (s, n = 240) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
// A command file without a description: Claude Code shows its first line.
const firstLine = body => oneLine((String(body).split(/\r?\n/).find(l => l.trim()) || '').replace(/^#+\s*/, ''));
const off = v => /^(false|no|off|0)$/i.test(String(v || '').trim());

function skillsIn(dir, scope) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() || d.isSymbolicLink()).map(d => d.name).sort(); } catch { return out; }
  for (const d of names) {
    if (out.length >= MAX_EACH) break;
    const file = path.join(dir, d, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const { fields, body } = frontmatter(head(file));
    const name = fields.name || d;
    if (!NAME.test(name) || off(fields['user-invocable'])) continue;
    out.push({ name, description: oneLine(fields.description) || firstLine(body), hint: oneLine(fields['argument-hint'], 120), kind: 'skill', scope });
  }
  return out;
}

function commandsIn(dir, scope) {
  const out = [];
  const walk = (d, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return; }
    for (const e of ents) {
      if (out.length >= MAX_EACH) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 3 && !e.name.startsWith('.')) walk(p, depth + 1); continue; }
      if (!/\.md$/i.test(e.name)) continue;
      const name = e.name.replace(/\.md$/i, '');
      if (!NAME.test(name)) continue;
      const { fields, body } = frontmatter(head(p));
      if (off(fields['user-invocable'])) continue;
      out.push({ name, description: oneLine(fields.description) || firstLine(body), hint: oneLine(fields['argument-hint'], 120), kind: 'command', scope });
    }
  };
  walk(dir, 0);
  return out;
}

// Everything a Claude chat in `cwd` can run, the project's first (its own wins over yours with the same
// name), then yours, each group by name.
function list({ claudeDir, cwd } = {}) {
  const seen = new Set(), out = [];
  const add = items => { for (const c of items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))) { const k = c.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(c); } } };
  const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  if (cwd && !(claudeDir && same(path.join(cwd, '.claude'), claudeDir))) add([...skillsIn(path.join(cwd, '.claude', 'skills'), 'project'), ...commandsIn(path.join(cwd, '.claude', 'commands'), 'project')]);
  if (claudeDir) add([...skillsIn(path.join(claudeDir, 'skills'), 'yours'), ...commandsIn(path.join(claudeDir, 'commands'), 'yours')]);
  return out;
}

module.exports = { list, frontmatter };
