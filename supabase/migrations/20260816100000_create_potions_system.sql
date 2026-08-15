-- ============================================================
-- نظام الجرع (Potions System)
-- جرعة => تأثير (شفاء/نسبة شفاء/إعادة تهدئة/قوة مؤقتة/درع امتصاص/مهارة مدمجة)
-- تُباع في المتجر بعدد حسب رغبة اللاعب، وتُستخدم في المعارك (PvE و PvP)
-- القاعدة: جرعة واحدة لكل دور (بلا حدود أدوار)، لا تستهلك الدور،
-- فبعدها يبقى اللاعب قادرًا على استخدام مهارة/هجوم في نفس دوره.
--
-- أنواع التأثير (effect_type):
--   heal          : شفاء كمية ثابتة = effect_value
--   heal_percent  : شفاء نسبة من الصحة القصوى = effect_value (٪)
--   reset_cooldown: إعادة تهدئة كل مهارات اللاعب إلى صفر
--   atk_boost     : قوة هجوم مؤقتة تُضاف = effect_value
--   shield        : درع امتصاص (صحة مؤقتة فوق القصوى) = effect_value
--   skill         : جرعة تحمل مهارة كاملة (رابط effect_skill_id) تُستخدم كمهارة
-- ============================================================

-- ---------- جداول ----------
create table if not exists public.potions (
    id             uuid primary key default gen_random_uuid(),
    name           text not null default '',
    description    text,
    image          text,               -- صورة الجرعة
    effect_type    text not null default 'heal',
    effect_value   numeric not null default 0,
    effect_skill_id uuid,              -- مهارة مدمجة (عندما effect_type = 'skill')
    price          numeric not null default 0,
    stock          integer,            -- عدد الجرعات المتاحة؛ NULL يعني بلالمحدود
    infinite       boolean not null default false,
    available      boolean not null default true,
    glow_color     text default '#22c55e',
    created_at     timestamptz not null default now()
);
alter table public.potions enable row level security;

create table if not exists public.player_potions (
    id         uuid primary key default gen_random_uuid(),
    player_id  uuid not null references public.players(id) on delete cascade,
    potion_id  uuid not null references public.potions(id) on delete cascade,
    quantity   integer not null default 0,
    created_at timestamptz not null default now(),
    unique (player_id, potion_id)
);
alter table public.player_potions enable row level security;

-- ---------- لوحة الإدارة ----------
create or replace function public.admin_list_potions(p_admin_token text)
returns table (id uuid, name text, description text, image text, effect_type text,
               effect_value numeric, effect_skill_id uuid, price numeric, stock integer,
               infinite boolean, available boolean, glow_color text, created_at timestamptz,
               sold numeric)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    return query
        select po.id, po.name, po.description, po.image, po.effect_type, po.effect_value,
               po.effect_skill_id, po.price, po.stock, po.infinite, po.available, po.glow_color,
               po.created_at,
               (select coalesce(sum(pp.quantity), 0)::numeric from public.player_potions pp where pp.potion_id = po.id) as sold
        from public.potions po
        order by po.created_at;
end;
$fn$;

create or replace function public.admin_get_potion(p_admin_token text, p_potion_id uuid)
returns table (id uuid, name text, description text, image text, effect_type text,
               effect_value numeric, effect_skill_id uuid, price numeric, stock integer,
               infinite boolean, available boolean, glow_color text, skills jsonb)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    return query
        select po.id, po.name, po.description, po.image, po.effect_type, po.effect_value,
               po.effect_skill_id, po.price, po.stock, po.infinite, po.available, po.glow_color,
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
    p_price numeric, p_stock integer, p_infinite boolean, p_glow_color text)
returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_id uuid;
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    if p_effect_type = 'skill' and p_effect_skill_id is null then
        raise exception 'الجرعة من نوع مهارة يجب أن تختار مهارة مدمجة';
    end if;
    insert into public.potions(name, description, image, effect_type, effect_value,
                               effect_skill_id, price, stock, infinite, glow_color)
    values (coalesce(p_name,''), p_description, p_image, coalesce(p_effect_type,'heal'),
            coalesce(p_effect_value,0), p_effect_skill_id, coalesce(p_price,0),
            p_stock, coalesce(p_infinite,false), coalesce(p_glow_color,'#22c55e'))
    returning id into v_id;
    return v_id;
end;
$fn$;

create or replace function public.admin_save_potion(
    p_admin_token text, p_potion_id uuid, p_name text, p_description text, p_image text,
    p_effect_type text, p_effect_value numeric, p_effect_skill_id uuid,
    p_price numeric, p_stock integer, p_infinite boolean, p_glow_color text)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    if p_effect_type = 'skill' and p_effect_skill_id is null then
        raise exception 'الجرعة من نوع مهارة يجب أن تختار مهارة مدمجة';
    end if;
    update public.potions set
        name = coalesce(p_name,''),
        description = p_description,
        image = p_image,
        effect_type = coalesce(p_effect_type,'heal'),
        effect_value = coalesce(p_effect_value,0),
        effect_skill_id = p_effect_skill_id,
        price = coalesce(p_price,0),
        stock = p_stock,
        infinite = coalesce(p_infinite,false),
        glow_color = coalesce(p_glow_color,'#22c55e')
    where id = p_potion_id;
end;
$fn$;

create or replace function public.admin_delete_potion(p_admin_token text, p_potion_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    delete from public.player_potions where potion_id = p_potion_id;
    delete from public.potions where id = p_potion_id;
end;
$fn$;

-- لكل المهارات (لتختار الجرعة المدمجة في لوحة الإدارة)
create or replace function public.admin_list_all_skills(p_admin_token text)
returns table (id uuid, name text, type text, damage integer, effect text, description text)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    return query
        select s.id, s.name, s.type, s.damage, s.effect, s.description
        from public.skills s
        order by s.name;
end;
$fn$;

-- ---------- اللاعب: المتجر والمخزون ----------
create or replace function public.shop_list_potions(p_token text)
returns table (id uuid, name text, description text, image text, effect_type text,
               effect_value numeric, price numeric, infinite boolean, stock integer, glow_color text)
language sql security definer set search_path = public, extensions, pg_temp
as $fn$
    select po.id, po.name, po.description, po.image, po.effect_type, po.effect_value,
           po.price, po.infinite, coalesce(po.stock,0), po.glow_color
    from public.potions po
    where po.available = true and (po.infinite = true or coalesce(po.stock,0) > 0)
    order by po.price, po.created_at;
$fn$;

create or replace function public.shop_buy_potion(p_token text, p_potion_id uuid, p_quantity integer)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_player uuid; v_price numeric; v_stock integer; v_infinite boolean; v_qty integer;
begin
    v_player := player_id_from_token(p_token);
    if v_player is null then raise exception 'غير مصرح'; end if;
    v_qty := greatest(1, coalesce(p_quantity, 1));
    select po.price, po.stock, po.infinite into v_price, v_stock, v_infinite
      from public.potions po
      where po.id = p_potion_id and po.available = true
      for update;
    if not found then raise exception 'هذه الجرعة غير متوفرة'; end if;
    if not v_infinite and coalesce(v_stock,0) < v_qty then
        raise exception 'الكمية المطلوبة أكبر من النسخ المتاحة';
    end if;
    if not exists (select 1 from public.players where id = v_player and gold >= v_price * v_qty) then
        raise exception 'لا يوجد ذهب كافٍ لشراء هذه الجرعة';
    end if;
    update public.players set gold = gold - (v_price * v_qty) where id = v_player;
    if not v_infinite then
        update public.potions set stock = stock - v_qty where id = p_potion_id;
    end if;
    insert into public.player_potions (player_id, potion_id, quantity) values (v_player, p_potion_id, v_qty)
    on conflict (player_id, potion_id)
    do update set quantity = public.player_potions.quantity + excluded.quantity;
end;
$fn$;

create or replace function public.get_my_potions(p_token text)
returns table (potion_id uuid, name text, description text, image text, effect_type text,
               effect_value numeric, glow_color text, quantity integer)
language sql security definer set search_path = public, extensions, pg_temp
as $fn$
    select pp.potion_id, po.name, po.description, po.image, po.effect_type, po.effect_value,
           po.glow_color, pp.quantity
    from public.player_potions pp
    join public.potions po on po.id = pp.potion_id
    where pp.player_id = public.player_id_from_token(p_token) and pp.quantity > 0
    order by po.name;
$fn$;

-- يستخدمها PvE: تخصم جرعة واحدة وتحضّر بياناتها (يشمل المهارة المدمجة) حتى
-- يطبّقها العميل محليًا. لا تُعيد تعيين الدور بأي شكل — التفعيل محلي بالكامل.
create or replace function public.use_potion(p_token text, p_potion_id uuid)
returns table (potion_id uuid, name text, image text, effect_type text, effect_value numeric,
               glow_color text, skill jsonb)
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
        select po.id, po.name, po.image, po.effect_type, po.effect_value, po.glow_color,
               case when po.effect_skill_id is not null then
                   (select to_jsonb(s) from public.skills s where s.id = po.effect_skill_id)
               else null end
        from public.potions po where po.id = p_potion_id;
    delete from public.player_potions where player_id = v_player and quantity <= 0;
end;
$fn$;

-- ---------- PvP: استخدام الجرعة (موثوق من السيرفر) ----------
-- يخصم جرعة واحدة، يطبّق التأثير، ويمنح "دورًا إضافيًا" لا يستهلك الدور:
-- turn_player_id يبقى كما هو، يكبر turn_deadline فقط. جرعة واحدة لكل دور
-- (تُحدَّد بأن أخر جرعة مستخدمة أُحصِيت في نفس رقم دور اللاعب).
alter table public.pvp_matches add column if not exists player1_last_potion_turn integer not null default 0;
alter table public.pvp_matches add column if not exists player2_last_potion_turn integer not null default 0;

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
    v_opp_id uuid;
    v_opp_hp int;
    v_opp_max int;
    v_opp_temp_atk int;
    v_opp_temp_hp int;
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

    -- جرعة واحدة لكل دور: إن كانت آخر جرعة منك سُجِّلت في نفس رقم دورك، امنع مرة أخرى
    if (v_is_p1 and v_match.player1_last_potion_turn >= v_match.player1_turns_taken)
       or (not v_is_p1 and v_match.player2_last_potion_turn >= v_match.player2_turns_taken) then
        raise exception 'استخدمت جرعة في هذا الدور بالفعل';
    end if;

    -- مجمّد لا يمكنه حتى استخدام الجرعة
    if (v_is_p1 and coalesce(v_match.player1_frozen_turns,0) > 0)
       or (not v_is_p1 and coalesce(v_match.player2_frozen_turns,0) > 0) then
        raise exception 'أنت مجمد ولا تستطيع الحركة هذا الدور';
    end if;

    update public.player_potions set quantity = quantity - 1
     where player_id = v_player and potion_id = p_potion_id and quantity > 0;
    if not found then raise exception 'لا تملك هذه الجرعة'; end if;

    select * into v_potion from public.potions po where po.id = p_potion_id;

    if v_is_p1 then
        v_opp_id := v_match.player2_id;
        v_opp_hp := v_match.player2_hp;
        v_opp_max := v_match.player2_max_hp;
        v_opp_temp_atk := v_match.player2_temp_atk;
        v_opp_temp_hp := v_match.player2_temp_hp;
    else
        v_opp_id := v_match.player1_id;
        v_opp_hp := v_match.player1_hp;
        v_opp_max := v_match.player1_max_hp;
        v_opp_temp_atk := v_match.player1_temp_atk;
        v_opp_temp_hp := v_match.player1_temp_hp;
    end if;

    v_heal := 0;
    if v_potion.effect_type = 'heal' then
        v_heal := coalesce(v_potion.effect_value, 0)::int;
    elsif v_potion.effect_type = 'heal_percent' then
        v_heal := round((coalesce(v_potion.effect_value,0) / 100.0) * v_opp_max)::int;
    end if;

    if v_is_p1 then
        if v_heal > 0 then
            v_match.player2_hp := least(v_match.player2_max_hp, v_match.player2_hp + v_heal);
        elsif v_potion.effect_type = 'reset_cooldown' then
            delete from pvp_cooldowns where match_id = p_match_id and player_id = v_player;
        elsif v_potion.effect_type = 'atk_boost' then
            v_match.player2_temp_atk := v_match.player2_temp_atk + coalesce(v_potion.effect_value,0)::int;
        elsif v_potion.effect_type = 'shield' then
            v_match.player2_temp_hp := v_match.player2_temp_hp + coalesce(v_potion.effect_value,0)::int;
        elsif v_potion.effect_type = 'skill' then
            perform public.pvp_apply_potion_skill(
                v_potion.effect_skill_id, p_match_id, v_player, true);
        end if;
        if v_potion.effect_type = 'skill' then
            select player2_hp into v_match.player2_hp from pvp_matches where id = p_match_id;
        end if;
        update pvp_matches set
            player1_last_potion_turn = v_match.player1_turns_taken,
            player2_hp = v_match.player2_hp,
            player2_temp_atk = v_match.player2_temp_atk,
            player2_temp_hp = v_match.player2_temp_hp,
            turn_deadline = now() + interval '60 seconds',
            updated_at = now()
        where id = p_match_id;
    else
        if v_heal > 0 then
            v_match.player1_hp := least(v_match.player1_max_hp, v_match.player1_hp + v_heal);
        elsif v_potion.effect_type = 'reset_cooldown' then
            delete from pvp_cooldowns where match_id = p_match_id and player_id = v_player;
        elsif v_potion.effect_type = 'atk_boost' then
            v_match.player1_temp_atk := v_match.player1_temp_atk + coalesce(v_potion.effect_value,0)::int;
        elsif v_potion.effect_type = 'shield' then
            v_match.player1_temp_hp := v_match.player1_temp_hp + coalesce(v_potion.effect_value,0)::int;
        elsif v_potion.effect_type = 'skill' then
            perform public.pvp_apply_potion_skill(
                v_potion.effect_skill_id, p_match_id, v_player, false);
        end if;
        if v_potion.effect_type = 'skill' then
            select player1_hp into v_match.player1_hp from pvp_matches where id = p_match_id;
        end if;
        update pvp_matches set
            player2_last_potion_turn = v_match.player2_turns_taken,
            player1_hp = v_match.player1_hp,
            player1_temp_atk = v_match.player1_temp_atk,
            player1_temp_hp = v_match.player1_temp_hp,
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

-- يطبّق مهارة مدمجة في جرعة داخل مباراة PvP عبر محرك التأثيرات نفسه
create or replace function public.pvp_apply_potion_skill(
    p_skill_id uuid, p_match_id uuid, p_player uuid, p_is_p1 boolean)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare
    v_skill record;
    v_match record;
    v_self pvp_fighter_state;
    v_opp  pvp_fighter_state;
    v_out  pvp_effect_out;
    v_opponent_id uuid;
begin
    select * into v_skill from public.skills where id = p_skill_id;
    if v_skill.id is null then return; end if;

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
        v_skill.type, v_skill.effect, coalesce(v_skill.damage, 0),
        coalesce(v_skill.unblockable, false), v_skill.params, v_self, v_opp, false);

    v_self := v_out.self;
    v_opp  := v_out.opp;

    if v_out.heal > 0 then
        v_self.hp := least(v_self.max_hp, v_self.hp + v_out.heal);
    end if;
    if coalesce(v_skill.type, '') = 'defense' then
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

    -- إظهار المهارة المدمجة للخصم بعد استخدامها
    insert into revealed_skills(owner_id, viewer_player_id, skill_id, battle_id)
    values (p_player, v_opponent_id, p_skill_id, p_match_id)
    on conflict (owner_id, viewer_player_id, skill_id) do nothing;
end;
$fn$;