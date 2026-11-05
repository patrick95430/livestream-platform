import { createClient } from '@supabase/supabase-js';

/**
 * 伺服器端、以 service_role 身分的 Supabase client。
 *
 * service_role 有 BYPASSRLS 屬性，RLS 對它無效，而且只有它能執行
 * send_gift / refund_gift（見 supabase/migrations/）。
 * 所以這個檔案只能被 app/api/ 底下的程式引用，絕對不要從 'use client' 元件引用。
 *
 * 用它之前，呼叫端必須已經用 lib/supabase/server.ts 的 getCurrentUser()
 * 驗證過使用者，並且只把驗證得到的 user.id 傳進查詢 —— 不要用前端傳來的 id。
 *
 * 少環境變數時回 null，讓呼叫端回 500 並印出清楚的訊息。
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !serviceKey) return null;

  return createClient(url, serviceKey, {
    // 這個 client 不代表任何登入的使用者，不需要存或刷新 session
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const MISSING_SUPABASE_MESSAGE =
  '伺服器缺少 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY，請檢查 .env.local';

/** 讀使用者的 profile（暱稱與點數）。用 admin client，因為呼叫端已經驗證過 userId。 */
export async function getProfile(userId: string) {
  const admin = createAdminClient();
  if (!admin) return null;

  const { data, error } = await admin
    .from('profiles')
    .select('id, nickname, points')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) return null;
  return data as { id: string; nickname: string; points: number };
}
