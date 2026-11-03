'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('regionCapture', {
  ready: f => { ipcRenderer.once('aide:region-image', (_e, data) => f(data)); ipcRenderer.send('aide:region-ready'); },
  shown: () => ipcRenderer.send('aide:region-loaded'),
  select: rect => ipcRenderer.send('aide:region-selected', rect),
});
