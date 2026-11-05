import { NextRequest, NextResponse } from 'next/server';
import { DataPacket_Kind } from 'livekit-server-sdk';
import { roomService, MISSING_CONFIG_MESSAGE } from '@/lib/livekit-server';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminClient, getProfile, MISSING_SUPABASE_MESSAGE } from '@/lib/supabase/admin';
import { GIFTS, isGiftKey } from '@/lib/gifts';
import { EVENT_TOPIC, encodeEvent, type GiftEvent } from '@/lib/events';

/**
 * 送禮。順序是刻意的：
 *
 *   1. 驗證使用者（從 session，不信任前端傳來的任何身分欄位）
 *   2. 查價（從伺服器的 GIFTS 表，前端只傳 giftKey）
 *   3. 扣點 + 寫紀錄（資料庫 function send_gift，同一個交易）
 *   4. 扣款成功才廣播禮物事件
 *   5. 廣播失敗就退款（refund_gift），讓「扣了點」和「全場看到特效」一致
 *
 * 前端改請求只能改 roomName 和 giftKey：改 roomName 頂多送到別間房（照樣扣自己的點），
 * 改 giftKey 只能選表上有的禮物（照表上的價格扣）。
 */

type SendGiftRow = { gift_id: string; balance: number };

/** send_gift 用 raise exception 回報錯誤，PostgREST 會把訊息放在 error.message */
const RPC_ERRORS: Record<string, { status: number; message: string }> = {
  insufficient_points: { status: 402, message: '點數不足' },
  room_not_found: { status: 404, message: '房間不存在' },
  invalid_points: { status: 400, message: '金額不合法' },
};

export async function POST(req: NextRequest) {
  const service = roomService();
  const admin = createAdminClient();
  if (!service) {
    return NextResponse.json({ error: MISSING_CONFIG_MESSAGE }, { status: 500 });
  }
  if (!admin) {
    return NextResponse.json({ error: MISSING_SUPABASE_MESSAGE }, { status: 500 });
  }

  // 1. 驗證使用者
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '請先登入' }, { status: 401 });
  }

  let body: { roomName?: string; giftKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '請求不是合法的 JSON' }, { status: 400 });
  }

  const roomName = body.roomName?.trim();
  const { giftKey } = body;

  if (!roomName) {
    return NextResponse.json({ error: 'roomName 為必填' }, { status: 400 });
  }
  if (!isGiftKey(giftKey)) {
    return NextResponse.json({ error: '沒有這種禮物' }, { status: 400 });
  }

  // 2. 查價：價格永遠從伺服器的表查
  const gift = GIFTS[giftKey];

  const profile = await getProfile(user.id);
  if (!profile) {
    return NextResponse.json({ error: '找不到使用者資料' }, { status: 500 });
  }

  // 3. 扣點 + 寫紀錄（同一個交易，見 supabase/migrations/）
  const { data, error } = await admin.rpc('send_gift', {
    p_user: user.id,
    p_room: roomName,
    p_gift: giftKey,
    p_points: gift.points,
  });

  if (error) {
    const known = RPC_ERRORS[error.message];
    if (known) {
      return NextResponse.json(
        { error: known.message, balance: profile.points },
        { status: known.status },
      );
    }
    return NextResponse.json({ error: `扣點失敗：${error.message}` }, { status: 502 });
  }

  // returns table 的 function，PostgREST 回傳的是陣列
  const row = (data as SendGiftRow[] | null)?.[0];
  if (!row) {
    return NextResponse.json({ error: '扣點失敗：資料庫沒有回傳結果' }, { status: 502 });
  }

  // 4. 扣款成功才廣播。from 用資料庫裡的暱稱，不用前端傳的
  const event: GiftEvent = {
    type: 'gift',
    from: profile.nickname,
    gift: giftKey,
    label: gift.label,
    emoji: gift.emoji,
    points: gift.points,
    ts: Date.now(),
  };

  try {
    await service.sendData(roomName, encodeEvent(event), DataPacket_Kind.RELIABLE, {
      topic: EVENT_TOPIC,
    });
  } catch (broadcastError) {
    // 5. 廣播失敗 → 退款。點數被扣了卻沒人看到禮物，對送禮的人不合理。
    const { data: refunded, error: refundError } = await admin.rpc('refund_gift', {
      p_gift_id: row.gift_id,
    });

    if (refundError) {
      // 退款也失敗：記 log 給我們查，紀錄留在 gifts 表裡可以人工處理
      console.error('[gifts] 廣播與退款都失敗', {
        giftId: row.gift_id,
        userId: user.id,
        broadcastError: String(broadcastError),
        refundError: refundError.message,
      });
      return NextResponse.json(
        { error: '禮物送出失敗，退款也失敗，請聯絡管理者', balance: row.balance },
        { status: 502 },
      );
    }

    return NextResponse.json(
      { error: `廣播禮物失敗，點數已退回：${String(broadcastError)}`, balance: refunded as number },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, points: gift.points, balance: row.balance });
}
