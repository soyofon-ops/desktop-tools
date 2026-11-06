// 把 preview.html 截成 PNG。
// 用法：./node_modules/.bin/electron --force-device-scale-factor=2 design/tray-icon/capture.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1120, height: 900, show: false, useContentSize: true });
  await win.loadFile(path.join(__dirname, 'preview.html'));
  const height = await win.webContents.executeJavaScript('document.documentElement.scrollHeight');
  win.setContentSize(1120, height);
  await new Promise(r => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'output', 'preview.png'), img.toPNG());
  console.log('captured', img.getSize());
  app.quit();
});
