# SwitchCare v5 登入排查

## 如果畫面停留在登入頁
請檢查 config.js：
- SUPABASE_URL 是同一個 Supabase Project 的 URL
- SUPABASE_PUBLISHABLE_KEY 是 `sb_publishable_...`
- 不要使用 `sb_secret_...` 或 `service_role`
- 若誤貼成 `sb_publishable_sb_publishable_...`，v5 會自動修正一次，但仍建議手動改正

## 如果登入成功後出現「資料庫查詢被拒絕」
代表 Auth 成功，但 Data API／RLS 權限還沒完成。
請回 Supabase SQL Editor，再把 database/schema.sql 整份重新 Run 一次。
本版 schema 已補上 authenticated 對 switches / audit_log 的必要資料庫 GRANT。

## 如果 GitHub 顯示的還是舊畫面
新版 index 已經加上 `?v=5` cache-busting。
也可以在瀏覽器按 Ctrl+F5 強制重新整理。

## 判斷是否真的登入成功
Supabase → Authentication → Users → 該帳號：
- Confirmed at 有日期
- Last signed in 有最新時間

這代表 Auth 本身已經接受登入。此時若網站仍不能進主畫面，問題通常在前端載入／資料庫查詢，而不是帳號密碼。
