SwitchCare Enterprise v11.6

本版變更：
1. 檢修工作台不再以舊的「週期起算日」作為送檢中的計算基準。
2. 「開單送檢修日」作為檢修週期基準，下一週期日 = 送檢日 + 6個月。
3. 完成充電後，設備回到在庫，下一個在庫週期仍以實際完成充電日 + 6個月重新起算。
4. Supabase 需執行 database/v11_6_migration.sql。
5. GitHub 更新 app.js、index.html、style.css 時，不要覆蓋現有可用的 config.js。
