-- NOTE: CREATE OR REPLACE FUNCTION resets SECURITY DEFINER to the default
-- (SECURITY INVOKER). pvp_use_skill reads pvp_matches, which has RLS with
-- zero policies, so it must run as the definer (owner) to see the row.
-- This restores the SECURITY DEFINER flag + hardened search_path that the
-- function had before the rewrite in 20260814023431.
ALTER FUNCTION public.pvp_use_skill(p_token text, p_match_id uuid, p_skill_id uuid)
SECURITY DEFINER
SET search_path = public, extensions, pg_temp;