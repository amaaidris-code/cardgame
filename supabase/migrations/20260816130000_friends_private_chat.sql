-- ============================================================
-- Friends + private chat system
-- Players with a valid player_token can send/accept friend
-- requests; accepted friends can exchange private messages.
-- All access is via SECURITY DEFINER RPCs (custom player_token
-- auth, same pattern as the global chat). Direct table access
-- disabled via RLS with no public policies.
-- ============================================================

-- ---------- friend_requests ----------
create table if not exists public.friend_requests (
    id              uuid primary key default gen_random_uuid(),
    from_player_id  uuid not null,
    to_player_id    uuid not null,
    status          text not null default 'pending', -- pending | accepted | declined
    created_at      timestamptz not null default now(),
    responded_at    timestamptz,
    unique (from_player_id, to_player_id)
);

create index if not exists friend_requests_to_idx on public.friend_requests (to_player_id, status);

alter table public.friend_requests enable row level security;

-- ---------- friends ----------
create table if not exists public.friends (
    player_id   uuid not null,
    friend_id   uuid not null,
    created_at  timestamptz not null default now(),
    primary key (player_id, friend_id)
);

create index if not exists friends_player_idx on public.friends (player_id);

alter table public.friends enable row level security;

-- ---------- private_messages ----------
create table if not exists public.private_messages (
    id          uuid primary key default gen_random_uuid(),
    sender_id   uuid not null,
    receiver_id uuid not null,
    message     text,
    image_url   text,
    created_at  timestamptz not null default now(),
    read_at     timestamptz
);

create index if not exists private_messages_pair_idx
    on public.private_messages (sender_id, receiver_id, created_at);

create index if not exists private_messages_receiver_idx
    on public.private_messages (receiver_id, read_at);

alter table public.private_messages enable row level security;

-- No direct SELECT/INSERT policies: all access via SECURITY DEFINER RPCs.

-- ============================================================
-- helper: are two players friends? (checks both directions)
-- ============================================================
create or replace function public.are_friends(p1 uuid, p2 uuid)
returns boolean
language sql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
    select exists(
        select 1 from public.friends f
        where (f.player_id = p1 and f.friend_id = p2)
           or (f.player_id = p2 and f.friend_id = p1)
    );
$$;

-- ============================================================
-- find players by username (for sending requests)
-- returns: matching players, whether already friends, and the
-- outgoing pending request id (null if none).
-- ============================================================
create or replace function public.friend_search(p_token text, p_query text)
returns table (player_id uuid, username text, is_friend boolean, outgoing_request_id uuid)
language sql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
    with me as (
        select public.player_id_from_token(p_token) as id
    )
    select
        pl.id as player_id,
        u.username,
        public.are_friends(pl.id, me.id) as is_friend,
        (select fr.id from public.friend_requests fr
         where fr.from_player_id = me.id and fr.to_player_id = pl.id
           and fr.status = 'pending') as outgoing_request_id
    from me
    join public.players pl on pl.id <> me.id
    join public.users u on u.id = pl.user_id
    where u.username ilike '%' || nullif(btrim(p_query), '') || '%'
    order by u.username
    limit 50;
$fn$;

-- ============================================================
-- send a friend request
-- ============================================================
create or replace function public.friend_send_request(p_token text, p_to_player_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_from uuid;
    v_other_direction uuid;
begin
    v_from := public.player_id_from_token(p_token);
    if v_from is null then raise exception 'غير مصرح'; end if;
    if v_from = p_to_player_id then raise exception 'لا يمكنك إضافة نفسك صديقًا'; end if;

    if public.are_friends(v_from, p_to_player_id) then
        raise exception 'أنتم أصدقاء بالفعل';
    end if;

    -- إذا كانت هناك طلبات معلقة من الطرف الآخر، نقبلها تلقائيًا
    if exists(
        select 1 from public.friend_requests
        where from_player_id = p_to_player_id and to_player_id = v_from and status = 'pending'
    ) then
        update public.friend_requests set status = 'accepted', responded_at = now()
        where from_player_id = p_to_player_id and to_player_id = v_from and status = 'pending';
        insert into public.friends (player_id, friend_id) values (v_from, p_to_player_id);
        insert into public.friends (player_id, friend_id) values (p_to_player_id, v_from);
        return;
    end if;

    insert into public.friend_requests (from_player_id, to_player_id, status)
    values (v_from, p_to_player_id, 'pending')
    on conflict (from_player_id, to_player_id) do nothing;
end;
$fn$;

-- ============================================================
-- cancel / decline an outgoing / incoming pending request
-- p_target_player_id = the other player.
-- ============================================================
create or replace function public.friend_cancel_request(p_token text, p_target_player_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
begin
    delete from public.friend_requests
    where status = 'pending'
      and ((from_player_id = public.player_id_from_token(p_token) and to_player_id = p_target_player_id)
        or (from_player_id = p_target_player_id and to_player_id = public.player_id_from_token(p_token)));
end;
$fn$;

-- ============================================================
-- list my incoming + outgoing requests
-- ============================================================
create or replace function public.friend_list_requests(p_token text)
returns table (request_id uuid, peer_id uuid, peer_username text, direction text, created_at timestamptz)
language sql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
    with me as (select public.player_id_from_token(p_token) as id)
    select
        fr.id as request_id,
        case when fr.from_player_id = me.id then fr.to_player_id else fr.from_player_id end as peer_id,
        u.username as peer_username,
        case when fr.from_player_id = me.id then 'outgoing' else 'incoming' end as direction,
        fr.created_at
    from me
    join public.friend_requests fr on fr.from_player_id = me.id or fr.to_player_id = me.id
    join public.users u on u.id = (
        case when fr.from_player_id = me.id
             then (select pl2.user_id from public.players pl2 where pl2.id = fr.to_player_id)
             else (select pl2.user_id from public.players pl2 where pl2.id = fr.from_player_id) end
    )
    where fr.status = 'pending'
    order by fr.created_at desc;
$fn$;

-- ============================================================
-- respond to an incoming request (accept / decline)
-- ============================================================
create or replace function public.friend_respond_request(p_token text, p_request_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_me uuid;
    v_from uuid;
    v_to uuid;
    v_ok boolean;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;

    select fr.from_player_id, fr.to_player_id,
           (fr.to_player_id = v_me and fr.status = 'pending')
    into v_from, v_to, v_ok
    from public.friend_requests fr
    where fr.id = p_request_id;

    if v_ok is null then raise exception 'الطلب غير موجود'; end if;
    if not v_ok then raise exception 'هذا الطلب ليس لك'; end if;

    if p_accept then
        update public.friend_requests set status = 'accepted', responded_at = now()
        where id = p_request_id;
        insert into public.friends (player_id, friend_id) values (v_to, v_from)
        on conflict do nothing;
        insert into public.friends (player_id, friend_id) values (v_from, v_to)
        on conflict do nothing;
    else
        update public.friend_requests set status = 'declined', responded_at = now()
        where id = p_request_id;
    end if;
end;
$fn$;

-- ============================================================
-- list my friends (usernames)
-- ============================================================
create or replace function public.friend_list(p_token text)
returns table (friend_id uuid, username text, is_online boolean)
language sql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
    select
        pl.id as friend_id,
        u.username,
        pl.last_active_at > now() - interval '2 minutes' as is_online
    from public.friends f
    join public.players pl on pl.id = f.friend_id
    join public.users u on u.id = pl.user_id
    where f.player_id = public.player_id_from_token(p_token)
    order by u.username;
$fn$;

-- ============================================================
-- remove a friend (both directions)
-- ============================================================
create or replace function public.friend_remove(p_token text, p_friend_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare v_me uuid;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    delete from public.friends where (player_id = v_me and friend_id = p_friend_id)
       or (player_id = p_friend_id and friend_id = v_me);
end;
$fn$;

-- ============================================================
-- private chat
-- ============================================================
-- send a private message (must be friends). Returns the stored row.
create or replace function public.dm_send_message(p_token text, p_to_player_id uuid, p_message text, p_image_url text default null)
returns table (id uuid, sender_id uuid, receiver_id uuid, message text, image_url text, created_at timestamptz)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_me uuid;
    v_msg text;
    v_img text;
    r_id uuid;
    r_created timestamptz;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    if not public.are_friends(v_me, p_to_player_id) then
        raise exception 'لا يمكنكم التحدث معًا قبل أن تكونا صديقين';
    end if;

    v_msg := nullif(btrim(p_message), '');
    v_img := nullif(btrim(p_image_url), '');
    if v_msg is null and v_img is null then raise exception 'الرسالة فارغة'; end if;
    v_msg := left(v_msg, 1000);

    insert into public.private_messages (sender_id, receiver_id, message, image_url)
    values (v_me, p_to_player_id, v_msg, v_img)
    returning private_messages.id, private_messages.created_at into r_id, r_created;

    return query select r_id, v_me, p_to_player_id, v_msg, v_img, r_created;
end;
$fn$;

-- get conversation with one friend (other player must be confirmed friend)
create or replace function public.dm_get_messages(p_token text, p_other_player_id uuid, p_limit int default 200)
returns table (id uuid, sender_id uuid, receiver_id uuid, message text, image_url text, created_at timestamptz)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_me uuid;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    if not public.are_friends(v_me, p_other_player_id) then
        raise exception 'لا يمكنكم التحدث معًا قبل أن تكونا صديقين';
    end if;

    -- mark the other player's messages to me as read
    update public.private_messages
    set read_at = now()
    where receiver_id = v_me and sender_id = p_other_player_id and read_at is null;

    return query
    select * from (
        select id, sender_id, receiver_id, message, image_url, created_at
        from public.private_messages
        where (sender_id = v_me and receiver_id = p_other_player_id)
           or (sender_id = p_other_player_id and receiver_id = v_me)
        order by created_at desc
        limit greatest(1, p_limit)
    ) t
    order by created_at asc;
end;
$fn$;

-- count unread private messages, grouped by sender (for badges)
create or replace function public.dm_unread(p_token text)
returns table (sender_id uuid, sender_username text, unread bigint)
language sql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
    select
        pm.sender_id,
        u.username as sender_username,
        count(*) as unread
    from public.private_messages pm
    join public.players pl on pl.id = pm.sender_id
    join public.users u on u.id = pl.user_id
    where pm.receiver_id = public.player_id_from_token(p_token)
      and pm.read_at is null
    group by pm.sender_id, u.username;
$fn$;

-- ============================================================
-- Storage bucket reuse: private chat images use the same rules as
-- global chat (public read, upload path begins with player_token).
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', true, 5242880,
        array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do nothing;