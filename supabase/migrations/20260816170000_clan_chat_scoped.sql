-- ============================================================
-- Clan chat scoped to an explicit clan so that admin accounts
-- (members of many clans) can chat in whichever clan they view.
-- ============================================================
create or replace function public.clan_send_message(p_token text, p_clan_id uuid, p_message text, p_image_url text default null)
returns table (id uuid, clan_id uuid, sender_id uuid, sender_username text, message text, image_url text, created_at timestamptz)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_me uuid;
    v_msg text;
    v_img text;
    r_id uuid;
    r_created timestamptz;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;

    if not exists(select 1 from public.clan_members cm
                  where cm.clan_id = p_clan_id and cm.player_id = v_me) then
        raise exception 'يجب أن تكون عضوًا في هذه العصابة لتكتب';
    end if;

    v_msg := nullif(btrim(p_message), '');
    v_img := nullif(btrim(coalesce(p_image_url, '')), '');
    if v_msg is null and v_img is null then raise exception 'الرسالة فارغة'; end if;
    v_msg := left(v_msg, 1000);

    insert into public.clan_messages (clan_id, sender_id, message, image_url)
    values (p_clan_id, v_me, v_msg, v_img)
    returning clan_messages.id, clan_messages.created_at into r_id, r_created;

    return query
    select r_id, p_clan_id, v_me, u.username, v_msg, v_img, r_created
    from public.players pl
    join public.users u on u.id = pl.user_id
    where pl.id = v_me;
end;
$fn$;

create or replace function public.clan_get_messages(p_token text, p_clan_id uuid, p_limit int default 200)
returns table (id uuid, clan_id uuid, sender_id uuid, sender_username text, message text, image_url text, created_at timestamptz)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare v_me uuid;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;

    if not exists(select 1 from public.clan_members cm
                  where cm.clan_id = p_clan_id and cm.player_id = v_me) then
        raise exception 'يجب أن تكون عضوًا في هذه العصابة';
    end if;

    return query
    select * from (
        select cm.id, cm.clan_id, cm.sender_id, u.username as sender_username,
               cm.message, cm.image_url, cm.created_at
        from public.clan_messages cm
        join public.players pl on pl.id = cm.sender_id
        join public.users u on u.id = pl.user_id
        where cm.clan_id = p_clan_id
        order by cm.created_at desc
        limit greatest(1, least(p_limit, 300))
    ) t order by t.created_at asc;
end;
$fn$;