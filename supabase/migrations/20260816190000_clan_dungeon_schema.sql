-- ============================================================
-- Clan Co-op Dungeon: schema + lobby + race (up-to-4-player party
-- fighting a dungeon monster gauntlet). Server-authoritative.
-- ============================================================

create table if not exists public.clan_dungeon_runs (
    id uuid primary key default gen_random_uuid(),
    clan_id uuid not null,
    dungeon_id uuid not null,
    status text not null default 'lobby',   -- lobby | race | active | finished
    monster_ids uuid[] not null default '{}',
    monster_index int not null default 0,
    turn_order uuid[] not null default '{}',
    turn_slot int not null default 0,
    turn_phase text not null default 'player',
    turn_player_id uuid,
    turn_deadline timestamptz,
    race_started_at timestamptz,
    winner_id uuid,
    monster_id uuid,
    monster_name text not null default '',
    monster_image text,
    monster_hp int not null default 0,
    monster_max_hp int not null default 0,
    monster_turns_taken int not null default 0,
    monster_cooldown_used jsonb not null default '{}',
    monster_cooldown_extra jsonb not null default '{}',
    monster_sealed_skill_ids uuid[] not null default '{}',
    monster_used_skill_ids uuid[] not null default '{}',
    monster_temp_atk int not null default 0,
    monster_temp_hp int not null default 0,
    monster_extra_turns int not null default 0,
    monster_absorb_mode text,
    monster_absorb_hits int not null default 0,
    monster_reflect_mult int not null default 0,
    monster_last_hp_before int,
    monster_last_damage int,
    monster_last_consumed boolean not null default true,
    monster_frozen_turns int not null default 0,
    monster_defending boolean not null default false,
    monster_shield_charges int not null default 0,
    monster_poison_damage int not null default 0,
    monster_poison_turns int not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.clan_dungeon_players (
    run_id uuid not null references public.clan_dungeon_runs(id) on delete cascade,
    player_id uuid not null,
    character_id uuid,
    base_hp int not null default 100,
    base_atk int not null default 100,
    hp int not null default 100,
    max_hp int not null default 100,
    turns_taken int not null default 0,
    cooldown_used jsonb not null default '{}',
    cooldown_extra jsonb not null default '{}',
    sealed_skill_ids uuid[] not null default '{}',
    used_skill_ids uuid[] not null default '{}',
    temp_atk int not null default 0,
    temp_hp int not null default 0,
    extra_turns int not null default 0,
    absorb_mode text,
    absorb_hits int not null default 0,
    reflect_mult int not null default 0,
    last_hp_before int,
    last_damage int,
    last_consumed boolean not null default true,
    frozen_turns int not null default 0,
    defending boolean not null default false,
    shield_charges int not null default 0,
    poison_damage int not null default 0,
    poison_turns int not null default 0,
    ready boolean not null default false,
    race_press_at timestamptz,
    alive boolean not null default true,
    joined_at timestamptz not null default now(),
    primary key (run_id, player_id)
);

create table if not exists public.clan_dungeon_cooldowns (
    run_id uuid not null references public.clan_dungeon_runs(id) on delete cascade,
    fighter_id uuid not null,
    skill_id uuid not null,
    last_used_turn int not null,
    extra_cooldown int not null default 0,
    primary key (run_id, fighter_id, skill_id)
);

create table if not exists public.clan_dungeon_claims (
    run_id uuid primary key references public.clan_dungeon_runs(id) on delete cascade,
    claimed_by uuid,
    claimed_at timestamptz not null default now()
);

alter table public.clan_dungeon_runs enable row level security;
alter table public.clan_dungeon_players enable row level security;
alter table public.clan_dungeon_cooldowns enable row level security;
alter table public.clan_dungeon_claims enable row level security;

-- ============ LOBBY ============
create or replace function public.clan_dungeon_list(p_token text, p_clan_id uuid)
returns table (run_id uuid, dungeon_id uuid, status text, monster_index int, member_count int, max_count int, dungeon_name text, created_at timestamptz)
language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $fn$
declare v_me uuid;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    if not exists(select 1 from public.clan_members cm where cm.clan_id = p_clan_id and cm.player_id = v_me) then
        raise exception 'لست عضوًا في هذه العصابة';
    end if;
    return query
    select r.id, r.dungeon_id, r.status, r.monster_index,
           (select count(*)::int from public.clan_dungeon_players cp where cp.run_id = r.id) as member_count,
           4::int as max_count,
           coalesce(d.name, '') as dungeon_name,
           r.created_at
    from public.clan_dungeon_runs r
    left join public.dungeons d on d.id = r.dungeon_id
    where r.clan_id = p_clan_id
      and r.status in ('lobby','race','active')
    order by r.created_at desc;
end; $fn$;

create or replace function public.clan_dungeon_create(p_token text, p_clan_id uuid, p_dungeon_id uuid)
returns table (run_id uuid, status text)
language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $fn$
declare
    v_me uuid; v_run uuid; v_dungeon record;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    if not exists(select 1 from public.clan_members cm where cm.clan_id = p_clan_id and cm.player_id = v_me) then
        raise exception 'لست عضوًا في هذه العصابة';
    end if;
    select * into v_dungeon from public.dungeons d where d.id = p_dungeon_id and d.active = true;
    if v_dungeon.id is null then raise exception 'هذه الزنزانة غير متاحة'; end if;
    if coalesce(array_length(v_dungeon.monster_ids,1),0) = 0 then
        raise exception 'هذه الزنزانة لا تحتوي على وحوش';
    end if;
    if exists(select 1 from public.clan_dungeon_players cp
              join public.clan_dungeon_runs r on r.id = cp.run_id
              where cp.player_id = v_me and r.status in ('lobby','race','active')) then
        raise exception 'أنت بالفعل في زنزانة جماعية نشطة';
    end if;
    insert into public.clan_dungeon_runs (clan_id, dungeon_id, monster_ids, monster_index, status, turn_slot, turn_phase)
    values (p_clan_id, p_dungeon_id, v_dungeon.monster_ids, 0, 'lobby', 0, 'player')
    returning id into v_run;
    return query select v_run, 'lobby';
end; $fn$;

create or replace function public.clan_dungeon_join(p_token text, p_run_id uuid)
returns void
language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $fn$
declare
    v_me uuid; v_run record; v_pc record;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    select * into v_run from public.clan_dungeon_runs r where r.id = p_run_id for update;
    if v_run.id is null then raise exception 'الزنزانة غير موجودة'; end if;
    if v_run.status <> 'lobby' then raise exception 'الزنزانة بدأت بالفعل'; end if;
    if not exists(select 1 from public.clan_members cm where cm.clan_id = v_run.clan_id and cm.player_id = v_me) then
        raise exception 'لست عضوًا في هذا العصابة';
    end if;
    if (select count(*) from public.clan_dungeon_players cp where cp.run_id = p_run_id) >= 4 then
        raise exception 'الزنزانة ممتلئة (4 لاعبين كحد أقصى)';
    end if;
    if exists(select 1 from public.clan_dungeon_players cp
              join public.clan_dungeon_runs r on r.id = cp.run_id
              where cp.player_id = v_me and r.status in ('lobby','race','active')) then
        raise exception 'أنت بالفعل في زنزانة جماعية نشطة';
    end if;
    select pc.id, c.hp as chp, c.atk as catk
      into v_pc
      from public.player_characters pc
      join public.characters c on c.id = pc.character_id
     where pc.player_id = v_me
       and pc.character_id = (select active_character_id from public.players where id = v_me);
    if v_pc.id is null then raise exception 'ليس لديك شخصية نشطة'; end if;
    insert into public.clan_dungeon_players
        (run_id, player_id, character_id, base_hp, base_atk, hp, max_hp, ready)
    values
        (p_run_id, v_me, v_pc.id, coalesce(v_pc.chp,100), coalesce(v_pc.catk,100),
         coalesce(v_pc.chp,100), coalesce(v_pc.chp,100), false);
end; $fn$;

create or replace function public.clan_dungeon_leave(p_token text, p_run_id uuid)
returns void
language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $fn$
declare v_me uuid; v_run record;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    select * into v_run from public.clan_dungeon_runs r where r.id = p_run_id for update;
    if v_run.id is null then raise exception 'الزنزانة غير موجودة'; end if;
    if v_run.status = 'lobby' then
        delete from public.clan_dungeon_players where run_id = p_run_id and player_id = v_me;
        if not exists(select 1 from public.clan_dungeon_players where run_id = p_run_id) then
            delete from public.clan_dungeon_runs where id = p_run_id;
        end if;
    elsif v_run.status in ('race','active') then
        update public.clan_dungeon_players set alive = false where run_id = p_run_id and player_id = v_me;
    else
        raise exception 'الزنزانة انتهت';
    end if;
end; $fn$;

create or replace function public.clan_dungeon_ready(p_token text, p_run_id uuid, p_ready boolean)
returns void
language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $fn$
declare v_me uuid;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    update public.clan_dungeon_players set ready = p_ready
    where run_id = p_run_id and player_id = v_me;
    if not found then raise exception 'لست في هذه الزنزانة'; end if;
end; $fn$;

-- ============ RACE ============
create or replace function public.clan_dungeon_start_race(p_token text, p_run_id uuid)
returns void language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $fn$
declare v_me uuid; v_run record; v_n int;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    select * into v_run from public.clan_dungeon_runs where id=p_run_id for update;
    if v_run.id is null then raise exception 'الزنزانة غير موجودة'; end if;
    if v_run.status <> 'lobby' then raise exception 'الزنزانة بدأت بالفعل'; end if;
    if not exists(select 1 from public.clan_dungeon_players cp where cp.run_id=p_run_id and cp.player_id=v_me) then
        raise exception 'لست في هذه الزنزانة'; end if;
    v_n := (select count(*)::int from public.clan_dungeon_players cp where cp.run_id=p_run_id);
    if v_n < 2 then raise exception 'يحتاج اللعب الجماعي إلى لاعبين اثنين على الأقل'; end if;
    update public.clan_dungeon_players set race_press_at=null where run_id=p_run_id;
    update public.clan_dungeon_runs set status='race', race_started_at=now() where id=p_run_id;
end; $fn$;

create or replace function public.clan_dungeon_race_press(p_token text, p_run_id uuid)
returns void language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $fn$
declare v_me uuid; v_run record;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    select status into v_run from public.clan_dungeon_runs where id=p_run_id;
    if v_run.status <> 'race' then raise exception 'التسابق غير جارٍ'; end if;
    update public.clan_dungeon_players set race_press_at = coalesce(race_press_at, now())
    where run_id=p_run_id and player_id=v_me;
    if not found then raise exception 'لست في هذه الزنزانة'; end if;
end; $fn$;

create or replace function public.clan_dungeon_begin(p_token text, p_run_id uuid)
returns void language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $fn$
declare
    v_me uuid; v_run record; v_order uuid[];
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    select * into v_run from public.clan_dungeon_runs where id=p_run_id for update;
    if v_run.id is null then raise exception 'الزنزانة غير موجودة'; end if;
    if v_run.status <> 'race' then raise exception 'الزنزانة ليست في مرحلة التسابق'; end if;
    select array_agg(player_id order by race_press_at nulls last, joined_at)
      into v_order from public.clan_dungeon_players where run_id=p_run_id;
    if coalesce(array_length(v_order,1),0) < 1 then raise exception 'لا يوجد أعضاء لبدء المعركة'; end if;
    update public.clan_dungeon_runs set status='active', turn_order=v_order, turn_slot=0, turn_phase='player', monster_index=0
    where id=p_run_id;
    perform public.clan_dungeon_spawn_monster(p_run_id);
    perform public.clan_dungeon_schedule_player(p_run_id, -1);
end; $fn$;