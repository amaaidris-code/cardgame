-- • عند حذف حساب لاعب، كان تقدم شخصيته (player_characters.level/hp/atk) يُحذف
--   تلقائيًا عبر cascade، وتُعاد الشخصية للمجتمع كـ"قالب" بمستوى 1 وإحصاءات أساسية،
--   فيستحوذ عليها لاعب جديد ويرفعها من الصفر ليكسب مهارات إضافية (استغلال).
--
-- • الحل:
--   1) نضيف علامة characters.inherited للشخصية الموروثة من حساب محذوف.
--   2) في admin_delete_player نُثبّت مستوى/إحصاءات تقدم اللاعب المحذوف في سطر
--      characters نفسه (قبل أن يحذف cascade الصفوف) ونعلّمها inherited.
--   3) في claim_character، يستحوذ اللاعب الجديد على الشخصية بمستواها وإحصاءاتها
--      المحفوظة (لا إعادة من الصفر).
--   4) الشخصية الموروثة لا يمكن رفع مستواها بعد الآن (لا مهارات جديدة).

alter table public.characters add column if not exists inherited boolean not null default false;

-- ---------- حذف اللاعب: احفظ التقدم وعلّم الشخصية "موروثة" ----------
create or replace function public.admin_delete_player(p_admin_token text, p_player_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_admin_id uuid;
  v_user_id uuid;
begin
  v_admin_id := admin_id_from_token(p_admin_token);

  if exists (select 1 from admins where player_id = p_player_id) then
    raise exception 'لا يمكن حذف هذا الحساب لأنه حساب اختبار مرتبط بأدمن';
  end if;

  select user_id into v_user_id from players where id = p_player_id;

  if v_user_id is null then
    raise exception 'اللاعب غير موجود';
  end if;

  -- احفظ تقدم اللاعب المحذوف (المستوى/الصحّة/الهجوم) في سطر الشخصية نفسها
  -- قبل أن يُحذف cascade صفوف player_characters، وعلّمها موروثة حتى لا تُرفع مجددًا.
  update characters c
     set inherited = true,
         level = coalesce((
           select pc.level from player_characters pc
            where pc.character_id = c.id and pc.player_id = p_player_id
         ), c.level),
         hp = coalesce((
           select pc.hp from player_characters pc
            where pc.character_id = c.id and pc.player_id = p_player_id
         ), c.hp),
         atk = coalesce((
           select pc.atk from player_characters pc
            where pc.character_id = c.id and pc.player_id = p_player_id
         ), c.atk)
   where c.owner_id = p_player_id;

  -- إبقاء المهارات الأساسية الثلاث الأولى فقط وحذف ما بعدها
  delete from character_skills cs
  where cs.slot > 3
    and exists (
      select 1 from characters c
      where c.id = cs.character_id
        and c.owner_id = p_player_id
    );

  delete from clan_members where player_id = p_player_id;
  delete from pvp_matches where player1_id = p_player_id or player2_id = p_player_id;
  delete from pvp_cooldowns where player_id = p_player_id;
  delete from clan_dungeon_players where player_id = p_player_id;
  delete from clan_dungeon_claims where claimed_by = p_player_id;
  delete from friends where player_id = p_player_id or friend_id = p_player_id;
  delete from friend_requests where from_player_id = p_player_id or to_player_id = p_player_id;
  delete from skill_requests where player_id = p_player_id;

  delete from users where id = v_user_id;
end;
$function$;

-- ---------- الاستحواذ: الموروثة تأتي بمستواها وإحصاءاتها المحفوظة ----------
create or replace function public.claim_character(p_token text, p_character_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  p_player_id uuid;
  char_row characters%rowtype;
  player_row players%rowtype;
begin
  p_player_id := player_id_from_token(p_token);

  select * into player_row from players where id = p_player_id for update;

  if player_row.id is null then
    raise exception 'لاعب غير صحيح';
  end if;

  if player_row.has_character then
    raise exception 'لديك شخصية بالفعل';
  end if;

  select * into char_row from characters where id = p_character_id for update;

  if char_row.id is null then
    raise exception 'الشخصية غير موجودة';
  end if;

  if char_row.owner_id is not null then
    raise exception 'الشخصية مأخوذة بالفعل';
  end if;

  if char_row.is_monster then
    raise exception 'لا يمكن اختيار وحش كشخصية';
  end if;

  if char_row.admin_only then
    raise exception 'هذه الشخصية غير متاحة';
  end if;

  insert into player_characters(player_id, character_id, level, hp, atk)
  values (p_player_id, p_character_id,
          case when char_row.inherited then coalesce(char_row.level,1) else 1 end,
          coalesce(char_row.hp,100),
          coalesce(char_row.atk,100));

  update characters set owner_id = p_player_id where id = p_character_id;

  update players set has_character = true, active_character_id = p_character_id where id = p_player_id;
end;
$function$;

-- ---------- منع رفع الشخصية الموروثة (لا مهارات جديدة) ----------
create or replace function public.upgrade_player_character(p_token text, p_hp_gain integer, p_atk_gain integer, p_skill_type text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  p_player_id uuid;
  active_id uuid;
  pc_row player_characters%rowtype;
  v_max_level int;
  v_cost int;
  v_gold int;
  v_is_admin boolean;
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

  select active_character_id into active_id from players where id = p_player_id;
  if active_id is null then raise exception 'لا توجد شخصية نشطة'; end if;

  select * into pc_row from player_characters where player_id = p_player_id and character_id = active_id for update;
  if pc_row.id is null then raise exception 'لم يتم العثور على الشخصية'; end if;

  if exists(select 1 from public.characters c where c.id = active_id and c.inherited) then
    raise exception 'لا يمكن ترقية هذه الشخصية الموروثة';
  end if;

  select exists(select 1 from characters c where c.id = active_id and c.admin_only = true) into v_is_admin;

  if pc_row.level >= v_max_level then raise exception 'وصلت الشخصية إلى الحد الأقصى للمستوى'; end if;

  v_new_level := pc_row.level + 1;

  select coalesce(skill_reward,'none') into v_reward from public.level_up_gold_cost where level = v_new_level;
  v_reward := coalesce(v_reward, 'none');

  if v_reward = 'normal' then
    if p_skill_type is null or p_skill_type not in ('attack','defense') then
      raise exception 'اختر نوع المهارة (هجوم أو دفاع) لهذا المستوى';
    end if;
  elsif v_reward = 'unique' then
    p_skill_type := null;
  end if;

  select gold_cost into v_cost from public.level_up_gold_cost where level = pc_row.level;
  v_cost := coalesce(v_cost, 0);
  if v_cost > 0 then
    update players set gold = gold - v_cost where id = p_player_id;
    select gold into v_gold from players where id = p_player_id;
    if v_gold < 0 then
      update players set gold = gold + v_cost where id = p_player_id;
      raise exception 'لا يوجد ذهب كافٍ لهذه الترقية';
    end if;
  end if;

  update player_characters
  set level = pc_row.level + 1,
      hp = pc_row.hp + p_hp_gain,
      atk = pc_row.atk + p_atk_gain
  where id = pc_row.id;

  if v_is_admin then
    update characters
    set level = pc_row.level + 1,
        hp = pc_row.hp + p_hp_gain,
        atk = pc_row.atk + p_atk_gain
    where id = active_id;
  end if;

  if v_reward <> 'none' then
    insert into public.skill_requests (player_id, character_id, level, reward_type, skill_type)
    values (p_player_id, active_id, v_new_level, v_reward, p_skill_type);
  end if;
end;
$function$;

-- ---------- عرض: الموروثة تُعرض كـ"لا يمكن رفعها" ----------
create or replace function public.get_player_level_up_quote(p_token text)
 returns table (gold integer, level integer, hp integer, atk integer, max_level integer, next_level integer, next_cost integer, at_max boolean, next_reward text)
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_player_id uuid;
  v_active uuid;
  v_row player_characters%rowtype;
  v_max int;
  v_cost int;
  v_reward text;
  v_locked boolean;
begin
  v_player_id := player_id_from_token(p_token);
  if v_player_id is null then raise exception 'غير مصرح'; end if;

  select active_character_id into v_active from public.players where id = v_player_id;
  if v_active is null then return; end if;

  select * into v_row from public.player_characters
  where player_id = v_player_id and character_id = v_active;

  if v_row.id is null then return; end if;

  select value into v_max from public.game_config where key = 'max_level';
  v_max := coalesce(v_max, 50);

  select c.inherited into v_locked from public.characters c where c.id = v_active;
  v_locked := coalesce(v_locked, false);

  if not v_locked and v_row.level < v_max then
    select l.gold_cost into v_cost from public.level_up_gold_cost l where l.level = v_row.level;
    v_cost := coalesce(v_cost, 0);
    select l.skill_reward into v_reward from public.level_up_gold_cost l where l.level = v_row.level + 1;
    v_reward := coalesce(v_reward, 'none');
  else
    v_cost := 0;
    v_reward := 'none';
  end if;

  return query
  select p.gold, v_row.level, v_row.hp, v_row.atk, v_max,
         v_row.level + 1, v_cost, (v_row.level >= v_max or v_locked), v_reward
  from public.players p
  where p.id = v_player_id;
end;
$function$;