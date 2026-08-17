-- ============================================================
-- clan_dungeon_join becomes idempotent: if the caller already has
-- an alive row in THIS run, return quietly instead of erroring.
-- This lets the run creator "enter" their own run (creating the
-- player row they need to start) via enterRun, matching tryJoin.
-- ============================================================

create or replace function public.clan_dungeon_join(p_token text, p_run_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
    v_me uuid; v_run record; v_pc record; v_comp record;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;

    -- أغلق أي غرفة لوبي مهجورة يشاركها اللاعب وحيدًا
    delete from public.clan_dungeon_runs r
     using public.clan_dungeon_players me
     where r.id = me.run_id
       and me.player_id = v_me
       and r.status = 'lobby'
       and not exists (
            select 1 from public.clan_dungeon_players other
            where other.run_id = r.id and other.player_id <> v_me and other.alive
       );

    select * into v_run from public.clan_dungeon_runs r where r.id = p_run_id for update;
    if v_run.id is null then raise exception 'الزنزانة غير موجودة'; end if;
    if v_run.status <> 'lobby' then raise exception 'الزنزانة بدأت بالفعل'; end if;
    if not exists(select 1 from public.clan_members cm where cm.clan_id = v_run.clan_id and cm.player_id = v_me) then
        raise exception 'لست عضوًا في هذا العصابة';
    end if;
    if (select count(*) from public.clan_dungeon_players cp where cp.run_id = p_run_id) >= 4 then
        raise exception 'الزنزانة ممتلئة (4 لاعبين كحد أقصى)';
    end if;
    -- بالفعل في هذه الزنزانة؟ سلوك محايد (لا خطأ) — يدعم الدخول المتكرر.
    if exists(select 1 from public.clan_dungeon_players cp
              where cp.run_id = p_run_id and cp.player_id = v_me and cp.alive) then
        return;
    end if;
    if exists(select 1 from public.clan_dungeon_players cp
              join public.clan_dungeon_runs r on r.id = cp.run_id
              where cp.player_id = v_me and r.id <> p_run_id and r.status in ('lobby','race','active')) then
        raise exception 'أنت بالفعل في زنزانة جماعية نشطة';
    end if;

    select pc.id, c.hp as chp, c.atk as catk
      into v_pc
      from public.player_characters pc
      join public.characters c on c.id = pc.character_id
     where pc.player_id = v_me
       and pc.character_id = (select active_character_id from public.players where id = v_me);
    if v_pc.id is null then raise exception 'ليس لديك شخصية نشطة'; end if;

    select pcc.id, c.id as cid, c.name, c.image, coalesce(pcc.hp,c.base_hp) as c_hp, coalesce(pcc.atk,c.base_atk) as c_atk
      into v_comp
      from public.players pl
      left join public.player_companions pcc on pcc.id = pl.active_companion_id
      left join public.companions c on c.id = pcc.companion_id
     where pl.id = v_me;

    insert into public.clan_dungeon_players
        (run_id, player_id, character_id, base_hp, base_atk, hp, max_hp, ready,
         comp_character_id, comp_pc_id, comp_name, comp_image, comp_base_hp, comp_base_atk,
         comp_alive, comp_hp, comp_max_hp, comp_turns_taken)
    values
        (p_run_id, v_me, v_pc.id, coalesce(v_pc.chp,100), coalesce(v_pc.catk,100),
         coalesce(v_pc.chp,100), coalesce(v_pc.chp,100), false,
         v_comp.cid, v_comp.id, coalesce(v_comp.name,''), v_comp.image,
         coalesce(v_comp.c_hp,0), coalesce(v_comp.c_atk,0),
         v_comp.cid is not null, coalesce(v_comp.c_hp,0), coalesce(v_comp.c_hp,0), 0);
end; $function$;