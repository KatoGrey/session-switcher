'use strict';
// What Claude remembers about a project: the notes it keeps for itself between chats (a folder of small
// files beside the project's conversations, with an index, MEMORY.md, that it reads at the start of each
// chat). They shape everything it does there, and you could only see how many there were. Here they're
// read, and a wrong one can be forgotten: set aside where you can bring it back, and out of the index.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const INDEX = 'MEMORY.md';
const MAX_NOTES = 2000;
const fail = (status, message) => Object.assign(new Error(message), { status });

// The part between the --- lines: only what a note uses (name, description, type, on a line each).
function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { body: text };
  const out = { body: text.slice(m[0].length) };
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^\s*(name|description|type):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^["'].*["']$/.test(v)) v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
    out[kv[1]] = v;
  }
  return out;
}
// A note's name in plain words, as the index gives it: "- [Start-here documents](claude-handoffs.md) — …".
function indexTitles(text) {
  const titles = new Map();
  for (const m of String(text).matchAll(/^\s*[-*]\s*\[([^\]]+)\]\(([^)\s]+\.md)\)/gm)) titles.set(m[2].toLowerCase(), m[1]);
  return titles;
}
const safeName = name => {
  const n = String(name || '');
  if (!/^[^\\/]+\.md$/i.test(n) || n === '.' || n === '..' || n.toUpperCase() === INDEX.toUpperCase()) throw fail(400, 'That isn’t a note.');
  return n;
};

function createMemories({ dataDir, log = () => {} }) {
  async function list(dir) {
    if (!dir) return { notes: [] };
    let names = [];
    try { names = (await fsp.readdir(dir, { withFileTypes: true })).filter(e => e.isFile() && /\.md$/i.test(e.name)).map(e => e.name); } catch { return { notes: [] }; }
    let titles = new Map();
    const hasIndex = names.some(n => n.toUpperCase() === INDEX.toUpperCase());
    if (hasIndex) { try { titles = indexTitles(await fsp.readFile(path.join(dir, INDEX), 'utf8')); } catch { /* it's only titles */ } }
    const notes = [];
    for (let i = 0, rest = names.filter(n => n.toUpperCase() !== INDEX.toUpperCase()).slice(0, MAX_NOTES); i < rest.length; i += 32) {
      const part = await Promise.all(rest.slice(i, i + 32).map(async name => {
        const file = path.join(dir, name);
        try {
          const [st, handle] = await Promise.all([fsp.stat(file), fsp.open(file, 'r')]);
          // The top of it says what it is; a note can be long.
          const buf = Buffer.alloc(Math.min(st.size, 4096));
          try { await handle.read(buf, 0, buf.length, 0); } finally { await handle.close(); }
          const fm = frontMatter(buf.toString('utf8'));
          return { file: name, path: file, title: titles.get(name.toLowerCase()) || fm.name || name.replace(/\.md$/i, ''), description: fm.description || '', type: fm.type || '', mtime: st.mtimeMs, size: st.size };
        } catch { return null; }
      }));
      notes.push(...part.filter(Boolean));
    }
    notes.sort((a, b) => b.mtime - a.mtime);
    return { dir, index: hasIndex ? path.join(dir, INDEX) : null, notes };
  }
  // Set aside, not deleted: it can come back. Out of the index, so it isn't read any more.
  async function forget(dir, name) {
    const file = safeName(name), from = path.join(dir, file), bin = path.join(dataDir, 'forgotten-notes', path.basename(path.dirname(dir)));
    await fsp.mkdir(bin, { recursive: true });
    const kept = path.join(bin, `${Date.now()}-${file}`);
    let line = null;
    const idx = path.join(dir, INDEX);
    try {
      const text = await fsp.readFile(idx, 'utf8');
      const lines = text.split('\n'), at = lines.findIndex(l => l.includes(`(${file})`));
      if (at >= 0) { [line] = lines.splice(at, 1); await fsp.writeFile(idx, lines.join('\n')); }
    } catch (err) { if (err.code !== 'ENOENT') log(`Couldn’t change MEMORY.md: ${err.message}`); }
    try { await fsp.rename(from, kept); }
    catch (err) {
      if (err.code === 'ENOENT') throw fail(404, 'That note has gone already.');
      if (err.code !== 'EXDEV') throw err;
      await fsp.copyFile(from, kept); await fsp.rm(from);
    }
    return { kept: path.basename(kept), line };
  }
  async function bringBack(dir, name, kept, line) {
    const file = safeName(name);
    const from = path.join(dataDir, 'forgotten-notes', path.basename(path.dirname(dir)), path.basename(String(kept || '')));
    try { await fsp.access(path.join(dir, file)); throw fail(409, 'There’s a note of that name there again.'); } catch (err) { if (err.status) throw err; }
    try { await fsp.rename(from, path.join(dir, file)); } catch (err) {
      if (err.code === 'ENOENT') throw fail(404, 'That note can’t be brought back any more.');
      if (err.code !== 'EXDEV') throw err;
      await fsp.copyFile(from, path.join(dir, file)); await fsp.rm(from);
    }
    if (line) {
      const idx = path.join(dir, INDEX);
      try {
        const text = await fsp.readFile(idx, 'utf8');
        if (!text.includes(`(${file})`)) await fsp.writeFile(idx, `${text.replace(/\n*$/, '')}\n${String(line).replace(/\r?\n/g, ' ')}\n`);
      } catch (err) { if (err.code === 'ENOENT') await fsp.writeFile(idx, `${String(line).replace(/\r?\n/g, ' ')}\n`); else log(`Couldn’t change MEMORY.md: ${err.message}`); }
    }
    return { ok: true };
  }
  return { list, forget, bringBack };
}

module.exports = { createMemories, frontMatter, indexTitles };
