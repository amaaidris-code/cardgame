-- ============================================================
-- When admin deletes a character that is a player's active
-- character, clear that player's active choice so they are forced
-- to choose (or order) a new character before they can play —
-- previously active_character_id stayed dangling and has_character
-- stayed true, so clan dungeon join/start rejected them with a
-- confusing 400 ("not in this dungeon") because join found no
-- active character and never created their player row.
-- ============================================================

create or replace function public.admin_delete_character(p_admin_token text, p_character_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
DECLARE v_admin_id uuid;
BEGIN
  v_admin_id := admin_id_from_token(p_admin_token);
  DELETE FROM player_characters WHERE character_id = p_character_id;
  -- أي لاعب كانت هذه الشخصية مختارته الفعلية يفقدها: يصبح بلا شخصية
  -- ويُجبَر على اختيار/طلب شخصية جديدة قبل اللعب.
  UPDATE public.players
     SET active_character_id = NULL, has_character = false
   WHERE active_character_id = p_character_id;
  DELETE FROM characters WHERE id = p_character_id;
END; $function$;