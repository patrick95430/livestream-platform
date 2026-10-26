import { Suspense } from 'react';
import RoomClient from './RoomClient';

export const metadata = { title: '直播房間' };

/**
 * Next 16 開了 cacheComponents，會想把頁面先預先產生好。
 * 但房間名稱是網址的一部分（動態資料），讀它就不能預先產生，
 * 所以要把「讀 params 的那一段」包進 <Suspense>，
 * 外層的殼可以先送給瀏覽器，裡面再補上。
 */
export default function RoomPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  return (
    <Suspense
      fallback={
        <main className="flex h-dvh items-center justify-center bg-neutral-950 text-neutral-400">
          載入中…
        </main>
      }
    >
      <ResolveRoom params={params} />
    </Suspense>
  );
}

/** Next.js 15 起 params 是 Promise，一定要 await */
async function ResolveRoom({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return <RoomClient roomName={decodeURIComponent(name)} />;
}
