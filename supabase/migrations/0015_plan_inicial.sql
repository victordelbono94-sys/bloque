-- Bloque · completar perfil y armar el plan de alguien nuevo.
-- Un equipo nuevo no tiene ejercicios: se copian los del equipo plantilla (con fotos, técnica y
-- alternativas) y con eso la app arma las rutinas según días, objetivo y deporte.

alter table public.hogares add column if not exists es_plantilla boolean not null default false;
update public.hogares set es_plantilla = true where id = '7e579096-dbbe-46a2-9605-5e3ad99e3c04';

alter table public.personas add column if not exists experiencia text
  check (experiencia in ('principiante', 'intermedio', 'avanzado'));

create or replace function public.copiar_catalogo()
returns integer
language plpgsql security definer set search_path = public, privado as $$
declare
  destino uuid := privado.mi_hogar();
  origen uuid;
  n integer;
begin
  if destino is null then raise exception 'Sin equipo'; end if;
  select count(*) into n from public.ejercicios where hogar_id = destino;
  if n > 0 then return 0; end if;
  select id into origen from public.hogares where es_plantilla order by creado_en limit 1;
  if origen is null or origen = destino then return 0; end if;

  create temp table mapa_maq on commit drop as
    select id as viejo, gen_random_uuid() as nuevo from public.maquinas where hogar_id = origen;
  insert into public.maquinas (id, hogar_id, nombre, grupo_muscular, url_ficha)
    select m.nuevo, destino, q.nombre, q.grupo_muscular, q.url_ficha from public.maquinas q join mapa_maq m on m.viejo = q.id;

  create temp table mapa_ej on commit drop as
    select id as viejo, gen_random_uuid() as nuevo from public.ejercicios where hogar_id = origen;
  insert into public.ejercicios (id, hogar_id, nombre, grupo_muscular, maquina_id, descripcion, unidad, imagenes, tecnica, video_url, por_lado)
    select m.nuevo, destino, e.nombre, e.grupo_muscular, mq.nuevo, e.descripcion, e.unidad, e.imagenes, e.tecnica, e.video_url, e.por_lado
    from public.ejercicios e join mapa_ej m on m.viejo = e.id left join mapa_maq mq on mq.viejo = e.maquina_id;
  get diagnostics n = row_count;

  insert into public.ejercicio_alternativas (ejercicio_id, alternativa_id)
    select a.nuevo, b.nuevo from public.ejercicio_alternativas x
    join mapa_ej a on a.viejo = x.ejercicio_id join mapa_ej b on b.viejo = x.alternativa_id;
  return n;
end $$;
revoke all on function public.copiar_catalogo() from public, anon;
grant execute on function public.copiar_catalogo() to authenticated;
