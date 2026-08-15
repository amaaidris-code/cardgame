-- ============================================================
-- خلفيات صفحات مهارات الأسلحة (كل 4 مهارات = صفحة)
-- نفس فكرة character_skill_page_backgrounds لكن لكل سلاح
-- ============================================================

create table if not exists public.weapon_skill_page_backgrounds (
    weapon_id   uuid not null references public.weapons(id) on delete cascade,
    page_index  integer not null default 0,
    image_url   text,
    skill_scale numeric not null default 1,
    primary key (weapon_id, page_index)
);
alter table public.weapon_skill_page_backgrounds enable row level security;

-- ---------- لوحة الإدارة ----------
create or replace function public.admin_set_weapon_skill_page_background(
    p_admin_token text, p_weapon_id uuid, p_page_index integer, p_image_url text)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    insert into public.weapon_skill_page_backgrounds(weapon_id, page_index, image_url)
    values (p_weapon_id, p_page_index, p_image_url)
    on conflict (weapon_id, page_index)
    do update set image_url = excluded.image_url;
end;
$fn$;

create or replace function public.admin_set_weapon_skill_page_scale(
    p_admin_token text, p_weapon_id uuid, p_page_index integer, p_skill_scale numeric)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    insert into public.weapon_skill_page_backgrounds(weapon_id, page_index, skill_scale)
    values (p_weapon_id, p_page_index, coalesce(p_skill_scale, 1))
    on conflict (weapon_id, page_index)
    do update set skill_scale = excluded.skill_scale;
end;
$fn$;

create or replace function public.admin_list_weapon_skill_page_backgrounds(
    p_admin_token text, p_weapon_id uuid)
returns table (page_index integer, image_url text, skill_scale numeric)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    return query
        select b.page_index, b.image_url, b.skill_scale
        from public.weapon_skill_page_backgrounds b
        where b.weapon_id = p_weapon_id
        order by b.page_index;
end;
$fn$;

-- ---------- للعرض في المعركة ----------
create or replace function public.get_weapon_skill_page_backgrounds(p_weapon_id uuid)
returns table (page_index integer, image_url text, skill_scale numeric)
language sql stable security definer set search_path = public, extensions, pg_temp
as $fn$
    select b.page_index, b.image_url, b.skill_scale
    from public.weapon_skill_page_backgrounds b
    where b.weapon_id = p_weapon_id
    order by b.page_index;
$fn$;