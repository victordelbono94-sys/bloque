-- Lugares del hogar (por ahora, el gimnasio): para avisar al llegar.
create table public.lugares (
  id uuid primary key default gen_random_uuid(),
  hogar_id uuid not null references public.hogares(id) on delete cascade,
  nombre text not null check (char_length(nombre) between 1 and 80),
  tipo text not null default 'gimnasio' check (tipo in ('gimnasio', 'pista', 'otro')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  radio_m integer not null default 150 check (radio_m between 50 and 1000),
  creado_en timestamptz not null default now()
);
create index lugares_hogar on public.lugares (hogar_id);
alter table public.lugares enable row level security;
create policy lugares_hogar on public.lugares for all to authenticated
  using (hogar_id = privado.mi_hogar()) with check (hogar_id = privado.mi_hogar());
grant select, insert, update, delete on public.lugares to authenticated;
