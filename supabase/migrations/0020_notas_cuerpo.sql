-- Bloq · lo que la IA del cuerpo va aprendiendo de cada persona (cómo responde su peso, lo que contó de cómo se siente)
-- y el ritmo de cambio de peso que eligió (kg por semana). Se le vuelve a dar a la IA como contexto.
create table if not exists public.notas_cuerpo (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  tipo text not null default 'aprendizaje' check (tipo in ('aprendizaje', 'ritmo')),
  texto text check (char_length(texto) <= 400),
  valor numeric(5,2),
  creada_en timestamptz not null default now()
);
create index if not exists notas_cuerpo_persona on public.notas_cuerpo (persona_id, creada_en desc);
alter table public.notas_cuerpo enable row level security;
create policy notas_cuerpo_hogar on public.notas_cuerpo for all
  using (privado.es_de_mi_hogar(persona_id)) with check (privado.es_de_mi_hogar(persona_id));
grant select, insert, update, delete on public.notas_cuerpo to authenticated;
