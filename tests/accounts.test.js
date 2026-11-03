'use strict';
// Extra accounts keep one CLAUDE.md: a link to the main account's file, made when the account is created
// and put in place of an older copy when settings are kept in step. Settings files are still copied.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The accounts module reads the home folder once when it loads, so it gets a throwaway one.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-accounts-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
const accounts = require('../lib/accounts');

const main = path.join(home, '.claude');
fs.mkdirSync(main, { recursive: true });
fs.writeFileSync(path.join(main, 'CLAUDE.md'), '# rules\n');
fs.writeFileSync(path.join(main, 'settings.json'), '{"model":"opus"}\n');
const cfg = accounts.loadConfig(path.join(home, 'no-such-config.json'));
const mainRules = path.join(main, 'CLAUDE.md');

// Windows needs developer mode for file symlinks; without it the module copies, and these checks don't apply.
const canLink = (() => {
  const probe = path.join(home, 'probe-link');
  try { fs.symlinkSync(mainRules, probe, 'file'); fs.unlinkSync(probe); return true; } catch { return false; }
})();
const skip = !canLink && 'file symlinks aren’t allowed here';

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test('accounts: a new account links CLAUDE.md to the main copy and copies settings', { skip }, () => {
  const { account } = accounts.createAccount(cfg, 'Spare');
  const rules = path.join(account.configDir, 'CLAUDE.md');
  assert.ok(fs.lstatSync(rules).isSymbolicLink());
  assert.equal(fs.realpathSync(rules), fs.realpathSync(mainRules));
  assert.ok(fs.lstatSync(path.join(account.configDir, 'settings.json')).isFile());
  assert.deepEqual(accounts.syncSettings(cfg, account), []);
});

test('accounts: an older copy of CLAUDE.md becomes a link, keeping a backup', { skip }, () => {
  const a = { id: 'old', name: 'Old', configDir: path.join(home, '.claude-old') };
  fs.mkdirSync(a.configDir, { recursive: true });
  fs.writeFileSync(path.join(a.configDir, 'CLAUDE.md'), '# older rules\n');
  assert.ok(accounts.syncSettings(cfg, a).includes('CLAUDE.md'));
  const rules = path.join(a.configDir, 'CLAUDE.md');
  assert.ok(fs.lstatSync(rules).isSymbolicLink());
  assert.equal(fs.readFileSync(rules, 'utf8'), '# rules\n');
  assert.equal(fs.readFileSync(`${rules}.switcher-bak`, 'utf8'), '# older rules\n');
  assert.deepEqual(accounts.syncSettings(cfg, a), []);
});
