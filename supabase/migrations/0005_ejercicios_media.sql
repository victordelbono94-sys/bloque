-- Bloque · fotos, técnica y video de cada ejercicio.
alter table public.ejercicios
  add column imagenes  text[] not null default '{}',  -- rutas dentro de la app (inicio y final del movimiento)
  add column tecnica   text[] not null default '{}',  -- claves cortas para hacerlo bien
  add column video_url text;                          -- video propio; si falta, se busca en YouTube
