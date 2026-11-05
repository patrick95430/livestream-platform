import { Suspense } from 'react';
import LoginClient from './LoginClient';

export const metadata = { title: '登入' };

/**
 * LoginClient 用 useSearchParams() 讀 ?next=，那是請求當下才知道的資料。
 * Next 16 開了 cacheComponents，讀動態資料的元件要包在 <Suspense> 裡，
 * 外層的殼才能先產生好。
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center text-neutral-400">
          載入中…
        </main>
      }
    >
      <LoginClient />
    </Suspense>
  );
}
