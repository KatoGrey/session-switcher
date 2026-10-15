'use strict';
// Opens files and folders a chat mentions ("PATCH-NOTES.md", "fb5-playtest/", "C:\Users\...\plan.md")
// so they can be read and copied inside the app. Relative paths are resolved against the chat's folder.
//
// Files and folders anywhere on the computer open, but for a few private places: hidden folders and
// AppData in your user folder (SSH keys, browsers' cookies), except Claude Code's and Codex's own
// folders; other people's user folders; key folders like .ssh wherever they are. Sign-in files never open.

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
// Sign-in files and keys never open in the viewer: Claude Code's .credentials.json, Codex's auth.json
// (in ~/.codex and any extra Codex homes), SSH keys and certificate stores.
const SECRET_NAME = /^(\.credentials\.json|auth\.json|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*\.(pem|key|p12|pfx|kdbx))$/i;
const CLAUDE_DIR = /^\.(claude|codex)(-[\w-]+)?$/i; // Claude Code's and Codex's own folders
// Folders that hold keys and cloud sign-ins, wherever they are (a backup on another drive too).
const SECRET_DIR = /^\.(ssh|gnupg|aws|azure|kube|docker|password-store)$/i;

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

// A path as it really is: Windows short names (SSH~1 for .ssh) spelled out, links and junctions
// followed. For a path that doesn't exist yet, its nearest existing folder, plus the rest.
function realOf(p) {
  let cur = p, rest = '';
  for (let i = 0; i < 64; i++) {
    try { return path.join(fs.realpathSync.native(cur), rest); } catch { /* not there: go up */ }
    const up = path.dirname(cur);
    if (up === cur) return p;
    rest = path.join(path.basename(cur), rest); cur = up;
  }
  return p;
}
function allowed(abs, base) {
  const real = realOf(abs);
  if (SECRET_NAME.test(path.basename(abs)) || SECRET_NAME.test(path.basename(real))) return false;
  if ([abs, real].some(p => p.split(/[\\/]+/).some(s => SECRET_DIR.test(s)))) return false;
  const home = realOf(os.homedir());
  // Everything in the chat's own folder (unless the chat runs in the user folder itself, or a drive).
  const b = base ? realOf(base) : null;
  if (b && b !== home && b !== path.parse(b).root && isInside(b, real)) return true;
  if (isInside(home, real)) {
    const segs = path.relative(home, real).split(/[\\/]+/).filter(Boolean);
    // Hidden folders (.ssh, .aws, .config…) are out, but for Claude Code's and Codex's own; so is
    // AppData (browsers' cookies, apps' saved sign-ins), but for its temporary files.
    if (segs[0] && segs[0].toLowerCase() === 'appdata' && !(segs[1] && segs[1].toLowerCase() === 'local' && segs[2] && segs[2].toLowerCase() === 'temp')) return false;
    return segs.every((s, i) => !s.startsWith('.') || (i === 0 && CLAUDE_DIR.test(s)));
  }
  // Anywhere else on the computer opens too (a site in C:\Sites, a game on D:\), but for other
  // people's user folders (C:\Users\someone-else; the shared Public one is fine).
  const users = path.dirname(home);
  if (users !== path.parse(users).root && isInside(users, real)) {
    const first = path.relative(users, real).split(/[\\/]+/).filter(Boolean)[0];
    return !!first && /^(public|shared)$/i.test(first);
  }
  return true;
}

function readEntry(base, raw) {
  const abs = resolve(base, raw);
  if (!allowed(abs, base)) throw fail(403, 'That’s a private place (sign-ins, keys or another person’s files), so Session Switcher won’t open it.');
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
  if (!allowed(abs, base)) throw fail(403, 'That’s a private place (sign-ins, keys or another person’s files), so Session Switcher won’t open it.');
  let st;
  try { st = fs.statSync(abs); } catch { throw fail(404, `There’s no file at ${abs}.`); }
  return { path: abs, isFile: !st.isDirectory() };
}

module.exports = { readEntry, locate, clean, resolve, allowed, MEDIA_TYPES };
