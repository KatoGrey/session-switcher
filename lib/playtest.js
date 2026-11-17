'use strict';
/* Playtest: an agent plays a Voyage world in a browser, with a goal and specs you set, and writes a report into the
   project's playtests/ folder. This file has what doesn't need the rest of the server:
   - the spec: what the sheet sends, checked and filled in (cleanSpec);
   - the brief: the first message the agent gets, in markdown (composeBrief), and where its report goes (reportPathFor);
   - a look through a project's files: world links it mentions, its newest patch notes, and whether it looks like a
     Voyage world at all (scan; cheap and capped, since a world's folder can hold a thousand files on OneDrive);
   - what's kept per project in the data folder's playtests.json: its links, presets and recent runs. */

const fs = require('fs');
const path = require('path');
const store = require('./store');

const MAX_TURNS = 40;          // the hard cap, "until the goal is answered" included
const MAX_LINKS = 12, MAX_PRESETS = 20, MAX_RUNS = 10;
const bad = message => Object.assign(new Error(message), { status: 400 });

// Quick starts for the goal: each fills in a starting goal you can edit.
const CHIPS = [
  { id: 'fights', label: 'Fights & companions', goal: 'How do fights play out, and do companions pull their weight? Get into at least two fights. Check that damage, health, abilities and rolls are shown and applied consistently, that enemies act sensibly, and that companions join in, stay in character and remember what happened.' },
  { id: 'opening', label: 'The opening & first turns', goal: 'Is the opening clear and gripping? Judge the first turns as a player who knows nothing: is it clear who you are, where you are and what you can do, does the story answer what you type, and is there a hook that makes you want to keep going?' },
  { id: 'npcs', label: 'NPCs & conversations', goal: 'Do the people in this world feel alive? Talk to several NPCs: ask about themselves, the world and each other. Check that they keep their names, voices and facts straight, react to what you say, and don’t all sound alike.' },
  { id: 'quests', label: 'Quests & exploration', goal: 'Can a player find and follow a quest, and is exploring rewarded? Look for something to do, take on a quest, travel to at least two places, and check that directions, places and quest progress make sense and are kept track of.' },
  { id: 'break', label: 'Try to break it', goal: 'Where does it break? Try odd, contradictory and out-of-world inputs, skip ahead, refuse the story’s hooks, ask for things the rules forbid, and repeat actions. Note every place where rules, numbers or story facts give way.' },
  { id: 'first15', label: 'A new player’s first 15 minutes', goal: 'Would a brand-new player still be here after 15 minutes? Play as someone who has never seen this world: note every moment of confusion, every time you weren’t sure what to type, what felt great, and where you would have quit.' },
  { id: 'patch', label: 'Check the latest patch notes', goal: 'Does the latest update work the way its patch notes say? Test each change they list, in play, and say for each one whether it works, partly works or doesn’t.' },
];

// How the agent plays.
const STYLES = {
  new: { label: 'New player', text: 'a new player: curious, reads everything, sometimes unsure what to type, tries the obvious things first' },
  careful: { label: 'Careful', text: 'a careful player: thinks before acting, looks around, avoids needless risks and uses what they have sensibly' },
  fighter: { label: 'Aggressive fighter', text: 'an aggressive fighter: picks fights, charges in, and uses weapons and abilities as much as the game allows' },
  talker: { label: 'Talker & roleplayer', text: 'a talker and roleplayer: speaks in character, asks people questions, bargains and builds relationships' },
  chaos: { label: 'Chaos — try to break it', text: 'chaos: odd and contradictory actions, out-of-world requests, very long or very short inputs, skipping ahead, and attempts to talk the game out of its own rules (nothing hateful or explicit)' },
};

// What the report has, besides its setup, the answer to the goal and what to fix first.
const REPORTS = {
  bugs: { label: 'Bugs & errors', section: '**Bugs and errors**: each one with the turn it happened on, what you did, what happened, what you expected, and how bad it is (blocks play / gets in the way / small). Quote the game’s exact words.' },
  rules: { label: 'Rules or instructions not followed', section: '**Rules or instructions not followed**: where the game broke its own rules, numbers or story facts, or ignored what a character, item or the world says about itself, with the turn and a quote.' },
  pacing: { label: 'Pacing & feel', section: '**Pacing and feel**: how it felt to play: too fast or slow, too long or short, repetitive, confusing or fun, and where.' },
  log: { label: 'A turn-by-turn log', section: '**Turn by turn**: every turn: your action, then one or two lines on what happened.' },
  score: { label: 'A 1–5 score per goal', section: '**Scores**: a score from 1 (poor) to 5 (great) for each part of the goal, each with a sentence on why.' },
};
const REPORT_DEFAULT = ['bugs', 'rules', 'pacing'];

const one = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const many = (v, max) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim().slice(0, max);

// A link the agent can open: http(s) only. A voyage.io world link is the usual; a play or preview link, an AI Dungeon
// link or a test site's address is fine too.
function cleanUrl(v) {
  const s = one(v, 2000);
  if (!s) return '';
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname) return null;
  return u.href;
}
const WORLD_RE = /https?:\/\/(?:[a-z0-9-]+\.)*(?:voyage\.io|aidungeon\.com)\/(?:world|worlds|play|preview|scenario|scenarios|adventure)\/[\w\-./?=&%#]+/gi;
const isWorldLink = s => { WORLD_RE.lastIndex = 0; return WORLD_RE.test(String(s || '')); };

// What the sheet sends, checked: a clean spec, or an error that says what to fix.
function cleanSpec(input = {}) {
  const x = input && typeof input === 'object' ? input : {};
  const url = cleanUrl(x.url);
  if (url === null) throw bad('That link doesn’t look like a web address. Paste the world’s link from voyage.io.');
  if (!url) throw bad('Paste the world’s link (from voyage.io) first.');
  const goal = many(x.goal, 4000);
  if (!goal) throw bad('Say what it should find out: the goal.');
  const turns = x.turns === 'goal' ? 'goal' : Math.round(Number(x.turns));
  if (turns !== 'goal' && !(turns >= 1)) throw bad('Choose how many turns to play.');
  const kind = x.character && x.character.kind === 'saved' ? 'saved' : 'random';
  const charName = one(x.character && x.character.name, 120);
  if (kind === 'saved' && !charName) throw bad('Name the saved character to play, or choose a new random one.');
  const style = x.style === 'custom' || STYLES[x.style] ? x.style : 'new';
  const styleText = one(x.styleText, 600);
  if (style === 'custom' && !styleText) throw bad('Describe the player style, or pick one of the others.');
  const report = Array.isArray(x.report) ? [...new Set(x.report.filter(k => REPORTS[k]))] : REPORT_DEFAULT.slice();
  const patchNotes = Array.isArray(x.patchNotes) ? x.patchNotes.map(p => one(p, 400)).filter(p => p && !path.isAbsolute(p) && !p.split(/[\\/]/).includes('..')).slice(0, 6) : [];
  return {
    url, goal,
    turns: turns === 'goal' ? 'goal' : Math.min(MAX_TURNS, turns),
    opening: one(x.opening, 120),
    character: kind === 'saved' ? { kind, name: charName } : { kind },
    style, ...(style === 'custom' ? { styleText } : {}),
    screen: x.screen === 'phone' ? 'phone' : 'desktop',
    stopAsk: x.stopAsk !== false,
    pictures: !!x.pictures,
    report: report.length ? report : REPORT_DEFAULT.slice(),
    extra: many(x.extra, 4000),
    ...(patchNotes.length ? { patchNotes } : {}),
    ...(CHIPS.some(c => c.id === x.chip) ? { chip: x.chip } : {}),
  };
}

// The goal, short: for the chat's name and the report's file name. A goal still as its quick start had it goes by
// that quick start's name.
function shortGoal(spec, max = 48) {
  const chip = CHIPS.find(c => c.id === spec.chip);
  const first = s => String(s).split(/(?<=[.?!])\s/)[0].trim();
  if (chip && first(spec.goal) === first(chip.goal)) return chip.label;
  const line = first(String(spec.goal || '').split('\n').find(l => l.trim()) || 'Playtest').replace(/[.?!]+$/, '');
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1), sp = cut.lastIndexOf(' ');
  return `${(sp > max / 2 ? cut.slice(0, sp) : cut).replace(/[\s,;:–—-]+$/, '')}…`;
}
const slugOf = s => String(s || '').toLowerCase().replace(/&/g, ' and ').normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/_/g, ' ').trim().split(/[\s-]+/).filter(Boolean).slice(0, 6).join('-').slice(0, 40).replace(/-+$/, '') || 'playtest';
const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
// <project>/playtests/<YYYY-MM-DD-HHmm>-<short-goal-slug>.md (a second one in the same minute gets -2). taken: reports
// other runs were already given (one started a moment ago hasn't written its own yet).
function reportPathFor(cwd, spec, at = new Date(), taken = []) {
  const dir = path.join(cwd, 'playtests'), name = `${stamp(at)}-${slugOf(shortGoal(spec))}`;
  // A playtests folder that's a link (or junction) to somewhere outside the project isn't written into.
  if (!inside(cwd, dir)) throw bad('This project’s playtests folder leads outside the project. Make it a plain folder, then start the playtest.');
  const used = new Set(taken.map(f => path.resolve(String(f)).toLowerCase()));
  const free = f => !fs.existsSync(f) && !used.has(path.resolve(f).toLowerCase());
  let file = path.join(dir, `${name}.md`);
  for (let i = 2; !free(file) && i < 200; i++) file = path.join(dir, `${name}-${i}.md`);
  return file;
}
// Is p (as it really is, links followed) inside root? A path that doesn't exist yet is judged by the folder it'd be in.
function inside(root, p) {
  const real = x => { try { return fs.realpathSync.native(x); } catch { return null; } };
  const r = real(root);
  if (!r) return false;
  let at = path.resolve(p), tail = '';
  while (!fs.existsSync(at)) { const up = path.dirname(at); if (up === at) return false; tail = path.join(path.basename(at), tail); at = up; }
  const full = path.join(real(at) || at, tail);
  const rel = path.relative(r, full);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}
const titleFor = spec => `Playtest · ${shortGoal(spec)}`;

// The first message. ctx: { cwd, reportPath, provider ('claude' | 'codex' | 'gemini'), browser ('app' | 'chrome' |
// 'both'), at (a Date), patchNotes: absolute paths }.
function composeBrief(spec, ctx = {}) {
  const at = ctx.at || new Date();
  const chrome = ctx.browser === 'chrome';
  const provider = ctx.provider || 'claude';
  const t = name => `\`${name}\``;
  const turnsText = spec.turns === 'goal' ? `until you can answer the goal (at most ${MAX_TURNS} turns)` : `${spec.turns} turn${spec.turns === 1 ? '' : 's'}`;
  const style = spec.style === 'custom' ? spec.styleText : (STYLES[spec.style] || STYLES.new).text;
  const opening = spec.opening ? `the one called “${spec.opening}”` : 'any (the first or most obvious one)';
  const character = spec.character && spec.character.kind === 'saved' ? `the saved character “${spec.character.name}”` : 'a new random character';
  const when = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const L = [];
  L.push(`# Playtest: ${shortGoal(spec, 80)}`, '');
  L.push('You’re playtesting a Voyage world (an AI role-playing game at voyage.io) in a web browser, the way a player would. Play it, pursue the goal below, keep notes, and finish with a written report.', '');
  L.push('## The goal', '', spec.goal, '');
  L.push('## The world', '');
  L.push(`- Link: ${spec.url}`, `- Opening: ${opening}`, `- Character: ${character}`, `- Screen: ${spec.screen === 'phone' ? 'phone size' : 'desktop size'}`, '');

  L.push('## The browser', '');
  if (chrome) {
    L.push('Use Claude in Chrome (the `mcp__claude-in-chrome__*` tools), in a new tab of its own; leave the user’s other tabs alone. It has no Voyage shortcuts, so play by hand: read the story with `get_page_text` or `read_page`, type your action into the game’s input with `form_input` or `computer`, submit it, and wait until the new turn has finished appearing before you read it.');
    if (spec.screen === 'phone') L.push('Before you open the world, make the window phone-sized (about 390 × 844) with `resize_window`.');
  } else {
    const where = provider === 'claude' ? 'Its tools’ full names start with `mcp__app-browser__` (so `voyage_act` is `mcp__app-browser__voyage_act`).' : 'They’re the tools of the `app-browser` MCP server.';
    L.push(`Use the browser built into Session Switcher: it opens beside this chat, so the user can watch. ${where}${ctx.browser === 'both' ? ' Use it rather than Claude in Chrome.' : ''}`, '');
    L.push(`- Voyage: ${t('voyage_status')} (where you are: the world page, a create step, in the game, whether the input is ready), ${t('voyage_start')} (goes through creating a game: opening by name, saved character or random), ${t('voyage_act')} (types an action, submits it, skips dialogue, waits for the turn to finish and gives back the new turn’s text), ${t('voyage_continue')} (skips dialogue or a slideshow until the input is ready) and ${t('voyage_story')} (the latest turns as text).`);
    L.push(`- The page: ${['tabs', 'open_tab', 'navigate', 'read_page', 'find', 'page_text', 'click', 'type', 'key', 'scroll', 'form_input', 'wait_for', 'screenshot', 'console', 'network', 'viewport'].map(t).join(', ')}.`);
    if (spec.screen === 'phone') L.push(`- Before you open the world, set a phone size with ${t('viewport')}.`);
    L.push('');
  }
  L.push('If you don’t have these tools, stop and say so; don’t try another way in.', '');

  L.push('## How to play', '');
  const steps = [];
  steps.push(chrome ? `Open ${spec.url} in a new tab.` : `Open ${spec.url} with ${t('open_tab')}.`);
  steps.push(chrome
    ? `Start a game, going through the create steps by hand: opening ${spec.opening ? `“${spec.opening}”` : 'any'}, as ${character}.`
    : `Start a game with ${t('voyage_start')}: opening ${spec.opening ? `“${spec.opening}”` : 'any'}, ${spec.character && spec.character.kind === 'saved' ? `saved character “${spec.character.name}”` : 'a random character'}. If it can’t, go through the create steps by hand (${t('voyage_status')} says where you are).`);
  steps.push(`Play ${turnsText} as ${style}. One turn is one action you send. Steer what you do toward the goal.`);
  steps.push(chrome
    ? 'Read the story as text rather than in pictures: it’s cheaper and more exact. Take a screenshot only to check something visual (layout, pictures, a button that doesn’t work) or when you’re stuck.'
    : `Take each turn with ${t('voyage_act')}; use ${t('voyage_continue')} when dialogue or a slideshow is in the way and ${t('voyage_story')} to reread recent turns. Read the story as text rather than in pictures: it’s cheaper and more exact. Take a ${t('screenshot')} only to check something visual (layout, pictures, a button that doesn’t work) or when you’re stuck.`);
  if (spec.pictures) steps.push('Also take pictures at the key moments: the start, the first fight or big choice, anything that looks broken, and the end. In the report, say what each one shows.');
  steps.push('Keep notes as you go: the turn number, what you did, what happened, and anything that looks wrong, with the game’s exact words.');
  steps.forEach((s, i) => L.push(`${i + 1}. ${s}`));
  L.push('');

  L.push('## Rules', '');
  L.push('- Only play. Never publish, edit, delete, copy or remix the world or anything else on the site; never rate, comment, report or follow anything; never buy anything or start a subscription; never change account or site settings.');
  L.push('- If you’re signed out, or hit a paywall, a captcha or a sign-in page, stop and tell the user. Don’t sign in or try to get round it.');
  L.push(spec.stopAsk
    ? '- If something looks broken (an error, a turn that never finishes, an empty reply, the game badly breaking its own rules), stop and ask the user before you go on: say what you saw and on which turn.'
    : '- If something breaks, note it, try once to get past it (continue, or reload the page), and carry on. If you can’t go on, write the report with what you have.');
  L.push('- Don’t change any file in this project except the report (and its pictures, if you keep any).', '');

  const notes = (ctx.patchNotes || []).filter(Boolean);
  if (notes.length) {
    L.push('## The latest patch notes', '');
    L.push(`Before you play, read ${notes.length === 1 ? 'this file' : 'these files'}: ${notes.length === 1 ? 'it says' : 'they say'} what changed most recently.`, '');
    for (const f of notes) L.push(`- ${f}`);
    L.push('', 'Test what they changed, in play. In the report, list each change and say whether it works as described, partly works, or doesn’t, with the turn you checked it on.', '');
  }
  if (spec.extra) L.push('## Also', '', spec.extra, '');

  L.push('## The report', '');
  L.push('When you’re done, write the report as markdown to:', '', `\`${ctx.reportPath}\``, '', '(Make the `playtests` folder if it isn’t there.) In it:', '');
  L.push(`- **Setup**: the exact world link, the opening, the character, how many turns you played, the play style, the screen size, the date (${when}), and which assistant and model you are.`);
  L.push('- **The answer**: what you found out about the goal, in a few sentences.');
  for (const k of spec.report || REPORT_DEFAULT) if (REPORTS[k]) L.push(`- ${REPORTS[k].section}`);
  if (notes.length) L.push('- **Patch notes checked**: each change, and whether it works.');
  L.push('- **Fix first**: the three things most worth fixing, most important first.');
  if (spec.pictures) L.push(`- **Pictures**: if your screenshots can be saved, keep them in a folder next to the report named \`${path.basename(String(ctx.reportPath || 'report.md'), '.md')}-pictures\` and link them; otherwise describe what each showed.`);
  L.push('', 'Then reply with a short summary (the answer to the goal and the biggest problems) and the report’s path. If you can’t write files here, put the whole report in your reply instead.');
  return `${L.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/* ---------- a look through a project's files ---------- */

const RULE_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'README.md'];
const PATCH_RE = /^(patch[-_ ]?notes|changelog)\b.*\.md$/i;
const MENTIONS_RE = /voyage\.io|aidungeon\.com|AI Dungeon|\bVoyage\b/;
// Reads the start of a file (a world's backup JSON can be hundreds of megabytes).
async function head(file, bytes) {
  let fh;
  try { fh = await fs.promises.open(file, 'r'); const buf = Buffer.alloc(bytes); const { bytesRead } = await fh.read(buf, 0, bytes, 0); return buf.toString('utf8', 0, bytesRead); } catch { return ''; } finally { if (fh) await fh.close().catch(() => {}); }
}
// root's own files (not its folders: a world's pictures and builds live there): the links to worlds they mention,
// whether they mention Voyage at all, and its newest patch notes (with any written within half an hour before them,
// as a batch's parts are). opts: maxFiles, bytes (read from each), budgetMs.
async function scan(root, { maxFiles = 60, bytes = 64 * 1024, budgetMs = 1500 } = {}) {
  const t0 = Date.now();
  const out = { links: [], mentions: /voyage|ai ?dungeon/i.test(root), patchNotes: null };
  let names = [];
  try { names = (await fs.promises.readdir(root, { withFileTypes: true })).filter(d => d.isFile()).map(d => d.name); } catch { return out; }
  const stats = await Promise.all(names.filter(n => /\.(md|json)$/i.test(n)).map(async n => { try { const st = await fs.promises.stat(path.join(root, n)); return { n, mtime: st.mtimeMs, size: st.size }; } catch { return null; } }));
  const files = stats.filter(Boolean);
  const patch = files.filter(f => PATCH_RE.test(f.n)).sort((a, b) => b.mtime - a.mtime);
  if (patch.length) {
    const newest = patch[0];
    const batch = patch.filter(f => newest.mtime - f.mtime <= 30 * 60e3).slice(0, 6);
    out.patchNotes = { newest: newest.n, files: batch.map(f => f.n), at: newest.mtime };
  }
  const order = [
    ...RULE_FILES.map(n => files.find(f => f.n.toLowerCase() === n.toLowerCase())).filter(Boolean),
    ...files.filter(f => /\.md$/i.test(f.n) && !RULE_FILES.some(r => r.toLowerCase() === f.n.toLowerCase())).sort((a, b) => b.mtime - a.mtime),
    ...files.filter(f => /\.json$/i.test(f.n)).sort((a, b) => b.mtime - a.mtime),
  ].slice(0, maxFiles);
  const seen = new Map();
  for (const f of order) {
    if (Date.now() - t0 > budgetMs) break;
    const text = await head(path.join(root, f.n), bytes);
    if (!out.mentions && MENTIONS_RE.test(text)) out.mentions = true;
    WORLD_RE.lastIndex = 0;
    for (const m of text.matchAll(WORLD_RE)) {
      const url = cleanUrl(m[0].replace(/[).,;:'"\]]+$/, ''));
      if (url && !seen.has(url)) seen.set(url, { url, file: f.n, at: f.mtime });
    }
    if (seen.size >= 8) break;
  }
  out.links = [...seen.values()];
  if (out.links.length) out.mentions = true;
  return out;
}

/* ---------- what's kept per project ---------- */

const keyOf = cwd => { const x = String(cwd || '').replace(/[\\/]+$/, ''); return process.platform === 'win32' ? x.replace(/\//g, '\\').toLowerCase() : x; };
function createPlaytests({ dataDir, log = () => {}, scanOpts = {} } = {}) {
  const file = path.join(dataDir, 'playtests.json');
  let data = store.loadOwnJson(file, { projects: {} }, log);
  if (!data || typeof data !== 'object' || !data.projects || typeof data.projects !== 'object') data = { projects: {} };
  const save = () => store.writeJsonAtomic(file, data, { keepBackup: true });
  const proj = (cwd, make = false) => {
    const k = keyOf(cwd);
    let p = data.projects[k];
    if (!p && make) p = data.projects[k] = { cwd, links: [], presets: [], runs: [] };
    if (p) { p.links = Array.isArray(p.links) ? p.links : []; p.presets = Array.isArray(p.presets) ? p.presets : []; p.runs = Array.isArray(p.runs) ? p.runs : []; }
    return p || null;
  };
  const scans = new Map();   // root -> { at, r }
  async function scanned(root, fresh = false) {
    const had = scans.get(keyOf(root));
    if (!fresh && had && Date.now() - had.at < 2 * 60e3) return had.r;
    const r = await scan(root, scanOpts);
    scans.set(keyOf(root), { at: Date.now(), r });
    return r;
  }

  // What the sheet needs for a project: its saved links (last used first), presets, recent runs, the links its files
  // mention that aren't saved, its newest patch notes, and whether it looks like a Voyage world.
  async function view(cwd, { fresh = false } = {}) {
    const p = proj(cwd) || { links: [], presets: [], runs: [] };
    const s = await scanned(cwd, fresh);
    const links = p.links.slice().sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
    const found = s.links.filter(l => !links.some(x => x.url === l.url)).slice(0, 6);
    return {
      cwd, links, found, presets: p.presets, runs: p.runs,
      last: (links.find(l => l.lastUsed) || links[0] || found[0] || {}).url || null,
      patchNotes: s.patchNotes ? { ...s.patchNotes, paths: s.patchNotes.files.map(f => path.join(cwd, f)) } : null,
      voyage: !!(links.length || p.runs.length || s.mentions),
      chips: CHIPS, styles: Object.entries(STYLES).map(([id, v]) => ({ id, label: v.label })), reports: Object.entries(REPORTS).map(([id, v]) => ({ id, label: v.label })),
      maxTurns: MAX_TURNS,
    };
  }
  // A link saved (or relabelled, or marked as just used). url: the link; label: its name ("" leaves it as it was
  // unless it's new); used: it was just played.
  function saveLink(cwd, { url, label, used = false } = {}) {
    const u = cleanUrl(url);
    if (!u) throw bad('That link doesn’t look like a web address.');
    const p = proj(cwd, true);
    let l = p.links.find(x => x.url === u);
    if (!l) { l = { url: u, label: '' }; p.links.unshift(l); }
    if (typeof label === 'string') l.label = one(label, 60);
    if (used) l.lastUsed = Date.now();
    // The ones used longest ago go first when there are too many.
    if (p.links.length > MAX_LINKS) p.links = p.links.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)).slice(0, MAX_LINKS);
    save();
    return p.links;
  }
  function forgetLink(cwd, url) {
    const p = proj(cwd); if (!p) return [];
    p.links = p.links.filter(x => x.url !== url);
    save();
    return p.links;
  }
  // A preset: a name and a spec (checked as a run's is). The same name again replaces it.
  function savePreset(cwd, { name, spec, id } = {}) {
    const n = one(name, 60);
    if (!n) throw bad('Name the preset.');
    const clean = cleanSpec(spec);
    const p = proj(cwd, true);
    let pr = (id && p.presets.find(x => x.id === id)) || p.presets.find(x => x.name.toLowerCase() === n.toLowerCase());
    if (!pr) { if (p.presets.length >= MAX_PRESETS) throw bad(`A project keeps ${MAX_PRESETS} presets at most. Delete one first.`); pr = { id: `pt${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` }; p.presets.push(pr); }
    Object.assign(pr, { name: n, spec: clean, at: Date.now() });
    save();
    return { preset: pr, presets: p.presets };
  }
  function forgetPreset(cwd, id) {
    const p = proj(cwd); if (!p) return [];
    p.presets = p.presets.filter(x => x.id !== id);
    save();
    return p.presets;
  }
  // A run, newest first; at most MAX_RUNS kept.
  function noteRun(cwd, run) {
    const p = proj(cwd, true);
    const r = { at: Date.now(), ...run };
    p.runs.unshift(r);
    p.runs = p.runs.slice(0, MAX_RUNS);
    save();
    return r;
  }
  // A run's details filled in later (its chat's id, once it has one).
  function updateRun(cwd, at, patch) {
    const p = proj(cwd); const r = p && p.runs.find(x => x.at === at);
    if (!r) return null;
    Object.assign(r, patch);
    save();
    return r;
  }
  // The reports runs in this project were told to write (so a new one never gets the same name).
  const reportPaths = cwd => { const p = proj(cwd); return p ? p.runs.map(r => r.reportPath).filter(Boolean) : []; };
  return { view, saveLink, forgetLink, savePreset, forgetPreset, noteRun, updateRun, reportPaths, scanned, file };
}

module.exports = { CHIPS, STYLES, REPORTS, REPORT_DEFAULT, MAX_TURNS, cleanSpec, cleanUrl, isWorldLink, shortGoal, slugOf, reportPathFor, inside, titleFor, composeBrief, scan, createPlaytests };
