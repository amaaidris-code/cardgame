-- ============================================================
-- Push notification trigger wiring.
-- Fires after rows are inserted that represent something a player
-- needs to know about even while offline, and dispatches via
-- public.push_dispatch (async pg_net -> send-push edge function).
-- ============================================================

-- ---------- private messages ----------
create or replace function public.push_trg_private_message()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
    v_from_name text;
begin
    if new.receiver_id = new.sender_id then
        return new;
    end if;

    select u.username into v_from_name
    from public.players pl
    join public.users u on u.id = pl.user_id
    where pl.id = new.sender_id;

    perform public.push_dispatch(
        array[new.receiver_id],
        coalesce(v_from_name, 'رسالة خاصة'),
        left(coalesce(new.message, 'رسالة مصوّرة'), 120)
    );
    return new;
end;
$fn$;

drop trigger if exists trg_push_private_message on public.private_messages;
create trigger trg_push_private_message
after insert on public.private_messages
for each row execute function public.push_trg_private_message();

-- ---------- friend requests ----------
create or replace function public.push_trg_friend_request()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
    v_from_name text;
begin
    if new.status <> 'pending' then return new; end if;
    select u.username into v_from_name
    from public.players pl
    join public.users u on u.id = pl.user_id
    where pl.id = new.from_player_id;
    perform public.push_dispatch(
        array[new.to_player_id],
        'طلب صداقة',
        coalesce(v_from_name, 'أحد اللاعبين') || ' أرسل لك طلب صداقة'
    );
    return new;
end;
$fn$;

drop trigger if exists trg_push_friend_request on public.friend_requests;
create trigger trg_push_friend_request
after insert on public.friend_requests
for each row execute function public.push_trg_friend_request();

-- ---------- pvp challenge ----------
create or replace function public.push_trg_pvp_challenge()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
    v_from_name text;
begin
    if new.status <> 'pending' then return new; end if;
    select u.username into v_from_name
    from public.players pl
    join public.users u on u.id = pl.user_id
    where pl.id = new.player1_id;
    perform public.push_dispatch(
        array[new.player2_id],
        'تحدي PvP',
        coalesce(v_from_name, 'أحد اللاعبين') || ' يتحداك في معركة'
    );
    return new;
end;
$fn$;

drop trigger if exists trg_push_pvp_challenge on public.pvp_matches;
create trigger trg_push_pvp_challenge
after insert on public.pvp_matches
for each row execute function public.push_trg_pvp_challenge();

-- ---------- clan chat ----------
create or replace function public.push_trg_clan_message()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
    v_clan_name text;
    v_from_name text;
    v_recipients uuid[];
begin
    select c.name into v_clan_name from public.clans c where c.id = new.clan_id;
    select u.username into v_from_name
    from public.players pl
    join public.users u on u.id = pl.user_id
    where pl.id = new.sender_id;

    select array_agg(cm.player_id) into v_recipients
    from public.clan_members cm
    where cm.clan_id = new.clan_id
      and cm.player_id <> new.sender_id;

    if v_recipients is null then return new; end if;

    perform public.push_dispatch(
        v_recipients,
        coalesce(v_clan_name, 'العصابة'),
        coalesce(v_from_name, 'عضو') || ': ' || left(coalesce(new.message, 'رسالة مصوّرة'), 120)
    );
    return new;
end;
$fn$;

drop trigger if exists trg_push_clan_message on public.clan_messages;
create trigger trg_push_clan_message
after insert on public.clan_messages
for each row execute function public.push_trg_clan_message();

-- ---------- clan dungeon raid created ----------
create or replace function public.push_trg_clan_dungeon_raid()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
    v_recipients uuid[];
begin
    if new.status <> 'lobby' then return new; end if;
    select array_agg(cm.player_id) into v_recipients
    from public.clan_members cm
    where cm.clan_id = new.clan_id;
    if v_recipients is null then return new; end if;
    perform public.push_dispatch(
        v_recipients,
        'زنزانة عصابة',
        'انطلق تحدٍّ جماعي جديد في زنزانة العصابة'
    );
    return new;
end;
$fn$;

drop trigger if exists trg_push_clan_dungeon_raid on public.clan_dungeon_runs;
create trigger trg_push_clan_dungeon_raid
after insert on public.clan_dungeon_runs
for each row execute function public.push_trg_clan_dungeon_raid();