# SwitchCare Enterprise v8

## 本版目標

這不是在上一版上繼續打補丁，而是重新整理為穩定的企業版核心架構。

### 核心資料模型

- `switches`：設備目前主檔與目前狀態
- `charge_records`：每一個6個月週期的正式充電紀錄
- `usage_records`：每一次領用／退庫的正式紀錄
- `audit_log`：不可破壞式操作稽核紀錄

### 核心規則

1. 新品／舊品入帳：入帳日＋6個月建立第一個充電週期。
2. 在庫：持續倒數。
3. 領用：狀態切換為「領用中」，清除下次充電日，停止充電計時；當期待充電週期標記「因領用中止」。
4. 退庫：視同重新入庫；退庫日為新的週期起算日；建立新的6個月充電週期。
5. 送檢充電：必須登錄ERP充電移撥單號。
6. 充電完成：本次充電紀錄結案，並建立下一個6個月週期。
7. 所有領用、退庫、送檢、充電完成都有 Audit Log。
8. 一般使用者不應直接刪除設備；正式流程以「停用」保留完整歷史。

## v8 主要修正

- 統一 JavaScript 變數命名，避免 `CYCLE` / `CYCLE_MONTHS` 混用。
- 登入改用直接 Supabase REST Auth，避免先前瀏覽器 `fetch headers` 編碼問題。
- 支援 access token refresh。
- 所有自建 HTTP header 均經 ASCII/L1 檢查。
- GitHub Pages 使用 `?v=8` cache bust。
- 新增設備、編輯、領用、退庫、送檢、充電完成全部改用資料庫 RPC。
- 將充電紀錄、領用紀錄與 Audit Log 分開。
- 退庫後確實建立新的6個月週期。
- 充電完成後確實建立新的6個月週期。
- 增加日期邏輯檢查：退庫不得早於領用；充電完成不得早於送檢。
- 新增設備會在同一個資料庫交易內建立主檔、第一個充電週期與Audit Log。
- 新增資料庫的 re-runnable schema，可重複執行。
- 既有設備會嘗試保守回填第一筆 `charge_records`。

## 部署

### A. Supabase

1. Supabase → SQL Editor → New query。
2. 將 `database/schema.sql` 全文貼上。
3. Run。
4. 若成功，應看到 Success。
5. Authentication → Users 確認你的登入帳號存在且已確認。

### B. config.js

填入：

```js
window.SWITCHCARE_CONFIG = {
  SUPABASE_URL: "https://nmqnhzhqjwlbywqsaiwt.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_你的完整Key",
  COMPANY_NAME: "台電",
  CYCLE_MONTHS: 6,
  REMIND_DAYS: 30,
  SESSION_STORAGE_KEY: "switchcare_session_v8"
};
```

不要填 `sb_secret_...` 或 `service_role`。

### C. GitHub Pages

用本版覆蓋：

- `index.html`
- `app.js`
- `style.css`
- `config.js`
- `README.md`

並新增：

- `.nojekyll`（可直接使用現有檔）
- `database/schema.sql`
- `LOGIN_FIX_V8.txt`

然後等待 GitHub Pages 完成部署。

### D. 測試順序

1. Ctrl+F5
2. 登入
3. 系統設定 → 測試資料庫
4. 新增設備
5. 關閉／重新整理
6. 確認設備仍存在
7. 查看設備履歷
8. 領用
9. 確認「下次充電」消失
10. 退庫
11. 確認退庫日＋6個月
12. 送檢
13. 確認移撥單號
14. 充電完成
15. 確認完成日＋6個月
16. 查看充電履歷與Audit Log

## 長期保存

PostgreSQL + transaction records + Audit Log 是長期保存的資料架構，但「永久」仍須搭配資料庫備份策略。

正式企業環境建議依公司資安規範啟用：
- 自動備份
- PITR
- 第二份備份
- 災難復原
- MFA
- 角色權限
- 網域與HTTPS

## 重要

若舊版資料庫已經有資料，重新執行 schema 時不會刪除 `switches` 既有資料；但正式上線前仍建議先做一次完整資料庫備份。


## 本次發版檢查
本版已進行：
- JavaScript `node --check` 語法檢查
- 舊變數名稱混用檢查
- Supabase RPC 對應檢查
- schema 中 switches / charge_records / usage_records / audit_log 檢查
- GitHub Pages cache-busting 檢查

注意：靜態檢查不能取代你實際瀏覽器與 Supabase Project 的整合測試；上線後應依「測試順序」逐項驗證。


## Key naming
v8 only uses `SUPABASE_PUBLISHABLE_KEY`; the older `SUPABASE_ANON_KEY` variable has been removed from the application.
