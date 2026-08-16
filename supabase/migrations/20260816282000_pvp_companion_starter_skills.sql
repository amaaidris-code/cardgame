-- ============================================================
-- Starter companion skills.
-- Assign a small, themed skill set to each purchasable companion
-- so they can fight in both PvE/Clan-dungeon and PvP battles.
-- Idempotent: skill slots are keyed by (companion_id, skill_id).
-- Damages come from the existing shared skills table.
-- ============================================================

-- الصقر الحارس: طائر جارح — هجمات حارقة، اضطراب جوي، ودفاع مكاني
insert into public.companion_skills (companion_id, skill_id, slot)
select c.id, s.id, 1
from public.companions c, public.skills s
where c.name = 'الصقر الحارس' and s.name = 'اللهب الاسود'
on conflict (companion_id, skill_id) do nothing;

insert into public.companion_skills (companion_id, skill_id, slot)
select c.id, s.id, 2
from public.companions c, public.skills s
where c.name = 'الصقر الحارس' and s.name = 'هجوم لا يصد'
on conflict (companion_id, skill_id) do nothing;

insert into public.companion_skills (companion_id, skill_id, slot)
select c.id, s.id, 3
from public.companions c, public.skills s
where c.name = 'الصقر الحارس' and s.name = 'دوامة الاعصار'
on conflict (companion_id, skill_id) do nothing;

insert into public.companion_skills (companion_id, skill_id, slot)
select c.id, s.id, 4
from public.companions c, public.skills s
where c.name = 'الصقر الحارس' and s.name = 'النقل المكاني'
on conflict (companion_id, skill_id) do nothing;

-- النمر الأسود: مفترس ليلي — أنياب قاطعة، ضربة ظل، ذيل مهتز، درع ظل
insert into public.companion_skills (companion_id, skill_id, slot)
select c.id, s.id, 1
from public.companions c, public.skills s
where c.name = 'النمر الأسود' and s.name = 'الانياب القاطعة'
on conflict (companion_id, skill_id) do nothing;

insert into public.companion_skills (companion_id, skill_id, slot)
select c.id, s.id, 2
from public.companions c, public.skills s
where c.name = 'النمر الأسود' and s.name = 'لهيب الروح'
on conflict (companion_id, skill_id) do nothing;

insert into public.companion_skills (companion_id, skill_id, slot)
select c.id, s.id, 3
from public.companions c, public.skills s
where c.name = 'النمر الأسود' and s.name = 'الذيل المهتز'
on conflict (companion_id, skill_id) do nothing;

insert into public.companion_skills (companion_id, skill_id, slot)
select c.id, s.id, 4
from public.companions c, public.skills s
where c.name = 'النمر الأسود' and s.name = 'درع الظل'
on conflict (companion_id, skill_id) do nothing;