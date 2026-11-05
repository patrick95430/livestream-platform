'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * 瀏覽器端的 Supabase client，給登入頁、登出按鈕用。
 *
 * 一定要用 @supabase/ssr 的 createBrowserClient，不能用 supabase-js 的 createClient。
 * 差別在 session 存哪裡：
 *   - createClient：存在 localStorage。伺服器（route handler）讀不到 localStorage，
 *     所以 /api/token 永遠會覺得你沒登入。
 *   - createBrowserClient：存在 cookie。瀏覽器每次發請求會自動帶 cookie，
 *     伺服器就能從 cookie 讀出 session。
 *
 * 這裡用的是 publishable key，前端權限只到 RLS 允許的範圍：讀自己的 profile、讀房間列表。
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
