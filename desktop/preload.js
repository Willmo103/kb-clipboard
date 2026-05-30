const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getClipboardHistory: (args) => ipcRenderer.invoke('get-clipboard-history', args),
  toggleFavorite: (id) => ipcRenderer.invoke('toggle-favorite', id),
  deleteItem: (id) => ipcRenderer.invoke('delete-item', id),
  clearHistory: (keepFavorites) => ipcRenderer.invoke('clear-history', keepFavorites),
  copyToClipboard: (payload) => ipcRenderer.invoke('copy-to-clipboard', payload),
  openItem: (payload) => ipcRenderer.invoke('open-item', payload),
  exportToJson: (payload) => ipcRenderer.invoke('export-to-json', payload)
});
