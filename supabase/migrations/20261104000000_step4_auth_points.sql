-- ============================================================================
-- 步驟 4：帳號、房間、點數
--
-- 用法：Supabase Dashboard → SQL Editor → 貼上整份 → Run。
-- 整份包在一個交易裡，中途任何一行失敗，整份都不會生效，可以修正後重跑。
--
-- 這份 SQL 建立四層保護，任何一層單獨失效，點數都還不會被前端改掉：
--   1. GRANT：anon / authenticated 角色沒有 insert/update/delete 權限
--   2. RLS：就算有權限，也只看得到 policy 允許的列
--   3. 扣點 function 只開放給 service_role（只存在伺服器端的金鑰）
--   4. CHECK 約束：points 不能小於 0，由資料庫在寫入時檢查
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. 資料表
-- ----------------------------------------------------------------------------

create table public.profiles (
  id       uuid primary key references auth.users (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 30),
  -- points >= 0 是資料庫層的不變量：就算應用程式邏輯寫錯，
  -- 讓餘額變負的 UPDATE 也會被資料庫拒絕。
  points   integer not null default 100 check (points >= 0)
);

-- 和 BUILD.md 的差異：
--   * name 加 unique。LiveKit 用名稱字串識別房間，
--     資料表裡兩列同名會對應到同一個 LiveKit 房間。
--   * 拿掉 is_live。沒有任何程式會把它改回 false，留著只會讓列表不準。
--     「現在有沒有人在直播」改問 LiveKit（它本來就知道每個房間有幾人）。
create table public.rooms (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (char_length(name) between 1 and 40),
  host_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.gifts (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms (id) on delete cascade,
  from_id    uuid not null references public.profiles (id) on delete cascade,
  gift_key   text not null,
  points     integer not null check (points > 0),
  created_at timestamptz not null default now()
);

create index gifts_room_created_idx on public.gifts (room_id, created_at desc);
create index gifts_from_idx on public.gifts (from_id);
create index rooms_host_idx on public.rooms (host_id);

-- ----------------------------------------------------------------------------
-- 2. 註冊時自動建立 profile
--
-- supabase.auth.signUp() 只會寫入 auth.users（Supabase Auth 管理的表），
-- 不會碰 public.profiles。沒有這個 trigger，新使用者就沒有 profile，
-- 之後建房時 rooms.host_id 的外鍵會插入失敗。
--
-- security definer：trigger 是由 Supabase Auth 的資料庫角色觸發的，
-- 那個角色沒有 public.profiles 的寫入權限，所以 function 要以建立者
-- （postgres）的權限執行。
-- set search_path = ''：security definer function 一定要固定 search_path，
-- 否則呼叫者可以在自己的 schema 放一個同名物件，讓 function 用高權限去執行它。
-- 因此 function 裡所有物件都寫完整名稱（public.profiles）。
-- ----------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nickname)
  values (
    new.id,
    left(
      coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'nickname'), ''),
        split_part(new.email, '@', 1)
      ),
      30
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 3. 權限第一層：GRANT
--
-- Supabase 預設會把 public schema 裡新表的所有權限給 anon 和 authenticated
-- （瀏覽器拿 anon key 時就是這兩個角色）。這裡把寫入權限收回。
-- Postgres 先檢查 GRANT，再檢查 RLS，兩層是獨立的。
-- ----------------------------------------------------------------------------

revoke insert, update, delete, truncate
  on public.profiles, public.rooms, public.gifts
  from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. 權限第二層：RLS
--
-- 開了 RLS 而沒有對應 policy 的操作，一律視為不允許。
-- 這裡只寫 select policy，所以前端只能讀，而且只讀得到允許的列。
-- service_role 有 BYPASSRLS 屬性，不受這些 policy 限制。
--
-- (select auth.uid()) 外面包一層 select：讓 Postgres 每個查詢只算一次，
-- 而不是每一列都呼叫一次 auth.uid()。
-- ----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.rooms    enable row level security;
alter table public.gifts    enable row level security;

create policy "profiles: 只讀自己"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "rooms: 所有人可讀"
  on public.rooms for select
  to anon, authenticated
  using (true);

create policy "gifts: 只讀自己送的"
  on public.gifts for select
  to authenticated
  using ((select auth.uid()) = from_id);

-- ----------------------------------------------------------------------------
-- 5. 送禮：扣點 + 寫紀錄，在同一個交易裡
--
-- 為什麼要寫成 function：supabase-js 的每次呼叫是一個獨立的 HTTP 請求，
-- 各自是一個交易。如果在 route handler 裡分成「讀點數 → 檢查 → 扣點 → 寫紀錄」
-- 三次呼叫：
--   (a) 兩個同時到達的請求都讀到 10 點、都通過檢查、都扣款 → 餘額變負
--   (b) 扣款成功但寫紀錄失敗 → 點數消失，沒有紀錄
-- 用 .rpc() 呼叫 function 時，整個 function 在同一個交易裡執行，(b) 不會發生。
--
-- (a) 由下面那一行 UPDATE 解決：檢查（points >= p_points）和扣款寫在同一個
-- 陳述式。UPDATE 會先鎖住這一列；第二個同時到達的交易會等第一個 commit，
-- 然後用「更新後的值」重新判斷 WHERE 條件（Postgres READ COMMITTED 的行為），
-- 所以第二個交易看到的是已經扣過的餘額。
--
-- 沒有寫 security definer：這個 function 只給 service_role 呼叫，
-- service_role 本來就有權限，不需要提升權限。
-- ----------------------------------------------------------------------------

create function public.send_gift(
  p_user   uuid,
  p_room   text,
  p_gift   text,
  p_points integer
)
returns table (gift_id uuid, balance integer)
language plpgsql
set search_path = ''
as $$
declare
  v_room uuid;
  v_gift uuid;
  v_left integer;
begin
  if p_points is null or p_points <= 0 then
    raise exception 'invalid_points';
  end if;

  select r.id into v_room from public.rooms r where r.name = p_room;
  if v_room is null then
    raise exception 'room_not_found';
  end if;

  update public.profiles p
     set points = p.points - p_points
   where p.id = p_user
     and p.points >= p_points
  returning p.points into v_left;

  if v_left is null then
    raise exception 'insufficient_points';
  end if;

  insert into public.gifts (room_id, from_id, gift_key, points)
  values (v_room, p_user, p_gift, p_points)
  returning id into v_gift;

  return query select v_gift, v_left;
end;
$$;

-- 退款：扣款成功但 LiveKit 廣播失敗時，由 /api/gifts 呼叫。
-- 刪掉那筆紀錄、把點數加回去，同一個交易。
create function public.refund_gift(p_gift_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_user   uuid;
  v_points integer;
  v_left   integer;
begin
  delete from public.gifts g
   where g.id = p_gift_id
  returning g.from_id, g.points into v_user, v_points;

  if v_user is null then
    raise exception 'gift_not_found';
  end if;

  update public.profiles p
     set points = p.points + v_points
   where p.id = v_user
  returning p.points into v_left;

  return v_left;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. 權限第三層：function 只開放給 service_role
--
-- Supabase 預設會把 public schema 裡新 function 的執行權限給 anon 和
-- authenticated，而 PostgREST 會把 public 的 function 開放成
-- POST /rest/v1/rpc/<name>。不收回的話，登入的使用者可以從瀏覽器直接呼叫
-- send_gift，自己填 p_user（扣別人的點）和 p_points。
-- 只 revoke from public 不夠，因為 anon / authenticated 是被個別 grant 的。
-- ----------------------------------------------------------------------------

revoke execute on function public.send_gift(uuid, text, text, integer) from public, anon, authenticated;
revoke execute on function public.refund_gift(uuid)                    from public, anon, authenticated;
revoke execute on function public.handle_new_user()                    from public, anon, authenticated;

grant execute on function public.send_gift(uuid, text, text, integer) to service_role;
grant execute on function public.refund_gift(uuid)                    to service_role;

commit;
