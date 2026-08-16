-- ============================================================
-- نظام المرافقين (Companions System)
-- مرافق مثل الشخصية: له HP/ATK/مهارات ويقاتل بدوره الخاص المنفصل
-- عن اللاعب. يُشترى من المتجر، ويُجهَّز/يُلغى تجهيزه مثل الأسلحة
-- (يملك الواحد أكثر من مرافق لكن لا يجهز إلا واحدًا في الوقت نفسه).
-- له منحنى مستويات وتكلفة ذهب مختلفة عن الشخصيات، ومصدر مهاراتها
-- طلبات اعتماد مستقلة خاصة بها.
-- ============================================================

-- ---------- جداول ----------
create table if not exists public.companions (
    id               uuid primary key default gen_random_uuid(),
    name             text not null default '',
    description      text,
    image            text,
    skill_card_image text,
    price            numeric not null default 0,
    base_hp          integer not null default 100,
    base_atk         integer not null default 100,
    stock            integer,
    infinite         boolean not null default false,
    available        boolean not null default true,
    glow_color       text default '#22c55e',
    created_at       timestamptz not null default now()
);
alter table public.companions enable row level security;

create table if not exists public.companion_skills (
    companion_id uuid not null references public.companions(id) on delete cascade,
    skill_id     uuid not null references public.skills(id) on delete cascade,
    slot         integer not null default 0,
    primary key (companion_id, skill_id)
);
alter table public.companion_skills enable row level security;

create table if not exists public.player_companions (
    id             uuid primary key default gen_random_uuid(),
    player_id      uuid not null references public.players(id) on delete cascade,
    companion_id   uuid not null references public.companions(id) on delete cascade,
    level          integer not null default 1,
    hp             integer not null default 100,
    atk            integer not null default 100,
    created_at     timestamptz not null default now()
);
alter table public.player_companions enable row level security;

alter table public.players add column if not exists active_companion_id uuid;

-- منحنى مستويات المرافقين (منفصل تمامًا عن level_up_gold_cost الخاص بالشخصيات)
create table if not exists public.companion_level_cost (
    level         integer primary key,
    gold_cost     integer not null default 0,
    skill_reward  text not null default 'none' check (skill_reward in ('none','normal','unique'))
);
alter table public.companion_level_cost enable row level security;

-- طلبات مهارات المرافقين (مصدر مهارة المرافق مختلف عن الشخصية)
create table if not exists public.companion_skill_requests (
    id            uuid primary key default gen_random_uuid(),
    player_id     uuid not null references public.players(id) on delete cascade,
    companion_id  uuid not null references public.companions(id) on delete cascade,
    level         integer not null,
    reward_type   text not null check (reward_type in ('normal','unique')),
    skill_type    text check (skill_type in ('attack','defense')),
    status        text not null default 'pending' check (status in ('pending','approved','denied')),
    created_at    timestamptz not null default now()
);
alter table public.companion_skill_requests enable row level security;

-- ---------- لوحة الإدارة ----------
create or replace function public.admin_list_companions(p_admin_token text)
returns table (id uuid, name text, description text, image text, skill_card_image text,
               price numeric, base_hp integer, base_atk integer, stock integer, infinite boolean,
               available boolean, glow_color text, created_at timestamptz, sold numeric)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    return query
        select c.id, c.name, c.description, c.image, c.skill_card_image,
               c.price, c.base_hp, c.base_atk, c.stock, c.infinite, c.available, c.glow_color,
               c.created_at,
               (select count(*)::numeric from public.player_companions pc where pc.companion_id = c.id) as sold
        from public.companions c
        order by c.created_at;
end;
$fn$;

create or replace function public.admin_get_companion(p_admin_token text, p_companion_id uuid)
returns table (id uuid, name text, description text, image text, skill_card_image text,
               price numeric, base_hp integer, base_atk integer, stock integer, infinite boolean,
               available boolean, glow_color text, sold numeric, skills jsonb)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    return query
        select c.id, c.name, c.description, c.image, c.skill_card_image,
               c.price, c.base_hp, c.base_atk, c.stock, c.infinite, c.available, c.glow_color,
               (select count(*)::numeric from public.player_companions pc where pc.companion_id = c.id) as sold,
               coalesce((
                   select jsonb_agg(jsonb_build_object(
                       'id', s.id, 'name', s.name, 'type', s.type, 'damage', s.damage,
                       'cooldown', s.cooldown, 'effect', s.effect, 'unblockable', s.unblockable,
                       'description', s.description, 'color', s.color,
                       'stroke_color', s.stroke_color, 'stroke_width', s.stroke_width,
                       'params', s.params, 'slot', cs.slot
                   ) order by cs.slot)
                   from public.companion_skills cs join public.skills s on s.id = cs.skill_id
                   where cs.companion_id = c.id
               ), '[]'::jsonb)
        from public.companions c
        where c.id = p_companion_id;
end;
$fn$;

create or replace function public.admin_add_companion(
    p_admin_token text, p_name text, p_description text, p_image text, p_skill_card_image text,
    p_price numeric, p_base_hp integer, p_base_atk integer, p_stock integer, p_infinite boolean, p_glow_color text)
returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_id uuid;
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    insert into public.companions(name, description, image, skill_card_image, price,
                                  base_hp, base_atk, stock, infinite, glow_color)
    values (coalesce(p_name,''), p_description, p_image, p_skill_card_image, coalesce(p_price,0),
            coalesce(p_base_hp,100), coalesce(p_base_atk,100),
            p_stock, coalesce(p_infinite,false), coalesce(p_glow_color,'#22c55e'))
    returning id into v_id;
    return v_id;
end;
$fn$;

create or replace function public.admin_save_companion(
    p_admin_token text, p_companion_id uuid, p_name text, p_description text, p_image text,
    p_skill_card_image text, p_price numeric, p_base_hp integer, p_base_atk integer,
    p_stock integer, p_infinite boolean, p_glow_color text)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    update public.companions set
        name = coalesce(p_name,''),
        description = p_description,
        image = p_image,
        skill_card_image = p_skill_card_image,
        price = coalesce(p_price,0),
        base_hp = coalesce(p_base_hp,100),
        base_atk = coalesce(p_base_atk,100),
        stock = p_stock,
        infinite = coalesce(p_infinite,false),
        glow_color = coalesce(p_glow_color,'#22c55e')
    where id = p_companion_id;
end;
$fn$;

create or replace function public.admin_delete_companion(p_admin_token text, p_companion_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    update public.players set active_companion_id = null where active_companion_id in
        (select id from public.player_companions where companion_id = p_companion_id);
    delete from public.player_companions where companion_id = p_companion_id;
    delete from public.companions where id = p_companion_id;
end;
$fn$;

create or replace function public.admin_add_companion_skill(
    p_admin_token text, p_companion_id uuid, p_name text, p_type text, p_damage integer,
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
    select coalesce(max(slot),0)+1 into v_slot from public.companion_skills where companion_id = p_companion_id;
    insert into public.companion_skills(companion_id, skill_id, slot) values (p_companion_id, v_skill, v_slot);
end;
$fn$;

create or replace function public.admin_update_companion_skill(
    p_admin_token text, p_companion_id uuid, p_skill_id uuid, p_name text, p_type text,
    p_damage integer, p_cooldown integer, p_effect text, p_unblockable boolean,
    p_description text, p_color text, p_params jsonb, p_stroke_color text, p_stroke_width integer)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    if not exists (select 1 from public.companion_skills where companion_id = p_companion_id and skill_id = p_skill_id) then
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

create or replace function public.admin_remove_companion_skill(
    p_admin_token text, p_companion_id uuid, p_skill_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
begin
    if not is_valid_admin_session(p_admin_token) then raise exception 'غير مصرح'; end if;
    delete from public.companion_skills where companion_id = p_companion_id and skill_id = p_skill_id;
end;
$fn$;

-- منحنى مستويات المرافقين (إدارة)
create or replace function public.admin_get_companion_level_costs(p_admin_token text)
returns table (level integer, gold_cost integer, skill_reward text)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_admin_id uuid;
begin
  v_admin_id := admin_id_from_token(p_admin_token);
  if v_admin_id is null then raise exception 'غير مصرح'; end if;
  return query select c.level, c.gold_cost, c.skill_reward from public.companion_level_cost c order by c.level;
end;
$fn$;

create or replace function public.admin_set_companion_level_cost(p_admin_token text, p_level integer, p_gold_cost integer)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_admin_id uuid;
begin
  v_admin_id := admin_id_from_token(p_admin_token);
  if v_admin_id is null then raise exception 'غير مصرح'; end if;
  if p_level is null or p_level < 1 then raise exception 'مستوى غير صحيح'; end if;
  if p_gold_cost is null or p_gold_cost < 0 then raise exception 'تكلفة غير صحيحة'; end if;
  insert into public.companion_level_cost (level, gold_cost) values (p_level, p_gold_cost)
  on conflict (level) do update set gold_cost = excluded.gold_cost;
end;
$fn$;

create or replace function public.admin_set_companion_level_reward(p_admin_token text, p_level integer, p_reward text)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_admin_id uuid;
begin
  v_admin_id := admin_id_from_token(p_admin_token);
  if v_admin_id is null then raise exception 'غير مصرح'; end if;
  if p_level is null or p_level < 1 then raise exception 'مستوى غير صحيح'; end if;
  if p_reward is null or p_reward not in ('none','normal','unique') then raise exception 'مكافأة غير صحيحة'; end if;
  insert into public.companion_level_cost (level, gold_cost, skill_reward) values (p_level, 0, p_reward)
  on conflict (level) do update set skill_reward = excluded.skill_reward;
end;
$fn$;

-- ---------- اللاعب: المتجر والتجهيز ----------
create or replace function public.shop_list_companions(p_token text)
returns table (id uuid, name text, description text, image text, skill_card_image text,
               price numeric, base_hp integer, base_atk integer, infinite boolean, stock integer, glow_color text)
language sql security definer set search_path = public, extensions, pg_temp
as $fn$
    select c.id, c.name, c.description, c.image, c.skill_card_image,
           c.price, c.base_hp, c.base_atk, c.infinite, coalesce(c.stock,0), c.glow_color
    from public.companions c
    where c.available = true and (c.infinite = true or coalesce(c.stock,0) > 0)
    order by c.price, c.created_at;
$fn$;

create or replace function public.shop_buy_companion(p_token text, p_companion_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_player uuid; v_price numeric; v_base_hp integer; v_base_atk integer; v_stock integer; v_infinite boolean;
begin
    v_player := player_id_from_token(p_token);
    if v_player is null then raise exception 'غير مصرح'; end if;
    select c.price, c.base_hp, c.base_atk, c.stock, c.infinite
      into v_price, v_base_hp, v_base_atk, v_stock, v_infinite
      from public.companions c
      where c.id = p_companion_id and c.available = true
      for update;
    if not found then raise exception 'هذا المرافق غير متوفر'; end if;
    if not v_infinite and coalesce(v_stock,0) <= 0 then
        raise exception 'نفدت نسخ هذا المرافق';
    end if;
    if not exists (select 1 from public.players where id = v_player and gold >= v_price) then
        raise exception 'لا يوجد ذهب كافٍ لشراء هذا المرافق';
    end if;
    update public.players set gold = gold - v_price where id = v_player;
    if not v_infinite then
        update public.companions set stock = stock - 1 where id = p_companion_id;
    end if;
    insert into public.player_companions(player_id, companion_id, level, hp, atk)
    values (v_player, p_companion_id, 1, v_base_hp, v_base_atk);
end;
$fn$;

create or replace function public.set_active_companion(p_token text, p_player_companion_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_player uuid;
begin
    v_player := player_id_from_token(p_token);
    if v_player is null then raise exception 'غير مصرح'; end if;
    if p_player_companion_id is not null and
       not exists (select 1 from public.player_companions where id = p_player_companion_id and player_id = v_player) then
        raise exception 'هذا المرافق ليس ملكك';
    end if;
    update public.players set active_companion_id = p_player_companion_id where id = v_player;
end;
$fn$;

-- يعيد المرافقين الذين يملكهم اللاعب مع حالة التجهيز
create or replace function public.get_my_companions(p_token text)
returns table (pc_id uuid, companion_id uuid, name text, image text, skill_card_image text,
               glow_color text, price numeric, level integer, hp integer, atk integer, is_active boolean)
language sql security definer set search_path = public, extensions, pg_temp
as $fn$
    select pc.id, c.id, c.name, c.image, c.skill_card_image, c.glow_color, c.price,
           pc.level, pc.hp, pc.atk,
           (pl.active_companion_id = pc.id) as is_active
    from public.player_companions pc
    join public.companions c on c.id = pc.companion_id
    join public.players pl on pl.id = pc.player_id
    where pc.player_id = public.player_id_from_token(p_token)
    order by pc.created_at;
$fn$;

-- يعيد المرافق النشط مع مهاراته وإحصائياته الحالية (للمعارك)
create or replace function public.get_my_active_companion(p_token text)
returns table (pc_id uuid, companion_id uuid, name text, image text, skill_card_image text,
               glow_color text, level integer, hp integer, atk integer, skills jsonb)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_player uuid; v_pc uuid; v_companion uuid;
begin
    v_player := player_id_from_token(p_token);
    if v_player is null then raise exception 'غير مصرح'; end if;
    select active_companion_id into v_pc from public.players where id = v_player;
    if v_pc is null then return; end if;
    select companion_id into v_companion from public.player_companions where id = v_pc;
    return query
        select pc.id, c.id, c.name, c.image, c.skill_card_image, c.glow_color,
               pc.level, pc.hp, pc.atk,
               coalesce((
                   select jsonb_agg(jsonb_build_object(
                       'id', s.id, 'name', s.name, 'type', s.type, 'damage', s.damage,
                       'cooldown', s.cooldown, 'effect', s.effect, 'unblockable', s.unblockable,
                       'description', s.description, 'color', s.color,
                       'stroke_color', s.stroke_color, 'stroke_width', s.stroke_width,
                       'params', s.params, 'slot', cs.slot
                   ) order by cs.slot)
                   from public.companion_skills cs join public.skills s on s.id = cs.skill_id
                   where cs.companion_id = c.id
               ), '[]'::jsonb)
        from public.player_companions pc
        join public.companions c on c.id = pc.companion_id
        where pc.id = v_pc;
end;
$fn$;

-- ---------- تطوير المرافق (منحنى مستويات خاص به) ----------
create or replace function public.get_companion_level_up_quote(p_token text)
returns table (gold integer, level integer, hp integer, atk integer, max_level integer, next_level integer, next_cost integer, at_max boolean, next_reward text)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare
  v_player_id uuid;
  v_active uuid;
  v_row player_companions%rowtype;
  v_max int;
  v_cost int;
  v_reward text;
begin
  v_player_id := player_id_from_token(p_token);
  if v_player_id is null then raise exception 'غير مصرح'; end if;

  select active_companion_id into v_active from public.players where id = v_player_id;
  if v_active is null then return; end if;

  select * into v_row from public.player_companions where id = v_active;

  if v_row.id is null then return; end if;

  select value into v_max from public.game_config where key = 'max_level';
  v_max := coalesce(v_max, 50);

  if v_row.level < v_max then
    select c.gold_cost into v_cost from public.companion_level_cost c where c.level = v_row.level;
    v_cost := coalesce(v_cost, 0);
    select c.skill_reward into v_reward from public.companion_level_cost c where c.level = v_row.level + 1;
    v_reward := coalesce(v_reward, 'none');
  else
    v_cost := 0;
    v_reward := 'none';
  end if;

  return query
  select p.gold, v_row.level, v_row.hp, v_row.atk, v_max,
         v_row.level + 1, v_cost, (v_row.level >= v_max), v_reward
  from public.players p
  where p.id = v_player_id;
end;
$fn$;

create or replace function public.upgrade_companion(p_token text, p_hp_gain integer, p_atk_gain integer, p_skill_type text default null)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare
  p_player_id uuid;
  active_id uuid;
  pc_row player_companions%rowtype;
  v_max_level int;
  v_cost int;
  v_gold int;
  v_new_level int;
  v_reward text;
begin
  p_player_id := player_id_from_token(p_token);
  if p_player_id is null then raise exception 'غير مصرح'; end if;
  if p_hp_gain is null or p_atk_gain is null then raise exception 'حدد توزيع الزيادة'; end if;
  if p_hp_gain + p_atk_gain <> 200 then raise exception 'يجب أن يكون مجموع HP وATK 200 تمامًا'; end if;
  if p_hp_gain < 50 or p_atk_gain < 50 then raise exception 'يجب رفع كل من HP وATK بما لا يقل عن 50'; end if;
  if p_hp_gain % 50 <> 0 or p_atk_gain % 50 <> 0 then raise exception 'يجب أن تكون الزيادات مضاعفات 50'; end if;

  select value into v_max_level from public.game_config where key = 'max_level';
  v_max_level := coalesce(v_max_level, 50);

  select active_companion_id into active_id from players where id = p_player_id;
  if active_id is null then raise exception 'لا يوجد مرافق نشط'; end if;

  select * into pc_row from player_companions where id = active_id for update;
  if pc_row.id is null then raise exception 'لم يتم العثور على المرافق'; end if;

  if pc_row.level >= v_max_level then raise exception 'وصل المرافق إلى الحد الأقصى للمستوى'; end if;

  v_new_level := pc_row.level + 1;

  select coalesce(skill_reward,'none') into v_reward from public.companion_level_cost where level = v_new_level;
  v_reward := coalesce(v_reward, 'none');

  if v_reward = 'normal' then
    if p_skill_type is null or p_skill_type not in ('attack','defense') then
      raise exception 'اختر نوع المهارة (هجوم أو دفاع) لهذا المستوى';
    end if;
  elsif v_reward = 'unique' then
    p_skill_type := null;
  end if;

  select gold_cost into v_cost from public.companion_level_cost where level = pc_row.level;
  v_cost := coalesce(v_cost, 0);
  if v_cost > 0 then
    update players set gold = gold - v_cost where id = p_player_id;
    select gold into v_gold from players where id = p_player_id;
    if v_gold < 0 then
      update players set gold = gold + v_cost where id = p_player_id;
      raise exception 'لا يوجد ذهب كافٍ لهذه الترقية';
    end if;
  end if;

  update player_companions
  set level = pc_row.level + 1,
      hp = pc_row.hp + p_hp_gain,
      atk = pc_row.atk + p_atk_gain
  where id = pc_row.id;

  if v_reward <> 'none' then
    insert into public.companion_skill_requests (player_id, companion_id, level, reward_type, skill_type)
    values (p_player_id, pc_row.companion_id, v_new_level, v_reward, p_skill_type);
  end if;
end;
$fn$;

-- ---------- طلبات مهارات المرافقين (إدارة) ----------
create or replace function public.admin_list_companion_skill_requests(p_admin_token text)
returns table (request_id uuid, player_id uuid, companion_id uuid, level integer, reward_type text, skill_type text, status text, created_at timestamptz, username text, companion_name text)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_admin_id uuid;
begin
  v_admin_id := admin_id_from_token(p_admin_token);
  if v_admin_id is null then raise exception 'غير مصرح'; end if;
  return query
  select r.id, r.player_id, r.companion_id, r.level, r.reward_type, r.skill_type, r.status, r.created_at,
         coalesce(u.username,''), coalesce(c.name,'')
  from public.companion_skill_requests r
  left join public.players p on p.id = r.player_id
  left join public.users u on u.id = p.user_id
  left join public.companions c on c.id = r.companion_id
  order by r.created_at desc;
end;
$fn$;

create or replace function public.admin_approve_companion_skill_request(
    p_admin_token text, p_request_id uuid, p_name text, p_type text, p_damage integer,
    p_cooldown integer, p_effect text, p_unblockable boolean,
    p_description text default null, p_color text default null, p_params jsonb default '{}'::jsonb,
    p_stroke_color text default null, p_stroke_width integer default 0)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare
  v_admin_id uuid;
  v_req record;
  v_type text;
  v_effect text;
  v_unblockable boolean;
  new_skill_id uuid;
  next_slot int;
begin
  v_admin_id := admin_id_from_token(p_admin_token);
  if v_admin_id is null then raise exception 'غير مصرح'; end if;

  select * into v_req from public.companion_skill_requests where id = p_request_id for update;
  if v_req.id is null then raise exception 'الطلب غير موجود'; end if;
  if v_req.status <> 'pending' then raise exception 'تمت معالجة هذا الطلب مسبقًا'; end if;
  if p_name is null or trim(p_name) = '' then raise exception 'اكتب اسم المهارة'; end if;

  if v_req.reward_type = 'normal' then
    v_type := v_req.skill_type;
    v_effect := null;
    v_unblockable := false;
  else
    v_type := p_type;
    v_effect := p_effect;
    v_unblockable := coalesce(p_unblockable, false);
  end if;

  if v_type is null then raise exception 'نوع المهارة مطلوب'; end if;

  insert into public.skills(name, type, damage, cooldown, effect, unblockable, description, color, params, stroke_color, stroke_width)
  values (p_name, v_type, coalesce(p_damage,0), coalesce(p_cooldown,0), v_effect, v_unblockable,
          p_description, p_color, coalesce(p_params,'{}'::jsonb), p_stroke_color, coalesce(p_stroke_width,0))
  returning id into new_skill_id;

  select coalesce(max(slot),0)+1 into next_slot from public.companion_skills where companion_id = v_req.companion_id;

  insert into public.companion_skills(companion_id, skill_id, slot)
  values (v_req.companion_id, new_skill_id, next_slot);

  update public.companion_skill_requests set status = 'approved' where id = p_request_id;
end;
$fn$;

create or replace function public.admin_deny_companion_skill_request(p_admin_token text, p_request_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $fn$
declare v_admin_id uuid; v_count int;
begin
  v_admin_id := admin_id_from_token(p_admin_token);
  if v_admin_id is null then raise exception 'غير مصرح'; end if;
  update public.companion_skill_requests set status = 'denied' where id = p_request_id and status = 'pending';
  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'الطلب غير موجود أو تمت معالجته مسبقًا'; end if;
end;
$fn$;