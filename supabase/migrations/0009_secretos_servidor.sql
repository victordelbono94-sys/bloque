-- Claves que solo usan las funciones del servidor (con la service role). Nadie más las lee.
-- El valor se carga aparte (nunca en el repositorio):
--   insert into privado.secretos (nombre, valor) values ('GEMINI_API_KEY', '…');
create table privado.secretos (nombre text primary key, valor text not null, actualizado_en timestamptz not null default now());
revoke all on privado.secretos from public, anon, authenticated;

create function public.secreto_servidor(p_nombre text) returns text
language sql security definer set search_path = '' stable
as $$ select valor from privado.secretos where nombre = p_nombre $$;
revoke execute on function public.secreto_servidor(text) from public, anon, authenticated;
grant execute on function public.secreto_servidor(text) to service_role;
