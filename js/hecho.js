// ¿Se hizo o no un entreno agendado?
// Hecho: se tocó «Terminar mi entreno», se completó la mayoría de las series, o el reloj lo registró.
// No hecho: el día ya pasó y no hay nada de eso. Hoy y lo que viene quedan «pendiente».
import { sb, datos } from './db.js';
import { emparejar, esIndividual, asistenciaIndividual } from './actividades.js';
import { hoyISO } from './fechas.js';

/** Última sincronización del reloj de cada persona del equipo: { personaId: fecha }. */
let syncsCache = null;
export async function cargarSyncs() {
  if (syncsCache && Date.now() - syncsCache.t < 60000) return syncsCache.v;
  const { data } = await sb.rpc('ultima_sync_equipo');
  const v = Object.fromEntries((data ?? []).map((x) => [x.persona_id, x.ultimo_sync]));
  syncsCache = { t: Date.now(), v };
  return v;
}

/**
 * Carga lo necesario para saber qué se cumplió de una lista de eventos.
 * @returns {Promise<(ev, personaId?) => 'hecho'|'no_hecho'|'pendiente'|null>}
 */
export async function cargarCumplimiento(eventos, personaId) {
  const hoy = hoyISO();
  const conRutina = eventos.filter((e) => e.rutina_id);
  const fechas = eventos.map((e) => e.fecha).sort();
  const [sesiones, metas, banda, syncs] = await Promise.all([
    conRutina.length ? sb.from('sesiones').select('id, calendario_id, terminados').in('calendario_id', conRutina.map((e) => e.id)).then(datos) : [],
    conRutina.length
      ? sb.from('metas_ejercicio').select('persona_id, series, item:rutina_ejercicios!inner(rutina_id)')
        .eq('persona_id', personaId).in('item.rutina_id', [...new Set(conRutina.map((e) => e.rutina_id))]).then(datos)
      : [],
    fechas.length
      ? sb.from('sesiones_banda').select('tipo, inicio, fin, calorias, calorias_estimadas, fc_promedio').eq('persona_id', personaId)
        .gte('inicio', new Date(`${fechas[0]}T00:00:00`).toISOString())
        .lt('inicio', new Date(`${fechas.at(-1)}T23:59:59`).toISOString()).then(datos)
      : [],
    cargarSyncs(),
  ]);
  const idsSesion = sesiones.map((s) => s.id);
  const mias = idsSesion.length
    ? datos(await sb.from('series').select('sesion_id').eq('persona_id', personaId).in('sesion_id', idsSesion))
    : [];

  // Qué evento coincide con qué entreno del reloj, día por día.
  const delReloj = new Set();
  for (const f of new Set(fechas)) {
    const delDia = eventos.filter((e) => e.fecha === f && e.tipo !== 'descanso' && (e.asistencia === 'juntos' || e.persona_id === personaId));
    const bandaDia = banda.filter((s) => fechaLocal(s.inicio) === f);
    for (const ev of emparejar(delDia, bandaDia).pares.keys()) delReloj.add(ev.id);
  }
  const planeadas = (rutinaId) => metas.filter((m) => m.item?.rutina_id === rutinaId).reduce((a, m) => a + m.series, 0);

  return (ev) => {
    if (!ev || ev.tipo === 'descanso') return null;
    if (ev.asistencia !== 'juntos' && ev.persona_id !== personaId) return null;
    const ses = sesiones.filter((s) => s.calendario_id === ev.id);
    const terminado = ses.some((s) => s.terminados?.includes(personaId));
    const hechas = mias.filter((x) => ses.some((s) => s.id === x.sesion_id)).length;
    const total = planeadas(ev.rutina_id);
    const completo = hechas > 0 && hechas >= Math.max(1, Math.ceil(total * 0.6));
    if (terminado || completo || delReloj.has(ev.id)) return 'hecho';
    // Derby y otros: cada uno por su reloj; se sabe que no fue cuando su reloj ya sincronizó después.
    if (esIndividual(ev)) return asistenciaIndividual(ev, null, syncs[personaId]) === 'no_fue' ? 'no_hecho' : 'pendiente';
    return ev.fecha < hoy ? 'no_hecho' : 'pendiente';
  };
}

function fechaLocal(iso) {
  const f = new Date(iso);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
}

/** Próximo día (desde hoy) sin gym agendado: donde conviene recuperar una rutina. */
export function proximoDiaLibre(eventos, desde = hoyISO(), dias = 7) {
  for (let i = 0; i < dias; i++) {
    const f = new Date(`${desde}T12:00`); f.setDate(f.getDate() + i);
    const iso = fechaLocal(f.toISOString());
    const ese = eventos.filter((e) => e.fecha === iso && !e.omitido);
    if (!ese.some((e) => e.tipo === 'gym') && !ese.some((e) => e.tipo === 'descanso')) return iso;
  }
  return desde;
}
