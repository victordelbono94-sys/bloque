-- Bloque · aplicar a una rutina la lista de ejercicios que propone la IA (o el editor):
-- conserva los ejercicios que quedan (con sus metas y pesos), quita los que salen y agrega los nuevos.
-- p_items: [{ "ejercicio_id": uuid, "series": n, "reps": n, "descanso": seg }] en orden.
create or replace function public.aplicar_rutina(p_rutina uuid, p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  k int := 0;
  ej uuid;
  existente uuid;
begin
  if not exists (select 1 from rutinas where id = p_rutina and hogar_id = privado.mi_hogar()) then
    raise exception 'Esa rutina no es de tu hogar.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 20 then
    raise exception 'La rutina necesita entre 1 y 20 ejercicios.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) x
    left join ejercicios e on e.id = (x->>'ejercicio_id')::uuid and e.hogar_id = privado.mi_hogar()
    where e.id is null
  ) then
    raise exception 'Hay un ejercicio que no está en el catálogo de tu hogar.' using errcode = 'P0001';
  end if;

  -- Se corre el orden para poder reordenar sin chocar con unique(rutina_id, orden).
  update rutina_ejercicios set orden = orden + 1000 where rutina_id = p_rutina;
  delete from rutina_ejercicios re where re.rutina_id = p_rutina
    and not exists (select 1 from jsonb_array_elements(p_items) x where (x->>'ejercicio_id')::uuid = re.ejercicio_id);

  for it in select value from jsonb_array_elements(p_items) loop
    k := k + 1;
    ej := (it->>'ejercicio_id')::uuid;
    select id into existente from rutina_ejercicios where rutina_id = p_rutina and ejercicio_id = ej and orden > 1000 limit 1;
    if existente is not null then
      update rutina_ejercicios set orden = k,
        series_base = greatest(1, least(10, coalesce((it->>'series')::int, series_base))),
        reps_base = greatest(1, least(300, coalesce((it->>'reps')::int, reps_base))),
        descanso_base = greatest(0, least(600, coalesce((it->>'descanso')::int, descanso_base)))
      where id = existente;
      -- Las metas de cada persona siguen su progreso (peso); solo cambian series y reps si la rutina las cambió.
      update metas_ejercicio m set
        series = greatest(1, least(10, coalesce((it->>'series')::int, m.series))),
        reps = greatest(1, least(300, coalesce((it->>'reps')::int, m.reps)))
      where m.rutina_ejercicio_id = existente;
    else
      insert into rutina_ejercicios (rutina_id, ejercicio_id, orden, series_base, reps_base, descanso_base)
      values (p_rutina, ej, k,
        greatest(1, least(10, coalesce((it->>'series')::int, 3))),
        greatest(1, least(300, coalesce((it->>'reps')::int, 10))),
        greatest(0, least(600, coalesce((it->>'descanso')::int, 90))));
    end if;
  end loop;
  -- Si un ejercicio venía repetido, lo que quedó corrido se borra.
  delete from rutina_ejercicios where rutina_id = p_rutina and orden > 1000;
end $$;
revoke all on function public.aplicar_rutina(uuid, jsonb) from public, anon;
grant execute on function public.aplicar_rutina(uuid, jsonb) to authenticated;
