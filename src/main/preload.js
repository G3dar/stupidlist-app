const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stupidlist', {
  isElectron: true,
  getDataPath: () => ipcRenderer.invoke('get-data-path'),
  googleSignIn: () => ipcRenderer.invoke('google-sign-in'),
  onPasteAsItems: (callback) => ipcRenderer.on('paste-as-items', (e, text) => callback(text)),
  onFlushSaves: (callback) => ipcRenderer.on('flush-saves', () => callback()),
  notifyContextMenuHandled: () => ipcRenderer.send('context-menu-handled')
});
