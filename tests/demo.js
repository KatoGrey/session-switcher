// A made-up world for tests and screenshots: demo accounts, projects, chats and usage, served to the
// real app through the browser. Nothing of anyone’s real data is used. Set ART to a folder of banner
// pictures (starfall-tavern.png, …) to see them; without it the banners are simply missing.
const fs = require('fs'), path = require('path');
const ART = process.env.ART;
const NOW = Date.now();
const min = n => NOW - n * 60000;
const iso = t => new Date(t).toISOString();
const later = h => new Date(NOW + h * 3600000).toISOString();

const accounts = [
  { id: 'studio', name: 'Studio', configDir: 'C:\\Users\\alex\\.claude', isDefault: true, signedIn: true, authMethod: 'claude.ai', email: 'alex@studio.example', orgName: 'Studio', orgId: 'org-studio', plan: 'Max 20x', kind: 'team', verified: true, verifiedAt: NOW, verifyError: null, expectEmail: 'alex@studio.example', pinnedOrg: { id: 'org-studio', name: 'Studio', plan: 'Max 20x', kind: 'team', email: 'alex@studio.example' }, lock: { ok: true }, lockMessage: null, shared: true, sharing: [] },
  { id: 'personal', name: 'Personal', configDir: 'C:\\Users\\alex\\.claude-personal', isDefault: false, signedIn: true, authMethod: 'claude.ai', email: 'alex@example.com', orgName: 'Personal', orgId: 'org-me', plan: 'Max 5x', kind: 'personal', verified: true, verifiedAt: NOW, verifyError: null, expectEmail: 'alex@example.com', pinnedOrg: { id: 'org-me', name: 'Personal', plan: 'Max 5x', kind: 'personal', email: 'alex@example.com' }, lock: { ok: true }, lockMessage: null, shared: true, sharing: [] },
];
const codex = { id: 'codex', name: 'Codex', provider: 'codex', enabled: true, command: 'codex', home: null, checked: true, installed: true, signedIn: true, authMode: 'chatgpt', email: 'alex@example.com', plan: 'ChatGPT Pro', planType: 'pro', error: null, signingIn: false, checkedAt: NOW };

const P = name => `C:\\Projects\\${name}`;
const projectsSpec = [
  { name: 'Starfall Tavern', art: 'starfall-tavern.png', chats: [
    ['s-bard', 'Balance pass on the bard’s songs', 3, 'studio'],
    ['s-brawl', 'Tavern brawl encounter design', 9, 'studio'],
    ['c-harvest', 'Key art for the Harvest Festival', 14, 'codex'],
    ['s-quests', 'Write the side-quest dialogue', 160, 'studio'],
    ['s-save', 'Fix the save file on Steam Deck', 1500, 'personal'] ] },
  { name: 'Orbital Garden', art: 'orbital-garden.png', chats: [
    ['s-nutrient', 'Hydroponics sim: fix nutrient drift', 2, 'studio'],
    ['s-migrate', 'Plan the save-file migration', 75, 'studio'],
    ['c-shader', 'Glass dome shader', 300, 'codex'] ] },
  { name: 'Neon Courier', art: 'neon-courier.png', chats: [
    ['s-route', 'Route-finding with live traffic', 1, 'personal'],
    ['c-rain', 'Rain shader polish', 45, 'codex'],
    ['s-ui', 'Delivery HUD redesign', 400, 'personal'] ] },
  { name: 'Tidecaller', art: 'tidecaller.png', chats: [
    ['s-notes', 'Write patch notes for 1.4', 30, 'studio'],
    ['s-playtest', 'Playtest feedback review', 220, 'studio'] ] },
  { name: 'Atlas Docs', art: 'atlas-docs.png', chats: [
    ['s-readme', 'Write the README', 55, 'personal'],
    ['s-review', 'Review today’s changes', 130, 'personal'] ] },
  { name: 'Moonlit Bakery', art: null, chats: [['s-bakery', 'Get oriented in the codebase', 2900, 'personal']] },
];
const acctName = id => (id === 'codex' ? 'Codex' : accounts.find(a => a.id === id).name);
const uuid = k => { let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0; const x = h.toString(16).padStart(8, '0'); return `${x}-${x.slice(0, 4)}-4${x.slice(1, 4)}-a${x.slice(2, 5)}-${(x + x).slice(0, 12)}`; };
const ID = {};
const projects = projectsSpec.map(sp => ({
  cwd: P(sp.name), name: sp.name, exists: true, notes: 0, updated: 0, art: sp.art,
  sessions: sp.chats.map(([k, title, ago, acct]) => {
    ID[k] = uuid(k);
    const s = { id: ID[k], cwd: P(sp.name), autoTitle: title, firstPrompt: title, lastPrompt: null, branch: 'main', title, renamed: false, updated: min(ago), active: ago < 3, sizeKB: 400 + ago, lastOpened: acct === 'codex' ? null : { account: acct, accountName: acctName(acct), at: min(ago + 1), mode: 'app' } };
    if (acct === 'codex') Object.assign(s, { provider: 'codex', model: 'gpt-6-astra', source: 'appServer', created: min(ago + 20), running: false });
    return s;
  }),
}));
for (const p of projects) p.updated = Math.max(...p.sessions.map(s => s.updated));
projects.sort((a, b) => b.updated - a.updated);

const spark = seed => Array.from({ length: 36 }, (_, i) => Math.max(0, Math.round(3 + 3 * Math.sin(i / 3 + seed) + (i > 26 ? 4 : 0) + (i % 5 === 0 ? 2 : 0))));
const activity = [
  { source: 'app', provider: 'claude', key: 'k-nutrient', sessionId: ID['s-nutrient'], title: 'Hydroponics sim: fix nutrient drift', folder: 'Orbital Garden', cwd: P('Orbital Garden'), accountId: 'studio', accountName: 'Studio', state: 'waiting', permissionMode: 'default', phase: 'waiting', tool: 'Bash', detail: 'Run the nutrient tests', lastText: 'I found the drift: the pH correction runs twice per tick. I’ve patched it and want to run the tests.', lastPrompt: 'The nutrient levels drift after an hour of sim time. Find out why.', turnStartedAt: min(4), lastEventAt: min(0.3), finishedAt: null, ok: true, steps: 11, pending: [{ requestId: 'r1', toolName: 'Bash', summary: 'Run the nutrient tests', detail: 'npm test -- --grep nutrient', question: false, canAlways: true }], spark: spark(1) },
  { source: 'app', provider: 'claude', key: 'k-brawl', sessionId: ID['s-brawl'], title: 'Tavern brawl encounter design', folder: 'Starfall Tavern', cwd: P('Starfall Tavern'), accountId: 'studio', accountName: 'Studio', state: 'ready', phase: 'idle', tool: null, detail: null, lastText: 'The brawl now escalates in three beats: shoving, thrown mugs, then the bouncer. Each beat unlocks a new crowd reaction, and the bard can calm the room with a song.', lastPrompt: 'Make the brawl feel like it builds up.', turnStartedAt: min(12), lastEventAt: min(6), finishedAt: min(6), ok: true, steps: 7, pending: [], spark: [] },
  { source: 'app', provider: 'claude', key: 'k-bard', sessionId: ID['s-bard'], title: 'Balance pass on the bard’s songs', folder: 'Starfall Tavern', cwd: P('Starfall Tavern'), accountId: 'studio', accountName: 'Studio', state: 'busy', phase: 'writing', tool: null, detail: null, lastText: 'Rally no longer stacks, and all 14 bard tests pass. Next I’ll look at Lullaby’s sleep duration…', lastPrompt: 'Yes, do it.', turnStartedAt: min(1.6), lastEventAt: min(0.05), finishedAt: null, ok: true, steps: 6, pending: [], spark: spark(2) },
  { source: 'app', provider: 'codex', key: 'k-bard-cx', parentKey: 'k-bard', sessionId: 't-bard-codex', title: 'Codex · Balance pass on the bard’s songs', folder: 'Starfall Tavern', cwd: P('Starfall Tavern'), accountId: 'codex', accountName: 'Codex', state: 'busy', phase: 'tool', tool: 'Image', detail: 'Harvest Festival key art', lastText: '', lastPrompt: 'Make the key art 16:9, no text.', turnStartedAt: min(0.8), lastEventAt: min(0.1), finishedAt: null, ok: true, steps: 1, pending: [], spark: spark(4) },
  { source: 'terminal', provider: 'claude', key: null, sessionId: ID['s-route'], title: 'Route-finding with live traffic', folder: 'Neon Courier', cwd: P('Neon Courier'), accountId: 'personal', accountName: 'Personal', state: 'busy', phase: 'tool', tool: 'Bash', detail: 'npm run build', lastText: 'Building with the new A* heuristic…', lastPrompt: 'Use live traffic in the route-finding.', turnStartedAt: null, lastEventAt: min(0.2), finishedAt: null, ok: true, steps: 9, pending: [], pids: [4120], spark: [] },
];

const usage = {
  studio: { at: NOW, data: { available: true, subscription: 'max', fiveHour: { used: 34, resetsAt: later(2.4) }, week: { used: 46, resetsAt: later(70) }, models: [{ name: 'Fable', used: 18, resetsAt: later(70) }], extra: null }, error: null, checking: false },
  personal: { at: NOW, data: { available: true, subscription: 'max', fiveHour: { used: 8, resetsAt: later(3.8) }, week: { used: 27, resetsAt: later(100) }, models: [], extra: null }, error: null, checking: false },
  codex: { at: NOW, data: { available: true, subscription: 'pro', fiveHour: { used: 15, resetsAt: later(1.2) }, week: { used: 22, resetsAt: later(120) }, models: [], extra: null }, error: null, checking: false },
};

const claudeModels = [
  ['default', 'Default (recommended)', 'Opus 5.5 · Best for everyday, complex tasks', 'claude-opus-5-5'],
  ['opus', 'Opus 5.5', 'For complex work and everyday tasks', 'claude-opus-5-5'],
  ['fable', 'Fable 5.1', 'For your toughest challenges', 'claude-fable-5-1'],
  ['sonnet', 'Sonnet 5.5', 'Most efficient for simpler tasks', 'claude-sonnet-5-5'],
  ['haiku', 'Haiku 5.5', 'Fastest for quick answers', 'claude-haiku-5-5'],
  ['claude-opus-4-8', 'Opus 4.8', 'Best for everyday, complex tasks', 'claude-opus-4-8'],
].map(([value, label, description, resolved]) => ({ value, label, description, resolved, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }));
const codexModels = [
  ['gpt-6-astra', 'GPT-6-Astra', 'Frontier intelligence for the most demanding work.', true],
  ['gpt-6-sol', 'GPT-6-Sol', 'Previous generation workhorse model.', false],
  ['gpt-6-luna', 'GPT-6-Luna', 'Fast and affordable model for easier tasks.', false],
].map(([value, label, description, isDefault]) => ({ value, label, description, isDefault, efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' }));

const bard = P('Starfall Tavern');
const chatInfo = {
  key: 'k-bard', provider: 'claude', sessionId: ID['s-bard'], accountId: 'studio', accountName: 'Studio', state: 'ready', startedAt: iso(min(30)), bufferFrom: iso(min(30)), cwd: bard, fork: false,
  permissionMode: 'acceptEdits', modes: null, title: 'Balance pass on the bard’s songs', folder: 'Starfall Tavern',
  model: 'opus', resolvedModel: 'claude-opus-5-5', replyModel: 'claude-opus-5-5', effort: 'high', models: claudeModels, efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  companionKey: 'k-bard-cx', parentKey: null, attached: false, companionThread: 't-bard-codex',
};
const compInfo = { key: 'k-bard-cx', provider: 'codex', sessionId: 't-bard-codex', accountId: 'codex', accountName: 'Codex', state: 'ready', startedAt: iso(min(0.5)), cwd: bard, permissionMode: 'agent', modes: [{ value: 'ask', label: 'Ask before acting' }, { value: 'agent', label: 'Agent' }], title: 'Codex · Balance pass', folder: 'Starfall Tavern', model: 'gpt-6-astra', resolvedModel: 'gpt-6-astra', effort: 'high', models: codexModels, efforts: ['low', 'medium', 'high', 'xhigh', 'max'], companionKey: null, parentKey: 'k-bard' };
const tool = (id, name, summary, detail, detailKind, result, meta = null) => ({ type: 'tool', id, name, summary, detail, detailKind, title: null, meta, result: { text: result, isError: false, images: [] } });
const claudeHistory = [
  { kind: 'user', at: iso(min(28)), text: 'The bard’s Rally song feels way too strong in co-op. Can you check the numbers and suggest a balance pass?', images: [] },
  { kind: 'assistant', mid: 'm1', at: iso(min(27.6)), model: 'claude-opus-5-5', blocks: [
    tool('t1', 'Read', 'scripts/bard/songs.lua', '{ "file_path": "scripts/bard/songs.lua" }', 'json', 'songs.lua (212 lines)'),
    tool('t2', 'Grep', 'rally_bonus in scripts/', '{ "pattern": "rally_bonus" }', 'json', '3 matches'),
    tool('t3', 'Read', 'data/balance/party.json', '{ "file_path": "data/balance/party.json" }', 'json', 'party.json (88 lines)'),
    { type: 'text', text: 'Rally **stacks with itself**, so four bards in co-op give +60% attack. Here’s the balance pass I’d make:\n\n| Song | Now | Proposed |\n|---|---|---|\n| Rally | +15% attack, stacks | +15% attack, no stacking |\n| Lullaby | 4 s sleep | 3 s sleep |\n| Ballad of Embers | 12 fire damage | 14 fire damage |\n\nShould I make the change in `scripts/bard/songs.lua`?' },
  ] },
  { kind: 'user', at: iso(min(22)), text: 'Yes, do it. And we need new key art for the Harvest Festival update.', images: [] },
  { kind: 'assistant', mid: 'm2', at: iso(min(21)), model: 'claude-opus-5-5', blocks: [
    tool('t4', 'Edit', 'scripts/bard/songs.lua', { old: 'rally.stacks = true\nrally.bonus = 0.15', new: 'rally.stacks = false  -- one Rally per party\nrally.bonus = 0.15' }, 'diff', 'Updated scripts/bard/songs.lua', { path: 'scripts/bard/songs.lua' }),
    tool('t5', 'Bash', 'Run the bard tests', 'npm test -- --grep bard', 'command', '  14 passing (1.2s)'),
    { type: 'text', text: 'Done. Rally no longer stacks, and all **14 bard tests** pass.\n\nFor the key art, here’s a brief you can hand to Codex:\n\n> A cozy tavern on harvest night: lanterns, a bard by the hearth, warm crimson and gold. Wide 16:9, no text.' },
  ] },
];
const artPath = `${bard}\\art\\harvest-festival.png`;
const codexHistory = [
  { kind: 'user', at: iso(min(19)), text: 'Claude said:\n\n> A cozy tavern on harvest night: lanterns, a bard by the hearth, warm crimson and gold. Wide 16:9, no text.\n\nPaint this for the Harvest Festival update.', images: [] },
  { kind: 'assistant', mid: 'cx1:0', blocks: [
    { type: 'image', id: 'ig1', status: 'done', prompt: 'A cozy fantasy tavern on harvest night, lanterns, a bard by the hearth, warm crimson and gold, wide 16:9', path: artPath, src: null },
    { type: 'text', text: 'Here it is. I saved a copy to `art/harvest-festival.png` in the project.' },
  ] },
];

const projInfo = cwd => {
  const p = projects.find(x => x.cwd === cwd) || {};
  const banner = p.art ? `${cwd}\\art\\cover.png` : null;
  return { cwd, banner, bannerPicked: false, docs: [{ path: `${cwd}\\README.md`, name: 'README.md', rel: 'README.md', size: 4000, mtime: min(80), depth: 0 }, { path: `${cwd}\\PATCH-NOTES.md`, name: 'PATCH-NOTES.md', rel: 'PATCH-NOTES.md', size: 2200, mtime: min(30), depth: 0 }], images: banner ? [{ path: banner, name: 'cover.png', rel: 'art/cover.png', size: 900000, mtime: min(200), depth: 1 }] : [], capped: false, today: { docs: p.name === 'Starfall Tavern' ? 2 : 1, images: p.name === 'Starfall Tavern' ? 1 : 0 } };
};
const artFor = p => {
  if (/harvest-festival/i.test(p)) return 'starfall-tavern.png';
  const proj = projects.find(x => p.startsWith(x.cwd));
  return proj && proj.art;
};
const sse = events => events.map(([ev, data, id]) => `${id ? `id: ${id}\n` : ''}event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`).join('');

// Options: state (the chat's state), seen(path, url, body) for every other API call, context (how
// full the chat is), events (more chat events sent after it connects), noHistory (the history
// isn't there yet, as for a brand-new chat).
async function install(b, { live = true, state = 'ready', seen = null, context = null, events = [], noHistory = false } = {}) {
  const info = { ...chatInfo, ...(context ? { context } : {}) };
  let reviews = 0;
  await b.intercept('*/api/*', async (url, method, postData) => {
    const u = new URL(url), q = u.searchParams, p = u.pathname;
    let body = {}; try { body = JSON.parse(postData || '{}'); } catch { /* not JSON */ }
    if (p === '/api/state') return { body: { accounts, prefs: { terminal: 'auto', syncSettings: true, syncState: true, cleanEnv: true, appWindow: true, openIn: 'app' }, claudeCommand: 'claude', dryRun: false, appVersion: '5.3.0', platform: 'win32', index: { done: 18, total: 18, ready: true }, codex } };
    if (p === '/api/sessions') return { body: { projects, skipped: 0, root: 'C:\\Users\\alex\\.claude\\projects', running: { [ID['s-route'].toLowerCase()]: [4120] }, live: { [ID['s-bard'].toLowerCase()]: { key: 'k-bard', accountId: 'studio', accountName: 'Studio' } } } };
    if (p === '/api/activity') return { body: { list: activity, at: NOW } };
    if (p === '/api/usage') return { body: { usage } };
    if (p === '/api/prompts') return null;
    if (p === '/api/project/info') return { body: projInfo(q.get('cwd')) };
    if (p === '/api/image') { const f = artFor(q.get('path') || ''); return f && fs.existsSync(path.join(ART, f)) ? { type: 'image/png', body: fs.readFileSync(path.join(ART, f)) } : { status: 404, body: {} }; }
    if (p === '/api/events') return { type: 'text/event-stream', body: 'retry: 600000\n\n' };
    if (p === '/api/chat/open') return { body: info };
    if (p === '/api/chat/attach') return { body: compInfo };
    if (p === '/api/chat/history' && noHistory) return { status: 404, body: { error: 'That chat wasn’t found. It may have been deleted; refresh the list.' } };
    if (p === '/api/chat/history') return { body: { items: q.get('provider') === 'codex' || q.get('id') === 't-bard-codex' ? codexHistory : claudeHistory, start: 0, cursor: null } };
    if (p === '/api/chat/events') {
      const comp = (q.get('key') || '').includes('cx');
      const evs = [['hello', comp ? compInfo : info]];
      if (live && !comp) evs.push(['chat', { kind: 'state', state, seq: 1 }, 1]);
      if (live && !comp) events.forEach((ev, i) => evs.push(['chat', { ...ev, seq: i + 2 }, i + 2]));
      return { type: 'text/event-stream', body: 'retry: 600000\n\n' + sse(evs) };
    }
    if (p === '/api/chat/model') return { body: { ...info } };
    if (p === '/api/chat/review') { if (seen) seen(p, url, body); return { body: { id: `rv${++reviews}`, what: 'your uncommitted changes', base: body.base || null } }; }
    if (seen) seen(p, url, body);
    return { body: {} };
  });
}

module.exports = { install, ID, projects, accounts };
