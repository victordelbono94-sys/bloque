-- "Clase" pasa a "Otro": cualquier entreno que no es gym ni derby, con su actividad
-- (caminata, ciclismo, escalada…). Las clases viejas quedan como Otro · Clase.
alter table public.calendario add column actividad text check (actividad is null or char_length(actividad) <= 30);
alter table public.calendario drop constraint calendario_tipo_check;
update public.calendario set tipo = 'otro', actividad = 'clase' where tipo = 'clase';
alter table public.calendario add constraint calendario_tipo_check check (tipo in ('gym', 'derby', 'otro', 'descanso'));
