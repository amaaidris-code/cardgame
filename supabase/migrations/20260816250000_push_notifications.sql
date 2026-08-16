-- ============================================================
-- Push notifications
--   * device_tokens holds one FCM device token per (player, device).
--   * register/remove are SECURITY DEFINER RPCs gated by p_token.
--   * A trigger helper `push_dispatch` asynchronously POSTs a
--     notification to the `send-push` Edge Function via pg_net,
--     using an internal secret stored in Vault (never in git).
-- ============================================================

create extension if not exists pg_net;

-- ---------- device_tokens ----------
create table if not exists public.device_tokens (
    player_id    uuid not null,
    device_token text not null,
    platform     text not null default 'android',
    created_at   timestamptz not null default now(),
    primary key (player_id, device_token)
);

create index if not exists device_tokens_player_idx on public.device_tokens (player_id);

alter table public.device_tokens enable row level security;

-- ---------- vault secret access (service_role only) ----------
grant usage on schema vault to service_role;
grant select on vault.decrypted_secrets to service_role;

create or replace function public.push_get_secret(p_name text)
returns text
language sql
security definer
set search_path to 'vault', 'public', 'pg_temp'
as $$
    select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$$;

revoke all on function public.push_get_secret(text) from public;
grant execute on function public.push_get_secret(text) to service_role;

-- register a device token for the current player
create or replace function public.push_register_token(p_token text, p_device_token text, p_platform text default 'android')
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_me uuid;
    v_tok text;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    v_tok := nullif(btrim(p_device_token), '');
    if v_tok is null then return; end if;
    insert into public.device_tokens (player_id, device_token, platform)
    values (v_me, v_tok, coalesce(nullif(btrim(p_platform), ''), 'android'))
    on conflict (player_id, device_token)
        do update set platform = excluded.platform, created_at = now();
end;
$fn$;

-- remove a device token for the current player
create or replace function public.push_remove_token(p_token text, p_device_token text)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare v_me uuid;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    delete from public.device_tokens
    where player_id = v_me and device_token = p_device_token;
end;
$fn$;

-- ---------- dispatcher ----------
-- Reads the internal push secret from Vault and fires an async HTTP
-- POST to the send-push Edge Function.
create or replace function public.push_dispatch(p_recipient_ids uuid[], p_title text, p_body text, p_data jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'vault', 'extensions', 'pg_temp'
as $fn$
declare
    v_secret text;
    v_body   jsonb;
    v_url    text;
begin
    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'push_internal_secret'
    limit 1;

    if v_secret is null then return; end if;

    v_body := jsonb_build_object(
        'secret', v_secret,
        'recipient_ids', to_jsonb(p_recipient_ids),
        'title', p_title,
        'body', p_body,
        'data', coalesce(p_data, '{}'::jsonb)
    );

    v_url := 'https://cbjphdhoabktsplcxvxu.supabase.co/functions/v1/send-push';

    perform net.http_post(
        url     := v_url,
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body    := v_body::text
    );
end;
$fn$;
