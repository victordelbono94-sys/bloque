-- Jueves 5/11: respaldo de IA, contador de uso, Mis platos, consentimiento, interruptores de IA, errores de la app
-- y la función de eliminar la cuenta (que estaba en la 0023 pero nunca se aplicó en producción).

-- 1) Eliminar mi cuenta (borra el usuario; las tablas con on delete cascade se llevan sus datos).
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

-- 2) Uso de IA: una fila por consulta (la escriben las funciones con la clave de servicio).
--    proveedor = gemini | groq | mistral | local (resuelto en el teléfono sin IA).
create table if not exists public.uso_ia (
  id bigint generated always as identity primary key,
  usuario uuid references public.personas(id) on delete cascade,
  funcion text not null,
  proveedor text not null,
  modelo text,
  ok boolean not null default true,
  ms integer,
  detalle text,
  creado_en timestamptz not null default now()
);
create index if not exists uso_ia_usuario_fecha on public.uso_ia (usuario, creado_en desc);
alter table public.uso_ia enable row level security;
drop policy if exists uso_ia_ver on public.uso_ia;
create policy uso_ia_ver on public.uso_ia for select to authenticated using (privado.es_de_mi_hogar(usuario));
-- Desde el teléfono solo se anotan las acciones resueltas sin IA (para contar el ahorro).
drop policy if exists uso_ia_local on public.uso_ia;
create policy uso_ia_local on public.uso_ia for insert to authenticated with check (usuario = auth.uid() and proveedor = 'local');

-- 3) Mis platos: cada comida que la IA analizó (o que la persona armó) queda como plato del hogar,
--    para volver a registrarla sin IA. Lo corregido a mano manda sobre lo calculado.
create table if not exists public.platos (
  id uuid primary key default gen_random_uuid(),
  hogar_id uuid not null references public.hogares(id) on delete cascade,
  nombre text not null,
  clave text not null,                 -- nombre normalizado (sin tildes, minúsculas) para encontrarlo
  items jsonb not null default '[]',   -- [{nombre, gramos, kcal, proteina_g, carbohidratos_g, grasas_g, alimento_id?}] por porción de una persona
  momento text,
  origen text not null default 'ia',   -- ia | manual
  veces integer not null default 1,
  creado_por uuid references public.personas(id) on delete set null,
  creado_en timestamptz not null default now(),
  usado_en timestamptz not null default now(),
  unique (hogar_id, clave)
);
alter table public.platos enable row level security;
drop policy if exists platos_hogar on public.platos;
create policy platos_hogar on public.platos for all to authenticated
  using (hogar_id = privado.mi_hogar()) with check (hogar_id = privado.mi_hogar());

-- 4) Consentimiento: qué aceptó cada persona, cuándo y en qué versión del texto.
create table if not exists public.consentimientos (
  id bigint generated always as identity primary key,
  persona_id uuid not null references public.personas(id) on delete cascade,
  documento text not null,             -- terminos | privacidad | aviso_salud_ia
  version text not null,
  aceptado_en timestamptz not null default now()
);
create index if not exists consentimientos_persona on public.consentimientos (persona_id, documento, aceptado_en desc);
alter table public.consentimientos enable row level security;
drop policy if exists consentimientos_propios on public.consentimientos;
create policy consentimientos_propios on public.consentimientos for select to authenticated using (persona_id = auth.uid());
drop policy if exists consentimientos_aceptar on public.consentimientos;
create policy consentimientos_aceptar on public.consentimientos for insert to authenticated with check (persona_id = auth.uid());

-- 5) Interruptores de IA por función ({"comida": false, ...}; lo que falta = encendido).
alter table public.personas add column if not exists ia_funciones jsonb not null default '{}';

-- 6) Errores de la app (sin datos de salud): para que el próximo bug aparezca acá y no se descubra a mano.
create table if not exists public.errores_app (
  id bigint generated always as identity primary key,
  persona_id uuid references public.personas(id) on delete cascade,
  pantalla text,
  mensaje text not null,
  creado_en timestamptz not null default now()
);
alter table public.errores_app enable row level security;
drop policy if exists errores_app_anotar on public.errores_app;
create policy errores_app_anotar on public.errores_app for insert to authenticated with check (persona_id = auth.uid());
