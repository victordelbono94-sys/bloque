// Semáforo de fatiga: cómo te sientes, el sueño, y la carga de ayer y de hoy.
// La carga sale de lo agendado y de todo lo que registró el reloj: lo que coincide
// con un evento (el gym, el derby) se cuenta una vez; lo demás (caminar, correr,
// escalar…) se suma aparte.
import { incluyeA } from './eventos.js';
import { emparejar, cargaSesion, nombresSesiones, cargaOtro, actividad } from './actividades.js';

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
 * @param {Array} [p.bandaAyer] entrenos que registró el reloj ayer ({ tipo, inicio, fin, calorias })
 * @param {Array} [p.bandaHoy] entrenos que registró el reloj hoy (ya hechos)
 * @returns {{semaforo: 'verde'|'ambar'|'rojo', motivo: string}}
 */
export function calcularSemaforo({ cansancio, dolor, ayer, hoy, extrasAyer, personaId, suenoMin = null, bandaAyer = [], bandaHoy = [] }) {
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

  // Carga de ayer: cada evento agendado vale su estimación, o lo que midió el reloj si
  // lo registró (se usa el mayor: es el mismo esfuerzo). Los entrenos del reloj que no
  // coinciden con nada agendado se suman aparte.
  const propiosAyer = ayer.filter((e) => incluyeA(e, personaId) && e.tipo !== 'descanso');
  const { pares, sueltas } = emparejar(propiosAyer, bandaAyer);
  let cargaAyer = 0;
  for (const e of propiosAyer) {
    const s = pares.get(e);
    const estimada = e.tipo === 'otro' ? cargaOtro(e) : CARGA[e.tipo] ?? 0;
    cargaAyer += Math.max(estimada, s ? cargaSesion(s) : 0);
  }
  for (const s of sueltas) cargaAyer += cargaSesion(s);
  for (const x of extrasAyer) cargaAyer += x.intensidad >= 4 ? 2 : x.intensidad >= 3 ? 1 : 0.5;
  puntos += cargaAyer;
  const kcalAyer = bandaAyer.reduce((a, s) => a + (s.calorias ?? 0), 0);
  const nombreDe = (e) => (e.tipo === 'otro' ? actividad(e.actividad).nombre.toLowerCase() : e.tipo);
  const nombresAyer = [...new Set([...propiosAyer.map(nombreDe), ...nombresSesiones(sueltas), ...extrasAyer.map((x) => x.tipo)])];
  if (nombresAyer.length) motivos.push(`${unir(nombresAyer)} ayer${kcalAyer ? ` (${miles(kcalAyer)} kcal)` : ''}`);

  // Lo que ya hiciste hoy también cansa (un trote de mañana antes del gym de la tarde).
  const cargaHoy = bandaHoy.reduce((a, s) => a + cargaSesion(s), 0);
  puntos += cargaHoy;
  const kcalHoy = bandaHoy.reduce((a, s) => a + (s.calorias ?? 0), 0);
  if (cargaHoy >= 0.5) {
    // Lo que coincide con lo agendado se nombra como el evento (gym, derby).
    const agendadosHoy = hoy.filter((e) => incluyeA(e, personaId) && e.tipo !== 'descanso');
    const { pares: paresHoy, sueltas: sueltasHoy } = emparejar(agendadosHoy, bandaHoy);
    const nombres = [...new Set([...[...paresHoy.keys()].map(nombreDe), ...nombresSesiones(sueltasHoy)])];
    motivos.push(`hoy ya: ${unir(nombres)}${kcalHoy ? ` (${miles(kcalHoy)} kcal)` : ''}`);
  }

  // Sueño de anoche (banda)
  if (suenoMin != null && suenoMin > 0) {
    if (suenoMin < 300) { puntos += 2; motivos.push(`dormiste ${horas(suenoMin)}`); }
    else if (suenoMin < 360) { puntos += 1; motivos.push(`dormiste ${horas(suenoMin)}`); }
  }

  // Gym y derby el mismo día solo pesa si el gym no es la rutina liviana pensada para eso.
  const propiosHoy = hoy.filter((e) => incluyeA(e, personaId));
  const tiposHoy = new Set(propiosHoy.map((e) => e.tipo));
  const gymPesadoHoy = propiosHoy.some((e) => (e.tipo === 'gym' && !e.liviana) || e.tipo === 'clase' || (e.tipo === 'otro' && cargaOtro(e) >= 1));
  const dobleHoy = tiposHoy.has('derby') && gymPesadoHoy;
  const livianoConDerby = tiposHoy.has('derby') && !dobleHoy && tiposHoy.has('gym');
  if (dobleHoy) motivos.push(propiosHoy.some((e) => e.tipo === 'gym' && !e.liviana) ? 'gym exigente y derby el mismo día' : 'otro entreno exigente y derby el mismo día');

  let semaforo = 'verde';
  if (cansancio === 5 || dolor === 5 || puntos >= 8) semaforo = 'rojo';
  else if (puntos >= 4 || cansancio >= 4 || dolor >= 4 || dobleHoy) semaforo = 'ambar';

  const descanso = esDescanso(hoy, personaId);
  let motivo;
  if (descanso) motivo = motivos.length ? `Hoy toca descanso · ${motivos.join(' · ')}` : 'Hoy toca descanso';
  else if (motivos.length) motivo = capitalizar(motivos.join(' · '));
  else motivo = livianoConDerby ? 'Bien recuperado · gym liviano para llegar entero al derby' : 'Bien recuperado: buen día para entrenar';
  return { semaforo, motivo };
}

// Día de descanso: está marcado y no hay ningún entreno para esa persona.
export function esDescanso(hoy, personaId) {
  const tipos = new Set(hoy.filter((e) => incluyeA(e, personaId)).map((e) => e.tipo));
  return tipos.has('descanso') && !tipos.has('gym') && !tipos.has('derby') && !tipos.has('clase') && !tipos.has('otro');
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

const miles = (n) => Math.round(n).toLocaleString('es-EC');

function unir(lista) {
  return lista.length < 2 ? lista[0] : `${lista.slice(0, -1).join(', ')} y ${lista.at(-1)}`;
}

function capitalizar(t) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}
