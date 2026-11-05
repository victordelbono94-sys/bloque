-- Bloq · catálogo de comidas por país: cada alimento puede ser de un país (null = universal),
-- tiene sinónimos para buscarlo («guineo», «banana») y varias porciones («1 taza», «1 plato»).
-- El hogar tiene su país (por ahora Ecuador por defecto).
alter table public.alimentos add column if not exists pais text check (pais is null or pais ~ '^[A-Z]{2}$');
alter table public.alimentos add column if not exists sinonimos text;
alter table public.alimentos add column if not exists porciones jsonb not null default '[]'::jsonb;
alter table public.hogares add column if not exists pais text not null default 'EC' check (pais ~ '^[A-Z]{2}$');
create index if not exists alimentos_pais_idx on public.alimentos (pais) where hogar_id is null;
