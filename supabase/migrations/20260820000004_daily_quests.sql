-- ===== المهام اليومية =====

create table if not exists public.daily_quests (
    day_key text not null,
    quest_key text not null,
    title text not null,
    description text not null,
    target integer not null default 1,
    reward integer not null default 100,
    active boolean not null default true,
    primary key (day_key, quest_key)
);

create table if not exists public.player_daily_progress (
    player_id uuid not null references public.players(id) on delete cascade,
    day_key text not null,
    quest_key text not null,
    progress integer not null default 0,
    completed boolean not null default false,
    claimed boolean not null default false,
    primary key (player_id, day_key, quest_key)
);

-- زرع المهام الأساسية ليوم معيّن
create or replace function public.daily_quests_seed(p_day_key text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  insert into public.daily_quests (day_key, quest_key, title, description, target, reward)
  values
    (p_day_key, 'win_battles', 'انتصارات (3 معارك)', 'افز بـ 3 معارك فردية اليوم', 3, 150),
    (p_day_key, 'complete_dungeons', 'استكمال زنزانة', 'أكمل زنزانة واحدة اليوم', 1, 250)
  on conflict (day_key, quest_key) do nothing;
end;
$fn$;

-- إضافة تقدّم لمهمة اليوم (تُستدعى من دوال تسليم الجوائز عند الفوز)
create or replace function public.daily_quest_progress_add(p_token text, p_quest_key text, p_amount integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_player uuid;
  v_day text := to_char(current_date, 'YYYY-MM-DD');
  v_target int;
begin
  v_player := public.player_id_from_token(p_token);
  if v_player is null then raise exception 'غير مصرح'; end if;

  perform public.daily_quests_seed(v_day);

  select target into v_target from public.daily_quests
   where day_key = v_day and quest_key = p_quest_key and active;

  if v_target is null then return; end if;

  insert into public.player_daily_progress (player_id, day_key, quest_key, progress, completed)
  values (v_player, v_day, p_quest_key, p_amount, p_amount >= v_target)
  on conflict (player_id, day_key, quest_key)
  do update set
    progress = player_daily_progress.progress + p_amount,
    completed = player_daily_progress.progress + p_amount >= v_target;
end;
$fn$;

-- قائمة مهام اليوم مع حالة اللاعب
create or replace function public.daily_quests_list(p_token text)
returns table(day_key text, quest_key text, title text, description text, target integer, reward integer, progress integer, completed boolean, claimed boolean)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_player uuid;
  v_day text := to_char(current_date, 'YYYY-MM-DD');
begin
  v_player := public.player_id_from_token(p_token);
  if v_player is null then raise exception 'غير مصرح'; end if;

  perform public.daily_quests_seed(v_day);

  return query
  select q.day_key, q.quest_key, q.title, q.description, q.target, q.reward,
         coalesce(p.progress, 0)::integer as progress,
         coalesce(p.completed, false) as completed,
         coalesce(p.claimed, false) as claimed
    from public.daily_quests q
    left join public.player_daily_progress p
           on p.day_key = q.day_key and p.quest_key = q.quest_key and p.player_id = v_player
   where q.day_key = v_day and q.active
   order by q.reward desc;
end;
$fn$;

-- تسليم مكافأة مهمة اليوم
create or replace function public.daily_quest_claim(p_token text, p_quest_key text)
returns table(status text, gold_added integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_player uuid;
  v_day text := to_char(current_date, 'YYYY-MM-DD');
  v_reward int;
begin
  v_player := public.player_id_from_token(p_token);
  if v_player is null then raise exception 'غير مصرح'; end if;

  perform public.daily_quests_seed(v_day);

  select reward into v_reward from public.daily_quests
   where day_key = v_day and quest_key = p_quest_key and active;

  if v_reward is null then raise exception 'المهمة غير موجودة'; end if;

  if not exists (select 1 from public.player_daily_progress
                 where player_id = v_player and day_key = v_day
                   and quest_key = p_quest_key and completed and not claimed) then
    raise exception 'أكمل المهمة أولًا';
  end if;

  update public.player_daily_progress set claimed = true
   where player_id = v_player and day_key = v_day and quest_key = p_quest_key;

  update public.players set gold = gold + v_reward where id = v_player;

  return query select 'success'::text, v_reward;
end;
$fn$;

grant execute on function public.daily_quests_seed(text) to anon, authenticated;
grant execute on function public.daily_quest_progress_add(text, text, integer) to anon, authenticated;
grant execute on function public.daily_quests_list(text) to anon, authenticated;
grant execute on function public.daily_quest_claim(text, text) to anon, authenticated;

-- ربط التقدّم بنجاحات اللاعب (PvE + زنزانة)
create or replace function public.pve_claim_reward(p_token text, p_monster_id uuid)
returns table(status text, gold_added integer, remaining integer)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_player_id uuid; v_gold_prize int; v_limit int; v_used int; v_remaining int;
begin
  v_player_id := player_id_from_token(p_token);
  if v_player_id is null then raise exception 'غير مصرح'; end if;

  select gold_prize into v_gold_prize from public.characters where id = p_monster_id and is_monster = true;
  if not found then raise exception 'الوحش غير موجود'; end if;

  select value into v_limit from public.game_config where key = 'pve_daily_limit';
  v_limit := coalesce(v_limit, 3);

  select count(*) into v_used from public.pve_completions
  where player_id = v_player_id and completion_date = current_date;

  if v_used >= v_limit then raise exception 'وصلت إلى الحد اليومي لقتال الوحوش'; end if;

  insert into public.pve_completions (player_id, monster_id) values (v_player_id, p_monster_id);

  if v_gold_prize > 0 then
    update public.players set gold = gold + v_gold_prize where id = v_player_id;
  end if;

  perform public.daily_quest_progress_add(p_token, 'win_battles', 1);

  v_remaining := greatest(0, v_limit - v_used - 1);
  return query select 'success'::text, coalesce(v_gold_prize,0), v_remaining;
end;
$function$;

create or replace function public.pve_claim_reward(p_token text, p_monster_id uuid, p_session uuid)
returns table(status text, gold_added integer, remaining integer)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
    v_player_id uuid; v_gold_prize int; v_limit int; v_used int; v_remaining int;
begin
    v_player_id := public.player_id_from_token(p_token);
    if v_player_id is null then raise exception 'غير مصرح'; end if;

    perform public.try_consume_battle_session(p_token, 'pve', p_monster_id, p_session);

    select gold_prize into v_gold_prize from public.characters
      where id = p_monster_id and is_monster = true;
    if not found then raise exception 'الوحش غير موجود'; end if;

    select value into v_limit from public.game_config where key = 'pve_daily_limit';
    v_limit := coalesce(v_limit, 3);

    select count(*) into v_used from public.pve_completions
      where player_id = v_player_id and completion_date = current_date;
    if v_used >= v_limit then raise exception 'وصلت إلى الحد اليومي لقتال الوحوش'; end if;

    insert into public.pve_completions (player_id, monster_id) values (v_player_id, p_monster_id);

    if v_gold_prize > 0 then
        update public.players set gold = gold + v_gold_prize where id = v_player_id;
    end if;

    perform public.daily_quest_progress_add(p_token, 'win_battles', 1);

    v_remaining := greatest(0, v_limit - v_used - 1);
    return query select 'success'::text, coalesce(v_gold_prize,0), v_remaining;
end; $function$;

create or replace function public.dungeon_claim_reward(p_token text, p_dungeon_id uuid, p_session uuid)
returns table(status text, gold_added integer, remaining integer)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
    v_player_id uuid; v_dungeon record; v_used integer;
    v_gold_added integer := 0; v_remaining integer := -1;
begin
    v_player_id := public.player_id_from_token(p_token);
    if v_player_id is null then raise exception 'غير مصرح'; end if;

    perform public.try_consume_battle_session(p_token, 'dungeon', p_dungeon_id, p_session);

    select * into v_dungeon from public.dungeons where id = p_dungeon_id;
    if v_dungeon.id is null then raise exception 'الزنزانة غير موجودة'; end if;
    if not v_dungeon.active then raise exception 'الزنزانة غير مفعّلة'; end if;

    if v_dungeon.repeat_type = 'daily' then
        select count(*) into v_used from public.dungeon_completions
        where dungeon_id = p_dungeon_id and player_id = v_player_id and completion_date = current_date;
    elsif v_dungeon.repeat_type = 'total' then
        select count(*) into v_used from public.dungeon_completions
        where dungeon_id = p_dungeon_id and player_id = v_player_id;
    else
        v_used := 0;
    end if;

    if v_dungeon.repeat_type in ('daily','total')
       and v_dungeon.max_attempts > 0
       and v_used >= v_dungeon.max_attempts then
        raise exception 'وصلت إلى الحد الأقصى لدخول هذه الزنزانة';
    end if;

    insert into public.dungeon_completions (dungeon_id, player_id) values (p_dungeon_id, v_player_id);

    if v_dungeon.gold_prize > 0 then
        update public.players set gold = gold + v_dungeon.gold_prize where id = v_player_id;
        v_gold_added := v_dungeon.gold_prize;
    end if;

    perform public.daily_quest_progress_add(p_token, 'complete_dungeons', 1);

    if v_dungeon.repeat_type in ('daily','total') then
        v_remaining := greatest(0, v_dungeon.max_attempts - v_used - 1);
    end if;

    return query select 'success'::text, v_gold_added, v_remaining;
end; $function$;