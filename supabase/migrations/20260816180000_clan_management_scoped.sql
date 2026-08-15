-- ============================================================
-- Clan management scoped to an explicit clan so admin accounts
-- (members of many clans) can manage whichever clan they view.
-- ============================================================
create or replace function public.clan_update(p_token text, p_clan_id uuid, p_name text, p_image_url text)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_me uuid;
    v_role text;
    v_name text;
    v_img text;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;

    select cm.role into v_role
    from public.clan_members cm
    where cm.clan_id = p_clan_id and cm.player_id = v_me;

    if v_role is null then raise exception 'أنت لست عضوًا في هذه العصابة'; end if;
    if v_role not in ('leader', 'admin') then
        raise exception 'فقط القائد أو المشرف يمكنه تعديل اسم وصورة العصابة';
    end if;

    v_name := nullif(btrim(p_name), '');
    v_img := nullif(btrim(coalesce(p_image_url, '')), '');

    if v_name is not null then
        if length(v_name) < 2 then raise exception 'الاسم قصير جدًا'; end if;
        v_name := left(v_name, 30);
        if exists(select 1 from public.clans c where c.name = v_name and c.id <> p_clan_id) then
            raise exception 'اسم العصابة مستخدم بالفعل؛ اختر اسمًا آخر';
        end if;
        update public.clans set name = v_name, updated_at = now() where id = p_clan_id;
    end if;

    if p_image_url is not null then
        update public.clans set image_url = v_img, updated_at = now() where id = p_clan_id;
    end if;
end;
$fn$;

create or replace function public.clan_leave(p_token text, p_clan_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_me uuid;
    v_role text;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;

    select cm.role into v_role
    from public.clan_members cm
    where cm.clan_id = p_clan_id and cm.player_id = v_me;

    if v_role is null then raise exception 'أنت لست عضوًا في هذه العصابة'; end if;

    delete from public.clan_members where clan_id = p_clan_id and player_id = v_me;

    if v_role = 'leader' then
        update public.clan_members set role = 'leader'
        where clan_id = p_clan_id and player_id = (
            select cm2.player_id from public.clan_members cm2
            where cm2.clan_id = p_clan_id
            order by (cm2.role = 'admin') desc, cm2.joined_at asc limit 1);
        if not exists(select 1 from public.clan_members where clan_id = p_clan_id) then
            delete from public.clan_messages where clan_id = p_clan_id;
            delete from public.clans where id = p_clan_id;
        end if;
    end if;
end;
$fn$;

create or replace function public.clan_promote(p_token text, p_clan_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_me uuid;
    v_role text;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;

    select cm.role into v_role
    from public.clan_members cm
    where cm.clan_id = p_clan_id and cm.player_id = v_me;
    if v_role is null then raise exception 'أنت لست عضوًا في هذه العصابة'; end if;
    if v_role <> 'leader' then raise exception 'فقط القائد يمكنه رفع المشرفين'; end if;

    if not exists(select 1 from public.clan_members cm
                  where cm.clan_id = p_clan_id and cm.player_id = p_player_id) then
        raise exception 'العضو غير موجود في عصابتك';
    end if;

    update public.clan_members set role = 'admin'
    where clan_id = p_clan_id and player_id = p_player_id;
end;
$fn$;

create or replace function public.clan_demote(p_token text, p_clan_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_me uuid;
    v_role text;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;

    select cm.role into v_role
    from public.clan_members cm
    where cm.clan_id = p_clan_id and cm.player_id = v_me;
    if v_role is null then raise exception 'أنت لست عضوًا في هذه العصابة'; end if;
    if v_role <> 'leader' then raise exception 'فقط القائد يمكنه إزالة مشرف'; end if;

    update public.clan_members set role = 'member'
    where clan_id = p_clan_id and player_id = p_player_id and role = 'admin';
end;
$fn$;

create or replace function public.clan_kick(p_token text, p_clan_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
    v_me uuid;
    v_role text;
begin
    v_me := public.player_id_from_token(p_token);
    if v_me is null then raise exception 'غير مصرح'; end if;

    select cm.role into v_role
    from public.clan_members cm
    where cm.clan_id = p_clan_id and cm.player_id = v_me;
    if v_role is null then raise exception 'أنت لست عضوًا في هذه العصابة'; end if;
    if v_role not in ('leader', 'admin') then raise exception 'غير مصرح'; end if;

    if exists(select 1 from public.clan_members cm
              where cm.clan_id = p_clan_id and cm.player_id = p_player_id and cm.role = 'leader') then
        raise exception 'لا يمكن طرد القائد';
    end if;

    delete from public.clan_members
    where clan_id = p_clan_id and player_id = p_player_id;
end;
$fn$;