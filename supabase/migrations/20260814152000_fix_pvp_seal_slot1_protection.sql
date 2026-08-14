-- Fix slot-1 seal protection in pvp_seal_or_unseal_skill.
--
-- BUG: the slot lookup compared character_skills.character_id directly
-- against v_opp_char_id. But v_opp_char_id is a player_characters.id
-- (pvp_matches.playerN_character_id), while character_skills.character_id
-- is a characters.id. The two never matched, so v_target_slot was always
-- NULL and a protected slot-1 skill could be sealed.
--
-- FIX: resolve the opponent's character via player_characters first, then
-- look up the slot in character_skills by that character id.
--
-- NOTE: CREATE OR REPLACE FUNCTION resets SECURITY DEFINER to the default,
-- so we re-declare SECURITY DEFINER + hardened search_path (matching the
-- pattern used in 20260814023454_restore_pvp_use_skill_security_definer.sql).
CREATE OR REPLACE FUNCTION public.pvp_seal_or_unseal_skill(p_token text, p_match_id uuid, p_ability_skill_id uuid, p_target_skill_id uuid)
 RETURNS TABLE(status text, winner_id uuid, player1_hp integer, player2_hp integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
    v_player_id uuid;
    v_match record;
    v_ability record;
    v_target_skill record;
    v_is_p1 boolean;
    v_caller_char_id uuid;
    v_opp_char_id uuid;
    v_caller_turns integer;
    v_opponent_id uuid;
    v_owns_ability boolean;
    v_opp_owns_target boolean;
    v_opp_used_skills uuid[];
    v_sealed_ids uuid[];
    v_opp_frozen_turns integer;
    v_next_turn uuid;
  v_target_slot integer;
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

    if v_is_p1 then
        v_caller_char_id := v_match.player1_character_id;
        v_opp_char_id := v_match.player2_character_id;
        v_caller_turns := v_match.player1_turns_taken;
        v_opponent_id := v_match.player2_id;
        v_opp_used_skills := v_match.player2_used_skill_ids;
        v_sealed_ids := v_match.player1_sealed_skill_ids;
        v_opp_frozen_turns := coalesce(v_match.player2_frozen_turns, 0);
    else
        v_caller_char_id := v_match.player2_character_id;
        v_opp_char_id := v_match.player1_character_id;
        v_caller_turns := v_match.player2_turns_taken;
        v_opponent_id := v_match.player1_id;
        v_opp_used_skills := v_match.player1_used_skill_ids;
        v_sealed_ids := v_match.player2_sealed_skill_ids;
        v_opp_frozen_turns := coalesce(v_match.player1_frozen_turns, 0);
    end if;

    select exists(
        select 1 from player_characters pc
        join character_skills cs on cs.character_id = pc.character_id
        where pc.id = v_caller_char_id and cs.skill_id = p_ability_skill_id
    ) into v_owns_ability;

    if not v_owns_ability
       and not public.pvp_is_summonable_shadow_skill(p_ability_skill_id, v_player_id) then
        raise exception 'هذه المهارة ليست من مهاراتك';
    end if;

    select * into v_ability from skills where id = p_ability_skill_id;

    if v_ability.effect not in ('seal', 'unseal') then
        raise exception 'هذه المهارة ليست مهارة ختم أو فك ختم';
    end if;

    if public.pvp_skill_remaining_cd(p_match_id, v_player_id, p_ability_skill_id, v_ability.cooldown, v_caller_turns) > 0 then
        raise exception 'المهارة ما زالت في التهدئة';
    end if;

    if v_ability.effect = 'seal' then
        select * into v_target_skill from skills where id = p_target_skill_id;

        if not (p_target_skill_id = any(v_opp_used_skills))
           and v_target_skill.type != 'defense' then
            raise exception 'لا يمكن ختم مهارة لم يستخدمها الخصم في هذه المباراة';
        end if;

        select exists(
            select 1 from player_characters pc
            join character_skills cs on cs.character_id = pc.character_id
            where pc.id = v_opp_char_id and cs.skill_id = p_target_skill_id
        ) into v_opp_owns_target;

        -- resolve the opponent's character through player_characters, then
        -- read the skill slot from character_skills (by character id)
        select cs.slot into v_target_slot
        from player_characters pc
        join character_skills cs on cs.character_id = pc.character_id
        where pc.id = v_opp_char_id and cs.skill_id = p_target_skill_id
        limit 1;
        if coalesce(v_target_slot,0) = 1 then
          raise exception 'لا يمكن ختم المهارة الأولى للشخصية';
        end if;
        if not v_opp_owns_target then raise exception 'الخصم لا يملك هذه المهارة'; end if;

        if p_target_skill_id = any(v_match.player2_sealed_skill_ids)
           or p_target_skill_id = any(v_match.player1_sealed_skill_ids) then
            raise exception 'هذه المهارة مختومة مسبقًا';
        end if;
    else
        if not (p_target_skill_id = any(v_sealed_ids)) then
            raise exception 'لا يمكن فك ختم مهارة غير مختومة';
        end if;
    end if;

    v_caller_turns := v_caller_turns + 1;

    if v_ability.cooldown > 0 then
        insert into pvp_cooldowns(match_id, player_id, skill_id, last_used_turn, extra_cooldown)
        values (p_match_id, v_player_id, p_ability_skill_id, v_caller_turns, 0)
        on conflict (match_id, player_id, skill_id)
        do update set last_used_turn = excluded.last_used_turn;
    end if;

    insert into revealed_skills(owner_id, viewer_player_id, skill_id, battle_id)
    values (v_player_id, v_opponent_id, p_ability_skill_id, p_match_id)
    on conflict (owner_id, viewer_player_id, skill_id) do nothing;

    if v_ability.effect = 'seal' then
        insert into revealed_skills(owner_id, viewer_player_id, skill_id, battle_id)
        values (v_opponent_id, v_player_id, p_target_skill_id, p_match_id)
        on conflict (owner_id, viewer_player_id, skill_id) do nothing;
    else
        insert into revealed_skills(owner_id, viewer_player_id, skill_id, battle_id)
        values (v_player_id, v_opponent_id, p_target_skill_id, p_match_id)
        on conflict (owner_id, viewer_player_id, skill_id) do nothing;
    end if;

    if v_opp_frozen_turns > 0 then
        v_next_turn := v_player_id;
        v_opp_frozen_turns := v_opp_frozen_turns - 1;
    else
        v_next_turn := v_opponent_id;
    end if;

    if v_is_p1 then
        update pvp_matches set
            player1_turns_taken = v_caller_turns,
            player1_defending = false,
            player1_last_hit_consumed = true,
            player2_last_hit_hp_before = v_match.player2_hp,
            player2_last_hit_damage = 0,
            player2_last_hit_consumed = true,
            player1_sealed_skill_ids = case when v_ability.effect = 'unseal'
                then array_remove(player1_sealed_skill_ids, p_target_skill_id)
                else player1_sealed_skill_ids end,
            player2_sealed_skill_ids = case when v_ability.effect = 'seal'
                then player2_sealed_skill_ids || array[p_target_skill_id]
                else player2_sealed_skill_ids end,
            player2_frozen_turns = v_opp_frozen_turns,
            player1_used_skill_ids = case when p_ability_skill_id = any(player1_used_skill_ids)
                then player1_used_skill_ids else array_append(player1_used_skill_ids, p_ability_skill_id) end,
            turn_player_id = v_next_turn,
            turn_deadline = now() + interval '60 seconds',
            updated_at = now()
        where id = p_match_id;
    else
        update pvp_matches set
            player2_turns_taken = v_caller_turns,
            player2_defending = false,
            player2_last_hit_consumed = true,
            player1_last_hit_hp_before = v_match.player1_hp,
            player1_last_hit_damage = 0,
            player1_last_hit_consumed = true,
            player2_sealed_skill_ids = case when v_ability.effect = 'unseal'
                then array_remove(player2_sealed_skill_ids, p_target_skill_id)
                else player2_sealed_skill_ids end,
            player1_sealed_skill_ids = case when v_ability.effect = 'seal'
                then player1_sealed_skill_ids || array[p_target_skill_id]
                else player1_sealed_skill_ids end,
            player1_frozen_turns = v_opp_frozen_turns,
            player2_used_skill_ids = case when p_ability_skill_id = any(player2_used_skill_ids)
                then player2_used_skill_ids else array_append(player2_used_skill_ids, p_ability_skill_id) end,
            turn_player_id = v_next_turn,
            turn_deadline = now() + interval '60 seconds',
            updated_at = now()
        where id = p_match_id;
    end if;

    select m.status, m.winner_id, m.player1_hp, m.player2_hp into v_match
    from pvp_matches m where m.id = p_match_id;

    return query select v_match.status, v_match.winner_id, v_match.player1_hp, v_match.player2_hp;
end;
 $function$