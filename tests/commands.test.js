'use strict';
// The / menu's Claude commands: skills and commands, yours and the folder's, read from their frontmatter.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { list, frontmatter } = require('../lib/commands');

function put(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function world(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-commands-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const claudeDir = path.join(root, 'home', '.claude'), cwd = path.join(root, 'Starfall Tavern');
  fs.mkdirSync(cwd, { recursive: true });
  return { root, claudeDir, cwd };
}

test('commands: skills and commands, yours and the folder’s, with descriptions and hints', t => {
  const { claudeDir, cwd } = world(t);
  put(path.join(claudeDir, 'skills', 'world-feedback', 'SKILL.md'), '---\nname: world-feedback\ndescription: Gather player feedback for a world.\nargument-hint: <world name> [last 3 weeks]\nallowed-tools: Read, Write\n---\n\n# World feedback\n');
  put(path.join(claudeDir, 'skills', 'humanizer', 'SKILL.md'), '---\nname: humanizer\ndescription: |\n  Rewrite AI-sounding text so it reads naturally.\n  Use when editing prose.\nlicense: MIT\n---\nBody\n');
  put(path.join(claudeDir, 'skills', 'hidden-helper', 'SKILL.md'), '---\nname: hidden-helper\ndescription: Only Claude uses this.\nuser-invocable: false\n---\n');
  put(path.join(claudeDir, 'skills', 'synced', 'abc', 'SKILL.md'), '---\nname: deep\n---\n');      // not a skill folder itself
  put(path.join(claudeDir, 'skills', 'no-front', 'SKILL.md'), 'Just do the thing.\n');
  put(path.join(claudeDir, 'commands', 'review.md'), '# Review the open diff\n\nLook at git diff and comment.\n');
  put(path.join(claudeDir, 'commands', 'frontend', 'lint.md'), '---\ndescription: "Lint the \\"web\\" app"\nargument-hint: \'[path]\'\n---\nRun the linter.\n');
  put(path.join(cwd, '.claude', 'skills', 'balance-pass', 'SKILL.md'), '---\ndescription: Rebalance the bard songs.\n---\n');
  put(path.join(cwd, '.claude', 'commands', 'review.md'), '---\ndescription: The tavern’s own review.\n---\n');

  const got = list({ claudeDir, cwd });
  const by = Object.fromEntries(got.map(c => [c.name, c]));
  assert.deepEqual(got.map(c => c.name), ['balance-pass', 'review', 'humanizer', 'lint', 'no-front', 'world-feedback']);
  assert.equal(by['world-feedback'].hint, '<world name> [last 3 weeks]');
  assert.equal(by['world-feedback'].scope, 'yours');
  assert.equal(by['world-feedback'].kind, 'skill');
  assert.equal(by.humanizer.description, 'Rewrite AI-sounding text so it reads naturally. Use when editing prose.');
  assert.equal(by['no-front'].description, 'Just do the thing.');
  assert.equal(by['balance-pass'].scope, 'project');
  assert.equal(by['balance-pass'].name, 'balance-pass', 'a skill without a name is named after its folder');
  assert.equal(by.review.description, 'The tavern’s own review.', 'the folder’s own command wins over yours');
  assert.equal(by.review.scope, 'project');
  assert.equal(by.lint.description, 'Lint the "web" app');
  assert.equal(by.lint.hint, '[path]');
  assert.equal(by.lint.kind, 'command');
  assert.ok(!by['hidden-helper'], 'user-invocable: false stays out of the menu');
  assert.ok(!by.deep, 'only <name>/SKILL.md counts');
});

test('commands: nothing there, no folder, or the home folder itself', t => {
  const { root, claudeDir, cwd } = world(t);
  assert.deepEqual(list({ claudeDir, cwd }), []);
  assert.deepEqual(list({}), []);
  put(path.join(claudeDir, 'skills', 'one', 'SKILL.md'), '---\ndescription: One.\n---\n');
  const home = path.join(root, 'home');
  const got = list({ claudeDir, cwd: home });
  assert.equal(got.length, 1, 'a chat in the home folder doesn’t list your skills twice');
  assert.equal(got[0].scope, 'yours');
});

test('commands: frontmatter edge cases', () => {
  assert.deepEqual(frontmatter('no frontmatter').fields, {});
  assert.equal(frontmatter('﻿---\r\nname: x\r\n---\r\nbody').fields.name, undefined, 'the BOM is stripped by the reader, not here');
  const f = frontmatter('---\r\nname: x\r\ndescription: >-\r\n  folded\r\n  text\r\n---\r\nbody').fields;
  assert.equal(f.name, 'x');
  assert.equal(f.description, 'folded text');
});

test('commands: a long description is shortened, odd names are skipped', t => {
  const { claudeDir } = world(t);
  put(path.join(claudeDir, 'skills', 'long', 'SKILL.md'), `---\ndescription: ${'word '.repeat(100)}\n---\n`);
  put(path.join(claudeDir, 'commands', 'bad name!.md'), 'x');
  const got = list({ claudeDir });
  assert.deepEqual(got.map(c => c.name), ['long']);
  assert.ok(got[0].description.length <= 240 && got[0].description.endsWith('…'));
});
