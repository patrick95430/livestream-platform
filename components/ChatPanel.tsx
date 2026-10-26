'use client';

import { useEffect, useRef, useState } from 'react';
import { useDataChannel, useLocalParticipant } from '@livekit/components-react';
import {
  EVENT_TOPIC,
  decodeEvent,
  encodeEvent,
  type ChatEvent,
} from '@/lib/events';

/**
 * 留言面板。
 *
 * 走 LiveKit 的 data channel，不另外架 Socket.IO 伺服器 ——
 * 少一台機器要維運，Demo 當天也少一個會掛掉的地方。
 *
 * 注意：data channel 不會把訊息回送給發送者本人，
 * 所以送出時要自己把訊息加進本地清單。
 */
export default function ChatPanel() {
  const [messages, setMessages] = useState<ChatEvent[]>([]);
  const [draft, setDraft] = useState('');
  const { localParticipant } = useLocalParticipant();
  const listRef = useRef<HTMLDivElement>(null);

  const { send } = useDataChannel(EVENT_TOPIC, (msg) => {
    const event = decodeEvent(msg.payload);
    if (event?.type === 'chat') {
      setMessages((prev) => [...prev, event].slice(-200));
    }
  });

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();

    const text = draft.trim();
    if (!text) return;

    const event: ChatEvent = {
      type: 'chat',
      from: localParticipant.name || localParticipant.identity,
      text,
      ts: Date.now(),
    };

    setDraft('');
    setMessages((prev) => [...prev, event].slice(-200));

    try {
      await send(encodeEvent(event), { reliable: true, topic: EVENT_TOPIC });
    } catch {
      // 送失敗就在自己畫面上標記，不要整個面板當掉
      setMessages((prev) =>
        prev.map((m) =>
          m === event ? { ...m, text: `${m.text}（未送出）` } : m,
        ),
      );
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-neutral-700 bg-neutral-900">
      <h2 className="border-b border-neutral-700 px-3 py-2 text-sm font-medium text-neutral-300">
        留言
      </h2>

      <div ref={listRef} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="text-sm text-neutral-500">還沒有留言</p>
        )}
        {messages.map((m, i) => (
          <p key={`${m.ts}-${i}`} className="text-sm leading-relaxed break-words">
            <span className="font-medium text-sky-400">{m.from}</span>
            <span className="text-neutral-500">：</span>
            <span className="text-neutral-100">{m.text}</span>
          </p>
        ))}
      </div>

      <form onSubmit={handleSend} className="flex gap-2 border-t border-neutral-700 p-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="說點什麼"
          maxLength={200}
          className="min-w-0 flex-1 rounded border border-neutral-600 bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-sky-500"
        />
        <button
          type="submit"
          className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
        >
          送出
        </button>
      </form>
    </section>
  );
}
