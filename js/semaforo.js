// Semáforo básico de fatiga.
// Por ahora usa el check-in del día y lo que hizo cada uno ayer y hoy según el
// calendario. Cuando lleguen los datos de la banda (sueño, frecuencia cardiaca,
// calorías) se suman a este cálculo.
import { incluyeA } from './eventos.js';

const CARGA = { derby: 2.5, gym: 1.5, clase: 1, descanso: 0 };

export const SEMAFORO = {
  verde: 'Entrenar normal',
  ambar: 'Bajar intensidad',
  rojo: 'Descansar',
};

/**
 * @param {object} p
 * @param {number|null} p.cansancio 1 a 5
 * @param {number|null} p.dolor 1 a 5
 * @param {Array} p.ayer eventos de calendario de ayer
 * @param {Array} p.hoy eventos de calendario de hoy
 * @param {Array} p.extrasAyer actividades extra de ayer de la persona
 * @param {string} p.personaId
 * @param {number|null} [p.suenoMin] minutos dormidos anoche, según la banda
 * @param {Array} [p.bandaAyer] entrenos que registró la banda ayer ({ calorias })
 * @returns {{semaforo: 'verde'|'ambar'|'rojo', motivo: string}}
 */
export function calcularSemaforo({ cansancio, dolor, ayer, hoy, extrasAyer, personaId, suenoMin = null, bandaAyer = [] }) {
  const motivos = [];
  let puntos = 0;

  if (cansancio != null) {
    puntos += (cansancio - 1) * 1.2;
    if (cansancio >= 4) motivos.push(`cansancio ${cansancio}/5`);
  }
  if (dolor != null) {
    puntos += (dolor - 1) * 1.0;
    if (dolor >= 3) motivos.push(`dolor muscular ${dolor}/5`);
  }

  // Carga de ayer: lo agendado da una estimación; si la banda registró los entrenos,
  // se usa la mayor de las dos (no se suman: es el mismo esfuerzo medido dos veces).
  const propiosAyer = ayer.filter((e) => incluyeA(e, personaId) && e.tipo !== 'descanso');
  let cargaAgendada = 0;
  for (const e of propiosAyer) cargaAgendada += CARGA[e.tipo] ?? 0;
  for (const x of extrasAyer) cargaAgendada += x.intensidad >= 4 ? 2 : x.intensidad >= 3 ? 1 : 0.5;
  const kcalAyer = bandaAyer.reduce((a, s) => a + (s.calorias ?? 0), 0);
  const cargaBanda = kcalAyer / 350; // un derby de unas 850 kcal ≈ 2,5
  puntos += Math.max(cargaAgendada, cargaBanda);
  const nombresAyer = [...new Set([...propiosAyer.map((e) => e.tipo), ...extrasAyer.map((x) => x.tipo)])];
  if (nombresAyer.length) motivos.push(`${unir(nombresAyer)} ayer${kcalAyer ? ` (${kcalAyer} kcal)` : ''}`);
  else if (kcalAyer >= 500) motivos.push(`${kcalAyer} kcal en entrenos ayer`);

  // Sueño de anoche (banda)
  if (suenoMin != null && suenoMin > 0) {
    if (suenoMin < 300) { puntos += 2; motivos.push(`dormiste ${horas(suenoMin)}`); }
    else if (suenoMin < 360) { puntos += 1; motivos.push(`dormiste ${horas(suenoMin)}`); }
  }

  const tiposHoy = new Set(hoy.filter((e) => incluyeA(e, personaId)).map((e) => e.tipo));
  const dobleHoy = tiposHoy.has('derby') && (tiposHoy.has('gym') || tiposHoy.has('clase'));
  if (dobleHoy) motivos.push('gym y derby el mismo día');

  let semaforo = 'verde';
  if (cansancio === 5 || dolor === 5 || puntos >= 8) semaforo = 'rojo';
  else if (puntos >= 4 || cansancio >= 4 || dolor >= 4 || dobleHoy) semaforo = 'ambar';

  const descanso = esDescanso(hoy, personaId);
  let motivo;
  if (descanso) motivo = motivos.length ? `Hoy toca descanso · ${motivos.join(' · ')}` : 'Hoy toca descanso';
  else motivo = motivos.length ? capitalizar(motivos.join(' · ')) : 'Buen día para entrenar';
  return { semaforo, motivo };
}

// Día de descanso: está marcado y no hay ningún entreno para esa persona.
export function esDescanso(hoy, personaId) {
  const tipos = new Set(hoy.filter((e) => incluyeA(e, personaId)).map((e) => e.tipo));
  return tipos.has('descanso') && !tipos.has('gym') && !tipos.has('derby') && !tipos.has('clase');
}

// Cómo se lee el semáforo según el día.
export function textoSemaforo(semaforo, descanso) {
  if (!descanso) return SEMAFORO[semaforo];
  return semaforo === 'verde' ? 'Descanso, vas bien' : 'Descanso, lo necesitas';
}

function horas(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function unir(lista) {
  return lista.length < 2 ? lista[0] : `${lista.slice(0, -1).join(', ')} y ${lista.at(-1)}`;
}

function capitalizar(t) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}
