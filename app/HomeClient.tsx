'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RoomSummary } from './api/rooms/route';

/**
 * 首頁：建立房間，以及正在直播的房間列表。
 *
 * 房間列表現在直接問 LiveKit 要「目前有人的房間」，所以不用資料庫
 * 就有一個會動的首頁。步驟 4 接上 Supabase 之後改成讀 rooms 資料表，
 * 才能存房名、房主和開播時間。
 */
export default function HomeClient() {
  const router = useRouter();
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const loadRooms = useCallback(async () => {
    try {
      const res = await fetch('/api/rooms');
      const data: { rooms?: RoomSummary[]; error?: string } = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setError(undefined);
      setRooms(data.rooms ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // loadRooms 是非同步的，setState 都發生在 await 之後，不是 render 當中。
    // 這個規則看不出這點，所以在這裡關掉。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRooms();

    const timer = window.setInterval(() => void loadRooms(), 5000);
    return () => window.clearInterval(timer);
  }, [loadRooms]);

  async function createRoom(e: React.FormEvent) {
    e.preventDefault();

    const trimmed = name.trim();
    if (!trimmed) return;

    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data: { name?: string; error?: string } = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }
      router.push(`/room/${encodeURIComponent(trimmed)}`);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-6 py-14 text-neutral-100">
      <h1 className="text-3xl font-medium">低延遲直播平台</h1>
      <p className="mt-2 text-sm text-neutral-400">
        兩個人隔著不同網路，合唱一首歌
      </p>

      <form onSubmit={createRoom} className="mt-8 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="房間名稱"
          maxLength={40}
          className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-sky-500"
        />
        <button
          type="submit"
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500"
        >
          建立房間
        </button>
      </form>

      {error && (
        <p className="mt-4 rounded border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <section className="mt-10">
        <h2 className="text-sm font-medium text-neutral-300">直播中</h2>

        {loading ? (
          <p className="mt-3 text-sm text-neutral-500">載入中…</p>
        ) : rooms.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">
            目前沒有人在直播。建一個房間試試。
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {rooms.map((room) => (
              <li key={room.name}>
                <a
                  href={`/room/${encodeURIComponent(room.name)}`}
                  className="flex items-center justify-between rounded border border-neutral-800 bg-neutral-900 px-4 py-3 hover:border-sky-600"
                >
                  <span className="font-medium">{room.name}</span>
                  <span className="text-sm text-neutral-400">
                    {room.numParticipants} 人在線
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
