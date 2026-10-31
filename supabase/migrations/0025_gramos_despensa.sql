-- Lo que se gasta del producto de la despensa puede ser distinto de lo que se come (arroz crudo → cocido).
alter table public.comida_items add column if not exists gramos_despensa numeric check (gramos_despensa is null or gramos_despensa > 0);
