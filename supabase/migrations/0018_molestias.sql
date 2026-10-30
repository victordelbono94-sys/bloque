-- Bloque · molestias o lesiones: una zona del cuerpo que duele. Mientras está activa (hasta null),
-- el entreno avisa en los ejercicios que la cargan y la IA adapta la rutina y propone ejercicios suaves.
create table if not exists public.molestias (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  zona text not null check (zona ~ '^[a-z_]{2,30}$'),
  intensidad smallint not null default 2 check (intensidad between 1 and 3),
  nota text check (char_length(nota) <= 300),
  desde date not null default current_date,
  hasta date,
  creada_en timestamptz not null default now()
);
create index if not exists molestias_persona on public.molestias (persona_id, hasta);
alter table public.molestias enable row level security;
create policy molestias_hogar on public.molestias for all
  using (privado.es_de_mi_hogar(persona_id)) with check (privado.es_de_mi_hogar(persona_id));
