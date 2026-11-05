'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  const router = useRouter();
  const [token, setToken] = useState<string>();
  const [serverUrl, setServerUrl] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    // 只傳房間名稱。身分由伺服器從登入的 cookie 讀，前端不傳 identity。
    fetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomName }),
    })
      .then(async (res) => {
        if (res.status === 401) {
          // 沒登入：帶著回來的路徑去登入頁，登入後回到這個房間
          const back = `/room/${encodeURIComponent(roomName)}`;
          router.replace(`/login?next=${encodeURIComponent(back)}`);
          return null;
        }
        return (await res.json()) as TokenResponse;
      })
      .then((data) => {
        if (cancelled || !data) return;
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
  }, [roomName, router]);

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
