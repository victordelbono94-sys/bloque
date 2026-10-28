-- Bloque · equipos abiertos a más personas.
-- En la base la tabla sigue llamándose "hogares" (y las columnas hogar_id): en la app es "equipo".
-- Cada cuenta nueva crea un equipo o un espacio personal (un equipo de una sola persona),
-- o se une a uno con un código. El admin del equipo invita y puede quitar personas.
-- Todo pasa por funciones security definer: nadie inserta personas ni cambia de equipo a mano.

alter table public.hogares
  add column if not exists codigo   text unique,
  add column if not exists admin_id uuid references public.personas (id) on delete set null,
  add column if not exists personal boolean not null default false,
  -- Deporte del equipo (o de la cuenta personal): arma el plan y los días livianos de gym.
  -- La lista de deportes vive en la app (js/deportes.js); acá solo se valida el formato.
  add column if not exists deporte  text not null default 'roller_derby'
    constraint hogares_deporte_formato check (deporte ~ '^[a-z_]{2,30}$');

-- Código de invitación: 6 caracteres sin los que se confunden (0/O, 1/I/L).
create or replace function privado.nuevo_codigo()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  letras constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(letras, 1 + floor(random() * length(letras))::int, 1);
    end loop;
    exit when not exists (select 1 from public.hogares where codigo = c);
  end loop;
  return c;
end
$$;

-- El equipo de Victor y Sant: Victor queda de admin.
update public.hogares
set codigo = coalesce(codigo, privado.nuevo_codigo()),
    admin_id = coalesce(admin_id, (select id from public.personas p where p.hogar_id = hogares.id order by creado_en limit 1));
alter table public.hogares alter column codigo set default privado.nuevo_codigo();

-- Espacio personal nuevo para alguien que se queda solo (sale o lo quitan).
create or replace function privado.espacio_personal(p_persona uuid)
returns uuid
language plpgsql
set search_path = public, privado
as $$
declare
  nuevo uuid;
begin
  insert into public.hogares (nombre, personal, deporte)
  values ('Mi espacio', true, coalesce((select h.deporte from public.hogares h join public.personas p on p.hogar_id = h.id where p.id = p_persona), 'gym'))
  returning id into nuevo;
  update public.personas set hogar_id = nuevo where id = p_persona;
  update public.hogares set admin_id = p_persona where id = nuevo;
  return nuevo;
end
$$;

-- Si el que se va era el admin, pasa al que lleva más tiempo. Si el equipo queda vacío, se borra.
create or replace function privado.ordenar_equipo(p_equipo uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.personas where hogar_id = p_equipo) then
    delete from public.hogares where id = p_equipo;
    return;
  end if;
  update public.hogares h
  set admin_id = (select id from public.personas p where p.hogar_id = h.id order by creado_en limit 1)
  where h.id = p_equipo
    and (h.admin_id is null or not exists (select 1 from public.personas p where p.id = h.admin_id and p.hogar_id = h.id));
end
$$;

-- Primera vez: crea mi perfil con un equipo nuevo o un espacio personal.
create or replace function public.crear_equipo(p_mi_nombre text, p_equipo text default null, p_personal boolean default false, p_deporte text default 'gym')
returns uuid
language plpgsql
security definer
set search_path = public, privado
as $$
declare
  yo uuid := auth.uid();
  nuevo uuid;
  mi_nombre text := left(trim(coalesce(p_mi_nombre, '')), 40);
begin
  if yo is null then raise exception 'Sin sesión'; end if;
  if mi_nombre = '' then raise exception 'Falta tu nombre'; end if;
  if exists (select 1 from public.personas where id = yo) then raise exception 'Ya tienes un equipo'; end if;
  insert into public.hogares (nombre, personal, deporte)
  values (case when p_personal then 'Mi espacio' else coalesce(nullif(left(trim(p_equipo), 40), ''), 'Mi equipo') end, p_personal, coalesce(p_deporte, 'gym'))
  returning id into nuevo;
  insert into public.personas (id, hogar_id, nombre) values (yo, nuevo, mi_nombre);
  update public.hogares set admin_id = yo where id = nuevo;
  return nuevo;
end
$$;

-- Unirme con un código. Si ya tenía espacio personal, me llevo mis comidas y el espacio se borra.
create or replace function public.unirme_equipo(p_codigo text, p_mi_nombre text default null)
returns uuid
language plpgsql
security definer
set search_path = public, privado
as $$
declare
  yo uuid := auth.uid();
  destino uuid;
  antes uuid;
  era_personal boolean;
  mi_nombre text := left(trim(coalesce(p_mi_nombre, '')), 40);
begin
  if yo is null then raise exception 'Sin sesión'; end if;
  select id into destino from public.hogares where codigo = upper(trim(p_codigo)) and not personal;
  if destino is null then raise exception 'Código no válido'; end if;
  select hogar_id into antes from public.personas where id = yo;
  if antes = destino then return destino; end if;
  if antes is null then
    if mi_nombre = '' then raise exception 'Falta tu nombre'; end if;
    insert into public.personas (id, hogar_id, nombre) values (yo, destino, mi_nombre);
    return destino;
  end if;
  select personal into era_personal from public.hogares where id = antes;
  update public.personas set hogar_id = destino where id = yo;
  if era_personal then
    update public.comidas set hogar_id = destino where hogar_id = antes;
    update public.despensa set hogar_id = destino where hogar_id = antes;
    update public.alimentos set hogar_id = destino where hogar_id = antes;
  end if;
  perform privado.ordenar_equipo(antes);
  return destino;
end
$$;

-- Salir del equipo: vuelvo a un espacio personal (mis mediciones y entrenos van conmigo).
create or replace function public.salir_del_equipo()
returns uuid
language plpgsql
security definer
set search_path = public, privado
as $$
declare
  yo uuid := auth.uid();
  antes uuid;
  nuevo uuid;
begin
  select hogar_id into antes from public.personas where id = yo;
  if antes is null then raise exception 'Sin equipo'; end if;
  if (select personal from public.hogares where id = antes) then return antes; end if;
  nuevo := privado.espacio_personal(yo);
  perform privado.ordenar_equipo(antes);
  return nuevo;
end
$$;

-- El admin quita a alguien: esa persona sigue con su cuenta, en un espacio personal.
create or replace function public.quitar_del_equipo(p_persona uuid)
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
declare
  equipo uuid := privado.mi_hogar();
begin
  if (select admin_id from public.hogares where id = equipo) is distinct from auth.uid() then
    raise exception 'Solo el admin puede quitar personas';
  end if;
  if p_persona = auth.uid() then raise exception 'Para irte usa «Salir del equipo»'; end if;
  if not exists (select 1 from public.personas where id = p_persona and hogar_id = equipo) then
    raise exception 'Esa persona no está en el equipo';
  end if;
  perform privado.espacio_personal(p_persona);
end
$$;

-- Admin: cambiar el nombre, renovar el código o pasar el rol de admin.
create or replace function public.editar_equipo(p_nombre text default null, p_nuevo_codigo boolean default false, p_admin uuid default null, p_deporte text default null)
returns text
language plpgsql
security definer
set search_path = public, privado
as $$
declare
  equipo uuid := privado.mi_hogar();
  h public.hogares;
begin
  select * into h from public.hogares where id = equipo;
  if h.admin_id is distinct from auth.uid() then raise exception 'Solo el admin puede cambiar el equipo'; end if;
  if p_admin is not null and not exists (select 1 from public.personas where id = p_admin and hogar_id = equipo) then
    raise exception 'Esa persona no está en el equipo';
  end if;
  update public.hogares set
    nombre = coalesce(nullif(left(trim(p_nombre), 40), ''), nombre),
    codigo = case when p_nuevo_codigo then privado.nuevo_codigo() else codigo end,
    admin_id = coalesce(p_admin, admin_id),
    deporte = coalesce(p_deporte, deporte)
  where id = equipo
  returning codigo into h.codigo;
  return h.codigo;
end
$$;

-- Pasar de espacio personal a equipo (para invitar gente). Conserva todo lo que ya había.
create or replace function public.convertir_en_equipo(p_nombre text)
returns text
language plpgsql
security definer
set search_path = public, privado
as $$
declare
  equipo uuid := privado.mi_hogar();
  c text;
begin
  update public.hogares
  set personal = false, nombre = coalesce(nullif(left(trim(p_nombre), 40), ''), 'Mi equipo'), admin_id = auth.uid()
  where id = equipo and personal
  returning codigo into c;
  if c is null then raise exception 'Ya es un equipo'; end if;
  return c;
end
$$;

revoke all on function privado.nuevo_codigo(), privado.espacio_personal(uuid), privado.ordenar_equipo(uuid) from public, anon, authenticated;
revoke all on function public.crear_equipo(text, text, boolean, text), public.unirme_equipo(text, text), public.salir_del_equipo(),
  public.quitar_del_equipo(uuid), public.editar_equipo(text, boolean, uuid, text), public.convertir_en_equipo(text) from public, anon;
grant execute on function public.crear_equipo(text, text, boolean, text), public.unirme_equipo(text, text), public.salir_del_equipo(),
  public.quitar_del_equipo(uuid), public.editar_equipo(text, boolean, uuid, text), public.convertir_en_equipo(text) to authenticated;
