-- Sobras: comida ya cocinada que se guarda para otro día (ej. una pizza para el almuerzo de mañana). Viven en la despensa.
alter table public.despensa add column if not exists es_sobra boolean not null default false;
