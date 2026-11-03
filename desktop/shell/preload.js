'use strict';
// What the app's page can ask of the desktop app, and only the app's own page (127.0.0.1): show the
// window, say what's waiting (the tray, the taskbar, keeping the PC awake), and updates.
const { contextBridge, ipcRenderer } = require('electron');

const ours = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(location.origin);
if (ours) {
  const handlers = { open: null, do: null, update: null, aideShow: null, aideShot: null, aideHidden: null, aidePinned: null, aideMoved: null };
  ipcRenderer.on('desktop:open', (_e, key) => handlers.open && handlers.open(key));
  ipcRenderer.on('desktop:do', (_e, what) => handlers.do && handlers.do(what));
  ipcRenderer.on('desktop:update', (_e, st) => handlers.update && handlers.update(st));
  ipcRenderer.on('aide:show', (_e, v) => handlers.aideShow && handlers.aideShow(v));
  ipcRenderer.on('aide:shot', (_e, v) => handlers.aideShot && handlers.aideShot(v));
  ipcRenderer.on('aide:hidden', () => handlers.aideHidden && handlers.aideHidden());
  ipcRenderer.on('aide:pinned', (_e, v) => handlers.aidePinned && handlers.aidePinned(v));
  ipcRenderer.on('aide:moved', (_e, v) => handlers.aideMoved && handlers.aideMoved(v));
  contextBridge.exposeInMainWorld('desktop', {
    platform: process.platform,
    show: () => ipcRenderer.send('desktop:show'),
    // { needs, working, list: [{ k, t, why }], badge: data URL of the count's picture }
    status: s => ipcRenderer.send('desktop:status', s),
    onOpen: f => { handlers.open = f; },
    onDo: f => { handlers.do = f; ipcRenderer.send('desktop:ready'); },
    onUpdate: f => { handlers.update = f; },
    update: () => ipcRenderer.invoke('desktop:update-state'),
    checkUpdates: () => ipcRenderer.invoke('desktop:check-updates'),
    installUpdate: () => ipcRenderer.invoke('desktop:install-update'),
    settings: () => ipcRenderer.invoke('desktop:settings'),
    set: patch => ipcRenderer.invoke('desktop:set', patch),
    // Companion's panel (desktop/shell/aide.js). Answered only for its own window.
    aide: {
      onShow: f => { handlers.aideShow = f; }, onShot: f => { handlers.aideShot = f; }, onHidden: f => { handlers.aideHidden = f; }, onPinned: f => { handlers.aidePinned = f; }, onMoved: f => { handlers.aideMoved = f; },
      ask: (what, v) => ipcRenderer.invoke('aide:ask', what, v),
    },
  });
}
