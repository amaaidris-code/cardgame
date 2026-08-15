-- ============================================================
-- Clans: remove obsolete overloads now that RPCs are clan-scoped.
-- Keeps PostgREST resolution unambiguous for the client.
-- ============================================================
drop function if exists public.clan_demote(text, uuid);
drop function if exists public.clan_get_messages(text, integer);
drop function if exists public.clan_kick(text, uuid);
drop function if exists public.clan_leave(text);
drop function if exists public.clan_promote(text, uuid);
drop function if exists public.clan_send_message(text, text, text);
drop function if exists public.clan_update(text, text, text);