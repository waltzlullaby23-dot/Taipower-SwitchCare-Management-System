SwitchCare Enterprise v11.3

本版新增／修正：
1. 設備主檔「編輯」：修改入帳日期時，若設備目前為在庫，系統同步重算目前週期起算日與下次充電日＝入帳日＋6個月。
2. 歷史充電紀錄不改寫；只調整目前正在執行的在庫週期。
3. 設備詳細履歷與編輯視窗新增「刪除建檔」。
4. 刪除僅供錯誤建檔；若已有領用紀錄或已完成／送檢中的充電紀錄，資料庫會拒絕刪除。
5. 刪除操作必須二次確認並輸入原因；系統保留「刪除設備」稽核事件。
6. index.html cache-busting 升級為 v13。

部署：
- GitHub：替換 app.js、index.html、style.css（可直接覆蓋 Fix2 的同名檔）。
- config.js：保留你目前 GitHub 已填好的 Supabase URL / Publishable Key，不要用套件內其他 config.js 覆蓋。
- Supabase：需執行 database/v11_3_migration.sql 一次，新增／更新編輯週期與刪除 RPC。
