'use strict';
// "Make a copy to share": zips the app itself, without anything personal, so you can hand it to
// someone else. Only the app's own files go in (code, pages, styles, fonts, icons, the README).
// Your accounts, chat history, chat names, banners, projects and log never do. Your prompts go in
// only if you ask.

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

// .command and .icns are the Mac launcher and the icon for the app it makes.
const KEEP_EXT = new Set(['.js', '.html', '.css', '.md', '.vbs', '.bat', '.command', '.ico', '.icns', '.woff2', '.mp3', '.txt']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'web', 'mobile', 'attachments', 'tests']);
// Files older versions had that unzipping an update leaves behind.
const OBSOLETE = new Set(['lib/worlds.js', 'app.js', 'chat-ui.js']);

function appFiles(appDir) {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && rel.split('/').length < 3) walk(p, r); continue; }
      if (e.isFile() && KEEP_EXT.has(path.extname(e.name).toLowerCase()) && !OBSOLETE.has(r) && !/\.(tmp|bak)$|\.corrupt-/i.test(e.name)) out.push({ path: p, name: r });
    }
  };
  walk(appDir, '');
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------- a small zip writer (deflate, UTF-8 names) ---------- */
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}
function zip(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = e.data;
    const packed = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = packed.length < raw.length;
    const body = useDeflate ? packed : raw;
    const crc = crc32(raw);
    const { time, date } = dosTime(e.mtime || new Date());
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(useDeflate ? 8 : 0, 10); cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
    // Unix permissions, so a Mac unzips the launcher as something it can run (Windows ignores them).
    cen.writeUInt16LE(0x0314, 4);
    cen.writeUInt32LE(((0o100000 | (/\.(command|sh)$/.test(e.name) ? 0o755 : 0o644)) << 16) >>> 0, 38);
    central.push(cen, name);
    offset += local.length + name.length + body.length;
  }
  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cenBuf, end]);
}

// Somewhere easy to find: the Desktop (including a OneDrive one), else Downloads, else home.
function outputDir() {
  const home = os.homedir();
  for (const d of [path.join(home, 'Desktop'), path.join(home, 'OneDrive', 'Desktop'), path.join(home, 'Downloads')]) if (fs.existsSync(d)) return d;
  return home;
}

function makeShareCopy({ appDir, version, prompts = null, outDir = outputDir() }) {
  const files = appFiles(appDir);
  const folder = 'Session Switcher';
  const entries = files.map(f => { const st = fs.statSync(f.path); return { name: `${folder}/${f.name}`, data: fs.readFileSync(f.path), mtime: st.mtime }; });
  if (prompts && prompts.length) entries.push({ name: `${folder}/prompts.json`, data: Buffer.from(JSON.stringify({ prompts }, null, 2)), mtime: new Date() });
  // The Android app, if it's been built here, so phones can get it from Setup → Phone access.
  const apk = [path.join(appDir, 'SessionSwitcher.apk'), path.join(appDir, 'mobile', 'android', 'build', 'SessionSwitcher.apk')].find(p => fs.existsSync(p));
  if (apk) entries.push({ name: `${folder}/SessionSwitcher.apk`, data: fs.readFileSync(apk), mtime: fs.statSync(apk).mtime });
  const out = path.join(outDir, `Session Switcher ${version || ''} (to share).zip`.replace(/\s+\(/, ' (').replace(/  +/g, ' '));
  const tmp = `${out}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, zip(entries));
  fs.renameSync(tmp, out);
  return { path: out, files: entries.length, bytes: fs.statSync(out).size, withPrompts: !!(prompts && prompts.length) };
}

module.exports = { makeShareCopy, appFiles, zip, crc32 };
