-- عند حذف حساب لاعب، كان اللاعب المحذوف يُحسب ضمن قائمة أعضاء الكلان
-- والـ PVP والأصدقاء (صفوف يتيمة). نوسّع admin_delete_player لتنظيف كل
-- المراجع قبل حذف المستخدم، وننظّف أي صفوف يتيمة قائمة من قبل.

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

  -- تنظيف مراجع الكلان والـ PVP والأصدقاء الخاصة باللاعب المحذوف
  delete from clan_members where member_id = p_player_id;
  delete from pvp_matches where player1_id = p_player_id or player2_id = p_player_id;
  delete from pvp_cooldowns where player_id = p_player_id;
  delete from clan_dungeon_players where player_id = p_player_id;
  delete from clan_dungeon_claims where player_id = p_player_id;
  delete from friends where player_id = p_player_id or friend_id = p_player_id;
  delete from friend_requests where sender_id = p_player_id or receiver_id = p_player_id;
  delete from skill_requests where sender_id = p_player_id or receiver_id = p_player_id;

  delete from users where id = v_user_id;
end;
$function$;