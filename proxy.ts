import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

/**
 * Next 16 把 middleware.ts 改名為 proxy.ts，匯出的函式名稱也從 middleware 改成 proxy。
 * 它在請求進到頁面或 API 之前執行，執行環境是 Node.js。
 * 檔名或函式名寫錯不會報錯，只是不會被執行，所以要照這個名稱。
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // 靜態檔和圖片不需要刷新 session，排除掉省時間
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
