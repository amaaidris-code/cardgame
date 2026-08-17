-- Fix push_dispatch for pg_net 0.20.x signature.
-- net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds int)
-- The body must be jsonb, not text. Casting to text caused
-- "function net.http_post(url, headers, body) does not exist".
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
        url  := v_url,
        body := v_body
    );
end;
$fn$;