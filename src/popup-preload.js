// 小工具彈出視窗共用的 preload：取得小工具傳來的資料、複製文字、關閉視窗
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popup', {
  /** 取得開啟時傳入的 data */
  getData: () => ipcRenderer.invoke('popup:get-data'),
  /** 視窗已開啟時，小工具再次 openPopup 會帶入新的 data */
  onData: (fn) => ipcRenderer.on('popup:data', (_e, data) => fn(data)),
  /** 複製文字到系統剪貼簿 */
  copyText: (text) => ipcRenderer.invoke('popup:copy-text', text),
  close: () => ipcRenderer.send('popup:close')
});
