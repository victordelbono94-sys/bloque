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
 * @returns {{semaforo: 'verde'|'ambar'|'rojo', motivo: string}}
 */
export function calcularSemaforo({ cansancio, dolor, ayer, hoy, extrasAyer, personaId }) {
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

  const propiosAyer = ayer.filter((e) => incluyeA(e, personaId) && e.tipo !== 'descanso');
  for (const e of propiosAyer) puntos += CARGA[e.tipo] ?? 0;
  for (const x of extrasAyer) puntos += x.intensidad >= 4 ? 2 : x.intensidad >= 3 ? 1 : 0.5;
  const nombresAyer = [...new Set([...propiosAyer.map((e) => e.tipo), ...extrasAyer.map((x) => x.tipo)])];
  if (nombresAyer.length) motivos.push(`${unir(nombresAyer)} ayer`);

  const tiposHoy = new Set(hoy.filter((e) => incluyeA(e, personaId)).map((e) => e.tipo));
  const dobleHoy = tiposHoy.has('derby') && (tiposHoy.has('gym') || tiposHoy.has('clase'));
  if (dobleHoy) motivos.push('gym y derby el mismo día');

  let semaforo = 'verde';
  if (cansancio === 5 || dolor === 5 || puntos >= 7) semaforo = 'rojo';
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

function unir(lista) {
  return lista.length < 2 ? lista[0] : `${lista.slice(0, -1).join(', ')} y ${lista.at(-1)}`;
}

function capitalizar(t) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}
