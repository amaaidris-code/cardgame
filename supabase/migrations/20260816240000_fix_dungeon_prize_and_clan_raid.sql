-- Fix two production bugs:
--
-- 1) Dungeon prizes never paid.
--    dungeon_claim_reward referenced v_dungeon.points_prize, a column that does
--    not exist on live public.dungeons (no points system). Postgres raised 42703
--    BEFORE the gold UPDATE, so the whole claim threw and no gold was paid.
--    Removed the dead points-prize block (admin UI only configures gold).
--
-- 2) Clan co-op dungeon create/join blocked.
--    a) clan_dungeon_create inserted a run but never added the creator to
--       clan_dungeon_players, and the client's createRun doesn't call join, so
--       the creator was in a run they weren't a member of -> get_state rejected
--       them and the lobby never worked.
--    b) Abandoned 'lobby' runs were never pruned. The "already in an active
--       run" guard counted them, permanently locking a player out of creating
--       or joining any future raid.
--    Fix: create auto-adds the creator (using the same active-character rules
--    as join), and a prune step deletes stale lobby runs older than 30 minutes
--    before the membership guard runs in create/join.

CREATE OR REPLACE FUNCTION public.dungeon_claim_reward(
    p_token text, p_dungeon_id uuid, p_session uuid
) RETURNS TABLE(status text, gold_added integer, remaining integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $function$
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

    if v_dungeon.repeat_type in ('daily','total') then
        v_remaining := greatest(0, v_dungeon.max_attempts - v_used - 1);
    end if;

    return query select 'success'::text, v_gold_added, v_remaining;
end; $function$;

-- Prune abandoned lobby runs (never started) older than 30 minutes.
-- Cascade deletes their clan_dungeon_players rows.
CREATE OR REPLACE FUNCTION public.clan_dungeon_prune_stale(p_clan_id uuid)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $function$
begin
    delete from public.clan_dungeon_runs r
     where r.clan_id = p_clan_id
       and r.status = 'lobby'
       and r.created_at < now() - interval '30 minutes';
end; $function$;

-- Create a raid AND add the creator as a member in one atomic call, so the
-- creator's own run works immediately (matching the client that never joins
-- after create). Runs the stale-lobby prune first so a player trapped in an
-- abandoned lobby is freed to create a new one.
CREATE OR REPLACE FUNCTION public.clan_dungeon_create(
    p_token text, p_clan_id uuid, p_dungeon_id uuid
) RETURNS TABLE(run_id uuid, status text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $function$
declare
    v_me uuid;
    v_run uuid;
    v_dungeon record;
    v_pc record;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    if not exists(select 1 from public.clan_members cm where cm.clan_id = p_clan_id and cm.player_id = v_me) then
        raise exception 'لست عضوًا في هذه العصابة';
    end if;

    perform public.clan_dungeon_prune_stale(p_clan_id);

    select * into v_dungeon from public.dungeons d where d.id = p_dungeon_id and d.active = true;
    if v_dungeon.id is null then raise exception 'هذا الزنزانة غير متاحة'; end if;
    if coalesce(array_length(v_dungeon.monster_ids,1),0) = 0 then
        raise exception 'هذه الزنزانة لا تحتوي على وحوش';
    end if;

    -- a player may only run one active co-op dungeon at a time
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

    -- the creator is a member from the start
    insert into public.clan_dungeon_players
        (run_id, player_id, character_id, base_hp, base_atk, hp, max_hp, ready)
    values
        (v_run, v_me, v_pc.id, coalesce(v_pc.chp,100), coalesce(v_pc.catk,100),
         coalesce(v_pc.chp,100), coalesce(v_pc.chp,100), false);

    return query select v_run, 'lobby';
end; $function$;

-- Join: prune stale lobbies for the run's clan before the membership guard,
-- so an abandoned lobby no longer locks players out.
CREATE OR REPLACE FUNCTION public.clan_dungeon_join(p_token text, p_run_id uuid)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $function$
declare
    v_me uuid;
    v_run record;
    v_pc record;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;

    select * into v_run from public.clan_dungeon_runs r where r.id = p_run_id for update;
    if v_run.id is null then raise exception 'الزنزانة غير موجودة'; end if;

    perform public.clan_dungeon_prune_stale(v_run.clan_id);

    select * into v_run from public.clan_dungeon_runs r where r.id = p_run_id for update;
    if v_run.id is null then raise exception 'الزنزانة انتهت'; end if;
    if v_run.status <> 'lobby' then raise exception 'الزنزانة بدأت بالفعل'; end if;
    if not exists(select 1 from public.clan_members cm where cm.clan_id = v_run.clan_id and cm.player_id = v_me) then
        raise exception 'لست عضوًا في هذه العصابة';
    end if;
    if (select count(*) from public.clan_dungeon_players cp where cp.run_id = p_run_id) >= 4 then
        raise exception 'الزنزانة ممتلئة (4 لاعبين كحد أقصى)';
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

    insert into public.clan_dungeon_players
        (run_id, player_id, character_id, base_hp, base_atk, hp, max_hp, ready)
    values
        (p_run_id, v_me, v_pc.id, coalesce(v_pc.chp,100), coalesce(v_pc.catk,100),
         coalesce(v_pc.chp,100), coalesce(v_pc.chp,100), false);
end; $function$;

-- Internal helper: never exposed to clients (mirrors try_consume_battle_session).
REVOKE ALL ON FUNCTION public.clan_dungeon_prune_stale(uuid) FROM anon, authenticated, public;