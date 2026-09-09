# SwitchCare Enterprise v4

台電自動線路開關生命週期與定期充電管理系統。

## 本版針對「新增設備儲存無反應」的修正

上一版的根本問題之一是：前端在 `config.js` 沒有 Supabase 設定時，仍然先顯示完整操作介面；使用者按「儲存」後才呼叫 `db.from(...)`，此時 `db` 其實是 `null`，因此操作會失敗。

v4 改成：

1. 沒有 Supabase 設定 → 顯示資料庫設定提示，不讓使用者輸入後才失敗。
2. 有 Supabase 但未登入 → 先顯示登入頁。
3. 已登入 → 才進入正式設備管理介面。
4. 儲存按鈕在送出期間會鎖定並顯示「儲存中…」。
5. API／RLS 錯誤會留在表單中顯示，不會讓視窗假死。
6. `Esc`、右上角 `×`、點擊灰色背景均可關閉 Modal。

## 業務規則

- 新品／舊品入帳：入帳日起算6個月。
- 在庫：執行6個月充電倒數與30天預警。
- 領用／出庫：停止充電計時，領用期間不列入逾期。
- 退庫：視同重新入庫，退庫日為新的週期起算日。
- 送檢充電：記錄送檢日期與ERP充電移撥單號。
- 充電完成：實際完成日＋6個月建立下一個週期。
- audit_log 保留生命週期異動。

## 部署

1. 建立 Supabase Project。
2. 在 Supabase SQL Editor 執行 `database/schema.sql`。
3. Authentication → Users → 建立 Email/Password 使用者。
4. 編輯 `config.js`，填入 Project URL 與 anon/public key。
5. **絕對不要**把 service_role key 放到 GitHub。
6. 將整個專案放在 GitHub Repository 根目錄。
7. Settings → Pages → Deploy from a branch → main → / (root)。

## 正式長期保存

PostgreSQL 提供正式資料庫保存；正式企業環境仍須另外啟用自動備份、PITR／復原能力、第二份備份、MFA、權限分層、災難復原與公司資安核准流程。


## v5 修正
- 新版登入錯誤會直接顯示。
- 支援 Supabase Publishable Key。
- 防止 publishable prefix 重複輸入造成登入異常。
- 補足 authenticated 的 Data API GRANT。
- GitHub Pages 加入 cache bust，避免舊 app.js 被快取。
- 登入成功但資料庫查詢失敗時會顯示明確的 RLS/權限診斷。
