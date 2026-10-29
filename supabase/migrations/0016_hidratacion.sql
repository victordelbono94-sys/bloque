-- Bloque · hidratación: lo que cada uno toma (vasos, botellas, durante el entreno).
-- Las bebidas registradas como comida (café, leche, jugo, agua dicha a la IA) también cuentan; se suman en la app.
create table if not exists public.hidratacion (
  id         uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas (id) on delete cascade,
  fecha      date not null default current_date,
  hora       time,
  ml         integer not null check (ml between 10 and 5000),
  origen     text not null default 'manual' check (origen in ('manual', 'entreno')),
  creado_en  timestamptz not null default now()
);
create index if not exists hidratacion_persona_fecha_idx on public.hidratacion (persona_id, fecha);
alter table public.hidratacion enable row level security;
create policy hidratacion_ver on public.hidratacion for select using (privado.es_de_mi_hogar(persona_id));
create policy hidratacion_crear on public.hidratacion for insert with check (persona_id = auth.uid());
create policy hidratacion_editar on public.hidratacion for update using (persona_id = auth.uid()) with check (persona_id = auth.uid());
create policy hidratacion_borrar on public.hidratacion for delete using (persona_id = auth.uid());
grant select, insert, update, delete on public.hidratacion to authenticated;
