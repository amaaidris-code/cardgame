-- ============================================================
-- Push notifications for the main (global) chat section.
-- Fires after a row is inserted into chat_messages and notifies
-- every player except the sender, mirroring the private-message
-- and clan-chat triggers.
-- ============================================================

create or replace function public.push_trg_global_chat()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
    v_recipients uuid[];
    v_body text;
begin
    -- لا نرسل إشعارًا لرسائل المرسل نفسه
    select array_agg(p.id) into v_recipients
    from public.players p
    where p.id is distinct from new.player_id;

    if v_recipients is null then
        return new;
    end if;

    v_body := coalesce(nullif(btrim(new.message), ''), '📷 شارك صورة');
    v_body := coalesce(new.username, 'لاعب') || ': ' || left(v_body, 120);

    perform public.push_dispatch(
        v_recipients,
        'الدردشة الرئيسية',
        v_body
    );
    return new;
end;
$fn$;

drop trigger if exists trg_push_global_chat on public.chat_messages;
create trigger trg_push_global_chat
after insert on public.chat_messages
for each row execute function public.push_trg_global_chat();