# Soyofon Desktop Tools

可擴充的 Windows 桌面小工具框架（Electron）。

- 常駐系統匣，從系統匣選單開關各個小工具
- 小工具可直接拖曳移動，位置會自動記住，下次啟動回到原位
- 開機自動啟動（安裝版預設開啟，可在系統匣選單關閉）
- 右鍵小工具：永遠在最上層、鎖定位置、重新載入、隱藏
- 螢幕配置改變時，跑到畫面外的小工具會自動拉回主螢幕

## 內建小工具

| 小工具    | 說明                                                                         |
| --------- | ---------------------------------------------------------------------------- |
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

## 設定視窗

從選單列／系統匣的「設定…」、小工具右鍵選單的「設定…」開啟，或再執行一次程式（例如點兩下捷徑）也會開啟。

- **一般**：開機啟動、鎖定位置、設定檔／資料庫／自訂小工具資料夾位置
- **小工具**：顯示／隱藏、置頂、重設位置、重新掃描
- **資料庫**：建立分類、自訂欄位、編輯資料，提供給小工具使用

## 資料庫

資料存在 `<設定資料夾>/database.json`。在「設定 → 資料庫」建立分類時會指定 **分類代碼**（例如 `ff14-alarms`），
並自訂欄位（文字、多行文字、數字、是／否、日期、時間、下拉選單、資料表、網址）。小工具用分類代碼讀寫資料：

```js
const items = await widget.db.items('ff14-alarms'); // [{ id, data: { name, et_hour, ... }, createdAt, updatedAt }]
await widget.db.add('ff14-alarms', { name: '黑檀木', et_hour: 2 });
await widget.db.update('ff14-alarms', id, { enabled: false });
await widget.db.remove('ff14-alarms', id);
const cats = await widget.db.categories(); // 所有分類與欄位定義
widget.db.onChange(({ categoryId }) => {
  /* 資料變動時重新載入 */
});
```

- 寫入的值會依欄位類型自動轉換（例如數字欄位的 `'8'` 會存成 `8`）
- 時間欄位一律存成 24 小時制 `"HH:MM"`（例如 `"14:30"`）；寫入 `"8:5"` 會變成 `"08:05"`，不合法的時間會存成空字串
- 下拉選單的每個選項有 **顯示文字**（label）與 **實際值**（value），資料庫存的是實際值。
  欄位定義的 `options` 為 `[{ label: '採礦', value: 'miner' }, ...]`（`widget.db.category(id)` 可取得）
  - 小工具寫入時可以傳實際值或顯示文字（`'採礦'` 會存成 `'miner'`），不在選項中的值存成空字串
  - 在設定視窗修改某個選項的實際值，既有資料會自動換成新值；移除選項時舊資料保留，設定視窗會標示「（已移除）」
- 分類與欄位只能在設定視窗建立或修改，小工具只能讀寫資料
- **資料表**欄位連結到另一個分類：設定時選擇資料表、「顯示名稱」欄位與「值」欄位（可選「資料 ID」），
  資料頁籤會以下拉選單列出該資料表的資料，存進資料庫的是「值」。欄位定義為
  `{ type: 'ref', ref: { category, labelKey, valueKey } }`（`valueKey` 為 `'__id'` 時存資料 id）
  - 小工具寫入時可以傳值或顯示名稱；找不到的值存成空字串
  - `await widget.db.options('分類代碼', '欄位代碼')` 取得下拉選單／資料表欄位的選項 `[{ label, value }]`
  - 值選「資料 ID」最穩定；選其他欄位時，若之後修改來源資料的該欄位，舊資料會顯示「（找不到）」
- 設定視窗中的「小工具使用方式」分頁會顯示該分類的範例程式碼

### 匯入／匯出（JSON）

- **匯出**：分類頁右上角「匯出」匯出單一分類；左側「⇡ 匯出全部」匯出所有分類。檔案包含欄位設定與資料。
- **匯入**：左側「⇣ 匯入」選擇 JSON 檔，會先列出檔案中的分類（可取消勾選），分類代碼已存在時可選：
  - **合併**：保留現有資料，加入新欄位與新資料；相同 id 的資料以檔案內容更新
  - **取代**：以檔案的欄位與資料完全取代（會再確認一次）
  - **略過**：不匯入已存在的分類
- 匯入的值會依欄位類型轉換（下拉選單可寫顯示文字、時間可寫 `9:30` 等）

檔案格式：

```json
{
  "format": "soyofon-desktop-tools/database",
  "version": 1,
  "categories": [
    {
      "id": "ff14-alarms",
      "name": "採集鬧鐘",
      "fields": [{ "key": "name", "label": "素材名稱", "type": "text" }],
      "items": [{ "id": "…", "data": { "name": "黑檀木" } }]
    }
  ]
}
```

手寫匯入檔時 `items` 也可以直接寫資料物件，例如 `[{ "name": "黑檀木" }]`。

## FF14 時鐘：素材鬧鈴

時鐘會讀取資料庫中分類代碼為 `ff14-alarms` 的分類（代碼寫在 `widgets/ff14-clock/alarm.js` 的 `CATEGORY_ID`），在**開始時間前 3 分鐘（現實時間）**於時鐘下方彈出通知，
直到結束時間才消失。通知顯示素材名稱、時間範圍、倒數，以及開始→結束的進度條（綠 → 黃 → 紅）。
彈出時會響一聲提示音；點擊通知上的素材名稱可複製名稱；滑鼠移到通知上可按 ✕ 關閉這一次提醒。

時鐘右上角的鈴鐺：鬧鈴分類中有啟用的資料時顯示，旁邊的數字是目前跳出的通知數量。**點擊鈴鐺依序切換 啟用 → 靜音 → 禁用**（設定會被記住）：

| 模式 | 圖示 | 通知 | 提示音 |
| --- | --- | --- | --- |
| 啟用 | 金色鈴鐺，有通知時搖動 | ✓ | ✓ |
| 靜音 | 灰色鈴鐺加斜線 | ✓ | ✗ |
| 禁用 | 淡色鈴鐺加斜線與 OFF | ✗ | ✗ |

欄位依名稱自動對應：

| 用途         | 欄位類型 | 判斷方式                                                                  |
| ------------ | -------- | ------------------------------------------------------------------------- |
| 素材名稱     | 文字     | 名稱含「名稱」，否則第一個文字欄位                                        |
| 時間類型     | 下拉選單 | 名稱含「類型」；值或顯示文字含 `LT`／本地 → 本地時間，其餘 → 艾奧傑亞時間 |
| 開始時間     | 時間     | 名稱含「開始」，否則第一個時間欄位                                        |
| 結束時間     | 時間     | 名稱含「結束」，否則第二個時間欄位                                        |
| 啟用（選填） | 是／否   | 名稱含「啟用／鬧鈴／提醒」；設為否就不提醒                                |

- 結束時間早於開始時間視為跨過午夜（例如 ET 22:00 – 02:00）
- 艾奧傑亞時間一天 = 現實 70 分鐘，同一個素材每 70 分鐘會提醒一次

