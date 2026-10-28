-- Alimento de una sola persona dentro de una comida compartida (nulo = lo comparten).
alter table public.comida_items add column persona_id uuid references public.personas(id) on delete cascade;
