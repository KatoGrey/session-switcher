'use strict';
// What a chat showed that isn't in its conversation file: each reply's "Changed N files" (with what
// Undo and "See the changes" need), what was undone, and review results. Claude Code and Codex keep
// the conversation; this keeps the rest, one small file per conversation, so a chat that's opened
// again (after a restart, an update, or an idle stop) shows them where they were, and Undo still works.

const fs = require('fs');
const path = require('path');

const KEEP = new Set(['changes', 'undone', 'review']);
const MAX_LINES = 600, TRIM_TO = 400;

function createExtras({ dir, log = () => {} }) {
  const fileOf = id => path.join(dir, `${String(id).toLowerCase().replace(/[^\w.-]/g, '_').slice(0, 120)}.jsonl`);
  const cache = new Map();   // id -> records (read once)
  function read(id) {
    id = String(id).toLowerCase();
    if (cache.has(id)) return cache.get(id);
    let out = [];
    try {
      out = fs.readFileSync(fileOf(id), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { /* none yet */ }
    cache.set(id, out);
    return out;
  }
  // Keeps one event. snap: what Undo needs for a "changes" event (the snapshots before and after).
  function record(id, ev, snap = null) {
    if (!id || !KEEP.has(ev.kind)) return;
    if (ev.kind === 'review' && ev.state === 'running') return;   // only how it ended
    const { seq, ...rest } = ev;
    const rec = snap ? { ...rest, snap } : rest;
    const list = read(id);
    list.push(rec);
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (list.length > MAX_LINES) {
        list.splice(0, list.length - TRIM_TO);
        fs.writeFileSync(fileOf(id), `${list.map(r => JSON.stringify(r)).join('\n')}\n`);
      } else fs.appendFileSync(fileOf(id), `${JSON.stringify(rec)}\n`);
    } catch (err) { log(`Couldn’t keep a chat’s changes: ${err.message}`); }
  }
  // For the page: what to show, up to `until` (where the running chat's own replay begins). A review
  // shows once, as it ended.
  function list(id, until = null) {
    const out = [], reviews = new Map();
    for (const r of read(id)) {
      if (until && r.at && r.at >= until) continue;
      const { snap, ...ev } = r;
      if (ev.kind === 'review') { if (reviews.has(ev.id)) out[reviews.get(ev.id)] = ev; else { reviews.set(ev.id, out.length); out.push(ev); } continue; }
      out.push(ev);
    }
    return out;
  }
  // For the chat: the replies' snapshots, by their turn number, so Undo and diffs work again.
  function turns(id) {
    const out = [];
    for (const r of read(id)) if (r.kind === 'changes' && r.snap && r.snap.before && r.snap.after) out[r.turn] = { n: r.turn, before: r.snap.before, after: r.snap.after, files: r.snap.files || r.files, at: r.snap.at || r.since, top: r.snap.top };
    return out;
  }
  return { record, list, turns, KEEP };
}

module.exports = { createExtras, KEEP };
