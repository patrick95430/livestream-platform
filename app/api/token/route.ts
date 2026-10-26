import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { livekitConfig, MISSING_CONFIG_MESSAGE } from '@/lib/livekit-server';

/**
 * 簽發 LiveKit 通行證。
 *
 * 這支 API 是整個系統的權限中樞：
 * LiveKit 不認識我們的帳號，也讀不到我們的 cookie，它只驗這張 token 的簽章。
 * 所以「誰能進哪間房、能不能上鏡」全部在這裡決定。
 *
 * 步驟 4 接上 Supabase 登入後，identity 要改成從 session 讀真實使用者 id，
 * 不能再由前端自己傳 —— 否則任何人都能冒充別人。
 */
export async function POST(req: NextRequest) {
  let body: { roomName?: string; identity?: string; name?: string };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '請求不是合法的 JSON' }, { status: 400 });
  }

  const { roomName, identity, name } = body;

  if (!roomName || !identity) {
    return NextResponse.json(
      { error: 'roomName 與 identity 為必填' },
      { status: 400 },
    );
  }

  const config = livekitConfig();
  if (!config) {
    return NextResponse.json({ error: MISSING_CONFIG_MESSAGE }, { status: 500 });
  }

  const at = new AccessToken(config.apiKey, config.apiSecret, {
    identity,
    name: name ?? identity,
    ttl: '2h',
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true, // 能上鏡。之後要分「主播／純觀眾」就改這一行
    canSubscribe: true, // 能看別人
    canPublishData: true, // 能送留言。沒有這個，聊天室不會動
  });

  // toJwt() 是 async。忘了 await 會拿到一個 Promise 物件當 token，
  // 連線時只會看到 "invalid token"，完全看不出原因。
  const token = await at.toJwt();

  return NextResponse.json({ token, serverUrl: config.wsUrl });
}
