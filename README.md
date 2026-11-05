# 低延遲直播平台

115-1 電子工程總整課程期末專題。兩個人隔著不同網路，合唱一首歌。

- **A（前端）** 洪培惇　**B（後端與環境）** 王偉臻
- 開發指南：[`docs/BUILD.md`](docs/BUILD.md)
- 交界合約：[`docs/contract.md`](docs/contract.md)
- 步驟 4 驗證：[`docs/VERIFY.md`](docs/VERIFY.md)

---

## 五分鐘跑起來

```bash
npm install
cp .env.example .env.local   # Windows: copy .env.example .env.local
# 編輯 .env.local 填入 LiveKit 三個值、Supabase 三個值
npm run dev
```

第一次用之前，到 Supabase Dashboard → SQL Editor 執行
`supabase/migrations/20261104000000_step4_auth_points.sql`（建表、RLS、扣點 function）。

打開 <http://localhost:3000>，註冊、登入、建一個房間，允許鏡頭和麥克風。
要測兩個人：開一個**無痕視窗**登入**另一個帳號**，進同一個房間。
同一個帳號開兩個分頁會互踢（LiveKit 不允許重複的 identity）。

- LiveKit 三個值：<https://cloud.livekit.io> 專案 Settings → Keys
- Supabase 三個值：<https://supabase.com> 專案 Project Settings → API Keys

> **Windows 注意**：用 VS Code 編 `.env.local`，不要用記事本。
> 記事本會在行尾留 `\r`，金鑰讀出來多一個看不見的字元，驗證一定失敗。

---

## 架構

```
Host 主播端 ──┐                      ┌── Audience 觀眾端
              ├─ LiveKit Cloud (SFU) ─┤        WebRTC：影音、留言、禮物
              └──────────────────────┘
                        ▲
                        │ 簽發 token
                        │
            Next.js on Vercel  ──→  Supabase
            頁面 + API                登入、帳號、點數、房間
```

兩條路是分開的：

- **即時層（WebRTC）**：影音、留言、禮物走 LiveKit，延遲低於一秒
- **應用層（HTTPS）**：登入、建房、打賞扣點走我們的 API

留言暴增不會拖慢畫面，反過來也一樣。

唯一的交界是 token：LiveKit 不認識我們的帳號，只驗簽章，
所以權限控制在我們這邊，不在 LiveKit。token 裡的 identity 由伺服器從
Supabase 驗證過的 session 讀出，前端無法指定。

---

## 目錄

```
proxy.ts                  每個請求前刷新 Supabase session（Next 16 的 middleware）
app/
  api/token/route.ts      簽發 LiveKit 通行證（權限中樞，identity 來自 session）
  api/rooms/route.ts      列出直播中房間、建立房間（記錄房主）
  api/gifts/route.ts      驗價、扣點（資料庫交易）、廣播禮物事件、失敗退款
  api/me/route.ts         目前使用者的暱稱與點數
  login/                  登入／註冊（最小版本）
  page.tsx                首頁
  room/[name]/
    page.tsx              動態路由，params 包在 Suspense 裡
    RoomClient.tsx        取 token，連 LiveKit
    RoomStage.tsx         房間版面
components/
  ChatPanel.tsx           留言（data channel）
  GiftBar.tsx             打賞按鈕
  EffectLayer.tsx         禮物飄浮動畫
  LatencyMeter.tsx        延遲儀表板（ping/pong 量 RTT）
  FilterToggle.tsx        相機濾鏡
  LyricsBar.tsx           卡拉 OK 歌詞
lib/
  events.ts               交界合約的程式碼版本
  gifts.ts                禮物定價表（價格只以伺服器端這份為準）
  livekit-server.ts       伺服器端 LiveKit client
  supabase/client.ts      瀏覽器端 Supabase client（session 存 cookie）
  supabase/server.ts      伺服器端、以目前使用者身分；getCurrentUser()
  supabase/admin.ts       伺服器端、以 service_role 身分（繞過 RLS）
  supabase/proxy.ts       session 刷新邏輯
supabase/migrations/      資料表、RLS、send_gift / refund_gift
scripts/verify-step4.mjs  步驟 4 自動驗證（npm run verify:step4）
```

---

## 目前的狀態

### 已經會動

- 跨網直播，影像與聲音
- 文字留言
- 登入／註冊（Supabase Auth，session 存 cookie）
- LiveKit identity 由伺服器從 session 決定
- 建房需登入，資料表記錄房主；首頁列表顯示房主
- 打賞：伺服器驗價 → 資料庫交易扣點 → 廣播；廣播失敗自動退款
- 延遲儀表板：畫面右上角即時顯示 ms
- 相機濾鏡（本機）
- 卡拉 OK 歌詞條

### 還沒做

| 項目 | 現在 | 要改成 |
|---|---|---|
| 濾鏡 | 只改本機畫面 | 處理視訊軌，讓觀眾也看到 |
| 歌詞 | 各自按播放 | 廣播播放狀態，全場同步 |
| 登入頁 | 最小可用版本 | A 重做畫面（呼叫方式見 `docs/contract.md` 第 0 節） |

---

## 設計決策

寫期末文件的「設計理念」可以直接用這三段。

**為什麼是 WebRTC。** 合唱在延遲超過約兩百毫秒就會明顯錯拍。
RTMP 和 HLS 把影像切成數秒的片段，播放器要下載完整片段才能播，
還會多留幾段當緩衝避免卡頓 —— 那個緩衝就是延遲。
對單向轉播是好的取捨，對合唱不是。SRT 延遲夠低但需要安裝原生程式，
而 Demo 時觀眾端是助教的電腦，不能裝東西。只剩 WebRTC。

**為什麼不自架伺服器。** 校網裡的筆電沒有公網 IP，跨網段的另一台根本找不到它。
就算租雲端主機，WebRTC 的影音走 UDP，校網常只放行一般網頁流量，
自架就得自己做一個把影音包成 443 埠流量的中繼。LiveKit 內建這個 fallback。
加上憑證、防火牆、伺服器存活都變成我們要顧的事，而 Demo 只有一次機會。

**為什麼打賞要經過伺服器。** 前端只傳禮物種類，不傳金額，價格由伺服器查表；
扣款成功後由伺服器廣播禮物事件，不讓前端自己發。
前端能傳金額就能自己定價，能自己發事件就能不付錢噴特效。

**為什麼扣點寫成資料庫 function。** supabase-js 每次呼叫是一個獨立的交易。
若分成「讀餘額、檢查、寫回」三次呼叫，同時到達的請求會讀到同一個餘額、各自寫回，
互相覆蓋扣款（lost update）。本機以 50 個同時請求、起始 10 點實測：
拆開寫的版本 50 筆全部成功、餘額剩 9；`send_gift` 剛好 10 筆成功、餘額 0。
`send_gift` 把檢查和扣款寫在同一個 `UPDATE ... WHERE points >= 價格`，
Postgres 會鎖住該列，後到的交易用更新後的值重新判斷條件。

---

## 部署

推上 GitHub，到 Vercel 匯入這個 repo，
在 Environment Variables 填入 `.env.example` 裡的六個值，Deploy。
`NEXT_PUBLIC_` 開頭的值在 build 時寫進前端，改了要重新部署才生效。

之後每次推 `main` 會自動重新部署。開發時用 branch，不要直接推 main。
