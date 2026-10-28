-- Bloque · teléfonos vinculados a la app puente de Health Connect.
-- El teléfono guarda un código largo y aleatorio; acá solo se guarda su hash
-- (SHA-256), así que filtrar esta tabla no permite hacerse pasar por nadie.
-- La Edge Function sync-health busca el dispositivo por ese hash y escribe con
-- la service role en nombre de la persona dueña del teléfono.

create table public.dispositivos (
  id           uuid primary key default gen_random_uuid(),
  persona_id   uuid not null references public.personas (id) on delete cascade,
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  nombre       text not null default 'Teléfono',
  creado_en    timestamptz not null default now(),
  ultimo_sync  timestamptz
);
create index dispositivos_persona_idx on public.dispositivos (persona_id);

alter table public.dispositivos enable row level security;

create policy dispositivos_ver on public.dispositivos
  for select using (persona_id = auth.uid());
create policy dispositivos_crear on public.dispositivos
  for insert with check (persona_id = auth.uid());
create policy dispositivos_borrar on public.dispositivos
  for delete using (persona_id = auth.uid());

grant select, insert, delete on public.dispositivos to authenticated;
