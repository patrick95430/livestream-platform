'use client';

import { useEffect, useState } from 'react';
import { GIFTS, GIFT_KEYS, type GiftKey } from '@/lib/gifts';

/**
 * 打賞按鈕列。
 *
 * 前端只送 roomName 和 giftKey 給自己的伺服器。
 * 身分、價格、扣款、廣播全部在伺服器端做，前端不碰金額，也不自己發禮物事件。
 *
 * 顯示的餘額一律來自伺服器：進房時讀 /api/me，送禮後用回應裡的 balance。
 * 前端自己減的數字只是猜測，多分頁同時送禮時會和資料庫不一致。
 */
export default function GiftBar({ roomName }: { roomName: string }) {
  const [points, setPoints] = useState<number | null>(null);
  const [pending, setPending] = useState<GiftKey | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/me')
      .then((res) => res.json() as Promise<{ points?: number; error?: string }>)
      .then((data) => {
        if (cancelled) return;
        if (typeof data.points === 'number') setPoints(data.points);
        else setError(data.error ?? '讀不到點數');
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function sendGift(key: GiftKey) {
    setPending(key);
    setError(undefined);

    try {
      const res = await fetch('/api/gifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName, giftKey: key }),
      });

      const data: { balance?: number; error?: string } = await res.json();

      // 成功或失敗都可能帶 balance（例如點數不足時回傳目前餘額），有就更新
      if (typeof data.balance === 'number') setPoints(data.balance);
      if (!res.ok) setError(data.error ?? '送禮失敗');
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
          剩餘 <span className="font-medium text-amber-400">{points ?? '—'}</span> 點
        </p>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {GIFT_KEYS.map((key) => {
          const gift = GIFTS[key];
          // 只是介面提示，真正的檢查在資料庫的 send_gift
          const affordable = points !== null && points >= gift.points;
          return (
            <button
              key={key}
              onClick={() => sendGift(key)}
              disabled={pending !== null || !affordable}
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
