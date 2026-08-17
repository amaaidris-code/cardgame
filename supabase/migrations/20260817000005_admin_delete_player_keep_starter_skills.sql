-- عندما يُحذف حساب لاعب، تصبح شخصيته مملوكة لأحد (owner_id -> NULL) عبر
-- قيد characters_owner_id_fkey  ON DELETE SET NULL، فتظل المهارات المكتسبة
-- (character_skills) قائمة. ننظّف هنا كل مهارات الشخصية التي يملكها اللاعب
-- المحذوف، مع الإبقاء على المهارات الأساسية الثلاث الأولى فقط (slots 1-3).

create or replace function public.admin_delete_player(p_admin_token text, p_player_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_admin_id uuid;
  v_user_id uuid;
begin
  v_admin_id := admin_id_from_token(p_admin_token);

  if exists (select 1 from admins where player_id = p_player_id) then
    raise exception 'لا يمكن حذف هذا الحساب لأنه حساب اختبار مرتبط بأدمن';
  end if;

  select user_id into v_user_id from players where id = p_player_id;

  if v_user_id is null then
    raise exception 'اللاعب غير موجود';
  end if;

  -- إبقاء المهارات الأساسية الثلاث الأولى فقط وحذف ما بعدها
  delete from character_skills cs
  where cs.slot > 3
    and exists (
      select 1 from characters c
      where c.id = cs.character_id
        and c.owner_id = p_player_id
    );

  delete from users where id = v_user_id;
end;
$function$;