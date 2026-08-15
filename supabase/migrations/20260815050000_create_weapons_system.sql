-- ============================================================
-- نظام الأسلحة (Weapons System)
-- سلاح => مهاراته/المتانة/السعر/النسخ
-- يباع في المتجر، يُجهَّز ويُستخدم في المعارك (PvE و PvP)
-- ============================================================

-- ---------- جداول ----------
create table if not exists public.weapons (
    id               uuid primary key default gen_random_uuid(),
    name             text not null default '',
    description      text,
    image            text,               -- صورة السلاح
    skill_card_image text,               -- خلفية بطاقات مهارات السلاح
    price            numeric not null default 0,
    max_durability   numeric not null default 0,
    stock            integer,            -- عدد النسخ المتاحة؛ NULL يعني بلالمحدود
    infinite         boolean not null default false, -- نسخ لا محدودة
    available        boolean not null default true,
    glow_color       text default '#e8b93f',
    created_at       timestamptz not null default now()
);
alter table public.weapons enable row level security;

create table if not exists public.weapon_skills (
    weapon_id uuid not null references public.weapons(id) on delete cascade,
    skill_id  uuid not null references public.skills(id) on delete cascade,
    slot      integer not null default 0,
    primary key (weapon_id, skill_id)
);
alter table public.weapon_skills enable row level security;

create table if not exists public.player_weapons (
    id                 uuid primary key default gen_random_uuid(),
    player_id          uuid not null references public.players(id) on delete cascade,
    weapon_id          uuid not null references public.weapons(id) on delete cascade,
    durability_current numeric not null default 0,
    created_at         timestamptz not null default now()
);
alter table public.player_weapons enable row level security;

-- السلاح النشط عند اللاعب (يشير لنسخة يملكها في player_weapons)
alter table public.players add column if not exists active_weapon_id uuid;

-- ---------- لوحة الإدارة ----------
create or replace function public.admin_list_weapons(p_admin_token text)
returns table (id uuid, name text, description text, image text, skill_card_image text,
               price numeric, max_durability numeric, stock integer, infinite boolean,
               available boolean, glow_color text, created_at timestamptz, sold numeric)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    return query
        select w.id, w.name, w.description, w.image, w.skill_card_image,
               w.price, w.max_durability, w.stock, w.infinite, w.available, w.glow_color,
               w.created_at,
               (select count(*)::numeric from public.player_weapons pw where pw.weapon_id = w.id) as sold
        from public.weapons w
        order by w.created_at;
end;
$fn$;

create or replace function public.admin_get_weapon(p_admin_token text, p_weapon_id uuid)
returns table (id uuid, name text, description text, image text, skill_card_image text,
               price numeric, max_durability numeric, stock integer, infinite boolean,
               available boolean, glow_color text, sold numeric, skills jsonb)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    return query
        select w.id, w.name, w.description, w.image, w.skill_card_image,
               w.price, w.max_durability, w.stock, w.infinite, w.available, w.glow_color,
               (select count(*)::numeric from public.player_weapons pw where pw.weapon_id = w.id) as sold,
               coalesce((
                   select jsonb_agg(jsonb_build_object(
                       'id', s.id, 'name', s.name, 'type', s.type, 'damage', s.damage,
                       'cooldown', s.cooldown, 'effect', s.effect, 'unblockable', s.unblockable,
                       'description', s.description, 'color', s.color,
                       'stroke_color', s.stroke_color, 'stroke_width', s.stroke_width,
                       'params', s.params, 'slot', ws.slot
                   ) order by ws.slot)
                   from public.weapon_skills ws join public.skills s on s.id = ws.skill_id
                   where ws.weapon_id = w.id
               ), '[]'::jsonb)
        from public.weapons w
        where w.id = p_weapon_id;
end;
$fn$;

create or replace function public.admin_add_weapon(
    p_admin_token text, p_name text, p_description text, p_image text, p_skill_card_image text,
    p_price numeric, p_max_durability numeric, p_stock integer, p_infinite boolean, p_glow_color text)
returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_id uuid;
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    insert into public.weapons(name, description, image, skill_card_image, price, max_durability,
                               stock, infinite, glow_color)
    values (coalesce(p_name,''), p_description, p_image, p_skill_card_image,
            coalesce(p_price,0), coalesce(p_max_durability,0),
            p_stock, coalesce(p_infinite,false), coalesce(p_glow_color,'#e8b93f'))
    returning id into v_id;
    return v_id;
end;
$fn$;

create or replace function public.admin_save_weapon(
    p_admin_token text, p_weapon_id uuid, p_name text, p_description text, p_image text,
    p_skill_card_image text, p_price numeric, p_max_durability numeric,
    p_stock integer, p_infinite boolean, p_glow_color text)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    update public.weapons set
        name = coalesce(p_name,''),
        description = p_description,
        image = p_image,
        skill_card_image = p_skill_card_image,
        price = coalesce(p_price,0),
        max_durability = coalesce(p_max_durability,0),
        stock = p_stock,
        infinite = coalesce(p_infinite,false),
        glow_color = coalesce(p_glow_color,'#e8b93f')
    where id = p_weapon_id;
end;
$fn$;

create or replace function public.admin_delete_weapon(p_admin_token text, p_weapon_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    -- سلاح محذوف يُبطل عند أي لاعب كان مجهزًا
    update public.players set active_weapon_id = null where active_weapon_id in
        (select id from public.player_weapons where weapon_id = p_weapon_id);
    delete from public.player_weapons where weapon_id = p_weapon_id;
    delete from public.weapons where id = p_weapon_id;
end;
$fn$;

create or replace function public.admin_add_weapon_skill(
    p_admin_token text, p_weapon_id uuid, p_name text, p_type text, p_damage integer,
    p_cooldown integer, p_effect text, p_unblockable boolean,
    p_description text, p_color text, p_params jsonb, p_stroke_color text, p_stroke_width integer)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_skill uuid; v_slot integer;
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    insert into public.skills(name, type, damage, cooldown, effect, unblockable,
                              description, color, params, stroke_color, stroke_width)
    values (p_name, p_type, coalesce(p_damage,0), coalesce(p_cooldown,0), p_effect,
            coalesce(p_unblockable,false), p_description, p_color,
            coalesce(p_params,'{}'::jsonb), p_stroke_color, coalesce(p_stroke_width,0))
    returning id into v_skill;
    select coalesce(max(slot),0)+1 into v_slot from public.weapon_skills where weapon_id = p_weapon_id;
    insert into public.weapon_skills(weapon_id, skill_id, slot) values (p_weapon_id, v_skill, v_slot);
end;
$fn$;

create or replace function public.admin_update_weapon_skill(
    p_admin_token text, p_weapon_id uuid, p_skill_id uuid, p_name text, p_type text,
    p_damage integer, p_cooldown integer, p_effect text, p_unblockable boolean,
    p_description text, p_color text, p_params jsonb, p_stroke_color text, p_stroke_width integer)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    if not exists (select 1 from public.weapon_skills where weapon_id = p_weapon_id and skill_id = p_skill_id) then
        return;
    end if;
    update public.skills set
        name = p_name, type = p_type, damage = coalesce(p_damage,0),
        cooldown = coalesce(p_cooldown,0), effect = p_effect,
        unblockable = coalesce(p_unblockable,false), description = p_description,
        color = p_color, params = coalesce(p_params,'{}'::jsonb),
        stroke_color = p_stroke_color, stroke_width = coalesce(p_stroke_width,0)
    where id = p_skill_id;
end;
$fn$;

create or replace function public.admin_remove_weapon_skill(
    p_admin_token text, p_weapon_id uuid, p_skill_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    delete from public.weapon_skills where weapon_id = p_weapon_id and skill_id = p_skill_id;
end;
$fn$;

-- ---------- اللاعب: المتجر والتجهيز ----------
create or replace function public.shop_list_weapons(p_token text)
returns table (id uuid, name text, description text, image text, skill_card_image text,
               price numeric, max_durability numeric, infinite boolean, stock integer, glow_color text)
language sql security definer set search_path = public, extensions, pg_temp
as $fn$
    select w.id, w.name, w.description, w.image, w.skill_card_image,
           w.price, w.max_durability, w.infinite, coalesce(w.stock,0), w.glow_color
    from public.weapons w
    where w.available = true and (w.infinite = true or coalesce(w.stock,0) > 0)
    order by w.price, w.created_at;
$fn$;

create or replace function public.shop_buy_weapon(p_token text, p_weapon_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_player uuid; v_price numeric; v_dura numeric; v_stock integer; v_infinite boolean;
begin
    v_player := player_id_from_token(p_token);
    if v_player is null then raise exception 'غير مصرح'; end if;
    select w.price, w.max_durability, w.stock, w.infinite
      into v_price, v_dura, v_stock, v_infinite
      from public.weapons w
      where w.id = p_weapon_id and w.available = true
      for update;
    if not found then raise exception 'هذا السلاح غير متوفر'; end if;
    if not v_infinite and coalesce(v_stock,0) <= 0 then
        raise exception 'نفدت النسخ المتاحة من هذا السلاح';
    end if;
    if not exists (select 1 from public.players where id = v_player and gold >= v_price) then
        raise exception 'لا يوجد ذهب كافٍ لشراء هذا السلاح';
    end if;
    update public.players set gold = gold - v_price where id = v_player;
    if not v_infinite then
        update public.weapons set stock = stock - 1 where id = p_weapon_id;
    end if;
    insert into public.player_weapons(player_id, weapon_id, durability_current)
    values (v_player, p_weapon_id, v_dura);
end;
$fn$;

create or replace function public.get_my_weapons(p_token text)
returns table (pw_id uuid, weapon_id uuid, name text, image text, skill_card_image text,
               glow_color text, price numeric, durability_current numeric, max_durability numeric,
               is_active boolean)
language sql security definer set search_path = public, extensions, pg_temp
as $fn$
    select pw.id, w.id, w.name, w.image, w.skill_card_image, w.glow_color, w.price,
           pw.durability_current, w.max_durability,
           (pl.active_weapon_id = pw.id) as is_active
    from public.player_weapons pw
    join public.weapons w on w.id = pw.weapon_id
    join public.players pl on pl.id = pw.player_id
    where pw.player_id = public.player_id_from_token(p_token)
    order by pw.created_at;
$fn$;

create or replace function public.set_active_weapon(p_token text, p_player_weapon_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_player uuid;
begin
    v_player := player_id_from_token(p_token);
    if v_player is null then raise exception 'غير مصرح'; end if;
    if p_player_weapon_id is not null and
       not exists (select 1 from public.player_weapons where id = p_player_weapon_id and player_id = v_player) then
        raise exception 'هذا السلاح ليس ملكك';
    end if;
    update public.players set active_weapon_id = p_player_weapon_id where id = v_player;
end;
$fn$;

-- يعيد السلاح النشط مع مهاراته وحيّتها الحالية
create or replace function public.get_my_active_weapon(p_token text)
returns table (pw_id uuid, weapon_id uuid, name text, image text, skill_card_image text,
               glow_color text, durability_current numeric, max_durability numeric, skills jsonb)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_player uuid; v_pw uuid; v_weapon uuid;
begin
    v_player := player_id_from_token(p_token);
    if v_player is null then raise exception 'غير مصرح'; end if;
    select active_weapon_id into v_pw from public.players where id = v_player;
    if v_pw is null then return; end if;
    select weapon_id into v_weapon from public.player_weapons where id = v_pw;
    return query
        select pw.id, w.id, w.name, w.image, w.skill_card_image, w.glow_color,
               pw.durability_current, w.max_durability,
               coalesce((
                   select jsonb_agg(jsonb_build_object(
                       'id', s.id, 'name', s.name, 'type', s.type, 'damage', s.damage,
                       'cooldown', s.cooldown, 'effect', s.effect, 'unblockable', s.unblockable,
                       'description', s.description, 'color', s.color,
                       'stroke_color', s.stroke_color, 'stroke_width', s.stroke_width,
                       'params', s.params, 'slot', ws.slot
                   ) order by ws.slot)
                   from public.weapon_skills ws join public.skills s on s.id = ws.skill_id
                   where ws.weapon_id = w.id
               ), '[]'::jsonb)
        from public.player_weapons pw
        join public.weapons w on w.id = pw.weapon_id
        where pw.id = v_pw;
end;
$fn$;

-- يُنقص متانة السلاح النشط بمقدار 1 ويعيد القيمة الجديدة
create or replace function public.weapon_use_durability(p_token text)
returns integer
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_player uuid; v_pw uuid; v_new integer;
begin
    v_player := player_id_from_token(p_token);
    if v_player is null then raise exception 'غير مصرح'; end if;
    select active_weapon_id into v_pw from public.players where id = v_player;
    if v_pw is null then raise exception 'لا يوجد سلاح مجهز'; end if;
    update public.player_weapons
    set durability_current = greatest(0, durability_current - 1)
    where id = v_pw
    returning durability_current into v_new;
    return coalesce(v_new, 0);
end;
$fn$;

-- ---------- PvP: استخدام مهارة سلاح (يشبه pvp_use_skill) ----------
create or replace function public.pvp_use_weapon_skill(p_token text, p_match_id uuid, p_skill_id uuid)
returns table (status text, winner_id uuid, player1_hp integer, player2_hp integer)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare
    v_player_id uuid;
    v_match record;
    v_skill record;
    v_pw_id uuid;
    v_weapon_id uuid;
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

    select active_weapon_id into v_pw_id from public.players where id = v_player_id;
    if v_pw_id is null then raise exception 'لا يوجد سلاح مجهز'; end if;
    select weapon_id into v_weapon_id from public.player_weapons where id = v_pw_id;

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
        select 1 from weapon_skills ws where ws.weapon_id = v_weapon_id and ws.skill_id = p_skill_id
    ) into v_owns_skill;
    if not v_owns_skill then raise exception 'هذه ليست مهارة سلاح مجهز'; end if;

    select * into v_skill from skills where id = p_skill_id;

    if v_skill.effect in ('steal', 'copy', 'control') then
        raise exception 'لا يمكن استخدام مهارة السرقة/النسخ/التحكم مباشرة';
    end if;
    if v_skill.effect in ('seal', 'unseal') then
        raise exception 'لا يمكن استخدام مهارة الختم/فك الختم مباشرة';
    end if;
    if v_skill.effect in ('shadow', 'delay_cooldown') then
        raise exception 'لا يمكن استخدام هذه المهارة مباشرة';
    end if;

    if (v_is_p1 and v_match.player1_sealed_skill_ids is not null and p_skill_id = any(v_match.player1_sealed_skill_ids))
       or (not v_is_p1 and v_match.player2_sealed_skill_ids is not null and p_skill_id = any(v_match.player2_sealed_skill_ids)) then
        raise exception 'هذه المهارة مختومة ولا يمكن استخدامها';
    end if;

    if public.pvp_skill_remaining_cd(p_match_id, v_player_id, p_skill_id, v_skill.cooldown, v_caller_turns) > 0 then
        raise exception 'المهارة ما زالت في التهدئة';
    end if;

    v_eff_damage := v_skill.damage;

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

    -- إنقاص متانة السلاح
    update public.player_weapons set durability_current = greatest(0, durability_current - 1)
    where id = v_pw_id;

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
            player2_max_hp = v_opp.max_hp,
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
$fn$;