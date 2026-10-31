'use strict';
// A site you've built, seen without starting anything: its folder served on this computer, read only, for
// the frame beside a chat. Only this app's page gets in: its first request carries a key, which becomes a
// cookie other sites never send here. A server for a folder goes when it hasn't been used for a while.

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { pipeline } = require('stream');

const IDLE = 30 * 60e3;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm', '.wasm': 'application/wasm', '.pdf': 'application/pdf',
};

function createSitePreview({ allowed = () => true, log = () => {}, idle = IDLE }) {
  const sites = new Map(), starting = new Map();   // folder -> { server, port, key, used }
  let round = 0;

  const say = (res, code, text) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(text); };
  function handler(site, root) {
    const realRoot = fs.realpathSync.native(root);
    return (req, res) => {
      site.used = Date.now();
      // Only as itself: another name for this address is how a web page reaches in (DNS rebinding).
      if (req.headers.host !== `127.0.0.1:${site.port}`) return say(res, 403, 'Not here.');
      if (req.method !== 'GET' && req.method !== 'HEAD') return say(res, 405, 'This only shows files.');
      let url;
      try { url = new URL(req.url, 'http://x'); } catch { return say(res, 400, 'That isn’t an address.'); }
      // Cookies don't keep to a port: each server has its own, or opening a second site would lock out the first.
      const cookieName = `ss_site_${site.port}=`;
      const cookie = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(cookieName));
      if (url.searchParams.get('k') === site.key) {
        // The first request: the key becomes a cookie, and it's gone from the address.
        url.searchParams.delete('k');
        res.writeHead(302, { 'Set-Cookie': `${cookieName}${site.key}; Path=/; HttpOnly; SameSite=Strict`, Location: `${url.pathname}${url.search}`, 'Cache-Control': 'no-store' });
        return res.end();
      }
      if (!cookie || cookie.slice(cookieName.length) !== site.key) return say(res, 403, 'Open this from Session Switcher.');
      let rel;
      try { rel = decodeURIComponent(url.pathname); } catch { return say(res, 400, 'That isn’t an address.'); }
      let abs = path.resolve(root, `.${rel}`);
      const inside = p => { const r = path.relative(realRoot, p); return !r.startsWith('..') && !path.isAbsolute(r); };
      if (!inside(path.resolve(realRoot, path.relative(root, abs))) || !allowed(abs, root)) return say(res, 403, 'That’s private.');
      let st, fd = null;
      try {
        st = fs.statSync(abs, { bigint: true });
        if (st.isDirectory()) { abs = path.join(abs, 'index.html'); st = fs.statSync(abs, { bigint: true }); }
        if (!st.isFile() || !inside(fs.realpathSync.native(abs)) || !allowed(abs, root)) return say(res, 403, 'That’s private.');
        // The file that was just checked, not whatever's at its name by now; and what's promised is what's sent.
        fd = fs.openSync(abs, 'r');
        const opened = fs.fstatSync(fd, { bigint: true });
        if (opened.ino !== st.ino || opened.dev !== st.dev) { fs.closeSync(fd); return say(res, 403, 'That’s private.'); }
        st = opened;
      } catch {
        if (fd !== null) try { fs.closeSync(fd); } catch { /* gone */ }
        return say(res, 404, 'There’s no such file in this folder.');
      }
      const size = Number(st.size);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'Content-Length': size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      if (req.method === 'HEAD' || !size) { fs.closeSync(fd); return res.end(); }
      // pipeline lets go of the file if the page stops reading (a locked file, on Windows, otherwise).
      return pipeline(fs.createReadStream(null, { fd, start: 0, end: size - 1 }), res, () => {});
    };
  }
  function stop(root) {
    const s = sites.get(root); if (!s) return;
    sites.delete(root);
    try { s.server.close(); if (s.server.closeAllConnections) s.server.closeAllConnections(); } catch { /* gone */ }
  }
  const sweeper = setInterval(() => { for (const [root, s] of sites) if (Date.now() - s.used > idle) { log(`Stopped showing ${root}.`); stop(root); } }, Math.min(idle, 60e3));
  if (sweeper.unref) sweeper.unref();

  // One server a folder, however many ask at once.
  function start(root) {
    const had = sites.get(root);
    if (had) { had.used = Date.now(); return Promise.resolve(had); }
    if (starting.has(root)) return starting.get(root);
    const asked = round;
    const going = (async () => {
      const site = { key: crypto.randomBytes(16).toString('hex'), used: Date.now(), port: 0, server: null };
      site.server = http.createServer(handler(site, root));
      await new Promise((res, rej) => { site.server.once('error', rej); site.server.listen(0, '127.0.0.1', res); });
      site.server.unref();
      site.port = site.server.address().port;
      if (asked !== round) { site.server.close(); throw new Error('Stopped showing it.'); }
      sites.set(root, site);
      return site;
    })().finally(() => starting.delete(root));
    starting.set(root, going);
    return going;
  }
  // The address of this file, for the page that asked (it carries the key once).
  async function urlFor(file) {
    const abs = path.resolve(file), site = await start(path.dirname(abs));
    return `http://127.0.0.1:${site.port}/${encodeURIComponent(path.basename(abs))}?k=${site.key}`;
  }
  return { urlFor, stopAll: () => { round++; for (const root of [...sites.keys()]) stop(root); clearInterval(sweeper); }, size: () => sites.size };
}

module.exports = { createSitePreview };
