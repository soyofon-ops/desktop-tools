# Soyofon Desktop Tools

可擴充的 Windows 桌面小工具框架（Electron）。

- 常駐系統匣，從系統匣選單開關各個小工具
- 小工具可直接拖曳移動，位置會自動記住，下次啟動回到原位
- 開機自動啟動（安裝版預設開啟，可在系統匣選單關閉）
- 右鍵小工具：永遠在最上層、鎖定位置、重新載入、隱藏
- 螢幕配置改變時，跑到畫面外的小工具會自動拉回主螢幕

## 內建小工具

| 小工具 | 說明 |
| --- | --- |
| FF14 時鐘 | 顯示艾奧傑亞時間（ET）與本地時間（LT），點擊切換主要顯示的時間，選擇會被記住 |

## 開發與打包

需要 [Node.js](https://nodejs.org/) 18 以上與 [pnpm](https://pnpm.io/)（`npm i -g pnpm` 或 `corepack enable`）。

```bash
pnpm install
pnpm start        # 開發模式執行（開發模式不會註冊開機啟動）
pnpm dist     # 打包 → dist/ 內有安裝檔 (NSIS) 與免安裝版 (portable)
```

> 建議在 Windows 上執行 `pnpm dist`。在 macOS 上交叉打包 Windows 版可能需要額外安裝 Wine。

開機自動啟動只對 **安裝版** 生效（免安裝版每次移動 exe 位置後需重新開關一次該選項）。

> 專案已設定好 pnpm：`.npmrc` 使用 `node-linker=hoisted`（electron-builder 打包需要），
> `package.json` 的 `pnpm.onlyBuiltDependencies` 允許 Electron 執行安裝腳本下載執行檔
> （pnpm 10 預設會擋掉，沒設定會出現「Electron failed to install correctly」）。

## 新增小工具

在 `widgets/` 底下（或系統匣「開啟自訂小工具資料夾」，即 `%APPDATA%\Soyofon Desktop Tools\widgets\`，不需重新打包）建立一個資料夾：

```
widgets/my-widget/
├── widget.json
└── index.html      (以及你需要的 js / css)
```

`widget.json`：

```json
{
  "id": "my-widget",
  "name": "我的小工具",
  "entry": "index.html",
  "width": 240,
  "height": 120,
  "defaultEnabled": true
}
```

之後在系統匣點「重新掃描小工具」即可出現。

### 小工具可用的 API

框架會自動處理拖曳與右鍵選單，小工具本身只要寫一般的 HTML/JS：

```js
// 讀取此小工具上次儲存的設定
const { settings, locked } = await window.widget.getState();

// 儲存設定（會與舊設定合併）
window.widget.saveSettings({ foo: 1 });

// 位置鎖定狀態改變時
window.widget.onLockedChange(locked => { ... });
```

- 拖曳與點擊會自動區分：拖曳後不會觸發 `click`，所以可以放心在小工具上綁點擊事件。
- 想讓某個元素不能拖曳（例如滑桿），加上 `data-no-drag` 屬性；`input`、`button` 等表單元素預設就不會觸發拖曳。
- 拖曳中 `<html>` 會有 `widget-dragging` class，可用來改游標樣式。
- 視窗是透明無邊框的，請讓 `html, body` 背景透明，自行畫出面板。

## 設定檔

`%APPDATA%\Soyofon Desktop Tools\config.json`，記錄開機啟動、鎖定狀態，以及每個小工具的開關、位置與自訂設定。

## 艾奧傑亞時間算法

ET 流速是現實的 3600 / 175 倍（1 ET 小時 = 175 秒，1 ET 天 = 70 分鐘），直接以 Unix 時間 × 倍率換算，與遊戲內一致。

## 在 macOS 上執行

同一份程式碼可以直接在 Mac 上跑：

```bash
pnpm install
pnpm start          # 開發模式
pnpm dist:mac   # 打包成 .dmg
```

在 Mac 上的差異：

- 選單在畫面上方的選單列圖示（不是右下角系統匣），且不會出現在 Dock
- 設定檔位置：`~/Library/Application Support/Soyofon Desktop Tools/config.json`
- 開機啟動一樣只在打包後的 App 生效（會加到「系統設定 → 一般 → 登入項目」）
- 沒有簽章的 App 第一次開啟會被 Gatekeeper 擋：在 Finder 對 App 按右鍵 →「打開」即可
