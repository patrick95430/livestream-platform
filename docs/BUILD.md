# 直播平台開發指南

> 放進 repo 的 `docs/BUILD.md`
> 版本：2026-10-19
> 分工：A = 洪培惇（前端）、B = 王偉臻（後端與環境）

---

## 總覽

第一階段到 11/16 Progress Report，共四週。五個步驟，每一步都有明確的「做完長什麼樣」。

| 步驟 | 目標 | 誰 | 估時 |
|---|---|---|---|
| 0 | 跨網實測（不寫程式） | 兩人 | 0.5h |
| 1 | 本機看到自己的臉 | A + B | 4h |
| 2 | 兩台跨網互看 | B | 2h |
| 3 | 留言 | A | 2h |
| 4 | 登入、首頁、建房 | A + B | 12h |

### 四週排程

| 週 | 日期 | 做什麼 |
|---|---|---|
| W1 | 10/20 – 10/26 | 步驟 0、步驟 1 |
| W2 | 10/27 – 11/02 | 步驟 2、步驟 3 |
| W3 | 11/03 – 11/09 | 步驟 4 |
| W4 | 11/10 – 11/16 | 整合、RTLab 完整演練、報告 |

10/26 是光復節沒課，但開發照跑。

---

## 前置：三個帳號

全部免費，各五分鐘。

1. **LiveKit Cloud** — <https://cloud.livekit.io>　建專案，到 Settings → Keys 拿三個值：API Key、API Secret、WebSocket URL（`wss://xxx.livekit.cloud`）
2. **Vercel** — <https://vercel.com>　用 GitHub 登入
3. **Supabase** — <https://supabase.com>　步驟 4 才用，現在先註冊放著

本機要有 **Node.js 20 以上**（`node -v` 確認）和 **Git**。

---

## 步驟 0：跨網實測

**先做這個，不要先寫程式。** 這一步在驗證整個架構成不成立。

### 做法

1. 兩人各帶一台裝置到 EE601-5
2. 一台連 RTLab1，一台連 RTLab2
3. 兩台都開 <https://meet.livekit.io>，進同一個房間名稱
4. 一台對著另一台的螢幕，用手機碼錶測來回延遲

### 驗收

- 兩邊看得到彼此的畫面和聲音
- 延遲低於 1 秒

### 如果連不上

先在同一個 Wi-Fi 下重測。

- 同網路可以、跨網路不行 → 校網擋 UDP。去 LiveKit 專案設定確認 TURN 開著，再測一次。
- 兩種都不行 → 可能整個校網擋 WebRTC。這時要立刻找助教問，不要自己猜。

**把結果記下來（日期、延遲數字、哪個網路），11/16 報告會用到。**

---

## 步驟 1：本機看到自己的臉

### 目標

`localhost:3000/room/test` 打開，看到自己的鏡頭畫面，有麥克風和鏡頭開關。

### 1-1　建專案（B）

```bash
npx create-next-app@latest livestream
```

互動選項這樣答：

| 問題 | 答 |
|---|---|
| TypeScript | Yes |
| ESLint | Yes |
| Tailwind CSS | Yes |
| `src/` directory | No |
| App Router | Yes |
| Turbopack | Yes |
| import alias | No（用預設 `@/*`） |

然後：

```bash
cd livestream
npm install livekit-server-sdk @livekit/components-react @livekit/components-styles livekit-client
```

### 1-2　環境變數（B）

專案根目錄建 `.env.local`：

```
LIVEKIT_API_KEY=你的_key
LIVEKIT_API_SECRET=你的_secret
LIVEKIT_URL=wss://你的專案.livekit.cloud
```

再建一份 `.env.example`，內容一樣但值留空，這份要進 git。

確認 `.gitignore` 裡有 `.env*.local`（create-next-app 預設就有）。

> **Windows 的坑**：用 VS Code 編輯，不要用記事本。記事本會在行尾留 `\r`，讀出來的 key 會多一個看不見的字元，驗證一定失敗。

### 1-3　Token API（B）

建 `app/api/token/route.ts`：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';

export async function POST(req: NextRequest) {
  const { roomName, identity } = await req.json();

  if (!roomName || !identity) {
    return NextResponse.json(
      { error: 'roomName and identity are required' },
      { status: 400 },
    );
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const serverUrl = process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !serverUrl) {
    return NextResponse.json({ error: 'server not configured' }, { status: 500 });
  }

  // 這張 token 就是 LiveKit 的通行證：它不認識我們的帳號，只認這個簽章
  const at = new AccessToken(apiKey, apiSecret, { identity, ttl: '2h' });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,      // 能上鏡。之後要分「主播／觀眾」就改這裡
    canSubscribe: true,    // 能看別人
    canPublishData: true,  // 能傳留言和禮物事件（步驟 3 要用）
  });

  // 注意：toJwt() 要 await。忘了 await 會拿到 Promise 物件，連線時報錯
  return NextResponse.json({
    token: await at.toJwt(),
    serverUrl,
  });
}
```

**這支 API 是整個系統的權限中樞。** `identity` 從伺服器決定、不從前端傳，是之後防止冒充的關鍵——現在先用隨機值，步驟 4 接上登入後改成真實使用者。

### 1-4　房間頁（A）

建 `app/room/[name]/page.tsx`：

```tsx
import RoomClient from './RoomClient';

// Next.js 15 起 params 是 Promise，要 await
export default async function RoomPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  return <RoomClient roomName={decodeURIComponent(name)} />;
}
```

建 `app/room/[name]/RoomClient.tsx`：

```tsx
'use client';

import { useEffect, useState } from 'react';
import { LiveKitRoom, VideoConference } from '@livekit/components-react';
import '@livekit/components-styles';

export default function RoomClient({ roomName }: { roomName: string }) {
  const [token, setToken] = useState<string>();
  const [serverUrl, setServerUrl] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    // 假設：步驟 4 接上登入後，identity 改成真實使用者 id
    const identity = `user-${Math.random().toString(36).slice(2, 8)}`;

    fetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomName, identity }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setToken(data.token);
        setServerUrl(data.serverUrl);
      })
      .catch((e) => setError(String(e)));
  }, [roomName]);

  if (error) return <p style={{ padding: 24 }}>連線失敗：{error}</p>;
  if (!token || !serverUrl) return <p style={{ padding: 24 }}>連線中…</p>;

  return (
    <LiveKitRoom
      token={token}
      serverUrl={serverUrl}
      connect={true}
      video={true}
      audio={true}
      data-lk-theme="default"
      style={{ height: '100dvh' }}
    >
      <VideoConference />
    </LiveKitRoom>
  );
}
```

### 1-5　跑起來

```bash
npm run dev
```

開 <http://localhost:3000/room/test>，允許瀏覽器存取鏡頭和麥克風。

### 驗收

- 看得到自己的畫面
- 下方有麥克風、鏡頭、離開三個按鈕
- 開第二個分頁進同一個網址，兩個分頁互看得到

### 常見錯誤

| 症狀 | 原因 | 解法 |
|---|---|---|
| `invalid token` | 忘了 `await at.toJwt()` | 補上 await |
| `401` 或簽章錯誤 | key 或 secret 有多餘空白／換行 | 用 VS Code 重貼 `.env.local` |
| 改了 `.env.local` 沒反應 | Next.js 不會熱重載環境變數 | 停掉 `npm run dev` 重開 |
| 鏡頭權限被拒 | 網址不是 localhost 也不是 HTTPS | 本機只用 `localhost`，不要用 `127.0.0.1` 以外的 IP |

---

## 步驟 2：兩台跨網互看

### 目標

拿到一個 `https://xxx.vercel.app` 網址，手機用 4G、電腦用 Wi-Fi，兩邊進同一個房間互看得到。

### 做法（B）

1. 推上 GitHub

```bash
git init
git add .
git commit -m "feat: livekit room with token api"
git branch -M main
git remote add origin https://github.com/你的帳號/livestream.git
git push -u origin main
```

2. 到 Vercel → Add New Project → 選這個 repo
3. **部署前**在 Environment Variables 貼上三個變數（跟 `.env.local` 一樣）
4. Deploy，等兩分鐘拿到網址

### 驗收

- 手機關掉 Wi-Fi 用行動網路，開 `https://xxx.vercel.app/room/test`
- 電腦開同一個網址
- 兩邊互看得到，而且**兩台在完全不同的網路上**

**這一步通過，架構就證明成立了。** 剩下的都是加功能。

> 之後每次 `git push` 到 main，Vercel 會自動重新部署。開發時用 branch，不要直接推 main。

---

## 步驟 3：留言

### 先確認一件事

`<VideoConference />` 這個 prefab **內建聊天面板**，通常在右上角有個聊天圖示。先打開看看——如果已經能打字互傳，這一步的核心功能就完成了，直接驗收。

### 如果要自己做（A）

自己做的理由是：之後打賞的禮物事件要走同一條通道，自己寫過一次比較好接。

用 `useDataChannel` hook。訊息格式**必須先跟 B 講定**（見下方交界合約）。

### 驗收

兩台跨網裝置，一邊打字，另一邊即時看到，而且畫面不會卡。

---

## 步驟 4：登入、首頁、建房

這一步最大，三個部分可以並行。

### 4-1　Supabase 設定（B）

> **已實作**：用 `supabase/migrations/20261104000000_step4_auth_points.sql` 取代下面這段 SQL。
> 差異：`rooms.name` 加 unique、拿掉 `is_live`、加註冊 trigger、RLS、`send_gift` / `refund_gift`。
> 驗證方式見 `docs/VERIFY.md`。

建專案後，在 SQL Editor 建三張表：

```sql
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  nickname text not null,
  points integer not null default 100
);

create table rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  host_id uuid not null references profiles(id),
  is_live boolean not null default true,
  created_at timestamptz not null default now()
);

create table gifts (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id),
  from_id uuid not null references profiles(id),
  gift_key text not null,
  points integer not null,
  created_at timestamptz not null default now()
);
```

**然後一定要開 RLS（Row Level Security）**，尤其是 `profiles.points`。不開的話，觀眾打開 DevTools 就能自己改點數。

規則：點數只能由伺服器端改，前端只能讀。

### 4-2　登入註冊（A）

用 Supabase 的 JS SDK，`signUp` 和 `signInWithPassword` 兩個函式，不用自己寫 API。

### 4-3　首頁與建房（A + B）

- `GET /api/rooms` → 列出 `is_live = true` 的房間
- `POST /api/rooms` → 建房，`host_id` 從登入狀態讀，不從前端傳

### 4-4　把 token 接上登入（B）

改 `/api/token`：`identity` 改成從 Supabase session 讀真實使用者 id，不再用隨機值。

**這一步做完，權限系統才真的成立。**

### 驗收

註冊 → 登入 → 首頁看到房間列表 → 建房 → 另一台裝置加入 → 互看得到 → 能留言。

---

## 之後（第二階段，11/17 起）

按這個順序，有時間才做：

1. **打賞**：禮物按鈕 → `POST /api/gifts` 扣點 → 伺服器廣播事件 → 全場同時播動畫
2. **濾鏡**：video 元素加 CSS filter，下拉選單切換。最便宜的一項，約兩小時
3. **歌詞**：陣列存「秒數 + 歌詞」，依播放時間高亮當前句
4. **伴奏**：把音檔混進串流的音軌

打賞有兩條鐵律：

- 前端只傳「哪間房、哪個禮物」，**不傳金額**，價格由伺服器查表
- 扣款成功後**由伺服器廣播**禮物事件，不讓前端自己發，否則不付錢也能噴動畫

---

## 交界合約

兩人開工前先確認這兩個格式，寫進 `docs/contract.md`，之後不隨便改。

### Token API

請求：

```json
POST /api/token
{ "roomName": "room-abc", "identity": "user-uuid" }
```

回應：

```json
{ "token": "eyJ...", "serverUrl": "wss://xxx.livekit.cloud" }
```

### 即時事件格式

```json
{ "type": "chat",   "from": "暱稱", "text": "訊息內容", "ts": 1760000000000 }
{ "type": "gift",   "from": "暱稱", "gift": "heart", "points": 10, "ts": 1760000000000 }
{ "type": "effect", "name": "confetti", "ts": 1760000000000 }
```

`ts` 用 `Date.now()`。

---

## 協作規則

- 一個 repo，`main` 鎖住，功能開 branch，PR 互審
- 每個步驟 A、B 在同一週整合，不要各做各的到最後才接
- 每週至少一次到 RTLab 實測，不要只在家裡的網路測
- `.env.local` 絕不進 git

---

## Windows 常見坑

| 症狀 | 原因 |
|---|---|
| 指令報怪錯 | 複製時把 `PS C:\...>` 也貼進去了 |
| 環境變數讀出來驗證失敗 | 行尾有 `\r`。用 VS Code 編輯，不要用記事本 |
| 解壓後找不到檔案 | zip 多包了一層資料夾，要進到真正有程式碼的那層 |
| 改了設定沒反應 | 環境變數設在別的終端機視窗，或 dev server 沒重開 |
