-- Remove the minimum-battle-duration guard from session consumption so that
-- a won dungeon/PvE battle always pays its prize, matching PvP behavior.
-- The one-time, player-bound, target-bound, expired-session checks remain.
CREATE OR REPLACE FUNCTION public.try_consume_battle_session(
    p_token text, p_target_type text, p_target_id uuid, p_session uuid
) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $function$
declare
    v_player uuid;
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

    update public.battle_sessions set consumed_at = now() where id = p_session;
end; $function$;