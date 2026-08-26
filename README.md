# 生活進度簿 V4 — Supabase 雲端同步版

V4 保留 V3.2 的全部功能，新增：

- Email / Password 登入
- 手機、平板、電腦共用同一份資料
- Supabase `user_state` 雲端同步
- localStorage 本機備份
- 離線時仍可操作
- 回到網路後自動補同步
- 手動「立即同步」
- 每 45 秒（App 在前景且本機沒有未同步修改時）檢查雲端
- 回到 App 前景時自動同步
- V3 / V3.1 / V3.2 本機資料自動升級
- PWA 基礎設定，可在 HTTPS 上線後加到手機 / 平板主畫面

---

## ① 先填 config.js

用記事本或 VS Code 打開：

`config.js`

把：

```js
SUPABASE_URL: "YOUR_SUPABASE_PROJECT_URL",
SUPABASE_PUBLISHABLE_KEY: "YOUR_SUPABASE_PUBLISHABLE_KEY"
```

換成 Supabase Dashboard 裡的：

- Project URL
- Publishable key

### 可以放進 config.js

- Project URL
- Publishable key

### 絕對不要放

- Secret key
- service_role key
- Database password

---

## ② user_state 資料表

你已經做過前面的 SQL，正常情況不必再做一次。

如果登入成功後同步時顯示 `permission denied`，可以到 Supabase SQL Editor 執行：

```sql
grant select, insert, update on table public.user_state to authenticated;
```

專案裡也附了 `SUPABASE_SETUP.sql`，可用來核對設定。

---

## ③ 第一次登入

設定好 `config.js` 後開啟 App。

第一次可按：

`第一次使用：建立帳號`

輸入自己的 Email / 密碼。

如果 Supabase 專案啟用了 Email confirmation，會需要先到信箱點驗證信，再回 App 登入。

之後在手機、平板、電腦都用同一組帳號登入。

---

## ④ 同步規則

### 每次操作

1. 先立刻寫入 localStorage
2. 標示「等待同步」
3. 約 0.9 秒後寫入 Supabase

所以打卡、心情、今日一句等操作不必等網路。

### 新裝置登入

如果雲端已經有資料，V4 會優先下載雲端資料。

### 舊 V3.2 第一次升級

舊紀錄會保留在本機。若雲端還是空的，登入後會把目前資料建立到雲端。

---

## ⑤ 手機 / 平板建議

若只是雙擊 `index.html`，可以測試功能，但跨裝置與 PWA 最終仍建議部署到 HTTPS 網站。

之後可以免費部署到：

- GitHub Pages
- Netlify

上線後即可在 Safari / Chrome 用「加入主畫面」當成自己的 App 使用。

---

## ⑥ 同時用兩台裝置要注意什麼？

V4 是「單人、整份生活狀態」同步模式。

平常使用完全沒問題，但不建議在手機和平板 **同一秒同時修改不同東西**。

若兩邊同時編輯，最後成功寫入雲端的版本會成為最新版本。

對單人生活紀錄 App，這種方式最簡單也最穩定。
