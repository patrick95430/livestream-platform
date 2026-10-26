'use client';

import { useState } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { GIFTS, GIFT_KEYS, type GiftKey } from '@/lib/gifts';

/**
 * 打賞按鈕列。
 *
 * 前端只送 giftKey 給自己的伺服器，價格和廣播都在伺服器端做。
 * 前端完全不碰金額，也不自己發禮物事件。
 *
 * 現在的點數是瀏覽器本地的假數字，純粹讓畫面有反應。
 * 步驟 4 接上 Supabase 之後改成讀真實餘額，扣款在伺服器端的交易裡做。
 */
export default function GiftBar({ roomName }: { roomName: string }) {
  const { localParticipant } = useLocalParticipant();
  const [points, setPoints] = useState(100); // TODO 步驟 4：改成從 Supabase 讀
  const [pending, setPending] = useState<GiftKey | null>(null);
  const [error, setError] = useState<string>();

  async function sendGift(key: GiftKey) {
    const gift = GIFTS[key];

    if (points < gift.points) {
      setError('點數不足');
      return;
    }

    setPending(key);
    setError(undefined);

    try {
      const res = await fetch('/api/gifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName,
          giftKey: key,
          from: localParticipant.name || localParticipant.identity,
        }),
      });

      const data: { points?: number; error?: string } = await res.json();

      if (!res.ok) {
        setError(data.error ?? '送禮失敗');
        return;
      }

      // 扣的是伺服器回傳的金額，不是前端自己算的
      setPoints((prev) => prev - (data.points ?? gift.points));
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="rounded-lg border border-neutral-700 bg-neutral-900 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-neutral-300">打賞</h2>
        <p className="text-sm text-neutral-400">
          剩餘 <span className="font-medium text-amber-400">{points}</span> 點
        </p>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {GIFT_KEYS.map((key) => {
          const gift = GIFTS[key];
          return (
            <button
              key={key}
              onClick={() => sendGift(key)}
              disabled={pending !== null}
              className="flex flex-col items-center gap-0.5 rounded border border-neutral-600 bg-neutral-800 py-2 hover:border-amber-500 disabled:opacity-50"
            >
              <span className="text-xl text-amber-400">{gift.emoji}</span>
              <span className="text-xs text-neutral-300">{gift.label}</span>
              <span className="text-xs text-neutral-500">{gift.points}</span>
            </button>
          );
        })}
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </section>
  );
}
