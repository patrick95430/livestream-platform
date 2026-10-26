import { NextRequest, NextResponse } from 'next/server';
import { DataPacket_Kind } from 'livekit-server-sdk';
import { roomService, MISSING_CONFIG_MESSAGE } from '@/lib/livekit-server';
import { GIFTS, isGiftKey } from '@/lib/gifts';
import { EVENT_TOPIC, encodeEvent, type GiftEvent } from '@/lib/events';

/**
 * 送禮。
 *
 * 兩條鐵律，期末文件的「設計理念」可以直接寫這段：
 *
 * 1. 前端只傳 giftKey，不傳金額。價格由伺服器查 GIFTS 表決定。
 *    前端能傳金額的話，使用者改一下請求就能自己定價。
 *
 * 2. 禮物事件由「伺服器」廣播，不是前端自己發。
 *    前端能自己發的話，不付點數也能讓全場看到特效。
 *
 * 步驟 4 接上 Supabase 之後，在廣播之前要先做：
 *   - 從 session 讀出真實使用者（不要信前端傳來的 from）
 *   - 在同一個交易裡扣點數 + 寫 gifts 紀錄
 *   - 點數不足就回 402，不要廣播
 */
export async function POST(req: NextRequest) {
  const service = roomService();
  if (!service) {
    return NextResponse.json({ error: MISSING_CONFIG_MESSAGE }, { status: 500 });
  }

  let body: { roomName?: string; giftKey?: string; from?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '請求不是合法的 JSON' }, { status: 400 });
  }

  const { roomName, giftKey, from } = body;

  if (!roomName || !from) {
    return NextResponse.json(
      { error: 'roomName 與 from 為必填' },
      { status: 400 },
    );
  }

  if (!isGiftKey(giftKey)) {
    return NextResponse.json({ error: '沒有這種禮物' }, { status: 400 });
  }

  // 價格永遠從伺服器的表查，不看前端送什麼
  const gift = GIFTS[giftKey];

  const event: GiftEvent = {
    type: 'gift',
    from,
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
    return NextResponse.json({ ok: true, points: gift.points });
  } catch (error) {
    return NextResponse.json(
      { error: `廣播禮物失敗：${String(error)}` },
      { status: 502 },
    );
  }
}
