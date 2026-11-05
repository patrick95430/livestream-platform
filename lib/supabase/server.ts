import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';

/**
 * 伺服器端、「以目前使用者身分」的 Supabase client。
 * 只在 app/api/ 底下的 route handler 使用。
 *
 * 它從請求的 cookie 讀 session，所以查詢時資料庫看到的是 authenticated 角色，
 * RLS 照常生效。要寫入點數、房間時用 lib/supabase/admin.ts，不是這個。
 */
export async function createClient() {
  // Next 15 起 cookies() 回傳 Promise，要 await
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // access token 過期時，getUser() 會用 refresh token 換新的，
          // 並透過這裡把新 cookie 寫回回應。
          // route handler 可以寫 cookie；如果之後有 Server Component 也用到這個函式，
          // 那裡不能寫 cookie 會丟錯，所以包 try。刷新由 proxy.ts 負責。
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // 在 Server Component 裡呼叫時會到這裡，忽略即可
          }
        },
      },
    },
  );
}

/**
 * 取得「經過驗證」的目前使用者，沒登入回 null。
 *
 * 用 getUser() 而不是 getSession()：
 *   - getSession() 只是把 cookie 裡的 JSON 解出來，不檢查它是不是 Supabase 簽發的。
 *     cookie 在使用者手上，可以被改寫。
 *   - getUser() 會把 access token 送到 Supabase Auth 伺服器驗證簽章與是否過期。
 * 拿來決定 identity 和扣誰的點，一定要用驗證過的那個。
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}
