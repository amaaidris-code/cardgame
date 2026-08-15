-- ============================================================
-- Clans: admins may be members of every clan; regular players
-- may only be in one clan.
-- ============================================================

-- Regular players: one clan at a time is enforced in the RPCs.
-- The unique(player_id) constraint is removed so that admin
-- accounts (admins.player_id) can join every clan.
alter table public.clan_members drop constraint if exists clan_members_player_id_key;

-- helper: is this player an admin linked to the admins table?
create or replace function public.player_is_admin(p_player_id uuid)
returns boolean
language sql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
    select exists(select 1 from public.admins a where a.player_id = p_player_id);
$$;

-- updated clan_create: non-admins may only create if not already in a clan;
-- admins may create freely even if they are in other clans.
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

    if not public.player_is_admin(v_me)
       and exists(select 1 from public.clan_members where player_id = v_me) then
        raise exception 'أنت بالفعل في عصابة؛ اتركها أولًا';
    end if;

    v_name := nullif(btrim(p_name), '');
    if v_name is null then raise exception 'اكتب اسم عصابتك'; end if;
    v_name := left(v_name, 30);

    if exists(select 1 from public.clans c where c.name = v_name) then
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

-- updated clan_join: non-admins may only join if not already in a clan;
-- admins may join any/all clans.
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

    if not public.player_is_admin(v_me)
       and exists(select 1 from public.clan_members where player_id = v_me) then
        raise exception 'أنت بالفعل في عصابة؛ اتركها أولًا';
    end if;

    if not exists(select 1 from public.clans where id = p_clan_id) then
        raise exception 'العصابة غير موجودة';
    end if;

    insert into public.clan_members (clan_id, player_id, role)
    values (p_clan_id, v_me, 'member')
    on conflict (clan_id, player_id) do nothing;
end;
$fn$;

-- clan_my_clan: list everything I'm a member of (multiple rows for admins;
-- one row for a typical player).
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
    join public.clans c on c.id = cm.clan_id
    order by cm.joined_at asc;
$fn$;