# 交界合約

> 兩人開工前先確認這份，之後不隨便改。
> 程式碼版本在 `lib/events.ts`，改那個檔案等於改這份合約。

## 為什麼要有這份文件

兩人專案最常見的死法是：一個人把所有畫面做完，另一個人再開始接後端，
最後一週發現格式對不上。把交界寫死在前面，兩邊才能各做各的。

我們的交界只有兩個：**token 的格式**，和**即時事件的格式**。

---

## 1. Token API

LiveKit 不認識我們的帳號，也讀不到我們的 cookie。
它只驗這張 token 的簽章，所以「誰能進哪間房、能不能上鏡」全由我們的伺服器決定。

### 請求

```
POST /api/token
Content-Type: application/json

{
  "roomName": "room-abc",
  "identity": "guest-x7k2p",
  "name": "訪客 x7k2p"
}
```

| 欄位 | 必填 | 說明 |
|---|---|---|
| `roomName` | 是 | 要進的房間 |
| `identity` | 是 | 使用者唯一識別。**步驟 4 之後改由伺服器從 session 讀，不收前端的值** |
| `name` | 否 | 顯示用暱稱，省略時等於 identity |

### 回應

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "serverUrl": "wss://xxx.livekit.cloud"
}
```

### 錯誤

| 狀態 | 時機 |
|---|---|
| 400 | 缺 roomName 或 identity |
| 500 | 伺服器少環境變數 |

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

由**伺服器**發出（`POST /api/gifts` 驗證後廣播）。
前端自己發不算數，否則不付點數也能噴特效。

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

## 3. 送禮 API

```
POST /api/gifts
{ "roomName": "room-abc", "giftKey": "heart", "from": "暱稱" }
```

**前端不傳金額。** 價格由伺服器查 `lib/gifts.ts` 的表決定。
前端能傳金額的話，使用者改一下請求就能自己定價。

回應：

```json
{ "ok": true, "points": 1 }
```

---

## 4. 規則

- `ts` 一律用 `Date.now()`，毫秒
- 收到不認識的 `type` 就忽略，不要讓整個房間當掉
- 加新事件要兩個人都同意，而且要同時更新 `lib/events.ts` 和這份文件
