SwitchCare v11.8 密碼復原修正

本修正版以使用者提供的 SwitchCare Enterprise v11.7 app.js 為基礎，只修改前端登入／密碼復原流程。

修改內容：
1. 登入頁新增「忘記密碼？」入口。
2. 使用 Supabase Auth /recover 寄送重設郵件，並明確指定正式 GitHub Pages redirect URL。
3. 支援 Supabase Recovery URL fragment access_token / refresh_token / type=recovery。
4. 支援 query token_hash / type=recovery 驗證方式。
5. 驗證成功後顯示設定新密碼頁，透過 PUT /auth/v1/user 更新密碼。
6. 已過期或已使用的 OTP 顯示可理解的錯誤訊息，不再導向 localhost。
7. 不修改資料表、RPC、設備資料、充電紀錄、履歷或 Supabase Migration。

部署方式：
1. 解壓縮本 ZIP。
2. 將其中 app.js 覆蓋 GitHub Repository 根目錄的 app.js。
3. 不要覆蓋 config.js；保留目前已設定好的 Supabase URL 與 Publishable Key。
4. 不需要執行任何 SQL Migration。
5. GitHub Pages 部署完成後，開啟正式網站並按 Ctrl+F5 強制重新整理。
6. 登入頁按「忘記密碼？」輸入帳號 Email，重新寄送密碼重設信。
7. 只使用最新一封郵件中的連結；連結應回到正式 GitHub Pages 網址，而非 localhost:3000。
8. 設定新密碼後，回到登入頁使用新密碼登入。

重要：
- 此版程式將 Recovery redirect URL 固定為：
  https://waltzlullaby23-dot.github.io/Taipower-SwitchCare-Management-System/
- 此版前端程式碼已通過 Node.js 語法檢查，但仍須在正式 Supabase 專案完成實際寄信與更新密碼測試。
- 若郵件連結仍導向 localhost，請檢查 Supabase Authentication > Email Templates 中的重設密碼郵件連結設定，確認使用 Supabase 的 ConfirmationURL/RedirectTo 機制，不要寫死 localhost:3000。
