'use strict';
// Updates on a Mac without Apple's signing: Apple's own update mechanism refuses an unsigned app, so
// the app does it itself. It downloads the new version's zip from the release, checks it against the
// release's checksum (latest-mac.yml), unpacks it with ditto, and when you restart, a small script
// waits for the app to close, swaps the new copy in place of the old one (keeping the old one until
// the new one is in), and opens it. Downloaded by the app (not a browser), it isn't quarantined, so it
// opens without "Open Anyway" again.
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const REPO = 'KatoGrey/session-switcher';

// GET with redirects (GitHub sends release files from another host); `onData` sees each chunk.
function get(url, { onData, json = false, hops = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'SessionSwitcher', Accept: json ? 'application/vnd.github+json' : '*/*' }, timeout: 30000 }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 6) { res.resume(); return resolve(get(new URL(res.headers.location, url).toString(), { onData, json, hops: hops + 1 })); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${url.split('/').pop()}: ${res.statusCode}`)); }
      const total = Number(res.headers['content-length']) || 0;
      const parts = []; let got = 0;
      res.on('data', d => { got += d.length; if (onData) onData(d, got, total); else parts.push(d); });
      res.on('end', () => { if (onData) return resolve(null); const b = Buffer.concat(parts); return resolve(json ? JSON.parse(b.toString('utf8')) : b); });
      res.on('error', reject);
      return undefined;
    });
    req.on('timeout', () => req.destroy(new Error('No answer from GitHub.')));
    req.on('error', reject);
  });
}

// The installed app bundle (/Applications/Session Switcher.app), from the running executable.
const bundleOf = exe => path.resolve(exe, '..', '..', '..');

// latest-mac.yml: each file's name and sha512 (base64), without a YAML parser.
function checksums(yml) {
  const out = {}; let url = null;
  for (const line of String(yml).split(/\r?\n/)) {
    const u = line.match(/^\s*-?\s*url:\s*(\S+)/); if (u) { url = u[1]; continue; }
    const s = line.match(/^\s*sha512:\s*(\S+)/); if (s && url) { out[url] = s[1]; url = null; }
  }
  return out;
}

// Downloads and unpacks `version`; returns { app } (the unpacked .app) when it's ready to swap in.
async function prepare({ version, release, arch = process.arch, onProgress = () => {}, log = () => {} }) {
  const want = new RegExp(`mac-${arch === 'arm64' ? 'arm64' : 'x64'}\\.zip$`);
  const asset = (release.assets || []).find(a => want.test(a.name));
  const yml = (release.assets || []).find(a => a.name === 'latest-mac.yml');
  if (!asset || !yml) throw new Error('This release has no Mac update.');
  const sums = checksums((await get(yml.browser_download_url)).toString('utf8'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-update-'));
  const zip = path.join(dir, asset.name);
  const out = fs.createWriteStream(zip);
  const hash = crypto.createHash('sha512');
  await get(asset.browser_download_url, { onData: (d, got, total) => { out.write(d); hash.update(d); if (total) onProgress(Math.round((got / total) * 100)); } });
  await new Promise(r => out.end(r));
  const sum = hash.digest('base64');
  if (sums[asset.name] && sums[asset.name] !== sum) throw new Error('The download didn’t match its checksum; not using it.');
  execFileSync('ditto', ['-x', '-k', zip, dir], { timeout: 120000 });
  const app = fs.readdirSync(dir).map(f => path.join(dir, f)).find(f => f.endsWith('.app'));
  if (!app) throw new Error('The download had no app in it.');
  try { execFileSync('xattr', ['-dr', 'com.apple.quarantine', app], { timeout: 30000 }); } catch { /* not quarantined */ }
  log(`Mac update ${version}: downloaded and checked (${asset.name}).`);
  return { app, dir };
}

// Can it replace itself here? Not from the disk image, nor without write access to its folder.
function canSwap(bundle) {
  if (!bundle.endsWith('.app') || bundle.startsWith('/Volumes/')) return false;
  try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); fs.accessSync(bundle, fs.constants.W_OK); return true; } catch { return false; }
}

// After this app quits: swap the new one in (the old one back if that fails), and open it.
function swapOnQuit({ app: fresh, dir }, bundle, pid) {
  const old = `${bundle}.old-${Date.now()}`;
  const q = s => `'${String(s).replace(/'/g, "'\\''")}'`;
  const script = [
    `while kill -0 ${pid} 2>/dev/null; do sleep 0.3; done`,
    `if mv ${q(bundle)} ${q(old)}; then`,
    `  if mv ${q(fresh)} ${q(bundle)}; then rm -rf ${q(old)}; else mv ${q(old)} ${q(bundle)}; fi`,
    'fi',
    `open ${q(bundle)}`,
    `rm -rf ${q(dir)}`,
  ].join('\n');
  spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' }).unref();
}

module.exports = { prepare, canSwap, swapOnQuit, bundleOf, checksums, REPO };
