'use strict';
// Opens files and folders a chat mentions ("PATCH-NOTES.md", "fb5-playtest/", "C:\Users\...\plan.md")
// so they can be read and copied inside the app. Relative paths are resolved against the chat's folder.
//
// Only files inside the chat's folder or your user folder open. Hidden folders in your user folder stay
// closed (they hold things like SSH keys), except Claude Code's own folders, and sign-in files never open.

const fs = require('fs');
const path = require('path');
const os = require('os');

const TEXT_LIMIT = 2 * 1024 * 1024;
const IMAGE_LIMIT = 8 * 1024 * 1024;
// Videos, sound and PDFs play or show in the viewer, streamed from /api/media.
const MEDIA_TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg', '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.aac': 'audio/aac', '.pdf': 'application/pdf' };
const mediaKind = mime => (mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'pdf');
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp' };
const LANGS = { '.md': 'markdown', '.markdown': 'markdown', '.mdx': 'markdown', '.txt': 'text', '.json': 'json', '.jsonl': 'json lines', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.ts': 'typescript', '.tsx': 'typescript', '.jsx': 'javascript', '.py': 'python', '.html': 'html', '.htm': 'html', '.css': 'css', '.csv': 'csv', '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml', '.xml': 'xml', '.sh': 'shell', '.ps1': 'powershell', '.bat': 'batch', '.cmd': 'batch', '.log': 'log', '.lua': 'lua', '.luau': 'luau', '.cs': 'c#', '.java': 'java', '.go': 'go', '.rs': 'rust', '.sql': 'sql', '.ini': 'ini', '.env': 'env' };
const SECRET_NAME = /^(\.credentials\.json|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*\.(pem|key|p12|pfx|kdbx))$/i;
const CLAUDE_DIR = /^\.(claude|codex)(-[\w-]+)?$/i; // Claude Code's and Codex's own folders

const fail = (status, message) => Object.assign(new Error(message), { status });

function clean(raw) {
  let p = String(raw || '').trim().replace(/^<(.*)>$/, '$1').replace(/^["'`](.*)["'`]$/, '$1');
  if (/^file:/i.test(p)) {
    p = p.replace(/^file:\/*/i, '');
    if (!/^[A-Za-z]:/.test(p)) p = `/${p}`;
  }
  if (/%[0-9a-f]{2}/i.test(p)) { try { p = decodeURIComponent(p); } catch { /* keep as is */ } }
  p = p.replace(/#L?\d+(-L?\d+)?$/i, '').replace(/(\.[\w]+):\d+(:\d+)?$/, '$1');
  if (p === '~' || /^~[\\/]/.test(p)) p = path.join(os.homedir(), p.slice(1));
  return p;
}

const isInside = (root, abs) => {
  if (!root) return false;
  const r = path.relative(path.resolve(root), abs);
  return r === '' || (!!r && !r.startsWith('..') && !path.isAbsolute(r));
};

function resolve(base, raw) {
  const p = clean(raw);
  if (!p || p.length > 1000 || p.includes('\0')) throw fail(400, 'That doesn’t look like a file path.');
  const absolute = path.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p);
  if (!absolute && !base) throw fail(400, 'This link is relative, and there’s no chat folder to find it in.');
  return path.resolve(absolute ? p : path.join(base, p));
}

function allowed(abs, base) {
  if (SECRET_NAME.test(path.basename(abs))) return false;
  if (isInside(base, abs)) return true;
  const home = os.homedir();
  if (!isInside(home, abs)) return false;
  const segs = path.relative(home, abs).split(/[\\/]+/).filter(Boolean);
  return segs.every((s, i) => !s.startsWith('.') || (i === 0 && CLAUDE_DIR.test(s)));
}

function readEntry(base, raw) {
  const abs = resolve(base, raw);
  if (!allowed(abs, base)) throw fail(403, 'Session Switcher only opens files inside this chat’s folder or your user folder.');
  let st;
  try { st = fs.statSync(abs); } catch { throw fail(404, `There’s no file at ${abs}. It may have been moved, renamed or not written yet.`); }
  const out = { path: abs, name: path.basename(abs) || abs, rel: isInside(base, abs) ? path.relative(base, abs) || '.' : null, dir: path.dirname(abs), mtime: st.mtimeMs, size: st.size };
  if (st.isDirectory()) {
    let names = [];
    try { names = fs.readdirSync(abs, { withFileTypes: true }); } catch (err) { throw fail(403, `That folder can’t be read: ${err.message}`); }
    const entries = names.slice(0, 1000).map(d => {
      let size = null, mtime = null;
      try { const s = fs.statSync(path.join(abs, d.name)); size = s.isDirectory() ? null : s.size; mtime = s.mtimeMs; } catch { /* skip */ }
      return { name: d.name, dir: d.isDirectory(), size, mtime };
    }).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    return { ...out, kind: 'dir', entries, more: names.length > 1000 };
  }
  const ext = path.extname(abs).toLowerCase();
  if (IMAGE_TYPES[ext]) {
    if (st.size > IMAGE_LIMIT) return { ...out, kind: 'binary', note: 'This image is too large to preview here.' };
    return { ...out, kind: 'image', src: `data:${IMAGE_TYPES[ext]};base64,${fs.readFileSync(abs).toString('base64')}` };
  }
  if (MEDIA_TYPES[ext]) return { ...out, kind: mediaKind(MEDIA_TYPES[ext]), mime: MEDIA_TYPES[ext] };
  const fd = fs.openSync(abs, 'r');
  let buf;
  try {
    const len = Math.min(st.size, TEXT_LIMIT);
    buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
  } finally { fs.closeSync(fd); }
  if (buf.subarray(0, 8000).includes(0)) return { ...out, kind: 'binary', note: 'This file isn’t text, so it can’t be shown here. Use “Show in folder” to open it.' };
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { ...out, kind: 'text', lang: LANGS[ext] || (ext ? ext.slice(1) : 'text'), markdown: LANGS[ext] === 'markdown', text, truncated: st.size > TEXT_LIMIT };
}

// Finds the file to reveal in Explorer, with the same rules as reading it.
function locate(base, raw) {
  const abs = resolve(base, raw);
  if (!allowed(abs, base)) throw fail(403, 'Session Switcher only opens files inside this chat’s folder or your user folder.');
  let st;
  try { st = fs.statSync(abs); } catch { throw fail(404, `There’s no file at ${abs}.`); }
  return { path: abs, isFile: !st.isDirectory() };
}

module.exports = { readEntry, locate, clean, resolve, allowed, MEDIA_TYPES };
