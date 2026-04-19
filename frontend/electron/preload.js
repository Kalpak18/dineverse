const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  // Send a new-order OS notification
  notifyNewOrder: (title, body) =>
    ipcRenderer.send('new-order-notification', { title, body }),

  // Get host OS platform
  getPlatform: () => ipcRenderer.invoke('get-platform'),

  // Register a React Router navigate callback so main can deep-link
  registerNavigate: (fn) => { window.__electronNavigate = fn; },
});
