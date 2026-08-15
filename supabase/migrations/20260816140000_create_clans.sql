-- ============================================================
-- Clans system
-- A player creates a clan (unique name) or joins an existing one.
-- Each clan has its own chat. Only the leader and admins can edit
-- the clan name and image. All access via SECURITY DEFINER RPCs
-- (custom player_token auth, same pattern as friends + chat).
-- Direct table access disabled via RLS with no public policies.
-- ============================================================

-- ---------- clans ----------
create table if not exists public.clans (
    id          uuid primary key default gen_random_uuid(),
    name        text not null unique,
    image_url   text,
    leader_id   uuid not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists clans_name_idx on public.clans (name);

alter table public.clans enable row level security;

-- ---------- clan_members ----------
create table if not exists public.clan_members (
    clan_id    uuid not null references public.clans(id) on delete cascade,
    player_id  uuid not null,
    role       text not null default 'member', -- leader | admin | member
    joined_at  timestamptz not null default now(),
    primary key (clan_id, player_id),
    unique (player_id) -- a player can belong to only one clan
);

create index if not exists clan_members_clan_idx on public.clan_members (clan_id);

alter table public.clan_members enable row level security;

-- ---------- clan_messages ----------
create table if not exists public.clan_messages (
    id          uuid primary key default gen_random_uuid(),
    clan_id     uuid not null references public.clans(id) on delete cascade,
    sender_id   uuid not null,
    message     text,
    image_url   text,
    created_at  timestamptz not null default now()
);

create index if not exists clan_messages_clan_idx
    on public.clan_messages (clan_id, created_at);

alter table public.clan_messages enable row level security;

-- No direct SELECT/INSERT/UPDATE policies: all access via SECURITY DEFINER RPCs.

-- ============================================================
-- helper: what role does player have in a clan?
-- ============================================================
create or replace function public.clan_player_role(p_clan_id uuid, p_player_id uuid)
returns text
language sql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
    select cm.role from public.clan_members cm
    where cm.clan_id = p_clan_id and cm.player_id = p_player_id;
$$;

-- ============================================================
-- my clan + my role (or null if not in a clan)
-- ============================================================
create or replace function public.clan_my_clan(p_token text)
returns table (clan_id uuid, name text, image_url text, member_count bigint, my_role text)
language sql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
    with me as (select public.player_id_from_token(p_token) as id)
    select
        c.id as clan_id,
        c.name,
        c.image_url,
        (select count(*) from public.clan_members cm2 where cm2.clan_id = c.id) as member_count,
        cm.role as my_role
    from me
    join public.clan_members cm on cm.player_id = me.id
    join public.clans c on c.id = cm.clan_id;
$fn$;

-- ============================================================
-- list members of a clan (caller must be a member)
-- ============================================================
create or replace function public.clan_list_members(p_token text, p_clan_id uuid)
returns table (player_id uuid, username text, role text, joined_at timestamptz)
language sql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
    with me as (select public.player_id_from_token(p_token) as id)
    select
        cm.player_id,
        u.username,
        cm.role,
        cm.joined_at
    from public.clan_members cm
    join public.players pl on pl.id = cm.player_id
    join public.users u on u.id = pl.user_id
    where cm.clan_id = p_clan_id
      and exists(select 1 from public.clan_members me2
                 where me2.clan_id = p_clan_id and me2.player_id = (select id from me))
    order by (cm.role = 'leader') desc,
             (cm.role = 'admin') desc,
             cm.joined_at asc;
$fn$;

-- ============================================================
-- search clans by name (for joining)
-- returns: matching clans, member count, whether I'm a member,
-- and whether I already have a clan (so client can disable join).
-- ============================================================
create or replace function public.clan_search(p_token text, p_query text)
returns table (clan_id uuid, name text, image_url text, member_count bigint, is_member boolean)
language sql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
    with me as (select public.player_id_from_token(p_token) as id)
    select
        c.id as clan_id,
        c.name,
        c.image_url,
        (select count(*) from public.clan_members cm2 where cm2.clan_id = c.id) as member_count,
        exists(select 1 from public.clan_members cm3
               where cm3.clan_id = c.id and cm3.player_id = (select id from me)) as is_member
    from public.clans c
    where c.name ilike '%' || nullif(btrim(p_query), '') || '%'
    order by c.name
    limit 50;
$fn$;

-- ============================================================
-- create a clan (creator becomes leader)
-- ============================================================
create or replace function public.clan_create(p_token text, p_name text, p_image_url text default null)
returns table (clan_id uuid, name text, image_url text, my_role text)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_me uuid;
    v_name text;
    v_img text;
    v_clan uuid;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;

    if exists(select 1 from public.clan_members where player_id = v_me) then
        raise exception 'أنت بالفعل في عصابة؛ اتركها أولًا';
    end if;

    v_name := nullif(btrim(p_name), '');
    if v_name is null then raise exception 'اكتب اسم عصابتك'; end if;
    v_name := left(v_name, 30);

    if exists(select 1 from public.clans where name = v_name) then
        raise exception 'اسم العصابة مستخدم بالفعل؛ اختر اسمًا آخر';
    end if;

    v_img := nullif(btrim(coalesce(p_image_url, '')), '');

    insert into public.clans (name, image_url, leader_id)
    values (v_name, v_img, v_me)
    returning id into v_clan;

    insert into public.clan_members (clan_id, player_id, role)
    values (v_clan, v_me, 'leader');

    return query select v_clan, v_name, v_img, 'leader'::text;
end;
$fn$;

-- ============================================================
-- join a clan (only if not already in one)
-- ============================================================
create or replace function public.clan_join(p_token text, p_clan_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare v_me uuid;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;

    if exists(select 1 from public.clan_members where player_id = v_me) then
        raise exception 'أنت بالفعل في عصابة؛ اتركها أولًا';
    end if;

    if not exists(select 1 from public.clans where id = p_clan_id) then
        raise exception 'العصابة غير موجودة';
    end if;

    insert into public.clan_members (clan_id, player_id, role)
    values (p_clan_id, v_me, 'member');
end;
$fn$;

-- ============================================================
-- leave my clan, or disband if leader with no one to take over.
-- ============================================================
create or replace function public.clan_leave(p_token text)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_me uuid;
    v_clan uuid;
    v_role text;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;

    select clan_id, role into v_clan, v_role
    from public.clan_members where player_id = v_me;

    if v_clan is null then raise exception 'أنت لست في أي عصابة'; end if;

    delete from public.clan_members where clan_id = v_clan and player_id = v_me;

    if v_role = 'leader' then
        -- promote the oldest admin, else oldest member, to leader
        update public.clan_members
        set role = 'leader'
        where clan_id = v_clan
          and player_id = (
              select cm.player_id
              from public.clan_members cm
              where cm.clan_id = v_clan
              order by (cm.role = 'admin') desc, cm.joined_at asc
              limit 1
          );

        if not exists(select 1 from public.clan_members where clan_id = v_clan) then
            delete from public.clan_messages where clan_id = v_clan;
            delete from public.clans where id = v_clan;
        end if;
    end if;
end;
$fn$;

-- ============================================================
-- edit clan name / image. Only leader and admins.
-- Pass null for a field to leave it unchanged.
-- ============================================================
create or replace function public.clan_update(p_token text, p_name text, p_image_url text)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_me uuid;
    v_clan uuid;
    v_role text;
    v_name text;
    v_img text;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;

    select clan_id, role into v_clan, v_role
    from public.clan_members where player_id = v_me;

    if v_clan is null then raise exception 'أنت لست في أي عصابة'; end if;
    if v_role not in ('leader', 'admin') then
        raise exception 'فقط القائد أو المشرف يمكنه تعديل اسم وصورة العصابة';
    end if;

    v_name := nullif(btrim(p_name), '');
    v_img := nullif(btrim(coalesce(p_image_url, '')), '');

    if v_name is not null then
        if length(v_name) < 2 then raise exception 'الاسم قصير جدًا'; end if;
        v_name := left(v_name, 30);
        if exists(select 1 from public.clans where name = v_name and id <> v_clan) then
            raise exception 'اسم العصابة مستخدم بالفعل؛ اختر اسمًا آخر';
        end if;
        update public.clans set name = v_name, updated_at = now() where id = v_clan;
    end if;

    if p_image_url is not null then
        update public.clans set image_url = v_img, updated_at = now() where id = v_clan;
    end if;
end;
$fn$;

-- ============================================================
-- promote a member to admin (leader only)
-- ============================================================
create or replace function public.clan_promote(p_token text, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_me uuid;
    v_clan uuid;
    v_role text;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;

    select clan_id, role into v_clan, v_role
    from public.clan_members where player_id = v_me;
    if v_clan is null then raise exception 'أنت لست في أي عصابة'; end if;
    if v_role <> 'leader' then raise exception 'فقط القائد يمكنه رفع المشرفين'; end if;

    if not exists(select 1 from public.clan_members
                  where clan_id = v_clan and player_id = p_player_id) then
        raise exception 'العضو غير موجود في عصابتك';
    end if;

    update public.clan_members set role = 'admin'
    where clan_id = v_clan and player_id = p_player_id;
end;
$fn$;

-- ============================================================
-- demote an admin to member (leader only)
-- ============================================================
create or replace function public.clan_demote(p_token text, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_me uuid;
    v_clan uuid;
    v_role text;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;

    select clan_id, role into v_clan, v_role
    from public.clan_members where player_id = v_me;
    if v_clan is null then raise exception 'أنت لست في أي عصابة'; end if;
    if v_role <> 'leader' then raise exception 'فقط القائد يمكنه إزالة مشرف'; end if;

    update public.clan_members set role = 'member'
    where clan_id = v_clan and player_id = p_player_id
      and role = 'admin';
end;
$fn$;

-- ============================================================
-- kick a member (leader or admin; cannot kick the leader)
-- ============================================================
create or replace function public.clan_kick(p_token text, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_me uuid;
    v_clan uuid;
    v_role text;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;

    select clan_id, role into v_clan, v_role
    from public.clan_members where player_id = v_me;
    if v_clan is null then raise exception 'أنت لست في أي عصابة'; end if;
    if v_role not in ('leader', 'admin') then raise exception 'غير مصرح'; end if;

    if exists(select 1 from public.clan_members
              where clan_id = v_clan and player_id = p_player_id and role = 'leader') then
        raise exception 'لا يمكن طرد القائد';
    end if;

    delete from public.clan_members
    where clan_id = v_clan and player_id = p_player_id;
end;
$fn$;

-- ============================================================
-- clan chat
-- ============================================================
-- send a message (must be a member). Reuses chat-images bucket.
create or replace function public.clan_send_message(p_token text, p_message text, p_image_url text default null)
returns table (id uuid, clan_id uuid, sender_id uuid, sender_username text, message text, image_url text, created_at timestamptz)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_me uuid;
    v_clan uuid;
    v_msg text;
    v_img text;
    r_id uuid;
    r_created timestamptz;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;

    select clan_id into v_clan from public.clan_members where player_id = v_me;
    if v_clan is null then raise exception 'يجب أن تكون عضوًا في عصابة لتكتب'; end if;

    v_msg := nullif(btrim(p_message), '');
    v_img := nullif(btrim(coalesce(p_image_url, '')), '');
    if v_msg is null and v_img is null then raise exception 'الرسالة فارغة'; end if;
    v_msg := left(v_msg, 1000);

    insert into public.clan_messages (clan_id, sender_id, message, image_url)
    values (v_clan, v_me, v_msg, v_img)
    returning id, created_at into r_id, r_created;

    return query
    select r_id, v_clan, v_me, u.username, v_msg, v_img, r_created
    from public.players pl
    join public.users u on u.id = pl.user_id
    where pl.id = v_me;
end;
$fn$;

-- get the latest messages of my clan (must be a member)
create or replace function public.clan_get_messages(p_token text, p_limit int default 200)
returns table (id uuid, clan_id uuid, sender_id uuid, sender_username text, message text, image_url text, created_at timestamptz)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_me uuid;
    v_clan uuid;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;

    select clan_id into v_clan from public.clan_members where player_id = v_me;
    if v_clan is null then raise exception 'يجب أن تكون عضوًا في عصابة'; end if;

    return query
    select * from (
        select cm.id, cm.clan_id, cm.sender_id, u.username as sender_username,
               cm.message, cm.image_url, cm.created_at
        from public.clan_messages cm
        join public.players pl on pl.id = cm.sender_id
        join public.users u on u.id = pl.user_id
        where cm.clan_id = v_clan
        order by cm.created_at desc
        limit greatest(1, least(p_limit, 300))
    ) t
    order by t.created_at asc;
end;
$fn$;