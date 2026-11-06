// Variación de rutinas: que no sea la misma semana tras semana.
// - Básicos (press, jalón, remo, prensa, peso muerto, hip thrust): se mantienen 4 semanas para poder
//   superar el peso, y cambian por otro del mismo movimiento cuando empieza un bloque nuevo.
// - Accesorios (aperturas, laterales, curls, tríceps, core…): cambian cada semana por otro del mismo
//   músculo y movimiento, así nunca se repite el de la semana anterior.
// Todo es determinista (depende solo de la fecha): los dos ven lo mismo y una sesión vieja se ve igual.
// Sin dependencias del navegador para poder probarlo.

// Lunes desde el que se cuentan semanas y bloques de 4 semanas.
const ANCLA = Date.UTC(2026, 9, 26); // lunes 26 oct 2026
export const SEMANAS_POR_BLOQUE = 4;

/**
 * Familias de ejercicios intercambiables: mismo músculo principal y mismo movimiento.
 * Cada ejercicio va como «nombre|nivel» (1 más fácil o guiado por máquina, 2 medio, 3 más difícil o más estable de controlar).
 * grupo: para ofrecer, si hace falta, otros movimientos del mismo músculo.
 */
const F = (clave, grupo, musculo, lista, basico = false) => ({
  clave, grupo, musculo, basico,
  ejercicios: lista.map((x) => x.split('|')[0]),
  nivel: Object.fromEntries(lista.map((x) => [x.split('|')[0], Number(x.split('|')[1] ?? 2)])),
});
export const FAMILIAS = [
  F('empuje_horizontal', 'pecho', 'pecho', ['Press de pecho en máquina|1', 'Press de banca con mancuernas|2', 'Press de banca en Multipower|2', 'Press de pecho en polea de pie|2', 'Flexiones de brazos|2'], true),
  F('empuje_inclinado', 'pecho', 'pecho superior', ['Press inclinado con mancuernas|2', 'Press inclinado en Multipower|2', 'Press inclinado en polea|2', 'Flexiones con pies elevados|3']),
  F('aperturas', 'pecho', 'pecho', ['Aperturas en pec deck|1', 'Cruce de poleas|1', 'Cruce de poleas desde abajo|2', 'Aperturas con mancuernas en banco|2']),
  F('empuje_vertical', 'hombro', 'hombros', ['Press de hombros en máquina|1', 'Press militar con mancuernas|2', 'Press militar en Multipower|2', 'Press Arnold con mancuernas|3'], true),
  F('laterales', 'hombro', 'hombro lateral', ['Elevaciones laterales en máquina|1', 'Elevación lateral sentado con mancuernas|1', 'Elevaciones laterales con mancuernas|2', 'Elevación lateral en polea a una mano|2']),
  F('hombro_posterior', 'hombro', 'hombro posterior', ['Pec deck inverso|1', 'Face pull en polea|1', 'Pájaros con mancuernas|2', 'Pájaros en polea cruzada|2']),
  F('triceps', 'triceps', 'tríceps', ['Extensión de tríceps en máquina|1', 'Extensión de tríceps en polea|1', 'Patada de tríceps en polea|1', 'Extensión de tríceps sobre la cabeza en polea|2', 'Press francés con mancuernas|2', 'Fondos asistidos|2', 'Fondos en banco|3']),
  F('tiron_vertical', 'espalda', 'espalda (dorsal)', ['Jalón al pecho|1', 'Jalón con agarre neutro|1', 'Jalón unilateral en polea|2', 'Dominadas asistidas|2'], true),
  F('tiron_horizontal', 'espalda', 'espalda (media)', ['Remo sentado en máquina|1', 'Remo bajo en máquina|1', 'Remo con pecho apoyado con mancuernas|2', 'Remo en polea baja a una mano|2', 'Remo con mancuerna|2'], true),
  F('dorsal_aislado', 'espalda', 'dorsal', ['Pullover en polea|1', 'Pullover con mancuerna|2']),
  F('espalda_alta', 'espalda', 'espalda alta', ['Remo alto en máquina|1', 'Remo abierto en polea baja|1', 'Remo alto con mancuernas en banco inclinado|2']),
  F('curl', 'biceps', 'bíceps', ['Curl de bíceps en máquina|1', 'Curl en polea baja con barra|1', 'Curl con mancuernas|2', 'Bayesian cable curl|2', 'Curl concentrado|2', 'Curl en banco Scott con mancuerna|2', 'Curl inclinado con mancuernas|3']),
  F('curl_martillo', 'biceps', 'bíceps y antebrazo', ['Curl martillo en polea con cuerda|1', 'Curl martillo|1', 'Curl martillo cruzado|2', 'Curl invertido en polea|2']),
  F('muneca', 'antebrazo', 'antebrazo', ['Curl de muñeca en polea|1', 'Curl de muñeca con mancuerna|1', 'Curl de muñeca con barra|2']),
  F('agarre', 'antebrazo', 'agarre', ['Agarre isométrico con discos|1', 'Caminata de granjero|2', 'Colgarse de la barra|2']),
  F('trapecios', 'trapecio', 'trapecios', ['Encogimientos en polea|1', 'Encogimientos con mancuernas|1', 'Encogimientos en Multipower|2', 'Remo al mentón en polea|2']),
  F('cuadriceps_compuesto', 'cuadriceps', 'cuádriceps', ['Prensa de piernas|1', 'Prensa horizontal|1', 'Sentadilla goblet con mancuerna|2', 'Sentadilla en Multipower|2', 'Sentadilla búlgara con mancuernas|3'], true),
  F('gluteo_compuesto', 'gluteo', 'glúteos', ['Empuje de cadera en máquina|1', 'Puente de glúteo con mancuerna|1', 'Hip thrust con barra|2', 'Hip thrust a una pierna|3'], true),
  F('gluteo_aislado', 'gluteo', 'glúteo medio y mayor', ['Abductores en máquina|1', 'Patada de glúteo en máquina|1', 'Patada de glúteo en polea|2', 'Abducción de cadera en polea|2', 'Caminata lateral con banda|2']),
  F('femoral_bisagra', 'femoral', 'isquiotibiales', ['Peso muerto rumano con mancuernas|2', 'Peso muerto rumano en Multipower|2', 'Peso muerto rumano a una pierna|3', 'Buenos días en Multipower|3'], true),
  F('femoral_curl', 'femoral', 'isquiotibiales', ['Curl femoral en máquina|1', 'Curl femoral sentado en máquina|1', 'Curl femoral con fitball|2', 'Curl nórdico asistido|3']),
  F('aductores', 'aductor', 'aductores', ['Aductores en máquina|1', 'Sentadilla sumo con mancuerna|2', 'Plancha Copenhague|3']),
  F('pantorrillas', 'pantorrilla', 'pantorrillas', ['Pantorrillas en prensa|1', 'Elevación de talones en Multipower|2', 'Elevación de talones a una pierna|2']),
  F('core_antirrotacion', 'core', 'core', ['Plancha|1', 'Dead bug|1', 'Pallof press en polea|1', 'Plancha lateral|2', 'Plancha con toque de hombros|2']),
  F('core_flexion', 'core', 'abdomen', ['Abdominal en máquina|1', 'Crunch en colchoneta|1', 'Crunch en polea de rodillas|2', 'Elevación de piernas en colchoneta|2', 'Elevación de piernas colgado|3']),
  F('core_rotacion', 'core', 'oblicuos', ['Rotación de tronco en máquina|1', 'Woodchop en polea|2', 'Woodchop con mancuerna|2', 'Giro ruso con disco|2', 'Lanzamiento lateral de balón medicinal|2']),
  F('lumbar', 'lumbar', 'zona lumbar', ['Lumbar en máquina|1', 'Superman en colchoneta|1', 'Hiperextensión en banco romano|2']),
  F('estabilidad', 'estabilidad', 'estabilidad', ['Bird dog|1', 'Equilibrio a una pierna|1', 'Alcance en estrella a una pierna|2']),
  F('pliometria', 'pliometria', 'potencia de piernas', ['Saltos laterales sobre línea|1', 'Sentadilla con salto|2', 'Saltos de patinador|2', 'Salto al cajón|2', 'Saltos laterales al cajón|3']),
];

export const normal = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const POR_NOMBRE = new Map(FAMILIAS.flatMap((f) => f.ejercicios.map((n) => [normal(n), f])));
/** Familia de un ejercicio por su nombre (o null si no tiene variantes conocidas). */
export const familiaDe = (nombre) => POR_NOMBRE.get(normal(nombre)) ?? null;

/** Semana (desde el ancla) de una fecha 'AAAA-MM-DD'. */
export function semanaDe(fechaISO) {
  const [a, m, d] = String(fechaISO).slice(0, 10).split('-').map(Number);
  return Math.floor((Date.UTC(a, m - 1, d) - ANCLA) / (7 * 864e5));
}

/**
 * Cambia los ejercicios de una rutina según la semana.
 * @param {Array} items [{ ejercicio: { id, nombre, unidad }, series_base, reps_base, ... }]
 * @param {Array} catalogo ejercicios del hogar (con los mismos campos que it.ejercicio)
 * @param {string} fechaISO día del entreno
 * @returns {Array} items con `ejercicio` ya cambiado, `original` y `rotado` ('semana' | 'bloque' | null)
 */
export function variarRutina(items, catalogo, fechaISO) {
  const semana = semanaDe(fechaISO);
  const bloque = Math.floor(semana / SEMANAS_POR_BLOQUE);
  const enCatalogo = new Map(catalogo.map((e) => [normal(e.nombre), e]));
  // Nada se repite dentro de la misma rutina: ni lo que ya tiene ni lo que se elige.
  const usados = new Set(items.map((it) => normal(it.ejercicio?.nombre)));
  return items.map((it) => {
    const nombre = normal(it.ejercicio?.nombre);
    const fam = familiaDe(nombre);
    const opciones = fam ? fam.ejercicios.filter((n) => enCatalogo.has(normal(n))).map(normal) : [];
    const desde = opciones.indexOf(nombre);
    if (!fam || opciones.length < 2 || desde < 0) return { ...it, original: it.ejercicio, rotado: null, familia: fam };
    const paso = fam.basico ? bloque : semana;
    let elegido = nombre;
    for (let k = 0; k < opciones.length; k++) {
      const c = opciones[(((desde + paso + k) % opciones.length) + opciones.length) % opciones.length];
      if (c === nombre || !usados.has(c)) { elegido = c; break; }
    }
    if (elegido === nombre) return { ...it, original: it.ejercicio, rotado: null, familia: fam };
    usados.add(elegido);
    const nuevo = enCatalogo.get(elegido);
    const mismaUnidad = (nuevo.unidad ?? 'reps') === (it.ejercicio.unidad ?? 'reps');
    const reps = mismaUnidad ? it.reps_base : (nuevo.unidad === 'segundos' ? 40 : 12);
    return {
      ...it,
      ejercicio: nuevo,
      original: it.ejercicio,
      rotado: fam.basico ? 'bloque' : 'semana',
      familia: fam,
      reps_base: reps,
      // Para volver al de siempre (ej. una sesión que ya se hizo con el original).
      deSiempre: { ejercicio: it.ejercicio, reps_base: it.reps_base, metas: it.metas },
      // Las metas eran del ejercicio de siempre: se mantienen series y descanso, el peso sale de su propio historial.
      metas: Object.fromEntries(Object.entries(it.metas ?? {}).map(([pid, m]) => [pid, { ...m, peso_kg: null, reps: mismaUnidad ? m.reps : reps }])),
    };
  });
}

/** Nivel (1 a 3) de un ejercicio dentro de su familia, o null. */
export function nivelDe(nombre) {
  const f = familiaDe(nombre);
  return f ? f.nivel[f.ejercicios.find((n) => normal(n) === normal(nombre))] ?? 2 : null;
}
/** «Más fácil», «Parecido» o «Más difícil» de b respecto de a. */
export function comparacion(a, b) {
  const na = nivelDe(a), nb = nivelDe(b);
  if (na == null || nb == null || na === nb) return 'Parecido';
  return nb < na ? 'Más fácil' : 'Más difícil';
}

/**
 * Alternativas para «Cambiar ejercicio»: primero otras de la misma familia (mismo músculo y movimiento),
 * después otros movimientos del mismo grupo muscular. Nunca lo que ya está en la rutina ni lo hecho hoy
 * (evitar = nombres o ids hechos en la sesión). Se ordenan para que haya de todo: parecido, más fácil y más difícil.
 * Cada una trae `.comparacion` y `.mismoMovimiento`. Si el ejercicio no tiene familia, se usan las guardadas.
 */
export function alternativasDe(it, items, catalogo, guardadas = [], evitar = []) {
  if (!it.familia) return guardadas;
  const fuera = new Set([...items.map((x) => normal(x.ejercicio?.nombre)), ...evitar.map(normal)]);
  const buscar = (n) => catalogo.find((e) => normal(e.nombre) === normal(n));
  const base = it.ejercicio?.nombre;
  const marcar = (e, mismo) => e && Object.assign(Object.create(Object.getPrototypeOf(e)), e, { comparacion: comparacion(base, e.nombre), mismoMovimiento: mismo });
  const propias = it.familia.ejercicios.map(buscar).filter((e) => e && !fuera.has(normal(e.nombre))).map((e) => marcar(e, true));
  // El de siempre también vale como alternativa cuando esta semana toca otro.
  if (it.rotado && it.original && !propias.some((e) => e.id === it.original.id) && !fuera.has(normal(it.original.nombre))) propias.unshift(marcar(it.original, true));
  const otras = FAMILIAS.filter((f) => f.grupo === it.familia.grupo && f.clave !== it.familia.clave)
    .flatMap((f) => f.ejercicios).map(buscar).filter((e) => e && !fuera.has(normal(e.nombre))).map((e) => marcar(e, false));
  // Variedad: uno de cada tipo primero (parecido, más fácil, más difícil), después el resto.
  const orden = { Parecido: 0, 'Más fácil': 1, 'Más difícil': 2 };
  const visto = new Set();
  const primero = [...propias].sort((a, b) => orden[a.comparacion] - orden[b.comparacion]).filter((e) => !visto.has(e.comparacion) && visto.add(e.comparacion));
  const resto = propias.filter((e) => !primero.includes(e));
  return [...primero, ...resto, ...otras].slice(0, 8);
}

/**
 * En una sesión que ya tiene series con el ejercicio de siempre (y ninguna con la variante),
 * se muestra el de siempre: así lo que ya se hizo no queda «huérfano».
 */
export function respetarLoHecho(items, series) {
  return items.map((it) => {
    if (!it.rotado) return it;
    const conOriginal = series.some((s) => s.ejercicio_id === it.original.id || s.sustituye_a === it.original.id);
    const conVariante = series.some((s) => s.ejercicio_id === it.ejercicio.id || s.sustituye_a === it.ejercicio.id);
    if (!conOriginal || conVariante) return it;
    const alternativas = [it.ejercicio, ...(it.alternativas ?? []).filter((a) => a.id !== it.original.id && a.id !== it.ejercicio.id)];
    return { ...it, ...it.deSiempre, alternativas, rotado: null };
  });
}

/** Texto corto para mostrar por qué hoy toca este ejercicio. */
export function motivoVariacion(it) {
  if (!it.rotado) return '';
  return it.rotado === 'bloque'
    ? `Básico del bloque: se mantiene ${SEMANAS_POR_BLOQUE} semanas (antes: ${it.original.nombre}).`
    : `Variante de esta semana: los accesorios cambian cada semana (el de siempre: ${it.original.nombre}).`;
}
