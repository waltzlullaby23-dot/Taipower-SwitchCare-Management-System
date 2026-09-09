# SwitchCare Enterprise v6

本版針對登入與資料庫連線流程重新完整整理。

## 重要修正
- 完整補回所有頁面渲染函式，不再有 `renderLayout is not defined` / `stateOf is not defined` 類型錯誤。
- 使用 Supabase Publishable Key。
- 若 Key 被誤貼成 `sb_publishable_sb_publishable_...`，前端會自動矯正一次。
- 登入成功後若資料庫查詢失敗，會直接顯示錯誤原因。
- GitHub Pages 使用 `?v=6` 避免舊 JavaScript 快取。
- 新增／領用／退庫／送檢／充電完成均有明確錯誤顯示。
- 新增設備儲存按鈕會顯示「儲存中…」，避免重複送出。
- RLS 與 authenticated Data API GRANT 已納入 schema.sql。

## config.js
填入：
- SUPABASE_URL
- SUPABASE_PUBLISHABLE_KEY

只使用 `sb_publishable_...`，不要使用 `sb_secret_...` 或 service_role。

## 首次部署
1. Supabase SQL Editor 重新執行 `database/schema.sql`。
2. Authentication → Users 確認登入帳號存在。
3. GitHub 上傳本專案並覆蓋舊檔。
4. `config.js` 填入你的 Supabase URL 與 Publishable Key。
5. GitHub Pages 重新部署。
6. Ctrl+F5。
7. 登入。
8. Settings → 測試資料庫連線。
