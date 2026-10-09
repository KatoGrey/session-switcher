'use strict';
// Worlds: each chat folder seen as a world, with its documents (patch notes, reviews, start-here
// docs) and its pictures (key art, banners, screenshots). Scans are shallow, capped and cached, and
// skip build and dependency folders, so even big projects stay quick.
//
// Also keeps the small per-world settings (the banner you picked) and the prompt book.

const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./store');

const SKIP = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt', '.cache', '.venv', 'venv', '__pycache__', 'vendor', 'target', 'bin', 'obj', '.idea', '.vscode', 'coverage', 'tmp', 'temp']);
const DOC_EXT = new Set(['.md', '.markdown', '.mdx']);
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const BANNER_NAME = /(cover|banner|key[-_ ]?art|keyart|hero|splash|title|poster|header|wallpaper|logo)/i;
const MAX_ENTRIES = 6000, MAX_DEPTH = 4, TTL = 30 * 1000;

function scanFolder(root, maxDepth = MAX_DEPTH) {
  const docs = [], images = [];
  let seen = 0;
  const queue = [[root, 0]];
  while (queue.length && seen < MAX_ENTRIES) {
    const [dir, depth] = queue.shift();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (++seen > MAX_ENTRIES) break;
      if (e.name.startsWith('.') && e.name !== '.claude') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < maxDepth && !SKIP.has(e.name.toLowerCase())) queue.push([p, depth + 1]); continue; }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!DOC_EXT.has(ext) && !IMG_EXT.has(ext)) continue;
      let st; try { st = fs.statSync(p); } catch { continue; }
      const item = { path: p, name: e.name, rel: path.relative(root, p), size: st.size, mtime: st.mtimeMs, depth };
      if (DOC_EXT.has(ext)) docs.push(item);
      else if (st.size >= 6 * 1024) images.push(item);
    }
  }
  docs.sort((a, b) => b.mtime - a.mtime);
  images.sort((a, b) => b.mtime - a.mtime);
  return { docs: docs.slice(0, 200), images: images.slice(0, 300), capped: seen >= MAX_ENTRIES };
}

// The picture that best stands for the world: one named like key art, else the biggest one near the top.
function autoBanner(images) {
  const named = images.filter(i => BANNER_NAME.test(i.name)).sort((a, b) => (a.depth - b.depth) || (b.size - a.size));
  if (named.length) return named[0].path;
  const near = images.filter(i => i.depth <= 2 && i.size >= 40 * 1024).sort((a, b) => b.size - a.size);
  return near.length ? near[0].path : null;
}

const DEFAULT_PROMPTS = [
  { id: 'balance', title: 'Balance pass', text: 'Do a balance pass on {world}. Check reputation caps, item and ability numbers, prices and rewards for anything out of line with the rest of the world. Change what needs changing, then list each change with the old value, the new value and why.' },
  { id: 'playtest', title: 'Playtest and review', text: 'Playtest the opening of {world} as a brand-new player, then as a returning one. Note anything confusing, broken, repetitive or out of character. Save the findings as {world}-REVIEW-{date}.md, most serious first, with how to reproduce each one.' },
  { id: 'patch', title: 'Write patch notes', text: 'Write player-facing patch notes for today’s changes to {world} and save them as PATCH-NOTES-{date}.md. Group them into New, Changed and Fixed, keep the tone of the world, and leave out internal details players don’t need.' },
  { id: 'npc', title: 'New NPC', text: 'Create a new NPC for {world}: name, role, faction, personality, a short voice sample, what they want, who they know, and where players meet them. Keep them consistent with the existing lore and characters, and tell me which files you added them to.' },
  { id: 'start', title: 'New story start', text: 'Write a new story start for {world}: the premise, where the player begins, the first scene, the first choice, and how it ties into existing factions and locations. Check it doesn’t contradict the current story starts.' },
  { id: 'lore', title: 'Lore consistency check', text: 'Read through {world}’s lore, characters, factions and locations and flag contradictions, dangling references and names that are spelled differently in different places. List each with the files involved and a suggested fix. Don’t change anything yet.' },
  { id: 'faction', title: 'Faction reputation tiers', text: 'For {world}, review every faction’s reputation tiers: the thresholds, what each tier unlocks, and how players move between them. Make the steps feel earned and consistent across factions, and summarize what you changed.' },
  { id: 'keyart', title: 'Key art (Codex)', provider: 'codex', text: 'Draw key art for {world}: a wide banner in the world’s own style that shows its tone, a recognizable location and a hint of its main conflict. Save it in this folder as key-art.png.' },
];

// Your user folder or a drive root isn't a world: look only at its top level, and never pick a banner by itself.
function isBroad(cwd) {
  const r = path.resolve(cwd);
  return r === path.resolve(os.homedir()) || path.parse(r).root === r;
}

function createWorlds({ dataDir, log = () => {} }) {
  const cache = new Map();
  const settingsFile = path.join(dataDir, 'worlds.json');
  const promptsFile = path.join(dataDir, 'prompts.json');
  let settings = store.loadOwnJson(settingsFile, {}, log) || {};

  function info(cwd, { maxAgeMs = TTL } = {}) {
    const hit = cache.get(cwd);
    let data = hit && Date.now() - hit.at < maxAgeMs ? hit.data : null;
    const broad = isBroad(cwd);
    if (!data) { data = scanFolder(cwd, broad ? 1 : MAX_DEPTH); cache.set(cwd, { at: Date.now(), data }); }
    const picked = settings[cwd] && settings[cwd].banner;
    const banner = picked && fs.existsSync(picked) ? picked : broad ? null : autoBanner(data.images);
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    return {
      cwd, banner, bannerPicked: !!(picked && banner === picked),
      docs: data.docs, images: data.images, capped: data.capped,
      today: { docs: data.docs.filter(d => d.mtime >= midnight.getTime()).length, images: data.images.filter(i => i.mtime >= midnight.getTime()).length },
    };
  }

  function setBanner(cwd, p) {
    settings[cwd] = { ...(settings[cwd] || {}), banner: p || null };
    if (!p) delete settings[cwd].banner;
    store.writeJsonAtomic(settingsFile, settings, { keepBackup: true });
    return info(cwd);
  }

  function prompts() {
    const saved = store.loadOwnJson(promptsFile, null, log);
    return Array.isArray(saved && saved.prompts) ? saved.prompts : DEFAULT_PROMPTS;
  }
  function savePrompts(list) {
    if (!Array.isArray(list) || list.length > 100) throw Object.assign(new Error('Too many prompts (100 at most).'), { status: 400 });
    const clean = list.map((p, i) => ({
      id: String(p.id || `p${Date.now()}${i}`).replace(/[^\w-]/g, '').slice(0, 40) || `p${i}`,
      title: String(p.title || '').trim().slice(0, 80),
      text: String(p.text || '').slice(0, 8000),
      ...(p.provider === 'codex' ? { provider: 'codex' } : {}),
    })).filter(p => p.title && p.text.trim());
    store.writeJsonAtomic(promptsFile, { prompts: clean }, { keepBackup: true });
    return clean;
  }
  function resetPrompts() { try { fs.unlinkSync(promptsFile); } catch { /* already default */ } return DEFAULT_PROMPTS; }

  return { info, setBanner, prompts, savePrompts, resetPrompts, forget: cwd => cache.delete(cwd) };
}

module.exports = { createWorlds, scanFolder, autoBanner, isBroad, DEFAULT_PROMPTS };
