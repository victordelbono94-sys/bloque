-- Bloq · lo que trae una prueba de bioimpedancia completa.
alter table public.mediciones_corporales
  add column if not exists masa_grasa_kg numeric(5,2) check (masa_grasa_kg between 1 and 200),
  add column if not exists musculo_esqueletico_kg numeric(5,2) check (musculo_esqueletico_kg between 5 and 100),
  add column if not exists agua_intracelular_l numeric(5,2) check (agua_intracelular_l between 5 and 60),
  add column if not exists agua_extracelular_l numeric(5,2) check (agua_extracelular_l between 3 and 40),
  add column if not exists angulo_fase numeric(4,2) check (angulo_fase between 1 and 15);
