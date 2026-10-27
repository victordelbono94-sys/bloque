-- Bloque · esquema inicial
-- App de entrenamiento de Victor y Sant.
-- Modelo: un "hogar" agrupa a las personas. Lo compartido (calendario, rutinas,
-- recetas, máquinas) pertenece al hogar; lo individual (mediciones, series,
-- porciones, estado diario) pertenece a cada persona. Ambos pueden ver todo lo
-- del hogar, pero cada uno solo escribe sus propios registros individuales.
-- El planificador (Claude) y las Edge Functions usan la service role, que no
-- pasa por RLS.

create extension if not exists pgcrypto;

-- =========================================================================
-- Base: hogar y personas
-- =========================================================================

create table public.hogares (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  creado_en   timestamptz not null default now()
);

create table public.personas (
  id               uuid primary key references auth.users (id) on delete cascade,
  hogar_id         uuid not null references public.hogares (id) on delete cascade,
  nombre           text not null,
  fecha_nacimiento date,
  altura_cm        numeric(5,1) check (altura_cm between 100 and 250),
  sexo             text check (sexo in ('m', 'f')),          -- para fórmulas de metabolismo
  nivel_actividad  text check (nivel_actividad in ('bajo', 'moderado', 'alto', 'muy_alto')),
  creado_en        timestamptz not null default now()
);

-- Hogar de la sesión actual. security definer para no entrar en recursión de RLS.
create or replace function public.mi_hogar()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select hogar_id from public.personas where id = auth.uid()
$$;

-- ¿La persona indicada es del mismo hogar que la sesión actual?
create or replace function public.es_de_mi_hogar(p_persona uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.personas
    where id = p_persona and hogar_id = public.mi_hogar()
  )
$$;

-- =========================================================================
-- Calendario, actividades y estado diario
-- =========================================================================

create table public.clases (
  id            uuid primary key default gen_random_uuid(),
  hogar_id      uuid not null references public.hogares (id) on delete cascade,
  nombre        text not null,                      -- ej. "Abs", "Funcional"
  dia_semana    smallint not null check (dia_semana between 0 and 6),  -- 0 = domingo
  hora          time not null,
  duracion_min  smallint check (duracion_min > 0),
  descripcion   text,
  actualizado_en timestamptz not null default now()
);

create table public.rutinas (
  id          uuid primary key default gen_random_uuid(),
  hogar_id    uuid not null references public.hogares (id) on delete cascade,
  nombre      text not null,                        -- ej. "Piernas · semana 3"
  foco        text check (foco in ('masa_muscular', 'perder_grasa', 'cardio', 'fuerza', 'recuperacion', 'mixto')),
  autor       text not null default 'usuario' check (autor in ('usuario', 'claude', 'gemini')),
  creada_por  uuid references public.personas (id) on delete set null,
  notas       text,
  creada_en   timestamptz not null default now()
);

create table public.calendario (
  id          uuid primary key default gen_random_uuid(),
  hogar_id    uuid not null references public.hogares (id) on delete cascade,
  fecha       date not null,
  hora_inicio time,
  tipo        text not null check (tipo in ('gym', 'derby', 'clase', 'descanso')),
  asistencia  text not null default 'juntos' check (asistencia in ('juntos', 'solo')),
  persona_id  uuid references public.personas (id) on delete cascade,  -- solo si asistencia = 'solo'
  rutina_id   uuid references public.rutinas (id) on delete set null,
  clase_id    uuid references public.clases (id) on delete set null,
  notas       text,
  constraint calendario_solo_requiere_persona
    check ((asistencia = 'solo') = (persona_id is not null))
);
create index calendario_hogar_fecha_idx on public.calendario (hogar_id, fecha);

create table public.actividades_extra (
  id                  uuid primary key default gen_random_uuid(),
  persona_id          uuid not null references public.personas (id) on delete cascade,
  fecha               date not null,
  tipo                text not null,                -- ej. "escalada", "trekking"
  duracion_min        smallint check (duracion_min > 0),
  intensidad          smallint check (intensidad between 1 and 5),
  calorias_estimadas  integer check (calorias_estimadas >= 0),
  notas               text
);
create index actividades_extra_persona_fecha_idx on public.actividades_extra (persona_id, fecha);

create table public.estado_diario (
  persona_id      uuid not null references public.personas (id) on delete cascade,
  fecha           date not null,
  cansancio       smallint check (cansancio between 1 and 5),
  dolor_muscular  smallint check (dolor_muscular between 1 and 5),
  semaforo        text check (semaforo in ('verde', 'ambar', 'rojo')),
  motivo          text,                             -- ej. "derby ayer + poco sueño"
  calculado_en    timestamptz,
  primary key (persona_id, fecha)
);

-- =========================================================================
-- Objetivos y cuerpo
-- =========================================================================

create table public.objetivos (
  id                uuid primary key default gen_random_uuid(),
  persona_id        uuid not null references public.personas (id) on delete cascade,
  foco              text not null check (foco in ('masa_muscular', 'perder_grasa', 'cardio', 'mantenimiento')),
  calorias_dia      integer check (calorias_dia > 0),
  proteina_g        integer check (proteina_g >= 0),
  carbohidratos_g   integer check (carbohidratos_g >= 0),
  grasas_g          integer check (grasas_g >= 0),
  desde             date not null default current_date,
  hasta             date,
  notas             text
);

create table public.mediciones_corporales (
  id                      uuid primary key default gen_random_uuid(),
  persona_id              uuid not null references public.personas (id) on delete cascade,
  medido_en               timestamptz not null default now(),
  peso_kg                 numeric(5,2),
  grasa_pct               numeric(4,1),
  masa_muscular_kg        numeric(5,2),
  masa_magra_kg           numeric(5,2),
  agua_pct                numeric(4,1),
  grasa_visceral          numeric(4,1),            -- solo en la app; Health Connect no lo soporta
  masa_osea_kg            numeric(4,2),
  metabolismo_basal_kcal  integer,
  origen                  text not null check (origen in ('manual', 'balanza', 'hospital', 'health_connect')),
  es_referencia           boolean not null default false,  -- pruebas del hospital deportivo
  hc_record_id            text unique,             -- id en Health Connect, para no duplicar
  hc_sincronizado_en      timestamptz,             -- null = falta escribir en Health Connect
  notas                   text
);
create index mediciones_persona_fecha_idx on public.mediciones_corporales (persona_id, medido_en desc);

-- Resumen diario importado de Health Connect por la app puente.
create table public.actividad_diaria (
  persona_id         uuid not null references public.personas (id) on delete cascade,
  fecha              date not null,
  pasos              integer,
  calorias_activas   integer,
  calorias_totales   integer,
  sueno_min          integer,
  fc_reposo          smallint,
  importado_en       timestamptz not null default now(),
  primary key (persona_id, fecha)
);

-- Sesiones de ejercicio registradas por la banda (fuerza, derby, etc.).
create table public.sesiones_banda (
  id             uuid primary key default gen_random_uuid(),
  persona_id     uuid not null references public.personas (id) on delete cascade,
  inicio         timestamptz not null,
  fin            timestamptz not null,
  tipo           text not null,                    -- tipo de ejercicio de Health Connect
  calorias       integer,
  fc_promedio    smallint,
  fc_max         smallint,
  hc_record_id   text unique not null,
  importado_en   timestamptz not null default now()
);
create index sesiones_banda_persona_inicio_idx on public.sesiones_banda (persona_id, inicio desc);

-- =========================================================================
-- Gym: máquinas, ejercicios, rutinas y sesiones
-- =========================================================================

create table public.maquinas (
  id              uuid primary key default gen_random_uuid(),
  hogar_id        uuid not null references public.hogares (id) on delete cascade,
  nombre          text not null,
  grupo_muscular  text,
  codigo_qr       text unique,                     -- contenido del QR de la máquina
  codigo_nfc      text unique,                     -- id del tag NFC
  url_ficha       text                             -- ficha de Technogym
);

create table public.ejercicios (
  id              uuid primary key default gen_random_uuid(),
  hogar_id        uuid not null references public.hogares (id) on delete cascade,
  nombre          text not null,
  grupo_muscular  text not null,
  maquina_id      uuid references public.maquinas (id) on delete set null,
  descripcion     text
);

create table public.ejercicio_alternativas (
  ejercicio_id    uuid not null references public.ejercicios (id) on delete cascade,
  alternativa_id  uuid not null references public.ejercicios (id) on delete cascade,
  primary key (ejercicio_id, alternativa_id),
  check (ejercicio_id <> alternativa_id)
);

create table public.rutina_ejercicios (
  id            uuid primary key default gen_random_uuid(),
  rutina_id     uuid not null references public.rutinas (id) on delete cascade,
  ejercicio_id  uuid not null references public.ejercicios (id) on delete restrict,
  orden         smallint not null,
  unique (rutina_id, orden)
);

-- Lo que le toca a cada uno en cada ejercicio de la rutina.
create table public.metas_ejercicio (
  id                  uuid primary key default gen_random_uuid(),
  rutina_ejercicio_id uuid not null references public.rutina_ejercicios (id) on delete cascade,
  persona_id          uuid not null references public.personas (id) on delete cascade,
  series              smallint not null check (series > 0),
  reps                smallint not null check (reps > 0),
  peso_kg             numeric(5,1),
  descanso_seg        smallint check (descanso_seg >= 0),
  unique (rutina_ejercicio_id, persona_id)
);

create table public.sesiones (
  id             uuid primary key default gen_random_uuid(),
  hogar_id       uuid not null references public.hogares (id) on delete cascade,
  calendario_id  uuid references public.calendario (id) on delete set null,
  rutina_id      uuid references public.rutinas (id) on delete set null,
  iniciada_por   uuid references public.personas (id) on delete set null,
  iniciada_en    timestamptz not null default now(),
  terminada_en   timestamptz
);

create table public.series (
  id            uuid primary key default gen_random_uuid(),
  sesion_id     uuid not null references public.sesiones (id) on delete cascade,
  persona_id    uuid not null references public.personas (id) on delete cascade,
  ejercicio_id  uuid not null references public.ejercicios (id) on delete restrict,
  sustituye_a   uuid references public.ejercicios (id) on delete set null,  -- si cambió el ejercicio
  numero        smallint not null check (numero > 0),
  reps          smallint not null check (reps >= 0),
  peso_kg       numeric(5,1),
  esfuerzo      smallint check (esfuerzo between 1 and 10),  -- qué tan pesada se sintió
  hecha_en      timestamptz not null default now()
);
create index series_sesion_persona_idx on public.series (sesion_id, persona_id);

-- =========================================================================
-- Comidas
-- =========================================================================

create table public.recetas (
  id              uuid primary key default gen_random_uuid(),
  hogar_id        uuid not null references public.hogares (id) on delete cascade,
  nombre          text not null,
  porciones_base  smallint not null default 2 check (porciones_base > 0),
  instrucciones   text
);

create table public.ingredientes (
  id               uuid primary key default gen_random_uuid(),
  receta_id        uuid not null references public.recetas (id) on delete cascade,
  nombre           text not null,
  cantidad_g       numeric(7,1),
  kcal             numeric(7,1),
  proteina_g       numeric(6,1),
  carbohidratos_g  numeric(6,1),
  grasas_g         numeric(6,1)
);

create table public.comidas (
  id           uuid primary key default gen_random_uuid(),
  hogar_id     uuid not null references public.hogares (id) on delete cascade,
  fecha        date not null,
  momento      text not null check (momento in ('desayuno', 'almuerzo', 'cena', 'snack', 'pre_entreno', 'post_entreno')),
  receta_id    uuid references public.recetas (id) on delete set null,
  descripcion  text                                -- si no hay receta: "almuerzo fuera, menú del día"
);
create index comidas_hogar_fecha_idx on public.comidas (hogar_id, fecha);

-- La parte de cada uno en una comida compartida, más sus extras.
create table public.porciones (
  id               uuid primary key default gen_random_uuid(),
  comida_id        uuid not null references public.comidas (id) on delete cascade,
  persona_id       uuid not null references public.personas (id) on delete cascade,
  fraccion         numeric(4,3) check (fraccion between 0 and 1),  -- parte del plato base
  extras           text,
  kcal             numeric(7,1),
  proteina_g       numeric(6,1),
  carbohidratos_g  numeric(6,1),
  grasas_g         numeric(6,1),
  unique (comida_id, persona_id)
);

-- =========================================================================
-- Asistente
-- =========================================================================

create table public.chat_mensajes (
  id          uuid primary key default gen_random_uuid(),
  hogar_id    uuid not null references public.hogares (id) on delete cascade,
  persona_id  uuid references public.personas (id) on delete set null,  -- null = asistente
  rol         text not null check (rol in ('usuario', 'asistente')),
  contenido   text not null,
  sesion_id   uuid references public.sesiones (id) on delete set null,  -- chat dentro de un entreno
  creado_en   timestamptz not null default now()
);
create index chat_mensajes_hogar_fecha_idx on public.chat_mensajes (hogar_id, creado_en desc);

-- =========================================================================
-- Seguridad por filas (RLS)
-- =========================================================================

alter table public.hogares                 enable row level security;
alter table public.personas                enable row level security;
alter table public.clases                  enable row level security;
alter table public.rutinas                 enable row level security;
alter table public.calendario              enable row level security;
alter table public.actividades_extra       enable row level security;
alter table public.estado_diario           enable row level security;
alter table public.objetivos               enable row level security;
alter table public.mediciones_corporales   enable row level security;
alter table public.actividad_diaria        enable row level security;
alter table public.sesiones_banda          enable row level security;
alter table public.maquinas                enable row level security;
alter table public.ejercicios              enable row level security;
alter table public.ejercicio_alternativas  enable row level security;
alter table public.rutina_ejercicios       enable row level security;
alter table public.metas_ejercicio         enable row level security;
alter table public.sesiones                enable row level security;
alter table public.series                  enable row level security;
alter table public.recetas                 enable row level security;
alter table public.ingredientes            enable row level security;
alter table public.comidas                 enable row level security;
alter table public.porciones               enable row level security;
alter table public.chat_mensajes           enable row level security;

-- Hogar y personas
create policy hogares_ver on public.hogares
  for select using (id = public.mi_hogar());

create policy personas_ver on public.personas
  for select using (hogar_id = public.mi_hogar());
create policy personas_editar_propio on public.personas
  for update using (id = auth.uid()) with check (id = auth.uid() and hogar_id = public.mi_hogar());

-- Tablas compartidas del hogar: ambos leen y escriben.
create policy clases_hogar      on public.clases      for all using (hogar_id = public.mi_hogar()) with check (hogar_id = public.mi_hogar());
create policy rutinas_hogar     on public.rutinas     for all using (hogar_id = public.mi_hogar()) with check (hogar_id = public.mi_hogar());
create policy calendario_hogar  on public.calendario  for all using (hogar_id = public.mi_hogar()) with check (hogar_id = public.mi_hogar());
create policy maquinas_hogar    on public.maquinas    for all using (hogar_id = public.mi_hogar()) with check (hogar_id = public.mi_hogar());
create policy ejercicios_hogar  on public.ejercicios  for all using (hogar_id = public.mi_hogar()) with check (hogar_id = public.mi_hogar());
create policy sesiones_hogar    on public.sesiones    for all using (hogar_id = public.mi_hogar()) with check (hogar_id = public.mi_hogar());
create policy recetas_hogar     on public.recetas     for all using (hogar_id = public.mi_hogar()) with check (hogar_id = public.mi_hogar());
create policy comidas_hogar     on public.comidas     for all using (hogar_id = public.mi_hogar()) with check (hogar_id = public.mi_hogar());
create policy chat_hogar        on public.chat_mensajes
  for select using (hogar_id = public.mi_hogar());
create policy chat_escribir_propio on public.chat_mensajes
  for insert with check (hogar_id = public.mi_hogar() and persona_id = auth.uid() and rol = 'usuario');

-- Tablas hijas de algo compartido: se heredan del padre.
create policy alternativas_hogar on public.ejercicio_alternativas for all
  using (exists (select 1 from public.ejercicios e where e.id = ejercicio_id and e.hogar_id = public.mi_hogar()))
  with check (exists (select 1 from public.ejercicios e where e.id = ejercicio_id and e.hogar_id = public.mi_hogar()));

create policy rutina_ejercicios_hogar on public.rutina_ejercicios for all
  using (exists (select 1 from public.rutinas r where r.id = rutina_id and r.hogar_id = public.mi_hogar()))
  with check (exists (select 1 from public.rutinas r where r.id = rutina_id and r.hogar_id = public.mi_hogar()));

create policy ingredientes_hogar on public.ingredientes for all
  using (exists (select 1 from public.recetas r where r.id = receta_id and r.hogar_id = public.mi_hogar()))
  with check (exists (select 1 from public.recetas r where r.id = receta_id and r.hogar_id = public.mi_hogar()));

-- Metas por persona: las planifican juntos, así que ambos pueden editarlas.
create policy metas_hogar on public.metas_ejercicio for all
  using (public.es_de_mi_hogar(persona_id))
  with check (public.es_de_mi_hogar(persona_id));

-- Porciones: ambos ven, cada uno edita la suya.
create policy porciones_ver on public.porciones for select using (public.es_de_mi_hogar(persona_id));
create policy porciones_propias on public.porciones for insert with check (persona_id = auth.uid());
create policy porciones_editar on public.porciones for update using (persona_id = auth.uid()) with check (persona_id = auth.uid());
create policy porciones_borrar on public.porciones for delete using (persona_id = auth.uid());

-- Registros individuales: ambos ven todo, cada uno escribe solo lo suyo.
do $$
declare
  t text;
begin
  foreach t in array array[
    'actividades_extra', 'estado_diario', 'objetivos', 'mediciones_corporales',
    'actividad_diaria', 'sesiones_banda', 'series'
  ]
  loop
    execute format('create policy %I on public.%I for select using (public.es_de_mi_hogar(persona_id))', t || '_ver', t);
    execute format('create policy %I on public.%I for insert with check (persona_id = auth.uid())', t || '_crear', t);
    execute format('create policy %I on public.%I for update using (persona_id = auth.uid()) with check (persona_id = auth.uid())', t || '_editar', t);
    execute format('create policy %I on public.%I for delete using (persona_id = auth.uid())', t || '_borrar', t);
  end loop;
end
$$;

-- =========================================================================
-- Alta inicial (correr a mano, una vez, después de que ambos inicien sesión)
-- =========================================================================
-- insert into public.hogares (nombre) values ('Victor y Sant') returning id;
-- insert into public.personas (id, hogar_id, nombre) values
--   ('<uuid de Victor en auth.users>', '<id del hogar>', 'Victor'),
--   ('<uuid de Sant en auth.users>',   '<id del hogar>', 'Sant');
