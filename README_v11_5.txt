SwitchCare Enterprise v11.5

本版新增正式文件上傳。
1. 使用者從「移撥單／文件管理」手動選擇 PDF/JPG/PNG/Word/Excel 檔案。
2. 檔案上傳至 Supabase Storage 私有 bucket：switchcare-documents。
3. 文件 metadata 寫入 public.documents，並可關聯移撥單號與設備。
4. 不會自行產生假文件。
5. 需要在 Supabase SQL Editor 執行 database/v11_5_migration.sql 一次。
6. GitHub 更新 app.js、index.html、style.css；config.js 保留目前可正常登入的版本。
