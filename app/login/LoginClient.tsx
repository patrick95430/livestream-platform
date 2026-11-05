'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * 登入／註冊（最小可用版本，A 可以重做畫面）。
 *
 * 呼叫 Supabase Auth 的方式不要改：
 *   - 用 lib/supabase/client.ts 的 createClient（內部是 createBrowserClient），
 *     session 才會寫進 cookie，伺服器的 /api/token、/api/gifts 才讀得到。
 *   - 暱稱放在 signUp 的 options.data.nickname，資料庫 trigger 會讀它建立 profile。
 */
export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  // 只接受站內路徑。如果直接用 ?next= 的值跳轉，
  // 別人可以做一個 /login?next=https://釣魚網站 的連結（open redirect）。
  const rawNext = searchParams.get('next') ?? '/';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    setMessage(undefined);

    const supabase = createClient();

    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { nickname: nickname.trim() } },
        });
        if (error) throw error;

        // Supabase 預設要求驗證 email：此時 signUp 成功但沒有 session。
        // 開發時可以到 Dashboard → Authentication → Sign In / Providers → Email
        // 關掉 Confirm email，註冊完就直接登入。
        if (!data.session) {
          setMessage('註冊成功，請到信箱點確認連結後再登入。');
          setMode('signin');
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }

      router.replace(next);
      // 讓伺服器端重新讀 cookie，頁面上的登入狀態才會更新
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-14">
      <h1 className="text-2xl font-medium">{mode === 'signin' ? '登入' : '註冊'}</h1>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
        {mode === 'signup' && (
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="暱稱（別人看到的名字）"
            required
            maxLength={30}
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-sky-500"
          />
        )}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
          autoComplete="email"
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-sky-500"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密碼（至少 6 字）"
          required
          minLength={6}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-sky-500"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
        >
          {busy ? '處理中…' : mode === 'signin' ? '登入' : '註冊'}
        </button>
      </form>

      {message && (
        <p className="mt-4 rounded border border-emerald-900 bg-emerald-950 px-3 py-2 text-sm text-emerald-300">
          {message}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <button
        onClick={() => {
          setMode(mode === 'signin' ? 'signup' : 'signin');
          setError(undefined);
          setMessage(undefined);
        }}
        className="mt-6 text-sm text-sky-400 hover:underline"
      >
        {mode === 'signin' ? '還沒有帳號？註冊' : '已經有帳號？登入'}
      </button>
      <Link href="/" className="mt-2 text-center text-sm text-neutral-400 hover:underline">
        回首頁
      </Link>
    </main>
  );
}
