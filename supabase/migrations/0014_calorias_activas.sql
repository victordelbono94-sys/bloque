-- Bloque · la estimación por pulso queda en calorías activas (se resta el basal de ese rato) y es
-- estable en los upserts de la sincronización (el trigger corre en el insert propuesto y en el update).
-- Calibrado con Mi Fitness: 1 h 47 de patinaje a 111 ppm = 698 kcal totales / 543 activas (la app estima 586).
create or replace function privado.calorias_creibles()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  min numeric := extract(epoch from (new.fin - new.inicio)) / 60;
  per public.personas;
  peso numeric;
  edad numeric;
  altura numeric;
  por_min numeric;
  basal_min numeric;
  estimado integer;
begin
  if tg_op = 'UPDATE' and new.calorias is not distinct from old.calorias and old.calorias_estimadas then
    new.calorias := old.calorias_reloj;
  end if;
  new.calorias_reloj := new.calorias;
  new.calorias_estimadas := false;
  if new.fc_promedio is null or new.fc_promedio < 85 or min < 10 or new.tipo = 'caminar' then return new; end if;
  select * into per from public.personas where id = new.persona_id;
  select m.peso_kg into peso from public.mediciones_corporales m
  where m.persona_id = new.persona_id and m.peso_kg is not null order by m.medido_en desc limit 1;
  peso := coalesce(peso, 70);
  edad := coalesce(extract(year from age(per.fecha_nacimiento)), 30);
  altura := coalesce(per.altura_cm, 170);
  por_min := case per.sexo
    when 'f' then (-20.4022 + 0.4472 * new.fc_promedio - 0.1263 * peso + 0.074 * edad) / 4.184
    when 'm' then (-55.0969 + 0.6309 * new.fc_promedio + 0.1988 * peso + 0.2017 * edad) / 4.184
    else ((-20.4022 + 0.4472 * new.fc_promedio - 0.1263 * peso + 0.074 * edad)
        + (-55.0969 + 0.6309 * new.fc_promedio + 0.1988 * peso + 0.2017 * edad)) / 2 / 4.184
  end;
  basal_min := (10 * peso + 6.25 * altura - 5 * edad + case per.sexo when 'f' then -161 when 'm' then 5 else -78 end) / 1440;
  estimado := round(greatest(por_min * case when new.tipo in ('fuerza', 'pesas', 'tipo_13', 'tipo_70', 'tipo_81') then 0.6 else 0.8 end - basal_min, 0) * min);
  if estimado > 0 and coalesce(new.calorias, 0) < estimado * 0.4 then
    new.calorias := estimado;
    new.calorias_estimadas := true;
  end if;
  return new;
end $$;
