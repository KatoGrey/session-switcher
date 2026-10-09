'use strict';
// Setup & health checks. Each check says what it found in plain words and, when something
// can be fixed from the app, which fix to offer.

const fs = require('fs');
const path = require('path');
const sys = require('./system');
const acc = require('./accounts');

const RECOMMENDED = '2.1.285'; // first version with every feature the app uses (incl. opening chats in the desktop app)

async function runChecks(cfg, sessions) {
  const checks = [];
  const add = c => checks.push(c);

  const node = sys.parseVersion(process.version);
  add({ id: 'node', label: 'Node.js', state: node && node[0] >= 18 ? 'ok' : 'error',
    detail: node && node[0] >= 18 ? `Version ${process.version}.` : `Version ${process.version} is too old. Install the LTS version from nodejs.org.` });

  const cv = await sys.claudeVersion(cfg).catch(() => ({ found: false }));
  if (!cv.found) {
    add({ id: 'claude', label: 'Claude Code', state: 'error',
      detail: `Couldn’t run “${cfg.claudeCommand}”. Install Claude Code, or set its full path below.`, fix: { action: 'set-claude-path', label: 'Set path' } });
  } else {
    const current = sys.versionAtLeast(cv.version, RECOMMENDED);
    add({ id: 'claude', label: 'Claude Code', state: current ? 'ok' : 'warn',
      detail: current ? `Version ${cv.version}.` : `Version ${cv.version}. Some features (like opening chats in the desktop app) need ${RECOMMENDED} or later.`,
      fix: { action: 'update-claude', label: current ? 'Check for update' : 'Update now' } });
  }

  const { projects, skipped } = sessions.scan();
  const chats = projects.reduce((n, p) => n + p.sessions.length, 0);
  add({ id: 'chats', label: 'Chats on this PC', state: chats ? 'ok' : 'warn',
    detail: chats ? `${chats} chats in ${projects.length} folders${skipped ? ` (${skipped} empty files skipped)` : ''}, read from ${sessions.root}.` : `No chats found in ${sessions.root}.` });

  if (sys.IS_WIN) {
    const wt = await sys.hasWindowsTerminal().catch(() => false);
    add({ id: 'terminal', label: 'Terminal', state: 'ok',
      detail: wt ? 'Windows Terminal is installed; chats open in it.' : 'Windows Terminal isn’t installed, so chats open in a classic console window.' });
  }

  const overrides = sys.OVERRIDE_VARS.filter(v => process.env[v]);
  if (overrides.length) {
    add({ id: 'env', label: 'Sign-in overrides', state: cfg.prefs.cleanEnv ? 'ok' : 'warn',
      detail: `${overrides.join(', ')} ${overrides.length > 1 ? 'are' : 'is'} set on this PC. ${cfg.prefs.cleanEnv
        ? 'Session Switcher removes it when opening chats, so the account you pick is the one used.'
        : 'Claude Code will use it instead of the account you pick. Turn on “Use only account sign-ins” below.'}` });
  }

  await Promise.all(cfg.accounts.map(a => acc.verify(cfg, a, { maxAgeMs: 0 }).catch(() => null)));
  for (const a of cfg.accounts) {
    const info = acc.publicAccount(cfg, a);
    let state = 'ok', detail;
    if (!info.signedIn) { state = 'warn'; detail = 'Not signed in.'; }
    else detail = `Signed in as ${info.email || 'unknown'}${info.orgName ? ` to ${info.orgName}` : ''}${info.plan ? ` (${info.plan})` : ''}.`;
    if (info.signedIn && info.authMethod && info.authMethod !== 'claude.ai') { state = 'warn'; detail += ` It’s using ${info.authMethod.replace(/_/g, ' ')}, not a subscription sign-in.`; }
    if (!info.lock.ok) { state = 'error'; detail = info.lockMessage; }
    if (!info.verified) detail += info.verifyError ? ` Claude Code couldn’t confirm this: ${info.verifyError}` : ' Not yet confirmed by Claude Code.';
    add({ id: `acct-${a.id}`, label: a.name, state, detail,
      fix: info.lock.ok && info.signedIn ? null : { action: 'signin', label: info.expectEmail ? `Sign in as ${info.expectEmail}` : 'Sign in', account: a.id } });

    if (!a.isDefault) {
      const separate = info.sharing.filter(s => s.state === 'separate').map(s => s.dir);
      const missing = info.sharing.filter(s => s.state === 'missing').map(s => s.dir);
      if (separate.length) {
        add({ id: `share-${a.id}`, label: `${a.name}: shared data`, state: 'warn',
          detail: `It keeps its own ${separate.join(', ')} instead of sharing yours, so some chats, checkpoints or settings only exist on one side. Fixing merges them into your main folder; nothing is deleted.`,
          fix: { action: 'fix-sharing', label: 'Merge and share', account: a.id } });
      } else if (missing.length) {
        add({ id: `share-${a.id}`, label: `${a.name}: shared data`, state: 'warn',
          detail: `Not linked yet: ${missing.join(', ')}. This happens automatically before the next chat opens.`,
          fix: { action: 'fix-sharing', label: 'Link now', account: a.id } });
      } else {
        add({ id: `share-${a.id}`, label: `${a.name}: shared data`, state: 'ok',
          detail: 'Shares chats, checkpoints, task lists, plans, skills, agents, commands, rules, output styles and plugins with your main account.' });
      }
    }
  }

  if (sys.IS_WIN) {
    const browser = sys.findAppBrowser();
    add({ id: 'window', label: 'App window', state: 'ok',
      detail: browser ? `Opens as its own window using ${path.basename(browser, '.exe') === 'chrome' ? 'Chrome' : 'Edge'}.` : 'Opens in your default browser.' });
  }
  return checks;
}

module.exports = { runChecks, RECOMMENDED };
