import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server';
import { getProfile } from '@/lib/supabase/admin';

/**
 * 目前登入的使用者：id、暱稱、點數。沒登入回 401。
 *
 * 前端顯示餘額時呼叫這支，不自己記數字。
 * 讀 cookie（getCurrentUser 內部呼叫 cookies()）會讓這個 route 自動變成每次請求才執行，
 * 不會被快取。
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '尚未登入' }, { status: 401 });
  }

  const profile = await getProfile(user.id);
  if (!profile) {
    return NextResponse.json({ error: '找不到使用者資料，請確認資料庫 migration 已套用' }, { status: 500 });
  }

  return NextResponse.json(profile);
}
