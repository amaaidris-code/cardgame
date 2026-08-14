-- When a reflected hit is blocked by the opponent's active defense, report
-- it as blocked with reflected_dmg = 0 (instead of still showing the full
-- pre-block amount), so the client displays it as a blocked/absorbed hit.
CREATE OR REPLACE FUNCTION public.pvp_apply_effect(
    p_skill_type text,
    p_skill_effect text,
    p_skill_damage integer,
    p_skill_unblockable boolean,
    p_skill_params jsonb,
    p_self pvp_fighter_state,
    p_opp pvp_fighter_state,
    p_hit_is_reflected boolean)
RETURNS public.pvp_effect_out
AS $fn$
DECLARE
    v_out pvp_effect_out;
    v_self pvp_fighter_state := p_self;
    v_opp  pvp_fighter_state := p_opp;
    v_dmg int := 0;
    v_applied_dmg int := 0;
    v_heal int := 0;
    v_blocked boolean := false;
    v_freeze_duration int := 0;
    v_endurance_hits int := 0;
    v_reflected_dmg int := 0;
    v_absorbed int := 0;
    v_amount int;
    v_was_pending boolean;
    v_opp_hp_before int;
    v_self_hp_before int;
    v_params jsonb := COALESCE(p_skill_params, '{}'::jsonb);
BEGIN
    IF p_skill_effect = 'reflect' THEN
        v_was_pending := (NOT v_self.last_consumed) AND COALESCE(v_self.last_damage, 0) > 0;
        v_self.last_consumed := true;
        v_self.reflect_mult := 0;
        v_self.absorb_mode := null;
        v_self.absorb_hits := 0;
        IF v_was_pending THEN
            v_self.hp := LEAST(v_self.max_hp, COALESCE(v_self.last_hp_before, v_self.hp));
            v_reflected_dmg := COALESCE(v_self.last_damage, 0) * GREATEST(1, COALESCE(p_skill_damage, 1));
            v_opp_hp_before := v_opp.hp;
            -- مهارة "انعكاس لا يُصدّ": الضرر المنعكس لا يُحجب إلا بالامتصاص.
            -- وإلا فيُعكس كضرر مباشر على الخصم كما في الانعكاس العادي
            IF COALESCE(v_params->>'unblockable_reflect','false')::boolean
               AND v_opp.absorb_mode IS NOT NULL AND v_opp.absorb_hits > 0 THEN
                v_absorbed := v_reflected_dmg;
                IF v_opp.absorb_mode = 'atk' THEN
                    v_opp.temp_atk := v_opp.temp_atk + v_absorbed;
                ELSE
                    v_opp.hp := v_opp.hp + v_absorbed;
                    IF v_opp.hp > v_opp.max_hp THEN
                        v_opp.max_hp := v_opp.hp;
                    END IF;
                END IF;
                v_opp.absorb_hits := v_opp.absorb_hits - 1;
                IF v_opp.absorb_hits <= 0 THEN
                    v_opp.absorb_mode := null;
                    v_opp.absorb_hits := 0;
                END IF;
                v_opp.last_hp_before := v_opp_hp_before;
                v_opp.last_damage := 0;
                v_opp.last_consumed := true;
            ELSE
                -- إذا كان الخصم مدافعًا بنشاط والانعكاس قابل للصدّ، يُحجب الضرر المنعكس
                IF v_opp.defending AND NOT COALESCE(v_params->>'unblockable_reflect','false')::boolean THEN
                    v_blocked := true;
                    v_reflected_dmg := 0;
                    v_opp.last_hp_before := v_opp_hp_before;
                    v_opp.last_damage := 0;
                    v_opp.last_consumed := true;
                ELSE
                    v_opp.hp := GREATEST(0, v_opp.hp - v_reflected_dmg);
                    v_opp.last_hp_before := v_opp_hp_before;
                    v_opp.last_damage := LEAST(v_reflected_dmg, v_opp_hp_before);
                    v_opp.last_consumed := false;
                END IF;
            END IF;
        END IF;

    ELSIF p_skill_effect = 'consecutive_turns' THEN
        v_self.last_consumed := true;
        v_amount := COALESCE(NULLIF(v_params->>'extra_turns','')::integer, p_skill_damage, 1);
        v_self.extra_turns := v_self.extra_turns + GREATEST(1, v_amount);

    ELSIF p_skill_effect = 'absorb_atk' THEN
        v_was_pending := (NOT v_self.last_consumed) AND COALESCE(v_self.last_damage, 0) > 0;
        v_self.last_consumed := true;
        IF v_was_pending THEN
            v_self.hp := LEAST(v_self.max_hp, COALESCE(v_self.last_hp_before, v_self.hp));
        END IF;
        v_self.reflect_mult := 0;
        v_self.absorb_mode := 'atk';
        v_self.absorb_hits := GREATEST(1, COALESCE(NULLIF(v_params->>'absorb_hits','')::integer, p_skill_damage, 1));

    ELSIF p_skill_effect = 'absorb_hp' THEN
        v_was_pending := (NOT v_self.last_consumed) AND COALESCE(v_self.last_damage, 0) > 0;
        v_self.last_consumed := true;
        IF v_was_pending THEN
            v_self.hp := LEAST(v_self.max_hp, COALESCE(v_self.last_hp_before, v_self.hp));
        END IF;
        v_self.reflect_mult := 0;
        v_self.absorb_mode := 'hp';
        v_self.absorb_hits := GREATEST(1, COALESCE(NULLIF(v_params->>'absorb_hits','')::integer, p_skill_damage, 1));

    ELSIF p_skill_effect = 'hp_boost' THEN
        v_self.last_consumed := true;
        v_amount := GREATEST(1, COALESCE(NULLIF(v_params->>'amount','')::integer, p_skill_damage, 1));
        v_self.hp := v_self.hp + v_amount;
        IF v_self.hp > v_self.max_hp THEN
            v_self.max_hp := v_self.hp;
        END IF;

    ELSIF p_skill_effect = 'atk_boost' THEN
        v_self.last_consumed := true;
        v_amount := GREATEST(1, COALESCE(NULLIF(v_params->>'amount','')::integer, p_skill_damage, 1));
        v_self.temp_atk := v_self.temp_atk + v_amount;

    ELSIF p_skill_effect = 'poison' THEN
        v_self.last_consumed := true;
        v_amount := GREATEST(1, COALESCE(NULLIF(v_params->>'poison_turns','')::integer, p_skill_damage, 1));
        v_opp.poison_damage := GREATEST(1, COALESCE(NULLIF(v_params->>'poison_damage','')::integer, p_skill_damage, 1));
        v_opp.poison_turns := GREATEST(0, v_amount - 1);
        v_dmg := v_opp.poison_damage;
        v_opp_hp_before := v_opp.hp;
        v_applied_dmg := LEAST(v_dmg, v_opp_hp_before);
        v_opp.hp := GREATEST(0, v_opp.hp - v_dmg);
        v_opp.last_hp_before := v_opp_hp_before;
        v_opp.last_damage := v_applied_dmg;
        v_opp.last_consumed := true;

    ELSE
        v_was_pending := (not v_self.last_consumed) and COALESCE(v_self.last_damage, 0) > 0;
        v_self.last_consumed := true;

        IF p_skill_type = 'defense' THEN
            v_dmg := 0;
            IF v_was_pending THEN
                v_self.hp := LEAST(v_self.max_hp, COALESCE(v_self.last_hp_before, v_self.hp));
            END IF;
            v_endurance_hits := GREATEST(1, COALESCE(p_skill_damage, 1));
        ELSIF p_skill_effect = 'freeze' THEN
            v_dmg := 0;
            v_freeze_duration := GREATEST(1, COALESCE(p_skill_damage, 1));
        ELSIF p_skill_type = 'attack' OR p_skill_type = 'special' THEN
            v_dmg := COALESCE(p_skill_damage, 0) + v_self.temp_atk;
            IF v_opp.defending AND NOT COALESCE(p_skill_unblockable, false) THEN
                v_dmg := 0;
                v_blocked := true;
            END IF;
        ELSE
            v_dmg := 0;
        END IF;

        IF v_dmg > 0 AND NOT p_hit_is_reflected
           AND ( (v_opp.reflect_mult > 0 AND NOT COALESCE(p_skill_unblockable, false))
                 OR (v_opp.absorb_mode IS NOT NULL AND v_opp.absorb_hits > 0) ) THEN

            IF v_opp.reflect_mult > 0 AND NOT COALESCE(p_skill_unblockable, false) THEN
                v_reflected_dmg := v_dmg * v_opp.reflect_mult;
                v_self_hp_before := v_self.hp;
                v_self.hp := GREATEST(0, v_self.hp - v_reflected_dmg);
                v_opp.reflect_mult := 0;
                v_applied_dmg := 0;
                v_self.last_hp_before := v_self_hp_before;
                v_self.last_damage := v_reflected_dmg;
                v_self.last_consumed := true;
                v_opp.last_hp_before := v_opp.hp;
                v_opp.last_damage := 0;
                v_opp.last_consumed := true;
            ELSIF v_opp.absorb_mode = 'atk' THEN
                v_absorbed := v_dmg;
                v_opp.temp_atk := v_opp.temp_atk + v_absorbed;
                v_opp.absorb_hits := v_opp.absorb_hits - 1;
                v_applied_dmg := 0;
                v_opp.last_hp_before := v_opp.hp;
                v_opp.last_damage := 0;
                v_opp.last_consumed := true;
            ELSIF v_opp.absorb_mode = 'hp' THEN
                v_absorbed := v_dmg;
                v_opp.last_hp_before := v_opp.hp;
                v_opp.hp := v_opp.hp + v_absorbed;
                IF v_opp.hp > v_opp.max_hp THEN
                    v_opp.max_hp := v_opp.hp;
                END IF;
                v_opp.absorb_hits := v_opp.absorb_hits - 1;
                v_applied_dmg := 0;
                v_opp.last_damage := 0;
                v_opp.last_consumed := true;
            END IF;

        ELSE
            v_opp_hp_before := v_opp.hp;
            v_applied_dmg := LEAST(v_dmg, v_opp_hp_before);
            v_opp.hp := GREATEST(0, v_opp.hp - v_dmg);
            v_opp.last_hp_before := v_opp_hp_before;
            v_opp.last_damage := v_applied_dmg;
            v_opp.last_consumed := COALESCE(p_skill_unblockable, false) OR v_applied_dmg <= 0;
        END IF;

        IF p_skill_effect = 'lifesteal' AND v_dmg > 0 THEN
            v_heal := v_dmg;
        END IF;

        IF v_blocked AND v_opp.shield_charges > 0 THEN
            v_opp.shield_charges := v_opp.shield_charges - 1;
        ELSE
            v_opp.shield_charges := 0;
        END IF;

        IF v_freeze_duration > 0 THEN
            v_opp.frozen_turns := v_opp.frozen_turns + v_freeze_duration;
        END IF;
    END IF;

    v_out.self := v_self;
    v_out.opp := v_opp;
    v_out.dmg := v_dmg;
    v_out.applied_dmg := v_applied_dmg;
    v_out.heal := v_heal;
    v_out.blocked := v_blocked;
    v_out.freeze_duration := v_freeze_duration;
    v_out.endurance_hits := v_endurance_hits;
    v_out.reflected_dmg := v_reflected_dmg;
    v_out.absorbed := v_absorbed;

    RETURN v_out;
END;
$fn$
LANGUAGE plpgsql;