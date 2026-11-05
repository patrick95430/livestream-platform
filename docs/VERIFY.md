# 步驟 4 驗證

由下往上驗：資料庫 → API → 瀏覽器 → 部署。
下層沒過，上層的錯誤訊息通常看不出原因，所以照順序做。

---

## 0. 前置設定

### 0-1　安裝套件

```bash
npm install
```

`package.json` 新增了 `@supabase/ssr` 和 `@supabase/supabase-js`，這一步會順便更新 `package-lock.json`，記得一起 commit。

### 0-2　環境變數

照 `.env.example` 在 `.env.local` 填入六個值。Supabase 的值在 Dashboard → Project Settings → API Keys：

| 變數 | 值 | 會不會進瀏覽器 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | 會 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key（或舊版 anon key） | 會 |
| `SUPABASE_SECRET_KEY` | Secret key（或舊版 service_role key） | **不會，也不可以** |

### 0-3　套用 migration

Dashboard → SQL Editor → New query → 貼上 `supabase/migrations/20261104000000_step4_auth_points.sql` 全文 → Run。

整份包在 `begin; ... commit;` 裡，失敗時什麼都不會留下，修正後可以直接重跑。
成功後**不要再跑第二次**：資料表已經存在，第二次會在第一行 `create table` 失敗（失敗也不會改到任何東西）。

### 0-4　Auth 設定（開發期）

Dashboard → Authentication → Sign In / Providers → Email → 關掉 **Confirm email**。

原因：開著的話，`signUp` 成功但不會回傳 session，要先去信箱點連結才能登入，
而且 Supabase 內建的寄信服務每小時只能寄幾封。Demo 前要不要打開再決定。

---

## 1. 資料庫層（SQL Editor）

### 1-1　結構與權限

在 SQL Editor 執行，每一列的 `ok` 都要是 `true`：

```sql
select '三張表都開了 RLS' as 檢查,
       (select bool_and(relrowsecurity) from pg_class
         where oid in ('public.profiles'::regclass, 'public.rooms'::regclass, 'public.gifts'::regclass)) as ok
union all
select '前端角色不能改 profiles',
       not has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
union all
select '前端角色不能寫 gifts',
       not has_table_privilege('authenticated', 'public.gifts', 'INSERT')
union all
select '前端角色不能呼叫 send_gift',
       not has_function_privilege('authenticated', 'public.send_gift(uuid,text,text,integer)', 'EXECUTE')
union all
select '未登入角色不能呼叫 send_gift',
       not has_function_privilege('anon', 'public.send_gift(uuid,text,text,integer)', 'EXECUTE')
union all
select '伺服器角色可以呼叫 send_gift',
       has_function_privilege('service_role', 'public.send_gift(uuid,text,text,integer)', 'EXECUTE')
union all
select '註冊 trigger 存在',
       exists (select 1 from pg_trigger where tgname = 'on_auth_user_created');
```

### 1-2　模擬「登入使用者自己改點數」

先在網站註冊一個帳號，然後到 Table Editor → profiles 複製它的 `id`，貼到下面兩個地方：

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"貼上 id"}';

select * from public.profiles;                         -- 預期：只有自己這一列
update public.profiles set points = 99999
 where id = '貼上 id';                                 -- 預期：ERROR permission denied for table profiles
rollback;
```

`set local role authenticated` 加上 `request.jwt.claims`，就是 PostgREST 處理一個帶登入 token 的請求時，對資料庫做的設定。
所以這裡看到的結果，和使用者從瀏覽器打 API 的結果相同。

> 這一層已經在本機 Postgres 16 上模擬 Supabase 的角色和預設權限測過：16 項權限與邏輯測試全部通過。
> 併發測試是 50 個連線同時送禮、起始 10 點，結果剛好 10 筆成功、餘額 0。
> 在你的 Supabase 上跑 1-1 是為了確認 migration 有完整套用。

---

## 2. API 層（自動腳本）

開兩個終端機：

```bash
# 終端機 1
npm run dev

# 終端機 2
npm run verify:step4
```

腳本會在你的 Supabase 建兩個測試帳號，打完所有 API 後把它們刪掉。
刪帳號會連帶刪除測試房間和送禮紀錄（外鍵設了 `on delete cascade`），所以不會留下測試資料。

預期最後一行：

```
結果：2X 通過、0 失敗、0 警告
```

| 組 | 驗的是什麼 |
|---|---|
| [0] | 註冊 trigger 有建立 profile、預設 100 點 |
| [A] | 沒登入打四支 API 都是 401 |
| [B] | 拿 publishable key 直接打資料庫：讀別人、改點數、呼叫 `send_gift`、寫 rooms／gifts 全部被擋 |
| [C] | 建房、同名 409、在 body 塞別人的 identity 也拿不到別人的 token、body 塞金額被忽略、不存在的房間 404 |
| [D] | 透過 Supabase API 同時送 30 個扣點請求：剛好 10 個成功；餘額 0 時 API 回 402 |

**可能出現的警告**：`LiveKit 拒絕廣播到「沒有人在線」的房間`。
腳本建的房間裡沒有任何人連線。如果 LiveKit 拒絕對空房間 `sendData`，`/api/gifts` 會退款並回 502。
這代表退款路徑正常運作；「送禮成功」的路徑改用第 3 節的瀏覽器測試確認。

---

## 3. 瀏覽器端到端

這就是 BUILD.md 步驟 4 的驗收流程。需要兩個**不同帳號**。
在同一台電腦上，用一般視窗和無痕視窗各登入一個。同一個帳號開兩個分頁，
LiveKit 會因為 identity 重複，把先進來的連線踢掉。

| # | 操作 | 預期 |
|---|---|---|
| 1 | 一般視窗開 `localhost:3000` | 右上角「登入／註冊」 |
| 2 | 建房間（沒登入） | 跳到登入頁 |
| 3 | 註冊帳號 A，暱稱「甲」 | 回首頁，右上角「甲・100 點」 |
| 4 | 建房間 `t1` | 進房，看到自己的畫面 |
| 5 | 無痕視窗註冊帳號 B「乙」，首頁看到 `t1`、房主 甲 | 列表正確 |
| 6 | B 進 `t1` | 兩邊互看、互聽 |
| 7 | 互相留言 | 名字顯示暱稱，不是 `guest-xxxx` |
| 8 | B 送一個火箭（20 點） | **兩邊同時**看到動畫寫「乙 送出 火箭」，B 的餘額 80 |
| 9 | B 重新整理頁面 | 餘額仍是 80（以前會回到 100） |
| 10 | Supabase Table Editor → gifts | 有一筆 20 點的紀錄，`from_id` 是 B |

### 3-1　手動攻擊測試（DevTools）

在 B 的房間頁按 F12 → Console，貼上：

```js
// 試圖：自訂金額、冒充送禮者
await fetch('/api/gifts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ roomName: 't1', giftKey: 'heart', points: -1000, from: '甲' }),
}).then((r) => r.json());
```

預期：回應 `balance` 比原本少 1；動畫寫的是「**乙** 送出 愛心」。`points` 和 `from` 被忽略。

```js
// 試圖：拿到甲的 LiveKit 身分
const r = await fetch('/api/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ roomName: 't1', identity: '隨便填', name: '甲' }),
}).then((r) => r.json());
JSON.parse(atob(r.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
```

預期：解出來的 `sub` 是 B 自己的 user id，`name` 是「乙」。

---

## 4. 部署（Vercel）

1. Vercel → Project → Settings → Environment Variables 加上三個 Supabase 變數
2. Redeploy。`NEXT_PUBLIC_` 開頭的值是在 build 時寫進前端 JS 的，只改設定不重新 build 不會生效
3. 如果之後打開 Confirm email：Supabase → Authentication → URL Configuration 的 Site URL 改成 Vercel 網址，
   否則驗證信裡的連結會指向 `localhost:3000`
4. 跨網重做第 3 節（手機 4G＋電腦 Wi-Fi），並把 `VERIFY_BASE_URL=https://xxx.vercel.app npm run verify:step4` 跑一次

---

## 常見錯誤

| 症狀 | 原因 | 解法 |
|---|---|---|
| 登入成功，但進房間還是跳回登入頁 | 前端用了 supabase-js 的 `createClient`，session 存在 localStorage | 改用 `lib/supabase/client.ts` |
| 所有 API 回 500「缺少 NEXT_PUBLIC_SUPABASE_URL…」 | `.env.local` 沒填，或改了沒重開 dev server | 填好後重開 `npm run dev` |
| `找不到使用者資料，請確認資料庫 migration 已套用` | 先註冊、後套 migration，那個帳號沒有 profile | 刪掉那個帳號重新註冊，或在 SQL Editor 執行下方的補建 SQL |
| `/api/gifts` 回 502「permission denied for function send_gift」 | `SUPABASE_SECRET_KEY` 填成了 publishable key | 換成 Secret key |
| 送禮回 502「扣點失敗：Could not find the function」 | migration 沒套用，或 PostgREST 還沒重新載入 schema | 確認 1-1 全 true；SQL Editor 執行 `notify pgrst, 'reload schema';` |
| 兩個分頁互踢、一直重連 | 同一個帳號進同一間房 | 另一個用無痕視窗、不同帳號 |
| 一小時後 API 突然 401 | `proxy.ts` 沒執行，token 過期沒刷新 | 確認檔案在專案根目錄、檔名是 `proxy.ts`、匯出的函式叫 `proxy` |

補建 profile（只在上表第三種情況用）：

```sql
insert into public.profiles (id, nickname)
select u.id, left(coalesce(nullif(trim(u.raw_user_meta_data ->> 'nickname'), ''), split_part(u.email, '@', 1)), 30)
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id);
```
