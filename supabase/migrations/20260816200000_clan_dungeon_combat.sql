-- ============================================================
-- Clan Co-op Dungeon: combat engine + state + rewards.
-- Depends on 20260816190000_clan_dungeon_schema.sql.
-- Reuses public.pvp_fighter_state / public.pvp_apply_effect.
-- ============================================================

-- ---------- cooldown helpers ----------
create or replace function public.clan_dungeon_cooldown_remaining(p_run_id uuid, p_fighter_id uuid, p_skill_id uuid, p_base_cd int, p_turns int) returns int
language plpgsql stable set search_path to 'public','extensions','pg_temp' as $fn$
declare v_last int; v_extra int;
begin
    select last_used_turn, extra_cooldown into v_last, v_extra
    from public.clan_dungeon_cooldowns where run_id=p_run_id and fighter_id=p_fighter_id and skill_id=p_skill_id;
    if v_last is null then return 0; end if;
    return greatest(0, (p_base_cd + coalesce(v_extra,0)) - (p_turns - v_last));
end; $fn$;

create or replace function public.clan_dungeon_has_ready_defense(p_run_id uuid, p_fighter_id uuid, p_character_id uuid, p_sealed uuid[], p_turns int) returns boolean
language plpgsql stable set search_path to 'public','extensions','pg_temp' as $fn$
declare v_hit boolean;
begin
    select exists(
        select 1 from public.character_skills cs join public.skills s on s.id=cs.skill_id
        where cs.character_id = p_character_id
          and (s.type='defense' or (s.type='special' and s.effect='reflect'))
          and (p_sealed is null or not (s.id = any(p_sealed)))
          and coalesce(public.clan_dungeon_cooldown_remaining(p_run_id,p_fighter_id,s.id,s.cooldown,p_turns),0) = 0
    ) into v_hit;
    return coalesce(v_hit,false);
end; $fn$;

-- ---------- fighter-state converters ----------
create or replace function public.clan_dungeon_player_state(p record) returns public.pvp_fighter_state
language plpgsql stable set search_path to 'public','extensions','pg_temp' as $fn$
begin
    return row(p.hp,p.max_hp,p.temp_atk,p.temp_hp,p.extra_turns,p.absorb_mode,p.absorb_hits,p.reflect_mult,
        p.last_hp_before,p.last_damage,p.last_consumed,p.frozen_turns,p.defending,p.shield_charges,p.poison_damage,p.poison_turns)::public.pvp_fighter_state;
end; $fn$;

create or replace function public.clan_dungeon_monster_state(p record) returns public.pvp_fighter_state
language plpgsql stable set search_path to 'public','extensions','pg_temp' as $fn$
begin
    return row(p.monster_hp,p.monster_max_hp,p.monster_temp_atk,p.monster_temp_hp,p.monster_extra_turns,p.monster_absorb_mode,p.monster_absorb_hits,p.monster_reflect_mult,
        p.monster_last_hp_before,p.monster_last_damage,p.monster_last_consumed,p.monster_frozen_turns,p.monster_defending,p.monster_shield_charges,p.monster_poison_damage,p.monster_poison_turns)::public.pvp_fighter_state;
end; $fn$;

create or replace function public.clan_dungeon_save_player(p_run_id uuid, p_player uuid, s public.pvp_fighter_state) returns void
language plpgsql security definer set search_path to 'public','extensions','pg_temp' as $fn$
begin
    update public.clan_dungeon_players set hp=s.hp,max_hp=s.max_hp,temp_atk=s.temp_atk,temp_hp=s.temp_hp,extra_turns=s.extra_turns,
        absorb_mode=s.absorb_mode,absorb_hits=s.absorb_hits,reflect_mult=s.reflect_mult,last_hp_before=s.last_hp_before,last_damage=s.last_damage,last_consumed=s.last_consumed,
        frozen_turns=s.frozen_turns,defending=s.defending,shield_charges=s.shield_charges,poison_damage=s.poison_damage,poison_turns=s.poison_turns
    where run_id=p_run_id and player_id=p_player and alive=true;
end; $fn$;

create or replace function public.clan_dungeon_save_monster(p_run_id uuid, s public.pvp_fighter_state) returns void
language plpgsql security definer set search_path to 'public','extensions','pg_temp' as $fn$
begin
    update public.clan_dungeon_runs set monster_hp=s.hp,monster_max_hp=s.max_hp,monster_temp_atk=s.temp_atk,monster_temp_hp=s.temp_hp,monster_extra_turns=s.extra_turns,
        monster_absorb_mode=s.absorb_mode,monster_absorb_hits=s.absorb_hits,monster_reflect_mult=s.reflect_mult,monster_last_hp_before=s.last_hp_before,monster_last_damage=s.last_damage,monster_last_consumed=s.last_consumed,
        monster_frozen_turns=s.frozen_turns,monster_defending=s.defending,monster_shield_charges=s.shield_charges,monster_poison_damage=s.poison_damage,monster_poison_turns=s.poison_turns
    where id=p_run_id;
end; $fn$;

-- ---------- turn scheduling ----------
create or replace function public.clan_dungeon_next_player(p_run_id uuid, p_from int) returns uuid
language plpgsql stable set search_path to 'public','extensions','pg_temp' as $fn$
declare r record; v_n int; v_i int; v_idx int;
begin
    select turn_order into r from public.clan_dungeon_runs where id=p_run_id;
    v_n := coalesce(array_length(r.turn_order,1),0);
    if v_n=0 then return null; end if;
    for v_i in 1..v_n loop
        v_idx := (p_from + v_i) % v_n;
        if exists(select 1 from public.clan_dungeon_players cp where cp.run_id=p_run_id and cp.player_id=r.turn_order[v_idx+1] and cp.alive=true) then
            return r.turn_order[v_idx+1];
        end if;
    end loop;
    return null;
end; $fn$;

create or replace function public.clan_dungeon_schedule_player(p_run_id uuid, p_from int) returns void
language plpgsql security definer set search_path to 'public','extensions','pg_temp' as $fn$
declare v_next uuid;
begin
    v_next := public.clan_dungeon_next_player(p_run_id, p_from);
    if v_next is null then
        update public.clan_dungeon_runs set status='finished', turn_phase='player', turn_player_id=null, turn_deadline=null where id=p_run_id; return;
    end if;
    update public.clan_dungeon_runs set turn_phase='player', turn_player_id=v_next,
        turn_slot = (select s.pos-1 from (select row_number() over() as pos, player_id from unnest(turn_order) as player_id) s where s.player_id=v_next),
        turn_deadline = now() + interval '60 seconds'
    where id=p_run_id;
end; $fn$;

create or replace function public.clan_dungeon_schedule_monster(p_run_id uuid) returns void
language plpgsql security definer set search_path to 'public','extensions','pg_temp' as $fn$
begin
    update public.clan_dungeon_runs set turn_phase='monster', turn_player_id=null, turn_deadline=null where id=p_run_id;
end; $fn$;

create or replace function public.clan_dungeon_spawn_monster(p_run_id uuid) returns void
language plpgsql security definer set search_path to 'public','extensions','pg_temp' as $fn$
declare r record; v_mid uuid; v_char record;
begin
    select id, monster_ids, monster_index into r from public.clan_dungeon_runs where id=p_run_id;
    if r.monster_index >= array_length(r.monster_ids,1) then return; end if;
    v_mid := r.monster_ids[r.monster_index+1];
    select id, name, identity_image, hp, atk into v_char from public.characters where id=v_mid;
    update public.clan_dungeon_runs set
        monster_id=v_mid, monster_name=coalesce(v_char.name,''), monster_image=v_char.identity_image,
        monster_hp=coalesce(v_char.hp,100), monster_max_hp=coalesce(v_char.hp,100),
        monster_turns_taken=0, monster_cooldown_used='{}', monster_cooldown_extra='{}',
        monster_sealed_skill_ids='{}', monster_used_skill_ids='{}',
        monster_temp_atk=0, monster_temp_hp=0, monster_extra_turns=0,
        monster_absorb_mode=null, monster_absorb_hits=0, monster_reflect_mult=0,
        monster_last_hp_before=null, monster_last_damage=null, monster_last_consumed=true,
        monster_frozen_turns=0, monster_defending=false, monster_shield_charges=0,
        monster_poison_damage=0, monster_poison_turns=0
    where id=p_run_id;
    delete from public.clan_dungeon_cooldowns where run_id=p_run_id and fighter_id=v_mid;
end; $fn$;

-- ---------- skills list + state ----------
create or replace function public.clan_dungeon_list_skills(p_token text, p_run_id uuid)
returns table (skill_id uuid, name text, type text, effect text, damage int, cooldown int, unblockable boolean, color text, params jsonb, description text, slot int, fighter_kind text, fighter_id uuid)
language plpgsql security definer set search_path to 'public','extensions','pg_temp' as $fn$
declare v_me uuid; v_run record;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    select * into v_run from public.clan_dungeon_runs where id=p_run_id;
    if v_run.id is null then raise exception 'الزنزانة غير موجودة'; end if;

    return query
    select s.id, s.name, s.type, s.effect, s.damage, s.cooldown, s.unblockable, s.color, s.params, s.description,
           cs.slot, 'player'::text, v_me::uuid
    from public.clan_dungeon_players cp
    join public.player_characters pc on pc.id = cp.character_id
    join public.character_skills cs on cs.character_id = pc.character_id
    join public.skills s on s.id = cs.skill_id
    where cp.run_id=p_run_id and cp.player_id=v_me
    order by cs.slot;

    return query
    select s.id, s.name, s.type, s.effect, s.damage, s.cooldown, s.unblockable, s.color, s.params, s.description,
           cs.slot, 'monster'::text, v_run.monster_id::uuid
    from public.character_skills cs
    join public.skills s on s.id = cs.skill_id
    where cs.character_id = v_run.monster_id
    order by cs.slot;
end; $fn$;

create or replace function public.clan_dungeon_monster_skills(p_run_id uuid)
returns table (skill_id uuid, name text, type text, effect text, damage int, cooldown int, unblockable boolean, params jsonb, slot int)
language plpgsql stable set search_path to 'public','extensions','pg_temp' as $fn$
declare v_mid uuid;
begin
    select monster_id into v_mid from public.clan_dungeon_runs where id=p_run_id;
    return query
    select s.id, s.name, s.type, s.effect, s.damage, s.cooldown, s.unblockable, s.params, cs.slot
    from public.character_skills cs join public.skills s on s.id=cs.skill_id
    where cs.character_id=v_mid order by cs.slot;
end; $fn$;

create or replace function public.clan_dungeon_get_state(p_token text, p_run_id uuid)
returns table (status text, turn_phase text, monster_index int, total_monsters int,
    monster_id uuid, monster_name text, monster_image text, monster_hp int, monster_max_hp int,
    turn_player_id uuid, turn_deadline timestamptz, my_player_id uuid, my_max_hp int, my_turn boolean, my_char_id uuid, players jsonb)
language plpgsql security definer set search_path to 'public','extensions','pg_temp' as $fn$
declare v_me uuid; v_run record; v_players jsonb; v_my_hp int; v_my_max int; v_my_char uuid; v_my_turn boolean;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    select * into v_run from public.clan_dungeon_runs where id=p_run_id;
    if v_run.id is null then raise exception 'الزنزانة غير موجودة'; end if;
    if not exists(select 1 from public.clan_dungeon_players cp where cp.run_id=p_run_id and cp.player_id=v_me) then
        raise exception 'لست في هذه الزنزانة';
    end if;
    select jsonb_agg(jsonb_build_object(
        'player_id', cp.player_id, 'character_id', cp.character_id, 'hp', cp.hp, 'max_hp', cp.max_hp,
        'alive', cp.alive, 'ready', cp.ready, 'turns_taken', cp.turns_taken, 'race_press_at', cp.race_press_at,
        'base_atk', cp.base_atk, 'base_hp', cp.base_hp) order by cp.joined_at)
      into v_players from public.clan_dungeon_players cp where cp.run_id=p_run_id;
    select cp.hp, cp.max_hp, cp.character_id,
           (coalesce(v_run.turn_player_id, cp.player_id) = cp.player_id and v_run.turn_phase='player')
      into v_my_hp, v_my_max, v_my_char, v_my_turn
      from public.clan_dungeon_players cp where cp.run_id=p_run_id and cp.player_id=v_me;
    return query
    select v_run.status, v_run.turn_phase, v_run.monster_index, array_length(v_run.monster_ids,1),
           v_run.monster_id, v_run.monster_name, v_run.monster_image, v_run.monster_hp, v_run.monster_max_hp,
           v_run.turn_player_id, v_run.turn_deadline, v_me, v_my_max, v_my_turn, v_my_char,
           coalesce(v_players,'[]'::jsonb);
end; $fn$;