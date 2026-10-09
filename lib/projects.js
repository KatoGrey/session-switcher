'use strict';
// Projects: every folder you work in, seen as a project with its documents (notes, reviews,
// release notes) and pictures (cover art, screenshots). Scans are shallow, capped and cached, and
// skip build and dependency folders, so even big projects stay quick.
//
// Also keeps:
//   projects.json  folders you created or added here, before they have any chats
//   banners.json   the banner picture you chose for a project (was worlds.json)
//   prompts.json   your prompts, once you edit them

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

// The picture that best stands for the project: one named like cover art, else the biggest one near the top.
function autoBanner(images) {
  const named = images.filter(i => BANNER_NAME.test(i.name)).sort((a, b) => (a.depth - b.depth) || (b.size - a.size));
  if (named.length) return named[0].path;
  const near = images.filter(i => i.depth <= 2 && i.size >= 40 * 1024).sort((a, b) => b.size - a.size);
  return near.length ? near[0].path : null;
}

// Your user folder or a drive root isn't a project: look only at its top level, and never pick a banner by itself.
function isBroad(cwd) {
  const r = path.resolve(cwd);
  return r === path.resolve(os.homedir()) || path.parse(r).root === r;
}

/* ---------- names for new folders ---------- */
function checkName(name) {
  const n = String(name || '').trim();
  if (!n) return 'Give the project a name.';
  if (n.length > 80) return 'Keep the name under 80 characters.';
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(n)) return 'A folder name can’t contain < > : " / \\ | ? or *.';
  if (/[. ]$/.test(n)) return 'A folder name can’t end with a dot or a space.';
  if (/^\.+$/.test(n)) return 'Pick a name with letters or numbers in it.';
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) return `Windows keeps the name “${n}” for itself. Pick another.`;
  return null;
}

/* ---------- prompts ---------- */
// {project} becomes the folder's name and {date} today's date. Text in other {braces} is a blank
// to fill in: the message box selects it so you can type over it.
const PROMPT_SETS = {
  general: {
    title: 'General',
    prompts: [
      { id: 'tour', title: 'Get oriented', text: 'Read through {project} and give me a short tour: what it is, how it’s organized, how to run it, and anything that looks broken or unfinished. Don’t change anything yet.' },
      { id: 'bug', title: 'Fix a bug', text: 'There’s a bug in {project}: {describe what goes wrong}. Find the cause, fix it, and tell me how you checked the fix.' },
      { id: 'plan', title: 'Plan a change', text: 'Help me plan {describe the change} for {project}: the approach, the files involved, the risks, and a short step-by-step plan. Don’t change anything until I agree.' },
      { id: 'review', title: 'Review today’s changes', text: 'Review today’s changes to {project} for bugs, risky edits and anything inconsistent with the rest of it. List what you find, most serious first. Don’t change anything yet.' },
      { id: 'notes', title: 'Write release notes', text: 'Write release notes for today’s changes to {project} and save them as RELEASE-NOTES-{date}.md. Group them into New, Changed and Fixed, and leave out internal details readers don’t need.' },
      { id: 'readme', title: 'Write the README', text: 'Write or update the README for {project}: what it is, how to set it up, how to use it, and where things live. Keep it short and accurate to what’s actually here.' },
      { id: 'tests', title: 'Add tests', text: 'Find the most important behaviour in {project} that isn’t tested yet, add tests for it, run them, and fix anything they catch.' },
      { id: 'cover', title: 'Cover image (Codex)', provider: 'codex', text: 'Make a wide cover image for {project} that fits what it is and its style. Save it in this folder as cover.png.' },
    ],
  },
  fiction: {
    title: 'Interactive fiction and games',
    prompts: [
      { id: 'balance', title: 'Balance pass', text: 'Do a balance pass on {project}. Check reputation caps, item and ability numbers, prices and rewards for anything out of line with the rest of the world. Change what needs changing, then list each change with the old value, the new value and why.' },
      { id: 'playtest', title: 'Playtest and review', text: 'Playtest the opening of {project} as a brand-new player, then as a returning one. Note anything confusing, broken, repetitive or out of character. Save the findings as {project}-REVIEW-{date}.md, most serious first, with how to reproduce each one.' },
      { id: 'patch', title: 'Write patch notes', text: 'Write player-facing patch notes for today’s changes to {project} and save them as PATCH-NOTES-{date}.md. Group them into New, Changed and Fixed, keep the tone of the world, and leave out internal details players don’t need.' },
      { id: 'npc', title: 'New NPC', text: 'Create a new NPC for {project}: name, role, faction, personality, a short voice sample, what they want, who they know, and where players meet them. Keep them consistent with the existing lore and characters, and tell me which files you added them to.' },
      { id: 'start', title: 'New story start', text: 'Write a new story start for {project}: the premise, where the player begins, the first scene, the first choice, and how it ties into existing factions and locations. Check it doesn’t contradict the current story starts.' },
      { id: 'lore', title: 'Lore consistency check', text: 'Read through {project}’s lore, characters, factions and locations and flag contradictions, dangling references and names that are spelled differently in different places. List each with the files involved and a suggested fix. Don’t change anything yet.' },
      { id: 'faction', title: 'Faction reputation tiers', text: 'For {project}, review every faction’s reputation tiers: the thresholds, what each tier unlocks, and how players move between them. Make the steps feel earned and consistent across factions, and summarize what you changed.' },
      { id: 'keyart', title: 'Key art (Codex)', provider: 'codex', text: 'Draw key art for {project}: a wide banner in the world’s own style that shows its tone, a recognizable location and a hint of its main conflict. Save it in this folder as key-art.png.' },
    ],
  },
};
const DEFAULT_PROMPTS = PROMPT_SETS.general.prompts;
const cleanPrompt = (p, i) => ({
  id: String(p.id || `p${Date.now()}${i}`).replace(/[^\w-]/g, '').slice(0, 40) || `p${i}`,
  title: String(p.title || '').trim().slice(0, 80),
  text: String(p.text || '').slice(0, 8000),
  ...(p.provider === 'codex' ? { provider: 'codex' } : {}),
});

function createProjects({ dataDir, log = () => {} }) {
  const cache = new Map();
  const bannersFile = path.join(dataDir, 'banners.json');
  const legacyFile = path.join(dataDir, 'worlds.json');
  const promptsFile = path.join(dataDir, 'prompts.json');
  const projectsFile = path.join(dataDir, 'projects.json');

  // 4.2 kept banners in worlds.json, and its starter prompts were the interactive-fiction set.
  // Keep both for anyone updating from it.
  if (!fs.existsSync(bannersFile) && fs.existsSync(legacyFile)) {
    try {
      fs.copyFileSync(legacyFile, bannersFile);
      if (!fs.existsSync(promptsFile)) store.writeJsonAtomic(promptsFile, { prompts: PROMPT_SETS.fiction.prompts });
      log('Moved your banner picks from worlds.json to banners.json and kept your interactive-fiction prompts.');
    } catch (err) { log(`Couldn’t move worlds.json: ${err.message}`); }
  }
  let banners = store.loadOwnJson(bannersFile, {}, log) || {};
  let reg = store.loadOwnJson(projectsFile, { added: [] }, log) || { added: [] };
  if (!Array.isArray(reg.added)) reg.added = [];

  function info(cwd, { maxAgeMs = TTL } = {}) {
    const hit = cache.get(cwd);
    let data = hit && Date.now() - hit.at < maxAgeMs ? hit.data : null;
    const broad = isBroad(cwd);
    if (!data) { data = scanFolder(cwd, broad ? 1 : MAX_DEPTH); cache.set(cwd, { at: Date.now(), data }); }
    const picked = banners[cwd] && banners[cwd].banner;
    const banner = picked && fs.existsSync(picked) ? picked : broad ? null : autoBanner(data.images);
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    return {
      cwd, banner, bannerPicked: !!(picked && banner === picked),
      docs: data.docs, images: data.images, capped: data.capped,
      today: { docs: data.docs.filter(d => d.mtime >= midnight.getTime()).length, images: data.images.filter(i => i.mtime >= midnight.getTime()).length },
    };
  }

  function setBanner(cwd, p) {
    banners[cwd] = { ...(banners[cwd] || {}), banner: p || null };
    if (!p) delete banners[cwd].banner;
    store.writeJsonAtomic(bannersFile, banners, { keepBackup: true });
    return info(cwd);
  }

  /* ---------- folders added here ---------- */
  const saveReg = () => store.writeJsonAtomic(projectsFile, reg, { keepBackup: true });
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  const added = () => reg.added.map(x => ({ ...x, exists: fs.existsSync(x.cwd) }));
  function remember(cwd, how) {
    if (!reg.added.some(x => same(x.cwd, cwd))) reg.added.unshift({ cwd, created: Date.now(), how });
    reg.lastParent = path.dirname(cwd);
    saveReg();
  }
  // Makes <parent>/<name>, or with existing: true, adds a folder you already have.
  function create({ parent, name, existing = null, useExisting = false }) {
    const fail = (status, message, reason) => Object.assign(new Error(message), { status, reason });
    const full = (raw, what) => {
      const t = String(raw || '').trim().replace(/^["']|["']$/g, '').replace(/^~(?=$|[\\/])/, os.homedir());
      if (!path.isAbsolute(t)) throw fail(400, `Type the full path to the ${what}, like ${path.join(os.homedir(), 'Projects')}.`);
      return path.resolve(t);
    };
    let cwd;
    if (existing) {
      cwd = full(existing, 'folder');
      const st = store.statOrNull(cwd);
      if (!st) throw fail(404, `There’s no folder at ${cwd}.`);
      if (!st.isDirectory()) throw fail(400, `${cwd} is a file, not a folder.`);
      if (path.parse(cwd).root === cwd) throw fail(400, 'Pick a folder, not a whole drive.');
      remember(cwd, 'added');
      return { cwd, name: path.basename(cwd), created: false };
    }
    const why = checkName(name);
    if (why) throw fail(400, why);
    const base = String(parent || '').trim() ? full(parent, 'location') : os.homedir();
    const pst = store.statOrNull(base);
    if (!pst || !pst.isDirectory()) throw fail(404, `There’s no folder at ${base}. Pick a location that exists.`);
    cwd = path.join(base, String(name).trim());
    const st = store.statOrNull(cwd);
    if (st && !st.isDirectory()) throw fail(409, `There’s already a file called “${path.basename(cwd)}” there.`);
    if (st && !useExisting) throw fail(409, `${cwd} already exists.`, 'exists');
    if (!st) {
      try { fs.mkdirSync(cwd); } catch (err) { throw fail(err.code === 'EACCES' || err.code === 'EPERM' ? 403 : 500, `Couldn’t create ${cwd}: ${err.code === 'EACCES' || err.code === 'EPERM' ? 'Windows doesn’t allow writing there. Pick another location.' : err.message}`); }
    }
    remember(cwd, st ? 'added' : 'created');
    return { cwd, name: path.basename(cwd), created: !st };
  }
  function forget(cwd) {
    const n = reg.added.length;
    reg.added = reg.added.filter(x => !same(x.cwd, cwd));
    if (reg.added.length !== n) saveReg();
    return n !== reg.added.length;
  }
  // Where new projects usually go: the folders your projects already live in, most used first.
  function places(projectDirs) {
    const count = new Map();
    for (const d of projectDirs) {
      const parent = path.dirname(d);
      if (!parent || parent === d || !fs.existsSync(parent)) continue;
      count.set(parent, (count.get(parent) || 0) + 1);
    }
    const list = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => ({ path: p, projects: n }));
    const home = os.homedir();
    for (const p of [path.join(home, 'Projects'), path.join(home, 'Documents'), home]) {
      if (!list.some(x => same(x.path, p)) && fs.existsSync(p)) list.push({ path: p, projects: 0 });
    }
    const last = reg.lastParent && fs.existsSync(reg.lastParent) ? reg.lastParent : null;
    return { places: list.slice(0, 8), suggested: last || (list[0] && list[0].path) || home, home, sep: path.sep };
  }

  /* ---------- prompts ---------- */
  function prompts() {
    const saved = store.loadOwnJson(promptsFile, null, log);
    return Array.isArray(saved && saved.prompts) ? saved.prompts : DEFAULT_PROMPTS;
  }
  function savePrompts(list) {
    if (!Array.isArray(list) || list.length > 100) throw Object.assign(new Error('Too many prompts (100 at most).'), { status: 400 });
    const clean = list.map(cleanPrompt).filter(p => p.title && p.text.trim());
    store.writeJsonAtomic(promptsFile, { prompts: clean }, { keepBackup: true });
    return clean;
  }
  function resetPrompts() { try { fs.unlinkSync(promptsFile); } catch { /* already default */ } return DEFAULT_PROMPTS; }
  // Adds a starter set to your prompts, skipping ones you already have.
  function addSet(id) {
    const set = PROMPT_SETS[id];
    if (!set) throw Object.assign(new Error('There’s no starter set by that name.'), { status: 400 });
    const mine = prompts();
    const have = new Set(mine.map(p => p.title.toLowerCase()));
    const ids = new Set(mine.map(p => p.id));
    const extra = set.prompts.filter(p => !have.has(p.title.toLowerCase())).map(p => (ids.has(p.id) ? { ...p, id: `${p.id}-${id}` } : p));
    return savePrompts([...mine, ...extra]);
  }
  const sets = () => Object.entries(PROMPT_SETS).map(([id, s]) => ({ id, title: s.title, count: s.prompts.length }));

  return { info, setBanner, added, create, forget, places, prompts, savePrompts, resetPrompts, addSet, sets, forgetCache: cwd => cache.delete(cwd) };
}

module.exports = { createProjects, scanFolder, autoBanner, isBroad, checkName, PROMPT_SETS, DEFAULT_PROMPTS };
