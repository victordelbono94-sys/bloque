-- Bloque · ejercicios por lado, series sin duplicados y calorías creíbles del reloj.

-- 1. Ejercicios que se hacen de a un lado: el temporizador guía derecho → cambio → izquierdo.
alter table public.ejercicios add column if not exists por_lado boolean not null default false;
update public.ejercicios set por_lado = true
where nombre in ('Plancha lateral', 'Agarre isométrico con discos', 'Equilibrio a una pierna', 'Remo con mancuerna',
                 'Sentadilla búlgara con mancuernas', 'Pallof press en polea', 'Curl de muñeca con mancuerna')
   or nombre ~* '(unilateral|a una (mano|pierna)|a un brazo|por lado)';

-- 2. Una serie por número: un doble toque al guardar no la duplica.
delete from public.series a using public.series b
where a.sesion_id = b.sesion_id and a.persona_id = b.persona_id and a.ejercicio_id = b.ejercicio_id
  and a.numero = b.numero and a.id > b.id;
create unique index if not exists series_una_por_numero on public.series (sesion_id, persona_id, ejercicio_id, numero);

-- 3. Calorías del reloj: algunas pulseras pasan a Health Connect muchas menos de las reales
--    (ej. 13 kcal en 1 h 47 de derby con 111 ppm). Si el número no es creíble frente al pulso,
--    se estima con la fórmula de Keytel (pulso, peso, edad y sexo) y se marca como estimado.
alter table public.sesiones_banda
  add column if not exists calorias_reloj integer,
  add column if not exists calorias_estimadas boolean not null default false;

create or replace function privado.calorias_creibles()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  min numeric := extract(epoch from (new.fin - new.inicio)) / 60;
  per public.personas;
  peso numeric;
  edad numeric;
  por_min numeric;
  estimado integer;
begin
  new.calorias_reloj := new.calorias;
  new.calorias_estimadas := false;
  if new.fc_promedio is null or new.fc_promedio < 85 or min < 10 or new.tipo = 'caminar' then return new; end if;
  select * into per from public.personas where id = new.persona_id;
  select m.peso_kg into peso from public.mediciones_corporales m
  where m.persona_id = new.persona_id and m.peso_kg is not null order by m.medido_en desc limit 1;
  peso := coalesce(peso, 70);
  edad := coalesce(extract(year from age(per.fecha_nacimiento)), 30);
  por_min := case per.sexo
    when 'f' then (-20.4022 + 0.4472 * new.fc_promedio - 0.1263 * peso + 0.074 * edad) / 4.184
    when 'm' then (-55.0969 + 0.6309 * new.fc_promedio + 0.1988 * peso + 0.2017 * edad) / 4.184
    else ((-20.4022 + 0.4472 * new.fc_promedio - 0.1263 * peso + 0.074 * edad)
        + (-55.0969 + 0.6309 * new.fc_promedio + 0.1988 * peso + 0.2017 * edad)) / 2 / 4.184
  end;
  -- Keytel tiende a pasarse: se usa el 80 %, y el 60 % en fuerza (el pulso sube por el esfuerzo, no por el gasto).
  estimado := round(greatest(por_min, 0) * min * case when new.tipo in ('fuerza', 'pesas', 'tipo_13', 'tipo_70', 'tipo_81') then 0.6 else 0.8 end);
  if estimado > 0 and coalesce(new.calorias, 0) < estimado * 0.4 then
    new.calorias := estimado;
    new.calorias_estimadas := true;
  end if;
  return new;
end $$;
revoke all on function privado.calorias_creibles() from public, anon, authenticated;
drop trigger if exists sesiones_banda_calorias on public.sesiones_banda;
create trigger sesiones_banda_calorias before insert or update of calorias, fc_promedio, inicio, fin on public.sesiones_banda
  for each row execute function privado.calorias_creibles();

-- Recalcular lo que ya estaba.
update public.sesiones_banda set calorias = coalesce(calorias_reloj, calorias);

-- 4. Entreno que no se hizo y se decidió no recuperar (para no volver a ofrecerlo).
alter table public.calendario add column if not exists omitido boolean not null default false;
