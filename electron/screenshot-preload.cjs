const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('screenshot', {
  load: () => ipcRenderer.invoke('folio:screenshot-data'),
  finish: bytes => ipcRenderer.send('folio:screenshot-finish', bytes),
});
