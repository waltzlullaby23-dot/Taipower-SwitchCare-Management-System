# SwitchCare v12.0：領用期間持續計算充電週期

## 業務規則
- 在庫設備：依原週期起算日／上次完成充電日，每六個月充電。
- 領用中：所有權仍屬本處，充電期限持續計算；不清空下次充電日、不暫停、不延後。
- 退庫：沿用原本週期起算日與下次充電日，不以退庫日重新起算六個月。
- 領用期間已到期：系統仍顯示逾期／到期提醒；退庫後列入可送檢設備。
- 移撥出：跨區處所有權移轉，停止納入本處充電管理。
- 完成充電：依實際完成日重新起算下一個六個月週期。
- 送檢中：依實際開單送檢修日作為本次週期基準。

## 部署順序
1. 先匯出／備份 switches、charge_records、usage_records、audit_log。
2. 在 Supabase SQL Editor 執行 `database/v12_0_continuous_charge_cycle_migration.sql`。
3. 確認 SQL 顯示 Success，並檢查目前領用設備的 next_charge_date。
4. 合併本 PR 至 main，等待 GitHub Pages 部署完成。
5. Ctrl+F5 強制更新網站，執行 TEST_PLAN_v12_0_CONTINUOUS_CHARGE.md。

## 資料安全
- Migration 不刪除資料表、不清空設備或履歷。
- 僅修復目前仍在「領用中」且上一週期被舊規則標為「因領用中止」的有效週期。
- 已完成的歷史充電週期不修改。
- 不修改 config.js。
- 本 migration 只需執行一次；不要重跑舊版 migration。
