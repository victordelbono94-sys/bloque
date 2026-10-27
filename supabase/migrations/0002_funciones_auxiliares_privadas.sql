-- Bloque · las funciones que usan las políticas RLS no deben poder llamarse por la API.
-- (Alerta del revisor de seguridad de Supabase sobre funciones SECURITY DEFINER expuestas.)

create schema if not exists privado;
alter function public.mi_hogar() set schema privado;
alter function public.es_de_mi_hogar(uuid) set schema privado;
alter function privado.mi_hogar() set search_path = public;
alter function privado.es_de_mi_hogar(uuid) set search_path = public, privado;

-- es_de_mi_hogar llama a mi_hogar: actualizarla para que use el nuevo esquema.
create or replace function privado.es_de_mi_hogar(p_persona uuid)
returns boolean
language sql
stable
security definer
set search_path = public, privado
as $$
  select exists (
    select 1 from public.personas
    where id = p_persona and hogar_id = privado.mi_hogar()
  )
$$;

revoke all on schema privado from public, anon;
grant usage on schema privado to authenticated;
revoke all on function privado.mi_hogar() from public, anon;
revoke all on function privado.es_de_mi_hogar(uuid) from public, anon;
grant execute on function privado.mi_hogar() to authenticated;
grant execute on function privado.es_de_mi_hogar(uuid) to authenticated;
