-- Bloque · catálogo y rutinas base del Smart Fit Plataforma Financiera
-- Semana: lun trapecios+core (derby), mar empuje, mié antebrazos+core (derby),
-- jue piernas, vie descanso, sáb derby, dom espalda+bíceps.
-- Los días de derby el gym es liviano; lo pesado va lejos de la pista.
-- Uso: reemplazar el nombre del hogar si hace falta y correr una sola vez.

select set_config('bloque.hogar', (select id::text from public.hogares where nombre = 'Victor y Sant'), false);

-- Máquinas (los códigos QR/NFC se completan al escanearlas en el gym)
insert into public.maquinas (hogar_id, nombre, grupo_muscular)
select current_setting('bloque.hogar')::uuid, n, g from (values
  ('Press de pecho', 'Pecho'),
  ('Pec deck', 'Pecho'),
  ('Press de hombros', 'Hombros'),
  ('Elevaciones laterales', 'Hombros'),
  ('Estación de poleas', 'Varios'),
  ('Jalón al pecho', 'Espalda'),
  ('Remo sentado', 'Espalda'),
  ('Remo alto', 'Espalda alta'),
  ('Curl de bíceps', 'Bíceps'),
  ('Extensión de tríceps', 'Tríceps'),
  ('Prensa de piernas', 'Piernas'),
  ('Extensión de cuádriceps', 'Cuádriceps'),
  ('Curl femoral', 'Isquiotibiales'),
  ('Máquina de glúteo', 'Glúteos'),
  ('Abductores', 'Glúteos'),
  ('Aductores', 'Aductores'),
  ('Abdominal', 'Core'),
  ('Lumbar', 'Core'),
  ('Rotación de tronco', 'Core'),
  ('Multipower', 'Varios'),
  ('Dominadas asistidas', 'Espalda')
) as m(n, g);

-- Ejercicios: nombre, grupo, máquina (o null si es con peso libre/colchoneta), unidad
insert into public.ejercicios (hogar_id, nombre, grupo_muscular, maquina_id, unidad, descripcion)
select current_setting('bloque.hogar')::uuid, e.n, e.g,
  (select id from public.maquinas m where m.nombre = e.maq and m.hogar_id = current_setting('bloque.hogar')::uuid),
  e.u, e.d
from (values
  -- Trapecios y hombro posterior
  ('Encogimientos con mancuernas', 'Trapecios', null, 'reps', 'Hombros arriba hacia las orejas, pausa de un segundo arriba.'),
  ('Encogimientos en Multipower', 'Trapecios', 'Multipower', 'reps', null),
  ('Face pull en polea', 'Trapecios y hombro posterior', 'Estación de poleas', 'reps', 'Cuerda a la altura de la cara, codos altos.'),
  ('Pájaros con mancuernas', 'Hombro posterior', null, 'reps', null),
  ('Remo alto en máquina', 'Espalda alta', 'Remo alto', 'reps', null),
  -- Core
  ('Abdominal en máquina', 'Core', 'Abdominal', 'reps', null),
  ('Crunch en colchoneta', 'Core', null, 'reps', null),
  ('Plancha', 'Core', null, 'segundos', 'Cuerpo en línea, sin hundir la cadera.'),
  ('Plancha lateral', 'Core', null, 'segundos', 'Por lado.'),
  ('Lumbar en máquina', 'Zona lumbar', 'Lumbar', 'reps', null),
  ('Superman en colchoneta', 'Zona lumbar', null, 'reps', null),
  ('Pallof press en polea', 'Core y estabilidad', 'Estación de poleas', 'reps', 'Por lado. Resistir el giro: clave para los bloqueos.'),
  ('Rotación de tronco en máquina', 'Core', 'Rotación de tronco', 'reps', 'Por lado.'),
  ('Equilibrio a una pierna', 'Estabilidad', null, 'segundos', 'Por pierna, rodilla un poco flexionada como en postura de derby.'),
  ('Bird dog', 'Estabilidad', null, 'reps', 'Por lado.'),
  -- Antebrazos
  ('Curl de muñeca con mancuerna', 'Antebrazos', null, 'reps', null),
  ('Curl de muñeca con barra', 'Antebrazos', null, 'reps', null),
  ('Curl invertido en polea', 'Antebrazos', 'Estación de poleas', 'reps', null),
  ('Curl martillo', 'Bíceps y antebrazos', null, 'reps', null),
  ('Caminata de granjero', 'Agarre', null, 'segundos', 'Mancuernas pesadas, caminar erguido.'),
  ('Agarre isométrico con discos', 'Agarre', null, 'segundos', null),
  -- Pecho, hombros, tríceps
  ('Press de pecho en máquina', 'Pecho', 'Press de pecho', 'reps', null),
  ('Press de banca con mancuernas', 'Pecho', null, 'reps', null),
  ('Press de banca en Multipower', 'Pecho', 'Multipower', 'reps', null),
  ('Press inclinado con mancuernas', 'Pecho superior', null, 'reps', null),
  ('Press inclinado en Multipower', 'Pecho superior', 'Multipower', 'reps', null),
  ('Aperturas en pec deck', 'Pecho', 'Pec deck', 'reps', null),
  ('Cruce de poleas', 'Pecho', 'Estación de poleas', 'reps', null),
  ('Press de hombros en máquina', 'Hombros', 'Press de hombros', 'reps', null),
  ('Press militar con mancuernas', 'Hombros', null, 'reps', null),
  ('Elevaciones laterales en máquina', 'Hombros', 'Elevaciones laterales', 'reps', null),
  ('Elevaciones laterales con mancuernas', 'Hombros', null, 'reps', null),
  ('Extensión de tríceps en polea', 'Tríceps', 'Estación de poleas', 'reps', null),
  ('Extensión de tríceps en máquina', 'Tríceps', 'Extensión de tríceps', 'reps', null),
  ('Fondos asistidos', 'Tríceps', 'Dominadas asistidas', 'reps', null),
  -- Piernas y glúteos
  ('Prensa de piernas', 'Piernas', 'Prensa de piernas', 'reps', null),
  ('Sentadilla en Multipower', 'Piernas', 'Multipower', 'reps', null),
  ('Extensión de cuádriceps', 'Cuádriceps', 'Extensión de cuádriceps', 'reps', null),
  ('Sentadilla búlgara con mancuernas', 'Cuádriceps y glúteos', null, 'reps', 'Por pierna.'),
  ('Curl femoral en máquina', 'Isquiotibiales', 'Curl femoral', 'reps', null),
  ('Peso muerto rumano con mancuernas', 'Isquiotibiales', null, 'reps', null),
  ('Empuje de cadera en máquina', 'Glúteos', 'Máquina de glúteo', 'reps', null),
  ('Hip thrust con barra', 'Glúteos', null, 'reps', null),
  ('Abductores en máquina', 'Glúteos', 'Abductores', 'reps', 'Clave para los desplazamientos laterales en el derby.'),
  ('Aductores en máquina', 'Aductores', 'Aductores', 'reps', null),
  ('Pantorrillas en prensa', 'Pantorrillas', 'Prensa de piernas', 'reps', null),
  -- Espalda y bíceps
  ('Jalón al pecho', 'Espalda', 'Jalón al pecho', 'reps', null),
  ('Dominadas asistidas', 'Espalda', 'Dominadas asistidas', 'reps', null),
  ('Remo sentado en máquina', 'Espalda', 'Remo sentado', 'reps', null),
  ('Remo con mancuerna', 'Espalda', null, 'reps', 'Por brazo.'),
  ('Pullover en polea', 'Espalda', 'Estación de poleas', 'reps', null),
  ('Curl de bíceps en máquina', 'Bíceps', 'Curl de bíceps', 'reps', null),
  ('Curl con mancuernas', 'Bíceps', null, 'reps', null)
) as e(n, g, maq, u, d);

-- Alternativas (en los dos sentidos)
insert into public.ejercicio_alternativas (ejercicio_id, alternativa_id)
select par.i, par.j from (values
  ('Encogimientos con mancuernas', 'Encogimientos en Multipower'),
  ('Face pull en polea', 'Pájaros con mancuernas'),
  ('Face pull en polea', 'Remo alto en máquina'),
  ('Abdominal en máquina', 'Crunch en colchoneta'),
  ('Lumbar en máquina', 'Superman en colchoneta'),
  ('Pallof press en polea', 'Rotación de tronco en máquina'),
  ('Equilibrio a una pierna', 'Bird dog'),
  ('Curl de muñeca con mancuerna', 'Curl de muñeca con barra'),
  ('Curl invertido en polea', 'Curl martillo'),
  ('Caminata de granjero', 'Agarre isométrico con discos'),
  ('Press de pecho en máquina', 'Press de banca con mancuernas'),
  ('Press de pecho en máquina', 'Press de banca en Multipower'),
  ('Press inclinado con mancuernas', 'Press inclinado en Multipower'),
  ('Aperturas en pec deck', 'Cruce de poleas'),
  ('Press de hombros en máquina', 'Press militar con mancuernas'),
  ('Elevaciones laterales en máquina', 'Elevaciones laterales con mancuernas'),
  ('Extensión de tríceps en polea', 'Extensión de tríceps en máquina'),
  ('Extensión de tríceps en polea', 'Fondos asistidos'),
  ('Prensa de piernas', 'Sentadilla en Multipower'),
  ('Extensión de cuádriceps', 'Sentadilla búlgara con mancuernas'),
  ('Curl femoral en máquina', 'Peso muerto rumano con mancuernas'),
  ('Empuje de cadera en máquina', 'Hip thrust con barra'),
  ('Jalón al pecho', 'Dominadas asistidas'),
  ('Remo sentado en máquina', 'Remo con mancuerna'),
  ('Curl de bíceps en máquina', 'Curl con mancuernas')
) as x(a, b)
join public.ejercicios a on a.nombre = x.a and a.hogar_id = current_setting('bloque.hogar')::uuid
join public.ejercicios b on b.nombre = x.b and b.hogar_id = current_setting('bloque.hogar')::uuid
cross join lateral (values (a.id, b.id), (b.id, a.id)) as par(i, j)
on conflict do nothing;

-- Rutinas
insert into public.rutinas (hogar_id, nombre, foco, autor, notas)
select current_setting('bloque.hogar')::uuid, n, f, 'claude', t from (values
  ('Core, estabilidad y lumbar', 'recuperacion', 'Lunes, día de derby: liviano y corto, sin piernas.'),
  ('Pecho, hombros y tríceps', 'masa_muscular', 'Martes: pesado.'),
  ('Trapecios, core y antebrazos', 'recuperacion', 'Miércoles, día de derby: liviano. Trapecios, agarre y core para la pista.'),
  ('Piernas y glúteos', 'fuerza', 'Jueves: pesado. Dos noches de recuperación antes del derby del sábado.'),
  ('Espalda y bíceps', 'masa_muscular', 'Domingo: pesado.')
) as r(n, f, t);

-- Ejercicios de cada rutina: orden, series, reps (o segundos), descanso
insert into public.rutina_ejercicios (rutina_id, ejercicio_id, orden, series_base, reps_base, descanso_base)
select r.id, e.id, x.o, x.s, x.re, x.d
from (values
  ('Core, estabilidad y lumbar', 'Abdominal en máquina', 1, 3, 15, 45),
  ('Core, estabilidad y lumbar', 'Pallof press en polea', 2, 3, 12, 45),
  ('Core, estabilidad y lumbar', 'Plancha', 3, 3, 40, 45),
  ('Core, estabilidad y lumbar', 'Lumbar en máquina', 4, 3, 12, 45),
  ('Core, estabilidad y lumbar', 'Equilibrio a una pierna', 5, 3, 30, 30),

  ('Pecho, hombros y tríceps', 'Press de pecho en máquina', 1, 4, 8, 120),
  ('Pecho, hombros y tríceps', 'Press inclinado con mancuernas', 2, 3, 10, 90),
  ('Pecho, hombros y tríceps', 'Aperturas en pec deck', 3, 3, 12, 75),
  ('Pecho, hombros y tríceps', 'Press de hombros en máquina', 4, 4, 8, 120),
  ('Pecho, hombros y tríceps', 'Elevaciones laterales en máquina', 5, 3, 12, 60),
  ('Pecho, hombros y tríceps', 'Extensión de tríceps en polea', 6, 3, 12, 60),

  ('Trapecios, core y antebrazos', 'Encogimientos con mancuernas', 1, 3, 15, 60),
  ('Trapecios, core y antebrazos', 'Face pull en polea', 2, 3, 15, 60),
  ('Trapecios, core y antebrazos', 'Curl de muñeca con mancuerna', 3, 3, 15, 45),
  ('Trapecios, core y antebrazos', 'Curl invertido en polea', 4, 3, 12, 45),
  ('Trapecios, core y antebrazos', 'Caminata de granjero', 5, 3, 40, 60),
  ('Trapecios, core y antebrazos', 'Plancha lateral', 6, 3, 30, 45),

  ('Piernas y glúteos', 'Prensa de piernas', 1, 4, 10, 150),
  ('Piernas y glúteos', 'Extensión de cuádriceps', 2, 3, 12, 75),
  ('Piernas y glúteos', 'Curl femoral en máquina', 3, 3, 12, 75),
  ('Piernas y glúteos', 'Empuje de cadera en máquina', 4, 3, 10, 90),
  ('Piernas y glúteos', 'Abductores en máquina', 5, 3, 15, 60),
  ('Piernas y glúteos', 'Pantorrillas en prensa', 6, 4, 15, 60),

  ('Espalda y bíceps', 'Jalón al pecho', 1, 4, 8, 120),
  ('Espalda y bíceps', 'Remo sentado en máquina', 2, 4, 10, 120),
  ('Espalda y bíceps', 'Remo alto en máquina', 3, 3, 12, 75),
  ('Espalda y bíceps', 'Pullover en polea', 4, 3, 12, 75),
  ('Espalda y bíceps', 'Curl de bíceps en máquina', 5, 3, 10, 60),
  ('Espalda y bíceps', 'Curl martillo', 6, 3, 12, 60)
) as x(rutina, ejercicio, o, s, re, d)
join public.rutinas r on r.nombre = x.rutina and r.hogar_id = current_setting('bloque.hogar')::uuid
join public.ejercicios e on e.nombre = x.ejercicio and e.hogar_id = current_setting('bloque.hogar')::uuid;

-- Calendario: desde mañana y por cuatro semanas, sin pisar lo ya agendado.
insert into public.calendario (hogar_id, fecha, tipo, asistencia, rutina_id)
select current_setting('bloque.hogar')::uuid, d::date, x.tipo, 'juntos',
  (select id from public.rutinas r where r.nombre = x.rutina and r.hogar_id = current_setting('bloque.hogar')::uuid)
-- (la fecha de hoy en Quito; el servidor de Supabase está en UTC)
from generate_series((now() at time zone 'America/Guayaquil')::date + 1,
                     (now() at time zone 'America/Guayaquil')::date + 28, interval '1 day') as d
join (values
  (1, 'gym', 'Core, estabilidad y lumbar'), (1, 'derby', null),
  (2, 'gym', 'Pecho, hombros y tríceps'),
  (3, 'gym', 'Trapecios, core y antebrazos'), (3, 'derby', null),
  (4, 'gym', 'Piernas y glúteos'),
  (5, 'descanso', null),
  (6, 'derby', null),
  (0, 'gym', 'Espalda y bíceps')
) as x(dow, tipo, rutina) on x.dow = extract(dow from d)
where not exists (
  select 1 from public.calendario c
  where c.hogar_id = current_setting('bloque.hogar')::uuid and c.fecha = d::date and c.tipo = x.tipo
);
