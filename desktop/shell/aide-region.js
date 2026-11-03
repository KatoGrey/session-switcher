'use strict';
// A frozen screen, shown locally for selection. Only the cropped image returns to the chat.
const path = require('path');

function cropRect(r, size) {
  if (!r || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k])) || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x + r.width > 1.000001 || r.y + r.height > 1.000001) return null;
  const x = Math.floor(r.x * size.width), y = Math.floor(r.y * size.height);
  const width = Math.min(size.width, Math.ceil((r.x + r.width) * size.width)) - x;
  const height = Math.min(size.height, Math.ceil((r.y + r.height) * size.height)) - y;
  return width >= 2 && height >= 2 ? { x, y, width, height } : null;
}

function createRegionPicker({ BrowserWindow, ipcMain, screen }) {
  let active = null;
  function cancel() { if (active) active.finish(null); }
  function pick(image, display) {
    cancel();
    return new Promise(resolve => {
      let selector, timer, done = false;
      const ready = e => {
        if (!selector || e.sender !== selector.webContents || done) return;
        e.sender.send('aide:region-image', image.toDataURL());
      };
      const loaded = e => {
        if (!selector || e.sender !== selector.webContents || done) return;
        clearTimeout(timer);
        selector.show(); selector.moveTop(); selector.focus();
      };
      const selected = (e, rect) => {
        if (!selector || e.sender !== selector.webContents || done) return;
        if (rect === null) { finish(null); return; }
        const crop = cropRect(rect, image.getSize());
        if (!crop) { finish({ error: 'Choose a larger area of the screen.' }); return; }
        try { finish({ image: image.crop(crop) }); }
        catch { finish({ error: 'That area could not be captured. Try again.' }); }
      };
      const changed = (_e, d) => { if (d.id === display.id) finish(null); };
      function finish(result) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ipcMain.removeListener('aide:region-ready', ready);
        ipcMain.removeListener('aide:region-loaded', loaded);
        ipcMain.removeListener('aide:region-selected', selected);
        screen.removeListener('display-removed', changed);
        screen.removeListener('display-metrics-changed', changed);
        if (active && active.finish === finish) active = null;
        if (selector && !selector.isDestroyed()) selector.destroy();
        resolve(result);
      }
      active = { finish };
      try {
        selector = new BrowserWindow({
          ...display.bounds, show: false, frame: false, resizable: false, movable: false,
          backgroundColor: '#171a1d', hasShadow: false, alwaysOnTop: true, skipTaskbar: true,
          minimizable: false, maximizable: false, fullscreenable: false, title: 'Choose a screen region',
          webPreferences: { preload: path.join(__dirname, 'aide-region-preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, spellcheck: false },
        });
        selector.setAlwaysOnTop(true, 'screen-saver');
        if (process.platform === 'darwin') selector.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
        selector.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        selector.webContents.on('will-navigate', e => e.preventDefault());
        selector.webContents.on('will-attach-webview', e => e.preventDefault());
        selector.webContents.on('render-process-gone', () => finish({ error: 'The screen selector closed. Try again.' }));
        selector.once('closed', () => finish(null));
        ipcMain.on('aide:region-ready', ready);
        ipcMain.on('aide:region-loaded', loaded);
        ipcMain.on('aide:region-selected', selected);
        screen.on('display-removed', changed);
        screen.on('display-metrics-changed', changed);
        timer = setTimeout(() => finish({ error: 'The screen selector did not open. Try again.' }), 15000);
        if (timer.unref) timer.unref();
        selector.loadFile(path.join(__dirname, 'aide-region.html')).catch(() => finish({ error: 'The screen selector could not open.' }));
      } catch { finish({ error: 'The screen selector could not open.' }); }
    });
  }
  return { pick, cancel, get active() { return !!active; } };
}

module.exports = { createRegionPicker, cropRect };
