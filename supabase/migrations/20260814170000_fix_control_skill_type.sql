-- Fix "سيطرة" (control) skill being miscounted as a damage attack skill.
-- It was stored as type='attack', effect=null, so client and server both treated
-- it as a damaging attack, splitting the ATK boost across attack skills (basic
-- attack only got a fraction of ATK). Control skills are type='special' with an
-- effect (like steal/unseal/freeze). Set it to the control convention.

update public.skills
set type = 'special',
    effect = 'control',
    damage = 1
where id = '9d0d31d9-ef06-4537-a3a9-4da4a312d9c5';
