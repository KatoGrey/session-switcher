'use strict';
// Images by Codex (GPT Image), for Switcher Lite: every picture Codex has generated, and asking for
// new ones from anywhere. Codex keeps each picture in <CODEX_HOME>/generated_images/<thread id>/,
// so a picture leads back to the chat that made it.
//
// Generating runs `codex exec` on the ChatGPT plan that's next in the use-next order. Any chat can
// ask for pictures through bin/switcher-image.js, which calls this through the running app.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const { spawnWin } = require('./lite-spawn');

const IMG = /^[\w.-]{1,120}\.(png|jpe?g|webp)$/i;
const THREAD = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createLiteImages({ dataDir, log = () => {}, mainHome, homeFor, codexCommand = () => 'codex' }) {
  const root = () => path.join(mainHome(), 'generated_images');
  const THUMBS = path.join(dataDir, 'lite-thumbs');

  // Every generated picture, newest first.
  function list({ limit = 400 } = {}) {
    const out = [];
    let dirs = [];
    try { dirs = fs.readdirSync(root(), { withFileTypes: true }).filter(d => d.isDirectory() && THREAD.test(d.name)); } catch { return []; }
    for (const d of dirs) {
      let files = [];
      try { files = fs.readdirSync(path.join(root(), d.name)).filter(f => IMG.test(f)); } catch { continue; }
      for (const f of files) {
        try { const st = fs.statSync(path.join(root(), d.name, f)); out.push({ thread: d.name, file: f, at: st.mtimeMs, kb: Math.round(st.size / 1024) }); } catch { /* gone */ }
      }
    }
    return out.sort((a, b) => b.at - a.at).slice(0, limit);
  }
  // The picture's path, only inside generated_images, never through a link elsewhere.
  function fileFor(thread, file) {
    if (!THREAD.test(String(thread)) || !IMG.test(String(file))) return null;
    const p = path.join(root(), thread, file);
    try { const real = fs.realpathSync(p); return real.startsWith(fs.realpathSync(root()) + path.sep) ? real : null; } catch { return null; }
  }
  // A small JPEG for the gallery, made once with macOS's sips (the original where that's not possible).
  // sips runs alongside the server, three at a time, never in its way: thumbFor answers at once (the
  // original while its thumbnail is still being made), thumbReady waits for it, and warm makes the
  // gallery's missing ones before the page asks for them.
  const thumbPath = (thread, file) => path.join(THUMBS, `${thread}-${file.replace(/\.\w+$/, '')}.jpg`);
  const making = new Map();   // thumbnail -> promise of the file to send
  let sipsBusy = 0; const sipsWaiting = [];
  function makeThumb(src, out) {
    if (making.has(out)) return making.get(out);
    const p = new Promise(resolve => {
      const go = () => {
        sipsBusy++;
        try { fs.mkdirSync(THUMBS, { recursive: true }); } catch { /* sips says so below */ }
        cp.execFile('sips', ['-Z', '480', '-s', 'format', 'jpeg', '-s', 'formatOptions', '72', src, '--out', out], { timeout: 20000 }, err => {
          sipsBusy--; const next = sipsWaiting.shift(); if (next) next();
          resolve(!err && fs.existsSync(out) ? out : src);
        });
      };
      if (sipsBusy < 3) go(); else sipsWaiting.push(go);
    }).finally(() => making.delete(out));
    making.set(out, p);
    return p;
  }
  function thumbFor(thread, file) {
    const src = fileFor(thread, file); if (!src) return null;
    const out = thumbPath(thread, file);
    if (fs.existsSync(out)) return out;
    if (process.platform !== 'darwin') return src;
    makeThumb(src, out);
    return src;
  }
  async function thumbReady(thread, file) {
    const src = fileFor(thread, file); if (!src) return null;
    const out = thumbPath(thread, file);
    if (fs.existsSync(out)) return out;
    return process.platform === 'darwin' ? makeThumb(src, out) : src;
  }
  // The gallery shows the newest 120 first: those are made first (the list doesn't wait; each picture
  // waits for its own thumbnail), the rest after.
  function warm(list, { first = 120, ms = 15000 } = {}) {
    if (process.platform !== 'darwin') return Promise.resolve();
    const wait = [];
    (list || []).forEach((im, i) => {
      const out = thumbPath(im.thread, im.file); if (fs.existsSync(out)) return;
      const src = fileFor(im.thread, im.file); if (!src) return;
      const p = makeThumb(src, out); if (i < first) wait.push(p);
    });
    if (!wait.length) return Promise.resolve();
    let t; return Promise.race([Promise.all(wait), new Promise(r => { t = setTimeout(r, ms); })]).finally(() => clearTimeout(t));
  }

  /* ----- generating ----- */
  const jobs = new Map();
  function generate({ prompt, n = 1, cwd = null, account = null, accountName = null, out = null }) {
    const text = String(prompt || '').trim().slice(0, 4000);
    if (!text) throw Object.assign(new Error('Say what to draw.'), { status: 400 });
    const count = Math.max(1, Math.min(4, Math.round(Number(n) || 1)));
    const dir = cwd && fs.existsSync(cwd) ? cwd : dataDir;
    const outDir = out ? path.resolve(String(out)) : null;
    const id = `img-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
    const job = { id, prompt: text, n: count, state: 'working', startedAt: Date.now(), account: accountName || account || 'Codex', thread: null, images: [], error: null };
    jobs.set(id, job);
    const ask = `Use your image generation tool to make ${count === 1 ? 'one image' : `${count} separate images (variations)`} of the following. Don't write or change any files and don't run commands; just generate ${count === 1 ? 'it' : 'them'}, then reply with one short line.\n\n${text}`;
    const env = { ...process.env };
    const home = account && homeFor ? homeFor(account) : null;
    if (home) env.CODEX_HOME = home;
    const args = ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', dir];
    // Windows: codex is usually npm's codex.cmd, which needs lib/lite-spawn.js, and the request goes
    // on stdin ("-"), clear of cmd.exe and the command line's length limit.
    const win = process.platform === 'win32';
    let p;
    if (win) {
      try { p = spawnWin(codexCommand(), [...args, '-'], { env, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (err) { job.state = 'failed'; job.error = err.message; job.doneAt = Date.now(); return job; }
      p.stdin.on('error', () => {}); p.stdin.end(ask);
    } else p = cp.spawn(codexCommand(), [...args, ask], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '', errTail = '';
    p.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try { const ev = JSON.parse(line); if (ev.thread_id && !job.thread) job.thread = ev.thread_id; if (ev.type === 'thread.started' && ev.thread_id) job.thread = ev.thread_id; } catch { /* not JSON */ }
      }
    });
    p.stderr.on('data', d => { errTail = (errTail + d).slice(-2000); });
    p.on('error', err => { job.state = 'failed'; job.error = err.message; });
    p.on('close', code => {
      const found = job.thread ? list({ limit: 4000 }).filter(x => x.thread === job.thread) : list({ limit: 50 }).filter(x => x.at >= job.startedAt);
      job.images = found.map(x => ({ thread: x.thread, file: x.file }));
      if (outDir && job.images.length) {
        try { fs.mkdirSync(outDir, { recursive: true }); job.saved = job.images.map((x, k) => { const to = path.join(outDir, `${(job.prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)) || 'image'}-${k + 1}${path.extname(x.file)}`); fs.copyFileSync(fileFor(x.thread, x.file), to); return to; }); } catch (err) { job.error = `Made it, but couldn’t copy it to ${outDir}: ${err.message}`; }
      }
      job.state = job.images.length ? 'done' : 'failed';
      if (!job.images.length && !job.error) job.error = code ? (errTail.trim().split('\n').pop() || `Codex exited (${code}).`) : 'Codex didn’t make a picture.';
      job.doneAt = Date.now();
      log(`Lite: image job ${id}: ${job.state} (${job.images.length} picture${job.images.length === 1 ? '' : 's'})`);
    });
    return job;
  }
  const jobView = () => [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 20);
  const job = id => jobs.get(id) || null;

  return { list, fileFor, thumbFor, thumbReady, warm, generate, jobs: jobView, job };
}

module.exports = { createLiteImages };
