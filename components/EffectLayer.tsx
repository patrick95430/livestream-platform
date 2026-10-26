'use client';

import { useEffect, useState } from 'react';
import { useDataChannel } from '@livekit/components-react';
import { EVENT_TOPIC, decodeEvent } from '@/lib/events';

type FloatingGift = {
  id: number;
  emoji: string;
  label: string;
  from: string;
  points: number;
  left: number;
  duration: number;
};

let nextId = 0;

/**
 * 禮物特效層。
 *
 * 蓋在影像上面的透明層，收到伺服器廣播的 gift 事件就放一個往上飄的符號。
 * 因為事件是伺服器發的，全場所有人會在同一時間看到同一個特效。
 *
 * 動畫只用 transform 和 opacity，而且尊重使用者的「減少動態」設定。
 */
export default function EffectLayer() {
  const [gifts, setGifts] = useState<FloatingGift[]>([]);

  useDataChannel(EVENT_TOPIC, (msg) => {
    const event = decodeEvent(msg.payload);
    if (event?.type !== 'gift') return;

    const item: FloatingGift = {
      id: nextId++,
      emoji: event.emoji,
      label: event.label,
      from: event.from,
      points: event.points,
      left: 10 + Math.random() * 70,
      duration: 2600 + Math.random() * 900,
    };

    setGifts((prev) => [...prev, item]);
    window.setTimeout(
      () => setGifts((prev) => prev.filter((g) => g.id !== item.id)),
      item.duration,
    );
  });

  useEffect(() => () => setGifts([]), []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {gifts.map((gift) => (
        <div
          key={gift.id}
          className="gift-float absolute bottom-16 flex flex-col items-center"
          style={{
            left: `${gift.left}%`,
            animationDuration: `${gift.duration}ms`,
          }}
        >
          <span className="text-4xl text-amber-300 drop-shadow">{gift.emoji}</span>
          <span className="rounded bg-black/60 px-1.5 py-0.5 text-xs whitespace-nowrap text-amber-200">
            {gift.from} 送出 {gift.label}
          </span>
        </div>
      ))}
    </div>
  );
}
