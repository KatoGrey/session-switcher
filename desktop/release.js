'use strict';
// Makes a release: `node desktop/release.js 6.0.1` sets that version (the app and the desktop app),
// brings in the newest phone app, commits and tags it. `--push` also pushes, which starts the GitHub
// build (.github/workflows/desktop.yml); the installed copies then update to it.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const version = process.argv[2];
const push = process.argv.includes('--push');
// A test version (6.3.0-beta.1) goes out as a pre-release: only copies set to get test versions take it.
if (!/^\d+\.\d+\.\d+(-(beta|alpha|rc)\.\d+)?$/.test(version || '')) { console.error('Usage: node desktop/release.js 6.3.0 [--push]   (a test version: 6.3.0-beta.1)'); process.exit(1); }
if (git('status', '--porcelain')) { console.error('Commit or put away your changes first.'); process.exit(1); }
if (git('tag', '--list', `v${version}`)) { console.error(`v${version} is already tagged.`); process.exit(1); }
// The notes people see (the release page, and What's new in the app) are docs/whats-new.md: written
// for this version, not left from the last one.
const lastTag = (() => { try { return git('describe', '--tags', '--abbrev=0', '--match', 'v*'); } catch { return null; } })();
if (lastTag && !process.argv.includes('--same-notes') && !git('diff', '--name-only', lastTag, 'HEAD', '--', 'docs/whats-new.md')) {
  console.error(`docs/whats-new.md hasn't changed since ${lastTag}. Write this version's notes there first (or pass --same-notes).`);
  process.exit(1);
}

// The version, in both places.
const srv = path.join(ROOT, 'server.js');
fs.writeFileSync(srv, fs.readFileSync(srv, 'utf8').replace(/const APP_VERSION = '[^']+';/, `const APP_VERSION = '${version}';`));
const pkgFile = path.join(__dirname, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
pkg.version = version;
fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
const lockFile = path.join(__dirname, 'package-lock.json');
if (fs.existsSync(lockFile)) {
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  lock.version = version; if (lock.packages && lock.packages['']) lock.packages[''].version = version;
  fs.writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
}

// The phone app: the newest one built here, if it's newer than the one kept.
const built = path.join(ROOT, 'mobile', 'android', 'build', 'SessionSwitcher.apk');
const kept = path.join(__dirname, 'phone', 'SessionSwitcher.apk');
const code = f => { try { return Number(JSON.parse(fs.readFileSync(`${f}.json`, 'utf8')).code) || 0; } catch { return 0; } };
if (fs.existsSync(built) && code(built) > code(kept)) {
  fs.copyFileSync(built, kept); fs.copyFileSync(`${built}.json`, `${kept}.json`);
  console.log(`Phone app: version ${code(built)}.`);
}

git('add', '-A');
git('commit', '-m', `Release ${version}`);
git('tag', `v${version}`);
console.log(`Tagged v${version}.`);
if (push) {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  git('push', 'origin', branch);
  git('push', 'origin', `v${version}`);
  console.log('Pushed. GitHub is building the installers: https://github.com/KatoGrey/session-switcher/actions');
} else console.log(`Push it with: git push origin HEAD && git push origin v${version}`);
