# 低延遲直播平台

115-1 電子工程總整課程期末專題。兩個人隔著不同網路，合唱一首歌。

- **A（前端）** 洪培惇　**B（後端與環境）** 王偉臻
- 開發指南：[`docs/BUILD.md`](docs/BUILD.md)
- 交界合約：[`docs/contract.md`](docs/contract.md)

---

## 五分鐘跑起來

```bash
npm install
cp .env.example .env.local   # Windows: copy .env.example .env.local
# 編輯 .env.local 填入 LiveKit 的三個值
npm run dev
```

打開 <http://localhost:3000>，建一個房間，允許鏡頭和麥克風。
再開一個分頁進同一個網址，兩邊就會互看得到。

三個值從 <https://cloud.livekit.io> 的專案 Settings → Keys 拿。

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
            頁面 + API                登入、帳號、點數（步驟 4）
```

兩條路是分開的：

- **即時層（WebRTC）**：影音、留言、禮物走 LiveKit，延遲低於一秒
- **應用層（HTTPS）**：登入、建房、打賞扣點走我們的 API

留言暴增不會拖慢畫面，反過來也一樣。

唯一的交界是 token：LiveKit 不認識我們的帳號，只驗簽章，
所以權限控制在我們這邊，不在 LiveKit。

---

## 目錄

```
app/
  api/token/route.ts      簽發 LiveKit 通行證（權限中樞）
  api/rooms/route.ts      列出直播中房間、建立房間
  api/gifts/route.ts      驗價、扣點、廣播禮物事件
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
  gifts.ts                禮物定價表（伺服器端唯一真相）
  livekit-server.ts       伺服器端 LiveKit client
```

---

## 目前的狀態

### 已經會動

- 跨網直播，影像與聲音
- 文字留言
- 打賞：伺服器驗價 + 廣播，全場同時看到動畫
- 延遲儀表板：畫面右上角即時顯示 ms
- 相機濾鏡（本機）
- 卡拉 OK 歌詞條
- 首頁房間列表（直接問 LiveKit 要，不需資料庫）

### 還沒做（步驟 4 起）

| 項目 | 現在 | 要改成 |
|---|---|---|
| 登入 | 無，隨機訪客身分 | Supabase Auth |
| `identity` | 前端產生 | 伺服器從 session 讀 |
| 點數 | 瀏覽器裡的假數字 | Supabase，扣款在交易裡做 |
| 房間 | LiveKit 的房間列表 | rooms 資料表，存房主與開播時間 |
| 濾鏡 | 只改本機畫面 | 處理視訊軌，讓觀眾也看到 |
| 歌詞 | 各自按播放 | 廣播播放狀態，全場同步 |

程式碼裡的 `TODO 步驟 4` 標了每個要改的位置。

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

---

## 部署

推上 GitHub，到 Vercel 匯入這個 repo，
在 Environment Variables 填入 `.env.example` 裡那三個值，Deploy。

之後每次推 `main` 會自動重新部署。開發時用 branch，不要直接推 main。
