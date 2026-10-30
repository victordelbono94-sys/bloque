-- Bloq · cambios de plan pedidos a la IA de objetivos (pausar el deporte una semana, ir menos al gym, cambiar de objetivo…).
-- Se guardan para mostrarlos en «Mis objetivos» y dárselos a la IA como contexto. La agenda se cambia en calendario.
create table if not exists public.cambios_plan (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  tipo text not null check (tipo in ('pausa', 'frecuencia_gym', 'objetivo', 'deporte', 'experiencia')),
  descripcion text check (char_length(descripcion) <= 300),
  desde date,
  hasta date,
  creada_en timestamptz not null default now()
);
create index if not exists cambios_plan_persona on public.cambios_plan (persona_id, creada_en desc);
alter table public.cambios_plan enable row level security;
create policy cambios_plan_hogar on public.cambios_plan for all
  using (privado.es_de_mi_hogar(persona_id)) with check (privado.es_de_mi_hogar(persona_id));
grant select, insert, update, delete on public.cambios_plan to authenticated;
