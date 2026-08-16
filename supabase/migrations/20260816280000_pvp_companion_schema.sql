-- ============================================================
-- PvP companion fighter (server-authoritative).
-- Each player now fields TWO targetable fighters per match:
--   • their character (existing player1_*/player2_* columns)
--   • their equipped companion (new *comp_* columns)
-- The companion is a separate fighter the player controls on its own
-- sub-turn (turn_sub: 0 = character, 1 = companion), the opponent can
-- target EITHER fighter, and a player is knocked out only when BOTH
-- their fighters are dead. Alternate RPCs (pvp_use_companion_skill)
-- drive the companion sub-turn; pvp_use_skill keeps backward-compatible
-- defaults so existing calls still act as the character vs the enemy's
-- character.
-- ============================================================

-- ---------- schema: per-player companion fighter state ----------
alter table public.pvp_matches add column if not exists p1_comp_id uuid;
alter table public.pvp_matches add column if not exists p1_comp_char_id uuid;
alter table public.pvp_matches add column if not exists p1_comp_name text not null default '';
alter table public.pvp_matches add column if not exists p1_comp_image text;
alter table public.pvp_matches add column if not exists p1_comp_alive boolean not null default false;
alter table public.pvp_matches add column if not exists p1_comp_hp int not null default 0;
alter table public.pvp_matches add column if not exists p1_comp_max_hp int not null default 0;
alter table public.pvp_matches add column if not exists p1_comp_turns_taken int not null default 0;
alter table public.pvp_matches add column if not exists p1_comp_used_skill_ids uuid[] not null default '{}';
alter table public.pvp_matches add column if not exists p1_comp_sealed_skill_ids uuid[] not null default '{}';
alter table public.pvp_matches add column if not exists p1_comp_temp_atk int not null default 0;
alter table public.pvp_matches add column if not exists p1_comp_temp_hp int not null default 0;
alter table public.pvp_matches add column if not exists p1_comp_extra_turns int not null default 0;
alter table public.pvp_matches add column if not exists p1_comp_absorb_mode text;
alter table public.pvp_matches add column if not exists p1_comp_absorb_hits int not null default 0;
alter table public.pvp_matches add column if not exists p1_comp_reflect_multiplier int not null default 0;
alter table public.pvp_matches add column if not exists p1_comp_last_hit_hp_before int;
alter table public.pvp_matches add column if not exists p1_comp_last_hit_damage int;
alter table public.pvp_matches add column if not exists p1_comp_last_hit_consumed boolean not null default true;
alter table public.pvp_matches add column if not exists p1_comp_frozen_turns int not null default 0;
alter table public.pvp_matches add column if not exists p1_comp_defending boolean not null default false;
alter table public.pvp_matches add column if not exists p1_comp_shield_charges int not null default 0;
alter table public.pvp_matches add column if not exists p1_comp_poison_damage int not null default 0;
alter table public.pvp_matches add column if not exists p1_comp_poison_turns int not null default 0;

alter table public.pvp_matches add column if not exists p2_comp_id uuid;
alter table public.pvp_matches add column if not exists p2_comp_char_id uuid;
alter table public.pvp_matches add column if not exists p2_comp_name text not null default '';
alter table public.pvp_matches add column if not exists p2_comp_image text;
alter table public.pvp_matches add column if not exists p2_comp_alive boolean not null default false;
alter table public.pvp_matches add column if not exists p2_comp_hp int not null default 0;
alter table public.pvp_matches add column if not exists p2_comp_max_hp int not null default 0;
alter table public.pvp_matches add column if not exists p2_comp_turns_taken int not null default 0;
alter table public.pvp_matches add column if not exists p2_comp_used_skill_ids uuid[] not null default '{}';
alter table public.pvp_matches add column if not exists p2_comp_sealed_skill_ids uuid[] not null default '{}';
alter table public.pvp_matches add column if not exists p2_comp_temp_atk int not null default 0;
alter table public.pvp_matches add column if not exists p2_comp_temp_hp int not null default 0;
alter table public.pvp_matches add column if not exists p2_comp_extra_turns int not null default 0;
alter table public.pvp_matches add column if not exists p2_comp_absorb_mode text;
alter table public.pvp_matches add column if not exists p2_comp_absorb_hits int not null default 0;
alter table public.pvp_matches add column if not exists p2_comp_reflect_multiplier int not null default 0;
alter table public.pvp_matches add column if not exists p2_comp_last_hit_hp_before int;
alter table public.pvp_matches add column if not exists p2_comp_last_hit_damage int;
alter table public.pvp_matches add column if not exists p2_comp_last_hit_consumed boolean not null default true;
alter table public.pvp_matches add column if not exists p2_comp_frozen_turns int not null default 0;
alter table public.pvp_matches add column if not exists p2_comp_defending boolean not null default false;
alter table public.pvp_matches add column if not exists p2_comp_shield_charges int not null default 0;
alter table public.pvp_matches add column if not exists p2_comp_poison_damage int not null default 0;
alter table public.pvp_matches add column if not exists p2_comp_poison_turns int not null default 0;

alter table public.pvp_matches add column if not exists turn_sub int not null default 0;

-- ---------- find/join match: attach the equipped companion ----------
create or replace function public.pvp_find_or_create_match(p_token text)
returns table (match_id uuid, status text, is_player1 boolean)
language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $fn$
declare
    v_player_id uuid;
    v_pc record;
    v_comp record;
    v_existing_waiting uuid;
    v_open_match record;
    v_new_id uuid;
    v_joined_id uuid;
begin
    v_player_id := player_id_from_token(p_token);

    perform pg_advisory_xact_lock(hashtext('pvp_matchmaking'));

    select pc.id as pc_id, pc.hp, pc.atk into v_pc
    from players p
    join player_characters pc on pc.id = (
        select pc2.id from player_characters pc2
        where pc2.player_id = p.id and pc2.character_id = p.active_character_id
        limit 1
    )
    where p.id = v_player_id;

    if v_pc is null then
        raise exception 'لا توجد شخصية نشطة';
    end if;

    select pcc.id, c.id as cid, c.name, c.image, coalesce(pcc.hp,c.base_hp) as c_hp
      into v_comp
      from public.players pl
      left join public.player_companions pcc on pcc.id = pl.active_companion_id
      left join public.companions c on c.id = pcc.companion_id
     where pl.id = v_player_id;

    select pm.id into v_existing_waiting from pvp_matches pm
    where pm.player1_id = v_player_id and pm.status = 'waiting'
    limit 1;

    if v_existing_waiting is not null then
        return query select v_existing_waiting, 'waiting'::text, true;
        return;
    end if;

    select pm.id, (pm.player1_id = v_player_id) as as_p1 into v_open_match from pvp_matches pm
    where pm.status = 'active' and (pm.player1_id = v_player_id or pm.player2_id = v_player_id)
    limit 1;

    if v_open_match.id is not null then
        return query select v_open_match.id, 'active'::text, v_open_match.as_p1;
        return;
    end if;

    select pm.id into v_existing_waiting from pvp_matches pm
    where pm.status = 'waiting' and pm.player1_id != v_player_id
    order by pm.created_at asc
    limit 1;

    if v_existing_waiting is not null then
        update pvp_matches set
            player2_id = v_player_id,
            player2_character_id = v_pc.pc_id,
            player2_hp = v_pc.hp,
            player2_max_hp = v_pc.hp,
            p2_comp_id = v_comp.id,
            p2_comp_char_id = v_comp.cid,
            p2_comp_name = coalesce(v_comp.name,''),
            p2_comp_image = v_comp.image,
            p2_comp_alive = v_comp.cid is not null,
            p2_comp_hp = coalesce(v_comp.c_hp,0),
            p2_comp_max_hp = coalesce(v_comp.c_hp,0),
            p2_comp_turns_taken = 0,
            status = 'active',
            turn_player_id = player1_id,
            updated_at = now()
        where pvp_matches.id = v_existing_waiting
          and pvp_matches.status = 'waiting'
        returning pvp_matches.id into v_joined_id;

        if v_joined_id is not null then
            return query select v_joined_id, 'active'::text, false;
            return;
        end if;
    end if;

    insert into pvp_matches(player1_id, player1_character_id, player1_hp, player1_max_hp,
        p1_comp_id, p1_comp_char_id, p1_comp_name, p1_comp_image, p1_comp_alive, p1_comp_hp, p1_comp_max_hp, status)
    values (v_player_id, v_pc.pc_id, v_pc.hp, v_pc.hp,
        v_comp.id, v_comp.cid, coalesce(v_comp.name,''), v_comp.image,
        v_comp.cid is not null, coalesce(v_comp.c_hp,0), coalesce(v_comp.c_hp,0), 'waiting')
    returning pvp_matches.id into v_new_id;

    return query select v_new_id, 'waiting'::text, true;
end; $fn$;

-- ---------- companion fighter-state converters (reuse pvp_fighter_state) ----------
create or replace function public.p1_comp_state(m record) returns public.pvp_fighter_state
language plpgsql stable set search_path to 'public','extensions','pg_temp' as $fn$
begin
    return row(m.p1_comp_hp,m.p1_comp_max_hp,m.p1_comp_temp_atk,m.p1_comp_temp_hp,m.p1_comp_extra_turns,
        m.p1_comp_absorb_mode,m.p1_comp_absorb_hits,m.p1_comp_reflect_multiplier,
        m.p1_comp_last_hit_hp_before,m.p1_comp_last_hit_damage,coalesce(m.p1_comp_last_hit_consumed,true),
        coalesce(m.p1_comp_frozen_turns,0),m.p1_comp_defending,m.p1_comp_shield_charges,
        m.p1_comp_poison_damage,m.p1_comp_poison_turns)::public.pvp_fighter_state;
end; $fn$;

create or replace function public.p2_comp_state(m record) returns public.pvp_fighter_state
language plpgsql stable set search_path to 'public','extensions','pg_temp' as $fn$
begin
    return row(m.p2_comp_hp,m.p2_comp_max_hp,m.p2_comp_temp_atk,m.p2_comp_temp_hp,m.p2_comp_extra_turns,
        m.p2_comp_absorb_mode,m.p2_comp_absorb_hits,m.p2_comp_reflect_multiplier,
        m.p2_comp_last_hit_hp_before,m.p2_comp_last_hit_damage,coalesce(m.p2_comp_last_hit_consumed,true),
        coalesce(m.p2_comp_frozen_turns,0),m.p2_comp_defending,m.p2_comp_shield_charges,
        m.p2_comp_poison_damage,m.p2_comp_poison_turns)::public.pvp_fighter_state;
end; $fn$;

-- write a player's companion fighter state back onto the match row
create or replace function public.pvp_companion_write_state(p_match_id uuid, p_is_p1 boolean, s public.pvp_fighter_state) returns void
language plpgsql security definer set search_path to 'public','extensions','pg_temp' as $fn$
begin
    if p_is_p1 then
        update public.pvp_matches set
            p1_comp_hp=s.hp,p1_comp_max_hp=s.max_hp,p1_comp_temp_atk=s.temp_atk,p1_comp_temp_hp=s.temp_hp,
            p1_comp_extra_turns=s.extra_turns,p1_comp_absorb_mode=s.absorb_mode,p1_comp_absorb_hits=s.absorb_hits,
            p1_comp_reflect_multiplier=s.reflect_mult,p1_comp_last_hit_hp_before=s.last_hp_before,
            p1_comp_last_hit_damage=s.last_damage,p1_comp_last_hit_consumed=s.last_consumed,
            p1_comp_frozen_turns=s.frozen_turns,p1_comp_defending=s.defending,p1_comp_shield_charges=s.shield_charges,
            p1_comp_poison_damage=s.poison_damage,p1_comp_poison_turns=s.poison_turns
        where id=p_match_id;
    else
        update public.pvp_matches set
            p2_comp_hp=s.hp,p2_comp_max_hp=s.max_hp,p2_comp_temp_atk=s.temp_atk,p2_comp_temp_hp=s.temp_hp,
            p2_comp_extra_turns=s.extra_turns,p2_comp_absorb_mode=s.absorb_mode,p2_comp_absorb_hits=s.absorb_hits,
            p2_comp_reflect_multiplier=s.reflect_mult,p2_comp_last_hit_hp_before=s.last_hp_before,
            p2_comp_last_hit_damage=s.last_damage,p2_comp_last_hit_consumed=s.last_consumed,
            p2_comp_frozen_turns=s.frozen_turns,p2_comp_defending=s.defending,p2_comp_shield_charges=s.shield_charges,
            p2_comp_poison_damage=s.poison_damage,p2_comp_poison_turns=s.poison_turns
        where id=p_match_id;
    end if;
end; $fn$;

-- can this companion field a ready defense? (companions use companion_skills)
create or replace function public.pvp_companion_has_ready_defense(p_comp_char_id uuid, p_match_id uuid, p_player_id uuid, p_turns int) returns boolean
language plpgsql security definer set search_path to 'public','extensions','pg_temp' as $fn$
declare v_skill record;
begin
    for v_skill in
        select s.id, s.cooldown
        from public.companion_skills cs
        join public.skills s on s.id = cs.skill_id
        where cs.companion_id = p_comp_char_id
          and (s.type='defense' or s.effect='reflect')
    loop
        if public.pvp_skill_remaining_cd(p_match_id, p_player_id, v_skill.id, v_skill.cooldown, p_turns) = 0 then
            return true;
        end if;
    end loop;
    return false;
end; $fn$;

revoke execute on function
  public.p1_comp_state(record),
  public.p2_comp_state(record),
  public.pvp_companion_write_state(uuid, boolean, public.pvp_fighter_state),
  public.pvp_companion_has_ready_defense(uuid, uuid, uuid, integer)
from public, anon, authenticated;