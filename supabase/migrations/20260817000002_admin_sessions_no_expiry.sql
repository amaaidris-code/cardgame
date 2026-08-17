alter table public.admin_sessions alter column expires_at drop not null;
alter table public.admin_sessions alter column expires_at set default null;

create or replace function public.is_valid_admin_session(p_token text)
returns boolean
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from admin_sessions s
    where s.token = p_token and (s.expires_at is null or s.expires_at > now())
  );
$function$;

create or replace function public.admin_id_from_token(p_token text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_admin_id uuid;
begin
  if p_token is null then
    raise exception 'غير مصرح';
  end if;

  select admin_id into v_admin_id
  from admin_sessions
  where token = p_token and (expires_at is null or expires_at > now());

  if v_admin_id is null then
    raise exception 'غير مصرح، سجّل الدخول من جديد';
  end if;

  return v_admin_id;
end;
$function$;

create or replace function public.create_admin_session(p_admin_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_token text;
begin
  if not exists (select 1 from admins where id = p_admin_id) then
    raise exception 'غير مصرح';
  end if;

  if auth.jwt() is null or (auth.jwt() ->> 'email') is distinct from 'amaaidris@gmail.com' then
    raise exception 'يجب التحقق عبر رمز البريد الإداري أولاً';
  end if;

  delete from admin_sessions where expires_at is not null and expires_at <= now();

  v_token := encode(gen_random_bytes(32), 'hex');

  -- لا انتهاء صلاحية: الجلسة تبقى صالحة حتى تسجيل الخروج أو الحذف اليدوي
  insert into admin_sessions(token, admin_id, expires_at)
  values (v_token, p_admin_id, null);

  return v_token;
end;
$function$;

-- الجلسات الحالية تصبح دائمة أيضًا
update public.admin_sessions set expires_at = null;