# SwitchCare v12.1 更新說明

## 本次更新
1. 移除沒有檢測依據、預設為 85 分的平均健康度及健康分數欄位。
2. 風險標示只依充電週期：逾期＝高、30 日內到期＝中，其餘＝低。
3. 目前在庫統計只計算所有權屬本處且狀態為「在庫」的設備，包含移撥入本處設備，不重複加總。
4. 新增側邊「發料／收料文件管理」。
   - 發料單依 usage_records.issue_no 彙整。
   - 收料單依 usage_records.return_document_no 彙整。
   - 點選單號可查看公司／台電編號、料號、型式、領用單位、發料／退庫日期、備註及設備數量。
5. 退庫單號不再覆寫原發料單號；原充電週期及下次充電日不變。
6. 原「移撥單／文件管理」與 Supabase Storage 上傳功能保留。

## 部署順序
1. 先備份 Supabase。
2. Supabase SQL Editor 執行 database/v12_1_issue_receipt_documents_migration.sql 一次。
3. 確認 SQL 成功後，合併本 PR 到 main。
4. 等 GitHub Pages 部署完成，Ctrl+F5 重新整理。

不需覆蓋 config.js。Migration 不刪除資料表、不清空資料、不重寫舊發料單號。

注意：舊版退庫流程曾可能把 issue_no 改成退庫單號，這類舊資料無法可靠自動還原；v12.1 起新資料會將發料與收料單號分欄保存。
