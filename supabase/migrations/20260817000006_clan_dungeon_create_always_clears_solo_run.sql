-- عند إنشاء غارة، أغلق أي غرفة يبقى فيها اللاعب العضو الوحيد الحي (بأي حالة:
-- lobby/race/active) حتى لا تُحبس الغارة الأولى بخطأ "أنت بالفعل في زنزانة
-- جماعية نشطة" من غرفة قديمة خاصة به ولا أحد غيره حيًا.

create or replace function public.clan_dungeon_create(p_token text, p_clan_id uuid, p_dungeon_id uuid)
 returns table(run_id uuid, status text)
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
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

    -- أي غرفة يبقى فيها اللاعب العضو الوحيد الحي (بأي حالة: lobby/race/active)
    -- هي غرفة شخصية عالقة → تُغلق تلقائيًا حتى يتمكن من إنشاء غارة جديدة
    delete from public.clan_dungeon_runs r
     using public.clan_dungeon_players me
     where r.id = me.run_id
       and me.player_id = v_me
       and not exists (
            select 1 from public.clan_dungeon_players other
            where other.run_id = r.id and other.player_id <> v_me and other.alive
       );

    select * into v_dungeon from public.dungeons d where d.id = p_dungeon_id and d.active = true;
    if v_dungeon.id is null then raise exception 'هذا الزنزانة غير متاحة'; end if;
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