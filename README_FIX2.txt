SwitchCare v11.2 Fix2

本版修正：
1. 儀表板 high is not defined 錯誤。
2. 文件與證據鏈不再顯示虛構/自動產生的文件資料。
3. 改為「移撥單／文件管理」：移撥單號由作業人員在「送檢充電」時自行輸入。
4. 系統自動依實際 charge_records.transfer_no 彙整同一張移撥單的設備數量。
5. 點擊移撥單號後，依台電編號（公司編號）排序顯示移撥設備明細。
6. 已完成充電後，即使 switches.transfer_no 被清除，歷史移撥單仍可由 charge_records 查到。
7. index.html 改為 v12 cache-busting。

重要：不要覆蓋你 GitHub 目前已填好 Publishable Key 的 config.js。
只替換 app.js、index.html、style.css。
此 Fix2 不需要新增 SQL。
