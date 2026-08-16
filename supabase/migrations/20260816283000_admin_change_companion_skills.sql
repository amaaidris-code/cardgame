-- ============================================================
-- Admin: change companion starter skills.
-- Admins can now attach EXISTING skills (from the shared skills
-- pool) to a companion's slots, re-slot them, or remove them,
-- instead of only being able to create brand-new skills.
-- ============================================================

-- Attach an existing skill from the pool to a companion.
-- Optionally place it at a specific slot (shifts existing slots
-- down to make room); when slot is null, appends at the end.
create or replace function public.admin_link_companion_skill(
    p_admin_token text, p_companion_id uuid, p_skill_id uuid, p_slot integer default null)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_slot integer; v_max integer;
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    if not exists (select 1 from public.companions where id = p_companion_id) then
        raise exception 'المرافق غير موجود';
    end if;
    if not exists (select 1 from public.skills where id = p_skill_id) then
        raise exception 'المهارة غير موجودة';
    end if;
    if exists (select 1 from public.companion_skills where companion_id = p_companion_id and skill_id = p_skill_id) then
        return; -- already linked
    end if;

    if p_slot is null then
        select coalesce(max(slot), 0) + 1 into v_slot from public.companion_skills where companion_id = p_companion_id;
    else
        v_slot := greatest(1, p_slot);
        -- shift existing occupant and everything after it down by one
        update public.companion_skills
        set slot = slot + 1
        where companion_id = p_companion_id and slot >= v_slot;
    end if;

    insert into public.companion_skills (companion_id, skill_id, slot)
    values (p_companion_id, p_skill_id, v_slot);
end;
$fn$;

-- Move an already-linked skill to a new slot (compact/reorder).
create or replace function public.admin_set_companion_skill_slot(
    p_admin_token text, p_companion_id uuid, p_skill_id uuid, p_new_slot integer)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_old integer;
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    select slot into v_old from public.companion_skills
    where companion_id = p_companion_id and skill_id = p_skill_id;
    if v_old is null then raise exception 'المهارة غير مرتبطة بهذا المرافق'; end if;
    if p_new_slot is null or p_new_slot < 1 then raise exception 'خانة غير صحيحة'; end if;
    if v_old = p_new_slot then return; end if;

    -- compact to avoid collisions on the way to the target slot
    update public.companion_skills set slot = v_old where slot is null and companion_id = p_companion_id;
    if p_new_slot > v_old then
        update public.companion_skills set slot = slot - 1
        where companion_id = p_companion_id and slot > v_old and slot <= p_new_slot;
    else
        update public.companion_skills set slot = slot + 1
        where companion_id = p_companion_id and slot >= p_new_slot and slot < v_old;
    end if;

    update public.companion_skills set slot = p_new_slot
    where companion_id = p_companion_id and skill_id = p_skill_id;
end;
$fn$;

-- Remove a linked skill from a companion and compact remaining slots.
create or replace function public.admin_remove_companion_skill(
    p_admin_token text, p_companion_id uuid, p_skill_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_removed integer;
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    delete from public.companion_skills
    where companion_id = p_companion_id and skill_id = p_skill_id
    returning slot into v_removed;
    update public.companion_skills set slot = slot - 1
    where companion_id = p_companion_id and slot > v_removed;
end;
$fn$;

-- Let the admin UI pick from the whole skill pool (id, name, type, damage, effect).
create or replace function public.admin_list_skills_pool(p_admin_token text)
returns table (id uuid, name text, type text, damage integer, effect text)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    return query select s.id, s.name, s.type, s.damage, s.effect
        from public.skills s
        order by s.name;
end;
$fn$;