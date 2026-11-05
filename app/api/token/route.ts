import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { livekitConfig, MISSING_CONFIG_MESSAGE } from '@/lib/livekit-server';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminClient, getProfile, MISSING_SUPABASE_MESSAGE } from '@/lib/supabase/admin';

/**
 * 簽發 LiveKit 通行證。
 *
 * 這支 API 是整個系統的權限中樞：
 * LiveKit 不認識我們的帳號，也讀不到我們的 cookie，它只驗這張 token 的簽章，
 * 並且完全相信 token 裡寫的 identity。
 *
 * 所以 identity 只能由這裡決定：從「經過 Supabase 驗證的 session」讀出 user.id。
 * 請求 body 裡就算帶了 identity 也會被忽略，前端沒有辦法指定自己是誰。
 */
export async function POST(req: NextRequest) {
  let body: { roomName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '請求不是合法的 JSON' }, { status: 400 });
  }

  const roomName = body.roomName?.trim();
  if (!roomName) {
    return NextResponse.json({ error: 'roomName 為必填' }, { status: 400 });
  }

  const config = livekitConfig();
  const admin = createAdminClient();
  if (!config) {
    return NextResponse.json({ error: MISSING_CONFIG_MESSAGE }, { status: 500 });
  }
  if (!admin) {
    return NextResponse.json({ error: MISSING_SUPABASE_MESSAGE }, { status: 500 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '請先登入' }, { status: 401 });
  }

  // 房間必須先經過 POST /api/rooms 建立。
  // 否則 LiveKit 會在第一個人加入時自動建房，資料表裡就沒有房主紀錄，
  // 送禮時也查不到 room_id。
  const { data: room, error: roomError } = await admin
    .from('rooms')
    .select('id, host_id')
    .eq('name', roomName)
    .maybeSingle();

  if (roomError) {
    return NextResponse.json({ error: `查詢房間失敗：${roomError.message}` }, { status: 502 });
  }
  if (!room) {
    return NextResponse.json({ error: '房間不存在，請從首頁建立' }, { status: 404 });
  }

  const profile = await getProfile(user.id);
  if (!profile) {
    // 註冊 trigger 沒跑成功時會到這裡（例如 migration 還沒套用就註冊了）
    return NextResponse.json({ error: '找不到使用者資料，請確認資料庫 migration 已套用' }, { status: 500 });
  }

  const at = new AccessToken(config.apiKey, config.apiSecret, {
    identity: user.id,
    name: profile.nickname,
    ttl: '2h',
    // 把「是不是房主」放進 metadata，前端可以據此顯示標記。
    // metadata 是伺服器簽進 token 的，前端改不了。
    metadata: JSON.stringify({ isHost: room.host_id === user.id }),
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true, // 合唱兩邊都要上鏡上麥。之後要分「主播／純觀眾」就改這一行
    canSubscribe: true,
    canPublishData: true, // 留言、ping/pong 要用。沒有這個，聊天室不會動
  });

  // toJwt() 是 async。忘了 await 會拿到一個 Promise 物件當 token，
  // 連線時只會看到 "invalid token"，完全看不出原因。
  const token = await at.toJwt();

  return NextResponse.json({
    token,
    serverUrl: config.wsUrl,
    identity: user.id,
    name: profile.nickname,
  });
}
