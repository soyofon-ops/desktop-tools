// 設定視窗專用 preload
const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, ...args) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (err) {
    throw new Error(String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
}

contextBridge.exposeInMainWorld('settings', {
  getState: () => invoke('settings:get-state'),
  update: (action, payload) => invoke('settings:update', action, payload),
  onState: (fn) => ipcRenderer.on('settings:state', (_e, s) => fn(s)),

  db: {
    categories: () => invoke('db:call', 'listCategories'),
    createCategory: (c) => invoke('db:call', 'createCategory', c),
    updateCategory: (id, patch) => invoke('db:call', 'updateCategory', id, patch),
    deleteCategory: (id) => invoke('db:call', 'deleteCategory', id),
    items: (id) => invoke('db:call', 'listItems', id),
    addItem: (id, data) => invoke('db:call', 'addItem', id, data),
    updateItem: (id, itemId, data) => invoke('db:call', 'updateItem', id, itemId, data),
    removeItem: (id, itemId) => invoke('db:call', 'removeItem', id, itemId),
    moveItem: (id, itemId, to) => invoke('db:call', 'moveItem', id, itemId, to),
    onChange: (fn) => ipcRenderer.on('db:changed', (_e, info) => fn(info))
  }
});
