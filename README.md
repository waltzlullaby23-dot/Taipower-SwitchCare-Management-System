# SwitchCare Enterprise

## 架構

GitHub Pages
→ Supabase Auth
→ Supabase PostgreSQL
→ RLS
→ audit_log 稽核紀錄

本版不再使用 LocalStorage 做正式資料保存。

## 業務邏輯

1. 新品／舊品入帳：入帳日起算6個月。
2. 在庫：進行6個月充電倒數。
3. 領用／出庫：停止充電計時，清除next_charge_date；領用期間不列入逾期。
4. 退庫：視同重新入庫；退庫日＝新的cycle_start_date；下次充電日＝退庫日＋6個月。
5. 送檢充電：記錄送檢日期與ERP充電移撥單號。
6. 充電完成：實際完成日＝新的cycle_start_date；下一次充電日＝完成日＋6個月。
7. audit_log 永久保留建立、修改、領用、退庫、送檢與充電完成等事件。
8. 不建議刪除設備，正式流程應以「停用」取代刪除。

## 部署

### 1. 建立 Supabase Project
取得 Project URL 與 anon/public key。

### 2. 執行資料庫
打開 Supabase SQL Editor，執行 `database/schema.sql`。

### 3. 設定前端
編輯 `config.js`：

window.SWITCHCARE_CONFIG = {
  SUPABASE_URL: "你的Project URL",
  SUPABASE_ANON_KEY: "你的anon/public key",
  COMPANY_NAME: "台電",
  CYCLE_MONTHS: 6,
  REMIND_DAYS: 30
};

**禁止放 service_role key。**

### 4. 建立登入帳號
Supabase Authentication → Users → 建立使用者。

### 5. GitHub Pages
把專案檔放 Repository 根目錄：
- index.html
- app.js
- style.css
- config.js
- database/
- README.md
- .nojekyll

Settings → Pages → Deploy from a branch → main → / (root)。

## 永久保存注意

「永久」在工程上應理解為長期、可備份、可復原，而不是宇宙意義的絕對永久。

正式企業環境應另外設定：
- 自動備份／Point-in-Time Recovery
- 第二份異地備份
- 權限分層
- MFA
- 操作稽核
- 資料保留政策
- 災難復原演練

Supabase 免費層級與公司正式環境的備份／保留能力不同，正式使用前應依公司資安規範選擇方案。
