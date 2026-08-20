-- ============================================================
-- One-time AI character order flow:
--   1. Player sends a character request -> the admin-ai edge
--      function (service role) generates the character and
--      inserts it with status='pending' and requested_by = the
--      ordering player, then pushes to all admins.
--   2. Admins either approve or reject it from the admin panel
--      (My Characters / pending list).
--   3. On approve: the pending character becomes the requesting
--      player's character. If that player had already chosen a
--      different character, that previous one is released back to
--      the shared pool (available to everyone again) and the
--      approved character becomes their new active (claimed) one.
--   4. On reject: the character is marked rejected and removed
--      from the pending list (it is never playable).
-- ============================================================

-- Track who ordered a pending character created through the AI flow.
alter table public.characters add column if not exists requested_by uuid;

-- Allow 'rejected' as a terminal state for orders that were denied.
do $$
declare v_name text default null;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'public.characters'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%pending%'
  limit 1;
  if v_name is not null then
    execute format('alter table public.characters drop constraint %I', v_name);
  end if;
  alter table public.characters add constraint characters_status_check
    check (status in ('pending','approved','rejected'));
end $$;

-- ---------- Approve: grant the character to the requesting player ----------
create or replace function public.admin_approve_character(p_admin_token text, p_character_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
  v_char record;
  v_player uuid;
  v_old_active uuid;
  v_locked boolean;
begin
  if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;

  select * into v_char from public.characters where id = p_character_id for update;
  if v_char.id is null then raise exception 'الشخصية غير موجودة'; end if;
  if v_char.status <> 'pending' then
    raise exception 'هذه الشخصية ليست قيد الانتظار';
  end if;

  v_locked := coalesce(v_char.inherited, false);
  v_player := v_char.requested_by;

  if v_player is not null then
    -- Player already has a character they chose earlier? Release it back to the pool.
    select active_character_id into v_old_active from public.players where id = v_player for update;
    if v_old_active is not null and v_old_active <> p_character_id then
      update public.characters
         set owner_id = null, available = true, status = 'approved'
       where id = v_old_active;
      delete from public.player_characters
       where player_id = v_player and character_id = v_old_active;
      update public.players
         set active_character_id = null, has_character = false
       where id = v_player;
    end if;

    -- Grant the approved character to the ordering player.
    insert into public.player_characters(player_id, character_id, level, hp, atk)
    values (v_player, p_character_id,
            case when v_locked then coalesce(v_char.level,1) else 1 end,
            coalesce(v_char.hp,100), coalesce(v_char.atk,100));

    update public.characters
       set status = 'approved', owner_id = v_player, available = false
     where id = p_character_id;

    update public.players
       set has_character = true, active_character_id = p_character_id
     where id = v_player;

    perform public.push_dispatch(
      array[v_player],
      'شخصيتك جاهزة',
      'تم اعتماد شخصيتك "' || coalesce(v_char.name,'') || '"'
    );
  else
    -- Admin-created pending character (no request): just approve it.
    update public.characters set status = 'approved' where id = p_character_id;
  end if;
end;
$fn$;

-- ---------- Reject: deny the order ----------
create or replace function public.admin_reject_character(p_admin_token text, p_character_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
  v_char record;
  v_player uuid;
begin
  if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;

  select * into v_char from public.characters where id = p_character_id for update;
  if v_char.id is null then raise exception 'الشخصية غير موجودة'; end if;
  if v_char.status <> 'pending' then
    raise exception 'هذه الشخصية ليست قيد الانتظار';
  end if;

  v_player := v_char.requested_by;
  update public.characters set status = 'rejected', available = false where id = p_character_id;

  if v_player is not null then
    perform public.push_dispatch(
      array[v_player],
      'تم رفض طلب شخصيتك',
      'تم رفض طلبك لشخصية "' || coalesce(v_char.name,'') || '"'
    );
  end if;
end;
$fn$;

-- ---------- Push to admins when a player orders a character ----------
create or replace function public.push_trg_character_order()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_admins uuid[];
begin
  if new.requested_by is null then
    return new;
  end if;

  select array_agg(player_id) into v_admins
  from public.admins
  where player_id is not null;

  if v_admins is null then return new; end if;

  perform public.push_dispatch(
    v_admins,
    'طلب شخصية جديد',
    'طلب اللاعب "' || coalesce(new.name,'') || '" الشخصية بالذكاء الاصطناعي وانظر لوحة الإدارة للموافقة'
  );
  return new;
end;
$fn$;

drop trigger if exists trg_push_character_order on public.characters;
create trigger trg_push_character_order
after insert on public.characters
for each row execute function public.push_trg_character_order();

-- ---------- Push to admins when a player submits a skill order ----------
create or replace function public.push_trg_skill_order()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_admins uuid[];
  v_player_name text;
begin
  select u.username into v_player_name
  from public.players pl
  join public.users u on u.id = pl.user_id
  where pl.id = new.player_id;

  select array_agg(player_id) into v_admins
  from public.admins
  where player_id is not null;

  if v_admins is null then return new; end if;

  perform public.push_dispatch(
    v_admins,
    'طلب مهارة جديد',
    'طلب اللاعب ' || coalesce(v_player_name,'') || ' مهارة عند المستوى ' || coalesce(new.level,0)
  );
  return new;
end;
$fn$;

drop trigger if exists trg_push_skill_order on public.skill_requests;
create trigger trg_push_skill_order
after insert on public.skill_requests
for each row execute function public.push_trg_skill_order();