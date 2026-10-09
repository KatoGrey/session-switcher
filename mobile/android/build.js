#!/usr/bin/env node
// Builds the Session Switcher Android APK without Gradle:
//   aapt2 compile/link -> javac -> d8 -> aapt add -> zipalign -> apksigner
//
// Usage:  node mobile/android/build.js [--tools-only] [--clean]
//
// Toolchain resolution (first match wins):
//   JDK:          $JAVA_HOME, else a Temurin 17 JDK downloaded to the cache dir
//   Android SDK:  $ANDROID_HOME / $ANDROID_SDK_ROOT (needs build-tools/<v> and platforms/<p>),
//                 else build-tools + platform zips downloaded from dl.google.com to the cache dir
//   Versions:     $BUILD_TOOLS_VERSION (default 34.0.0), $PLATFORM (default android-34)
//   Cache dir:    $SS_BUILD_CACHE, else %LOCALAPPDATA%\SessionSwitcherBuild (~/.cache/SessionSwitcherBuild elsewhere)
// Signing:
//   $KEYSTORE_PATH / $KEYSTORE_PASSWORD / $KEY_ALIAS / $KEY_PASSWORD, else mobile/android/debug.keystore
//   (generated with keytool on first run; password "android", alias "androiddebugkey").
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'build');
const APK_NAME = 'SessionSwitcher.apk';
const IS_WIN = process.platform === 'win32';
const EXE = IS_WIN ? '.exe' : '';
const args = new Set(process.argv.slice(2));

const BUILD_TOOLS_VERSION = process.env.BUILD_TOOLS_VERSION || '34.0.0';
const PLATFORM = process.env.PLATFORM || 'android-34';

const CACHE = process.env.SS_BUILD_CACHE ||
  (IS_WIN
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'SessionSwitcherBuild')
    : path.join(os.homedir(), '.cache', 'SessionSwitcherBuild'));

// Pinned archives from https://dl.google.com/android/repository/repository2-3.xml
const GOOGLE_REPO = 'https://dl.google.com/android/repository/';
const SDK_ARCHIVES = {
  buildTools: {
    '34.0.0': {
      win32: { file: 'build-tools_r34-windows.zip', sha1: '62cfde1b6fcc3ad12a4d2ba1b537e752768bfd47' },
      linux: { file: 'build-tools_r34-linux.zip', sha1: 'd6d58e0c6925a9e4d9a541e84cd1f405c2f9d2a9' },
    },
  },
  platform: {
    'android-34': { file: 'platform-34-ext7_r03.zip', sha1: '1f2e9478d6a7601425ceaa553311dc43191f103d' },
  },
};

function log(msg) { console.log('[build] ' + msg); }
function die(msg) { console.error('[build] ERROR: ' + msg); process.exit(1); }

function run(cmd, cmdArgs, opts = {}) {
  const shown = [path.basename(cmd), ...cmdArgs].join(' ');
  log('$ ' + (shown.length > 300 ? shown.slice(0, 300) + ' ...' : shown));
  const r = spawnSync(cmd, cmdArgs, { stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8', ...opts });
  if (r.error) die(`failed to start ${cmd}: ${r.error.message}`);
  if (r.status !== 0) {
    if (opts.capture) process.stderr.write((r.stdout || '') + (r.stderr || ''));
    die(`${path.basename(cmd)} exited with status ${r.status}`);
  }
  return r;
}

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

// Find the first directory under `dir` (depth <= maxDepth) that contains relative path `marker`.
function findDirWith(dir, marker, maxDepth = 3) {
  if (!fs.existsSync(dir)) return null;
  if (fs.existsSync(path.join(dir, marker))) return dir;
  if (maxDepth <= 0) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const hit = findDirWith(path.join(dir, e.name), marker, maxDepth - 1);
    if (hit) return hit;
  }
  return null;
}

async function download(url, dest, { sha1, sha256 } = {}) {
  const verify = (file) => {
    if (!sha1 && !sha256) return true;
    const h = crypto.createHash(sha256 ? 'sha256' : 'sha1');
    h.update(fs.readFileSync(file));
    return h.digest('hex').toLowerCase() === (sha256 || sha1).toLowerCase();
  };
  if (fs.existsSync(dest) && verify(dest)) { log(`reusing ${path.basename(dest)}`); return; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  log(`downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) die(`download failed (${res.status}) ${url}`);
  const tmp = dest + '.part';
  const fh = fs.openSync(tmp, 'w');
  let got = 0, lastPct = -10;
  const total = Number(res.headers.get('content-length')) || 0;
  for await (const chunk of res.body) {
    fs.writeSync(fh, chunk);
    got += chunk.length;
    if (total) {
      const pct = Math.floor(got * 100 / total);
      if (pct >= lastPct + 10) { lastPct = pct; log(`  ${path.basename(dest)} ${pct}%`); }
    }
  }
  fs.closeSync(fh);
  if (!verify(tmp)) { rmrf(tmp); die(`checksum mismatch for ${url}`); }
  fs.renameSync(tmp, dest);
}

// Extract a zip into a brand-new directory `destDir` (via a temp dir + rename so a crash never
// leaves a half-extracted toolchain that looks complete).
function extractZip(zip, destDir) {
  const tmp = destDir + '.extracting';
  rmrf(tmp);
  fs.mkdirSync(tmp, { recursive: true });
  log(`extracting ${path.basename(zip)} -> ${destDir}`);
  if (IS_WIN) {
    // Windows' bundled bsdtar understands zip; Git Bash's GNU tar does not, so use the System32 one.
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (fs.existsSync(tar)) run(tar, ['-xf', zip, '-C', tmp]);
    else run('powershell.exe', ['-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${tmp}' -Force`]);
  } else {
    run('unzip', ['-q', zip, '-d', tmp]);
  }
  rmrf(destDir);
  fs.renameSync(tmp, destDir);
}

async function ensureJdk() {
  const javacName = 'javac' + EXE;
  if (process.env.JAVA_HOME && fs.existsSync(path.join(process.env.JAVA_HOME, 'bin', javacName))) {
    log(`using JAVA_HOME=${process.env.JAVA_HOME}`);
    return process.env.JAVA_HOME;
  }
  const dir = path.join(CACHE, 'jdk17');
  let home = findDirWith(dir, path.join('bin', javacName));
  if (home) { log(`using cached JDK ${home}`); return home; }
  if (!IS_WIN) die('No JDK found. Set JAVA_HOME to a JDK 17 (auto-download is only implemented for Windows).');
  const api = 'https://api.adoptium.net/v3/assets/latest/17/hotspot?os=windows&architecture=x64&image_type=jdk';
  log('querying Adoptium for the latest Temurin 17 JDK');
  const res = await fetch(api);
  if (!res.ok) die(`Adoptium API failed (${res.status})`);
  const pkg = (await res.json())[0].binary.package;
  const zip = path.join(CACHE, 'downloads', pkg.name);
  await download(pkg.link, zip, { sha256: pkg.checksum });
  extractZip(zip, dir);
  home = findDirWith(dir, path.join('bin', javacName));
  if (!home) die('JDK archive did not contain bin/' + javacName);
  return home;
}

async function ensureSdk() {
  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const aapt2Name = 'aapt2' + EXE;
  let buildTools = null, platformDir = null;

  if (sdkRoot) {
    const bt = path.join(sdkRoot, 'build-tools', BUILD_TOOLS_VERSION);
    const pl = path.join(sdkRoot, 'platforms', PLATFORM);
    if (fs.existsSync(path.join(bt, aapt2Name))) buildTools = bt;
    if (fs.existsSync(path.join(pl, 'android.jar'))) platformDir = pl;
    if (buildTools) log(`using SDK build-tools ${buildTools}`);
    if (platformDir) log(`using SDK platform ${platformDir}`);
  }

  if (!buildTools) {
    const dir = path.join(CACHE, 'build-tools-' + BUILD_TOOLS_VERSION);
    buildTools = findDirWith(dir, aapt2Name);
    if (!buildTools) {
      const spec = (SDK_ARCHIVES.buildTools[BUILD_TOOLS_VERSION] || {})[IS_WIN ? 'win32' : process.platform];
      if (!spec) die(`No pinned download for build-tools ${BUILD_TOOLS_VERSION} on ${process.platform}; set ANDROID_HOME.`);
      const zip = path.join(CACHE, 'downloads', spec.file);
      await download(GOOGLE_REPO + spec.file, zip, { sha1: spec.sha1 });
      extractZip(zip, dir);
      buildTools = findDirWith(dir, aapt2Name);
      if (!buildTools) die('build-tools archive did not contain ' + aapt2Name);
    } else log(`using cached build-tools ${buildTools}`);
  }

  if (!platformDir) {
    const dir = path.join(CACHE, PLATFORM);
    platformDir = findDirWith(dir, 'android.jar');
    if (!platformDir) {
      const spec = SDK_ARCHIVES.platform[PLATFORM];
      if (!spec) die(`No pinned download for platform ${PLATFORM}; set ANDROID_HOME.`);
      const zip = path.join(CACHE, 'downloads', spec.file);
      await download(GOOGLE_REPO + spec.file, zip, { sha1: spec.sha1 });
      extractZip(zip, dir);
      platformDir = findDirWith(dir, 'android.jar');
      if (!platformDir) die('platform archive did not contain android.jar');
    } else log(`using cached platform ${platformDir}`);
  }
  return { buildTools, androidJar: path.join(platformDir, 'android.jar') };
}

function listFiles(dir, ext, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, ext, acc);
    else if (p.endsWith(ext)) acc.push(p);
  }
  return acc;
}

function ensureKeystore(keytool) {
  if (process.env.KEYSTORE_PATH) {
    return {
      ks: process.env.KEYSTORE_PATH,
      pass: process.env.KEYSTORE_PASSWORD || 'android',
      alias: process.env.KEY_ALIAS || 'androiddebugkey',
      keyPass: process.env.KEY_PASSWORD || process.env.KEYSTORE_PASSWORD || 'android',
    };
  }
  const ks = path.join(ROOT, 'debug.keystore');
  if (!fs.existsSync(ks)) {
    log('generating debug.keystore');
    run(keytool, ['-genkeypair', '-noprompt', '-keystore', ks, '-storetype', 'PKCS12',
      '-storepass', 'android', '-keypass', 'android', '-alias', 'androiddebugkey',
      '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
      '-dname', 'CN=Session Switcher Debug, O=Session Switcher, C=US']);
  }
  return { ks, pass: 'android', alias: 'androiddebugkey', keyPass: 'android' };
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const jdk = await ensureJdk();
  const { buildTools, androidJar } = await ensureSdk();
  if (args.has('--tools-only')) { log('toolchain ready'); return; }

  const java = path.join(jdk, 'bin', 'java' + EXE);
  const javac = path.join(jdk, 'bin', 'javac' + EXE);
  const keytool = path.join(jdk, 'bin', 'keytool' + EXE);
  const aapt2 = path.join(buildTools, 'aapt2' + EXE);
  const aapt = path.join(buildTools, 'aapt' + EXE);
  const zipalign = path.join(buildTools, 'zipalign' + EXE);
  const d8Jar = path.join(buildTools, 'lib', 'd8.jar');
  const apksignerJar = path.join(buildTools, 'lib', 'apksigner.jar');
  for (const t of [java, javac, keytool, aapt2, aapt, zipalign, d8Jar, apksignerJar, androidJar]) {
    if (!fs.existsSync(t)) die('missing tool: ' + t);
  }

  // Fresh intermediates every time; the final APK is replaced atomically at the end.
  const tmp = path.join(OUT, 'intermediates');
  rmrf(tmp);
  const dirs = {
    res: path.join(tmp, 'res.zip'),
    gen: path.join(tmp, 'gen'),
    classes: path.join(tmp, 'classes'),
    dex: path.join(tmp, 'dex'),
  };
  for (const d of [dirs.gen, dirs.classes, dirs.dex]) fs.mkdirSync(d, { recursive: true });
  const unsigned = path.join(tmp, 'unsigned.apk');
  const aligned = path.join(tmp, 'aligned.apk');
  const signed = path.join(tmp, APK_NAME);

  // 1. Resources
  run(aapt2, ['compile', '--dir', path.join(ROOT, 'res'), '-o', dirs.res]);
  run(aapt2, ['link', '-o', unsigned,
    '-I', androidJar,
    '--manifest', path.join(ROOT, 'AndroidManifest.xml'),
    '-A', path.join(ROOT, 'assets'),
    '--java', dirs.gen,
    '--min-sdk-version', '24', '--target-sdk-version', '34',
    '--version-code', '5', '--version-name', '5.0.0',
    '--auto-add-overlay',
    dirs.res]);

  // 2. Java -> class files (Java 8 language level; d8 desugars for minSdk 24)
  const sources = [...listFiles(path.join(ROOT, 'src'), '.java'), ...listFiles(dirs.gen, '.java')];
  run(javac, ['-encoding', 'UTF-8', '-source', '8', '-target', '8', '-Xlint:-options', '-Xlint:deprecation',
    '-bootclasspath', androidJar, '-d', dirs.classes, ...sources]);

  // 3. class files -> classes.dex
  const classFiles = listFiles(dirs.classes, '.class');
  run(java, ['-cp', d8Jar, 'com.android.tools.r8.D8', '--release', '--min-api', '24',
    '--lib', androidJar, '--output', dirs.dex, ...classFiles]);
  if (!fs.existsSync(path.join(dirs.dex, 'classes.dex'))) die('d8 produced no classes.dex');

  // 4. Add classes.dex to the APK (aapt add keeps existing entries, e.g. uncompressed resources.arsc)
  run(aapt, ['add', '-k', unsigned, 'classes.dex'], { cwd: dirs.dex, capture: true });

  // 5. Align, sign, verify
  run(zipalign, ['-f', '-p', '4', unsigned, aligned]);
  const key = ensureKeystore(keytool);
  run(java, ['-jar', apksignerJar, 'sign',
    '--ks', key.ks, '--ks-pass', 'pass:' + key.pass,
    '--ks-key-alias', key.alias, '--key-pass', 'pass:' + key.keyPass,
    '--min-sdk-version', '24',
    '--out', signed, aligned]);
  run(java, ['-jar', apksignerJar, 'verify', signed]);

  const finalApk = path.join(OUT, APK_NAME);
  rmrf(finalApk);
  fs.renameSync(signed, finalApk);
  rmrf(signed + '.idsig');
  log(`OK -> ${finalApk} (${(fs.statSync(finalApk).size / 1024).toFixed(1)} KiB)`);
  if (args.has('--clean')) rmrf(tmp);
}

main().catch((e) => die(e && e.stack || String(e)));
