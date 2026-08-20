-- ===== فتح المناطق/التحديات حسب مستوى اللاعب =====

alter table public.characters add column if not exists min_level integer not null default 0;
alter table public.dungeons    add column if not exists min_level integer not null default 0;

-- مستويات الوحوش الحالية تصبح الحد الأدنى لمواجهتها
update public.characters c set min_level = c.level
 where c.is_monster = true and c.level > 0 and c.min_level <= 0;

-- مستوى اللاعب = مستوى شخصيته النشطة (المستوى المكتسب بالترقية)
create or replace function public.player_level(p_token text)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_level integer;
begin
  select pc.level into v_level
    from public.players p
    join public.player_characters pc
          on pc.player_id = p.id and pc.character_id = p.active_character_id
   where p.id = public.player_id_from_token(p_token);
  return coalesce(v_level, 1);
end;
$fn$;

-- قائمة الوحوش + مستوى اللاعب + الحد الأدنى المطلوب
create or replace function public.pve_list_monsters(p_token text)
returns table(
    id uuid, name text, anime text, hp integer, atk integer,
    identity_image text, skill_card_image text, gold_prize integer,
    remaining_today integer, glow_color text, level integer,
    min_level integer, player_level integer
)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_player_id uuid; v_limit int; v_used int; v_pl int;
begin
  v_player_id := player_id_from_token(p_token);
  if v_player_id is null then raise exception 'غير مصرح'; end if;
  select value into v_limit from public.game_config where key = 'pve_daily_limit';
  v_limit := coalesce(v_limit, 3);
  select count(*) into v_used from public.pve_completions
   where player_id = v_player_id and completion_date = current_date;
  v_pl := public.player_level(p_token);
  return query
  select c.id, c.name, c.anime, c.hp, c.atk, c.identity_image, c.skill_card_image,
         coalesce(c.gold_prize,0), greatest(0, v_limit - v_used), c.glow_color,
         c.level, c.min_level, v_pl
    from public.characters c
   where c.is_monster = true
   order by c.created_at;
end;
$function$;

-- قائمة الزنازين + مستوى اللاعب + الحد الأدنى المطلوب
create or replace function public.dungeon_list_public(p_token text)
returns table(
    id uuid, name text, grade text, gold_prize integer, repeat_type text,
    max_attempts integer, monster_ids uuid[], active boolean,
    min_level integer, player_level integer
)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_player_id uuid; v_pl int;
begin
  v_player_id := player_id_from_token(p_token);
  if v_player_id is null then raise exception 'غير مصرح'; end if;
  v_pl := public.player_level(p_token);
  return query
  select d.id, d.name, d.grade, d.gold_prize, d.repeat_type, d.max_attempts,
         d.monster_ids, d.active, d.min_level, v_pl
    from public.dungeons d
   where d.active = true
   order by d.created_at;
end;
$function$;

-- منع بدء معركة وحش إذا كان مستوى اللاعب أقل من المطلوب
create or replace function public.battle_start_pve(p_token text, p_monster_id uuid)
returns table(session_id uuid, player_id uuid, target_type text, target_id uuid, created_at timestamp with time zone, expires_at timestamp with time zone, already_live boolean)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
    v_player uuid;
    v_live record;
    v_lifetime interval;
    v_min int;
    v_pl int;
begin
    v_player := public.player_id_from_token(p_token);
    if v_player is null then raise exception 'غير مصرح'; end if;

    select min_level into v_min from public.characters where id=p_monster_id and is_monster=true;
    if v_min is null then
        raise exception 'الوحش غير موجود';
    end if;

    v_pl := public.player_level(p_token);
    if v_min > v_pl then
        raise exception 'يجب أن يكون مستواك % على الأقل لمواجهة هذا الوحش', v_min;
    end if;

    select * into v_live from public.battle_sessions bs
     where bs.player_id=v_player and bs.target_type='pve' and bs.target_id=p_monster_id
       and bs.consumed_at is null and bs.expires_at > now()
     order by bs.created_at desc limit 1;

    if v_live.id is not null then
        return query select v_live.id, v_live.player_id, v_live.target_type::text, v_live.target_id,
                            v_live.created_at, v_live.expires_at, true;
        return;
    end if;

    v_lifetime := make_interval(secs => 60 * 15);
    insert into public.battle_sessions (player_id, target_type, target_id, expires_at)
    values (v_player, 'pve', p_monster_id, now() + v_lifetime)
    returning battle_sessions.id, battle_sessions.player_id, battle_sessions.target_type,
              battle_sessions.target_id, battle_sessions.created_at, battle_sessions.expires_at
    into v_live.id, v_live.player_id, v_live.target_type, v_live.target_id,
         v_live.created_at, v_live.expires_at;

    return query select v_live.id, v_live.player_id, v_live.target_type::text, v_live.target_id,
                        v_live.created_at, v_live.expires_at, false;
end; $function$;

-- منع دخول زنزانة إذا كان مستوى اللاعب أقل من المطلوب
create or replace function public.battle_start_dungeon(p_token text, p_dungeon_id uuid)
returns table(session_id uuid, player_id uuid, target_type text, target_id uuid, created_at timestamp with time zone, expires_at timestamp with time zone, already_live boolean)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
    v_player uuid;
    v_live record;
    v_lifetime interval;
    v_min int;
    v_pl int;
begin
    v_player := public.player_id_from_token(p_token);
    if v_player is null then raise exception 'غير مصرح'; end if;

    select min_level into v_min from public.dungeons where id=p_dungeon_id and active=true;
    if v_min is null then
        raise exception 'الزنزانة غير موجودة';
    end if;

    v_pl := public.player_level(p_token);
    if v_min > v_pl then
        raise exception 'يجب أن يكون مستواك % على الأقل لدخول هذه الزنزانة', v_min;
    end if;

    select * into v_live from public.battle_sessions bs
     where bs.player_id=v_player and bs.target_type='dungeon' and bs.target_id=p_dungeon_id
       and bs.consumed_at is null and bs.expires_at > now()
     order by bs.created_at desc limit 1;

    if v_live.id is not null then
        return query select v_live.id, v_live.player_id, v_live.target_type::text, v_live.target_id,
                            v_live.created_at, v_live.expires_at, true;
        return;
    end if;

    v_lifetime := make_interval(secs => 60 * 30);
    insert into public.battle_sessions (player_id, target_type, target_id, expires_at)
    values (v_player, 'dungeon', p_dungeon_id, now() + v_lifetime)
    returning battle_sessions.id, battle_sessions.player_id, battle_sessions.target_type,
              battle_sessions.target_id, battle_sessions.created_at, battle_sessions.expires_at
    into v_live.id, v_live.player_id, v_live.target_type, v_live.target_id,
         v_live.created_at, v_live.expires_at;

    return query select v_live.id, v_live.player_id, v_live.target_type::text, v_live.target_id,
                        v_live.created_at, v_live.expires_at, false;
end; $function$;

grant execute on function public.player_level(text) to anon, authenticated;