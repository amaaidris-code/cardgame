-- • بدء الغارة:
--   - اللاعب المنفرد (واحد فقط في الغرفة) يبدأ الغارة مباشرة فور الضغط.
--   - جماعي (2+): لا يبدأ قبل أن يصبح جميع الموجودين "جاهزين" (ready).
--
-- • نظام رسائل الغارة (Sub-Channel): محادثة فورية خاصة بأعضاء الغارة
--   لتنسيق الخطة أثناء اللعب. الوصول عبر RPC فقط (SECURITY DEFINER).

-- ---------- جدول رسائل الغارة ----------
create table if not exists public.clan_dungeon_messages (
    id         uuid primary key default gen_random_uuid(),
    run_id     uuid not null references public.clan_dungeon_runs(id) on delete cascade,
    sender_id  uuid not null,
    message    text,
    created_at timestamptz not null default now()
);

create index if not exists clan_dungeon_messages_run_idx
    on public.clan_dungeon_messages (run_id, created_at);

alter table public.clan_dungeon_messages enable row level security;

-- ---------- بدء السباق / الغارة ----------
create or replace function public.clan_dungeon_start_race(p_token text, p_run_id uuid)
returns void
language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $function$
declare v_me uuid; v_run record; v_n int; v_all_ready boolean;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    select * into v_run from public.clan_dungeon_runs where id=p_run_id for update;
    if v_run.id is null then raise exception 'الزنزانة غير موجودة'; end if;
    if v_run.status <> 'lobby' then raise exception 'الزنزانة بدأت بالفعل'; end if;
    if not exists(select 1 from public.clan_dungeon_players cp where cp.run_id=p_run_id and cp.player_id=v_me) then
        raise exception 'لست في هذه الزنزانة';
    end if;

    v_n := (select count(*)::int from public.clan_dungeon_players cp where cp.run_id=p_run_id);

    -- وحيد/منفرد: ابدأ مباشرة دون انتظار جاهزية
    if v_n = 1 then
        update public.clan_dungeon_runs set
            status='active', turn_order=array[v_me], turn_slot=0, turn_phase='player',
            monster_index=0, winner_id=null
        where id=p_run_id;
        perform public.clan_dungeon_spawn_monster(p_run_id);
        perform public.clan_dungeon_schedule_player(p_run_id, -1);
        return;
    end if;

    -- جماعي: لا تبدأ حتى يجاهز الجميع
    v_all_ready := not exists(
        select 1 from public.clan_dungeon_players cp
        where cp.run_id=p_run_id and not coalesce(cp.ready, false)
    );
    if not v_all_ready then
        raise exception 'انتظر حتى يكون جميع اللاعبين جاهزين لبدء السباق';
    end if;

    update public.clan_dungeon_players set race_press_at=null where run_id=p_run_id;
    update public.clan_dungeon_runs set status='race', race_started_at=now() where id=p_run_id;
end;
$function$;

-- ---------- إرسال رسالة غارة ----------
create or replace function public.clan_dungeon_send_message(p_token text, p_run_id uuid, p_message text)
returns table (id uuid, run_id uuid, sender_id uuid, sender_username text, message text, created_at timestamptz)
language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $function$
declare v_me uuid; v_msg text; r_id uuid; r_created timestamptz;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    if not exists(select 1 from public.clan_dungeon_players cp where cp.run_id=p_run_id and cp.player_id=v_me) then
        raise exception 'لست في هذه الزنزانة';
    end if;
    v_msg := nullif(btrim(p_message),'');
    if v_msg is null then raise exception 'الرسالة فارغة'; end if;
    v_msg := left(v_msg, 500);
    insert into public.clan_dungeon_messages (run_id, sender_id, message)
    values (p_run_id, v_me, v_msg) returning id, created_at into r_id, r_created;
    return query
    select r_id, p_run_id, v_me, u.username, v_msg, r_created
    from public.players pl join public.users u on u.id=pl.user_id where pl.id=v_me;
end;
$function$;

-- ---------- قراءة رسائل الغارة ----------
create or replace function public.clan_dungeon_get_messages(p_token text, p_run_id uuid, p_limit int default 100)
returns table (id uuid, run_id uuid, sender_id uuid, sender_username text, message text, created_at timestamptz)
language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $function$
declare v_me uuid;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;
    if not exists(select 1 from public.clan_dungeon_players cp where cp.run_id=p_run_id and cp.player_id=v_me) then
        raise exception 'لست في هذه الزنزانة';
    end if;
    return query
    select * from (
        select cm.id, cm.run_id, cm.sender_id, u.username as sender_username, cm.message, cm.created_at
        from public.clan_dungeon_messages cm
        join public.players pl on pl.id=cm.sender_id
        join public.users u on u.id=pl.user_id
        where cm.run_id=p_run_id
        order by cm.created_at desc
        limit greatest(1, least(p_limit, 200))
    ) t order by t.created_at asc;
end;
$function$;