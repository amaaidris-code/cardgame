CREATE OR REPLACE FUNCTION public.dm_get_messages(p_token text, p_other_player_id uuid, p_limit integer DEFAULT 200)
 RETURNS TABLE(id uuid, sender_id uuid, receiver_id uuid, message text, image_url text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
    v_me uuid;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    if not public.are_friends(v_me, p_other_player_id) then
        raise exception 'لا يمكنكم التحدث معًا قبل أن تكونا صديقين';
    end if;
    update public.private_messages
    set read_at = now()
    where private_messages.receiver_id = v_me and private_messages.sender_id = p_other_player_id
      and private_messages.read_at is null;
    return query
    select recent.id, recent.sender_id, recent.receiver_id, recent.message, recent.image_url, recent.created_at
    from (
        select m.id, m.sender_id, m.receiver_id, m.message, m.image_url, m.created_at
        from public.private_messages m
        where (m.sender_id = v_me and m.receiver_id = p_other_player_id)
           or (m.sender_id = p_other_player_id and m.receiver_id = v_me)
        order by m.created_at desc
        limit greatest(1, p_limit)
    ) recent
    order by recent.created_at asc;
end; $function$;