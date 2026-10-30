-- Micronutrientes estimados por 100 g de cada alimento (los completa la función «micros» con Gemini).
-- Claves: potasio_mg, magnesio_mg, sodio_mg, calcio_mg, hierro_mg, vitamina_c_mg, vitamina_d_ug, b12_ug, omega3_mg, fibra_g, zinc_mg
alter table public.alimentos add column if not exists micros jsonb;
