-- ===== موسوعة الوحوش (Bestiary): تتبع ما رآه اللاعب وهزمه =====

create table if not exists public.player_bestiary (
    player_id   uuid not null references public.players(id) on delete cascade,
    character_id uuid not null references public.characters(id) on delete cascade,
    seen        boolean not null default false,
    defeated    boolean not null default false,
    defeats     integer not null default 0,
    last_seen_at timestamp with time zone default now(),
    primary key (player_id, character_id)
);

-- تحديث سجل المواجهة: رؤية وهزيمة (تُستدعى عند انتهاء معركة PvE)
create or replace function public.bestiary_upsert(p_token text, p_character_id uuid, p_seen boolean, p_defeated boolean)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_player uuid;
begin
  v_player := public.player_id_from_token(p_token);
  if v_player is null then raise exception 'غير مصرح'; end if;

  insert into public.player_bestiary (player_id, character_id, seen, defeated, defeats, last_seen_at)
  values (v_player, p_character_id, true, p_defeated, case when p_defeated then 1 else 0 end, now())
  on conflict (player_id, character_id)
  do update set
    seen = true,
    defeated = player_bestiary.defeated or excluded.defeated,
    defeats = player_bestiary.defeats + case when excluded.defeated and not player_bestiary.defeated then 1 else 0 end,
    last_seen_at = now();
end;
$fn$;

-- إحضار الموسوعة: كل الوحوش + حالة كل وحش عند هذا اللاعب
create or replace function public.get_bestiary(p_token text)
returns table(
    id uuid, name text, anime text, level integer, hp integer, atk integer,
    identity_image text, gold_prize integer, seen boolean, defeated boolean, defeats integer
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_player uuid;
begin
  v_player := public.player_id_from_token(p_token);
  if v_player is null then raise exception 'غير مصرح'; end if;

  return query
  select c.id, c.name, c.anime, c.level, c.hp, c.atk, c.identity_image,
         coalesce(c.gold_prize, 0),
         coalesce(b.seen, false) as seen,
         coalesce(b.defeated, false) as defeated,
         coalesce(b.defeats, 0) as defeats
    from public.characters c
    left join public.player_bestiary b
           on b.character_id = c.id and b.player_id = v_player
   where c.is_monster = true
   order by c.level, c.name;
end;
$fn$;

grant execute on function public.bestiary_upsert(text, uuid, boolean, boolean) to anon, authenticated;
grant execute on function public.get_bestiary(text) to anon, authenticated;