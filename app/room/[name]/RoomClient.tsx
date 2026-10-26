'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LiveKitRoom } from '@livekit/components-react';
import '@livekit/components-styles';
import RoomStage from './RoomStage';

type TokenResponse = {
  token?: string;
  serverUrl?: string;
  error?: string;
};

/**
 * 向自己的伺服器要一張 token，拿到之後才連 LiveKit。
 *
 * 順序是刻意的：瀏覽器永遠不知道 API secret，它只拿得到一張
 * 有期限、有指定房間和權限的通行證。
 */
export default function RoomClient({ roomName }: { roomName: string }) {
  const [token, setToken] = useState<string>();
  const [serverUrl, setServerUrl] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    // TODO 步驟 4：接上 Supabase 之後，identity 改成真實使用者 id，
    // 而且要由伺服器從 session 讀，不要由前端傳。
    const suffix = Math.random().toString(36).slice(2, 7);
    const identity = `guest-${suffix}`;

    let cancelled = false;

    fetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomName, identity, name: `訪客 ${suffix}` }),
    })
      .then((res) => res.json() as Promise<TokenResponse>)
      .then((data) => {
        if (cancelled) return;
        if (data.error || !data.token || !data.serverUrl) {
          setError(data.error ?? '伺服器沒有回傳 token');
          return;
        }
        setToken(data.token);
        setServerUrl(data.serverUrl);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [roomName]);

  if (error) {
    return (
      <main className="flex h-dvh flex-col items-center justify-center gap-3 bg-neutral-950 px-6 text-center text-neutral-200">
        <p className="text-lg font-medium">連線失敗</p>
        <p className="max-w-md text-sm text-neutral-400">{error}</p>
        <Link href="/" className="text-sm text-sky-400 hover:underline">
          回首頁
        </Link>
      </main>
    );
  }

  if (!token || !serverUrl) {
    return (
      <main className="flex h-dvh items-center justify-center bg-neutral-950 text-neutral-400">
        連線中…
      </main>
    );
  }

  return (
    <LiveKitRoom
      token={token}
      serverUrl={serverUrl}
      connect={true}
      video={true}
      audio={true}
      data-lk-theme="default"
      onError={(e) => setError(e.message)}
    >
      <RoomStage roomName={roomName} />
    </LiveKitRoom>
  );
}
