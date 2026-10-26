'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDataChannel, useLocalParticipant } from '@livekit/components-react';
import {
  EVENT_TOPIC,
  decodeEvent,
  encodeEvent,
  type PingEvent,
  type PongEvent,
} from '@/lib/events';

/**
 * 延遲儀表板。
 *
 * 每兩秒送一個 ping，對方收到回一個 pong，用來回時間算 RTT。
 * 這量的是「資料通道」的來回時間，不是影像的端到端延遲，
 * 但同一條網路路徑，數量級一致，而且是我們自己量的，Demo 時畫面上
 * 直接看得到數字 —— 助教拿碼錶，我們螢幕上有 ms。
 *
 * 影像本身的統計要用 WebRTC 的 getStats，之後要更精確可以再接。
 */
export default function LatencyMeter() {
  const { localParticipant } = useLocalParticipant();
  const [rtt, setRtt] = useState<number | null>(null);
  const [samples, setSamples] = useState<number[]>([]);
  const pending = useRef(new Map<string, number>());
  const sendRef = useRef<((p: Uint8Array, o: { reliable: boolean; topic: string }) => Promise<void>) | null>(null);

  const myIdentity = localParticipant.identity;

  const handleMessage = useCallback(
    (payload: Uint8Array) => {
      const event = decodeEvent(payload);
      if (!event) return;

      // 收到別人的 ping，立刻回 pong
      if (event.type === 'ping' && event.from !== myIdentity) {
        const pong: PongEvent = {
          type: 'pong',
          id: event.id,
          to: event.from,
          ts: Date.now(),
        };
        void sendRef.current?.(encodeEvent(pong), {
          reliable: true,
          topic: EVENT_TOPIC,
        });
        return;
      }

      // 收到回給自己的 pong，算 RTT
      if (event.type === 'pong' && event.to === myIdentity) {
        const sentAt = pending.current.get(event.id);
        if (sentAt === undefined) return;

        pending.current.delete(event.id);
        const elapsed = Date.now() - sentAt;

        setRtt(elapsed);
        setSamples((prev) => [...prev, elapsed].slice(-30));
      }
    },
    [myIdentity],
  );

  const { send } = useDataChannel(EVENT_TOPIC, (msg) => handleMessage(msg.payload));

  // 把最新的 send 放進 ref，給 handleMessage 用。
  // 不能在 render 當中直接寫 ref，要在 effect 裡寫。
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const id = Math.random().toString(36).slice(2, 10);
      const ping: PingEvent = {
        type: 'ping',
        id,
        from: myIdentity,
        ts: Date.now(),
      };

      pending.current.set(id, Date.now());
      // 五秒沒回就丟掉，避免 map 一直長大
      window.setTimeout(() => pending.current.delete(id), 5000);

      void send(encodeEvent(ping), { reliable: true, topic: EVENT_TOPIC });
    }, 2000);

    return () => window.clearInterval(timer);
  }, [send, myIdentity]);

  const average =
    samples.length > 0
      ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
      : null;

  const tone =
    rtt === null
      ? 'text-neutral-400'
      : rtt < 150
        ? 'text-emerald-400'
        : rtt < 400
          ? 'text-amber-400'
          : 'text-red-400';

  return (
    <div className="absolute top-3 right-3 rounded-md bg-black/70 px-3 py-2 text-right font-mono">
      <p className={`text-xl leading-none font-medium ${tone}`}>
        {rtt === null ? '—' : `${rtt}`}
        <span className="ml-1 text-xs text-neutral-400">ms</span>
      </p>
      <p className="mt-1 text-[11px] text-neutral-400">
        {average === null ? '等待對方連線' : `平均 ${average} ms・n=${samples.length}`}
      </p>
    </div>
  );
}
