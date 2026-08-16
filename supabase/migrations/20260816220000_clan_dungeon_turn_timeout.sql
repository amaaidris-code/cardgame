-- Clan co-op dungeon turn timeout.
--
-- The co-op run set turn_deadline = now() + '60 seconds' when each player's
-- turn is scheduled, but nothing ever enforced it: if the current player never
-- called clan_dungeon_use_skill, the run froze on their turn forever and the
-- monster never attacked.
--
-- This adds clan_dungeon_skip_turn: any run member may call it once the current
-- player's deadline has passed. On expiry we forfeit the player's turn and move
-- to the monster phase; the existing client auto-advance (ensureMonsterAct ->
-- clan_dungeon_monster_act) then makes the monster attack and schedules the next
-- alive player. The skip is server-authoritative and idempotent (fails if the
-- deadline is not yet reached), mirroring public.pvp_skip_turn.

CREATE OR REPLACE FUNCTION public.clan_dungeon_skip_turn(p_token text, p_run_id uuid)
 RETURNS TABLE(status text, skipped_player uuid)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $fn$
declare
    v_me uuid; v_run record; v_skip uuid;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;

    select * into v_run from public.clan_dungeon_runs where id=p_run_id for update;
    if v_run.id is null then raise exception 'الزنزانة غير موجودة'; end if;
    if v_run.status <> 'active' then raise exception 'المعركة ليست نشطة'; end if;
    if v_run.turn_phase <> 'player' or v_run.turn_player_id is null then
        raise exception 'لا يوجد دور لاعب نشط حاليًا';
    end if;
    if v_run.turn_deadline is null then raise exception 'لا توجد مهلة للدور'; end if;
    if now() < v_run.turn_deadline then
        raise exception 'لم تنتهِ مهلة الدور بعد';
    end if;

    -- Caller must be a member of the run.
    if not exists(select 1 from public.clan_dungeon_players where run_id=p_run_id and player_id=v_me and alive=true) then
        raise exception 'لست في هذه الزنزانة';
    end if;

    v_skip := v_run.turn_player_id;

    -- Forfeit the idle player's turn: drop their defense/shields and hand the
    -- turn to the monster (the client auto-advance will make it attack).
    update public.clan_dungeon_players
       set defending=false, shield_charges=0
     where run_id=p_run_id and player_id=v_skip;

    update public.clan_dungeon_runs set turn_phase='monster', turn_player_id=null, turn_deadline=null
     where id=p_run_id;

    return query select 'skipped'::text, v_skip;
end; $fn$;

REVOKE EXECUTE ON FUNCTION public.clan_dungeon_skip_turn(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clan_dungeon_skip_turn(text, uuid) TO anon, authenticated;