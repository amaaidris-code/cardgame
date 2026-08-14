-- The "ready defense survives a killing blow" rescue in pvp_use_skill only
-- considered applied_dmg. A lethal hit dealt by REFLECTED damage therefore
-- killed the opponent even when they had a defense/reflect skill ready.
-- Now reflected lethal damage also triggers the rescue, unless the reflect
-- skill is "انعكاس لا يُصدّ" (unblockable_reflect) which cannot be blocked.
CREATE OR REPLACE FUNCTION public.pvp_use_skill(p_token text, p_match_id uuid, p_skill_id uuid)
RETURNS TABLE(status text, winner_id uuid, player1_hp integer, player2_hp integer)
AS $fn$
declare
    v_player_id uuid;
    v_match record;
    v_skill record;
    v_is_p1 boolean;
    v_caller_char_id uuid;
    v_caller_turns integer;
    v_opponent_id uuid;
    v_owns_skill boolean;
    v_eff_damage integer;
    v_self pvp_fighter_state;
    v_opp  pvp_fighter_state;
    v_out  pvp_effect_out;
    v_next_turn uuid;
    v_poison_dmg int;
    v_poison_turns_remaining int;
begin
    v_player_id := player_id_from_token(p_token);

    select * into v_match from pvp_matches where id = p_match_id for update;

    if v_match.id is null then raise exception 'المباراة غير موجودة'; end if;
    if v_match.status != 'active' then raise exception 'المباراة غير نشطة الآن'; end if;
    if v_match.player1_id != v_player_id and v_match.player2_id != v_player_id then
        raise exception 'لست طرفًا في هذه المباراة';
    end if;
    if v_match.turn_player_id != v_player_id then raise exception 'ليس دورك الآن'; end if;

    v_is_p1 := (v_match.player1_id = v_player_id);

    if (v_is_p1 and coalesce(v_match.player1_frozen_turns, 0) > 0)
       or (not v_is_p1 and coalesce(v_match.player2_frozen_turns, 0) > 0) then
        raise exception 'أنت مجمد ولا تستطيع الحركة هذا الدور';
    end if;

    -- تطبيق سُم على الخصم في بداية الدور قبل أي شيء آخر
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
            player1_used_skill_ids = case when p_skill_id = any(player1_used_skill_ids)
                then player1_used_skill_ids else array_append(player1_used_skill_ids, p_skill_id) end,
            player1_hp = v_self.hp,
            player2_hp = v_opp.hp,
            player2_frozen_turns = v_opp.frozen_turns,
            turn_player_id = v_next_turn,
            turn_deadline = now() + interval '60 seconds',
            updated_at = now()
        where id = p_match_id;
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
            player1_defending = v_opp.defending,
            player1_shield_charges = v_opp.shield_charges,
            player1_reflect_multiplier = v_opp.reflect_mult,
            player1_absorb_mode = v_opp.absorb_mode,
            player1_absorb_hits = v_opp.absorb_hits,
            player1_temp_atk = v_opp.temp_atk,
            player1_temp_hp = v_opp.temp_hp,
            player1_extra_turns = v_opp.extra_turns,
            player1_max_hp = v_opp.max_hp,
            player1_last_hit_hp_before = v_opp.last_hp_before,
            player1_last_hit_damage = v_opp.last_damage,
            player1_last_hit_consumed = v_opp.last_consumed,
            player1_poison_damage = v_opp.poison_damage,
            player1_poison_turns = v_opp.poison_turns,
            player2_used_skill_ids = case when p_skill_id = any(player2_used_skill_ids)
                then player2_used_skill_ids else array_append(player2_used_skill_ids, p_skill_id) end,
            player2_hp = v_self.hp,
            player1_hp = v_opp.hp,
            player1_frozen_turns = v_opp.frozen_turns,
            turn_player_id = v_next_turn,
            turn_deadline = now() + interval '60 seconds',
            updated_at = now()
        where id = p_match_id;
    end if;

    -- ضربة قاتلة: إن كان لدى الخصم دفاع جاهز (مهارة دفاع أو انعكاس) يعيش الدور
    -- ويصبح عليه الدفاع، بشرط أن تكون الضربة قابلة للصدّ:
    --   - لضرر مباشر: المهارة غير لا-تُصدّ (unblockable)
    --   - لضرر منعكس: الانعكاس نفسه غير لا-تُصدّ (unblockable_reflect)
    if v_opp.hp <= 0 then
        if ( (coalesce(v_out.applied_dmg, 0) > 0 AND not coalesce(v_skill.unblockable, false))
             OR (coalesce(v_out.reflected_dmg, 0) > 0
                 AND not coalesce(v_skill.unblockable, false)
                 AND not coalesce((v_skill.params->>'unblockable_reflect')::boolean, false))
           )
           and public.pvp_has_ready_defense(
                case when v_is_p1 then v_match.player2_character_id else v_match.player1_character_id end,
                case when v_is_p1 then v_match.player2_sealed_skill_ids else v_match.player1_sealed_skill_ids end,
                case when v_is_p1 then v_match.player2_turns_taken else v_match.player1_turns_taken end,
                p_match_id,
                v_opponent_id
           ) then
            null;
        else
            update pvp_matches set status = 'finished', winner_id = v_player_id, turn_player_id = null, turn_deadline = null, updated_at = now()
            where id = p_match_id;
        end if;
    elsif v_self.hp <= 0 then
        update pvp_matches set status = 'finished', winner_id = v_opponent_id, turn_player_id = null, turn_deadline = null, updated_at = now()
        where id = p_match_id;
    end if;

    select m.status, m.winner_id, m.player1_hp, m.player2_hp into v_match
    from pvp_matches m where m.id = p_match_id;

    return query select v_match.status, v_match.winner_id, v_match.player1_hp, v_match.player2_hp;
end;
$fn$
LANGUAGE plpgsql;
