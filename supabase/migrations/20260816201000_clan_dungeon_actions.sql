-- ============================================================
-- Clan Co-op Dungeon: player action + monster AI + rewards.
-- ============================================================

-- Player uses a skill. p_target_player_id NULL => monster.
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

    perform public.clan_dungeon_schedule_monster(p_run_id);
end; $fn$;

-- ---------- monster AI + wave advance + victory ----------
create or replace function public.clan_dungeon_monster_act(p_token text, p_run_id uuid)
returns void language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $fn$
declare
    v_me uuid; v_run record; v_target record; v_frozen int;
    v_skill_id uuid; v_skill_name text; v_skill_type text; v_skill_effect text;
    v_skill_damage int; v_skill_cd int; v_skill_unblockable boolean; v_skill_params jsonb;
    v_self public.pvp_fighter_state; v_opp public.pvp_fighter_state; v_out record;
    v_eff int; v_target_id uuid; v_any_alive boolean; v_m_idx int; v_total int;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    select * into v_run from public.clan_dungeon_runs where id=p_run_id for update;
    if v_run.id is null then raise exception 'الزنزانة غير موجودة'; end if;
    if v_run.status <> 'active' then raise exception 'المعركة ليست نشطة'; end if;

    if v_run.monster_hp <= 0 then
        v_m_idx := v_run.monster_index + 1; v_total := array_length(v_run.monster_ids,1);
        if v_m_idx >= v_total then
            update public.clan_dungeon_runs set status='finished', turn_phase='player', turn_player_id=null, turn_deadline=null where id=p_run_id;
            return;
        end if;
        update public.clan_dungeon_runs set monster_index=v_m_idx where id=p_run_id;
        perform public.clan_dungeon_spawn_monster(p_run_id);
        select * into v_run from public.clan_dungeon_runs where id=p_run_id;
    end if;

    if v_run.turn_phase <> 'monster' then raise exception 'ليست دور الوحش'; end if;

    v_frozen := coalesce(v_run.monster_frozen_turns,0);
    if v_frozen > 0 then
        update public.clan_dungeon_runs set monster_frozen_turns=v_frozen-1, monster_turns_taken=monster_turns_taken+1 where id=p_run_id;
        select exists(select 1 from public.clan_dungeon_players cp where cp.run_id=p_run_id and cp.alive=true) into v_any_alive;
        if not coalesce(v_any_alive,false) then update public.clan_dungeon_runs set status='finished' where id=p_run_id; return; end if;
        perform public.clan_dungeon_schedule_player(p_run_id, coalesce(v_run.turn_slot,-1)); return;
    end if;

    v_target_id := public.clan_dungeon_next_player(p_run_id, coalesce(v_run.turn_slot,0)-1);
    if v_target_id is null then update public.clan_dungeon_runs set status='finished' where id=p_run_id; return; end if;

    select * into v_target from public.clan_dungeon_players where run_id=p_run_id and player_id=v_target_id;
    v_self := public.clan_dungeon_monster_state(v_run);
    v_opp := public.clan_dungeon_player_state(v_target);

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
    perform public.clan_dungeon_save_player(p_run_id, v_target_id, v_opp);

    update public.clan_dungeon_runs set monster_turns_taken=monster_turns_taken+1,
        monster_used_skill_ids = case when v_skill_id = any(monster_used_skill_ids) then monster_used_skill_ids else array_append(monster_used_skill_ids, v_skill_id) end
    where id=p_run_id;
    if v_skill_cd>0 then
        insert into public.clan_dungeon_cooldowns(run_id,fighter_id,skill_id,last_used_turn,extra_cooldown)
        values (p_run_id, v_run.monster_id, v_skill_id, (select monster_turns_taken from public.clan_dungeon_runs where id=p_run_id), 0)
        on conflict (run_id,fighter_id,skill_id) do update set last_used_turn=excluded.last_used_turn;
    end if;

    if v_opp.hp <= 0 then
        if coalesce(v_out.applied_dmg,0) > 0 and not coalesce(v_skill_unblockable,false) and public.clan_dungeon_has_ready_defense(p_run_id, v_target_id,
               (select character_id from public.player_characters where id=v_target.character_id),
               v_target.sealed_skill_ids, v_target.turns_taken)
        then null;
        else update public.clan_dungeon_players set alive=false,hp=0 where run_id=p_run_id and player_id=v_target_id; end if;
    end if;

    select exists(select 1 from public.clan_dungeon_players cp where cp.run_id=p_run_id and cp.alive=true) into v_any_alive;
    if not coalesce(v_any_alive,false) then update public.clan_dungeon_runs set status='finished' where id=p_run_id; return; end if;

    perform public.clan_dungeon_schedule_player(p_run_id, coalesce(v_run.turn_slot,-1));
end; $fn$;

-- ---------- rewards ----------
create or replace function public.clan_dungeon_claim_reward(p_token text, p_run_id uuid)
returns table (status text, gold_share numeric, applicants int, dungeon_name text)
language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $fn$
declare
    v_me uuid; v_run record; v_app int; v_share numeric; v_dungeon record; r record;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    select * into v_run from public.clan_dungeon_runs where id=p_run_id for update;
    if v_run.id is null then raise exception 'الزنزانة غير موجودة'; end if;
    if v_run.monster_index < array_length(v_run.monster_ids,1)-1 then raise exception 'المعركة لم تكتمل بعد'; end if;
    if coalesce(v_run.monster_hp,0) > 0 then raise exception 'لم يتم هزيمة الوحش الأخير'; end if;
    if exists(select 1 from public.clan_dungeon_claims where run_id=p_run_id) then raise exception 'تم استلام الجائزة بالفعل'; end if;

    select d.name, d.gold_prize into v_dungeon from public.dungeons d where d.id=v_run.dungeon_id;
    v_app := (select count(*)::int from public.clan_dungeon_players cp where cp.run_id=p_run_id);
    if v_app=0 then raise exception 'لا يوجد متقدمون'; end if;
    v_share := (coalesce(v_dungeon.gold_prize,0)::numeric / v_app);

    for r in select player_id from public.clan_dungeon_players where run_id=p_run_id loop
        update public.players set gold = gold + floor(v_share) where id=r.player_id;
    end loop;

    insert into public.clan_dungeon_claims(run_id, claimed_by) values (p_run_id, v_me);
    update public.clan_dungeon_runs set status='finished' where id=p_run_id;
    return query select 'won'::text, floor(v_share), v_app, coalesce(v_dungeon.name,'');
end; $fn$;