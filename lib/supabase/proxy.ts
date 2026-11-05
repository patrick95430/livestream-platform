import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * 在每個請求進到頁面或 API 之前，刷新 Supabase 的 session cookie。
 *
 * 為什麼需要：Supabase 的 access token 預設一小時過期。過期之後要用 refresh token
 * 換一張新的，然後把新 token 寫回 cookie。route handler 雖然也能寫 cookie，
 * 但 Server Component 不能；把刷新集中在這裡做，所有地方讀到的都是有效 token。
 *
 * 新 cookie 要寫兩個地方：
 *   - request.cookies：讓「這一次」請求後面的 route handler 讀到新的 token
 *   - response.cookies：讓瀏覽器存起來，下一次請求帶新的 token
 */
export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // 還沒設定 Supabase 時直接放行，不要讓整個網站掛掉
  if (!url || !key) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        // request 的 cookie 改了，要重新建立 response，後面的處理才看得到
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // getClaims() 會驗證 JWT，過期時用 refresh token 換新的並觸發 setAll。
  // 在 createServerClient 和這一行之間不要插其他程式，否則刷新可能錯過。
  await supabase.auth.getClaims();

  return response;
}
