// Récords y rachas del gym.
//  - Récord: la serie con más fuerza estimada (1RM de Epley: peso × (1 + reps/30)) en ese ejercicio.
//  - Racha: semanas seguidas en las que hiciste todos tus gyms agendados (o al menos los que terminaste).
import { sb, estado, datos } from './db.js';
import { hoyISO, sumarDias, inicioSemana } from './fechas.js';

/** Máquinas asistidas (fondos, dominadas): el peso es contrapeso que ayuda, menos peso = más difícil. */
export const esAsistida = (nombre) => /asistid/i.test(String(nombre ?? ''));
// Para comparar series asistidas: menos asistencia es más fuerza (sobre un tope de 200 kg de contrapeso).
const TOPE_ASISTENCIA = 200;

/** Fuerza estimada de una serie (para comparar 80 × 6 con 70 × 10). Con asistencia, cuenta al revés. */
export const fuerza = (s, asistida = false) => {
  if (s?.peso_kg == null || !(s.reps > 0)) return 0;
  const carga = asistida ? Math.max(0, TOPE_ASISTENCIA - Number(s.peso_kg)) : Number(s.peso_kg);
  return carga * (1 + Math.min(s.reps, 15) / 30);
};

/** La mejor serie de una lista (por fuerza estimada). */
export function mejorSerie(series, asistida = false) {
  let mejor = null;
  for (const s of series) if (fuerza(s, asistida) > fuerza(mejor, asistida)) mejor = s;
  return mejor;
}

/**
 * ¿Esta serie es un récord? Compara con todas las anteriores de ese ejercicio (de otras sesiones y de esta).
 * Solo cuenta si ya había historial (la primera vez no es récord) y si supera por algo de verdad.
 */
export function esRecord(serie, anteriores, asistida = false) {
  const previas = anteriores.filter((x) => x.id !== serie.id && x.peso_kg != null);
  if (!previas.length || serie.peso_kg == null) return null;
  const antes = mejorSerie(previas, asistida);
  if (fuerza(serie, asistida) > fuerza(antes, asistida) * 1.005) return { antes, ahora: serie };
  return null;
}

/** Semanas seguidas (hasta la pasada, más la actual si ya está completa) cumpliendo los gyms agendados. */
export async function rachaSemanas(personaId = estado.yo.id) {
  const hoy = hoyISO();
  const lunesActual = inicioSemana(hoy);
  const desde = sumarDias(lunesActual, -7 * 12);
  const [eventos, sesiones] = await Promise.all([
    sb.from('calendario').select('id, fecha, tipo, asistencia, persona_id, omitido').eq('hogar_id', estado.yo.hogar_id)
      .eq('tipo', 'gym').gte('fecha', desde).lte('fecha', hoy).then(datos),
    sb.from('sesiones').select('calendario_id, iniciada_en, terminados').eq('hogar_id', estado.yo.hogar_id)
      .gte('iniciada_en', new Date(`${desde}T00:00:00`).toISOString()).then(datos),
  ]);
  const suyos = eventos.filter((e) => !e.omitido && (e.asistencia === 'juntos' || e.persona_id === personaId));
  const hechos = new Set(sesiones.filter((s) => s.terminados?.includes(personaId)).map((s) => s.calendario_id));
  const terminadasPorSemana = new Map();
  for (const s of sesiones.filter((x) => x.terminados?.includes(personaId))) {
    const f = new Date(s.iniciada_en);
    const l = inicioSemana(`${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`);
    terminadasPorSemana.set(l, (terminadasPorSemana.get(l) ?? 0) + 1);
  }
  const cumple = (lunes) => {
    const delaSemana = suyos.filter((e) => inicioSemana(e.fecha) === lunes);
    const hechas = terminadasPorSemana.get(lunes) ?? 0;
    if (!delaSemana.length) return hechas > 0 ? true : null; // semana sin agenda: no corta la racha
    return delaSemana.every((e) => hechos.has(e.id)) || hechas >= delaSemana.length;
  };
  let racha = 0;
  const actual = cumple(lunesActual);
  if (actual === true) racha++;
  for (let k = 1; k <= 12; k++) {
    const c = cumple(sumarDias(lunesActual, -7 * k));
    if (c === false) break;
    if (c === true) racha++;
  }
  return racha;
}
