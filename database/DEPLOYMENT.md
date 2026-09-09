# Supabase 建置順序

1. 建立 Supabase Project。
2. SQL Editor 執行 schema.sql。
3. Authentication 建立登入帳號。
4. Authentication → URL Configuration 設定 GitHub Pages 網址（正式環境使用自己的網域更好）。
5. 將 Project URL 與 anon key 填入 config.js。
6. GitHub Pages 部署。
7. 用登入帳號測試：新增設備 → 領用 → 退庫 → 送檢 → 充電完成 → 查看 audit_log。
