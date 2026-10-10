#!/usr/bin/env node
// Asks the running Session Switcher to have Codex draw pictures (GPT Image), on the ChatGPT plan
// that's next in the use-next order, and copies them where you say. Any chat (Claude or Codex) can
// run it from its shell:
//
//   node bin/switcher-image.js "Key art for a cozy space-tavern game, wide, no text" --n 2 --out ./art
//
// Prints one saved path per line. Every picture also shows on Switcher Lite's Images page.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(`--${name}`); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const n = Number(opt('n', 1));
const out = path.resolve(opt('out', '.'));
const port = Number(opt('port', process.env.SWITCHER_PORT || 4777));
const prompt = args.join(' ').trim();
if (!prompt) { console.error('Usage: switcher-image.js "what to draw" [--n 1-4] [--out folder]'); process.exit(2); }

let lock;
try { lock = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `session-switcher-${port}.json`), 'utf8')); } catch { console.error(`Session Switcher isn’t running on port ${port}.`); process.exit(1); }

const call = (method, p, body) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { Host: `127.0.0.1:${port}`, 'X-Switcher-Token': lock.token, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
    let s = ''; res.setEncoding('utf8'); res.on('data', d => { s += d; });
    res.on('end', () => { let j; try { j = JSON.parse(s); } catch { j = { error: s }; } if (res.statusCode >= 400) reject(new Error(j.error || `HTTP ${res.statusCode}`)); else resolve(j); });
  });
  req.on('error', reject);
  if (data) req.write(data);
  req.end();
});

(async () => {
  const { job } = await call('POST', '/api/lite/images/generate', { prompt, n, out, cwd: process.cwd() });
  console.error(`Codex is drawing on ${job.account}…`);
  for (;;) {
    await new Promise(r => setTimeout(r, 3000));
    const j = (await call('GET', `/api/lite/images/job?id=${encodeURIComponent(job.id)}`)).job;
    if (j.state === 'working') continue;
    if (j.state !== 'done') { console.error(j.error || 'It didn’t work.'); process.exit(1); }
    for (const p of j.saved || []) console.log(p);
    if (j.error) console.error(j.error);
    return;
  }
})().catch(err => { console.error(err.message); process.exit(1); });
