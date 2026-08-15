-- Fix "سيطرة" (control) skill on لولوش being miscounted as a damage attack skill.
-- It was stored as type='attack', effect=null, so client and server both treated
-- it as a damaging attack instead of a control ability. Control skills are
-- type='special' with effect='control' (matching the ريمورو copy).

update public.skills
set type = 'special',
    effect = 'control',
    damage = 1
where id = '660a74f4-53a1-416c-84e2-54f3bc5efbbe';