-- Widen the PvP "online now" window in pvp_list_lobby from 45s to 120s.
--
-- Mobile browsers throttle setInterval in background/hidden tabs (~1/min),
-- which made last_active_at go stale within the old 45s window, so a player
-- briefly dropping to background disappeared from the opponent's lobby even
-- though they were still connected. A 120s window + faster presence ping
-- (every 10s in game.js) keeps players visible.
CREATE OR REPLACE FUNCTION public.pvp_list_lobby(p_token text)
 RETURNS TABLE(player_id uuid, character_name text, character_image text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_my_id uuid;
begin
  v_my_id := player_id_from_token(p_token);

  perform pvp_expire_stale_matches();

  -- سجّل اللاعب الحالي في ساحة PvP وأبقِ نشاطه الأخير محدّثًا، بحيث يظهر
  -- للآخرين حتى لو لم يكن على تبويب PvP
  begin
    perform pvp_join_lobby(p_token);
  exception when others then
    -- لا توجد شخصية نشطة — لا نضعه في الساحة
  end;
  update players set last_active_at = now() where id = v_my_id;

  return query
  select pl.id as player_id, c.name as character_name, c.identity_image as character_image
  from players pl
  join characters c on c.id = pl.active_character_id
  where pl.id <> v_my_id
    and pl.has_character
    and pl.active_character_id is not null
    -- متصل باللعبة الآن: إمّا على تبويب PvP (ساحة) أو في أي شاشة أخرى
    -- (عبر نبضة النشاط pvp_presence_ping). نافذة 120 ثانية تتسامح مع تأخير
    -- المتصفح للموقّتات في تبويب الخلفية/قفل الشاشة، فلا يختفي اللاعب فجأة
    and (
      exists (
        select 1 from pvp_lobby l
        where l.player_id = pl.id and l.updated_at > now() - interval '120 seconds'
      )
      or pl.last_active_at > now() - interval '120 seconds'
    )
    and not exists (
      select 1 from pvp_matches m
      where m.status in ('pending','ready_wait','race','active')
        and (m.player1_id = pl.id or m.player2_id = pl.id)
    )
  order by pl.last_active_at desc nulls last;
end;
$function$