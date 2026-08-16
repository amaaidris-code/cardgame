-- ============================================================
-- Clan Co-op Dungeon: companion fighter.
-- Each player now fields TWO targetable fighters in the co-op fight:
--   • their character (existing columns)
--   • their active companion (new comp_* columns)
-- The companion joins by bringing the player's EQUIPPED companion
-- (players.active_companion_id). It is a separate fighter the player
-- controls on its own sub-turn, the monster can target EITHER fighter,
-- and a player is knocked out only when BOTH are dead.
-- Server-authoritative, mirrors the PvE companion turn flow.
-- ============================================================

-- ---------- schema ----------
alter table public.clan_dungeon_players add column if not exists comp_character_id uuid;
alter table public.clan_dungeon_players add column if not exists comp_pc_id uuid;
alter table public.clan_dungeon_players add column if not exists comp_name text not null default '';
alter table public.clan_dungeon_players add column if not exists comp_image text;
alter table public.clan_dungeon_players add column if not exists comp_base_hp int not null default 0;
alter table public.clan_dungeon_players add column if not exists comp_base_atk int not null default 0;
alter table public.clan_dungeon_players add column if not exists comp_alive boolean not null default false;
alter table public.clan_dungeon_players add column if not exists comp_hp int not null default 0;
alter table public.clan_dungeon_players add column if not exists comp_max_hp int not null default 0;
alter table public.clan_dungeon_players add column if not exists comp_temp_atk int not null default 0;
alter table public.clan_dungeon_players add column if not exists comp_temp_hp int not null default 0;
alter table public.clan_dungeon_players add column if not exists comp_extra_turns int not null default 0;
alter table public.clan_dungeon_players add column if not exists comp_absorb_mode text;
alter table public.clan_dungeon_players add column if not exists comp_absorb_hits int not null default 0;
alter table public.clan_dungeon_players add column if not exists comp_reflect_mult int not null default 0;
alter table public.clan_dungeon_players add column if not exists comp_last_hp_before int;
alter table public.clan_dungeon_players add column if not exists comp_last_damage int;
alter table public.clan_dungeon_players add column if not exists comp_last_consumed boolean not null default true;
alter table public.clan_dungeon_players add column if not exists comp_frozen_turns int not null default 0;
alter table public.clan_dungeon_players add column if not exists comp_defending boolean not null default false;
alter table public.clan_dungeon_players add column if not exists comp_shield_charges int not null default 0;
alter table public.clan_dungeon_players add column if not exists comp_poison_damage int not null default 0;
alter table public.clan_dungeon_players add column if not exists comp_poison_turns int not null default 0;
alter table public.clan_dungeon_players add column if not exists comp_turns_taken int not null default 0;
alter table public.clan_dungeon_players add column if not exists comp_used_skill_ids uuid[] not null default '{}';
alter table public.clan_dungeon_players add column if not exists comp_sealed_skill_ids uuid[] not null default '{}';

alter table public.clan_dungeon_runs add column if not exists turn_sub int not null default 0;

-- ---------- companion fighter-state converters ----------
create or replace function public.clan_dungeon_companion_state(p record) returns public.pvp_fighter_state
language plpgsql stable set search_path to 'public','extensions','pg_temp' as $fn$
begin
    return row(p.comp_hp,p.comp_max_hp,p.comp_temp_atk,p.comp_temp_hp,p.comp_extra_turns,p.comp_absorb_mode,p.comp_absorb_hits,p.comp_reflect_mult,
        p.comp_last_hp_before,p.comp_last_damage,p.comp_last_consumed,p.comp_frozen_turns,p.comp_defending,p.comp_shield_charges,p.comp_poison_damage,p.comp_poison_turns)::public.pvp_fighter_state;
end; $fn$;

create or replace function public.clan_dungeon_save_companion(p_run_id uuid, p_player uuid, s public.pvp_fighter_state) returns void
language plpgsql security definer set search_path to 'public','extensions','pg_temp' as $fn$
begin
    update public.clan_dungeon_players
       set comp_hp=s.hp,comp_max_hp=s.max_hp,comp_temp_atk=s.temp_atk,comp_temp_hp=s.temp_hp,comp_extra_turns=s.extra_turns,
           comp_absorb_mode=s.absorb_mode,comp_absorb_hits=s.absorb_hits,comp_reflect_mult=s.reflect_mult,
           comp_last_hp_before=s.last_hp_before,comp_last_damage=s.last_damage,comp_last_consumed=s.last_consumed,
           comp_frozen_turns=s.frozen_turns,comp_defending=s.defending,comp_shield_charges=s.shield_charges,
           comp_poison_damage=s.poison_damage,comp_poison_turns=s.poison_turns
     where run_id=p_run_id and player_id=p_player;
end; $fn$;

-- can this companion field a ready defense? (companions use companion_skills)
create or replace function public.clan_dungeon_companion_has_ready_defense(p_run_id uuid, p_comp_char_id uuid, p_turns int) returns boolean
language plpgsql stable set search_path to 'public','extensions','pg_temp' as $fn$
declare v_hit boolean;
begin
    select exists(
        select 1 from public.companion_skills cs join public.skills s on s.id=cs.skill_id
        where cs.companion_id = p_comp_char_id
          and (s.type='defense' or (s.type='special' and s.effect='reflect'))
    ) into v_hit;
    return coalesce(v_hit,false);
end; $fn$;

-- ---------- join: attach the equipped companion ----------
create or replace function public.clan_dungeon_join(p_token text, p_run_id uuid)
returns void
language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $fn$
declare
    v_me uuid; v_run record; v_pc record; v_comp record;
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

    select pcc.id, c.id as cid, c.name, c.image, coalesce(pcc.hp,c.base_hp) as c_hp, coalesce(pcc.atk,c.base_atk) as c_atk
      into v_comp
      from public.players pl
      left join public.player_companions pcc on pcc.id = pl.active_companion_id
      left join public.companions c on c.id = pcc.companion_id
     where pl.id = v_me;

    insert into public.clan_dungeon_players
        (run_id, player_id, character_id, base_hp, base_atk, hp, max_hp, ready,
         comp_character_id, comp_pc_id, comp_name, comp_image, comp_base_hp, comp_base_atk,
         comp_alive, comp_hp, comp_max_hp, comp_turns_taken)
    values
        (p_run_id, v_me, v_pc.id, coalesce(v_pc.chp,100), coalesce(v_pc.catk,100),
         coalesce(v_pc.chp,100), coalesce(v_pc.chp,100), false,
         v_comp.cid, v_comp.id, coalesce(v_comp.name,''), v_comp.image,
         coalesce(v_comp.c_hp,0), coalesce(v_comp.c_atk,0),
         v_comp.cid is not null, coalesce(v_comp.c_hp,0), coalesce(v_comp.c_hp,0), 0);
end; $fn$;

-- ---------- turn scheduling with sub-turn ----------
create or replace function public.clan_dungeon_next_player(p_run_id uuid, p_from int) returns uuid
language plpgsql stable set search_path to 'public','extensions','pg_temp' as $fn$
declare r record; v_n int; v_i int; v_idx int;
begin
    select turn_order into r from public.clan_dungeon_runs where id=p_run_id;
    v_n := coalesce(array_length(r.turn_order,1),0);
    if v_n=0 then return null; end if;
    for v_i in 1..v_n loop
        v_idx := (p_from + v_i) % v_n;
        if exists(select 1 from public.clan_dungeon_players cp
                   where cp.run_id=p_run_id and cp.player_id=r.turn_order[v_idx+1]
                     and cp.alive=true) then
            return r.turn_order[v_idx+1];
        end if;
    end loop;
    return null;
end; $fn$;

create or replace function public.clan_dungeon_schedule_player(p_run_id uuid, p_from int) returns void
language plpgsql security definer set search_path to 'public','extensions','pg_temp' as $fn$
declare v_next uuid; v_p record; v_sub int;
begin
    v_next := public.clan_dungeon_next_player(p_run_id, p_from);
    if v_next is null then
        update public.clan_dungeon_runs set status='finished', turn_phase='player', turn_player_id=null, turn_deadline=null, turn_sub=0 where id=p_run_id; return;
    end if;
    -- start on the character unless the character is down but the companion is up
    select comp_alive into v_p from public.clan_dungeon_players
      where run_id=p_run_id and player_id=v_next;
    v_sub := 0;
    if coalesce(v_p,false) and not exists(select 1 from public.clan_dungeon_players
           where run_id=p_run_id and player_id=v_next and alive=true and hp>0) then
        v_sub := 1;
    end if;
    update public.clan_dungeon_runs set turn_phase='player', turn_player_id=v_next,
        turn_slot = (select s.pos-1 from (select row_number() over() as pos, player_id from unnest(turn_order) as player_id) s where s.player_id=v_next),
        turn_deadline = now() + interval '60 seconds', turn_sub = v_sub
    where id=p_run_id;
end; $fn$;

-- ---------- player use skill (character sub-turn) ----------
create or replace function public.clan_dungeon_use_skill(
    p_token text, p_run_id uuid, p_skill_id uuid, p_target_player_id uuid default null
)
returns void language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $fn$
declare
    v_me uuid; v_run record; v_me_row record; v_trg record;
    v_skill record; v_owns boolean;
    v_self public.pvp_fighter_state; v_opp public.pvp_fighter_state; v_out record;
    v_eff int; v_opp_player boolean; v_target_char uuid; v_turns int; v_sealed uuid[];
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    select * into v_run from public.clan_dungeon_runs where id=p_run_id for update;
    if v_run.id is null then raise exception 'الزنزانة غير موجودة'; end if;
    if v_run.status <> 'active' then raise exception 'المعركة ليست نشطة'; end if;
    if v_run.turn_phase <> 'player' or v_run.turn_player_id <> v_me then raise exception 'ليس دورك الآن'; end if;
    if v_run.turn_sub <> 0 then raise exception 'استخدم المرافق أولًا'; end if;
    select * into v_me_row from public.clan_dungeon_players where run_id=p_run_id and player_id=v_me;
    if not found or not v_me_row.alive then raise exception 'لست في المعركة'; end if;
    if coalesce(v_me_row.frozen_turns,0) > 0 then raise exception 'أنت مجمد'; end if;
    select s.* into v_skill from public.skills s where s.id=p_skill_id;
    if v_skill.id is null then raise exception 'المهارة غير موجودة'; end if;
    select exists(
        select 1 from public.player_characters pc
        join public.character_skills cs on cs.character_id = pc.character_id
        where pc.id = v_me_row.character_id and cs.skill_id = p_skill_id
    ) into v_owns;
    if not coalesce(v_owns,false) then raise exception 'هذه المهارة ليست من مهاراتك'; end if;
    if v_me_row.sealed_skill_ids is not null and p_skill_id = any(v_me_row.sealed_skill_ids) then
        raise exception 'هذه المهارة مختومة';
    end if;
    if v_skill.effect in ('steal','copy','control','seal','unseal','shadow','delay_cooldown') then
        raise exception 'تُستخدم من قائمتك الخاصة';
    end if;
    if public.clan_dungeon_cooldown_remaining(p_run_id, v_me, p_skill_id, v_skill.cooldown, v_me_row.turns_taken) > 0 then
        raise exception 'المهارة في التهدئة';
    end if;

    v_self := public.clan_dungeon_player_state(v_me_row);
    v_opp_player := (p_target_player_id is not null);
    if v_opp_player then
        select * into v_trg from public.clan_dungeon_players where run_id=p_run_id and player_id=p_target_player_id;
        if not found then raise exception 'الهدف غير موجود'; end if;
        v_opp := public.clan_dungeon_player_state(v_trg);
        v_target_char := (select character_id from public.player_characters where id=v_trg.character_id);
        v_turns := v_trg.turns_taken; v_sealed := v_trg.sealed_skill_ids;
    else
        v_opp := public.clan_dungeon_monster_state(v_run);
        v_target_char := v_run.monster_id; v_turns := v_run.monster_turns_taken; v_sealed := v_run.monster_sealed_skill_ids;
    end if;

    v_eff := v_skill.damage;
    if v_skill.type in ('attack','special') and (v_skill.effect is null or v_skill.effect='') then
        v_eff := coalesce(public.pvp_scaled_attack_damage(v_me_row.character_id, p_skill_id), v_skill.damage);
    end if;

    v_out := public.pvp_apply_effect(v_skill.type, v_skill.effect, v_eff, coalesce(v_skill.unblockable,false), v_skill.params, v_self, v_opp, false);
    v_self := v_out.self; v_opp := v_out.opp;
    if v_out.heal > 0 and v_out.heal is not null then v_self.hp := least(v_self.max_hp, v_self.hp + v_out.heal); end if;
    if v_skill.type='defense' then
        v_self.defending := true; v_self.shield_charges := greatest(0, coalesce(v_out.endurance_hits,1)-1);
    else
        v_self.defending := false;
    end if;
    v_opp.defending := v_out.blocked and v_opp.shield_charges > 0;

    perform public.clan_dungeon_save_player(p_run_id, v_me, v_self);
    if v_opp_player then perform public.clan_dungeon_save_player(p_run_id, p_target_player_id, v_opp);
    else perform public.clan_dungeon_save_monster(p_run_id, v_opp); end if;

    update public.clan_dungeon_players set turns_taken = turns_taken+1,
        used_skill_ids = case when p_skill_id = any(used_skill_ids) then used_skill_ids else array_append(used_skill_ids,p_skill_id) end
    where run_id=p_run_id and player_id=v_me;
    if v_skill.cooldown>0 then
        insert into public.clan_dungeon_cooldowns(run_id,fighter_id,skill_id,last_used_turn,extra_cooldown)
        values (p_run_id,v_me,p_skill_id,(select turns_taken from public.clan_dungeon_players where run_id=p_run_id and player_id=v_me),0)
        on conflict (run_id,fighter_id,skill_id) do update set last_used_turn=excluded.last_used_turn;
    end if;

    if v_opp.hp <= 0 and v_opp_player then
        if coalesce(v_out.applied_dmg,0) > 0 and not coalesce(v_skill.unblockable,false) and public.clan_dungeon_has_ready_defense(p_run_id, p_target_player_id, v_target_char, v_sealed, v_turns)
        then null;
        else update public.clan_dungeon_players set alive=false,hp=0 where run_id=p_run_id and player_id=p_target_player_id; end if;
    end if;

    -- character done: hand the turn to the companion sub-turn if one is up, else the monster
    if exists(select 1 from public.clan_dungeon_players
               where run_id=p_run_id and player_id=v_me and comp_alive=true and comp_hp>0)
       and v_run.turn_sub = 0 then
        update public.clan_dungeon_runs set turn_sub=1, turn_deadline = now() + interval '60 seconds' where id=p_run_id;
        return;
    end if;
    update public.clan_dungeon_runs set turn_sub=0 where id=p_run_id;
    perform public.clan_dungeon_schedule_monster(p_run_id);
end; $fn$;

-- ---------- companion use skill -----------------
create or replace function public.clan_dungeon_use_companion_skill(
    p_token text, p_run_id uuid, p_skill_id uuid, p_target_player_id uuid default null
)
returns void language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $fn$
declare
    v_me uuid; v_run record; v_me_row record; v_trg record;
    v_skill record; v_owns boolean;
    v_self public.pvp_fighter_state; v_opp public.pvp_fighter_state; v_out record;
    v_eff int; v_opp_player boolean; v_target_char uuid; v_turns int; v_sealed uuid[]; v_comp_char uuid;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    select * into v_run from public.clan_dungeon_runs where id=p_run_id for update;
    if v_run.id is null then raise exception 'الزنزانة غير موجودة'; end if;
    if v_run.status <> 'active' then raise exception 'المعركة ليست نشطة'; end if;
    if v_run.turn_phase <> 'player' or v_run.turn_player_id <> v_me then raise exception 'ليس دورك الآن'; end if;
    if v_run.turn_sub <> 1 then raise exception 'هذا ليس دور المرافق'; end if;
    select * into v_me_row from public.clan_dungeon_players where run_id=p_run_id and player_id=v_me;
    if not found then raise exception 'لست في المعركة'; end if;
    if not coalesce(v_me_row.comp_alive,false) or coalesce(v_me_row.comp_hp,0) <= 0 then
        raise exception 'مرافقك سقط';
    end if;
    if coalesce(v_me_row.comp_frozen_turns,0) > 0 then raise exception 'المرافق مجمد'; end if;
    select s.* into v_skill from public.skills s where s.id=p_skill_id;
    if v_skill.id is null then raise exception 'المهارة غير موجودة'; end if;
    v_comp_char := v_me_row.comp_character_id;
    select exists(
        select 1 from public.companion_skills cs
        where cs.companion_id = v_comp_char and cs.skill_id = p_skill_id
    ) into v_owns;
    if not coalesce(v_owns,false) then raise exception 'هذه المهارة ليست من مهارات مرافقك'; end if;
    if v_me_row.comp_sealed_skill_ids is not null and p_skill_id = any(v_me_row.comp_sealed_skill_ids) then
        raise exception 'هذه المهارة مختومة';
    end if;
    if v_skill.effect in ('steal','copy','control','seal','unseal','shadow','delay_cooldown') then
        raise exception 'تُستخدم من قائمتك الخاصة';
    end if;
    if public.clan_dungeon_cooldown_remaining(p_run_id, v_me_row.comp_pc_id, p_skill_id, v_skill.cooldown, v_me_row.comp_turns_taken) > 0 then
        raise exception 'المهارة في التهدئة';
    end if;

    v_self := public.clan_dungeon_companion_state(v_me_row);
    v_opp_player := (p_target_player_id is not null);
    if v_opp_player then
        select * into v_trg from public.clan_dungeon_players where run_id=p_run_id and player_id=p_target_player_id;
        if not found then raise exception 'الهدف غير موجود'; end if;
        v_opp := public.clan_dungeon_player_state(v_trg);
        v_target_char := (select character_id from public.player_characters where id=v_trg.character_id);
        v_turns := v_trg.turns_taken; v_sealed := v_trg.sealed_skill_ids;
    else
        v_opp := public.clan_dungeon_monster_state(v_run);
        v_target_char := v_run.monster_id; v_turns := v_run.monster_turns_taken; v_sealed := v_run.monster_sealed_skill_ids;
    end if;

    v_eff := v_skill.damage;
    v_out := public.pvp_apply_effect(v_skill.type, v_skill.effect, v_eff, coalesce(v_skill.unblockable,false), v_skill.params, v_self, v_opp, false);
    v_self := v_out.self; v_opp := v_out.opp;
    if v_out.heal > 0 and v_out.heal is not null then v_self.hp := least(v_self.max_hp, v_self.hp + v_out.heal); end if;
    if v_skill.type='defense' then
        v_self.defending := true; v_self.shield_charges := greatest(0, coalesce(v_out.endurance_hits,1)-1);
    else
        v_self.defending := false;
    end if;
    v_opp.defending := v_out.blocked and v_opp.shield_charges > 0;

    perform public.clan_dungeon_save_companion(p_run_id, v_me, v_self);
    if v_opp_player then perform public.clan_dungeon_save_player(p_run_id, p_target_player_id, v_opp);
    else perform public.clan_dungeon_save_monster(p_run_id, v_opp); end if;

    update public.clan_dungeon_players set comp_turns_taken = comp_turns_taken+1,
        comp_used_skill_ids = case when p_skill_id = any(comp_used_skill_ids) then comp_used_skill_ids else array_append(comp_used_skill_ids,p_skill_id) end
    where run_id=p_run_id and player_id=v_me;
    if v_skill.cooldown>0 then
        insert into public.clan_dungeon_cooldowns(run_id,fighter_id,skill_id,last_used_turn,extra_cooldown)
        values (p_run_id,v_me_row.comp_pc_id,p_skill_id,(select comp_turns_taken from public.clan_dungeon_players where run_id=p_run_id and player_id=v_me),0)
        on conflict (run_id,fighter_id,skill_id) do update set last_used_turn=excluded.last_used_turn;
    end if;

    if v_opp.hp <= 0 and v_opp_player then
        if coalesce(v_out.applied_dmg,0) > 0 and not coalesce(v_skill.unblockable,false) and public.clan_dungeon_has_ready_defense(p_run_id, p_target_player_id, v_target_char, v_sealed, v_turns)
        then null;
        else update public.clan_dungeon_players set alive=false,hp=0 where run_id=p_run_id and player_id=p_target_player_id; end if;
    end if;

    update public.clan_dungeon_runs set turn_sub=0 where id=p_run_id;
    perform public.clan_dungeon_schedule_monster(p_run_id);
end; $fn$;

-- ---------- monster AI: target ONE of the two fighters ----------
create or replace function public.clan_dungeon_monster_act(p_token text, p_run_id uuid)
returns void language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $fn$
declare
    v_me uuid; v_run record; v_target record;
    v_skill_id uuid; v_skill_name text; v_skill_type text; v_skill_effect text;
    v_skill_damage int; v_skill_cd int; v_skill_unblockable boolean; v_skill_params jsonb;
    v_self public.pvp_fighter_state; v_opp public.pvp_fighter_state; v_out record;
    v_eff int; v_target_id uuid; v_any_alive boolean; v_m_idx int; v_total int;
    v_hit_comp boolean; v_char_alive boolean; v_comp_alive boolean;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    select * into v_run from public.clan_dungeon_runs where id=p_run_id for update;
    if v_run.id is null then raise exception 'الزنزانة غير موجودة'; end if;
    if v_run.status <> 'active' then raise exception 'المعركة ليست نشطة'; end if;

    if v_run.monster_hp <= 0 then
        v_m_idx := v_run.monster_index + 1; v_total := array_length(v_run.monster_ids,1);
        if v_m_idx >= v_total then
            update public.clan_dungeon_runs set status='finished', turn_phase='player', turn_player_id=null, turn_deadline=null, turn_sub=0 where id=p_run_id;
            return;
        end if;
        update public.clan_dungeon_runs set monster_index=v_m_idx where id=p_run_id;
        perform public.clan_dungeon_spawn_monster(p_run_id);
        select * into v_run from public.clan_dungeon_runs where id=p_run_id;
    end if;

    if v_run.turn_phase <> 'monster' then raise exception 'ليست دور الوحش'; end if;

    if coalesce(v_run.monster_frozen_turns,0) > 0 then
        update public.clan_dungeon_runs set monster_frozen_turns=monster_frozen_turns-1, monster_turns_taken=monster_turns_taken+1 where id=p_run_id;
        select exists(select 1 from public.clan_dungeon_players cp where cp.run_id=p_run_id and cp.alive=true) into v_any_alive;
        if not coalesce(v_any_alive,false) then update public.clan_dungeon_runs set status='finished' where id=p_run_id; return; end if;
        perform public.clan_dungeon_schedule_player(p_run_id, coalesce(v_run.turn_slot,-1)); return;
    end if;

    v_target_id := public.clan_dungeon_next_player(p_run_id, coalesce(v_run.turn_slot,0)-1);
    if v_target_id is null then update public.clan_dungeon_runs set status='finished' where id=p_run_id; return; end if;

    select * into v_target from public.clan_dungeon_players where run_id=p_run_id and player_id=v_target_id;
    v_char_alive := v_target.alive and coalesce(v_target.hp,0) > 0;
    v_comp_alive := coalesce(v_target.comp_alive,false) and coalesce(v_target.comp_hp,0) > 0;
    -- hit the fighter with the lower remaining HP fraction; ties -> character; only alive ones eligible
    if v_char_alive and v_comp_alive then
        v_hit_comp := (coalesce(v_target.comp_hp,0)::numeric / greatest(v_target.comp_max_hp,1)) < (coalesce(v_target.hp,0)::numeric / greatest(v_target.max_hp,1));
    else
        v_hit_comp := (not v_char_alive);
    end if;

    v_self := public.clan_dungeon_monster_state(v_run);
    if v_hit_comp then
        v_opp := public.clan_dungeon_companion_state(v_target);
    else
        v_opp := public.clan_dungeon_player_state(v_target);
    end if;

    select skill_id, name, type, effect, damage, cooldown, unblockable, params
      into v_skill_id, v_skill_name, v_skill_type, v_skill_effect, v_skill_damage, v_skill_cd, v_skill_unblockable, v_skill_params
      from public.clan_dungeon_monster_skills(p_run_id)
     where type='attack' and (effect is null or effect='')
       and public.clan_dungeon_cooldown_remaining(p_run_id, v_run.monster_id, skill_id, cooldown, v_run.monster_turns_taken)=0
     order by slot limit 1;
    if not found then
        select skill_id, name, type, effect, damage, cooldown, unblockable, params
          into v_skill_id, v_skill_name, v_skill_type, v_skill_effect, v_skill_damage, v_skill_cd, v_skill_unblockable, v_skill_params
          from public.clan_dungeon_monster_skills(p_run_id)
         where type='special' and (effect is null or effect='')
           and public.clan_dungeon_cooldown_remaining(p_run_id, v_run.monster_id, skill_id, cooldown, v_run.monster_turns_taken)=0
         order by slot limit 1;
    end if;
    if not found then raise exception 'لا يملك الوحش مهارة هجوم'; end if;

    v_eff := v_skill_damage;
    v_out := public.pvp_apply_effect(v_skill_type, v_skill_effect, v_eff, coalesce(v_skill_unblockable,false), v_skill_params, v_self, v_opp, false);
    v_self := v_out.self; v_opp := v_out.opp;
    perform public.clan_dungeon_save_monster(p_run_id, v_self);
    if v_hit_comp then perform public.clan_dungeon_save_companion(p_run_id, v_target_id, v_opp);
    else perform public.clan_dungeon_save_player(p_run_id, v_target_id, v_opp); end if;

    update public.clan_dungeon_runs set monster_turns_taken=monster_turns_taken+1,
        monster_used_skill_ids = case when v_skill_id = any(monster_used_skill_ids) then monster_used_skill_ids else array_append(monster_used_skill_ids, v_skill_id) end
    where id=p_run_id;
    if v_skill_cd>0 then
        insert into public.clan_dungeon_cooldowns(run_id,fighter_id,skill_id,last_used_turn,extra_cooldown)
        values (p_run_id, v_run.monster_id, v_skill_id, (select monster_turns_taken from public.clan_dungeon_runs where id=p_run_id), 0)
        on conflict (run_id,fighter_id,skill_id) do update set last_used_turn=excluded.last_used_turn;
    end if;

    -- knocked fighter: only resolve when BOTH char and companion are down
    if v_hit_comp then
        if v_opp.hp <= 0 then
            if coalesce(v_out.applied_dmg,0) > 0 and not coalesce(v_skill_unblockable,false)
               and public.clan_dungeon_companion_has_ready_defense(p_run_id, v_target.comp_character_id, v_target.comp_turns_taken)
            then null;
            else update public.clan_dungeon_players set comp_alive=false, comp_hp=0 where run_id=p_run_id and player_id=v_target_id; end if;
        end if;
        -- if the character is also down, this player is out
        if not v_char_alive then
            update public.clan_dungeon_players set alive=false, hp=0 where run_id=p_run_id and player_id=v_target_id and not exists(
                select 1 from public.clan_dungeon_players where run_id=p_run_id and player_id=v_target_id and comp_alive=true and comp_hp>0
            );
        end if;
    else
        if v_opp.hp <= 0 then
            if coalesce(v_out.applied_dmg,0) > 0 and not coalesce(v_skill_unblockable,false) and public.clan_dungeon_has_ready_defense(p_run_id, v_target_id,
                   (select character_id from public.player_characters where id=v_target.character_id),
                   v_target.sealed_skill_ids, v_target.turns_taken)
            then null;
            else update public.clan_dungeon_players set hp=0 where run_id=p_run_id and player_id=v_target_id; end if;
        end if;
        -- only down if the companion is also down
        if not v_comp_alive then
            update public.clan_dungeon_players set alive=false, hp=0 where run_id=p_run_id and player_id=v_target_id and not exists(
                select 1 from public.clan_dungeon_players where run_id=p_run_id and player_id=v_target_id and alive=true and hp>0
            );
        end if;
    end if;

    select exists(select 1 from public.clan_dungeon_players cp where cp.run_id=p_run_id and cp.alive=true) into v_any_alive;
    if not coalesce(v_any_alive,false) then update public.clan_dungeon_runs set status='finished' where id=p_run_id; return; end if;

    perform public.clan_dungeon_schedule_player(p_run_id, coalesce(v_run.turn_slot,-1));
end; $fn$;

-- ---------- state: expose companion + sub-turn ----------
create or replace function public.clan_dungeon_get_state(p_token text, p_run_id uuid)
returns table (status text, turn_phase text, monster_index int, total_monsters int,
    monster_id uuid, monster_name text, monster_image text, monster_hp int, monster_max_hp int,
    turn_player_id uuid, turn_deadline timestamptz, my_player_id uuid, my_max_hp int, my_turn boolean, my_char_id uuid, players jsonb,
    turn_sub int, my_comp_name text, my_comp_image text, my_comp_hp int, my_comp_max_hp int, my_comp_alive boolean, my_comp_turn boolean)
language plpgsql security definer set search_path to 'public','extensions','pg_temp' as $fn$
declare v_me uuid; v_run record; v_players jsonb; v_my_hp int; v_my_max int; v_my_char uuid; v_my_turn boolean; v_my_sub int;
declare v_comp_name text; v_comp_image text; v_comp_hp int; v_comp_max int; v_comp_alive boolean; v_comp_turn boolean; v_row record;
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
        'base_atk', cp.base_atk, 'base_hp', cp.base_hp,
        'comp_name', cp.comp_name, 'comp_image', cp.comp_image, 'comp_hp', cp.comp_hp, 'comp_max_hp', cp.comp_max_hp,
        'comp_alive', cp.comp_alive) order by cp.joined_at)
      into v_players from public.clan_dungeon_players cp where cp.run_id=p_run_id;
    select cp.hp, cp.max_hp, cp.character_id,
           (coalesce(v_run.turn_player_id, cp.player_id) = cp.player_id and v_run.turn_phase='player')
      into v_my_hp, v_my_max, v_my_char, v_my_turn
      from public.clan_dungeon_players cp where cp.run_id=p_run_id and cp.player_id=v_me;
    select * into v_row from public.clan_dungeon_players where run_id=p_run_id and player_id=v_me;
    v_comp_name := coalesce(v_row.comp_name,'');
    v_comp_image := v_row.comp_image;
    v_comp_hp := coalesce(v_row.comp_hp,0);
    v_comp_max := coalesce(v_row.comp_max_hp,0);
    v_comp_alive := coalesce(v_row.comp_alive,false) and coalesce(v_row.comp_hp,0) > 0;
    v_comp_turn := v_my_turn and v_run.turn_sub = 1;
    v_my_sub := v_run.turn_sub;
    return query
    select v_run.status, v_run.turn_phase, v_run.monster_index, array_length(v_run.monster_ids,1),
           v_run.monster_id, v_run.monster_name, v_run.monster_image, v_run.monster_hp, v_run.monster_max_hp,
           v_run.turn_player_id, v_run.turn_deadline, v_me, v_my_max, v_my_turn, v_my_char,
           coalesce(v_players,'[]'::jsonb), v_my_sub,
           v_comp_name, v_comp_image, v_comp_hp, v_comp_max, v_comp_alive, v_comp_turn;
end; $fn$;

-- ---------- skills: include the companion's skills ----------
create or replace function public.clan_dungeon_list_skills(p_token text, p_run_id uuid)
returns table (skill_id uuid, name text, type text, effect text, damage int, cooldown int, unblockable boolean, color text, params jsonb, description text, slot int, fighter_kind text, fighter_id uuid)
language plpgsql security definer set search_path to 'public','extensions','pg_temp' as $fn$
declare v_me uuid; v_run record; v_comp_char uuid; v_comp_pc uuid;
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

    select comp_character_id, comp_pc_id into v_comp_char, v_comp_pc
      from public.clan_dungeon_players where run_id=p_run_id and player_id=v_me;
    if v_comp_char is not null then
        return query
        select s.id, s.name, s.type, s.effect, s.damage, s.cooldown, s.unblockable, s.color, s.params, s.description,
               cs.slot, 'companion'::text, v_comp_pc::uuid
        from public.companion_skills cs
        join public.skills s on s.id = cs.skill_id
        where cs.companion_id = v_comp_char
        order by cs.slot;
    end if;

    return query
    select s.id, s.name, s.type, s.effect, s.damage, s.cooldown, s.unblockable, s.color, s.params, s.description,
           cs.slot, 'monster'::text, v_run.monster_id::uuid
    from public.character_skills cs
    join public.skills s on s.id = cs.skill_id
    where cs.character_id = v_run.monster_id
    order by cs.slot;
end; $fn$;

-- ---------- revoke public EXECUTE on new internal helpers ----------
revoke execute on function
  public.clan_dungeon_companion_state(record),
  public.clan_dungeon_save_companion(uuid, uuid, public.pvp_fighter_state),
  public.clan_dungeon_companion_has_ready_defense(uuid, uuid, integer)
from public, anon, authenticated;