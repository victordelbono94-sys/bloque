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

/** Familias de ejercicios intercambiables: mismo músculo principal y mismo movimiento. */
export const FAMILIAS = [
  { clave: 'empuje_horizontal', musculo: 'pecho', basico: true, ejercicios: ['Press de pecho en máquina', 'Press de banca con mancuernas', 'Press de banca en Multipower'] },
  { clave: 'empuje_inclinado', musculo: 'pecho superior', ejercicios: ['Press inclinado con mancuernas', 'Press inclinado en Multipower'] },
  { clave: 'aperturas', musculo: 'pecho', ejercicios: ['Cruce de poleas', 'Aperturas en pec deck'] },
  { clave: 'empuje_vertical', musculo: 'hombros', basico: true, ejercicios: ['Press de hombros en máquina', 'Press militar con mancuernas'] },
  { clave: 'laterales', musculo: 'hombro lateral', ejercicios: ['Elevaciones laterales en máquina', 'Elevaciones laterales con mancuernas'] },
  { clave: 'hombro_posterior', musculo: 'hombro posterior', ejercicios: ['Pájaros con mancuernas', 'Face pull en polea'] },
  { clave: 'triceps', musculo: 'tríceps', ejercicios: ['Extensión de tríceps en polea', 'Extensión de tríceps en máquina', 'Fondos asistidos'] },
  { clave: 'tiron_vertical', musculo: 'espalda (dorsal)', basico: true, ejercicios: ['Jalón al pecho', 'Dominadas asistidas'] },
  { clave: 'tiron_horizontal', musculo: 'espalda (media)', basico: true, ejercicios: ['Remo sentado en máquina', 'Remo bajo en máquina', 'Remo con mancuerna'] },
  { clave: 'espalda_alta', musculo: 'espalda alta', ejercicios: ['Remo alto en máquina', 'Face pull en polea'] },
  { clave: 'curl', musculo: 'bíceps', ejercicios: ['Curl de bíceps en máquina', 'Curl con mancuernas', 'Bayesian cable curl'] },
  { clave: 'curl_martillo', musculo: 'bíceps y antebrazo', ejercicios: ['Curl martillo', 'Curl invertido en polea'] },
  { clave: 'muneca', musculo: 'antebrazo', ejercicios: ['Curl de muñeca en polea', 'Curl de muñeca con mancuerna', 'Curl de muñeca con barra'] },
  { clave: 'agarre', musculo: 'agarre', ejercicios: ['Agarre isométrico con discos', 'Caminata de granjero'] },
  { clave: 'trapecios', musculo: 'trapecios', ejercicios: ['Encogimientos con mancuernas', 'Encogimientos en Multipower', 'Remo al mentón en polea'] },
  { clave: 'cuadriceps_compuesto', musculo: 'cuádriceps', basico: true, ejercicios: ['Prensa de piernas', 'Sentadilla en Multipower'] },
  { clave: 'gluteo_compuesto', musculo: 'glúteos', basico: true, ejercicios: ['Hip thrust con barra', 'Empuje de cadera en máquina'] },
  { clave: 'core_antirrotacion', musculo: 'core', ejercicios: ['Pallof press en polea', 'Plancha lateral'] },
  { clave: 'core_flexion', musculo: 'abdomen', ejercicios: ['Abdominal en máquina', 'Crunch en colchoneta'] },
  { clave: 'core_rotacion', musculo: 'oblicuos', ejercicios: ['Rotación de tronco en máquina', 'Lanzamiento lateral de balón medicinal'] },
  { clave: 'lumbar', musculo: 'zona lumbar', ejercicios: ['Lumbar en máquina', 'Superman en colchoneta'] },
  { clave: 'estabilidad', musculo: 'estabilidad', ejercicios: ['Equilibrio a una pierna', 'Bird dog'] },
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

/**
 * Alternativas para «¿Ocupada? Cámbiala por»: otras de la misma familia (mismo músculo y movimiento)
 * que no estén ya en la rutina. Si el ejercicio no tiene familia, se usan las que estaban guardadas.
 */
export function alternativasDe(it, items, catalogo, guardadas = []) {
  if (!it.familia) return guardadas;
  const enRutina = new Set(items.map((x) => normal(x.ejercicio?.nombre)));
  const propias = it.familia.ejercicios
    .map((n) => catalogo.find((e) => normal(e.nombre) === normal(n)))
    .filter((e) => e && !enRutina.has(normal(e.nombre)));
  // El de siempre también vale como alternativa cuando esta semana toca otro.
  if (it.rotado && it.original && !propias.some((e) => e.id === it.original.id)) propias.unshift(it.original);
  return propias;
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
