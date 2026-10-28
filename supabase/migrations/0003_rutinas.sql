-- Bloque · rutinas
-- 1. Cada ejercicio de una rutina guarda su objetivo base (series, reps, descanso),
--    del que salen las metas de cada persona.
-- 2. Algunos ejercicios se miden en segundos (plancha, equilibrio).
-- 3. Cada persona termina su propio entreno dentro de la sesión compartida.
-- 4. Las metas se crean solas: al agregar un ejercicio a una rutina y cuando
--    alguien se une al hogar.

alter table public.ejercicios
  add column unidad text not null default 'reps' check (unidad in ('reps', 'segundos'));

alter table public.rutina_ejercicios
  add column series_base   smallint not null default 3 check (series_base > 0),
  add column reps_base     smallint not null default 10 check (reps_base > 0),
  add column descanso_base smallint not null default 90 check (descanso_base >= 0);

alter table public.sesiones
  add column terminados uuid[] not null default '{}';

-- Metas iniciales para todas las personas del hogar cuando se agrega un ejercicio.
create or replace function privado.metas_para_ejercicio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.metas_ejercicio (rutina_ejercicio_id, persona_id, series, reps, peso_kg, descanso_seg)
  select new.id, p.id, new.series_base, new.reps_base, null, new.descanso_base
  from public.rutinas r
  join public.personas p on p.hogar_id = r.hogar_id
  where r.id = new.rutina_id
  on conflict (rutina_ejercicio_id, persona_id) do nothing;
  return new;
end
$$;

create trigger rutina_ejercicios_metas
  after insert on public.rutina_ejercicios
  for each row execute function privado.metas_para_ejercicio();

-- Metas iniciales para quien se une al hogar.
create or replace function privado.metas_para_persona()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.metas_ejercicio (rutina_ejercicio_id, persona_id, series, reps, peso_kg, descanso_seg)
  select re.id, new.id, re.series_base, re.reps_base, null, re.descanso_base
  from public.rutina_ejercicios re
  join public.rutinas r on r.id = re.rutina_id
  where r.hogar_id = new.hogar_id
  on conflict (rutina_ejercicio_id, persona_id) do nothing;
  return new;
end
$$;

create trigger personas_metas
  after insert on public.personas
  for each row execute function privado.metas_para_persona();

revoke all on function privado.metas_para_ejercicio() from public, anon, authenticated;
revoke all on function privado.metas_para_persona() from public, anon, authenticated;
