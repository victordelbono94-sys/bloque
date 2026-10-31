-- Productos personales en la despensa: la leche deslactosada es de Victor, la semidescremada de Sant (null = de todos).
alter table public.despensa add column if not exists persona_id uuid references public.personas(id) on delete set null;
