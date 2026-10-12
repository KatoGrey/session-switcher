'use strict';
// Branch a Claude Code chat from one of its replies: a new conversation that has everything up to the
// end of that reply, and nothing after it. The original isn't touched. The new one is a copy of the
// conversation file (the lines up to the next message you wrote) under a new id, so Claude Code
// resumes it like any other chat.

const fs = require('fs');
const path = require('path');
const { isRealPrompt } = require('./sessions');

// file: the chat's .jsonl; mid: the reply's last message id (as the page knows it); newId: a uuid.
function branchSession(file, mid, newId) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const parsed = lines.map(l => { const t = l.trim(); if (!t || t[0] !== '{') return null; try { return JSON.parse(t); } catch { return null; } });
  let last = -1;
  parsed.forEach((e, i) => { if (e && e.type === 'assistant' && e.message && (e.message.id === mid || e.uuid === mid)) last = i; });
  if (last < 0) throw Object.assign(new Error('That reply isn’t in the chat’s file (yet). Try again once it has finished.'), { status: 404 });
  // The reply goes on after its tool results until you write again: cut just before that.
  let cut = parsed.length;
  for (let i = last + 1; i < parsed.length; i++) {
    const e = parsed[i];
    if (!e || e.type !== 'user' || !e.message) continue;
    const content = e.message.content;
    const toolResults = Array.isArray(content) && content.some(b => b && b.type === 'tool_result');
    if (toolResults) continue;
    const images = Array.isArray(content) && content.some(b => b && b.type === 'image');
    if (isRealPrompt(e) || images) { cut = i; break; }
  }
  const out = [];
  for (let i = 0; i < cut; i++) {
    const e = parsed[i];
    if (!e) continue;
    if ('sessionId' in e) e.sessionId = newId;
    out.push(JSON.stringify(e));
  }
  const to = path.join(path.dirname(file), `${newId}.jsonl`);
  if (fs.existsSync(to)) throw new Error('A chat with that id already exists.');
  fs.writeFileSync(to, `${out.join('\n')}\n`);
  return { id: newId, file: to, lines: out.length };
}

module.exports = { branchSession };
