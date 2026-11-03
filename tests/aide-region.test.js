'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { cropRect, createRegionPicker } = require('../desktop/shell/aide-region');

function setup() {
  const windows = [], ipcMain = new EventEmitter(), screen = new EventEmitter();
  class Window extends EventEmitter {
    constructor(opts) {
      super(); this.opts = opts; this.destroyed = false; this.visible = false;
      this.webContents = new EventEmitter(); this.sent = [];
      this.webContents.send = (...args) => this.sent.push(args);
      this.webContents.setWindowOpenHandler = f => { this.openHandler = f; };
      windows.push(this);
    }
    setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} moveTop() {} focus() {}
    loadFile() { return Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    show() { this.visible = true; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const image = { toDataURL: () => 'data:image/png;base64,LOCAL_ONLY', getSize: () => ({ width: 3840, height: 2160 }), crop: rect => ({ crop: rect, cropped: true }) };
  const display = { id: 2, bounds: { x: -1920, y: 30, width: 1920, height: 1080 }, scaleFactor: 2 };
  const picker = createRegionPicker({ BrowserWindow: Window, ipcMain, screen });
  return { windows, ipcMain, screen, image, display, picker };
}

test('region: normalized coordinates crop the image at its real size, including fractional DPI', () => {
  assert.deepEqual(cropRect({ x: .25, y: .1, width: .5, height: .4 }, { width: 3840, height: 2160 }), { x: 960, y: 216, width: 1920, height: 864 });
  assert.deepEqual(cropRect({ x: .1, y: .2, width: .3, height: .4 }, { width: 1536, height: 864 }), { x: 153, y: 172, width: 462, height: 347 });
  for (const r of [null, {}, { x: NaN, y: 0, width: 1, height: 1 }, { x: -.1, y: 0, width: 1, height: 1 }, { x: .9, y: 0, width: .2, height: 1 }, { x: 0, y: 0, width: 0, height: 1 }, { x: 0, y: 0, width: .0001, height: .0001 }]) assert.equal(cropRect(r, { width: 1920, height: 1080 }), null);
});

test('region: only its own renderer can receive the frozen screen or return a selection', async () => {
  const { picker, windows, ipcMain, image, display } = setup();
  const pending = picker.pick(image, display), w = windows[0];
  assert.equal(w.opts.x, -1920); assert.equal(w.opts.y, 30);
  assert.equal(w.opts.webPreferences.sandbox, true);
  assert.deepEqual(w.openHandler(), { action: 'deny' });
  const stranger = { send: () => assert.fail('screen must not go to another renderer') };
  ipcMain.emit('aide:region-ready', { sender: stranger });
  ipcMain.emit('aide:region-selected', { sender: stranger }, null);
  assert.equal(picker.active, true);
  ipcMain.emit('aide:region-ready', { sender: w.webContents });
  assert.equal(w.sent[0][0], 'aide:region-image');
  assert.equal(w.visible, false, 'no blank window while the screenshot decodes');
  ipcMain.emit('aide:region-loaded', { sender: w.webContents });
  assert.equal(w.visible, true);
  ipcMain.emit('aide:region-selected', { sender: w.webContents }, { x: .25, y: .25, width: .5, height: .5 });
  const result = await pending;
  assert.deepEqual(result, { image: { cropped: true, crop: { x: 960, y: 540, width: 1920, height: 1080 } } });
  assert.equal(w.destroyed, true); assert.equal(picker.active, false);
  assert.equal(ipcMain.listenerCount('aide:region-ready'), 0);
  assert.equal(ipcMain.listenerCount('aide:region-selected'), 0);
});

test('region: cancel, close, a disconnected display and a crashed renderer all release the screen', async () => {
  for (const how of ['cancel', 'close', 'display', 'crash', 'escape']) {
    const { picker, windows, ipcMain, screen, image, display } = setup();
    const pending = picker.pick(image, display), w = windows[0];
    if (how === 'cancel') picker.cancel();
    if (how === 'close') w.destroy();
    if (how === 'display') screen.emit('display-removed', {}, display);
    if (how === 'crash') w.webContents.emit('render-process-gone');
    if (how === 'escape') ipcMain.emit('aide:region-selected', { sender: w.webContents }, null);
    const result = await pending;
    if (how === 'crash') assert.ok(result.error); else assert.equal(result, null);
    assert.equal(picker.active, false); assert.equal(w.destroyed, true);
    assert.equal(ipcMain.eventNames().length, 0); assert.equal(screen.eventNames().length, 0);
  }
});

test('region: a second selection cancels the first; late events cannot choose for the new one', async () => {
  const { picker, windows, ipcMain, image, display } = setup();
  const first = picker.pick(image, display), second = picker.pick(image, display);
  assert.equal(await first, null);
  ipcMain.emit('aide:region-selected', { sender: windows[0].webContents }, null);
  assert.equal(picker.active, true);
  picker.cancel(); assert.equal(await second, null);
});
