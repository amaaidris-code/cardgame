-- ممتابعة مهمة التدريب: تكتشف هل أنهى اللاعب التدريب
alter table public.players add column if not exists tutorial_done boolean not null default false;

-- RPC: هل أنهى اللاعب مهمة التدريب؟
create or replace function public.get_tutorial_done(p_token text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_player uuid;
  v_done boolean;
begin
  v_player := public.player_id_from_token(p_token);
  if v_player is null then
    raise exception 'غير مصرح';
  end if;

  select coalesce(tutorial_done, false) into v_done
    from public.players
   where id = v_player;

  return v_done;
end;
$fn$;

-- RPC: إنهاء مهمة التدريب ومكافأة اللاعب
create or replace function public.tutorial_complete(p_token text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_player uuid;
begin
  v_player := public.player_id_from_token(p_token);
  if v_player is null then
    raise exception 'غير مصرح';
  end if;

  update public.players
     set tutorial_done = true,
         gold = gold + 100
   where id = v_player;
end;
$fn$;

-- مقاتل التدريب (الدمية): خصم ضعيف ليعلم اللاعب الأساسيات
do $$
begin
  if not exists (select 1 from public.characters where id = '00000000-0000-0000-0000-0000000000a1') then
    insert into public.characters
      (id, name, anime, level, hp, atk, identity_image, quote, description,
       power_name, power_description, is_monster, admin_only, available, status, glow_color)
    values
      ('00000000-0000-0000-0000-0000000000a1',
       'الدمية التدريبية',
       'أكاديمية الأبطال',
       1,
       180,
       45,
       'data:image/svg+xml,%3Csvg%20xmlns%3D''http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg''%20viewBox%3D''0%200%20200%20260''%3E%3Cdefs%3E%3ClinearGradient%20id%3D''w''%20x1%3D''0''%20y1%3D''0''%20x2%3D''0''%20y2%3D''1''%3E%3Cstop%20offset%3D''0''%20stop-color%3D''%23e8b96a''%2F%3E%3Cstop%20offset%3D''1''%20stop-color%3D''%239c6b2f''%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect%20x%3D''40''%20y%3D''8''%20width%3D''120''%20height%3D''7''%20rx%3D''3.5''%20fill%3D''%237a5220''%2F%3E%3Crect%20x%3D''80''%20y%3D''42''%20width%3D''40''%20height%3D''182''%20rx%3D''10''%20fill%3D''url(%23w)''%20stroke%3D''%236b4a1e''%20stroke-width%3D''3''%2F%3E%3Crect%20x%3D''50''%20y%3D''96''%20width%3D''100''%20height%3D''15''%20rx%3D''7''%20fill%3D''url(%23w)''%20stroke%3D''%236b4a1e''%20stroke-width%3D''3''%2F%3E%3Crect%20x%3D''50''%20y%3D''188''%20width%3D''100''%20height%3D''15''%20rx%3D''7''%20fill%3D''url(%23w)''%20stroke%3D''%236b4a1e''%20stroke-width%3D''3''%2F%3E%3Crect%20x%3D''78''%20y%3D''78''%20width%3D''44''%20height%3D''32''%20rx%3D''11''%20fill%3D''%23c9974b''%2F%3E%3Ccircle%20cx%3D''100''%20cy%3D''36''%20r%3D''27''%20fill%3D''url(%23w)''%20stroke%3D''%236b4a1e''%20stroke-width%3D''3''%2F%3E%3Cpath%20d%3D''M73%2031%20Q100%2046%20127%2031''%20fill%3D''none''%20stroke%3D''%23dc2626''%20stroke-width%3D''8''%20stroke-linecap%3D''round''%2F%3E%3Ccircle%20cx%3D''89''%20cy%3D''35''%20r%3D''4''%20fill%3D''%232b1a06''%2F%3E%3Ccircle%20cx%3D''111''%20cy%3D''35''%20r%3D''4''%20fill%3D''%232b1a06''%2F%3E%3Cpath%20d%3D''M89%2047%20Q100%2056%20111%2047''%20fill%3D''none''%20stroke%3D''%232b1a06''%20stroke-width%3D''3.5''%20stroke-linecap%3D''round''%2F%3E%3Crect%20x%3D''88''%20y%3D''155''%20width%3D''24''%20height%3D''20''%20rx%3D''9''%20fill%3D''%237a5220''%2F%3E%3C%2Fsvg%3E',
       'هل تريد تعلم القتال؟',
       'دمية التدريب في أكاديمية الأبطال، مثالية لتعلّم أساسيات القتال والهجوم.',
       'عين المدرب',
       'يراقب الحركات ويقترح أفضل تكمه، لكنه لا يقاتل بحرص شديد.',
       true,
       true,
       false,
       'approved',
       null);
  end if;
end $$;

-- مهارات الدمية التدريبية
insert into public.skills (id, name, description, type, damage, cooldown, effect, unblockable, color, params)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'لكمة التدريب', 'ضربة مباشرة بسيطة.', 'attack', 50, 0, null, false, '#dbeafe', '{}'::jsonb),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'قبضة الاختراق', 'ضربة لا يمكن صدّها.', 'special', 50, 2, null, true, '#ffc04d', '{}'::jsonb),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'أنياب السم', 'يسمم الخصم فيتضرر كل دور.', 'special', 5, 3, 'poison', false, '#a3e635', '{"poison_damage":10,"poison_turns":3}'::jsonb)
on conflict (id) do nothing;

insert into public.character_skills (id, character_id, skill_id, slot)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 1),
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000002', 2),
  ('bbbbbbbb-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000003', 3)
on conflict (id) do nothing;

-- منح المستخدمين العموميين صلاحية استدعاء RPC
grant execute on function public.get_tutorial_done(text) to anon, authenticated;
grant execute on function public.tutorial_complete(text) to anon, authenticated;