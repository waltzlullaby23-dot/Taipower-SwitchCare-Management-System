# SwitchCare v12.0 驗收測試：領用期間持續計算充電週期

## 測試前
使用測試設備或經授權的非關鍵設備，記錄台電編號、last_charge_date、cycle_start_date、next_charge_date，以及最新 charge_records 的 cycle_no、start_date、due_date、status。

## 測試案例
1. **領用不清空日期**：領用在庫設備。預期 state=領用中；cycle_start_date、next_charge_date 保持原值；當前 charge_records 不得改為「因領用中止」。
2. **領用期間到期提醒**：選擇下次充電日在 30 天內或已逾期的領用設備。預期儀表板及充電管理頁列出該設備，顯示領用中與剩餘／逾期天數；不得直接對領用中設備送檢。
3. **未到期退庫**：例如原下次充電日 2027-03-01，2027-01-01 退庫。預期 next_charge_date 仍為 2027-03-01；不以退庫日重設六個月，不新增重複週期。
4. **已逾期後退庫**：例如原下次充電日 2027-03-01，2027-04-01 退庫。預期 next_charge_date 仍為 2027-03-01；立即顯示逾期並列入可送檢批次。
5. **完成充電**：退庫後送檢並登錄實際完成日。預期 last_charge_date=實際完成日；next_charge_date=實際完成日+6個月；舊週期保留為已完成。
6. **移撥出**：移交其他區處後，不列入本處到期提醒與庫存管理。

## 核對 SQL
```sql
select material_no, taipower_no, state, last_charge_date, cycle_start_date, next_charge_date
from public.switches order by taipower_no;

select switch_id, cycle_no, start_date, due_date, status, note
from public.charge_records order by switch_id, cycle_no;
```

領用設備到期時僅提醒；必須先退庫，才可執行送檢。
