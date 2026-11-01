'use strict';
// "Search every chat", past Claude's own transcripts (lib/sessions.js has those): Codex's, Gemini's and OpenClaw's chats,
// by what's known of each without reading it, and by what's in it if textOf has it. textOf(id) answers like the index in
// lib/sessions.js: { full } or { head, tail }, or nothing while it hasn't been read.

const isClaude = s => !s.provider || s.provider === 'claude';
const escapeRe = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function snippetAt(text, pos) {
  let a = Math.max(0, pos - 90);
  if (a > 0) { const sp = text.indexOf(' ', a); if (sp !== -1 && sp < pos) a = sp + 1; }
  let b = Math.min(text.length, pos + 160);
  if (b < text.length) { const sp = text.lastIndexOf(' ', b); if (sp > pos + 40) b = sp; }
  return (a > 0 ? '…' : '') + text.slice(a, b).replace(/\s+/g, ' ').trim() + (b < text.length ? '…' : '');
}

// One answer per chat: a hit, or null. (Matched without lowering the whole text: it can be megabytes per chat, on every search.)
function* matches(projects, q, textOf) {
  const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  if (!terms.length) return;
  const res = terms.map(t => new RegExp(escapeRe(t), 'i')), resG = terms.map(t => new RegExp(escapeRe(t), 'gi'));
  for (const p of projects || []) {
    for (const s of p.sessions || []) {
      if (isClaude(s)) continue;
      const known = [s.title, s.firstPrompt, s.lastPrompt, p.name].filter(Boolean).join('\n');
      const ix = textOf(s.id);
      const spans = [known, ...(ix ? (ix.full !== undefined ? [ix.full] : [ix.head, ix.tail]) : [])].filter(Boolean);
      if (!res.every(re => spans.some(text => re.test(text)))) { yield null; continue; }
      // The words themselves, where they were found.
      let snippet = '', count = 0;
      for (const text of spans) {
        for (const re of resG) {
          re.lastIndex = 0;
          for (let m = re.exec(text); m && count < 999; m = re.exec(text)) {
            count++;
            if (!snippet) snippet = snippetAt(text, m.index);
          }
        }
      }
      const name = `${s.title || ''} ${p.name || ''}`.toLowerCase();
      yield { id: s.id, folder: p.name, cwd: p.cwd, count, snippet, inTitle: terms.every(t => name.includes(t)) };
    }
  }
}
const searchOthers = (projects, q, textOf = () => null) => [...matches(projects, q, textOf)].filter(Boolean);
// The same, letting everything else get a turn.
async function searchOthersAsync(projects, q, textOf = () => null, { signal } = {}) {
  const hits = [];
  let yielded = Date.now();
  for (const hit of matches(projects, q, textOf)) {
    if (signal && signal.aborted) throw signal.reason || new Error('Search cancelled.');
    if (hit) hits.push(hit);
    if (Date.now() - yielded >= 8) { await new Promise(resolve => setImmediate(resolve)); yielded = Date.now(); }
  }
  return hits;
}

// Everything found, each once, those matching in their names first, then those that say it most.
function mergeHits(a, b, limit = 60) {
  const seen = new Set(), out = [];
  for (const h of [...a, ...b]) {
    const k = String(h.id).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  return out.sort((x, y) => (y.inTitle - x.inTitle) || (y.count - x.count)).slice(0, limit);
}

// A partner's conversation lives inside the chat it belongs to, which is what's in the lists: found there. (partners: a
// partner's id, in lower case, to its chat's id.)
function underLeads(hits, partners) {
  if (!partners || !partners.size) return hits;
  return hits.map(h => { const lead = partners.get(String(h.id).toLowerCase()); return lead ? { ...h, id: lead, inTitle: false } : h; });
}
// Reading Claude's chats and reading the others', as one.
function bothProgress(a, b) {
  const x = a || { done: 0, total: 0, ready: true }, y = b || { done: 0, total: 0, ready: true };
  return { done: x.done + y.done, total: x.total + y.total, ready: !!x.ready && !!y.ready };
}

module.exports = { searchOthers, searchOthersAsync, mergeHits, underLeads, bothProgress };
