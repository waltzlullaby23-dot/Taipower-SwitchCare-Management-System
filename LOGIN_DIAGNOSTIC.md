# v6 登入排查

### Supabase 顯示 Last signed in 有最新時間
代表帳號驗證本身成功。若網站仍停在登入頁，優先檢查：
1. config.js 是否為同一個 Project 的 URL/key
2. GitHub Pages 是否仍快取舊 app.js
3. 瀏覽器 Console 是否有 JavaScript error

v6 已加入 ?v=6 cache bust，且登入頁會把 Supabase 的錯誤直接顯示。

### 登入成功但顯示「資料庫查詢失敗」
代表 Auth 已成功，問題在 PostgreSQL/RLS/Data API。
重新執行 database/schema.sql。

### 正確 Key
`sb_publishable_...`

### 不可放進 GitHub
`sb_secret_...`
`service_role`
