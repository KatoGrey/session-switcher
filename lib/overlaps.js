'use strict';
// Two chats changing the same file at the same time. Each works from what it last read, so the second write
// can quietly undo the first, and nobody says so until something's missing. This notices from what the
// chats' own edit tools report, whichever program they are: every open chat, partners included, each with
// the files it changed lately and when that reply began and ended, read a little at a time as they work.
// One after the other is fine (the second reads what the first left), and that's most of what a crew taking
// turns does, so it needs the replies to have overlapped. Commands aren't counted: a command might touch
// anything, and saying so all day would help nobody.

const path = require('path');

const WINDOW = 45 * 60e3;   // how long it's worth saying
const MAX_FILES = 400;      // in one chat's memory; the oldest go

const norm = p => (process.platform === 'win32' ? p.toLowerCase() : p);
const EDITS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
// You said no to the edit, so it didn't happen. (An edit that failed may still have written part of it: that counts.)
const DECLINED = /declined|doesn.t want to proceed|was denied|permission.*denied/i;

function createOverlaps({ windowMs = WINDOW } = {}) {
  const seen = new WeakMap();   // chat -> { seq, files: Map(normalized path -> { file, at, from, to }), from, open: [] }

  // What this chat has changed since it was last asked. to is null while its reply goes on.
  function editsOf(c) {
    const me = seen.get(c) || { seq: -1, files: new Map(), from: 0, open: [] };
    seen.set(c, me);
    const buf = c.buffer || [];
    let i = buf.length;
    while (i > 0 && buf[i - 1].seq > me.seq) i--;
    for (; i < buf.length; i++) {
      const ev = buf[i], at = Date.parse(ev.at) || 0;
      me.seq = ev.seq;
      if (ev.kind === 'user') { if (!me.open.length) me.from = at; continue; }
      if (ev.kind === 'tool_result') {
        const r = ev.result;
        if (r && r.isError && DECLINED.test(r.text || '')) {
          for (const [k, rec] of me.files) if (rec.tool && rec.tool === ev.toolUseId) { if (rec.was) me.files.set(k, rec.was); else me.files.delete(k); }
        }
        continue;
      }
      if (ev.kind === 'result' || ev.kind === 'ended') { for (const r of me.open) r.to = at; me.open = []; me.from = 0; continue; }
      if (ev.kind !== 'assistant') continue;
      for (const b of ev.blocks || []) {
        if (b.type !== 'tool' || !b.meta || !EDITS.has(b.name)) continue;
        for (const p of b.meta.paths || (b.meta.path ? [b.meta.path] : [])) {
          const file = path.resolve(c.cwd || '.', String(p)), k = norm(file);
          const was = me.files.get(k);
          if (was && was.at > at) continue;
          const rec = { file, at, from: me.from || at, to: null, tool: b.id || null, was: was ? { ...was, was: null } : null };
          me.files.delete(k); me.files.set(k, rec);
          me.open.push(rec);
        }
      }
    }
    while (me.files.size > MAX_FILES) me.files.delete(me.files.keys().next().value);
    return me.files;
  }

  // chats: every chat the app has. Returns a Map(chat key -> [{ file, rel, at, others: [{ key, provider, at }] }]),
  // newest first, for the chats still open.
  function check(chats, now = Date.now()) {
    const byFile = new Map();
    for (const c of chats) {
      if (!c || c.aside || !c.key) continue;
      for (const [k, e] of editsOf(c)) {
        if (now - e.at > windowMs) continue;
        const list = byFile.get(k);
        if (list) list.push({ c, ...e }); else byFile.set(k, [{ c, ...e }]);
      }
    }
    const together = (a, b) => a.from <= (b.to === null ? now : b.to) && b.from <= (a.to === null ? now : a.to);
    const out = new Map();
    for (const list of byFile.values()) {
      if (list.length < 2) continue;
      for (const me of list) {
        if (me.c.state === 'ended') continue;
        const others = list.filter(o => o.c !== me.c && together(me, o)).map(o => ({ key: o.c.key, provider: o.c.provider || 'claude', sessionId: o.c.sessionId || null, at: o.at }));
        if (!others.length) continue;
        const at = Math.max(me.at, ...others.map(o => o.at));
        const row = { file: me.file, rel: path.relative(me.c.cwd || '.', me.file).split(path.sep).join('/'), at, mine: me.at, others };
        const had = out.get(me.c.key);
        if (had) had.push(row); else out.set(me.c.key, [row]);
      }
    }
    for (const rows of out.values()) rows.sort((a, b) => b.at - a.at);
    return out;
  }
  return { check };
}

module.exports = { createOverlaps };
