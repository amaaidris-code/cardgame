-- ============================================================
-- Notify the owning player only.
--   * When an admin edits a character that a player owns
--     (characters.owner_id is set before AND after the update,
--     which excludes claim_character / upgrade of admin-only
--     chars / admin_delete_player), push to that player.
--   * When a skill is added to a character that has an owner
--     (character_skills insert), push to that player.
-- Newly created characters have owner_id = null, so creating
-- content through the AI assistant does NOT broadcast anything.
-- ============================================================

create or replace function public.push_trg_character_edited()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
    if new.owner_id is null or old.owner_id is null then
        return new;
    end if;
    perform public.push_dispatch(
        array[new.owner_id],
        'تم تعديل شخصيتك',
        'تم تحديث شخصيتك "' || coalesce(new.name, '') || '"'
    );
    return new;
end;
$fn$;

drop trigger if exists trg_push_character_edited on public.characters;
create trigger trg_push_character_edited
after update on public.characters
for each row execute function public.push_trg_character_edited();

create or replace function public.push_trg_character_new_skill()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
    v_owner uuid;
    v_name text;
begin
    select owner_id, name into v_owner, v_name
    from public.characters
    where id = new.character_id;
    if v_owner is null then
        return new;
    end if;
    perform public.push_dispatch(
        array[v_owner],
        'مهارة جديدة لشخصيتك',
        'حصلت شخصيتك "' || coalesce(v_name, '') || '" على مهارة جديدة'
    );
    return new;
end;
$fn$;

drop trigger if exists trg_push_character_new_skill on public.character_skills;
create trigger trg_push_character_new_skill
after insert on public.character_skills
for each row execute function public.push_trg_character_new_skill();