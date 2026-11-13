'use strict';
// Latitude's monorepo on a Windows PC. It's made on Macs and Linux, so a few things work differently here. This
// gives every chat that works in it (Claude, Codex and Gemini) a short note on what differs, and checks the clone
// is set up the way Latitude's own Windows guide asks (docs/developer-setup/local-windows-setup.md), with a fix for
// each thing that isn't: done here when it's a safe one-liner, through a chat otherwise.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const IS_WIN = process.platform === 'win32';
const SLUG = /[:/]latitudegames\/latitude(?:\.git)?\/?\s*$/im;   // (on a remote's url: any host, so an SSH alias counts)
const ENV_KEYS = ['TURBO_TOKEN', 'EXPO_TOKEN'];   // (the 1Password ones have a row of their own: lib/onepass.js)
const onepass = require('./onepass');

// What a chat working in Latitude's repo on Windows is told.
const WINDOWS_NOTE = `This is Latitude's monorepo, which its team works on with Macs and Linux. This computer runs Windows, so a few things differ:
- Pushes skip Latitude's local GraphQL freshness check (GRAPHQL_FRESHNESS_SKIP=1), which can't run on Windows; GitHub runs the real check on every PR. Never run schema:write or schema:generate here: Windows would rewrite schema.graphql in a different type order. If a PR's GraphQL schema freshness job fails, stop and tell the user: it has to be regenerated on a Mac or Linux.
- Run the repo's shell scripts (*.sh) and anything written for bash with Git Bash (bash path/to/script.sh), not PowerShell or cmd.
- Windows ignores letter case in file names. To rename a file by case only, use git mv -f old New (or git mv through a temporary name), never a plain rename.
- Files use LF line endings (the repo's .gitattributes): don't introduce CRLF, and write paths in code with forward slashes.
- Use the Node version in .nvmrc. If node --version differs, say so rather than working around it.
- Latitude's local tools reach AWS (feedback saves, game states) through the 1Password tokens in the main checkout's .env.local; no personal AWS user is needed. If they're missing or 1Password answers 403, stop and ask the user to fill them in Session Switcher (Your work → This PC → 1Password). Never print, copy or commit their values.`;

// This PC's own settings for the repo (the folder for new worktrees), in the app's data folder.
let settingsFile = null;
const configure = ({ file } = {}) => { settingsFile = file || null; };
function settings() { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')) || {}; } catch { return {}; } }
function saveSettings(patch) {
  if (!settingsFile) throw Object.assign(new Error('There’s nowhere to keep that.'), { status: 500 });
  const next = { ...settings(), ...patch };
  fs.writeFileSync(`${settingsFile}.tmp`, JSON.stringify(next, null, 2)); fs.renameSync(`${settingsFile}.tmp`, settingsFile);
  return next;
}
// Is this folder inside OneDrive (which uploads every file made in it)?
const ONEDRIVE_VARS = ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial'];
function inOneDrive(dir, env = process.env) {
  const d = path.resolve(String(dir || '')).toLowerCase() + path.sep;
  return ONEDRIVE_VARS.some(k => env[k] && d.startsWith(path.resolve(env[k]).toLowerCase() + path.sep));
}
// How new worktrees are made on this PC: where (the folder chosen on This PC, if any), and with --copy.
function worktreeNote(home) {
  return `- New worktrees of this repo: ${home ? `make them in ${home} (the user chose it; the clone itself is in OneDrive, which would upload every file an install makes), as ${path.join(home, '<short-name>')}` : 'make them beside the clone'}. Copy the main checkout's untracked .npmrc into a new worktree first (it points npm's script shell at Git Bash), then install with node scripts/worktree-setup.mjs --copy (plus --install-only or --filter as needed). Without --copy the install runs for many minutes and then fails with "UNKNOWN: unknown error, link": its shared hard links pass Windows' limit of 1,024 links per file. Don't copy .env.local into a worktree unless a tool needs it there: Latitude's local scripts read the main checkout's.`;
}

// The folder a path is in that holds a git checkout (.git as a folder, or a worktree's .git file), or null.
function repoRoot(cwd) {
  let dir = path.resolve(String(cwd || '.'));
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}
// Its git config: .git/config, or for a worktree the shared repository's.
function gitConfigOf(root) {
  const dotgit = path.join(root, '.git');
  try {
    if (fs.statSync(dotgit).isDirectory()) return fs.readFileSync(path.join(dotgit, 'config'), 'utf8');
    const gitdir = path.resolve(root, /gitdir:\s*(.+)/.exec(fs.readFileSync(dotgit, 'utf8'))[1].trim());
    let common = gitdir;
    try { common = path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim()); } catch { /* not a worktree */ }
    return fs.readFileSync(path.join(common, 'config'), 'utf8');
  } catch { return ''; }
}
const known = new Map();   // folder -> { at, yes }
// Is this folder in a clone of Latitude's repo? (Read from its git config: quick, and kept for a minute.)
function isLatitude(cwd) {
  const root = repoRoot(cwd);
  if (!root) return false;
  const hit = known.get(root);
  if (hit && Date.now() - hit.at < 60000) return hit.yes;
  const yes = SLUG.test(gitConfigOf(root).split(/\r?\n/).filter(l => /^\s*url\s*=/.test(l)).join('\n'));
  known.set(root, { at: Date.now(), yes });
  return yes;
}
// The note for a chat in this folder ('' anywhere else, and on a Mac or Linux).
const noteFor = (cwd, platform = process.platform) => (platform === 'win32' && isLatitude(cwd) ? `${WINDOWS_NOTE}\n${worktreeNote(settings().worktrees || null)}` : '');

// ---------- the setup check ----------

const run = (file, args, opts = {}) => new Promise(resolve => {
  execFile(file, args, { timeout: 20000, windowsHide: true, ...opts }, (err, out, errText) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, out: String(out || '').trim(), err: String(errText || '').trim() }));
});
const GEMINI_FILE = 'GEMINI.md';
const GEMINI_NOTE = `# This PC (Windows)\n\nA local note for Gemini on this computer, kept out of git (.git/info/exclude). Session Switcher wrote it.\n\n${WINDOWS_NOTE}\n`;

// One check: { id, label, state: 'ok' | 'fix' | 'info', detail, fix: 'here' | 'chat' | 'open' | null }.
async function check(root, { env = process.env, platform = process.platform, home = require('os').homedir(), fresh = false, verifyFn } = {}) {
  const out = [];
  const add = (id, label, state, detail, fix = null) => out.push({ id, label, state, detail, fix: state === 'ok' ? null : fix });
  const win = platform === 'win32';
  const git = args => run('git', ['-C', root, ...args], { env });

  // Node, as the chats get it.
  let want = ''; try { want = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim().replace(/^v/, ''); } catch { /* none */ }
  const node = (await run('node', ['--version'], { env })).out.replace(/^v/, '');
  if (want) add('node', 'Node', !node ? 'fix' : node === want ? 'ok' : 'fix', !node ? `Node isn’t installed; the repo uses ${want}.` : node === want ? `${node}, as .nvmrc asks.` : `${node} here; the repo uses ${want} (.nvmrc).`, 'chat');

  if (win) {
    const lp = (await git(['config', '--global', 'core.longpaths'])).out;
    add('longpaths', 'Long file paths', lp === 'true' ? 'ok' : 'fix', lp === 'true' ? 'On (git core.longpaths).' : 'Off: some files in this repo have paths longer than Windows allows by default.', 'here');
    const sl = (await git(['config', 'core.symlinks'])).out;
    const links = (await git(['ls-files', '-s'], { maxBuffer: 64 * 1024 * 1024 })).out.split('\n').filter(l => l.startsWith('120000 ')).map(l => l.split('\t')[1]).filter(Boolean);
    const flat = links.filter(f => { try { return !fs.lstatSync(path.join(root, f)).isSymbolicLink(); } catch { return false; } });
    add('symlinks', 'Symlinks', sl === 'true' && !flat.length ? 'ok' : 'fix', sl === 'true' && !flat.length ? `On; all ${links.length} links are real links.` : `${flat.length ? `${flat.length} of ${links.length} links are plain files (${flat.slice(0, 2).join(', ')})` : 'git core.symlinks is off'}: Claude and Codex find the repo’s skills through them.`, 'chat');
  }

  const hooks = (await git(['config', 'core.hooksPath'])).out;
  add('hooks', 'Git hooks', /^\.husky/.test(hooks) ? 'ok' : 'fix', /^\.husky/.test(hooks) ? 'Installed (yarn prepare).' : 'Not installed: the checks the repo runs before each push are missing. yarn prepare installs them.', 'chat');

  let lockAt = 0, stateAt = 0;
  try { lockAt = fs.statSync(path.join(root, 'yarn.lock')).mtimeMs; } catch { /* none */ }
  try { stateAt = fs.statSync(path.join(root, 'node_modules', '.yarn-state.yml')).mtimeMs; } catch { /* not installed */ }
  if (lockAt) add('deps', 'Dependencies', stateAt && stateAt + 1000 >= lockAt ? 'ok' : 'fix', !stateAt ? 'Not installed: run yarn.' : stateAt + 1000 >= lockAt ? 'Installed and current.' : 'Older than yarn.lock (it changed since the last yarn): run yarn.', 'chat');

  let envText = ''; try { envText = fs.readFileSync(path.join(root, '.env.local'), 'utf8'); } catch { /* none */ }
  const missing = ENV_KEYS.filter(k => !new RegExp(`^[ \\t]*${k}[ \\t]*=[ \\t]*[^\\s.]`, 'm').test(envText));
  add('env', 'Build tokens', missing.length ? 'info' : 'ok', missing.length ? `Only needed for remote builds here: ${missing.join(', ')}, from Latitude’s 1Password (Dev_Secrets), in .env.local.` : 'All in .env.local.', 'open');

  const op = await onepass.check(root, { env, platform, fresh, ...(verifyFn ? { verifyFn } : {}) });
  out.push(op);
  // Once 1Password takes the tokens: the whole way to AWS, tried in a chat (Latitude's own test for it).
  if (op.state === 'ok') add('aws', 'AWS through 1Password', 'info', 'Try it end to end: build Latitude’s local Voyage CLI and read one feedback save (it should say heroesVersion 37).', 'chat');

  let turbo = false; try { turbo = !!JSON.parse(fs.readFileSync(path.join(root, '.turbo', 'config.json'), 'utf8')).teamId; } catch { /* not linked */ }
  add('turbo', 'Turbo remote cache', turbo ? 'ok' : 'info', turbo ? 'Linked.' : 'Not linked. Optional: it makes builds faster (yarn dlx turbo login, then turbo link to the latitude team).', 'chat');

  if (win) {
    const wt = settings().worktrees || null, od = inOneDrive(root, env);
    let wtOk = false; try { wtOk = !!wt && fs.statSync(wt).isDirectory(); } catch { /* gone */ }
    add('worktrees', 'Worktrees', wtOk || (!wt && !od) ? 'ok' : 'fix', wtOk ? `New ones go in ${wt}, installed with --copy (Windows’ hard-link limit breaks the default).` : wt ? `${wt} isn’t there any more. Choose a folder for new worktrees.` : od ? 'This clone is in OneDrive, which uploads every file an install makes (installs take 20 minutes or more). Choose a folder outside it for new worktrees.' : 'New ones go beside the clone, installed with --copy (Windows’ hard-link limit breaks the default).', 'folder');
    add('graphql', 'GraphQL push check', 'ok', 'Handled: chats here skip it (it can’t run on Windows), and GitHub runs it on every PR.');
    const told = !!noteFor(root, platform);
    add('notes', 'Windows notes for Claude and Codex', told ? 'ok' : 'info', told ? 'Every Claude and Codex chat in this repo is told what differs on Windows.' : 'This clone’s remote doesn’t name latitudegames/latitude, so its chats aren’t told.');
    let gem = ''; try { gem = fs.readFileSync(path.join(root, GEMINI_FILE), 'utf8'); } catch { /* none */ }
    add('gemini', 'Windows notes for Gemini', gem.includes('Session Switcher wrote it') ? 'ok' : gem ? 'info' : 'fix', gem.includes('Session Switcher wrote it') ? 'In a local GEMINI.md, kept out of git.' : gem ? 'This folder has a GEMINI.md of its own, so it’s left alone.' : 'Gemini can’t be told per chat; a local GEMINI.md (kept out of git) tells it.', gem ? null : 'here');
  }
  return out;
}

// A fix done here (a safe one-liner), by its id.
async function fixHere(id, root, { folder = null, env = process.env } = {}) {
  if (id === 'worktrees') {
    const dir = path.resolve(String(folder || '').trim());
    if (!folder || !path.isAbsolute(String(folder).trim())) throw Object.assign(new Error('Type a full folder path, like G:\\LatitudeWorktrees.'), { status: 400 });
    if (inOneDrive(dir, env)) throw Object.assign(new Error('That’s inside OneDrive too. Choose a folder outside it.'), { status: 400 });
    const rel = path.relative(path.resolve(root), dir);
    if (!rel || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw Object.assign(new Error('Choose a folder outside the clone.'), { status: 400 });
    fs.mkdirSync(dir, { recursive: true });
    saveSettings({ worktrees: dir });
    return `New worktrees go in ${dir}. Chats started from now on are told.`;
  }
  if (id === 'longpaths') {
    const r = await run('git', ['config', '--global', 'core.longpaths', 'true']);
    if (r.code !== 0) throw Object.assign(new Error(`git didn’t take it: ${r.err || r.code}`), { status: 500 });
    return 'Long file paths are on.';
  }
  if (id === 'gemini') {
    const file = path.join(root, GEMINI_FILE);
    if (fs.existsSync(file)) throw Object.assign(new Error('There’s a GEMINI.md here already; it’s left alone.'), { status: 409 });
    if ((await run('git', ['-C', root, 'ls-files', '--', GEMINI_FILE])).out) throw Object.assign(new Error('The repo has a GEMINI.md of its own; it’s left alone.'), { status: 409 });
    // Kept out of git first, so it can never be committed (this one only: /GEMINI.md, not any deeper in the repo).
    const r = await run('git', ['-C', root, 'rev-parse', '--git-common-dir']);
    const common = path.resolve(root, r.out || '.git');
    const exclude = path.join(common, 'info', 'exclude');
    let text = ''; try { text = fs.readFileSync(exclude, 'utf8'); } catch { /* none yet */ }
    if (!text.split(/\r?\n/).includes(`/${GEMINI_FILE}`)) { fs.mkdirSync(path.dirname(exclude), { recursive: true }); fs.appendFileSync(exclude, `${text && !text.endsWith('\n') ? '\n' : ''}# Session Switcher: Gemini's notes for this PC (never committed)\n/${GEMINI_FILE}\n`); }
    fs.writeFileSync(file, GEMINI_NOTE);
    return 'Gemini has the Windows notes now (a local GEMINI.md, kept out of git).';
  }
  throw Object.assign(new Error('That one is fixed through a chat.'), { status: 400 });
}

// What a chat is asked, for the fixes done through one. The repo's own Windows guide is the reference.
const GUIDE = 'docs/developer-setup/local-windows-setup.md';
function fixPrompt(id, item = {}) {
  const asks = {
    node: `Set this PC up with the Node version this repository asks for in .nvmrc (${String(item.detail || '').replace(/\.$/, '')}). Follow ${GUIDE} (it uses nvm-windows). Install what's missing, switch to that version, and check node --version after. nvm-windows may need an administrator prompt: if so, tell me exactly what to run and stop there.`,
    symlinks: `Make the symlinks in this repository real links on this PC (${item.detail || ''}). Follow ${GUIDE}: git core.symlinks has to be on, and Windows needs Developer Mode (or an administrator) to create links. Check git status first and don't disturb uncommitted work. If it needs an administrator or a Windows setting, tell me exactly what to do and stop there.`,
    hooks: `Install this repository's git hooks on this PC: run yarn prepare (${GUIDE}), then confirm git config core.hooksPath points at .husky.`,
    deps: `Bring this repository's dependencies up to date on this PC: run yarn in the repository root, and tell me if it fails or changes yarn.lock (it shouldn't).`,
    aws: `Check that Latitude's local tools reach AWS through the 1Password tokens in .env.local (no personal AWS user is needed). Run git status first and don't disturb work in progress: if this checkout has uncommitted work or isn't on internal, use a worktree on the latest origin/internal (on Windows, in the folder the repo notes name, installed with --copy). Then: yarn workspace @aidungeon/voyage-bson-codec build && yarn workspace @aidungeon/voyage-cli build, then node scripts/voyage-cli-local.cjs get-game-state 5F05E476 --state-type before --json-path heroesVersion. It should print 37. If 1Password answers 403, the tokens are old ones: stop and tell me to fill them again (Your work → This PC → 1Password). Never print the tokens.`,
    turbo: `Link this repository to Latitude's Turbo remote cache on this PC, following ${GUIDE}: yarn dlx turbo login, then yarn dlx turbo link to the latitude team. Logging in needs my browser and Latitude's Vercel account; tell me each step I have to do myself.`,
  };
  const ask = Object.hasOwn(asks, id) ? asks[id] : null;
  if (!ask) throw Object.assign(new Error('That one is fixed here, not through a chat.'), { status: 400 });
  return `${ask}\n\nThis is setup on this PC only: don't commit, push or change tracked files.`;
}

module.exports = { WINDOWS_NOTE, IS_WIN, isLatitude, noteFor, repoRoot, check, fixHere, fixPrompt, ENV_KEYS, configure, settings, inOneDrive, worktreeNote };
