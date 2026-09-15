SwitchCare Enterprise v11.4

本版修正：
1. 修正批次送檢失敗：補回 business RPC 使用的 public.log_event helper。
2. 批次送檢改為只處理「逾期」且在庫設備，並要求人工輸入移撥單號，不自動產生單號。
3. 儀表板 8 個 KPI 全部可點擊，開啟對應設備清單。
4. 「開關設備主檔」改為依「料號」分組，再依台電編號列出每具設備。
5. 原有資料不需重建。

部署：
- GitHub：更新 app.js、style.css、index.html。保留目前已正確設定的 config.js。
- Supabase：只執行 database/v11_4_migration.sql，不要刪表、不要重建資料庫。
