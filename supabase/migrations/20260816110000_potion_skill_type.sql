-- ============================================================
-- الجرعة بنوع مهارة (synthetic skill)
-- بدل ربط مهارة موجودة (effect_skill_id)، تحمل الجرعة نوع مهارة
-- (من قائمة الأنواع الـ20) + قيمة/ضرر، وتُبنى منها مهارة صناعية
-- عند الاستخدام تُمرَّر عبر محرك التأثيرات نفسه (PvE / PvP).
--
-- يبقى effect_skill_id للتوافق مع القديم، والجديد يُفضَّل عبر
-- effect_skill_type.
-- ============================================================

alter table public.potions
    add column if not exists effect_skill_type text;

-- ---------- لوحة الإدارة ----------
create or replace function public.admin_list_potions(p_admin_token text)
returns table (id uuid, name text, description text, image text, effect_type text,
               effect_value numeric, effect_skill_id uuid, effect_skill_type text,
               price numeric, stock integer, infinite boolean, available boolean,
               glow_color text, created_at timestamptz, sold numeric)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    return query
        select po.id, po.name, po.description, po.image, po.effect_type, po.effect_value,
               po.effect_skill_id, po.effect_skill_type, po.price, po.stock, po.infinite,
               po.available, po.glow_color, po.created_at,
               (select coalesce(sum(pp.quantity), 0)::numeric from public.player_potions pp where pp.potion_id = po.id) as sold
        from public.potions po
        order by po.created_at;
end;
$fn$;

create or replace function public.admin_get_potion(p_admin_token text, p_potion_id uuid)
returns table (id uuid, name text, description text, image text, effect_type text,
               effect_value numeric, effect_skill_id uuid, effect_skill_type text,
               price numeric, stock integer, infinite boolean, available boolean,
               glow_color text, skills jsonb)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    return query
        select po.id, po.name, po.description, po.image, po.effect_type, po.effect_value,
               po.effect_skill_id, po.effect_skill_type, po.price, po.stock, po.infinite,
               po.available, po.glow_color,
               case when po.effect_skill_id is not null then (
                   select to_jsonb(s)
                   from public.skills s where s.id = po.effect_skill_id
               ) else null end
        from public.potions po
        where po.id = p_potion_id;
end;
$fn$;

create or replace function public.admin_add_potion(
    p_admin_token text, p_name text, p_description text, p_image text,
    p_effect_type text, p_effect_value numeric, p_effect_skill_id uuid,
    p_effect_skill_type text, p_price numeric, p_stock integer, p_infinite boolean,
    p_glow_color text)
returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_id uuid;
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    if p_effect_type = 'skill' and p_effect_skill_id is null and coalesce(p_effect_skill_type,'') = '' then
        raise exception 'الجرعة من نوع مهارة يجب أن تحدد نوع المهارة';
    end if;
    insert into public.potions(name, description, image, effect_type, effect_value,
                               effect_skill_id, effect_skill_type, price, stock, infinite, glow_color)
    values (coalesce(p_name,''), p_description, p_image, coalesce(p_effect_type,'heal'),
            coalesce(p_effect_value,0), p_effect_skill_id, p_effect_skill_type,
            coalesce(p_price,0), p_stock, coalesce(p_infinite,false),
            coalesce(p_glow_color,'#22c55e'))
    returning id into v_id;
    return v_id;
end;
$fn$;

create or replace function public.admin_save_potion(
    p_admin_token text, p_potion_id uuid, p_name text, p_description text, p_image text,
    p_effect_type text, p_effect_value numeric, p_effect_skill_id uuid,
    p_effect_skill_type text, p_price numeric, p_stock integer, p_infinite boolean,
    p_glow_color text)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    if p_effect_type = 'skill' and p_effect_skill_id is null and coalesce(p_effect_skill_type,'') = '' then
        raise exception 'الجرعة من نوع مهارة يجب أن تحدد نوع المهارة';
    end if;
    update public.potions set
        name = coalesce(p_name,''),
        description = p_description,
        image = p_image,
        effect_type = coalesce(p_effect_type,'heal'),
        effect_value = coalesce(p_effect_value,0),
        effect_skill_id = p_effect_skill_id,
        effect_skill_type = p_effect_skill_type,
        price = coalesce(p_price,0),
        stock = p_stock,
        infinite = coalesce(p_infinite,false),
        glow_color = coalesce(p_glow_color,'#22c55e')
    where id = p_potion_id;
end;
$fn$;

-- ---------- اللاعب: المخزون و الاستخدام ----------
create or replace function public.get_my_potions(p_token text)
returns table (potion_id uuid, name text, description text, image text, effect_type text,
               effect_value numeric, effect_skill_type text, glow_color text, quantity integer)
language sql security definer set search_path = public, extensions, pg_temp
as $fn$
    select pp.potion_id, po.name, po.description, po.image, po.effect_type, po.effect_value,
           po.effect_skill_type, po.glow_color, pp.quantity
    from public.player_potions pp
    join public.potions po on po.id = pp.potion_id
    where pp.player_id = public.player_id_from_token(p_token) and pp.quantity > 0
    order by po.name;
$fn$;

-- PvE: يخصم الجرعة ويطمئن البيانات؛ مهارة صناعية تُبنى من effect_skill_type + effect_value
create or replace function public.use_potion(p_token text, p_potion_id uuid)
returns table (potion_id uuid, name text, image text, effect_type text, effect_value numeric,
               effect_skill_type text, effect_skill_id uuid, glow_color text, skill jsonb)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_player uuid;
begin
v_player := player_id_from_token(p_token);
    if v_player is null then raise exception 'غير مصرح'; end if;
    update public.player_potions pp
       set quantity = quantity - 1
     where pp.player_id = v_player and pp.potion_id = p_potion_id and pp.quantity > 0;
    if not found then raise exception 'لا تملك هذه الجرعة'; end if;
    delete from public.player_potions pp where pp.player_id = v_player and pp.quantity <= 0;
    return query
        select po.id, po.name, po.image, po.effect_type, po.effect_value,
               po.effect_skill_type, po.effect_skill_id, po.glow_color,
               case when po.effect_skill_id is not null then
                   (select to_jsonb(s) from public.skills s where s.id = po.effect_skill_id)
               else null end
        from public.potions po where po.id = p_potion_id;
end;
$fn$;

-- ---------- PvP: يبني مهارة صناعية من نوع الجرعة ويمررها عبر المحرك ----------
create or replace function public.pvp_apply_potion_skill(
    p_skill_type text, p_skill_effect text, p_skill_damage integer,
    p_skill_unblockable boolean, p_skill_params jsonb, p_match_id uuid,
    p_player uuid, p_is_p1 boolean)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare
    v_match record;
    v_self pvp_fighter_state;
    v_opp  pvp_fighter_state;
    v_out  pvp_effect_out;
    v_opponent_id uuid;
begin
    select * into v_match from pvp_matches where id = p_match_id for update;
    if v_match.id is null then return; end if;

    if p_is_p1 then
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

    v_out := public.pvp_apply_effect(
        p_skill_type, p_skill_effect, p_skill_damage,
        p_skill_unblockable, p_skill_params, v_self, v_opp, false);

    v_self := v_out.self;
    v_opp  := v_out.opp;

    if v_out.heal > 0 then
        v_self.hp := least(v_self.max_hp, v_self.hp + v_out.heal);
    end if;
    if coalesce(p_skill_type, '') = 'defense' then
        v_self.defending := true;
        v_self.shield_charges := greatest(0, v_out.endurance_hits - 1);
    else
        v_self.defending := false;
    end if;
    v_opp.defending := v_out.blocked and v_opp.shield_charges > 0;

    if p_is_p1 then
        update pvp_matches set
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
            player2_max_hp = v_opp.max_hp,
            player2_last_hit_hp_before = v_opp.last_hp_before,
            player2_last_hit_damage = v_opp.last_damage,
            player2_last_hit_consumed = v_opp.last_consumed,
            player2_poison_damage = v_opp.poison_damage,
            player2_poison_turns = v_opp.poison_turns,
            player1_hp = v_self.hp,
            player2_hp = v_opp.hp,
            player2_frozen_turns = v_opp.frozen_turns,
            updated_at = now()
        where id = p_match_id;
        if v_opp.hp <= 0 then
            update pvp_matches set status = 'finished', winner_id = p_player,
                turn_player_id = null, turn_deadline = null, updated_at = now()
            where id = p_match_id;
        end if;
    else
        update pvp_matches set
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
            player2_hp = v_self.hp,
            player1_hp = v_opp.hp,
            player1_frozen_turns = v_opp.frozen_turns,
            updated_at = now()
        where id = p_match_id;
        if v_opp.hp <= 0 then
            update pvp_matches set status = 'finished', winner_id = p_player,
                turn_player_id = null, turn_deadline = null, updated_at = now()
            where id = p_match_id;
        end if;
    end if;
end;
$fn$;

-- PvP use_potion يتعامل مع الجرعة من نوع مهارة عبر بناء المهارة الصناعية
create or replace function public.pvp_use_potion(p_token text, p_match_id uuid, p_potion_id uuid)
returns table (status text, winner_id uuid, player1_hp integer, player2_hp integer,
               player1_temp_atk integer, player2_temp_atk integer,
               player1_temp_hp integer, player2_temp_hp integer)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare
    v_player uuid;
    v_match record;
    v_potion record;
    v_is_p1 boolean;
    v_heal int;
begin
    v_player := player_id_from_token(p_token);
    if v_player is null then raise exception 'غير مصرح'; end if;

    select * into v_match from pvp_matches where id = p_match_id for update;
    if v_match.id is null then raise exception 'المباراة غير موجودة'; end if;
    if v_match.status != 'active' then raise exception 'المباراة غير نشطة الآن'; end if;
    if v_match.player1_id != v_player and v_match.player2_id != v_player then
        raise exception 'لست طرفًا في هذه المباراة';
    end if;
    if v_match.turn_player_id != v_player then raise exception 'ليس دورك الآن'; end if;

    v_is_p1 := (v_match.player1_id = v_player);

    if (v_is_p1 and v_match.player1_last_potion_turn >= v_match.player1_turns_taken)
       or (not v_is_p1 and v_match.player2_last_potion_turn >= v_match.player2_turns_taken) then
        raise exception 'استخدمت جرعة في هذا الدور بالفعل';
    end if;

    if (v_is_p1 and coalesce(v_match.player1_frozen_turns,0) > 0)
       or (not v_is_p1 and coalesce(v_match.player2_frozen_turns,0) > 0) then
        raise exception 'أنت مجمد ولا تستطيع الحركة هذا الدور';
    end if;

    update public.player_potions set quantity = quantity - 1
     where player_id = v_player and potion_id = p_potion_id and quantity > 0;
    if not found then raise exception 'لا تملك هذه الجرعة'; end if;

    select * into v_potion from public.potions po where po.id = p_potion_id;

    v_heal := 0;
    if v_potion.effect_type = 'heal' then
        v_heal := coalesce(v_potion.effect_value, 0)::int;
    elsif v_potion.effect_type = 'heal_percent' then
        if v_is_p1 then
            v_heal := round((coalesce(v_potion.effect_value,0) / 100.0) * v_match.player2_max_hp)::int;
        else
            v_heal := round((coalesce(v_potion.effect_value,0) / 100.0) * v_match.player1_max_hp)::int;
        end if;
    end if;

    if v_is_p1 then
        if v_heal > 0 then
            update pvp_matches set player2_hp = least(player2_max_hp, player2_hp + v_heal) where id = p_match_id;
        elsif v_potion.effect_type = 'reset_cooldown' then
            delete from pvp_cooldowns where match_id = p_match_id and player_id = v_player;
        elsif v_potion.effect_type = 'atk_boost' then
            update pvp_matches set player2_temp_atk = player2_temp_atk + coalesce(v_potion.effect_value,0)::int where id = p_match_id;
        elsif v_potion.effect_type = 'shield' then
            update pvp_matches set player2_temp_hp = player2_temp_hp + coalesce(v_potion.effect_value,0)::int where id = p_match_id;
        elsif v_potion.effect_type = 'skill' then
            if v_potion.effect_skill_type is not null then
                perform public.pvp_apply_potion_skill(
                    public.potion_skill_fields(v_potion.effect_skill_type)->>'type',
                    NULLIF(public.potion_skill_fields(v_potion.effect_skill_type)->>'effect','null'),
                    coalesce(v_potion.effect_value,0)::int,
                    (public.potion_skill_fields(v_potion.effect_skill_type)->>'unblockable')::boolean,
                    public.potion_skill_params(v_potion.effect_skill_type),
                    p_match_id, v_player, true);
            elsif v_potion.effect_skill_id is not null then
                perform public.pvp_apply_potion_skill(
                    (select s.type from public.skills s where s.id = v_potion.effect_skill_id),
                    (select s.effect from public.skills s where s.id = v_potion.effect_skill_id),
                    (select s.damage from public.skills s where s.id = v_potion.effect_skill_id),
                    (select s.unblockable from public.skills s where s.id = v_potion.effect_skill_id),
                    (select s.params from public.skills s where s.id = v_potion.effect_skill_id),
                    p_match_id, v_player, true);
            end if;
        end if;
        update pvp_matches set
            player1_last_potion_turn = v_match.player1_turns_taken,
            turn_deadline = now() + interval '60 seconds',
            updated_at = now()
        where id = p_match_id;
    else
        if v_heal > 0 then
            update pvp_matches set player1_hp = least(player1_max_hp, player1_hp + v_heal) where id = p_match_id;
        elsif v_potion.effect_type = 'reset_cooldown' then
            delete from pvp_cooldowns where match_id = p_match_id and player_id = v_player;
        elsif v_potion.effect_type = 'atk_boost' then
            update pvp_matches set player1_temp_atk = player1_temp_atk + coalesce(v_potion.effect_value,0)::int where id = p_match_id;
        elsif v_potion.effect_type = 'shield' then
            update pvp_matches set player1_temp_hp = player1_temp_hp + coalesce(v_potion.effect_value,0)::int where id = p_match_id;
        elsif v_potion.effect_type = 'skill' then
            if v_potion.effect_skill_type is not null then
                perform public.pvp_apply_potion_skill(
                    public.potion_skill_fields(v_potion.effect_skill_type)->>'type',
                    NULLIF(public.potion_skill_fields(v_potion.effect_skill_type)->>'effect','null'),
                    coalesce(v_potion.effect_value,0)::int,
                    (public.potion_skill_fields(v_potion.effect_skill_type)->>'unblockable')::boolean,
                    public.potion_skill_params(v_potion.effect_skill_type),
                    p_match_id, v_player, false);
            elsif v_potion.effect_skill_id is not null then
                perform public.pvp_apply_potion_skill(
                    (select s.type from public.skills s where s.id = v_potion.effect_skill_id),
                    (select s.effect from public.skills s where s.id = v_potion.effect_skill_id),
                    (select s.damage from public.skills s where s.id = v_potion.effect_skill_id),
                    (select s.unblockable from public.skills s where s.id = v_potion.effect_skill_id),
                    (select s.params from public.skills s where s.id = v_potion.effect_skill_id),
                    p_match_id, v_player, false);
            end if;
        end if;
        update pvp_matches set
            player2_last_potion_turn = v_match.player2_turns_taken,
            turn_deadline = now() + interval '60 seconds',
            updated_at = now()
        where id = p_match_id;
    end if;

    delete from public.player_potions where player_id = v_player and quantity <= 0;

    select m.status, m.winner_id, m.player1_hp, m.player2_hp,
           m.player1_temp_atk, m.player2_temp_atk,
           m.player1_temp_hp, m.player2_temp_hp
      into v_match
      from pvp_matches m where m.id = p_match_id;

    return query select v_match.status, v_match.winner_id, v_match.player1_hp, v_match.player2_hp,
                        v_match.player1_temp_atk, v_match.player2_temp_atk,
                        v_match.player1_temp_hp, v_match.player2_temp_hp;
end;
$fn$;

-- يخدم بناء المهارة الصناعية: يعيد {type, effect, unblockable} من اسم نوع المهارة
create or replace function public.potion_skill_fields(p_type text)
returns jsonb
language plpgsql immutable set search_path = public, extensions, pg_temp
as $fn$
begin
    case p_type
        when 'attack' then return '{"type":"attack","effect":null,"unblockable":false}'::jsonb;
        when 'defense' then return '{"type":"defense","effect":null,"unblockable":false}'::jsonb;
        when 'steal' then return '{"type":"special","effect":"steal","unblockable":false}'::jsonb;
        when 'copy' then return '{"type":"special","effect":"copy","unblockable":false}'::jsonb;
        when 'control' then return '{"type":"special","effect":"control","unblockable":false}'::jsonb;
        when 'unblockable' then return '{"type":"special","effect":null,"unblockable":true}'::jsonb;
        when 'freeze' then return '{"type":"special","effect":"freeze","unblockable":false}'::jsonb;
        when 'lifesteal' then return '{"type":"special","effect":"lifesteal","unblockable":false}'::jsonb;
        when 'reflect' then return '{"type":"special","effect":"reflect","unblockable":false}'::jsonb;
        when 'unblockable_reflect' then return '{"type":"special","effect":"reflect","unblockable":true}'::jsonb;
        when 'seal' then return '{"type":"special","effect":"seal","unblockable":false}'::jsonb;
        when 'unseal' then return '{"type":"special","effect":"unseal","unblockable":false}'::jsonb;
        when 'consecutive_turns' then return '{"type":"special","effect":"consecutive_turns","unblockable":false}'::jsonb;
        when 'absorb_atk' then return '{"type":"special","effect":"absorb_atk","unblockable":false}'::jsonb;
        when 'absorb_hp' then return '{"type":"special","effect":"absorb_hp","unblockable":false}'::jsonb;
        when 'hp_boost' then return '{"type":"special","effect":"hp_boost","unblockable":false}'::jsonb;
        when 'atk_boost' then return '{"type":"special","effect":"atk_boost","unblockable":false}'::jsonb;
        when 'poison' then return '{"type":"special","effect":"poison","unblockable":false}'::jsonb;
        when 'delay_cooldown' then return '{"type":"special","effect":"delay_cooldown","unblockable":false}'::jsonb;
        when 'shadow' then return '{"type":"special","effect":"shadow","unblockable":false}'::jsonb;
        else return '{"type":"attack","effect":null,"unblockable":false}'::jsonb;
    end case;
end;
$fn$;

-- params المرافقة لنوع المهارة الصناعية
create or replace function public.potion_skill_params(p_type text)
returns jsonb
language plpgsql immutable set search_path = public, extensions, pg_temp
as $fn$
begin
    if p_type = 'unblockable_reflect' then
        return '{"unblockable_reflect":true}'::jsonb;
    end if;
    return '{}'::jsonb;
end;
$fn$;