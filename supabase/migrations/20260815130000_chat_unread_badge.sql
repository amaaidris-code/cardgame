-- ============================================================
-- شارة الرسائل غير المقروءة في الدردشة العامة
-- تُرجع عدد الرسائل الأحدث من آخر وقت قراءة، مع توقيت آخر رسالة
-- ============================================================
create or replace function public.chat_unread(p_token text, p_since timestamptz)
returns table (unread bigint, latest timestamptz)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_player uuid;
begin
    v_player := public.player_id_from_token(p_token);
    if v_player is null then raise exception 'غير مصرح'; end if;

    return query
    select
        (select count(*)::bigint
           from public.chat_messages m
          where m.created_at > p_since
            and m.player_id <> v_player),
        (select max(created_at) from public.chat_messages);
end;
$fn$;