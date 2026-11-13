'use strict';
// Latitude's 1Password tokens (lib/onepass.js): reading and writing .env.local, the worktrees' copies, picking an
// item's secret, and the row on This PC. Nothing here talks to 1Password; the check is given a stand-in.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const op = require('../lib/onepass');

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim();
const gone = [];
test.after(() => { for (const d of gone) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = name => { const d = fs.mkdtempSync(path.join(os.tmpdir(), name)); gone.push(d); return d; };

test('.env.local: existing lines are replaced where they are, new ones added once at the end, the rest kept', () => {
  const before = '# Local-only secrets.\r\nLINEAR_AGENT_TOKEN=lin_x\r\nONEPASS_TOKEN=ops_...your_1password_service_account_token\r\n';
  const after = op.mergeEnv(before, { ONEPASS_TOKEN: 'ops_new', ONEPASS_AGENT_TOKEN: 'ops_agent' });
  assert.equal(after, '# Local-only secrets.\r\nLINEAR_AGENT_TOKEN=lin_x\r\nONEPASS_TOKEN=ops_new\r\n\r\n# Latitude’s 1Password tokens (Session Switcher filled these from 1Password: Your work → This PC)\r\nONEPASS_AGENT_TOKEN=ops_agent\r\n', 'its line endings kept');
  assert.deepEqual(op.readEnv(after), { LINEAR_AGENT_TOKEN: 'lin_x', ONEPASS_TOKEN: 'ops_new', ONEPASS_AGENT_TOKEN: 'ops_agent' });
  assert.equal(op.mergeEnv(after, { ONEPASS_TOKEN: 'ops_again' }).match(/Session Switcher filled/g).length, 1);
  assert.equal(op.readEnv('export A="b"\nA=c\n').A, 'b', 'the first one, unquoted');
  for (const v of ['has space', 'quote"', '$(x)', '', 'a\nb']) assert.equal(op.safeValue(v), false, JSON.stringify(v));
  assert.ok(op.safeValue('ops_eyJhbGciOi.abc-_+/='));
});

test('an item’s secret: its password, else a field named for one, else its only concealed field', () => {
  assert.equal(op.secretOf({ fields: [{ id: 'username', value: 'u' }, { id: 'password', purpose: 'PASSWORD', value: 'p' }] }), 'p');
  assert.equal(op.secretOf({ fields: [{ id: 'notesPlain', value: 'n' }, { label: 'credential', type: 'CONCEALED', value: 'c' }] }), 'c');
  assert.equal(op.secretOf({ fields: [{ label: 'other', type: 'CONCEALED', value: 'h' }] }), 'h');
  assert.equal(op.secretOf({ fields: [{ label: 'password', value: '' }] }), null);
  assert.equal(op.secretOf(null), null);
  assert.equal(op.scrub('bad token ops_abcdefghijklmnop and eyJabcdefghijklmnopqrstuvwxyz0123'), 'bad token ops_… and …');
});

test('saving writes the clone’s .env.local (from scratch: the example’s vault ID) and the worktrees’ own copies', async () => {
  const root = tmp('onepass-root-');
  git(root, 'init', '-q'); git(root, 'config', 'user.email', 't@t'); git(root, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(root, '.env.local.example'), 'ONEPASS_TOKEN=ops_...your_token\nONEPASS_VAULT_ID=tj3example\n');
  fs.writeFileSync(path.join(root, 'a.txt'), 'a'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'a');
  const parent = tmp('onepass-trees-');
  const withCopy = path.join(parent, 'has-env'), without = path.join(parent, 'no-env');
  git(root, 'worktree', 'add', '-q', '-b', 'one', withCopy); git(root, 'worktree', 'add', '-q', '-b', 'two', without);
  fs.writeFileSync(path.join(withCopy, '.env.local'), 'LINEAR_AGENT_TOKEN=lin\nONEPASS_TOKEN=ops_old\n');

  await assert.rejects(op.save(root, { ONEPASS_TOKEN: 'has space' }), e => e.status === 400);
  const r = await op.save(root, { ONEPASS_TOKEN: 'ops_new', ONEPASS_CONNECT_TOKEN: 'eyJconnect', ONEPASS_AGENT_TOKEN: 'ops_agent', ONEPASS_AGENT_VAULT_ID: 'agentvault', NOT_OURS: 'x' });
  assert.deepEqual(r.keys.sort(), ['ONEPASS_AGENT_TOKEN', 'ONEPASS_AGENT_VAULT_ID', 'ONEPASS_CONNECT_TOKEN', 'ONEPASS_TOKEN', 'ONEPASS_VAULT_ID']);
  assert.equal(r.worktrees, 1, 'only the worktree that had a copy');
  const main = op.readEnv(fs.readFileSync(path.join(root, '.env.local'), 'utf8'));
  assert.equal(main.ONEPASS_VAULT_ID, 'tj3example');
  assert.equal(main.NOT_OURS, undefined);
  const copy = op.readEnv(fs.readFileSync(path.join(withCopy, '.env.local'), 'utf8'));
  assert.deepEqual([copy.LINEAR_AGENT_TOKEN, copy.ONEPASS_TOKEN, copy.ONEPASS_AGENT_TOKEN], ['lin', 'ops_new', 'ops_agent']);
  assert.ok(!fs.existsSync(path.join(without, '.env.local')), 'one without stays without (Latitude’s scripts read the main checkout’s)');

  // The vault ID stays as it is once it's there.
  fs.writeFileSync(path.join(root, '.env.local'), 'ONEPASS_VAULT_ID=keepme\n');
  await op.save(root, { ONEPASS_TOKEN: 'ops_x' });
  assert.equal(op.readEnv(fs.readFileSync(path.join(root, '.env.local'), 'utf8')).ONEPASS_VAULT_ID, 'keepme');
});

test('the row on This PC: what’s missing, what 1Password refused, and fine only when it accepts them', async () => {
  const root = tmp('onepass-check-');
  const env = { PATH: '', LOCALAPPDATA: root, ProgramFiles: root };
  let asked = 0;
  const say = result => async () => { asked++; return result; };
  let row = await op.check(root, { env, platform: 'win32', verifyFn: say({}) });
  assert.deepEqual([row.id, row.state, row.fix, row.op], ['onepass', 'fix', 'onepass', false]);
  assert.match(row.detail, /no AWS user of your own/);
  assert.match(row.detail, /winget install AgileBits\.1Password\.CLI/, 'how to get the CLI when it isn’t here');
  assert.equal(asked, 0, 'nothing to test while any are missing');

  fs.writeFileSync(path.join(root, '.env.local'), op.KEYS.map(k => `${k}=v_${k}`).join('\n'));
  row = await op.check(root, { env, platform: 'win32', verifyFn: say({ ONEPASS_TOKEN: { ok: false, error: '403 Forbidden' }, ONEPASS_AGENT_TOKEN: { ok: true } }) });
  assert.equal(row.state, 'fix');
  assert.match(row.detail, /ONEPASS_TOKEN: 1Password refused it/);
  row = await op.check(root, { env, platform: 'win32', verifyFn: say({ ONEPASS_TOKEN: { ok: true }, ONEPASS_AGENT_TOKEN: { ok: true }, ONEPASS_VAULT_ID: { ok: true } }) });
  assert.deepEqual([row.state, row.fix], ['ok', null]);
  row = await op.check(root, { env, platform: 'win32', verifyFn: say(null) });
  assert.equal(row.state, 'info', 'dependencies not installed: can’t test');
  assert.ok(!JSON.stringify(row).includes('v_ONEPASS_TOKEN'), 'never a value in the row');

  // The CLI where winget puts it, even when this app started before it was installed.
  const pk = path.join(root, 'Microsoft', 'WinGet', 'Packages', 'AgileBits.1Password.CLI_Microsoft.Winget.Source_8wekyb3d8bbwe');
  fs.mkdirSync(pk, { recursive: true }); fs.writeFileSync(path.join(pk, 'op.exe'), '');
  assert.equal(op.findOp({ env, platform: 'win32' }), path.join(pk, 'op.exe'));
});

test('the test with the clone’s own 1Password library: none installed means “can’t tell”, never a value passed on', async () => {
  const root = tmp('onepass-verify-');
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  assert.equal(await op.verify(root, { ONEPASS_TOKEN: 'ops_abcdefghijklmnop' }, { fresh: true }), null);
  assert.deepEqual(await op.verify(root, { ONEPASS_TOKEN: 'ops_...your_token' }), {}, 'a placeholder isn’t tested');
});
