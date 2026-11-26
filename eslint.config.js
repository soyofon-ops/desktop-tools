// ESLint 設定（flat config）
// - 主程序、preload、腳本、測試：Node.js CommonJS
// - 小工具、設定頁、取色畫面：瀏覽器 <script>，同一頁的多個檔案共用全域變數
const js = require('@eslint/js');
const globals = require('globals');

// 瀏覽器全域變數，但拿掉 name：小工具頂層常宣告 let name，會被誤判成改寫 window.name
const { name: _windowName, ...browser } = globals.browser;

const unusedVars = { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' };

module.exports = [
  { ignores: ['node_modules/**', 'dist/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['error', unusedVars],
      // 刻意比對控制字元（偵測二進位資料、ANSI 跳脫碼、檔名不合法字元）
      'no-control-regex': 'off',
      // 正規表示式裡的 BOM（U+FEFF）是刻意的
      'no-irregular-whitespace': ['error', { skipRegExps: true, skipStrings: true, skipTemplates: true }]
    }
  },
  {
    // preload 同時在 Node 與網頁環境
    files: ['src/**/preload.js', 'src/popup-preload.js'],
    languageOptions: { globals: { ...globals.node, ...browser } }
  },
  {
    files: ['widgets/**/*.js', 'src/settings/settings.js', 'src/picker/overlay.js', 'design/**/capture.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...browser }
    },
    rules: {
      // 頂層宣告會給同一頁的其他 <script> 使用，只檢查函式內的區域變數
      'no-unused-vars': ['error', { ...unusedVars, vars: 'local' }]
    }
  },
  {
    // 也可在 Node 以 require 載入
    files: ['widgets/tool-dashboard/bem-lint.js'],
    languageOptions: { globals: { ...browser, module: 'readonly' } }
  },
  {
    // ff14-clock/index.html 先載入 clock.js，alarm.js 使用它宣告的全域變數
    files: ['widgets/ff14-clock/alarm.js'],
    languageOptions: { globals: { ...browser, EORZEA_MULTIPLIER: 'readonly', pad: 'readonly', clockTickers: 'readonly' } }
  }
];
