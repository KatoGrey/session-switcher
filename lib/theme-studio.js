'use strict';
// Theme Studio owns one private directory. Generated JSON is data, never CSS, HTML or code.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { audit } = require('../theme');
const ID = /^custom-[a-f0-9]{24}$/;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const FONT_SETS = {
  clear: { display: '"Barlow Condensed", sans-serif', body: '"Inter", system-ui, sans-serif', caps: '"Inter", sans-serif', label: '"Inter", sans-serif' },
  storybook: { display: '"Cinzel", serif', body: '"EB Garamond", Georgia, serif', caps: '"EB Garamond", Georgia, serif', label: '"Inter", sans-serif' },
  rounded: { display: '"M PLUS Rounded 1c", sans-serif', body: '"Nunito", system-ui, sans-serif', caps: '"Nunito", sans-serif', label: '"Nunito", sans-serif' },
};
const COPY = ['Welcome back', 'The hub', 'Your projects', 'Recent chats', 'All quiet.', 'Pick up any chat below.', 'Claude & Codex, every chat and account in one place'];
function text(v, max, fallback = '') { return typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : fallback; }
function normalize(raw, id) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !ID.test(id)) throw fail('The theme description is not valid.');
  const seeds = raw.seeds || raw;
  const t = { id, family: 'custom', art: 'painting', name: text(raw.name, 48, 'My world') || 'My world', note: text(raw.note, 180), font: Object.hasOwn(FONT_SETS, raw.font) ? raw.font : 'clear', copy: {} };
  for (const [key, fallback, max] of [['accent', 190, 360], ['sat', 1, 1.5], ['gold', 42, 360], ['goldSat', 1, 1.5], ['surface', 220, 360], ['surfSat', .6, 1.5], ['ink', 210, 360], ['inkSat', .5, 1], ['codex', 275, 360]]) {
    const v = seeds[key] === undefined ? fallback : seeds[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw fail(`The theme's ${key} must be a number.`);
    t[key] = Math.max(0, Math.min(max, v));
  }
  t.fonts = FONT_SETS[t.font];
  for (const k of COPY) if (raw.copy && typeof raw.copy[k] === 'string') t.copy[k] = text(raw.copy[k], 120);
  t.paint = { dark: 'dark', light: 'light' };
  t.readability = audit(t);
  if (Object.values(t.readability).some(r => r.faint < 4.5 || r.body < 7 || r.buttons < 4.5)) throw fail('This palette needs more contrast.');
  return t;
}
function createStudio(dataDir) {
  const root = path.join(dataDir, 'theme-studio');
  fs.mkdirSync(root, { recursive: true });
  if (fs.lstatSync(root).isSymbolicLink()) throw fail('Theme files cannot be links.');
  for (const kind of ['jobs', 'themes']) {
    const dir = path.join(root, kind); fs.mkdirSync(dir, { recursive: true });
    if (fs.lstatSync(dir).isSymbolicLink()) throw fail('Theme files cannot be links.');
  }
  // Check each component, including directories: links must never let an art URL leave this store.
  function safe(...parts) {
    let p = root;
    for (const part of ['', ...parts]) {
      if (part && (!/^[a-z0-9.-]+$/.test(part) || part === '.' || part === '..')) throw fail('Invalid theme path.');
      if (part) p = path.join(p, part);
      try { if (fs.lstatSync(p).isSymbolicLink()) throw fail('Theme files cannot be links.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    return p;
  }
  const folder = (kind, id) => { if (!['jobs', 'themes'].includes(kind) || !ID.test(id)) throw fail('Unknown theme.'); return safe(kind, id); };
  function bytes(kind, id, name, limit) {
    folder(kind, id);
    const file = safe(kind, id, name), st = fs.lstatSync(file);
    if (!st.isFile() || st.size < 1 || st.size > limit) throw fail('The theme file is empty or too large.');
    return fs.readFileSync(file);
  }
  const json = (kind, id, name) => JSON.parse(bytes(kind, id, name, 20000).toString('utf8'));
  function atomic(kind, id, name, data) {
    const temp = safe(kind, id, name + '.tmp');
    fs.writeFileSync(temp, data); fs.renameSync(temp, safe(kind, id, name));
  }
  function ids(kind) { return fs.readdirSync(safe(kind)).filter(n => ID.test(n)); }
  function list() {
    const themes = [], jobs = [];
    for (const id of ids('themes')) { try { themes.push(normalize(json('themes', id, 'theme.json'), id)); } catch { /* incomplete/corrupt theme */ } }
    for (const id of ids('jobs')) {
      try {
        const j = json('jobs', id, 'job.json');
        if (j.dismissed || themes.some(t => t.id === id)) continue;
        const ready = ['theme.json', 'dark.png', 'light.png'].every(n => fs.existsSync(safe('jobs', id, n)));
        jobs.push({ id, name: text(j.name, 48), description: text(j.description, 1500), at: j.at, ready });
      } catch { /* corrupt job */ }
    }
    return { themes, jobs: jobs.sort((a, b) => b.at - a.at), fonts: Object.keys(FONT_SETS) };
  }
  function prompt(j) {
    return `Create a finished Theme Studio world for Session Switcher. This folder is an isolated art workspace. Do not edit application code.\n\nWorld: ${JSON.stringify(j.description)}\nName: ${JSON.stringify(j.name)}\nFont set: ${j.font}\n\nUse image generation to paint TWO coordinated 1536×1024 PNG backgrounds: dark.png (evening/night) and light.png (day/morning). Beautiful hand-painted environment art, coherent visual identity, restrained detail, no text, logos, frames, interface, people or creatures. Quiet left 35% for a headline; main subject on the right. Keep important features within the middle 65% vertically for phones. Preserve the same layout in both modes. Do not overwrite existing pictures. If image generation is unavailable, explain that and stop; do not create placeholders.\n\nAfter both images are finished, derive a restrained colour palette from the paintings. Write theme.json LAST as plain JSON, using this schema:\n${JSON.stringify({ name: j.name, note: 'One short sentence describing this world.', font: j.font, seeds: { accent: 190, sat: 1, gold: 42, goldSat: 1, surface: 220, surfSat: .6, ink: 210, inkSat: .5, codex: 275 }, copy: { 'Welcome back': 'A short welcoming greeting', 'All quiet.': 'A quiet themed phrase' } }, null, 2)}\n\nHue numbers range from 0 to 360, strengths from 0 to 1.5 (inkSat at most 1). Choose from fonts clear, storybook, rounded. Only these optional wording keys are supported: ${COPY.join('; ')}. Keep action labels understandable. Theme Studio adjusts text contrast, compresses the pictures, and lets the user preview before saving. Show both paintings and report when all three files are saved.`;
  }
  function create(body) {
    if (ids('jobs').length >= 100) throw fail('The studio has 100 drafts. Remove old draft folders from the data folder before creating more.');
    const description = text(body.description, 1500); if (!description) throw fail('Describe the world you want.');
    const id = 'custom-' + crypto.randomBytes(12).toString('hex');
    const j = { id, name: text(body.name, 48, 'My world') || 'My world', description, font: Object.hasOwn(FONT_SETS, body.font) ? body.font : 'clear', at: Date.now() };
    fs.mkdirSync(folder('jobs', id)); atomic('jobs', id, 'job.json', JSON.stringify(j));
    return { ...j, cwd: folder('jobs', id), prompt: prompt(j) };
  }
  function job(id) { const j = json('jobs', id, 'job.json'); return { ...j, cwd: folder('jobs', id), prompt: prompt(j) }; }
  function png(id, mode) {
    const b = bytes('jobs', id, `${mode}.png`, 25 * 1024 * 1024);
    if (b.length < 33 || b.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || b.toString('ascii', 12, 16) !== 'IHDR') throw fail('The painting must be a real PNG.');
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    if (w < 640 || h < 400 || w > 8192 || h > 8192 || w * h > 32e6) throw fail('The painting must be at least 640×400 and no larger than 32 megapixels.');
    return b;
  }
  function result(id) {
    try {
      job(id);
      const spec = bytes('jobs', id, 'theme.json', 20000), dark = png(id, 'dark'), light = png(id, 'light');
      return { theme: normalize(JSON.parse(spec.toString('utf8')), id), revision: crypto.createHash('sha256').update(spec).update(dark).update(light).digest('hex') };
    } catch (e) {
      if (e.code === 'ENOENT' || e instanceof SyntaxError) throw fail('The draft is not complete yet. Ask Codex to finish both paintings and write valid theme.json, then review it again.');
      throw e;
    }
  }
  function webp(data) {
    if (typeof data !== 'string' || data.length > 2800000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw fail('The compressed painting is too large or invalid.');
    const b = Buffer.from(data, 'base64');
    if (b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP' || b.readUInt32LE(4) + 8 !== b.length) throw fail('The painting must be WebP.');
    // Canvas produces VP8 or VP8L; alpha may be carried by a VP8X wrapper.
    const tag = b.toString('ascii', 12, 16); let w, h;
    if (tag === 'VP8X' && !(b[20] & 2)) { w = 1 + b.readUIntLE(24, 3); h = 1 + b.readUIntLE(27, 3); }
    else if (tag === 'VP8 ' && b.subarray(23, 26).toString('hex') === '9d012a') { w = b.readUInt16LE(26) & 16383; h = b.readUInt16LE(28) & 16383; }
    else if (tag === 'VP8L' && b[20] === 47) { const n = b.readUInt32LE(21); w = 1 + (n & 16383); h = 1 + ((n >>> 14) & 16383); }
    if (!w || !h || w > 1600 || h > 1200 || w * h > 1920000) throw fail('The compressed painting has invalid dimensions.');
    return b;
  }
  function save(body) {
    const r = result(body.id); if (r.revision !== body.revision) throw fail('The paintings changed while you were previewing. Review them again.', 409);
    if (fs.existsSync(folder('themes', body.id))) throw fail('This theme is already saved.', 409);
    if (ids('themes').length >= 64) throw fail('The library is full. Delete a theme before saving another.');
    const dark = webp(body.dark), light = webp(body.light);
    const dir = folder('themes', body.id); fs.mkdirSync(dir);
    try {
      atomic('themes', body.id, 'dark.webp', dark); atomic('themes', body.id, 'light.webp', light);
      atomic('themes', body.id, 'theme.json', JSON.stringify(r.theme));
    } catch (e) { for (const n of ['dark.webp', 'light.webp', 'theme.json', 'dark.webp.tmp', 'light.webp.tmp', 'theme.json.tmp']) { try { fs.unlinkSync(safe('themes', body.id, n)); } catch {} } fs.rmdirSync(dir); throw e; }
    return r.theme;
  }
  function dismiss(id) { const j = job(id); atomic('jobs', id, 'job.json', JSON.stringify({ id, name: j.name, description: j.description, font: j.font, at: j.at, dismissed: true })); }
  function remove(id) {
    // Only the three files we wrote. A running art chat's source workspace is preserved.
    const dir = folder('themes', id);
    for (const n of ['theme.json', 'dark.webp', 'light.webp']) { try { fs.unlinkSync(safe('themes', id, n)); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
    try { fs.rmdirSync(dir); } catch (e) { if (!['ENOENT', 'ENOTEMPTY'].includes(e.code)) throw e; }
    dismiss(id);
  }
  function asset(kind, id, mode) {
    if (!['dark', 'light'].includes(mode)) throw fail('Unknown painting.');
    return kind === 'jobs' ? { bytes: png(id, mode), type: 'image/png' } : kind === 'themes' ? { bytes: bytes(kind, id, `${mode}.webp`, 2100000), type: 'image/webp' } : (() => { throw fail('Unknown painting.'); })();
  }
  function project(cwd) {
    if (typeof cwd !== 'string') return null;
    try {
      const id = path.basename(cwd); if (!ID.test(id) || path.resolve(cwd) !== folder('jobs', id)) return null;
      const j = job(id); return { cwd: j.cwd, name: text(j.name, 48, 'Theme Studio'), exists: true };
    } catch { return null; }
  }
  return { list, create, job, result, save, dismiss, remove, asset, project };
}
module.exports = { createStudio, normalize, FONT_SETS };
