// 小工具彈出視窗共用的 preload：取得小工具傳來的資料、複製文字、關閉視窗
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popup', {
  /** 取得開啟時傳入的 data */
  getData: () => ipcRenderer.invoke('popup:get-data'),
  /** 視窗已開啟時，小工具再次 openPopup 會帶入新的 data */
  onData: (fn) => ipcRenderer.on('popup:data', (_e, data) => fn(data)),
  /** 複製文字到系統剪貼簿 */
  copyText: (text) => ipcRenderer.invoke('popup:copy-text', text),
  /** 讀取系統剪貼簿文字 */
  readText: () => ipcRenderer.invoke('popup:read-text'),
  close: () => ipcRenderer.send('popup:close')
});

// Claude Code 角色（工具儀表盤的聊天、編輯視窗用），與小工具的 widget.agents 相同
contextBridge.exposeInMainWorld('agents', {
  call: async (method, ...args) => {
    try {
      return await ipcRenderer.invoke('agents:call', method, ...args);
    } catch (err) {
      throw new Error(String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  },
  onChanged: (fn) => ipcRenderer.on('agents:changed', (_e, state) => fn(state)),
  onEvent: (fn) => ipcRenderer.on('agents:event', (_e, payload) => fn(payload))
});
