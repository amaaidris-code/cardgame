-- ============================================================
-- PvP companion: action functions.
-- pvp_use_skill acts the caller's CHARACTER against a target
-- (enemy character [default] or enemy companion), then hands the
-- turn to the companion sub-turn if the caller has a living
-- companion, else ends the turn.
-- pvp_use_companion_skill acts the caller's COMPANION and ends
-- the turn.
-- A player is knocked out only when BOTH fighters are dead.
-- ============================================================

create or replace function public.pvp_use_skill(p_token text, p_match_id uuid, p_skill_id uuid, p_target_fight text default 'enemy')
returns table(status text, winner_id uuid, player1_hp integer, player2_hp integer)
language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $function$
declare
    v_player_id uuid;
    v_match record;
    v_skill record;
    v_is_p1 boolean;
    v_caller_char_id uuid;
    v_caller_turns integer;
    v_opponent_id uuid;
    v_opponent_other_alive boolean;
    v_owns_skill boolean;
    v_eff_damage integer;
    v_self pvp_fighter_state;
    v_opp  pvp_fighter_state;
    v_out  pvp_effect_out;
    v_next_turn uuid;
    v_hit_enemy_comp boolean;
    v_poison_dmg int;
    v_poison_turns_remaining int;
    v_has_comp_turn boolean;
begin
    v_player_id := player_id_from_token(p_token);

    select * into v_match from pvp_matches where id = p_match_id for update;

    if v_match.id is null then raise exception 'المباراة غير موجودة'; end if;
    if v_match.status != 'active' then raise exception 'المباراة غير نشطة الآن'; end if;
    if v_match.player1_id != v_player_id and v_match.player2_id != v_player_id then
        raise exception 'لست طرفًا في هذه المباراة';
    end if;
    if v_match.turn_player_id != v_player_id then raise exception 'ليس دورك الآن'; end if;
    if v_match.turn_sub <> 0 then raise exception 'استخدم المرافق أولًا في هذا الدور'; end if;

    v_is_p1 := (v_match.player1_id = v_player_id);

    if (v_is_p1 and coalesce(v_match.player1_frozen_turns, 0) > 0)
       or (not v_is_p1 and coalesce(v_match.player2_frozen_turns, 0) > 0) then
        raise exception 'أنت مجمد ولا تستطيع الحركة هذا الدور';
    end if;

    -- تطبيق سُم على خصم الشخصية في بداية الدور قبل أي شيء آخر
    if v_is_p1 then
        v_poison_dmg := coalesce(v_match.player2_poison_damage, 0);
        v_poison_turns_remaining := coalesce(v_match.player2_poison_turns, 0);
    else
        v_poison_dmg := coalesce(v_match.player1_poison_damage, 0);
        v_poison_turns_remaining := coalesce(v_match.player1_poison_turns, 0);
    end if;

    if v_poison_dmg > 0 AND v_poison_turns_remaining > 0 then
        if v_is_p1 then
            v_match.player2_hp := GREATEST(0, v_match.player2_hp - v_poison_dmg);
            v_match.player2_poison_turns := v_poison_turns_remaining - 1;
            if v_match.player2_poison_turns <= 0 then
                v_match.player2_poison_damage := 0;
                v_match.player2_poison_turns := 0;
            end if;
        else
            v_match.player1_hp := GREATEST(0, v_match.player1_hp - v_poison_dmg);
            v_match.player1_poison_turns := v_poison_turns_remaining - 1;
            if v_match.player1_poison_turns <= 0 then
                v_match.player1_poison_damage := 0;
                v_match.player1_poison_turns := 0;
            end if;
        end if;
    end if;

    v_hit_enemy_comp := (p_target_fight = 'enemy_comp');

    if v_is_p1 then
        v_caller_char_id := v_match.player1_character_id;
        v_caller_turns := v_match.player1_turns_taken;
        v_opponent_id := v_match.player2_id;
        v_self := row(
            v_match.player1_hp, v_match.player1_max_hp, v_match.player1_temp_atk,
            v_match.player1_temp_hp, v_match.player1_extra_turns,
            v_match.player1_absorb_mode, v_match.player1_absorb_hits,
            v_match.player1_reflect_multiplier,
            v_match.player1_last_hit_hp_before, v_match.player1_last_hit_damage,
            coalesce(v_match.player1_last_hit_consumed, true),
            coalesce(v_match.player1_frozen_turns, 0), v_match.player1_defending,
            v_match.player1_shield_charges,
            coalesce(v_match.player1_poison_damage, 0),
            coalesce(v_match.player1_poison_turns, 0)
        )::pvp_fighter_state;
        if v_hit_enemy_comp then
            v_opp := public.p2_comp_state(v_match);
            v_opponent_other_alive := v_match.player2_hp > 0;
        else
            v_opponent_other_alive := coalesce(v_match.p2_comp_alive,false) and coalesce(v_match.p2_comp_hp,0) > 0;
            v_opp := row(
                v_match.player2_hp, v_match.player2_max_hp, v_match.player2_temp_atk,
                v_match.player2_temp_hp, v_match.player2_extra_turns,
                v_match.player2_absorb_mode, v_match.player2_absorb_hits,
                v_match.player2_reflect_multiplier,
                v_match.player2_last_hit_hp_before, v_match.player2_last_hit_damage,
                coalesce(v_match.player2_last_hit_consumed, true),
                coalesce(v_match.player2_frozen_turns, 0), v_match.player2_defending,
                v_match.player2_shield_charges,
                coalesce(v_match.player2_poison_damage, 0),
                coalesce(v_match.player2_poison_turns, 0)
            )::pvp_fighter_state;
        end if;
    else
        v_caller_char_id := v_match.player2_character_id;
        v_caller_turns := v_match.player2_turns_taken;
        v_opponent_id := v_match.player1_id;
        v_self := row(
            v_match.player2_hp, v_match.player2_max_hp, v_match.player2_temp_atk,
            v_match.player2_temp_hp, v_match.player2_extra_turns,
            v_match.player2_absorb_mode, v_match.player2_absorb_hits,
            v_match.player2_reflect_multiplier,
            v_match.player2_last_hit_hp_before, v_match.player2_last_hit_damage,
            coalesce(v_match.player2_last_hit_consumed, true),
            coalesce(v_match.player2_frozen_turns, 0), v_match.player2_defending,
            v_match.player2_shield_charges,
            coalesce(v_match.player2_poison_damage, 0),
            coalesce(v_match.player2_poison_turns, 0)
        )::pvp_fighter_state;
        if v_hit_enemy_comp then
            v_opp := public.p1_comp_state(v_match);
            v_opponent_other_alive := v_match.player1_hp > 0;
        else
            v_opponent_other_alive := coalesce(v_match.p1_comp_alive,false) and coalesce(v_match.p1_comp_hp,0) > 0;
            v_opp := row(
                v_match.player1_hp, v_match.player1_max_hp, v_match.player1_temp_atk,
                v_match.player1_temp_hp, v_match.player1_extra_turns,
                v_match.player1_absorb_mode, v_match.player1_absorb_hits,
                v_match.player1_reflect_multiplier,
                v_match.player1_last_hit_hp_before, v_match.player1_last_hit_damage,
                coalesce(v_match.player1_last_hit_consumed, true),
                coalesce(v_match.player1_frozen_turns, 0), v_match.player1_defending,
                v_match.player1_shield_charges,
                coalesce(v_match.player1_poison_damage, 0),
                coalesce(v_match.player1_poison_turns, 0)
            )::pvp_fighter_state;
        end if;
    end if;

    select exists(
        select 1 from player_characters pc
        join character_skills cs on cs.character_id = pc.character_id
        where pc.id = v_caller_char_id and cs.skill_id = p_skill_id
    ) into v_owns_skill;

    if not v_owns_skill then raise exception 'هذه المهارة ليست من مهاراتك'; end if;

    select * into v_skill from skills where id = p_skill_id;

    if v_skill.effect in ('steal', 'copy', 'control') then
        raise exception 'لا يمكن استخدام مهارة السرقة/النسخ/التحكم مباشرة — تُستخدم من قائمتها الخاصة';
    end if;
    if v_skill.effect in ('seal', 'unseal') then
        raise exception 'لا يمكن استخدام مهارة الختم/فك الختم مباشرة — تُستخدم من قائمتها الخاصة';
    end if;
    if v_skill.effect in ('shadow', 'delay_cooldown') then
        raise exception 'لا يمكن استخدام هذه المهارة مباشرة — تُستخدم من قائمتها الخاصة';
    end if;

    if (v_is_p1 and v_match.player1_sealed_skill_ids is not null and p_skill_id = any(v_match.player1_sealed_skill_ids))
       or (not v_is_p1 and v_match.player2_sealed_skill_ids is not null and p_skill_id = any(v_match.player2_sealed_skill_ids)) then
        raise exception 'هذه المهارة مختومة ولا يمكن استخدامها';
    end if;

    if public.pvp_skill_remaining_cd(p_match_id, v_player_id, p_skill_id, v_skill.cooldown, v_caller_turns) > 0 then
        raise exception 'المهارة ما زالت في التهدئة';
    end if;

    v_eff_damage := v_skill.damage;
    if v_skill.type in ('attack','special') and (v_skill.effect is null or v_skill.effect = '') then
        v_eff_damage := coalesce(public.pvp_scaled_attack_damage(v_caller_char_id, p_skill_id), v_skill.damage);
    end if;

    v_out := public.pvp_apply_effect(
        v_skill.type, v_skill.effect, v_eff_damage, coalesce(v_skill.unblockable, false),
        v_skill.params, v_self, v_opp, false);

    v_self := v_out.self;
    v_opp  := v_out.opp;

    if v_out.heal > 0 then
        v_self.hp := least(v_self.max_hp, v_self.hp + v_out.heal);
    end if;

    if v_skill.type = 'defense' then
        v_self.defending := true;
        v_self.shield_charges := greatest(0, v_out.endurance_hits - 1);
    else
        v_self.defending := false;
    end if;
    v_opp.defending := v_out.blocked and v_opp.shield_charges > 0;

    v_caller_turns := v_caller_turns + 1;

    if v_skill.cooldown > 0 then
        insert into pvp_cooldowns(match_id, player_id, skill_id, last_used_turn, extra_cooldown)
        values (p_match_id, v_player_id, p_skill_id, v_caller_turns, 0)
        on conflict (match_id, player_id, skill_id)
        do update set last_used_turn = excluded.last_used_turn;
    end if;

    insert into revealed_skills(owner_id, viewer_player_id, skill_id, battle_id)
    values (v_player_id, v_opponent_id, p_skill_id, p_match_id)
    on conflict (owner_id, viewer_player_id, skill_id) do nothing;

    if v_opp.frozen_turns > 0 then
        v_opp.frozen_turns := v_opp.frozen_turns - 1;
        v_next_turn := v_player_id;
    elsif v_self.extra_turns > 0 then
        v_self.extra_turns := v_self.extra_turns - 1;
        v_next_turn := v_player_id;
    else
        v_next_turn := v_opponent_id;
    end if;

    -- does the caller still have a living companion that should act this turn?
    if (v_is_p1 and coalesce(v_match.p1_comp_alive,false) and coalesce(v_match.p1_comp_hp,0) > 0)
       or (not v_is_p1 and coalesce(v_match.p2_comp_alive,false) and coalesce(v_match.p2_comp_hp,0) > 0) then
        v_has_comp_turn := true;
    else
        v_has_comp_turn := false;
    end if;

    if v_is_p1 then
        update pvp_matches set
            player1_turns_taken = v_caller_turns,
            player1_defending = v_self.defending,
            player1_shield_charges = v_self.shield_charges,
            player1_reflect_multiplier = v_self.reflect_mult,
            player1_absorb_mode = v_self.absorb_mode,
            player1_absorb_hits = v_self.absorb_hits,
            player1_temp_atk = v_self.temp_atk,
            player1_temp_hp = v_self.temp_hp,
            player1_extra_turns = v_self.extra_turns,
            player1_max_hp = v_self.max_hp,
            player1_last_hit_hp_before = v_self.last_hp_before,
            player1_last_hit_damage = v_self.last_damage,
            player1_last_hit_consumed = v_self.last_consumed,
            player1_poison_damage = v_self.poison_damage,
            player1_poison_turns = v_self.poison_turns,
            player1_used_skill_ids = case when p_skill_id = any(player1_used_skill_ids)
                then player1_used_skill_ids else array_append(player1_used_skill_ids, p_skill_id) end,
            player1_hp = v_self.hp
            , turn_sub = case when v_has_comp_turn and v_next_turn = v_player_id then 0 else
                      case when v_has_comp_turn then 1 else 0 end end
            , turn_player_id = case when (v_has_comp_turn and v_next_turn = v_opponent_id) then v_player_id else v_next_turn end
            , turn_deadline = now() + interval '60 seconds'
            , updated_at = now()
        where id = p_match_id;
        if v_hit_enemy_comp then
            perform public.pvp_companion_write_state(p_match_id, false, v_opp);
        else
            update pvp_matches set
                player2_defending = v_opp.defending,
                player2_shield_charges = v_opp.shield_charges,
                player2_reflect_multiplier = v_opp.reflect_mult,
                player2_absorb_mode = v_opp.absorb_mode,
                player2_absorb_hits = v_opp.absorb_hits,
                player2_temp_atk = v_opp.temp_atk,
                player2_temp_hp = v_opp.temp_hp,
                player2_extra_turns = v_opp.extra_turns,
                player2_last_hit_hp_before = v_opp.last_hp_before,
                player2_last_hit_damage = v_opp.last_damage,
                player2_last_hit_consumed = v_opp.last_consumed,
                player2_poison_damage = v_opp.poison_damage,
                player2_poison_turns = v_opp.poison_turns,
                player2_hp = v_opp.hp,
                player2_frozen_turns = v_opp.frozen_turns
            where id = p_match_id;
        end if;
    else
        update pvp_matches set
            player2_turns_taken = v_caller_turns,
            player2_defending = v_self.defending,
            player2_shield_charges = v_self.shield_charges,
            player2_reflect_multiplier = v_self.reflect_mult,
            player2_absorb_mode = v_self.absorb_mode,
            player2_absorb_hits = v_self.absorb_hits,
            player2_temp_atk = v_self.temp_atk,
            player2_temp_hp = v_self.temp_hp,
            player2_extra_turns = v_self.extra_turns,
            player2_max_hp = v_self.max_hp,
            player2_last_hit_hp_before = v_self.last_hp_before,
            player2_last_hit_damage = v_self.last_damage,
            player2_last_hit_consumed = v_self.last_consumed,
            player2_poison_damage = v_self.poison_damage,
            player2_poison_turns = v_self.poison_turns,
            player2_used_skill_ids = case when p_skill_id = any(player2_used_skill_ids)
                then player2_used_skill_ids else array_append(player2_used_skill_ids, p_skill_id) end,
            player2_hp = v_self.hp
            , turn_sub = case when v_has_comp_turn and v_next_turn = v_player_id then 0 else
                      case when v_has_comp_turn then 1 else 0 end end
            , turn_player_id = case when (v_has_comp_turn and v_next_turn = v_opponent_id) then v_player_id else v_next_turn end
            , turn_deadline = now() + interval '60 seconds'
            , updated_at = now()
        where id = p_match_id;
        if v_hit_enemy_comp then
            perform public.pvp_companion_write_state(p_match_id, true, v_opp);
        else
            update pvp_matches set
                player1_defending = v_opp.defending,
                player1_shield_charges = v_opp.shield_charges,
                player1_reflect_multiplier = v_opp.reflect_mult,
                player1_absorb_mode = v_opp.absorb_mode,
                player1_absorb_hits = v_opp.absorb_hits,
                player1_temp_atk = v_opp.temp_atk,
                player1_temp_hp = v_opp.temp_hp,
                player1_extra_turns = v_opp.extra_turns,
                player1_last_hit_hp_before = v_opp.last_hp_before,
                player1_last_hit_damage = v_opp.last_damage,
                player1_last_hit_consumed = v_opp.last_consumed,
                player1_poison_damage = v_opp.poison_damage,
                player1_poison_turns = v_opp.poison_turns,
                player1_hp = v_opp.hp,
                player1_frozen_turns = v_opp.frozen_turns
            where id = p_match_id;
        end if;
    end if;

    -- ضربة قاتلة: لا تُحسم إلا إذا سقط كلا مقاتلي الخصم.
    -- الدفاع الجاهز (defense/reflect) يبقى الشخصية حيّة عند الصفر (as before).
    if v_opp.hp <= 0 then
        if ( (coalesce(v_out.applied_dmg, 0) > 0 AND not coalesce(v_skill.unblockable, false))
             OR (coalesce(v_out.reflected_dmg, 0) > 0
                 AND not coalesce(v_skill.unblockable, false)
                 AND not coalesce((v_skill.params->>'unblockable_reflect')::boolean, false))
           )
           and ( case when v_hit_enemy_comp then
                    public.pvp_companion_has_ready_defense(
                        (select case when v_is_p1 then v_match.p2_comp_char_id else v_match.p1_comp_char_id end),
                        p_match_id, v_opponent_id,
                        (select case when v_is_p1 then v_match.p2_comp_turns_taken else v_match.p1_comp_turns_taken end))
                 else
                    public.pvp_has_ready_defense(
                        case when v_is_p1 then v_match.player2_character_id else v_match.player1_character_id end,
                        case when v_is_p1 then v_match.player2_sealed_skill_ids else v_match.player1_sealed_skill_ids end,
                        case when v_is_p1 then v_match.player2_turns_taken else v_match.player1_turns_taken end,
                        p_match_id, v_opponent_id)
                 end ) then
            null;  -- الدفاع الجاهز أنقذه؛ لا يُحسم شيء
        elsif v_opponent_other_alive then
            -- سقط هذا المقاتل لكن لا يزال لدى الخصم المقاتل الآخر: لا تنتهي المباراة
            if v_hit_enemy_comp then
                if v_is_p1 then
                    update pvp_matches set p2_comp_alive=false, p2_comp_hp=0 where id=p_match_id;
                else
                    update pvp_matches set p1_comp_alive=false, p1_comp_hp=0 where id=p_match_id;
                end if;
            end if;
            -- الشخصية الهدف موش راح تنتهي المباراة لأن الرفيق قائم
            null;
        else
            update pvp_matches set status='finished', winner_id=v_player_id, turn_player_id=null, turn_deadline=null, updated_at=now()
            where id=p_match_id;
        end if;
    elsif v_self.hp <= 0 then
        -- شخصية المنادي سقطت: يخسر فقط إذا سقط مرافقه أيضًا
        if (v_is_p1 and coalesce(v_match.p1_comp_alive,false) and coalesce(v_match.p1_comp_hp,0) > 0)
           or (not v_is_p1 and coalesce(v_match.p2_comp_alive,false) and coalesce(v_match.p2_comp_hp,0) > 0) then
            -- ما زال المرافق حيًا: ينتقل الدور إلى منادي lb عبد المرافق
            update pvp_matches set turn_player_id=v_player_id, turn_sub=1, turn_deadline=now() + interval '60 seconds', updated_at=now()
            where id=p_match_id;
        else
            update pvp_matches set status='finished', winner_id=v_opponent_id, turn_player_id=null, turn_deadline=null, updated_at=now()
            where id=p_match_id;
        end if;
    end if;

    select m.status, m.winner_id, m.player1_hp, m.player2_hp into v_match
    from pvp_matches m where m.id = p_match_id;

    return query select v_match.status, v_match.winner_id, v_match.player1_hp, v_match.player2_hp;
end; $function$;

-- ============================================================
-- pvp_use_companion_skill: acts the caller's COMPANION (turn_sub=1).
-- This is the second half of the caller's turn: the companion may hit
-- the enemy character or the enemy companion (p_target_fight), then the
-- turn passes on. A player is knocked out only when BOTH fighters are dead.
-- ============================================================
create or replace function public.pvp_use_companion_skill(p_token text, p_match_id uuid, p_skill_id uuid, p_target_fight text default 'enemy')
returns table(status text, winner_id uuid, player1_hp integer, player2_hp integer)
language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $function$
declare
    v_player_id uuid;
    v_match record;
    v_skill record;
    v_is_p1 boolean;
    v_caller_comp_char uuid;
    v_caller_turns integer;
    v_opponent_id uuid;
    v_opponent_other_alive boolean;
    v_owns_skill boolean;
    v_eff_damage integer;
    v_self pvp_fighter_state;
    v_opp  pvp_fighter_state;
    v_out  pvp_effect_out;
    v_next_turn uuid;
    v_hit_enemy_comp boolean;
begin
    v_player_id := player_id_from_token(p_token);

    select * into v_match from pvp_matches where id = p_match_id for update;

    if v_match.id is null then raise exception 'المباراة غير موجودة'; end if;
    if v_match.status != 'active' then raise exception 'المباراة غير نشطة الآن'; end if;
    if v_match.player1_id != v_player_id and v_match.player2_id != v_player_id then
        raise exception 'لست طرفًا في هذه المباراة';
    end if;
    if v_match.turn_player_id != v_player_id then raise exception 'ليس دورك الآن'; end if;
    if v_match.turn_sub <> 1 then raise exception 'هذا ليس دور المرافق الآن'; end if;

    v_is_p1 := (v_match.player1_id = v_player_id);

    v_hit_enemy_comp := (p_target_fight = 'enemy_comp');

    if v_is_p1 then
        if not coalesce(v_match.p1_comp_alive,false) or coalesce(v_match.p1_comp_hp,0) <= 0 then
            raise exception 'مرافقك سقط';
        end if;
        if coalesce(v_match.p1_comp_frozen_turns,0) > 0 then raise exception 'مرافقك مجمد'; end if;
        v_caller_comp_char := v_match.p1_comp_char_id;
        v_caller_turns := v_match.p1_comp_turns_taken;
        v_opponent_id := v_match.player2_id;
        v_self := public.p1_comp_state(v_match);
        if v_hit_enemy_comp then
            v_opp := public.p2_comp_state(v_match);
            v_opponent_other_alive := v_match.player2_hp > 0;
        else
            v_opponent_other_alive := coalesce(v_match.p2_comp_alive,false) and coalesce(v_match.p2_comp_hp,0) > 0;
            v_opp := row(
                v_match.player2_hp, v_match.player2_max_hp, v_match.player2_temp_atk,
                v_match.player2_temp_hp, v_match.player2_extra_turns,
                v_match.player2_absorb_mode, v_match.player2_absorb_hits,
                v_match.player2_reflect_multiplier,
                v_match.player2_last_hit_hp_before, v_match.player2_last_hit_damage,
                coalesce(v_match.player2_last_hit_consumed, true),
                coalesce(v_match.player2_frozen_turns, 0), v_match.player2_defending,
                v_match.player2_shield_charges,
                coalesce(v_match.player2_poison_damage, 0),
                coalesce(v_match.player2_poison_turns, 0)
            )::pvp_fighter_state;
        end if;
    else
        if not coalesce(v_match.p2_comp_alive,false) or coalesce(v_match.p2_comp_hp,0) <= 0 then
            raise exception 'مرافقك سقط';
        end if;
        if coalesce(v_match.p2_comp_frozen_turns,0) > 0 then raise exception 'مرافقك مجمد'; end if;
        v_caller_comp_char := v_match.p2_comp_char_id;
        v_caller_turns := v_match.p2_comp_turns_taken;
        v_opponent_id := v_match.player1_id;
        v_self := public.p2_comp_state(v_match);
        if v_hit_enemy_comp then
            v_opp := public.p1_comp_state(v_match);
            v_opponent_other_alive := v_match.player1_hp > 0;
        else
            v_opponent_other_alive := coalesce(v_match.p1_comp_alive,false) and coalesce(v_match.p1_comp_hp,0) > 0;
            v_opp := row(
                v_match.player1_hp, v_match.player1_max_hp, v_match.player1_temp_atk,
                v_match.player1_temp_hp, v_match.player1_extra_turns,
                v_match.player1_absorb_mode, v_match.player1_absorb_hits,
                v_match.player1_reflect_multiplier,
                v_match.player1_last_hit_hp_before, v_match.player1_last_hit_damage,
                coalesce(v_match.player1_last_hit_consumed, true),
                coalesce(v_match.player1_frozen_turns, 0), v_match.player1_defending,
                v_match.player1_shield_charges,
                coalesce(v_match.player1_poison_damage, 0),
                coalesce(v_match.player1_poison_turns, 0)
            )::pvp_fighter_state;
        end if;
    end if;

    select exists(
        select 1 from companion_skills cs
        where cs.companion_id = v_caller_comp_char and cs.skill_id = p_skill_id
    ) into v_owns_skill;

    if not v_owns_skill then raise exception 'هذه المهارة ليست من مهارات مرافقك'; end if;

    select * into v_skill from skills where id = p_skill_id;

    if v_skill.effect in ('steal', 'copy', 'control') then
        raise exception 'لا يمكن استخدام مهارة السرقة/النسخ/التحكم مباشرة — تُستخدم من قائمتها الخاصة';
    end if;
    if v_skill.effect in ('seal', 'unseal') then
        raise exception 'لا يمكن استخدام مهارة الختم/فك الختم مباشرة — تُستخدم من قائمتها الخاصة';
    end if;
    if v_skill.effect in ('shadow', 'delay_cooldown') then
        raise exception 'لا يمكن استخدام هذه المهارة مباشرة — تُستخدم من قائمتها الخاصة';
    end if;

    if (v_is_p1 and v_match.p1_comp_sealed_skill_ids is not null and p_skill_id = any(v_match.p1_comp_sealed_skill_ids))
       or (not v_is_p1 and v_match.p2_comp_sealed_skill_ids is not null and p_skill_id = any(v_match.p2_comp_sealed_skill_ids)) then
        raise exception 'هذه المهارة مختومة ولا يمكن استخدامها';
    end if;

    if public.pvp_skill_remaining_cd(p_match_id, v_player_id, p_skill_id, v_skill.cooldown, v_caller_turns) > 0 then
        raise exception 'المهارة ما زالت في التهدئة';
    end if;

    v_eff_damage := v_skill.damage;
    if v_skill.type in ('attack','special') and (v_skill.effect is null or v_skill.effect = '') then
        v_eff_damage := coalesce(public.pvp_scaled_attack_damage(v_caller_comp_char, p_skill_id), v_skill.damage);
    end if;

    v_out := public.pvp_apply_effect(
        v_skill.type, v_skill.effect, v_eff_damage, coalesce(v_skill.unblockable, false),
        v_skill.params, v_self, v_opp, false);

    v_self := v_out.self;
    v_opp  := v_out.opp;

    if v_out.heal > 0 then
        v_self.hp := least(v_self.max_hp, v_self.hp + v_out.heal);
    end if;

    if v_skill.type = 'defense' then
        v_self.defending := true;
        v_self.shield_charges := greatest(0, v_out.endurance_hits - 1);
    else
        v_self.defending := false;
    end if;
    v_opp.defending := v_out.blocked and v_opp.shield_charges > 0;

    v_caller_turns := v_caller_turns + 1;

    if v_skill.cooldown > 0 then
        insert into pvp_cooldowns(match_id, player_id, skill_id, last_used_turn, extra_cooldown)
        values (p_match_id, v_player_id, p_skill_id, v_caller_turns, 0)
        on conflict (match_id, player_id, skill_id)
        do update set last_used_turn = excluded.last_used_turn;
    end if;

    insert into revealed_skills(owner_id, viewer_player_id, skill_id, battle_id)
    values (v_player_id, v_opponent_id, p_skill_id, p_match_id)
    on conflict (owner_id, viewer_player_id, skill_id) do nothing;

    if v_opp.frozen_turns > 0 then
        v_opp.frozen_turns := v_opp.frozen_turns - 1;
        v_next_turn := v_player_id;
    elsif v_self.extra_turns > 0 then
        v_self.extra_turns := v_self.extra_turns - 1;
        v_next_turn := v_player_id;
    else
        v_next_turn := v_opponent_id;
    end if;

    if v_is_p1 then
        perform public.pvp_companion_write_state(p_match_id, true, v_self);
        update pvp_matches set
            p1_comp_turns_taken = v_caller_turns,
            p1_comp_used_skill_ids = case when p_skill_id = any(p1_comp_used_skill_ids)
                then p1_comp_used_skill_ids else array_append(p1_comp_used_skill_ids, p_skill_id) end
        where id = p_match_id;
        if v_hit_enemy_comp then
            perform public.pvp_companion_write_state(p_match_id, false, v_opp);
        else
            update pvp_matches set
                player2_defending = v_opp.defending,
                player2_shield_charges = v_opp.shield_charges,
                player2_reflect_multiplier = v_opp.reflect_mult,
                player2_absorb_mode = v_opp.absorb_mode,
                player2_absorb_hits = v_opp.absorb_hits,
                player2_temp_atk = v_opp.temp_atk,
                player2_temp_hp = v_opp.temp_hp,
                player2_extra_turns = v_opp.extra_turns,
                player2_last_hit_hp_before = v_opp.last_hp_before,
                player2_last_hit_damage = v_opp.last_damage,
                player2_last_hit_consumed = v_opp.last_consumed,
                player2_poison_damage = v_opp.poison_damage,
                player2_poison_turns = v_opp.poison_turns,
                player2_hp = v_opp.hp,
                player2_frozen_turns = v_opp.frozen_turns
            where id = p_match_id;
        end if;
    else
        perform public.pvp_companion_write_state(p_match_id, false, v_self);
        update pvp_matches set
            p2_comp_turns_taken = v_caller_turns,
            p2_comp_used_skill_ids = case when p_skill_id = any(p2_comp_used_skill_ids)
                then p2_comp_used_skill_ids else array_append(p2_comp_used_skill_ids, p_skill_id) end
        where id = p_match_id;
        if v_hit_enemy_comp then
            perform public.pvp_companion_write_state(p_match_id, true, v_opp);
        else
            update pvp_matches set
                player1_defending = v_opp.defending,
                player1_shield_charges = v_opp.shield_charges,
                player1_reflect_multiplier = v_opp.reflect_mult,
                player1_absorb_mode = v_opp.absorb_mode,
                player1_absorb_hits = v_opp.absorb_hits,
                player1_temp_atk = v_opp.temp_atk,
                player1_temp_hp = v_opp.temp_hp,
                player1_extra_turns = v_opp.extra_turns,
                player1_last_hit_hp_before = v_opp.last_hp_before,
                player1_last_hit_damage = v_opp.last_damage,
                player1_last_hit_consumed = v_opp.last_consumed,
                player1_poison_damage = v_opp.poison_damage,
                player1_poison_turns = v_opp.poison_turns,
                player1_hp = v_opp.hp,
                player1_frozen_turns = v_opp.frozen_turns
            where id = p_match_id;
        end if;
    end if;

    -- ضربة قاتلة ضد هدف المرافق (نفس منطق الشخصية)
    if v_opp.hp <= 0 then
        if ( (coalesce(v_out.applied_dmg, 0) > 0 AND not coalesce(v_skill.unblockable, false))
             OR (coalesce(v_out.reflected_dmg, 0) > 0
                 AND not coalesce(v_skill.unblockable, false)
                 AND not coalesce((v_skill.params->>'unblockable_reflect')::boolean, false))
           )
           and ( case when v_hit_enemy_comp then
                    public.pvp_companion_has_ready_defense(
                        (select case when v_is_p1 then v_match.p2_comp_char_id else v_match.p1_comp_char_id end),
                        p_match_id, v_opponent_id,
                        (select case when v_is_p1 then v_match.p2_comp_turns_taken else v_match.p1_comp_turns_taken end))
                 else
                    public.pvp_has_ready_defense(
                        case when v_is_p1 then v_match.player2_character_id else v_match.player1_character_id end,
                        case when v_is_p1 then v_match.player2_sealed_skill_ids else v_match.player1_sealed_skill_ids end,
                        case when v_is_p1 then v_match.player2_turns_taken else v_match.player1_turns_taken end,
                        p_match_id, v_opponent_id)
                 end ) then
            null;  -- الدفاع الجاهز أنقذه
        elsif v_opponent_other_alive then
            if v_hit_enemy_comp then
                if v_is_p1 then
                    update pvp_matches set p2_comp_alive=false, p2_comp_hp=0 where id=p_match_id;
                else
                    update pvp_matches set p1_comp_alive=false, p1_comp_hp=0 where id=p_match_id;
                end if;
            end if;
            null;
        else
            update pvp_matches set status='finished', winner_id=v_player_id, turn_player_id=null, turn_deadline=null, updated_at=now()
            where id=p_match_id;
        end if;
    elsif v_self.hp <= 0 then
        -- المرافق سقط: يخسر فقط إذا سقطت الشخصية أيضًا
        if (v_is_p1 and coalesce(v_match.player1_hp,0) > 0)
           or (not v_is_p1 and coalesce(v_match.player2_hp,0) > 0) then
            null;  -- الشخصية لا تزال حية، المباراة مستمرة
        else
            update pvp_matches set status='finished', winner_id=v_opponent_id, turn_player_id=null, turn_deadline=null, updated_at=now()
            where id=p_match_id;
        end if;
    end if;

    -- المرافق أنهى الدور: مرّر الدور، وأعد turn_sub إلى 0
    update pvp_matches set turn_sub = 0, turn_player_id = v_next_turn,
        turn_deadline = now() + interval '60 seconds', updated_at = now()
    where id = p_match_id
      and status = 'active';

    select m.status, m.winner_id, m.player1_hp, m.player2_hp into v_match
    from pvp_matches m where m.id = p_match_id;

    return query select v_match.status, v_match.winner_id, v_match.player1_hp, v_match.player2_hp;
end; $function$;

-- ============================================================
-- pvp_get_match_state: exposes companion fighter state + turn_sub
-- (0 = character sub-turn, 1 = companion sub-turn) so the client can
-- render two fighters per player and route the companion sub-turn.
-- All original output columns are preserved.
-- ============================================================
create or replace function public.pvp_get_match_state(p_token text, p_match_id uuid)
returns table (
    id uuid, status text, turn_player_id uuid, winner_id uuid,
    player1_id uuid, player2_id uuid,
    player1_hp integer, player2_hp integer, player1_max_hp integer, player2_max_hp integer,
    player1_char_name text, player2_char_name text,
    player1_char_image text, player2_char_image text,
    player1_defending boolean, player2_defending boolean,
    player1_shield_charges integer, player2_shield_charges integer,
    player1_frozen_turns integer, player2_frozen_turns integer,
    player1_reflect_multiplier integer, player2_reflect_multiplier integer,
    player1_used_skill_ids uuid[], player2_used_skill_ids uuid[],
    player1_sealed_skill_ids uuid[], player2_sealed_skill_ids uuid[],
    player1_turns_taken integer, player2_turns_taken integer,
    player1_ready boolean, player2_ready boolean,
    race_started_at timestamptz, my_cooldowns jsonb,
    updated_at timestamptz, turn_deadline timestamptz,
    opponent_ever_used_skill_ids uuid[], opponent_defense_skill_ids uuid[],
    opponent_first_skill_id uuid,
    player1_absorb_mode text, player2_absorb_mode text,
    player1_absorb_hits integer, player2_absorb_hits integer,
    player1_temp_atk integer, player2_temp_atk integer,
    player1_temp_hp integer, player2_temp_hp integer,
    player1_extra_turns integer, player2_extra_turns integer,
    player1_poison_damage integer, player1_poison_turns integer,
    player2_poison_damage integer, player2_poison_turns integer,
    turn_sub integer,
    p1_comp_id uuid, p1_comp_char_id uuid, p1_comp_name text, p1_comp_image text,
    p1_comp_alive boolean, p1_comp_hp integer, p1_comp_max_hp integer, p1_comp_turns_taken integer,
    p1_comp_used_skill_ids uuid[], p1_comp_sealed_skill_ids uuid[],
    p1_comp_temp_atk integer, p1_comp_temp_hp integer, p1_comp_extra_turns integer,
    p1_comp_frozen_turns integer, p1_comp_defending boolean, p1_comp_shield_charges integer,
    p1_comp_absorb_hits integer, p1_comp_reflect_multiplier integer,
    p1_comp_poison_damage integer, p1_comp_poison_turns integer,
    p2_comp_id uuid, p2_comp_char_id uuid, p2_comp_name text, p2_comp_image text,
    p2_comp_alive boolean, p2_comp_hp integer, p2_comp_max_hp integer, p2_comp_turns_taken integer,
    p2_comp_used_skill_ids uuid[], p2_comp_sealed_skill_ids uuid[],
    p2_comp_temp_atk integer, p2_comp_temp_hp integer, p2_comp_extra_turns integer,
    p2_comp_frozen_turns integer, p2_comp_defending boolean, p2_comp_shield_charges integer,
    p2_comp_absorb_hits integer, p2_comp_reflect_multiplier integer,
    p2_comp_poison_damage integer, p2_comp_poison_turns integer
)
language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $function$
declare
  v_player_id uuid;
  v_opponent_id uuid;
begin
  v_player_id := player_id_from_token(p_token);

  select (case when m.player1_id = v_player_id then m.player2_id else m.player1_id end)
  into v_opponent_id
  from pvp_matches m
  where m.id = p_match_id
    and (m.player1_id = v_player_id or m.player2_id = v_player_id);

  return query
  select m.id, m.status, m.turn_player_id, m.winner_id,
         m.player1_id, m.player2_id,
         m.player1_hp, m.player2_hp, m.player1_max_hp, m.player2_max_hp,
         c1.name, c2.name,
         c1.identity_image, c2.identity_image,
         m.player1_defending, m.player2_defending,
         m.player1_shield_charges, m.player2_shield_charges,
         m.player1_frozen_turns, m.player2_frozen_turns,
         m.player1_reflect_multiplier, m.player2_reflect_multiplier,
         m.player1_used_skill_ids, m.player2_used_skill_ids,
         m.player1_sealed_skill_ids, m.player2_sealed_skill_ids,
         m.player1_turns_taken, m.player2_turns_taken,
         m.player1_ready, m.player2_ready,
         m.race_started_at,
         (select jsonb_agg(jsonb_build_object('skill_id', pc2.skill_id, 'last_used_turn', pc2.last_used_turn, 'extra_cooldown', pc2.extra_cooldown))
          from pvp_cooldowns pc2
          where pc2.match_id = m.id and pc2.player_id = v_player_id),
         m.updated_at,
         m.turn_deadline,
         (coalesce(case when m.player1_id = v_player_id then m.player2_used_skill_ids else m.player1_used_skill_ids end, '{}'::uuid[])),
         (select coalesce(array_agg(cs.skill_id), '{}'::uuid[])
          from player_characters pc
          join character_skills cs on cs.character_id = pc.character_id
          join skills sk on sk.id = cs.skill_id
          where pc.id = case when m.player1_id = v_player_id then m.player2_character_id else m.player1_character_id end
            and sk.type = 'defense'),
         (select cs.skill_id
          from player_characters pc
          join character_skills cs on cs.character_id = pc.character_id
          where pc.id = case when m.player1_id = v_player_id then m.player2_character_id else m.player1_character_id end
            and cs.slot = 1
          limit 1) as opponent_first_skill_id,
         m.player1_absorb_mode, m.player2_absorb_mode,
         m.player1_absorb_hits, m.player2_absorb_hits,
         m.player1_temp_atk, m.player2_temp_atk,
         m.player1_temp_hp, m.player2_temp_hp,
         m.player1_extra_turns, m.player2_extra_turns,
         coalesce(m.player1_poison_damage, 0), coalesce(m.player1_poison_turns, 0),
         coalesce(m.player2_poison_damage, 0), coalesce(m.player2_poison_turns, 0),
         coalesce(m.turn_sub, 0),
         m.p1_comp_id, m.p1_comp_char_id, coalesce(m.p1_comp_name, ''), m.p1_comp_image,
         coalesce(m.p1_comp_alive, false), coalesce(m.p1_comp_hp, 0), coalesce(m.p1_comp_max_hp, 0), coalesce(m.p1_comp_turns_taken, 0),
         coalesce(m.p1_comp_used_skill_ids, '{}'::uuid[]), coalesce(m.p1_comp_sealed_skill_ids, '{}'::uuid[]),
         coalesce(m.p1_comp_temp_atk, 0), coalesce(m.p1_comp_temp_hp, 0), coalesce(m.p1_comp_extra_turns, 0),
         coalesce(m.p1_comp_frozen_turns, 0), coalesce(m.p1_comp_defending, false), coalesce(m.p1_comp_shield_charges, 0),
         coalesce(m.p1_comp_absorb_hits, 0), coalesce(m.p1_comp_reflect_multiplier, 0),
         coalesce(m.p1_comp_poison_damage, 0), coalesce(m.p1_comp_poison_turns, 0),
         m.p2_comp_id, m.p2_comp_char_id, coalesce(m.p2_comp_name, ''), m.p2_comp_image,
         coalesce(m.p2_comp_alive, false), coalesce(m.p2_comp_hp, 0), coalesce(m.p2_comp_max_hp, 0), coalesce(m.p2_comp_turns_taken, 0),
         coalesce(m.p2_comp_used_skill_ids, '{}'::uuid[]), coalesce(m.p2_comp_sealed_skill_ids, '{}'::uuid[]),
         coalesce(m.p2_comp_temp_atk, 0), coalesce(m.p2_comp_temp_hp, 0), coalesce(m.p2_comp_extra_turns, 0),
         coalesce(m.p2_comp_frozen_turns, 0), coalesce(m.p2_comp_defending, false), coalesce(m.p2_comp_shield_charges, 0),
         coalesce(m.p2_comp_absorb_hits, 0), coalesce(m.p2_comp_reflect_multiplier, 0),
         coalesce(m.p2_comp_poison_damage, 0), coalesce(m.p2_comp_poison_turns, 0)
  from pvp_matches m
  left join player_characters pc1 on pc1.id = m.player1_character_id
  left join characters c1 on c1.id = pc1.character_id
  left join player_characters pc2 on pc2.id = m.player2_character_id
  left join characters c2 on c2.id = pc2.character_id
  where m.id = p_match_id
    and (m.player1_id = v_player_id or m.player2_id = v_player_id);
end; $function$;