-- pvp_seal_or_unseal_skill was SECURITY INVOKER while pvp_matches has RLS
-- with zero policies, so the invoker could not see the match row and the
-- seal/unseal flow raised "المباراة غير موجودة" (fight not found).
ALTER FUNCTION public.pvp_seal_or_unseal_skill(p_token text, p_match_id uuid, p_ability_skill_id uuid, p_target_skill_id uuid)
SECURITY DEFINER
SET search_path = public, extensions, pg_temp;
