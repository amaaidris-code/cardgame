-- ============================================================
-- Global player chat (messenger-style), auto-deletes msgs >7 days
-- Access is via SECURITY DEFINER RPCs (custom player_token auth,
-- same pattern as the rest of the app). Direct table access disabled.
-- ============================================================

create table if not exists public.chat_messages (
    id          uuid primary key default gen_random_uuid(),
    player_id   uuid not null,
    username    text not null,
    message     text,
    image_url   text,
    created_at  timestamptz not null default now()
);

create index if not exists chat_messages_created_idx on public.chat_messages (created_at desc);

alter table public.chat_messages enable row level security;

-- No direct SELECT/INSERT policies: all access through SECURITY DEFINER
-- RPCs below so that only players holding a valid player_token can act.

-- helper: is a custom player session token valid?
create or replace function public.is_valid_player_session(p_token text)
returns boolean
language sql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
    select exists (
        select 1 from public.player_sessions
        where token = p_token and expires_at > now()
    );
$$;

-- send a message (text and/or image). Returns the stored row.
create or replace function public.chat_send_message(p_token text, p_message text, p_image_url text default null)
returns table (id uuid, player_id uuid, username text, message text, image_url text, created_at timestamptz)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_player_id uuid;
    v_username  text;
    v_msg       text;
    v_img       text;
    r_id        uuid;
    r_created   timestamptz;
begin
    v_player_id := public.player_id_from_token(p_token);
    if v_player_id is null then raise exception 'غير مصرح'; end if;

    select u.username into v_username
    from public.players p
    join public.users u on u.id = p.user_id
    where p.id = v_player_id;

    v_msg := nullif(btrim(p_message), '');
    v_img := nullif(btrim(p_image_url), '');
    if v_msg is null and v_img is null then
        raise exception 'الرسالة فارغة';
    end if;
    v_msg := left(v_msg, 1000);

    insert into public.chat_messages (player_id, username, message, image_url)
    values (v_player_id, coalesce(v_username, 'لاعب'), v_msg, v_img)
    returning chat_messages.id, chat_messages.created_at into r_id, r_created;

    return query
    select r_id, v_player_id, coalesce(v_username, 'لاعب'), v_msg, v_img, r_created;
end;
$fn$;

-- fetch recent messages (oldest->newest) AND purge anything older than 7 days.
create or replace function public.chat_get_messages(p_token text, p_limit int default 200)
returns table (id uuid, player_id uuid, username text, message text, image_url text, created_at timestamptz)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_player_id uuid;
begin
    v_player_id := public.player_id_from_token(p_token);
    if v_player_id is null then raise exception 'غير مصرح'; end if;

    -- auto-delete messages older than 7 days
    delete from public.chat_messages
    where chat_messages.created_at < now() - interval '7 days';

    return query
    select * from (
        select chat_messages.id, chat_messages.player_id, chat_messages.username,
               chat_messages.message, chat_messages.image_url, chat_messages.created_at
        from public.chat_messages
        order by chat_messages.created_at desc
        limit greatest(1, p_limit)
    ) t
    order by t.created_at asc;
end;
$fn$;

-- ============================================================
-- Storage bucket for chat images (public read, player upload)
-- Upload path must begin with a valid player_token.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', true, 5242880,
        array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do nothing;

drop policy if exists "chat images read" on storage.objects;
create policy "chat images read"
on storage.objects for select
using (bucket_id = 'chat-images');

drop policy if exists "chat images insert" on storage.objects;
create policy "chat images insert"
on storage.objects for insert
with check (bucket_id = 'chat-images'
            and public.is_valid_player_session((storage.foldername(name))[1]));
