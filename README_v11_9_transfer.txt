SwitchCare v11.9 - 移撥出／移撥入及領用備註顯示

新增：移撥出／移撥入狀態、儀表板可點擊統計、移撥單位與備註資料、領用歷史備註保留及分離設備主檔 remark。

部署：先確認 Supabase 有備份；SQL Editor 執行 database/v11_9_transfer_migration.sql；GitHub Pages 更新 app.js，保留 config.js。本 migration 不刪除既有設備、充電、領用、稽核資料。

目前移撥入只可將本系統已存在且狀態為移撥出的設備移入；未建檔外單位設備的首次移入流程尚未包含。