# SwitchCare Enterprise v7
本版針對 `Failed to execute 'fetch' ... headers ... non ISO-8859-1 code point` 重新處理。

## 核心修正
- 不再依賴 supabase-js 的登入 fetch；改用直接 Supabase Auth REST API。
- 所有自建 request headers 強制 ASCII/Latin-1。
- Project URL 固定為目前確認的 `https://nmqnhzhqjwlbywqsaiwt.supabase.co`。
- 使用 `sb_publishable_...`。
- GitHub Pages 使用 `?v=7` 避免舊 JavaScript 快取。
- 登入後直接以 access_token 查詢 PostgREST。
- 保留領用停止計時、退庫重新起算6個月、送檢、充電完成、Audit Log。

## 部署
1. GitHub 用本版覆蓋舊 `index.html / app.js / style.css / config.js / README.md`。
2. `database/schema.sql` 整份重新在 Supabase SQL Editor 執行一次。
3. `config.js` 將 `SUPABASE_PUBLISHABLE_KEY` 換成你的完整 `sb_publishable_...`。
4. GitHub Pages 等待部署後 Ctrl+F5。
5. 登入。
6. Settings → 測試資料庫。
