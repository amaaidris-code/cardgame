-- ============================================================
-- Security hardening (post-audit).
-- Closes the two critical findings:
--   1) Internal clan-dungeon state-modifier functions and the
--      unauthenticated admin_notify/admin_notify_skill were
--      EXECUTE-granted to anon/authenticated/PUBLIC, letting any
--      caller rewrite monster/player HP, spawn monsters, flip the
--      turn schedule, or spam admin notifications.
--      They are now owner-only (still callable internally by the
--      SECURITY DEFINER public-entry functions).
--   2) `admins` and `admin_sessions` had PUBLIC `using (true)` SELECT
--      policies + full anon/authenticated grants, leaking admin
--      usernames, bcrypt password hashes, and live admin session
--      tokens over the REST API (→ full admin takeover). Removed.
-- ============================================================

-- ---------- 1) Revoke user-level EXECUTE on internal helpers ----------
revoke execute on function
  public.clan_dungeon_save_player(uuid, uuid, public.pvp_fighter_state),
  public.clan_dungeon_save_monster(uuid, public.pvp_fighter_state),
  public.clan_dungeon_spawn_monster(uuid),
  public.clan_dungeon_schedule_player(uuid, integer),
  public.clan_dungeon_schedule_monster(uuid),
  public.clan_dungeon_next_player(uuid, integer),
  public.clan_dungeon_player_state(record),
  public.clan_dungeon_monster_state(record),
  public.clan_dungeon_cooldown_remaining(uuid, uuid, uuid, integer, integer),
  public.clan_dungeon_has_ready_defense(uuid, uuid, uuid, uuid[], integer),
  public.clan_dungeon_monster_skills(uuid),
  public.clan_dungeon_my_char(text, uuid),
  public.admin_notify(text, text),
  public.admin_notify_skill(text, text, uuid)
from public, anon, authenticated;

-- ---------- 2) Seal admin tables (no direct REST reads) ----------
drop policy if exists "Admins can view admins" on public.admins;
drop policy if exists "Admins can view admin_sessions" on public.admin_sessions;
revoke all on public.admins from anon, authenticated;
revoke all on public.admin_sessions from anon, authenticated;

-- ---------- 3) Fix SECURITY DEFINER functions missing a fixed
--               search_path (search-path hijacking / privilege
--               escalation via a shadow schema). ----------
create or replace function public.admin_update_skill(p_admin_token text, p_skill_id uuid, p_name text, p_type text, p_damage integer, p_cooldown integer, p_effect text, p_unblockable boolean, p_description text, p_color text, p_params jsonb, p_stroke_color text, p_stroke_width numeric)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_admin_id uuid;
begin
  v_admin_id := admin_id_from_token(p_admin_token);
  update public.skills
  set name = p_name, type = p_type, damage = p_damage, cooldown = p_cooldown,
      effect = p_effect, unblockable = p_unblockable, description = p_description,
      color = p_color, params = coalesce(p_params, '{}'::jsonb),
      stroke_color = p_stroke_color, stroke_width = p_stroke_width
  where id = p_skill_id;
end;
$function$;

create or replace function public.get_shadow_pool(p_token text)
 returns table(shadow_character_id uuid)
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_player_id uuid; v_user_id uuid;
begin
  select player_id into v_player_id from public.player_sessions where token = p_token and expires_at > now();
  if v_player_id is null then raise exception 'غير مصرح'; end if;
  select user_id into v_user_id from public.players where id = v_player_id;
  return query select usp.shadow_character_id from public.user_shadow_pool usp where usp.user_id = v_user_id;
end;
$function$;

create or replace function public.pvp_list_shadow_pool(p_token text, p_self_character_id uuid)
 returns table(character_id uuid, character_name text, anime text, identity_image text, skill_id uuid, skill_name text, skill_type text, skill_damage integer, skill_cooldown integer, skill_effect text, skill_unblockable boolean, skill_color text, skill_description text, skill_params jsonb)
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_player_id uuid; v_user_id uuid;
begin
  v_player_id := public.player_id_from_token(p_token);
  select user_id into v_user_id from public.players where id = v_player_id;
  return query
  select c.id, c.name, c.anime, c.identity_image,
         s.id, s.name, s.type, s.damage, s.cooldown, s.effect, s.unblockable,
         s.color, s.description, s.params
  from public.characters c
  join public.character_skills cs on cs.character_id = c.id
  join public.skills s on s.id = cs.skill_id
  where (s.effect is null or s.effect <> 'shadow')
    and (p_self_character_id is null or c.id <> p_self_character_id)
    and v_user_id is not null
    and c.id in (
      select usp.shadow_character_id from public.user_shadow_pool usp
      where usp.user_id = v_user_id
        and (p_self_character_id is null or usp.shadow_character_id <> p_self_character_id)
    )
  order by c.name, s.name;
end;
$function$;