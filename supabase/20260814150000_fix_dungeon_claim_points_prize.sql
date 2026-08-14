-- Fix dungeon points prize: players.active_character_id is a character_id,
-- not the player_characters row id. Points were never awarded to the player's
-- active character because the UPDATE matched no row (id != character_id).
-- Gold worked (it updates players.gold directly); points silently did nothing.

CREATE OR REPLACE FUNCTION public.dungeon_claim_reward(p_token text, p_dungeon_id uuid)
 RETURNS TABLE(status text, gold_added integer, points_added integer, remaining integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
    v_player_id uuid;
    v_dungeon record;
    v_used integer;
    v_active_pc_id uuid;
    v_gold_added integer := 0;
    v_points_added integer := 0;
    v_remaining integer := -1;
begin
    v_player_id := public.player_id_from_token(p_token);
    if v_player_id is null then raise exception 'غير مصرح'; end if;

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

    insert into public.dungeon_completions (dungeon_id, player_id)
    values (p_dungeon_id, v_player_id);

    if v_dungeon.gold_prize > 0 then
        update public.players set gold = gold + v_dungeon.gold_prize where id = v_player_id;
        v_gold_added := v_dungeon.gold_prize;
    end if;

    if v_dungeon.points_prize > 0 then
        -- active_character_id على players هو character_id وليس id صف player_characters
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
