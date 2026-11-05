#!/usr/bin/env node
/**
 * 步驟 4 自動驗證。
 *
 * 用法：
 *   1. 一個終端機跑 npm run dev
 *   2. 另一個終端機跑 npm run verify:step4
 *      （等於 node --env-file=.env.local scripts/verify-step4.mjs）
 *
 * 會在你的 Supabase 專案建立兩個測試帳號（step4-test-xxxx@example.com），
 * 跑完不論成功失敗都會刪掉；刪帳號會連帶刪除它們的 profile、房間、送禮紀錄
 * （外鍵是 on delete cascade）。
 *
 * 檢查分四組：
 *   A. 沒登入打 API → 全部 401
 *   B. 拿 publishable key 直接打資料庫（模擬使用者在 DevTools 動手腳）→ 全部被擋
 *   C. 登入後走正常流程 → 建房、拿 token、送禮
 *   D. 併發扣點 → 不會扣成負數、不會多扣或少扣
 */

import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { RoomServiceClient } from 'livekit-server-sdk';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
const SECRET = process.env.SUPABASE_SECRET_KEY?.trim();

if (!SUPABASE_URL || !PUBLISHABLE || !SECRET) {
  console.error('缺少 Supabase 環境變數，請確認 .env.local，並用 npm run verify:step4 執行');
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SECRET, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let passed = 0;
let failed = 0;
let warned = 0;

function check(ok, label, detail = '') {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
}

function warn(label) {
  warned++;
  console.log(`  WARN  ${label}`);
}

async function api(method, path, { cookie, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // 非 JSON 回應（例如 404 頁面），保留 null
  }
  return { status: res.status, json };
}

/**
 * 用 @supabase/ssr 登入，取得它要寫進瀏覽器的 cookie。
 * cookie 的名稱與編碼交給函式庫自己產生，跟瀏覽器裡的完全一樣。
 */
async function loginCookie(email, password) {
  let jar = [];
  const ssr = createServerClient(SUPABASE_URL, PUBLISHABLE, {
    cookies: {
      getAll: () => jar.map(({ name, value }) => ({ name, value })),
      setAll: (cookies) => {
        for (const c of cookies) {
          jar = jar.filter((x) => x.name !== c.name);
          if (c.value) jar.push({ name: c.name, value: c.value });
        }
      },
    },
  });
  const { error } = await ssr.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`登入失敗：${error.message}`);
  // setAll 由 auth 狀態事件觸發，給它一點時間
  for (let i = 0; i < 20 && jar.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (jar.length === 0) throw new Error('登入後沒有產生 cookie');
  return jar.map(({ name, value }) => `${name}=${value}`).join('; ');
}

/** 解 JWT 的 payload（不驗簽，只看內容） */
function jwtPayload(token) {
  const part = token.split('.')[1];
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

async function points(userId) {
  const { data } = await admin.from('profiles').select('points').eq('id', userId).single();
  return data?.points;
}

async function main() {
  // 先確認 dev server 在跑
  try {
    await fetch(BASE);
  } catch {
    console.error(`連不到 ${BASE}，請先在另一個終端機跑 npm run dev`);
    process.exit(2);
  }

  const tag = Math.random().toString(36).slice(2, 8);
  const password = `Test-${tag}-${Date.now()}`;
  const emailA = `step4-test-${tag}-a@example.com`;
  const emailB = `step4-test-${tag}-b@example.com`;
  const roomName = `verify-${tag}`;
  const users = [];

  try {
    // ── 準備：建立兩個已確認 email 的測試帳號 ──
    for (const [email, nickname] of [
      [emailA, `測試A-${tag}`],
      [emailB, `測試B-${tag}`],
    ]) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nickname },
      });
      if (error) throw new Error(`建立測試帳號失敗：${error.message}`);
      users.push(data.user);
    }
    const [userA, userB] = users;

    console.log('\n[0] 註冊 trigger');
    {
      const { data } = await admin
        .from('profiles')
        .select('nickname, points')
        .eq('id', userA.id)
        .maybeSingle();
      check(data?.nickname === `測試A-${tag}`, '註冊後自動建立 profile，暱稱來自 signUp 的 nickname', JSON.stringify(data));
      check(data?.points === 100, '預設 100 點', JSON.stringify(data));
    }

    console.log('\n[A] 沒登入 → 401');
    check((await api('GET', '/api/me')).status === 401, 'GET  /api/me');
    check((await api('POST', '/api/token', { body: { roomName, identity: userA.id } })).status === 401,
      'POST /api/token（就算在 body 裡塞別人的 identity）');
    check((await api('POST', '/api/gifts', { body: { roomName, giftKey: 'heart' } })).status === 401, 'POST /api/gifts');
    check((await api('POST', '/api/rooms', { body: { name: roomName } })).status === 401, 'POST /api/rooms');

    console.log('\n[B] 用 publishable key 直接打資料庫（模擬 DevTools）→ 被擋');
    {
      const browser = createClient(SUPABASE_URL, PUBLISHABLE, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: loginErr } = await browser.auth.signInWithPassword({ email: emailA, password });
      if (loginErr) throw new Error(`登入失敗：${loginErr.message}`);

      const { data: visible } = await browser.from('profiles').select('id');
      check(visible?.length === 1 && visible[0].id === userA.id, '只讀得到自己的 profile', JSON.stringify(visible));

      const upd = await browser.from('profiles').update({ points: 99999 }).eq('id', userA.id);
      check(!!upd.error && (await points(userA.id)) === 100, '改自己的 points → 拒絕，資料庫仍是 100',
        `error=${upd.error?.message} points=${await points(userA.id)}`);

      const rpc = await browser.rpc('send_gift', { p_user: userB.id, p_room: roomName, p_gift: 'crown', p_points: 1 });
      check(!!rpc.error, '直接呼叫 send_gift（扣別人的點）→ 拒絕', `error=${rpc.error?.message}`);

      const ins = await browser.from('rooms').insert({ name: `hack-${tag}`, host_id: userB.id });
      check(!!ins.error, '直接寫 rooms（冒用別人當房主）→ 拒絕', `error=${ins.error?.message}`);

      const gifts = await browser.from('gifts').insert({ room_id: userA.id, from_id: userA.id, gift_key: 'x', points: 1 });
      check(!!gifts.error, '直接寫 gifts → 拒絕', `error=${gifts.error?.message}`);

      await browser.auth.signOut();
    }

    console.log('\n[C] 登入後的正常流程');
    const cookieA = await loginCookie(emailA, password);
    const cookieB = await loginCookie(emailB, password);
    {
      const me = await api('GET', '/api/me', { cookie: cookieA });
      check(me.status === 200 && me.json?.id === userA.id && me.json?.points === 100,
        'GET /api/me 回傳自己的 id、暱稱、點數', JSON.stringify(me));

      const tokenBefore = await api('POST', '/api/token', { cookie: cookieA, body: { roomName } });
      check(tokenBefore.status === 404, '還沒建的房間拿 token → 404', JSON.stringify(tokenBefore));

      const create = await api('POST', '/api/rooms', { cookie: cookieA, body: { name: roomName } });
      check(create.status === 200, 'A 建房 → 200', JSON.stringify(create));

      const { data: roomRow } = await admin.from('rooms').select('host_id').eq('name', roomName).maybeSingle();
      check(roomRow?.host_id === userA.id, '資料表裡房主是 A（由伺服器從 session 決定）', JSON.stringify(roomRow));

      const dup = await api('POST', '/api/rooms', { cookie: cookieB, body: { name: roomName } });
      check(dup.status === 409, 'B 建同名房間 → 409', JSON.stringify(dup));

      const again = await api('POST', '/api/rooms', { cookie: cookieA, body: { name: roomName } });
      check(again.status === 200, 'A 重建自己的同名房間 → 200（重新開播）', JSON.stringify(again));

      const tok = await api('POST', '/api/token', {
        cookie: cookieB,
        body: { roomName, identity: userA.id, name: '冒充者' },
      });
      const payload = tok.json?.token ? jwtPayload(tok.json.token) : {};
      check(tok.status === 200 && payload.sub === userB.id,
        'B 在 body 塞 A 的 identity，token 裡的 identity 仍然是 B', `sub=${payload.sub} 期望=${userB.id}`);
      check(payload.name === `測試B-${tag}`, 'token 的顯示名稱來自資料庫暱稱，不是 body 的 name', `name=${payload.name}`);

      const badGift = await api('POST', '/api/gifts', { cookie: cookieA, body: { roomName, giftKey: 'diamond' } });
      check(badGift.status === 400, '不存在的禮物 → 400', JSON.stringify(badGift));

      const amount = await api('POST', '/api/gifts', {
        cookie: cookieA,
        body: { roomName, giftKey: 'heart', points: -1000 },
      });
      if (amount.status === 200) {
        check(amount.json?.balance === 99, 'body 塞 points: -1000 被忽略，照表扣 1 點', JSON.stringify(amount));
      } else if (amount.status === 502 && amount.json?.balance === 100) {
        warn('LiveKit 拒絕廣播到「沒有人在線」的房間，伺服器已退款（餘額回到 100）。退款路徑正常；送禮成功路徑請用瀏覽器實測（見 docs/VERIFY.md）');
      } else {
        check(false, '送禮', JSON.stringify(amount));
      }

      const ghost = await api('POST', '/api/gifts', { cookie: cookieA, body: { roomName: `nope-${tag}`, giftKey: 'heart' } });
      check(ghost.status === 404, '送到不存在的房間 → 404', JSON.stringify(ghost));

      const list = await api('GET', '/api/rooms');
      check(list.status === 200 && Array.isArray(list.json?.rooms), 'GET /api/rooms 不需登入、正常回傳', JSON.stringify(list).slice(0, 200));
    }

    console.log('\n[D] 併發扣點（直接打資料庫 function）');
    {
      await admin.from('profiles').update({ points: 10 }).eq('id', userB.id);
      const N = 30;
      const results = await Promise.all(
        Array.from({ length: N }, () =>
          admin.rpc('send_gift', { p_user: userB.id, p_room: roomName, p_gift: 'heart', p_points: 1 }),
        ),
      );
      const ok = results.filter((r) => !r.error).length;
      const insufficient = results.filter((r) => r.error?.message === 'insufficient_points').length;
      const { count } = await admin
        .from('gifts')
        .select('id', { count: 'exact', head: true })
        .eq('from_id', userB.id);
      const left = await points(userB.id);
      check(ok === 10 && insufficient === N - 10, `${N} 個請求同時送 1 點、起始 10 點 → 剛好 10 個成功`,
        `成功=${ok} 點數不足=${insufficient}`);
      check(left === 0 && count === 10, '餘額 0、紀錄 10 筆（扣款與紀錄一致）', `餘額=${left} 紀錄=${count}`);

      const poor = await api('POST', '/api/gifts', { cookie: cookieB, body: { roomName, giftKey: 'heart' } });
      check(poor.status === 402 && poor.json?.balance === 0, '餘額 0 時透過 API 送禮 → 402', JSON.stringify(poor));
    }
  } catch (e) {
    failed++;
    console.log(`\n  FAIL  執行中斷：${e instanceof Error ? e.message : String(e)}`);
  } finally {
    // ── 清理 ──
    for (const u of users) {
      const { error } = await admin.auth.admin.deleteUser(u.id);
      if (error) console.log(`  （清理）刪除測試帳號 ${u.email} 失敗：${error.message}，請到 Dashboard 手動刪`);
    }
    const lkUrl = process.env.LIVEKIT_URL?.trim();
    if (lkUrl && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
      try {
        const lk = new RoomServiceClient(
          lkUrl.replace(/^ws/, 'http'),
          process.env.LIVEKIT_API_KEY.trim(),
          process.env.LIVEKIT_API_SECRET.trim(),
        );
        await lk.deleteRoom(roomName);
      } catch {
        // 房間本來就可能不存在，十分鐘後 LiveKit 也會自動關
      }
    }
  }

  console.log(`\n結果：${passed} 通過、${failed} 失敗、${warned} 警告`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
