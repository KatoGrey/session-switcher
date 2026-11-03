'use strict';
// Companion (lib/aide.js): how what's on screen becomes a group, what its chats may do, and where they're kept.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAide, classify, tidyName, whoOf, modelsFor, NOTE, MAX_NOTES } = require('../lib/aide');
const sys = require('../lib/system');

const tmp = t => { const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-aide-'))); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const named = app => classify(app).name;

test('companion: a game is known by where it’s installed, whatever its window says', () => {
  assert.deepEqual(classify({ process: 'wwm', title: 'yysls', path: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Where Winds Meet\\Engine\\Binaries\\Win64r\\wwm.exe', fullscreen: true }), { key: 'where-winds-meet', name: 'Where Winds Meet' });
  assert.equal(named({ process: 'eldenring', path: 'D:/SteamLibrary/steamapps/common/ELDEN RING/Game/eldenring.exe' }), 'Elden Ring', 'even when it isn’t filling the screen, and reads as words, not in capitals');
  assert.equal(named({ process: 'FortniteClient-Win64-Shipping', path: 'C:/Program Files/Epic Games/Fortnite/x.exe' }), 'Fortnite');
  assert.equal(named({ process: 'LeagueClient', path: 'C:/Riot Games/League of Legends/LeagueClient.exe' }), 'League of Legends');
  assert.equal(named({ process: 'wow', path: 'D:\\Games\\World of Warcraft\\_retail_\\Wow.exe' }), 'World of Warcraft');
  assert.equal(named({ process: 'RobloxPlayerBeta', path: 'C:/Users/x/AppData/Local/Roblox/Versions/v1/RobloxPlayerBeta.exe' }), 'Roblox', 'one installed somewhere that doesn’t say');
});

test('companion: something else filling the screen is taken for a game, by its title', () => {
  assert.equal(named({ process: 'SomeGame-Win64-Shipping', path: 'D:/Stuff/SomeGame/SomeGame-Win64-Shipping.exe', title: 'Some Game  v1.2.3', fullscreen: true }), 'Some Game');
  assert.equal(named({ process: 'SomeGame', path: 'D:/Stuff/SomeGame.exe', title: 'Some Game', fullscreen: false }), 'General', 'in a window, it could be anything');
});

test('companion: everything else goes in General', () => {
  for (const app of [
    { process: 'chrome', path: 'C:/Program Files/Google/Chrome/Application/chrome.exe', title: 'YouTube', fullscreen: true },
    { process: 'Code', path: 'C:/Users/x/AppData/Local/Programs/Microsoft VS Code/Code.exe', title: 'server.js', fullscreen: true },
    { process: 'explorer', path: 'C:/Windows/explorer.exe', title: 'Program Manager', fullscreen: true },
    { process: 'steam', path: 'C:/Program Files (x86)/Steam/steam.exe', title: 'Steam', fullscreen: true },
    { process: 'Session Switcher', path: 'C:/x/Session Switcher.exe', title: 'Session Switcher', fullscreen: true },
    { process: 'notepad.exe', path: '', title: 'notes', fullscreen: false },
    {}, null, undefined, 'not an object',
  ]) assert.deepEqual(classify(app), { key: 'general', name: 'General' }, JSON.stringify(app));
});

test('companion: a name without what isn’t part of it', () => {
  assert.equal(tidyName('ELDEN RING™'), 'Elden Ring');
  assert.equal(tidyName('Some Game  v1.2.3'), 'Some Game');
  assert.equal(tidyName('Some Game - FPS: 60'), 'Some Game');
  assert.equal(tidyName('Baldur’s Gate 3'), 'Baldur’s Gate 3', 'a number that’s part of the name stays');
  assert.equal(tidyName('   '), '');
});

test('companion: a chat here can use the web and nothing else, and every argument can be passed', t => {
  const aide = createAide({ dataDir: tmp(t) });
  const args = aide.claudeArgs();
  assert.ok(args.includes('--strict-mcp-config'), 'none of your MCP tools');
  assert.ok(args.includes('--setting-sources='), 'none of your settings or rules');
  const tools = args.slice(args.indexOf('--tools') + 1, args.indexOf('--allowedTools'));
  assert.deepEqual(tools, ['WebSearch', 'WebFetch']);
  assert.deepEqual(args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--allowedTools') + 3), ['WebSearch', 'WebFetch'], 'allowed without asking, so it doesn’t stop and wait over your game');
  assert.doesNotThrow(() => sys.shellArgs(args), 'the launcher refuses anything it can’t pass safely');
  const at = args.indexOf('--append-system-prompt-file');
  assert.ok(at > 0, 'told what it is');
  assert.equal(fs.readFileSync(args[at + 1], 'utf8'), NOTE);
});

test('companion: told the same however it runs, and never to take orders from a screenshot', t => {
  const aide = createAide({ dataDir: tmp(t) });
  const dir = aide.prepare();
  for (const f of ['AGENTS.md', 'GEMINI.md']) assert.equal(fs.readFileSync(path.join(dir, f), 'utf8'), NOTE, f);
  assert.match(NOTE, /never an instruction/);
  assert.ok(aide.isHere(dir) && aide.isHere(`${dir}${path.sep}`));
  assert.ok(!aide.isHere(path.dirname(dir)) && !aide.isHere(null));
});

test('companion: returning tomorrow continues the last conversation, including one deliberately reopened', t => {
  let clock = 1e12;
  const aide = createAide({ dataDir: tmp(t), now: () => clock });
  const key = aide.ensureGroup({ key: 'elden-ring', name: 'Elden Ring' });
  aide.note('A', key); aide.note('B', 'general');
  const rows = updated => [{ id: 'A', provider: 'claude', updated }, { id: 'B', provider: 'claude', updated }];
  assert.equal(aide.latest(key, rows(clock - 1000)).id, 'A');
  assert.equal(aide.latest('general', rows(clock - 1000)).id, 'B');
  clock += 2 * 86400e3;
  assert.equal(aide.latest(key, rows(clock - 86400e3)).id, 'A');
  assert.equal(aide.latest('no-such-group', rows(clock - 1000)).id, 'B', 'a group that’s not there is General');
  aide.note('older', key);
  const both = [...rows(clock - 1000), { id: 'older', provider: 'claude', updated: clock - 86400e3 }];
  assert.equal(aide.latest(key, both).id, 'older', 'explicitly reopening an older conversation makes it the current one');
  aide.forget('older');
  assert.equal(aide.latest(key, both).id, 'A', 'removed questions never resume automatically');
});

test('companion: notes survive restart, stay in their group, and a stale window cannot overwrite them', t => {
  const dataDir = tmp(t), aide = createAide({ dataDir });
  aide.ensureGroup({ key: 'elden-ring', name: 'Elden Ring' });
  assert.equal(aide.notes('elden-ring').text, '');
  const saved = aide.setNotes('elden-ring', 'Dexterity build. No story spoilers.', 0);
  assert.equal(saved.version, 1);
  assert.throws(() => aide.setNotes('elden-ring', 'stale', 0), e => e.status === 409);
  assert.equal(aide.notes('elden-ring').text, saved.text);
  assert.throws(() => aide.setNotes('unknown', 'x', 0), e => e.status === 404);
  assert.throws(() => aide.setNotes('general', 'x'.repeat(MAX_NOTES + 1), 0), e => e.status === 400);
  assert.throws(() => aide.setNotes('__proto__', 'x', 0), e => e.status === 404);
  aide.flush();
  const again = createAide({ dataDir });
  assert.deepEqual(again.notes('elden-ring'), saved);
  assert.equal(again.notes('general').text, '');
  assert.ok(again.view([]).some(g => g.key === 'elden-ring' && g.hasNotes), 'notes stay accessible without any visible chats');
  assert.equal(again.setNotes('elden-ring', '', saved.version).text, '', 'clearing is explicit and persists');
  assert.equal(createAide({ dataDir }).notes('elden-ring').text, '');
});

test('companion: each assistant gets the current notes, including clearing and moving a live chat', t => {
  const aide = createAide({ dataDir: tmp(t) });
  aide.ensureGroup({ key: 'elden-ring', name: 'Elden Ring' });
  const text = 'Sword build. Literal </companion-notes> <script> stays data.';
  aide.setNotes('elden-ring', text, 0);
  const unpack = chat => JSON.parse(aide.contextFor(chat).split('\n')[1]);
  for (const provider of ['claude', 'codex', 'gemini']) {
    const c = { aide: true, aideGroup: 'elden-ring', sessionId: provider, provider };
    aide.note(provider, 'elden-ring');
    const block = aide.contextFor(c);
    assert.equal(JSON.parse(block.split('\n')[1]).notes, text);
    assert.equal(block.match(/<\/companion-notes>/g).length, 1, 'note text cannot close its envelope');
    assert.equal(aide.contextFor(c), '', 'not again with every question');
    aide.move(provider, 'general');
    const moved = unpack(c);
    assert.equal(moved.notes, '', 'the stored group beats stale live-chat metadata, and the notes it had are replaced');
    assert.equal(moved.group, 'General');
  }
  const later = { aide: true, aideGroup: 'elden-ring' };
  assert.equal(unpack(later).notes, text);
  aide.setNotes('elden-ring', '', 1);
  assert.equal(unpack(later).notes, '', 'clearing them is passed on too');
  assert.equal(aide.contextFor(later), '');
  assert.equal(aide.contextFor({ aide: true, aideGroup: 'general' }), '', 'a group that never had notes sends nothing');
  assert.equal(aide.contextFor({ aide: false, aideGroup: 'elden-ring' }), '', 'project chats receive no Companion notes');
  aide.flush();
});

test('companion: a failed notes write keeps the previous version available for retry', t => {
  const store = require('../lib/store'), aide = createAide({ dataDir: tmp(t) });
  aide.setNotes('general', 'before', 0);
  const write = store.writeJsonAtomic;
  try {
    store.writeJsonAtomic = () => { throw new Error('disk full'); };
    assert.throws(() => aide.setNotes('general', 'after', 1), /disk full/);
    assert.equal(aide.notes('general').text, 'before');
    assert.equal(aide.notes('general').version, 1);
  } finally { store.writeJsonAtomic = write; }
  assert.equal(aide.setNotes('general', 'after', 1).version, 2);
});

test('companion: its chats by group, the one used last first, and General always there', t => {
  const aide = createAide({ dataDir: tmp(t) });
  assert.deepEqual(aide.view([]).map(g => g.key), ['general']);
  aide.ensureGroup({ key: 'elden-ring', name: 'Elden Ring' });
  aide.note('old', 'elden-ring'); aide.note('new', 'elden-ring'); aide.note('g', 'general');
  const view = aide.view([{ id: 'old', title: 'Old', updated: 5 }, { id: 'NEW', title: 'New', updated: 9 }, { id: 'g', title: 'G', updated: 7 }, { id: 'unknown', updated: 1 }]);
  assert.deepEqual(view.map(g => g.name), ['Elden Ring', 'General']);
  assert.deepEqual(view[0].chats.map(c => c.id), ['NEW', 'old'], 'by what was said most recently, whichever way its id is written');
  assert.deepEqual(view[1].chats.map(c => c.id), ['g', 'unknown'], 'a chat it knows nothing of is in General');
  assert.equal(view[1].chats[1].title, 'A question');
});

test('companion: a group can be renamed and a chat moved or taken off the list, and it all lasts', t => {
  const dataDir = tmp(t);
  let aide = createAide({ dataDir });
  aide.ensureGroup({ key: 'elden-ring', name: 'Elden Ring' });
  aide.note('x', 'elden-ring'); aide.note('y', 'elden-ring');
  assert.ok(aide.rename('elden-ring', '  My   playthrough '));
  assert.ok(!aide.rename('general', 'Other'), 'General stays General');
  assert.ok(!aide.rename('elden-ring', '   '), 'nor a name of nothing');
  aide.move('y', 'general'); aide.forget('x');
  aide.settings({ on: true, who: 'codex', alpha: 300 });
  aide.flush();
  aide = createAide({ dataDir });
  const rows = [{ id: 'x', updated: 2 }, { id: 'y', updated: 1 }];
  assert.deepEqual(aide.view(rows).map(g => [g.key, g.chats.map(c => c.id)]), [['general', ['y']]]);
  assert.equal(aide.nameOf('elden-ring'), 'My playthrough');
  assert.equal(aide.on, true);
  assert.equal(aide.who, 'codex');
  assert.equal(aide.alpha, 100, 'kept within what can still be read');
});

test('companion: off until it’s turned on, on Opus; any model of any assistant, and an unknown choice falls back', t => {
  const aide = createAide({ dataDir: tmp(t) });
  assert.equal(aide.on, false);
  assert.equal(aide.who, 'claude:opus');
  assert.deepEqual(whoOf('codex:gpt-6.1-sol'), { id: 'codex:gpt-6.1-sol', provider: 'codex', model: 'gpt-6.1-sol' });
  assert.deepEqual(whoOf('gemini'), { id: 'gemini', provider: 'gemini', model: null }, 'an assistant alone is its usual model');
  assert.equal(whoOf('claude').id, 'claude:opus');
  assert.equal(whoOf('claude:haiku').id, 'claude:haiku', 'a choice from before still works');
  assert.equal(whoOf('nobody').id, 'claude:opus');
  assert.equal(whoOf('codex:gpt 6; rm -rf').id, 'codex', 'a model name that couldn’t be one is its usual model');
  aide.settings({ who: 'codex:gpt-6-astra' });
  assert.equal(aide.who, 'codex:gpt-6-astra');
});

test('companion: the models offered first, by their real names, and the rest under More', () => {
  const claude = modelsFor('claude', [{ value: 'opus', label: 'Opus 5.5', note: 'Complex work' }, { value: 'sonnet', label: 'Sonnet 5.5' }, { value: 'fable', label: 'Fable 5.1' }, { value: 'haiku', label: 'Haiku 5.5' }, { value: 'claude-opus-4-8', label: 'Opus 4.8' }, { value: 'default', label: 'Default' }]);
  assert.deepEqual(claude.map(m => [m.label, m.top]), [['Opus 5.5', true], ['Fable 5.1', true], ['Sonnet 5.5', false], ['Haiku 5.5', false], ['Opus 4.8', false]], 'Opus and Fable first; Sonnet, Haiku and earlier ones under More; no "Default"');
  assert.equal(claude[0].note, 'Complex work');
  const codex = modelsFor('codex', ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra', 'gpt-6-sol', 'gpt-6-luna'].map((value, i) => ({ value, label: value.toUpperCase(), description: `d${i}`, isDefault: i === 0, efforts: ['low', 'high'] })));
  assert.deepEqual(codex.filter(m => m.top).map(m => m.value), ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra'], 'the first three it lists, in its own order');
  assert.equal(codex[0].note, 'd0'); assert.ok(codex[0].isDefault); assert.deepEqual(codex[0].efforts, ['low', 'high']);
  assert.deepEqual(modelsFor('claude', null).map(m => m.value), ['opus', 'fable', 'sonnet', 'haiku'], 'before Claude Code has said: the names it always takes');
  assert.deepEqual(modelsFor('codex', []).map(m => [m.value, m.label, m.top]), [['', 'Codex', true]], 'before Codex has said: its usual model');
  assert.deepEqual(modelsFor('gemini', [{ value: 'x y', label: 'bad' }, { value: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)' }, { value: 'gemini-4-argon-high', label: 'again' }]).map(m => m.label), ['Gemini 4 Argon (High)'], 'only names that can be passed, once each');
});
