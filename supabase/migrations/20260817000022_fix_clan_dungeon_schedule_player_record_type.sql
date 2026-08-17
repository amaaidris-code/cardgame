-- ============================================================
-- Fix start_race 400 on every raid start.
-- clan_dungeon_schedule_player declared v_p as record but did
-- `select comp_alive into v_p` (whole row => record), then called
-- coalesce(v_p, false) => "COALESCE types record and boolean
-- cannot be matched", which blew up every start_race call.
-- Fix: declare v_p boolean so it holds comp_alive's scalar.
-- ============================================================

create or replace function public.clan_dungeon_schedule_player(p_run_id uuid, p_from integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_next uuid; v_p boolean; v_sub int;
begin
    v_next := public.clan_dungeon_next_player(p_run_id, p_from);
    if v_next is null then
        update public.clan_dungeon_runs set status='finished', turn_phase='player', turn_player_id=null, turn_deadline=null, turn_sub=0 where id=p_run_id; return;
    end if;
    select comp_alive into v_p from public.clan_dungeon_players
      where run_id=p_run_id and player_id=v_next;
    v_sub := 0;
    if coalesce(v_p,false) and not exists(select 1 from public.clan_dungeon_players
           where run_id=p_run_id and player_id=v_next and alive=true and hp>0) then
        v_sub := 1;
    end if;
    update public.clan_dungeon_runs set turn_phase='player', turn_player_id=v_next,
        turn_slot = (select s.pos-1 from (select row_number() over() as pos, player_id from unnest(turn_order) as player_id) s where s.player_id=v_next),
        turn_deadline = now() + interval '60 seconds', turn_sub = v_sub
    where id=p_run_id;
end; $function$;