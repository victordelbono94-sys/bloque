-- Bloque · entrenos genéricos del reloj («otro entreno»): la persona confirma qué fue.
-- confirmado: 'gym' | 'derby' | clave de deporte (deportes.js) | 'caminar' | 'esports' | 'nada' (no fue ejercicio).
alter table public.sesiones_banda
  add column if not exists confirmado text check (confirmado is null or confirmado ~ '^[a-z0-9_]{2,40}$'),
  add column if not exists confirmado_en timestamptz;
