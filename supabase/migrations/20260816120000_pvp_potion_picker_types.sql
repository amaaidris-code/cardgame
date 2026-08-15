-- ============================================================
-- PvP: potion embedded skill with a "picker" type (steal/copy/
-- control/seal/unseal/delay_cooldown/shadow) acts EXACTLY like
-- the real skill of that type. Because these types need a real
-- target skill (or character+skill for shadow), they cannot use
-- pvp_use_potion (which has no target). So we add new RPCs that
-- treat the potion itself as the "ability": consume the potion,
-- validate target exactly like the real picker RPC, apply the
-- effect, and advance the turn (picker skills consume the turn).
-- ============================================================

-- ------------------------------------------------------------
-- pvp_use_potion_target: steal / copy / control / seal /
-- unseal / delay_cooldown (needs a single p_target_skill_id)
-- ------------------------------------------------------------
create or replace function public.pvp_use_potion_target(
    p_token text,
    p_match_id uuid,
    p_potion_id uuid,
    p_target_skill_id uuid
) returns table(status text, winner_id uuid, player1_hp integer, player2_hp integer)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
    v_player_id uuid;
    v_match record;
    v_potion record;
    v_type text;
    v_effect text;
    v_unblockable boolean;
    v_params jsonb;
    v_damage integer;
    v_is_p1 boolean;
    v_caller_char_id uuid;
    v_caller_turns integer;
    v_opponent_id uuid;
    v_opp_char_id uuid;
    v_opp_used_skills uuid[];
    v_my_sealed uuid[];
    v_opp_sealed uuid[];
    v_opp_frozen_turns integer;
    v_self_extra_turns integer;
    v_next_turn uuid;
    v_target record;
    v_target_cd integer;
    v_eff_damage integer;
    v_self pvp_fighter_state;
    v_opp  pvp_fighter_state;
    v_out  pvp_effect_out;
    v_delay integer;
    v_victory boolean;
    v_poison_dmg int;
    v_poison_turns_remaining int;
begin
    v_player_id := player_id_from_token(p_token);
    if v_player_id is null then raise exception 'غير مصرح'; end if;

    -- وجهة مداخلة الجرع (استخدام جرعة واحدة لكل دور)
    if not exists(
        select 1 from pvp_matches m
        where m.id = p_match_id and m.turn_player_id = v_player_id and m.status = 'active'
    ) then raise exception 'ليس دورك الآن'; end if;

    select * into v_match from pvp_matches where id = p_match_id for update;
    if v_match.id is null then raise exception 'المباراة غير موجودة'; end if;

    if v_match.player1_id != v_player_id and v_match.player2_id != v_player_id then
        raise exception 'لست طرفًا في هذه المباراة';
    end if;

    if (v_match.player1_id = v_match.player2_id) then raise exception 'مباراة غير صالحة'; end if;

    v_is_p1 := (v_match.player1_id = v_player_id);

    if v_is_p1 then
        v_caller_char_id := v_match.player1_character_id;
        v_caller_turns := coalesce(v_match.player1_turns_taken, 0);
        v_opponent_id := v_match.player2_id;
        v_opp_char_id := v_match.player2_character_id;
        v_opp_used_skills := v_match.player2_used_skill_ids;
        v_my_sealed := coalesce(v_match.player1_sealed_skill_ids, '{}');
        v_opp_sealed := coalesce(v_match.player2_sealed_skill_ids, '{}');
        v_opp_frozen_turns := coalesce(v_match.player2_frozen_turns, 0);
        v_self_extra_turns := coalesce(v_match.player1_extra_turns, 0);
        v_poison_dmg := coalesce(v_match.player2_poison_damage, 0);
        v_poison_turns_remaining := coalesce(v_match.player2_poison_turns, 0);
    else
        v_caller_char_id := v_match.player2_character_id;
        v_caller_turns := coalesce(v_match.player2_turns_taken, 0);
        v_opponent_id := v_match.player1_id;
        v_opp_char_id := v_match.player1_character_id;
        v_opp_used_skills := v_match.player1_used_skill_ids;
        v_my_sealed := coalesce(v_match.player2_sealed_skill_ids, '{}');
        v_opp_sealed := coalesce(v_match.player1_sealed_skill_ids, '{}');
        v_opp_frozen_turns := coalesce(v_match.player1_frozen_turns, 0);
        v_self_extra_turns := coalesce(v_match.player2_extra_turns, 0);
        v_poison_dmg := coalesce(v_match.player1_poison_damage, 0);
        v_poison_turns_remaining := coalesce(v_match.player1_poison_turns, 0);
    end if;

    if v_poison_dmg > 0 and v_poison_turns_remaining > 0 then
        if v_is_p1 then
            v_match.player2_hp := greatest(0, v_match.player2_hp - v_poison_dmg);
            v_match.player2_poison_turns := v_poison_turns_remaining - 1;
            if v_match.player2_poison_turns <= 0 then
                v_match.player2_poison_damage := 0;
                v_match.player2_poison_turns := 0;
            end if;
        else
            v_match.player1_hp := greatest(0, v_match.player1_hp - v_poison_dmg);
            v_match.player1_poison_turns := v_poison_turns_remaining - 1;
            if v_match.player1_poison_turns <= 0 then
                v_match.player1_poison_damage := 0;
                v_match.player1_poison_turns := 0;
            end if;
        end if;
    end if;

    -- بناء حالة المقاتلين (pvp_fighter_state) قبل تطبيق أي مفعول
    if v_is_p1 then
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

    -- استهلاك الجرعة
    update public.player_potions set quantity = quantity - 1
     where player_id = v_player_id and potion_id = p_potion_id and quantity > 0;
    if not found then raise exception 'لا تملك هذه الجرعة'; end if;

    select * into v_potion from public.potions po where po.id = p_potion_id;

    v_type := public.potion_skill_fields(v_potion.effect_skill_type)->>'type';
    v_effect := nullif(public.potion_skill_fields(v_potion.effect_skill_type)->>'effect','null');
    v_unblockable := (public.potion_skill_fields(v_potion.effect_skill_type)->>'unblockable')::boolean;
    v_params := public.potion_skill_params(v_potion.effect_skill_type);
    v_damage := coalesce(v_potion.effect_value, 0)::int;

    select * into v_target from skills where id = p_target_skill_id;
    if v_target.id is null then raise exception 'المهارة المستهدفة غير موجودة'; end if;

    -- ---------- steal / copy ----------
    if v_effect in ('steal', 'copy') then
        if not (p_target_skill_id = any(v_opp_used_skills))
           and not exists(
               select 1 from revealed_skills r
               where r.owner_id = v_opponent_id and r.viewer_player_id = v_player_id
                 and r.skill_id = p_target_skill_id
           ) then
            raise exception 'لا يمكن سرقة/نسخ مهارة لم يكشفها الخصم لك في أي نزال';
        end if;
        if v_target.effect in ('steal', 'copy', 'control', 'shadow', 'delay_cooldown') then
            raise exception 'لا يمكن سرقة/نسخ هذه المهارة';
        end if;
        v_eff_damage := v_target.damage;
        if v_target.type in ('attack','special') and (v_target.effect is null or v_target.effect = '') then
            v_eff_damage := coalesce(public.pvp_scaled_attack_damage(v_caller_char_id, p_target_skill_id), v_target.damage);
        end if;
        v_out := public.pvp_apply_effect(
            v_target.type, v_target.effect, v_eff_damage,
            coalesce(v_target.unblockable, false), v_target.params, v_self, v_opp, false);
        v_self := v_out.self;
        v_opp := v_out.opp;
        if v_out.heal > 0 then v_self.hp := least(v_self.max_hp, v_self.hp + v_out.heal); end if;
        if v_target.type = 'defense' then
            v_self.defending := true;
            v_self.shield_charges := greatest(0, v_out.endurance_hits - 1);
        else
            v_self.defending := false;
        end if;
        v_opp.defending := v_out.blocked and v_opp.shield_charges > 0;

    -- ---------- control ----------
    elsif v_effect = 'control' then
        if not (p_target_skill_id = any(v_opp_used_skills))
           and not exists(
               select 1 from revealed_skills r
               where r.owner_id = v_opponent_id and r.viewer_player_id = v_player_id
                 and r.skill_id = p_target_skill_id
           ) then
            raise exception 'لا يمكن السيطرة على مهارة لم يكشفها الخصم لك في أي نزال';
        end if;
        if v_target.effect in ('steal','copy','control','shadow','delay_cooldown') then
            raise exception 'لا يمكن السيطرة على هذه المهارة';
        end if;
        v_target_cd := coalesce(v_target.cooldown, 0);
        if public.pvp_skill_remaining_cd(p_match_id, v_player_id, p_target_skill_id, v_target_cd, v_caller_turns) > 0 then
            raise exception 'المهارة المستهدفة ما زالت في تهدئة عندك';
        end if;
        v_eff_damage := v_target.damage;
        if v_target.type in ('attack','special') and (v_target.effect is null or v_target.effect = '') then
            v_eff_damage := coalesce(public.pvp_scaled_attack_damage(v_caller_char_id, p_target_skill_id), v_target.damage);
        end if;
        v_out := public.pvp_apply_effect(
            v_target.type, v_target.effect, v_eff_damage,
            coalesce(v_target.unblockable, false), v_target.params, v_self, v_opp, false);
        v_self := v_out.self;
        v_opp := v_out.opp;
        if v_out.heal > 0 then v_self.hp := least(v_self.max_hp, v_self.hp + v_out.heal); end if;
        if v_target.type = 'defense' then
            v_self.defending := true;
            v_self.shield_charges := greatest(0, v_out.endurance_hits - 1);
        else
            v_self.defending := false;
        end if;
        v_opp.defending := v_out.blocked and v_opp.shield_charges > 0;
        if v_target_cd > 0 then
            insert into pvp_cooldowns(match_id, player_id, skill_id, last_used_turn, extra_cooldown)
            values (p_match_id, v_player_id, p_target_skill_id, v_caller_turns + 1, 0)
            on conflict (match_id, player_id, skill_id)
            do update set last_used_turn = excluded.last_used_turn;
        end if;

    -- ---------- seal / unseal ----------
    elsif v_effect in ('seal', 'unseal') then
        v_self.defending := false;
        if v_effect = 'seal' then
            if not (p_target_skill_id = any(v_opp_used_skills)) and v_target.type != 'defense' then
                raise exception 'لا يمكن ختم مهارة لم يستخدمها الخصم في هذه المباراة';
            end if;
            if not exists(
                select 1 from player_characters pc
                join character_skills cs on cs.character_id = pc.character_id
                where pc.id = v_opp_char_id and cs.skill_id = p_target_skill_id
            ) then raise exception 'الخصم لا يملك هذه المهارة'; end if;
            if p_target_skill_id = any(v_opp_sealed) then raise exception 'هذه المهارة مختومة مسبقًا'; end if;
        else
            if not (p_target_skill_id = any(v_my_sealed)) then
                raise exception 'لا يمكن فك ختم مهارة غير مختومة';
            end if;
        end if;

    -- ---------- delay_cooldown ----------
    elsif v_effect = 'delay_cooldown' then
        if exists(
            select 1 from player_characters pc
            join character_skills cs on cs.character_id = pc.character_id
            join skills s on s.id = cs.skill_id
            where pc.id = v_opp_char_id and s.id = p_target_skill_id
        ) then
            null;
        else
            raise exception 'الخصم لا يملك هذه المهارة';
        end if;
        if v_is_p1 then
            if p_target_skill_id = any(v_match.player2_sealed_skill_ids) then
                raise exception 'لا يمكن تأجيل مهارة مختومة';
            end if;
        else
            if p_target_skill_id = any(v_match.player1_sealed_skill_ids) then
                raise exception 'لا يمكن تأجيل مهارة مختومة';
            end if;
        end if;
        v_delay := greatest(1, coalesce(v_damage, coalesce(v_potion.effect_value, 1)::int, 1));
        v_target_cd := coalesce(v_target.cooldown, 0);
        if exists(select 1 from pvp_cooldowns where match_id = p_match_id and player_id = v_opponent_id and skill_id = p_target_skill_id) then
            update pvp_cooldowns set extra_cooldown = extra_cooldown + v_delay
            where match_id = p_match_id and player_id = v_opponent_id and skill_id = p_target_skill_id;
        else
            insert into pvp_cooldowns(match_id, player_id, skill_id, last_used_turn, extra_cooldown)
            values (p_match_id, v_opponent_id, p_target_skill_id, v_caller_turns, greatest(0, v_delay - v_target_cd));
        end if;

    else
        raise exception 'نوع جرعة غير مدعوم لهذه العملية';
    end if;

    -- استهلاك الدور (مهارات الاختيار تستهلك الدور مثل المهارات الأصلية)
    v_caller_turns := v_caller_turns + 1;

    -- إفصاح عن الجرعة (المهارة المعبّرة عنها) للمهارات قائمة على مهارة الهدف
    if v_effect in ('steal', 'copy', 'control') then
        insert into revealed_skills(owner_id, viewer_player_id, skill_id, battle_id)
        values (v_player_id, v_opponent_id, p_target_skill_id, p_match_id)
        on conflict (owner_id, viewer_player_id, skill_id) do nothing;
    elsif v_effect = 'seal' then
        insert into revealed_skills(owner_id, viewer_player_id, skill_id, battle_id)
        values (v_opponent_id, v_player_id, p_target_skill_id, p_match_id)
        on conflict (owner_id, viewer_player_id, skill_id) do nothing;
    elsif v_effect = 'unseal' then
        insert into revealed_skills(owner_id, viewer_player_id, skill_id, battle_id)
        values (v_player_id, v_opponent_id, p_target_skill_id, p_match_id)
        on conflict (owner_id, viewer_player_id, skill_id) do nothing;
    end if;

    if v_opp_frozen_turns > 0 then
        v_opp_frozen_turns := v_opp_frozen_turns - 1;
        v_next_turn := v_player_id;
    elsif v_self_extra_turns > 0 then
        v_self_extra_turns := v_self_extra_turns - 1;
        v_next_turn := v_player_id;
    else
        v_next_turn := v_opponent_id;
    end if;

    if v_is_p1 then
        update pvp_matches set
            player1_turns_taken = v_caller_turns,
            player1_defending = coalesce(v_self.defending, false),
            player1_shield_charges = coalesce(v_self.shield_charges, 0),
            player1_reflect_multiplier = coalesce(v_self.reflect_mult, 0),
            player1_absorb_mode = v_self.absorb_mode,
            player1_absorb_hits = coalesce(v_self.absorb_hits, 0),
            player1_temp_atk = coalesce(v_self.temp_atk, 0),
            player1_temp_hp = coalesce(v_self.temp_hp, 0),
            player1_extra_turns = v_self_extra_turns,
            player1_max_hp = v_self.max_hp,
            player1_last_hit_hp_before = coalesce(v_self.last_hp_before, v_match.player1_hp),
            player1_last_hit_damage = coalesce(v_self.last_damage, 0),
            player1_last_hit_consumed = coalesce(v_self.last_consumed, true),
            player1_poison_damage = coalesce(v_self.poison_damage, 0),
            player1_poison_turns = coalesce(v_self.poison_turns, 0),
            player1_sealed_skill_ids = case when v_effect = 'unseal'
                then array_remove(player1_sealed_skill_ids, p_target_skill_id)
                else player1_sealed_skill_ids end,
            player2_sealed_skill_ids = case when v_effect = 'seal'
                then coalesce(player2_sealed_skill_ids, '{}') || array[p_target_skill_id]
                else player2_sealed_skill_ids end,
            player1_last_potion_turn = v_caller_turns,
            player2_defending = coalesce(v_opp.defending, false),
            player2_shield_charges = coalesce(v_opp.shield_charges, v_match.player2_shield_charges),
            player2_reflect_multiplier = coalesce(v_opp.reflect_mult, v_match.player2_reflect_multiplier),
            player2_absorb_mode = v_opp.absorb_mode,
            player2_absorb_hits = coalesce(v_opp.absorb_hits, v_match.player2_absorb_hits),
            player2_temp_atk = coalesce(v_opp.temp_atk, v_match.player2_temp_atk),
            player2_temp_hp = coalesce(v_opp.temp_hp, v_match.player2_temp_hp),
            player2_extra_turns = coalesce(v_opp.extra_turns, v_match.player2_extra_turns),
            player2_last_hit_hp_before = coalesce(v_opp.last_hp_before, v_match.player2_hp),
            player2_last_hit_damage = coalesce(v_opp.last_damage, 0),
            player2_last_hit_consumed = coalesce(v_opp.last_consumed, true),
            player2_poison_damage = coalesce(v_opp.poison_damage, 0),
            player2_poison_turns = coalesce(v_opp.poison_turns, 0),
            player1_hp = coalesce(v_self.hp, v_match.player1_hp),
            player2_hp = coalesce(v_opp.hp, v_match.player2_hp),
            player2_frozen_turns = v_opp_frozen_turns,
            turn_player_id = v_next_turn,
            turn_deadline = now() + interval '60 seconds',
            updated_at = now()
        where id = p_match_id;
    else
        update pvp_matches set
            player2_turns_taken = v_caller_turns,
            player2_defending = coalesce(v_self.defending, false),
            player2_shield_charges = coalesce(v_self.shield_charges, 0),
            player2_reflect_multiplier = coalesce(v_self.reflect_mult, 0),
            player2_absorb_mode = v_self.absorb_mode,
            player2_absorb_hits = coalesce(v_self.absorb_hits, 0),
            player2_temp_atk = coalesce(v_self.temp_atk, 0),
            player2_temp_hp = coalesce(v_self.temp_hp, 0),
            player2_extra_turns = v_self_extra_turns,
            player2_max_hp = v_self.max_hp,
            player2_last_hit_hp_before = coalesce(v_self.last_hp_before, v_match.player2_hp),
            player2_last_hit_damage = coalesce(v_self.last_damage, 0),
            player2_last_hit_consumed = coalesce(v_self.last_consumed, true),
            player2_poison_damage = coalesce(v_self.poison_damage, 0),
            player2_poison_turns = coalesce(v_self.poison_turns, 0),
            player2_sealed_skill_ids = case when v_effect = 'unseal'
                then array_remove(player2_sealed_skill_ids, p_target_skill_id)
                else player2_sealed_skill_ids end,
            player1_sealed_skill_ids = case when v_effect = 'seal'
                then coalesce(player1_sealed_skill_ids, '{}') || array[p_target_skill_id]
                else player1_sealed_skill_ids end,
            player2_last_potion_turn = v_caller_turns,
            player1_defending = coalesce(v_opp.defending, false),
            player1_shield_charges = coalesce(v_opp.shield_charges, v_match.player1_shield_charges),
            player1_reflect_multiplier = coalesce(v_opp.reflect_mult, v_match.player1_reflect_multiplier),
            player1_absorb_mode = v_opp.absorb_mode,
            player1_absorb_hits = coalesce(v_opp.absorb_hits, v_match.player1_absorb_hits),
            player1_temp_atk = coalesce(v_opp.temp_atk, v_match.player1_temp_atk),
            player1_temp_hp = coalesce(v_opp.temp_hp, v_match.player1_temp_hp),
            player1_extra_turns = coalesce(v_opp.extra_turns, v_match.player1_extra_turns),
            player1_last_hit_hp_before = coalesce(v_opp.last_hp_before, v_match.player1_hp),
            player1_last_hit_damage = coalesce(v_opp.last_damage, 0),
            player1_last_hit_consumed = coalesce(v_opp.last_consumed, true),
            player1_poison_damage = coalesce(v_opp.poison_damage, 0),
            player1_poison_turns = coalesce(v_opp.poison_turns, 0),
            player2_hp = coalesce(v_self.hp, v_match.player2_hp),
            player1_hp = coalesce(v_opp.hp, v_match.player1_hp),
            player1_frozen_turns = v_opp_frozen_turns,
            turn_player_id = v_next_turn,
            turn_deadline = now() + interval '60 seconds',
            updated_at = now()
        where id = p_match_id;
    end if;

    delete from public.player_potions where player_id = v_player_id and quantity <= 0;

    -- الحسم
    select m.status, m.winner_id, m.player1_hp, m.player2_hp into v_match
    from pvp_matches m where m.id = p_match_id;

    if v_match.player1_hp <= 0 then
        update pvp_matches set status = 'finished', winner_id = v_match.player2_id,
               turn_player_id = null, turn_deadline = null, updated_at = now()
        where id = p_match_id;
    elsif v_match.player2_hp <= 0 then
        update pvp_matches set status = 'finished', winner_id = v_match.player1_id,
               turn_player_id = null, turn_deadline = null, updated_at = now()
        where id = p_match_id;
    end if;

    select m.status, m.winner_id, m.player1_hp, m.player2_hp into v_match
    from pvp_matches m where m.id = p_match_id;

    return query select v_match.status, v_match.winner_id, v_match.player1_hp, v_match.player2_hp;
end;
$function$;
-- ------------------------------------------------------------
-- pvp_use_potion_shadow: shadow potion (needs character + skill)
-- Mirrors pvp_use_shadow, but consumes the potion as the source
-- of the shadow skill.
-- ------------------------------------------------------------
create or replace function public.pvp_use_potion_shadow(
    p_token text,
    p_match_id uuid,
    p_potion_id uuid,
    p_character_id uuid,
    p_skill_id uuid
) returns table(status text, winner_id uuid, player1_hp integer, player2_hp integer)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
    v_player_id uuid;
    v_match record;
    v_potion record;
    v_is_p1 boolean;
    v_caller_char_id uuid;
    v_caller_turns integer;
    v_opponent_id uuid;
    v_shadow_skill record;
    v_self pvp_fighter_state;
    v_opp  pvp_fighter_state;
    v_out  pvp_effect_out;
    v_next_turn uuid;
    v_poison_dmg int;
    v_poison_turns_remaining int;
begin
    v_player_id := player_id_from_token(p_token);
    if v_player_id is null then raise exception '��� ����'; end if;

    if not exists(
        select 1 from pvp_matches m
        where m.id = p_match_id and m.turn_player_id = v_player_id and m.status = 'active'
    ) then raise exception '��� ���� ����'; end if;

    select * into v_match from pvp_matches where id = p_match_id for update;
    if v_match.id is null then raise exception '�������� ��� ������'; end if;

    if v_match.player1_id != v_player_id and v_match.player2_id != v_player_id then
        raise exception '��� ����� �� ��� ��������';
    end if;

    v_is_p1 := (v_match.player1_id = v_player_id);

    if v_is_p1 then
        v_poison_dmg := coalesce(v_match.player2_poison_damage, 0);
        v_poison_turns_remaining := coalesce(v_match.player2_poison_turns, 0);
    else
        v_poison_dmg := coalesce(v_match.player1_poison_damage, 0);
        v_poison_turns_remaining := coalesce(v_match.player1_poison_turns, 0);
    end if;

    if v_poison_dmg > 0 and v_poison_turns_remaining > 0 then
        if v_is_p1 then
            v_match.player2_hp := greatest(0, v_match.player2_hp - v_poison_dmg);
            v_match.player2_poison_turns := v_poison_turns_remaining - 1;
            if v_match.player2_poison_turns <= 0 then
                v_match.player2_poison_damage := 0;
                v_match.player2_poison_turns := 0;
            end if;
        else
            v_match.player1_hp := greatest(0, v_match.player1_hp - v_poison_dmg);
            v_match.player1_poison_turns := v_poison_turns_remaining - 1;
            if v_match.player1_poison_turns <= 0 then
                v_match.player1_poison_damage := 0;
                v_match.player1_poison_turns := 0;
            end if;
        end if;
    end if;

    if v_is_p1 then
        v_caller_char_id := v_match.player1_character_id;
        v_caller_turns := coalesce(v_match.player1_turns_taken, 0);
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
        v_caller_turns := coalesce(v_match.player2_turns_taken, 0);
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

    -- ������� ������
    update public.player_potions set quantity = quantity - 1
     where player_id = v_player_id and potion_id = p_potion_id and quantity > 0;
    if not found then raise exception '�� ���� ��� ������'; end if;

    select * into v_potion from public.potions po where po.id = p_potion_id;

    if not exists(select 1 from shadow_eligible_characters where character_id = p_character_id)
       and not exists(
           select 1 from user_shadow_pool usp
           join players pl on pl.user_id = usp.user_id
           where pl.id = v_player_id and usp.shadow_character_id = p_character_id
       ) then
        raise exception '��� ������� ��� ����� ������ ����';
    end if;

    select s.* into v_shadow_skill
    from character_skills cs
    join skills s on s.id = cs.skill_id
    where cs.character_id = p_character_id and s.id = p_skill_id;

    if v_shadow_skill.id is null then raise exception '��� ������� ���� �� ������ �������'; end if;
    if v_shadow_skill.effect = 'shadow' then raise exception '�� ���� ������� �� ���� ��'; end if;

    v_out := public.pvp_apply_effect(
        v_shadow_skill.type, v_shadow_skill.effect, v_shadow_skill.damage,
        coalesce(v_shadow_skill.unblockable, false), v_shadow_skill.params, v_self, v_opp, false);

    v_self := v_out.self;
    v_opp  := v_out.opp;

    if v_out.heal > 0 then v_self.hp := least(v_self.max_hp, v_self.hp + v_out.heal); end if;

    if v_shadow_skill.type = 'defense' then
        v_self.defending := true;
        v_self.shield_charges := greatest(0, v_out.endurance_hits - 1);
    else
        v_self.defending := false;
    end if;
    v_opp.defending := v_out.blocked and v_opp.shield_charges > 0;

    v_caller_turns := v_caller_turns + 1;

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
            player1_last_potion_turn = v_caller_turns,
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
            player2_last_potion_turn = v_caller_turns,
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
            player2_hp = v_self.hp,
            player1_hp = v_opp.hp,
            player1_frozen_turns = v_opp.frozen_turns,
            turn_player_id = v_next_turn,
            turn_deadline = now() + interval '60 seconds',
            updated_at = now()
        where id = p_match_id;
    end if;

    delete from public.player_potions where player_id = v_player_id and quantity <= 0;

    select m.status, m.winner_id, m.player1_hp, m.player2_hp into v_match
    from pvp_matches m where m.id = p_match_id;

    if v_match.player1_hp <= 0 then
        update pvp_matches set status = 'finished', winner_id = v_match.player2_id,
               turn_player_id = null, turn_deadline = null, updated_at = now()
        where id = p_match_id;
    elsif v_match.player2_hp <= 0 then
        update pvp_matches set status = 'finished', winner_id = v_match.player1_id,
               turn_player_id = null, turn_deadline = null, updated_at = now()
        where id = p_match_id;
    end if;

    select m.status, m.winner_id, m.player1_hp, m.player2_hp into v_match
    from pvp_matches m where m.id = p_match_id;

    return query select v_match.status, v_match.winner_id, v_match.player1_hp, v_match.player2_hp;
end;
$function$;
