'use strict';
// The installed app's server runs on Electron's Node, which isn't quite plain Node, and these are the differences that
// reach your files. Requiring this first is enough; on plain Node it changes nothing you'd notice.
//
// An .asar file reads as a folder there. A project with a built Electron app in it would be walked into, its insides
// listed as your documents, and it couldn't be deleted. So it's a file, as it is everywhere else.
//
// On Windows, fs.rmSync(folder, { recursive: true }) goes through a junction and deletes what it points at, which may be
// nothing to do with the folder. It also fails with EPERM on a read-only file, which any folder with Git's objects in it
// has, leaving the folder behind. So a recursive delete is done here, one entry at a time: a link is removed as a link,
// and a read-only mark is cleared when it's in the way. (fs.rm and fs.promises.rm get both right.)
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

process.noAsar = true;

const REFUSED = new Set(['EPERM', 'EACCES']);
// Node's own list of what's worth another try, when maxRetries asks for them.
const PASSING = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM']);

function clearing(remove, target, mode) {
  try { return remove(target); } catch (err) {
    if (!REFUSED.has(err.code)) throw err;
    try { fs.chmodSync(target, mode); } catch { throw err; }
    return remove(target);
  }
}
function removeTree(target) {
  const st = fs.lstatSync(target);
  // (lstat: a junction or a link is never a folder here. Removing one leaves what it points at alone.)
  if (st.isSymbolicLink()) {
    try { fs.unlinkSync(target); } catch (err) { if (!REFUSED.has(err.code)) throw err; fs.rmdirSync(target); }
    return;
  }
  if (!st.isDirectory()) return clearing(fs.unlinkSync, target, 0o666);
  for (const name of fs.readdirSync(target)) {
    try { removeTree(path.join(target, name)); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  clearing(fs.rmdirSync, target, 0o777);
}
const pathOf = target => (target instanceof URL ? fileURLToPath(target) : Buffer.isBuffer(target) ? target.toString() : String(target));
function pause(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function install() {
  if (process.platform !== 'win32' || fs.rmSync.safeOnWindows) return;
  const rmSync = fs.rmSync;
  fs.rmSync = function rmSyncSafely(target, options) {
    const opts = options || {};
    if (!opts.recursive) {
      try { return rmSync.call(fs, target, options); } catch (err) {
        if (!REFUSED.has(err.code)) throw err;
        try { fs.chmodSync(target, 0o666); } catch { throw err; }
        return rmSync.call(fs, target, options);
      }
    }
    const file = pathOf(target);
    for (let tries = 0; ; tries++) {
      try { return removeTree(file); } catch (err) {
        if (err.code === 'ENOENT' && opts.force) return undefined;
        if (!PASSING.has(err.code) || tries >= (opts.maxRetries || 0)) throw err;
        pause((opts.retryDelay === undefined ? 100 : opts.retryDelay) * (tries + 1));
      }
    }
  };
  fs.rmSync.safeOnWindows = true;
}
install();

module.exports = { removeTree };
