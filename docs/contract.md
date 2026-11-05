# 交界合約

> 兩人開工前先確認這份，之後不隨便改。
> 程式碼版本在 `lib/events.ts`，改那個檔案等於改這份合約。
>
> **2026-11-04 步驟 4 修訂**：token 請求拿掉 `identity`、送禮請求拿掉 `from`、
> 送禮回應加 `balance`、新增 `/api/me` 與 `/api/rooms` 的登入要求、新增第 0 節（前端登入方式）。

## 為什麼要有這份文件

前後端各自開發時，雙方只透過這裡列的格式互動。格式先寫下來，兩邊可以並行開發，
整合時不會發現欄位對不上。

我們的交界有三類：**登入 session 怎麼傳到伺服器**、**HTTP API 的格式**、**即時事件的格式**。

---

## 0. 登入 session

前端呼叫 Supabase Auth 時**一定要用 `lib/supabase/client.ts` 的 `createClient()`**
（內部是 `@supabase/ssr` 的 `createBrowserClient`），不能直接用 `@supabase/supabase-js` 的 `createClient`。

原因：前者把 session 存在 cookie，瀏覽器呼叫 `/api/*` 時會自動帶上，伺服器才讀得到；
後者存在 localStorage，伺服器讀不到，所有需要登入的 API 都會回 401。

註冊時暱稱放在 `options.data.nickname`，資料庫 trigger 會用它建立 profile：

```ts
await supabase.auth.signUp({ email, password, options: { data: { nickname } } });
```

所有 API 的身分一律由伺服器從 cookie 讀，**請求 body 裡不帶任何身分欄位**；帶了也會被忽略。

---

## 1. Token API

LiveKit 不認識我們的帳號，也讀不到我們的 cookie。
它只驗這張 token 的簽章，並且相信 token 裡的 identity，
所以「誰能進哪間房、能不能上鏡」全由我們的伺服器決定。

### 請求（需登入）

```
POST /api/token
Content-Type: application/json

{ "roomName": "room-abc" }
```

| 欄位 | 必填 | 說明 |
|---|---|---|
| `roomName` | 是 | 要進的房間。必須先經過 `POST /api/rooms` 建立 |

### 回應

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "serverUrl": "wss://xxx.livekit.cloud",
  "identity": "6f1c...（Supabase user id）",
  "name": "暱稱"
}
```

token 內容：`identity` = Supabase user id，`name` = profiles.nickname，
`metadata` = `{"isHost": true|false}`。

### 錯誤

| 狀態 | 時機 | 前端處理 |
|---|---|---|
| 400 | 缺 roomName | — |
| 401 | 沒登入 | 導向 `/login?next=/room/<name>` |
| 404 | 房間不存在 | 顯示訊息、回首頁 |
| 500 | 伺服器少環境變數 / 使用者沒有 profile | 顯示訊息 |

### Token 裡的權限

```
roomJoin:       true
room:           <roomName>
canPublish:     true   ← 要分「主播／純觀眾」就改這個
canSubscribe:   true
canPublishData: true   ← 沒有這個留言不會動
ttl:            2h
```

---

## 2. 即時事件

所有即時訊息走 LiveKit 的 data channel，topic 固定是 `app`，
收到後用 `type` 分流。不另外架 WebSocket 伺服器。

### chat：文字留言

由**前端**發出。

```json
{ "type": "chat", "from": "暱稱", "text": "訊息內容", "ts": 1760000000000 }
```

### gift：禮物

由**伺服器**發出（`POST /api/gifts` 扣款成功後廣播）。
前端自己發不算數，否則不付點數也能噴特效。`from` 是資料庫裡送禮者的暱稱。

```json
{
  "type": "gift",
  "from": "暱稱",
  "gift": "heart",
  "label": "愛心",
  "emoji": "♥",
  "points": 1,
  "ts": 1760000000000
}
```

### ping / pong：延遲量測

由**前端**發出。每兩秒一次，收到別人的 ping 就回 pong。

```json
{ "type": "ping", "id": "a1b2c3", "from": "我的 identity", "ts": 1760000000000 }
{ "type": "pong", "id": "a1b2c3", "to": "對方的 identity", "ts": 1760000000000 }
```

---

## 3. 送禮 API（需登入）

```
POST /api/gifts
{ "roomName": "room-abc", "giftKey": "heart" }
```

**前端不傳金額，也不傳送禮者。** 價格由伺服器查 `lib/gifts.ts`，送禮者從 session 讀。

成功：

```json
{ "ok": true, "points": 1, "balance": 99 }
```

`balance` 是扣款後的餘額，前端直接顯示這個數字，不要自己減。

| 狀態 | 時機 | 回應裡有 `balance` |
|---|---|---|
| 400 | 缺 roomName / 沒有這種禮物 | 否 |
| 401 | 沒登入 | 否 |
| 402 | 點數不足 | 是（目前餘額） |
| 404 | 房間不存在 | 是 |
| 502 | 廣播失敗（已退款） | 是（退款後餘額） |

---

## 4. 使用者 API

```
GET /api/me
```

已登入 → `200 { "id": "...", "nickname": "暱稱", "points": 100 }`
沒登入 → `401`

---

## 5. 房間 API

### 列表（不需登入）

```
GET /api/rooms
→ { "rooms": [ { "name": "room-abc", "numParticipants": 2, "createdAt": 1760000000000, "hostNickname": "暱稱" } ] }
```

只列「LiveKit 上現在有人」而且「資料表裡有紀錄」的房間。

### 建立（需登入）

```
POST /api/rooms
{ "name": "room-abc" }
→ 200 { "name": "room-abc" }
```

房主由伺服器從 session 決定。

| 狀態 | 時機 |
|---|---|
| 400 | 名稱空白或超過 40 字 |
| 401 | 沒登入 |
| 409 | 名稱已被別人使用（自己建過的同名房間可以重建，回 200） |
| 502 | 資料庫或 LiveKit 失敗，可重試 |

---

## 6. 規則

- `ts` 一律用 `Date.now()`，毫秒
- 收到不認識的 `type` 就忽略，不要讓整個房間當掉
- 加新事件要兩個人都同意，而且要同時更新 `lib/events.ts` 和這份文件
- 同一個帳號只能在一個分頁進同一間房：LiveKit 遇到重複的 identity，會把先進來的連線踢掉。
  本機測兩個人時，用一般視窗和無痕視窗登入兩個不同帳號
