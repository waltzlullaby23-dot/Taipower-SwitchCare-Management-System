SwitchCare Enterprise v11.7

本版重點：
1. 全系統同步「目前檢修週期」：設備一旦開單送檢，當前週期起算日 = 實際開單送檢修日，下一週期 = 送檢日 + 6 個月。
2. 先前已送檢但沿用舊週期的設備，v11_7_migration.sql 會從目前未完成的 charge_records.send_date 回補到 switches。
3. 設備主檔、儀表板設備清單、履歷週期、充電與週期管理、檢修工作台、移撥單明細與設備詳情，全部使用同一套目前週期計算規則。
4. 已完成的歷史充電週期不會改寫。
5. 新的資料庫 Trigger 會保護檢修中設備，避免 current cycle 又被其他更新誤改回舊日期。
6. index.html 版本查詢參數升至 v=17；config.js 的實際內容請沿用目前可正常登入的版本。

部署：
- GitHub：更新 app.js、index.html、style.css；不要覆蓋現有可用的 config.js。
- Supabase：只執行 database/v11_7_migration.sql。歷史 v11_3~v11_6 migration 不要重跑。
