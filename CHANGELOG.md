# 版本紀錄

## v2.0.1 — 2026-10-11，待驗收、未部署

修改摘要：保留既有操作流程及 schemaVersion 1，修正匯出、草稿、手機鎖定與匯入完整性，拆分靜態模組。

修正項目：

- 不再於加密／儲存前清除黃色提示與 dirty；匯出快照不會誤蓋後續修改。
- 一般下載須確認已儲存；直接寫檔等待成功關閉。提示不宣稱已同步 iCloud。
- 修改後備份狀態、分類計數及更新時間即時更新。
- 取消草稿恢復正確 dirty；未完成草稿仍有離開與鎖定提醒。
- 唯讀裝置不依寬度決定；手機解鎖真正只顯示分類。
- 背景滿 30 秒在計時器或回前景事件鎖定；清除明文 DOM。
- 同日匯出檔名不再只含日期。
- .pvault 與舊 HTML 在開啟前完成驗證，不再默默丟棄資料。
- 新版版本號只有 src/version.js 一個來源；UI、CSS、資料、加密、匯入、匯出、搜尋與測試適度分離。

測試：15 項核心＋17 項瀏覽器流程全部通過；詳見 docs/TEST-RESULTS.md。真實 iPhone Safari、OS 剪貼簿與儲存選擇器待實機驗收。

相容性：AES-GCM 256、PBKDF2-SHA256、250000 iterations、16-byte salt、12-byte IV、Base64 欄位及 schemaVersion 1 不變。新版匯出可由原 v2.0 解密器開啟。既有額外欄位保留；只有 UI 的 appVersion 更新。缺省 iterations 延續原版 250000；不支援版本、非法 Base64、無效型別、重複 ID、孤立分類參照及超過 2000000 的 iterations 會拒絕匯入。拒絕時保留原檔，可用 v2.0 檢視或回退，不自動修補真實資料。

回退：正式 main 仍停在原始 v2.0。原始檔 PassVault_2.0.html 與標籤 v2.0 保留；既有 .pvault、HTML 不需轉換。未來若已發佈修正版，可將 v2.0 原始 HTML 作為 index.html 還原（建議以新的 revert commit，不 force push）。

## v2.0 — 已驗收正式基準

修改摘要：使用者提供的正式原始碼；未修改。

驗收：使用者已完成實際操作驗收；本次保存並核對 SHA-256。

相容性：作為 schemaVersion 1 加密及舊 HTML 匯入的基準。

回退：直接使用原始 PassVault_2.0.html；詳見 BASELINE.md。
