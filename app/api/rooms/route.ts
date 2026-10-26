import { NextRequest, NextResponse, connection } from 'next/server';
import { roomService, MISSING_CONFIG_MESSAGE } from '@/lib/livekit-server';

export type RoomSummary = {
  name: string;
  numParticipants: number;
  createdAt: number;
};

/**
 * 列出正在直播的房間。
 *
 * 現在直接問 LiveKit 要「目前有人的房間」，所以不用資料庫就有一個會動的首頁。
 * 步驟 4 接上 Supabase 之後，這裡改成讀 rooms 資料表，才能存房名、房主、縮圖。
 */
export async function GET() {
  // Next 16 的 cacheComponents 會想把 GET 的結果快取起來。
  // 房間列表每次都要是最新的，所以用 connection() 明確要求在請求當下才執行。
  await connection();

  const service = roomService();
  if (!service) {
    return NextResponse.json({ error: MISSING_CONFIG_MESSAGE }, { status: 500 });
  }

  try {
    const rooms = await service.listRooms();

    const summaries: RoomSummary[] = rooms
      .filter((room) => room.numParticipants > 0)
      .map((room) => ({
        name: room.name,
        numParticipants: room.numParticipants,
        // creationTime 是 bigint 的秒數，轉成毫秒給前端用
        createdAt: Number(room.creationTime) * 1000,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);

    return NextResponse.json({ rooms: summaries });
  } catch (error) {
    return NextResponse.json(
      { error: `無法取得房間列表：${String(error)}` },
      { status: 502 },
    );
  }
}

/** 建立房間。步驟 4 之後要把房主 id 從登入狀態寫進資料庫。 */
export async function POST(req: NextRequest) {
  const service = roomService();
  if (!service) {
    return NextResponse.json({ error: MISSING_CONFIG_MESSAGE }, { status: 500 });
  }

  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '請求不是合法的 JSON' }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: '房間名稱不能空白' }, { status: 400 });
  }

  try {
    await service.createRoom({
      name,
      emptyTimeout: 60 * 10, // 沒人之後十分鐘自動關掉，不留殭屍房間
      maxParticipants: 20,
    });
    return NextResponse.json({ name });
  } catch (error) {
    return NextResponse.json(
      { error: `建立房間失敗：${String(error)}` },
      { status: 502 },
    );
  }
}
