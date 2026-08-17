-- ============================================================
-- Keep player has_character / active_character_id consistent so a
-- player whose (active) character was deleted can never reach the
-- main menu / sections without a character — the login & session-
-- restore gate routes has_character=false players to the
-- character-choice screen (choose or order a new one).
-- ============================================================

-- 1) Future: deleting a player's active character clears it and re-derives has_character
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
  UPDATE public.players p
     SET active_character_id = NULL,
         has_character = EXISTS (select 1 from public.player_characters pc where pc.player_id = p.id)
   WHERE p.active_character_id = p_character_id;
  DELETE FROM characters WHERE id = p_character_id;
END; $function$;

-- 2) Repair any pre-existing inconsistent rows:
--    active_character_id must reference a character the player owns, else cleared;
--    has_character = whether the player owns at least one character.
update public.players p set
    has_character = exists (select 1 from public.player_characters pc where pc.player_id = p.id),
    active_character_id = case
        when exists (select 1 from public.player_characters pc where pc.player_id = p.id and pc.character_id = p.active_character_id)
        then p.active_character_id
        else null
    end;