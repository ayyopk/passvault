# PassVault v2.1 開發版

正式版本為 v2.1，以使用者提供的 `PassVault_2.1_GitHub_Package.zip` 為基礎完成檢查與修正，2026-10-12 獲使用者確認更新正式網站。v2.0 原始檔與備份標籤保留。

## 現有 GitHub 與 Pages

- Repository：https://github.com/ayyopk/passvault （public）
- 正式分支：main；更新前的 v2.0 提交為 `04f5ef5d863bf5f2f510e8b8b2791250e9d7a3a4`，可用於回退。
- Pages：https://ayyopk.github.io/passvault/ ，從 main 的根目錄 `/` 發佈，legacy build，HTTPS 已啟用。
- v2.0 備份標籤保留，沿用既有 Pages 設定；正式更新由使用者確認後合併 PR 發佈。

## 使用方式

`index.html` 是完整單檔，CSS、JavaScript 都在檔內，不需編譯，電腦可直接雙擊，也可由 GitHub Pages 或本機 HTTP 開啟。
本機另提供同內容的 `PassVault_2.1_Review.html` 方便驗收；使用者原始 `PassVault_2.1.html` 與 ZIP 保持原樣。

電腦：多資料夾看板、新增與編輯、分類、刪除帳密、資料夾新增／改名／變色／收合／單獨檢視、拖曳帳密與排序資料夾、TXT 匯入、搜尋及匯出。

手機：解鎖先顯示分類，只提供跨分類搜尋、查閱、12 秒密碼顯示及複製。寬視窗或 Apple 桌面 UA 仍保持唯讀。背景達 30 秒時，能執行的計時器或回前景事件會鎖定。

新增帳密必須按「✓ 完成新增」才加入看板；取消不影響正式資料。黃色表示新帳密尚未確認加密匯出。
既有帳密直接編輯後立刻標記尚未匯出。刪除資料夾會把其中帳密移到未分類，不刪除帳密。

## 備份與資料

- `.pvault`：相容 schemaVersion 1 的 AES-GCM 加密密碼庫。可讀 v2.0，亦可由 v2.0 加密器解密新版匯出。
- 加密 HTML：包含完整程式與加密資料，可直接開啟並輸入主密碼。匯出使用啟動時的乾淨程式來源，不能序列化解鎖後畫面。
- 舊 HTML：只讀取 embedded-data 或 embedded-vault，惰性解析，不執行匯入檔脚本或載入圖片資源。來源檔不修改。
- TXT：空行分隔帳密區塊；每段依次為標題、帳號、密碼及其後備註。帳號／密碼首尾空白保留。此格式不適合含空白分隔段或多行密碼；此類資料請用 .pvault。
- CSV：明文，預設不含密碼；勾選含密碼時會再次確認。CSV 匯出不視為加密備份。不得將 CSV 上傳 GitHub。

加密下載後，請確認檔案確實儲存再按「已儲存下載檔」。取消、失敗或尚未確認時保留未匯出提示；匯出期間又修改的內容不會被舊快照覆蓋或誤標已備份。
確認下載後仍須由使用者手動將檔案放入 iCloud Drive，沒有後端、雙向同步或自動寫入 iCloud。

## 開發與測試

應用程式不依賴第三方套件。Node 24 與 Playwright 僅用於開發測試。

```powershell
npm ci
$env:PLAYWRIGHT_BROWSERS_PATH="$PWD/node_modules/.cache/ms-playwright"
npx playwright install chromium webkit
npm test
npm run test:browser
npm run test:security
npm run serve
```

預覽 http://127.0.0.1:8080 。Linux 測試可用 `npx playwright install --with-deps chromium webkit`。
`npm run test:security` 需 Git 與 origin/main、v2.0 標籤；必要時先 `git fetch origin main --tags`。

測試檔：

- tests/core.test.mjs：資料驗證、搜尋、安全邊界與加密相容性。
- tests/browser.test.mjs：實際 UI、滑鼠拖曳、下载檔核對、file:// 單檔、Chrome 與 WebKit 手機流程。
- tests/repository.test.mjs：候選追蹤檔及正式 main／v2.0 可達歷史的敏感資料掃描，只輸出路徑及風險類別。
- tests/reference-v2.1.html：無內嵌資料的原始 v2.1 程式，作介面及原 Bug 比較。
- tests/v20-crypto.js：從已驗收 v2.0 原檔擷取的原始加密函式，以虛構資料測雙向相容性。
- tests/baseline-probe.mjs：重現未修改 v2.1 的問題；使用虛構資料，結果在 .maintenance，不是通過／失敗的正式測試命令。

測試結果、已修問題及實機驗收項目見 docs/TEST-REPORT.md、docs/BUG-REPORT.md。新版畫面版本號由 index.html 的 APP_VERSION 提供；測試參考檔中的舊版本常數是歷史基準。

## 安全與回退

GitHub 只放無密碼資料的程式、文件與虛構測試。不要加入 .pvault、含資料的 HTML、CSV、TXT、ZIP、下載或截圖。使用者原始輸入與測試產物均已忽略；提交請列出明確檔名並執行安全掃描，不要盲目 git add .。

應用程式沒有遠端脚本、分析、錯誤回報、fetch API 或第三方字型下載。測試只使用 FAKE-ONLY 與 example.invalid 資料。真正帳密、主密碼、iCloud 檔案不能交给 AI 或加入測試。

若需回退，透過新的回退提交還原 main 的 v2.0 index.html；不 force push、不改密碼庫格式，先保留舊 .pvault。v2.0 不呈現新增的顏色與收合等管理狀態，回退時請保留完整新版備份，避免較新額外欄位在舊版再次匯出時被忽略。
