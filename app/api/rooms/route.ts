import { NextRequest, NextResponse, connection } from 'next/server';
import { roomService, MISSING_CONFIG_MESSAGE } from '@/lib/livekit-server';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminClient, MISSING_SUPABASE_MESSAGE } from '@/lib/supabase/admin';

export type RoomSummary = {
  name: string;
  numParticipants: number;
  createdAt: number;
  hostNickname: string | null;
};

type RoomRow = {
  name: string;
  created_at: string;
  // 多對一的關聯，PostgREST 回傳單一物件；沒有產生型別時 supabase-js 推不出來，手動標
  host: { nickname: string } | null;
};

/**
 * 列出正在直播的房間。
 *
 * 兩個來源合併：
 *   - LiveKit：哪些房間「現在有人」。LiveKit 本來就即時追蹤每個房間的人數，
 *     不需要我們在資料庫另外維護 is_live 再想辦法同步。
 *   - Supabase rooms 表：房主是誰、什麼時候建的。
 * 只列兩邊都有的房間：有人在、而且是經過 POST /api/rooms 建立的。
 */
export async function GET() {
  // Next 16 的 cacheComponents 會想把 GET 的結果快取起來。
  // 房間列表每次都要是最新的，所以用 connection() 明確要求在請求當下才執行。
  await connection();

  const service = roomService();
  const admin = createAdminClient();
  if (!service) {
    return NextResponse.json({ error: MISSING_CONFIG_MESSAGE }, { status: 500 });
  }
  if (!admin) {
    return NextResponse.json({ error: MISSING_SUPABASE_MESSAGE }, { status: 500 });
  }

  try {
    const liveRooms = (await service.listRooms()).filter((r) => r.numParticipants > 0);
    if (liveRooms.length === 0) {
      return NextResponse.json({ rooms: [] });
    }

    const { data, error } = await admin
      .from('rooms')
      .select('name, created_at, host:profiles(nickname)')
      .in(
        'name',
        liveRooms.map((r) => r.name),
      );

    if (error) {
      return NextResponse.json({ error: `查詢房間失敗：${error.message}` }, { status: 502 });
    }

    const byName = new Map((data as unknown as RoomRow[]).map((row) => [row.name, row]));

    const summaries: RoomSummary[] = liveRooms
      .filter((room) => byName.has(room.name))
      .map((room) => {
        const row = byName.get(room.name)!;
        return {
          name: room.name,
          numParticipants: room.numParticipants,
          createdAt: new Date(row.created_at).getTime(),
          hostNickname: row.host?.nickname ?? null,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    return NextResponse.json({ rooms: summaries });
  } catch (error) {
    return NextResponse.json(
      { error: `無法取得房間列表：${String(error)}` },
      { status: 502 },
    );
  }
}

/**
 * 建立房間。要登入，房主 id 從 session 讀，不從前端傳。
 *
 * 順序：先寫資料庫，再叫 LiveKit 建房。
 * 資料庫的 unique 約束負責擋「同名房間」：兩個人同時建同名房間，只有一個 insert 會成功。
 * 如果 LiveKit 那一步失敗，資料庫那列會留著；同一個房主重試時會走「已存在且是自己的」
 * 那條路，直接重新叫 LiveKit 建房，所以重試就能恢復。
 */
export async function POST(req: NextRequest) {
  const service = roomService();
  const admin = createAdminClient();
  if (!service) {
    return NextResponse.json({ error: MISSING_CONFIG_MESSAGE }, { status: 500 });
  }
  if (!admin) {
    return NextResponse.json({ error: MISSING_SUPABASE_MESSAGE }, { status: 500 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '請先登入' }, { status: 401 });
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
  if (name.length > 40) {
    return NextResponse.json({ error: '房間名稱最多 40 字' }, { status: 400 });
  }

  const { error: insertError } = await admin
    .from('rooms')
    .insert({ name, host_id: user.id });

  if (insertError) {
    // 23505 = unique_violation：這個名稱已經有人用了
    if (insertError.code !== '23505') {
      return NextResponse.json(
        { error: `建立房間失敗：${insertError.message}` },
        { status: 502 },
      );
    }

    const { data: existing } = await admin
      .from('rooms')
      .select('host_id')
      .eq('name', name)
      .maybeSingle();

    if (existing?.host_id !== user.id) {
      return NextResponse.json({ error: '這個房間名稱已經被別人使用' }, { status: 409 });
    }
    // 是自己之前建的同名房間：當作重新開播，往下走
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
      { error: `LiveKit 建立房間失敗，請重試：${String(error)}` },
      { status: 502 },
    );
  }
}
