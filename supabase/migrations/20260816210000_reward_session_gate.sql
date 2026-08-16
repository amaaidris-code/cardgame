-- Reward-gate: prevent gold farming on PvE / Dungeon rewards.
--
-- Battles are client-side and deterministic, and the old claim RPCs only
-- checked an attempt counter. A script could call pve_claim_reward /
-- dungeon_claim_reward directly and farm gold without ever winning.
--
-- This migration introduces a server-minted battle session:
--   1. The client requests a session (battle_start_pve / battle_start_dungeon)
--      when a real battle begins.
--   2. The claim RPCs now REQUIRE that one-time, player-bound, target-bound,
--      unexpired session and consume it atomically. A forged/expired/replayed
--      session is rejected.
--
-- The session is issued with a minimum lifetime, so no gold is paid for an
-- instant claim. Enforce real wins server-side later if buee battles are
-- made server-authoritative.

CREATE TABLE IF NOT EXISTS public.battle_sessions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id   uuid NOT NULL,
    target_type text NOT NULL CHECK (target_type IN ('pve','dungeon')),
    target_id   uuid NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    consumed_at timestamptz
);

ALTER TABLE public.battle_sessions ALTER COLUMN id SET DEFAULT gen_random_uuid();

CREATE INDEX IF NOT EXISTS idx_battle_sessions_player
    ON public.battle_sessions (player_id, target_type, target_id);

-- No REST grants: sessions are only created/consumed through the SECURITY
-- DEFINER RPCs below. Ensure there are no public policies.
DROP POLICY IF EXISTS "battle_sessions_all" ON public.battle_sessions;
ALTER TABLE public.battle_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.battle_sessions FROM anon, authenticated, public;
GRANT USAGE ON SEQUENCE battle_sessions_id_seq TO authenticated;
REVOKE ALL ON SEQUENCE battle_sessions_id_seq FROM anon, public;

-- Minimum lifetime of a minted session before its reward may be claimed.
-- Configurable at runtime via game_config key 'battle_min_seconds'.
CREATE OR REPLACE FUNCTION public.battle_session_min_seconds()
 RETURNS integer LANGUAGE sql STABLE SET search_path TO 'public','extensions','pg_temp'
AS $$
    select coalesce((select value from public.game_config where key='battle_min_seconds'), 8)::int;
$$;

-- Issue a one-time session token for a newly started battle.
-- A player may only have ONE live (unconsumed, unexpired) session for a given
-- target; issuing again returns the same live session rather than minting a
-- second one, so a single in-flight battle maps to exactly one claim.
CREATE OR REPLACE FUNCTION public.battle_start_pve(p_token text, p_monster_id uuid)
 RETURNS TABLE(session_id uuid, player_id uuid, target_type text, target_id uuid,
               created_at timestamptz, expires_at timestamptz, already_live boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $function$
declare
    v_player uuid;
    v_live record;
    v_lifetime interval;
begin
    v_player := public.player_id_from_token(p_token);
    if v_player is null then raise exception 'غير مصرح'; end if;

    -- target must be a real monster
    if not exists(select 1 from public.characters where id=p_monster_id and is_monster=true) then
        raise exception 'الوحش غير موجود';
    end if;

    -- If a live session already exists for this target, return it unchanged.
    select * into v_live from public.battle_sessions bs
     where bs.player_id=v_player and bs.target_type='pve' and bs.target_id=p_monster_id
       and bs.consumed_at is null and bs.expires_at > now()
     order by bs.created_at desc limit 1;

    if v_live.id is not null then
        return query select v_live.id, v_live.player_id, v_live.target_type::text, v_live.target_id,
                            v_live.created_at, v_live.expires_at, true;
        return;
    end if;

    v_lifetime := make_interval(secs => 60 * 15); -- session valid up to 15 min
    insert into public.battle_sessions (player_id, target_type, target_id, expires_at)
    values (v_player, 'pve', p_monster_id, now() + v_lifetime)
    returning battle_sessions.id, battle_sessions.player_id, battle_sessions.target_type,
              battle_sessions.target_id, battle_sessions.created_at, battle_sessions.expires_at
    into v_live.id, v_live.player_id, v_live.target_type, v_live.target_id,
         v_live.created_at, v_live.expires_at;

    return query select v_live.id, v_live.player_id, v_live.target_type::text, v_live.target_id,
                        v_live.created_at, v_live.expires_at, false;
end; $function$;

CREATE OR REPLACE FUNCTION public.battle_start_dungeon(p_token text, p_dungeon_id uuid)
 RETURNS TABLE(session_id uuid, player_id uuid, target_type text, target_id uuid,
               created_at timestamptz, expires_at timestamptz, already_live boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $function$
declare
    v_player uuid;
    v_live record;
    v_lifetime interval;
begin
    v_player := public.player_id_from_token(p_token);
    if v_player is null then raise exception 'غير مصرح'; end if;

    if not exists(select 1 from public.dungeons where id=p_dungeon_id and active=true) then
        raise exception 'الزنزانة غير موجودة';
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

-- =============================================================
-- Claim RPCs — now require a valid, unconsumed, unexpired session.
-- =============================================================

-- Validate + atomically consume a session. Raises on any misuse.
-- shared by both claim functions.
CREATE OR REPLACE FUNCTION public.try_consume_battle_session(
    p_token text, p_target_type text, p_target_id uuid, p_session uuid
) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $function$
declare
    v_player uuid;
    v_min_sec int;
    v_rec record;
begin
    v_player := public.player_id_from_token(p_token);
    if v_player is null then raise exception 'غير مصرح'; end if;

    select * into v_rec
      from public.battle_sessions
     where id = p_session
       and player_id = v_player
       and target_type = p_target_type
       and target_id = p_target_id
     for update;

    if not found then
        raise exception 'جلسة معركة غير صالحة'; -- forged or wrong player/target
    end if;

    if v_rec.consumed_at is not null then
        raise exception 'تم استخدام هذه الجلسة مسبقًا'; -- replay
    end if;

    if v_rec.expires_at <= now() then
        raise exception 'انتهت صلاحية الجلسة'; -- expired
    end if;

    -- minimum battle duration (anti-instant-claim)
    v_min_sec := public.battle_session_min_seconds();
    if v_min_sec > 0 and (now() - v_rec.created_at) < make_interval(secs => v_min_sec) then
        raise exception 'المعركة قصيرة جدًا'; -- claimed too fast
    end if;

    update public.battle_sessions set consumed_at = now() where id = p_session;
end; $function$;

-- PVE claim — now requires a valid session.
CREATE OR REPLACE FUNCTION public.pve_claim_reward(
    p_token text, p_monster_id uuid, p_session uuid
) RETURNS TABLE(status text, gold_added integer, remaining integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $function$
declare
    v_player_id uuid; v_gold_prize int; v_limit int; v_used int; v_remaining int;
begin
    v_player_id := public.player_id_from_token(p_token);
    if v_player_id is null then raise exception 'غير مصرح'; end if;

    -- gate: must have a real, fresh, unconsumed session for this monster
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

    v_remaining := greatest(0, v_limit - v_used - 1);
    return query select 'success'::text, coalesce(v_gold_prize,0), v_remaining;
end; $function$;

-- Dungeon claim — now requires a valid session.
CREATE OR REPLACE FUNCTION public.dungeon_claim_reward(
    p_token text, p_dungeon_id uuid, p_session uuid
) RETURNS TABLE(status text, gold_added integer, points_added integer, remaining integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $function$
declare
    v_player_id uuid; v_dungeon record; v_used integer;
    v_active_pc_id uuid; v_gold_added integer := 0; v_points_added integer := 0;
    v_remaining integer := -1;
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

    if v_dungeon.points_prize > 0 then
        select active_character_id into v_active_pc_id from public.players where id = v_player_id;
        if v_active_pc_id is not null then
            update public.player_characters
            set available_points = available_points + v_dungeon.points_prize
            where character_id = v_active_pc_id and player_id = v_player_id;
            v_points_added := v_dungeon.points_prize;
        end if;
    end if;

    if v_dungeon.repeat_type in ('daily','total') then
        v_remaining := greatest(0, v_dungeon.max_attempts - v_used - 1);
    end if;

    return query select 'success'::text, v_gold_added, v_points_added, v_remaining;
end; $function$;

-- Client-facing grants: the start RPCs are called by the app (anon/authenticated).
-- try_consume and the claim functions run as SECURITY DEFINER (owner) and are not
-- granted here — try_consume must NOT be directly callable.
REVOKE EXECUTE ON FUNCTION public.try_consume_battle_session FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.battle_start_pve(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.battle_start_dungeon(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pve_claim_reward(text, uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dungeon_claim_reward(text, uuid, uuid) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.try_consume_battle_session FROM anon, authenticated;