-- Dieta: catálogo de alimentos, despensa (paquetes) y lo que lleva cada comida.

-- Alimentos con valores por 100 g. hogar_id nulo = catálogo base, visible para todos.
create table public.alimentos (
  id               uuid primary key default gen_random_uuid(),
  hogar_id         uuid references public.hogares(id) on delete cascade,
  nombre           text not null check (char_length(nombre) between 1 and 120),
  marca            text check (char_length(marca) <= 80),
  codigo_barras    text check (codigo_barras ~ '^[0-9]{6,14}$'),
  kcal             numeric(6,1) not null check (kcal between 0 and 950),
  proteina_g       numeric(5,1) not null default 0 check (proteina_g between 0 and 100),
  carbohidratos_g  numeric(5,1) not null default 0 check (carbohidratos_g between 0 and 100),
  grasas_g         numeric(5,1) not null default 0 check (grasas_g between 0 and 100),
  fibra_g          numeric(5,1) check (fibra_g between 0 and 100),
  porcion_nombre   text check (char_length(porcion_nombre) <= 40),   -- "1 huevo", "1 taza"
  porcion_g        numeric(6,1) check (porcion_g > 0),
  paquete_g        numeric(7,1) check (paquete_g > 0),               -- lo que trae el paquete
  origen           text not null default 'manual' check (origen in ('base', 'manual', 'openfoodfacts', 'gemini')),
  creado_en        timestamptz not null default now()
);
create unique index alimentos_codigo on public.alimentos (hogar_id, codigo_barras) where codigo_barras is not null;
create index alimentos_hogar on public.alimentos (hogar_id);
alter table public.alimentos enable row level security;
create policy alimentos_ver on public.alimentos for select to authenticated
  using (hogar_id is null or hogar_id = privado.mi_hogar());
create policy alimentos_escribir on public.alimentos for insert to authenticated with check (hogar_id = privado.mi_hogar());
create policy alimentos_editar on public.alimentos for update to authenticated
  using (hogar_id = privado.mi_hogar()) with check (hogar_id = privado.mi_hogar());
create policy alimentos_borrar on public.alimentos for delete to authenticated using (hogar_id = privado.mi_hogar());
grant select, insert, update, delete on public.alimentos to authenticated;

-- Despensa: paquetes abiertos o por abrir, con lo que queda.
create table public.despensa (
  id                uuid primary key default gen_random_uuid(),
  hogar_id          uuid not null references public.hogares(id) on delete cascade,
  alimento_id       uuid not null references public.alimentos(id) on delete cascade,
  gramos_total      numeric(7,1) not null check (gramos_total > 0),
  gramos_restantes  numeric(7,1) not null check (gramos_restantes >= 0),
  agregado_en       timestamptz not null default now(),
  terminado_en      timestamptz
);
create index despensa_hogar on public.despensa (hogar_id) where terminado_en is null;
alter table public.despensa enable row level security;
create policy despensa_hogar on public.despensa for all to authenticated
  using (hogar_id = privado.mi_hogar()) with check (hogar_id = privado.mi_hogar());
grant select, insert, update, delete on public.despensa to authenticated;

-- Lo que lleva una comida (en total, para todos los que comieron).
create table public.comida_items (
  id           uuid primary key default gen_random_uuid(),
  comida_id    uuid not null references public.comidas(id) on delete cascade,
  alimento_id  uuid not null references public.alimentos(id) on delete restrict,
  gramos       numeric(7,1) not null check (gramos > 0),
  despensa_id  uuid references public.despensa(id) on delete set null
);
create index comida_items_comida on public.comida_items (comida_id);
alter table public.comida_items enable row level security;
create policy comida_items_hogar on public.comida_items for all to authenticated
  using (exists (select 1 from public.comidas c where c.id = comida_id and c.hogar_id = privado.mi_hogar()))
  with check (exists (select 1 from public.comidas c where c.id = comida_id and c.hogar_id = privado.mi_hogar()));
grant select, insert, update, delete on public.comida_items to authenticated;

-- Comidas: merienda como momento, hora y quién la cargó.
alter table public.comidas drop constraint comidas_momento_check;
alter table public.comidas add constraint comidas_momento_check
  check (momento in ('desayuno', 'almuerzo', 'merienda', 'cena', 'snack', 'pre_entreno', 'post_entreno'));
alter table public.comidas add column hora time, add column creada_por uuid references public.personas(id) on delete set null;

-- Comen juntos: cualquiera del hogar puede cargar la porción del otro.
drop policy if exists porciones_propias on public.porciones;
drop policy if exists porciones_editar on public.porciones;
drop policy if exists porciones_borrar on public.porciones;
create policy porciones_hogar_insertar on public.porciones for insert to authenticated with check (privado.es_de_mi_hogar(persona_id));
create policy porciones_hogar_editar on public.porciones for update to authenticated
  using (privado.es_de_mi_hogar(persona_id)) with check (privado.es_de_mi_hogar(persona_id));
create policy porciones_hogar_borrar on public.porciones for delete to authenticated using (privado.es_de_mi_hogar(persona_id));

-- Objetivo de bajar grasa y ganar músculo a la vez.
alter table public.objetivos drop constraint objetivos_foco_check;
alter table public.objetivos add constraint objetivos_foco_check
  check (foco in ('recomposicion', 'masa_muscular', 'perder_grasa', 'cardio', 'mantenimiento'));
