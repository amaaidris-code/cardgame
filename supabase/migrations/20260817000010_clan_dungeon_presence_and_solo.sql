-- • حضور Real-time: يُحسب في الغارة فقط اللاعب المتصل داخل الغرفة فعلًا.
--   - column clan_dungeon_players.last_active_at (نبض القلب).
--   - clan_dungeon_heartbeat(): يحدّثه العميل أثناء وجوده داخل الغرفة فقط.
--   - الحاضر = last_active_at خلال آخر 12 ثانية.
--   - العداد X/4 في القائمة وفي قاعة الانتظار يعتمد على الحاضرين، فإذا خرج
--     اللاعب أو أغلق اللعبة عاد العداد.
--
-- • البدء المنفرد: يفتح المعركة ويبقى الدور للاعب حتى يتصرف (لا خسارة فورية).
-- • يُمنع حذف غارة منفردة أثناء بدئها (lobby فقط يُمحى تلقائيًا).

alter table public.clan_dungeon_players add column if not exists last_active_at timestamptz;

-- ---------- نبض الحضور ----------
create or replace function public.clan_dungeon_heartbeat(p_token text, p_run_id uuid)
returns void
language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $function$
declare v_me uuid;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    update public.clan_dungeon_players
       set last_active_at = now()
     where run_id = p_run_id and player_id = v_me;
    if not found then raise exception 'لست في هذه الزنزانة'; end if;
end;
$function$;

-- ---------- الحالة: تحسب الحضور في players ----------
create or replace function public.clan_dungeon_get_state(p_token text, p_run_id uuid)
returns table (status text, turn_phase text, monster_index int, total_monsters int,
    monster_id uuid, monster_name text, monster_image text, monster_hp int, monster_max_hp int,
    turn_player_id uuid, turn_deadline timestamptz, my_player_id uuid, my_max_hp int, my_turn boolean, my_char_id uuid, players jsonb,
    turn_sub int, my_comp_name text, my_comp_image text, my_comp_hp int, my_comp_max_hp int, my_comp_alive boolean, my_comp_turn boolean)
language plpgsql security definer set search_path to 'public','extensions','pg_temp' as $fn$
declare v_me uuid; v_run record; v_players jsonb; v_my_hp int; v_my_max int; v_my_char uuid; v_my_turn boolean; v_my_sub int;
declare v_comp_name text; v_comp_image text; v_comp_hp int; v_comp_max int; v_comp_alive boolean; v_comp_turn boolean; v_row record;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    select * into v_run from public.clan_dungeon_runs where id=p_run_id;
    if v_run.id is null then raise exception 'الزنزانة غير موجودة'; end if;
    if not exists(select 1 from public.clan_dungeon_players cp where cp.run_id=p_run_id and cp.player_id=v_me) then
        raise exception 'لست في هذه الزنزانة';
    end if;
    select jsonb_agg(jsonb_build_object(
        'player_id', cp.player_id, 'character_id', cp.character_id, 'hp', cp.hp, 'max_hp', cp.max_hp,
        'alive', cp.alive, 'ready', cp.ready, 'turns_taken', cp.turns_taken, 'race_press_at', cp.race_press_at,
        'base_atk', cp.base_atk, 'base_hp', cp.base_hp,
        'comp_name', cp.comp_name, 'comp_image', cp.comp_image, 'comp_hp', cp.comp_hp, 'comp_max_hp', cp.comp_max_hp,
        'comp_alive', cp.comp_alive,
        'present', coalesce(cp.last_active_at, '-infinity'::timestamptz) > now() - interval '12 seconds',
        'last_active_at', cp.last_active_at) order by cp.joined_at)
      into v_players from public.clan_dungeon_players cp where cp.run_id=p_run_id;
    select cp.hp, cp.max_hp, cp.character_id,
           (coalesce(v_run.turn_player_id, cp.player_id) = cp.player_id and v_run.turn_phase='player')
      into v_my_hp, v_my_max, v_my_char, v_my_turn
      from public.clan_dungeon_players cp where cp.run_id=p_run_id and cp.player_id=v_me;
    select * into v_row from public.clan_dungeon_players where run_id=p_run_id and player_id=v_me;
    v_comp_name := coalesce(v_row.comp_name,'');
    v_comp_image := v_row.comp_image;
    v_comp_hp := coalesce(v_row.comp_hp,0);
    v_comp_max := coalesce(v_row.comp_max_hp,0);
    v_comp_alive := coalesce(v_row.comp_alive,false) and coalesce(v_row.comp_hp,0) > 0;
    v_comp_turn := v_my_turn and v_run.turn_sub = 1;
    v_my_sub := v_run.turn_sub;
    return query
    select v_run.status, v_run.turn_phase, v_run.monster_index, array_length(v_run.monster_ids,1),
           v_run.monster_id, v_run.monster_name, v_run.monster_image, v_run.monster_hp, v_run.monster_max_hp,
           v_run.turn_player_id, v_run.turn_deadline, v_me, v_my_max, v_my_turn, v_my_char,
           coalesce(v_players,'[]'::jsonb), v_my_sub,
           v_comp_name, v_comp_image, v_comp_hp, v_comp_max, v_comp_alive, v_comp_turn;
end; $fn$;

-- ---------- القائمة: العداد حسب الحاضرين ----------
create or replace function public.clan_dungeon_list(p_token text, p_clan_id uuid)
returns table (run_id uuid, dungeon_id uuid, status text, monster_index integer, member_count integer, max_count integer, dungeon_name text, created_at timestamp with time zone)
language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $fn$
declare v_me uuid;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    if not exists(select 1 from public.clan_members cm where cm.clan_id = p_clan_id and cm.player_id = v_me) then
        raise exception 'لست عضوًا في هذه العصابة';
    end if;
    return query
    select r.id, r.dungeon_id, r.status, r.monster_index,
           (select count(*)::int from public.clan_dungeon_players cp
             where cp.run_id = r.id
               and coalesce(cp.last_active_at, '-infinity'::timestamptz) > now() - interval '12 seconds') as member_count,
           4::int as max_count,
           coalesce(d.name, '') as dungeon_name,
           r.created_at
    from public.clan_dungeon_runs r
    left join public.dungeons d on d.id = r.dungeon_id
    where r.clan_id = p_clan_id
      and r.status in ('lobby','race','active')
    order by r.created_at desc;
end; $fn$;

-- ---------- البدء: منفرد فورًا، جماعي بجاهزية الحاضرين ----------
create or replace function public.clan_dungeon_start_race(p_token text, p_run_id uuid)
returns void
language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $function$
declare v_me uuid; v_run record; v_present int; v_all_ready boolean;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    select * into v_run from public.clan_dungeon_runs where id=p_run_id for update;
    if v_run.id is null then raise exception 'الزنزانة غير موجودة'; end if;
    if v_run.status <> 'lobby' then raise exception 'الزنزانة بدأت بالفعل'; end if;
    if not exists(select 1 from public.clan_dungeon_players cp where cp.run_id=p_run_id and cp.player_id=v_me and cp.alive) then
        raise exception 'لست في هذه الزنزانة';
    end if;

    update public.clan_dungeon_players set last_active_at = now()
     where run_id=p_run_id and player_id=v_me;

    v_present := (select count(*)::int from public.clan_dungeon_players cp
                  where cp.run_id=p_run_id
                    and coalesce(cp.last_active_at, '-infinity'::timestamptz) > now() - interval '12 seconds');

    -- منفرد: ابدأ فورًا، والدور للاعب حتى يتصرف (لا خسارة قبل اللعب)
    if v_present <= 1 then
        update public.clan_dungeon_runs set
            status='active', turn_order=array[v_me], turn_slot=0, turn_phase='player',
            monster_index=0, winner_id=null
        where id=p_run_id;
        perform public.clan_dungeon_spawn_monster(p_run_id);
        perform public.clan_dungeon_schedule_player(p_run_id, -1);
        return;
    end if;

    -- جماعي: لا تبدأ قبل أن يجاهز جميع الحاضرين
    v_all_ready := not exists(
        select 1 from public.clan_dungeon_players cp
        where cp.run_id=p_run_id
          and coalesce(cp.last_active_at, '-infinity'::timestamptz) > now() - interval '12 seconds'
          and not coalesce(cp.ready, false)
    );
    if not v_all_ready then
        raise exception 'انتظر حتى يصبح جميع اللاعبين الحاضرين جاهزين لبدء السباق';
    end if;

    update public.clan_dungeon_players set race_press_at=null where run_id=p_run_id;
    update public.clan_dungeon_runs set status='race', race_started_at=now() where id=p_run_id;
end;
$function$;

-- ---------- الإنشاء: لا تمحو غارة منفردة قيد التنفيذ ----------
create or replace function public.clan_dungeon_create(p_token text, p_clan_id uuid, p_dungeon_id uuid)
returns table(run_id uuid, status text)
language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $function$
declare
    v_me uuid; v_run uuid; v_dungeon record; v_pc record;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    if not exists(select 1 from public.clan_members cm where cm.clan_id = p_clan_id and cm.player_id = v_me) then
        raise exception 'لست عضوًا في هذه العصابة';
    end if;

    perform public.clan_dungeon_prune_stale(p_clan_id);

    -- غرفة لوبي منفردة عالقة فقط تُغلق تلقائيًا؛ لا نمحو غارة بدأت فعلًا
    delete from public.clan_dungeon_runs r
     using public.clan_dungeon_players me
     where r.id = me.run_id
       and me.player_id = v_me
       and r.status = 'lobby'
       and not exists (
            select 1 from public.clan_dungeon_players other
            where other.run_id = r.id and other.player_id <> v_me and other.alive
       );

    select * into v_dungeon from public.dungeons d where d.id = p_dungeon_id and d.active = true;
    if v_dungeon.id is null then raise exception 'هذه الزنزانة غير متاحة'; end if;
    if coalesce(array_length(v_dungeon.monster_ids,1),0) = 0 then
        raise exception 'هذه الزنزانة لا تحتوي على وحوش';
    end if;

    if exists(select 1 from public.clan_dungeon_players cp
              join public.clan_dungeon_runs r on r.id = cp.run_id
              where cp.player_id = v_me and r.status in ('lobby','race','active')) then
        raise exception 'أنت بالفعل في زنزانة جماعية نشطة';
    end if;

    select pc.id, c.hp as chp, c.atk as catk
      into v_pc
      from public.player_characters pc
      join public.characters c on c.id = pc.character_id
     where pc.player_id = v_me
       and pc.character_id = (select active_character_id from public.players where id = v_me);
    if v_pc.id is null then raise exception 'ليس لديك شخصية نشطة'; end if;

    insert into public.clan_dungeon_runs (clan_id, dungeon_id, monster_ids, monster_index, status, turn_slot, turn_phase)
    values (p_clan_id, p_dungeon_id, v_dungeon.monster_ids, 0, 'lobby', 0, 'player')
    returning id into v_run;

    insert into public.clan_dungeon_players
        (run_id, player_id, character_id, base_hp, base_atk, hp, max_hp, ready)
    values
        (v_run, v_me, v_pc.id, coalesce(v_pc.chp,100), coalesce(v_pc.catk,100),
         coalesce(v_pc.chp,100), coalesce(v_pc.chp,100), false);

    return query select v_run, 'lobby';
end;
$function$;