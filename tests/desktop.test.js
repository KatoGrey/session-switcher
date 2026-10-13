'use strict';
// The desktop app's own logic, without Electron: which version is newer (test versions included), and
// reading a release's checksums for the Mac's self-update.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// The updater asks Electron for its version; a stand-in is enough here.
const load = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: { getVersion: () => '6.2.0', isPackaged: false } } : load.call(this, req, ...rest); };
const { compare, newer } = require('../desktop/shell/updates');
const { checksums, bundleOf, canSwap } = require('../desktop/shell/macupdate');
Module._load = load;

test('desktop: versions in order, test versions before their release', () => {
  const order = ['6.2.0', '6.3.0-alpha.1', '6.3.0-beta.1', '6.3.0-beta.2', '6.3.0-beta.10', '6.3.0-rc.1', '6.3.0', '6.10.0'];
  for (let i = 1; i < order.length; i++) assert.ok(newer(order[i], order[i - 1]), `${order[i]} > ${order[i - 1]}`);
  assert.equal(compare('v6.2.0', '6.2.0'), 0);
  assert.equal(newer('6.2.0', '6.2.0'), false);
});

test('desktop: a release’s checksums, read without a YAML parser', () => {
  const yml = 'version: 6.3.0\nfiles:\n  - url: SessionSwitcher-6.3.0-mac-arm64.zip\n    sha512: AAA==\n    size: 1\n  - url: SessionSwitcher-6.3.0-mac-x64.zip\n    sha512: BBB==\n    size: 2\npath: SessionSwitcher-6.3.0-mac-arm64.zip\nsha512: AAA==\n';
  assert.deepEqual(checksums(yml), { 'SessionSwitcher-6.3.0-mac-arm64.zip': 'AAA==', 'SessionSwitcher-6.3.0-mac-x64.zip': 'BBB==' });
});

test('desktop: the Mac never swaps itself from the disk image', () => {
  assert.equal(bundleOf('/Applications/Session Switcher.app/Contents/MacOS/Session Switcher'), require('path').resolve('/Applications/Session Switcher.app'));
  assert.equal(canSwap('/Volumes/Session Switcher/Session Switcher.app'), false);
  assert.equal(canSwap('/nowhere/Not an app'), false);
});
