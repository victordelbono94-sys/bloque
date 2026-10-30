-- Bloq · dieta y restricciones de cada persona, eliminar la cuenta, y tiempo real para que el hogar vea los cambios al instante.

-- Cómo come cada uno: { tipo: 'omnivora'|'vegetariana'|'vegana'|'pescetariana'|'keto'|..., restricciones: [...], no_le_gusta: '...', nota: '...' }
alter table public.personas add column if not exists dieta jsonb;

-- Eliminar mi cuenta y mis datos: se borra el usuario (y en cascada todo lo suyo). Si el hogar queda con otras personas,
-- sigue siendo de ellas (con un nuevo admin si hacía falta); si queda vacío, se borra.
create or replace function public.eliminar_mi_cuenta()
returns void
language plpgsql
security definer
set search_path = public, privado, auth
as $$
declare
  yo uuid := auth.uid();
  hogar uuid;
begin
  if yo is null then raise exception 'Sin sesión'; end if;
  select hogar_id into hogar from public.personas where id = yo;
  delete from auth.users where id = yo;
  if hogar is not null then perform privado.ordenar_equipo(hogar); end if;
end
$$;
revoke all on function public.eliminar_mi_cuenta() from public, anon;
grant execute on function public.eliminar_mi_cuenta() to authenticated;

-- Tiempo real: lo que registra alguien del hogar aparece en los demás teléfonos sin recargar.
do $$
declare t text;
begin
  foreach t in array array['comidas', 'porciones', 'comida_items', 'calendario', 'sesiones', 'series', 'mediciones_corporales',
    'estado_diario', 'hidratacion', 'molestias', 'despensa', 'objetivos', 'personas', 'sesiones_banda']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when others then null; -- ya estaba o no existe la tabla
    end;
  end loop;
end $$;
