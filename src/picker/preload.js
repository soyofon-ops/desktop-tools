// 取色視窗的 preload：只開放接收畫面、回報選到的顏色或取消
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('picker', {
  /** 收到螢幕畫面 { width, height, bitmap(BGRA) } */
  onInit: (fn) => ipcRenderer.once('picker:init', (_e, data) => fn(data)),
  /** 畫面已畫好，可以顯示視窗 */
  ready: () => ipcRenderer.send('picker:ready'),
  /** 選定顏色，例如 '#1A2B3C' */
  pick: (hex) => ipcRenderer.send('picker:pick', hex),
  cancel: () => ipcRenderer.send('picker:cancel')
});
