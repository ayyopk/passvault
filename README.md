# PassVault

正式版本仍為 **v2.0**。此維護分支為 **v2.0.2 待驗收版**，尚未更新 GitHub Pages。

在電腦上可直接雙擊 **PassVault_2.0.2.html** 使用，保留原版單檔操作方式。不要直接雙擊 index.html；它是 GitHub Pages 與本機 HTTP 預覽的模組入口。

Windows 負責編輯與匯出；iPhone 只搜尋、查閱與複製。密碼庫只在本機記憶體解密，使用者手動將加密 .pvault 放入 iCloud Drive，沒有後端或自動同步。

## 專案結構

```
index.html             新版靜態入口
styles/app.css         既有介面樣式
src/app.js             UI 與事件協調
src/model.js           資料驗證、草稿、修改及內容快照
src/crypto.js          相容 schema 1 的 AES-GCM／PBKDF2
src/import.js          加密檔與舊 HTML 讀取
src/export.js          匯出快照、確認及檔名
src/search.js          跨分類搜尋
src/platform.js        唯讀裝置政策及背景鎖定
src/version.js         新版版本號唯一來源
PassVault_2.0.2.html    從相同原始碼產生的單檔，支援直接雙擊
scripts/build.mjs      產生新版單檔；不讀取任何密碼庫
tests/                 完全虛構的自動化測試
PassVault_2.0.html      保留原樣的正式基準
docs/REVIEW.md         問題清單及修正計畫
docs/TEST-RESULTS.md    驗證結果與待驗收事項
CHANGELOG.md           相容性與回退說明
```

原始基準的 2.0 字串和測試中的舊版本資料是歷史證據，不能隨新版版本號一起改動。

## 本機預覽與測試

Node 24 或更新版本。執行期沒有外部套件；Playwright 僅用於開發測試。

```powershell
npm ci
npx playwright install chromium webkit
npm run build
npm test
npm run test:browser
npm run serve
```

预覽 http://127.0.0.1:8080 。index.html 使用標準 JavaScript modules，須以 HTTP(S) 開啟；直接雙擊時會顯示啟動提示。PassVault_2.0.2.html 內含相同 CSS 與程式，不依賴外部檔案，可直接以 file:// 開啟。原 v2.0 單檔仍保留作回退。

修改模組或樣式後執行 npm run build 再測試。版本號仍只有 src/version.js 一個來源，產出的單檔不手動修改。核心測試會比對產物，避免單檔與模組版不同步。

測試瀏覽器亦可裝在專案內：先設定 `$env:PLAYWRIGHT_BROWSERS_PATH="$PWD/node_modules/.cache/ms-playwright"` 再 install 與 test。截圖在 test-results，所有產物均忽略，不加入 Git。

## 匯出操作

新增先按「✓ 完成新增」才出現在分類。黃色代表新資料尚未確認匯出。
支援直接寫檔的 Windows Chrome 會顯示儲存選擇器；寫入完成才更新狀態。
一般下載須在確認視窗按「已儲存下載檔」；取消或未儲存保留未匯出提示。
「已確認匯出」只表示本次內容已儲存／確認下載，使用者仍須手動搬到 iCloud。

## GitHub Pages 發佈與回退

使用相對路徑，GitHub Pages 專案子路徑可直接部署，不需打包。
只有在使用者驗收並確認後才合併維護 PR 到正式 main，再按既有 Pages 設定發佈。需同時提供 index.html、src/ 與 styles/。
此輪只備份 maintenance/v2.0.1 維護分支（含後續 v2.0.2 修正）與各版本標籤，不改 Pages 設定、main 或啟用自動合併。
回退用原始 PassVault_2.0.html 作為 index.html；保留 .pvault 原檔不變。

## 資料安全

Git 不放真實密碼、任何 .pvault、明文 CSV 或含密碼的舊 HTML。這些檔案和一般 HTML 匯入檔已由 .gitignore 忽略，但仍須在 commit 前檢查明確檔名；不要使用 git add .。只保留已確認無內嵌資料的入口、基準及產生的新版單檔 HTML。

不要將真實帳密加入測試、記錄、截圖、錯誤回報、AI 或外部服務。測試只使用 FAKE-ONLY 與 example.invalid 資料。應用程式不記錄密碼，不使用分析、第三方字型、遠端脚本或執行期 API。
