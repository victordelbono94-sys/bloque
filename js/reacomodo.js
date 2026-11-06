// «No voy»: cancelar un entreno y decidir qué pasa con su rutina, sin IA.
// Opciones: pasarla a un día libre cercano, correr la semana (cada gym toma la rutina del anterior) o dejarla perderse.
// Reglas: nada de pierna pesada el día del derby ni el día antes; el viernes es descanso; solo días con lugar libre.
import { sb, estado, datos } from './db.js';
import { esc, aviso, avisoError, abrirDialogo } from './ui.js';
import { hoyISO, sumarDias } from './fechas.js';
import { nombreEvento } from './eventos.js';
import { anotarSinIA } from './ia.js';

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const dia = (f) => new Date(`${f}T12:00`).getDay();
const diaTxt = (f, hoy) => (f === hoy ? 'hoy' : f === sumarDias(hoy, 1) ? 'mañana' : `el ${DIAS[dia(f)]} ${Number(f.slice(8))}`);
const aDia = (f, hoy) => (f === hoy ? 'hoy' : f === sumarDias(hoy, 1) ? 'mañana' : `al ${DIAS[dia(f)]} ${Number(f.slice(8))}`);
const esPierna = (r) => /pierna|gl[uú]teo|femoral|cu[aá]driceps/i.test(r?.nombre ?? '');
const esDeporte = (e) => e.tipo === 'derby' || (e.tipo === 'otro' && e.actividad && !['caminar', 'yoga'].includes(e.actividad));
const delHogar = (e, yo) => e.asistencia === 'juntos' || e.persona_id === yo;

/** ¿Se puede poner esta rutina ese día? Devuelve null si sí, o el motivo si no. */
export function motivoNo(fecha, rutina, eventos, yo = estado.yo.id) {
  const ese = eventos.filter((e) => e.fecha === fecha && !e.omitido && delHogar(e, yo));
  if (dia(fecha) === 5) return 'el viernes es descanso';
  if (ese.some((e) => e.tipo === 'gym')) return 'ya hay gym';
  if (esPierna(rutina)) {
    const manana = eventos.filter((e) => e.fecha === sumarDias(fecha, 1) && !e.omitido && delHogar(e, yo));
    if (ese.some(esDeporte)) return 'hay derby ese día';
    if (manana.some(esDeporte)) return 'al día siguiente hay derby';
  }
  return null;
}

/** El primer día libre (desde mañana, hasta 6 días) donde entra la rutina según las reglas. */
export function diaLibre(desde, rutina, eventos, yo = estado.yo.id) {
  for (let i = 1; i <= 6; i++) {
    const f = sumarDias(desde, i);
    const ese = eventos.filter((e) => e.fecha === f && !e.omitido && delHogar(e, yo));
    // Un día de descanso agendado no se pisa salvo que sea un derby cancelado o que no haya nada más.
    if (ese.some((e) => e.tipo === 'descanso' && dia(f) === 5)) continue;
    if (!motivoNo(f, rutina, eventos, yo)) return f;
  }
  return null;
}

/** Correr la semana: cada gym siguiente (hasta 14 días) toma la rutina del anterior; el primero, la saltada. */
export function correrSemana(ev, eventos, rutinas) {
  const gyms = eventos.filter((e) => e.tipo === 'gym' && !e.omitido && e.id !== ev.id && e.fecha > ev.fecha
    && e.fecha <= sumarDias(ev.fecha, 14) && e.asistencia === ev.asistencia && (e.persona_id ?? null) === (ev.persona_id ?? null))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  let anterior = ev.rutina_id;
  const cambios = [];
  for (const g of gyms) {
    if (!anterior) break;
    cambios.push({ id: g.id, fecha: g.fecha, de: g.rutina_id, a: anterior });
    anterior = g.rutina_id;
  }
  const avisos = cambios.filter((c) => esPierna(rutinas.find((r) => r.id === c.a))
    && eventos.some((e) => !e.omitido && esDeporte(e) && (e.fecha === c.fecha || e.fecha === sumarDias(c.fecha, 1))));
  return { cambios, avisos };
}

/**
 * Diálogo «No voy» para un entreno de hoy o de los próximos días.
 * @param ev evento del calendario; @param rutinas del hogar; @param alListo se llama al terminar
 */
export async function noVoy(ev, rutinas, alListo = () => {}) {
  const hoy = hoyISO(), yo = estado.yo.id;
  const eventos = datos(await sb.from('calendario').select('*').eq('hogar_id', estado.yo.hogar_id)
    .gte('fecha', hoy).lte('fecha', sumarDias(hoy, 21)));
  const todas = datos(await sb.from('rutinas').select('id, nombre, foco').eq('hogar_id', estado.yo.hogar_id));
  if (todas.length) rutinas = todas;
  const rutina = rutinas.find((r) => r.id === ev.rutina_id) ?? null;
  const otros = estado.personas.filter((p) => p.id !== yo);
  const juntos = ev.asistencia === 'juntos' && otros.length > 0;
  const libre = rutina ? diaLibre(ev.fecha, rutina, eventos) : null;
  const corrida = rutina ? correrSemana(ev, eventos, rutinas) : { cambios: [], avisos: [] };
  const nombreR = (id) => rutinas.find((r) => r.id === id)?.nombre ?? 'gym';
  const resumenCorrida = corrida.cambios.slice(0, 3).map((c) => `${diaTxt(c.fecha, hoy)}: ${nombreR(c.a)}`).join(' · ')
    + (corrida.cambios.length > 3 ? ' · …' : '');

  const d = abrirDialogo(`
    <div class="dialogo">
      <h2 class="tarjeta__titulo">No voy ${esc(diaTxt(ev.fecha, hoy))}</h2>
      <p class="quieto" style="margin:-8px 0 0">${esc(rutina ? rutina.nombre : nombreEvento(ev))}</p>
      ${juntos ? `
        <p class="campo__etiqueta" style="margin:8px 0 4px">¿Quién no va?</p>
        <div class="chips" id="nv-quien">
          <button type="button" class="chip" data-quien="todos" aria-pressed="true">Nadie va</button>
          <button type="button" class="chip" data-quien="yo" aria-pressed="false">Solo yo no voy</button>
        </div>` : ''}
      ${rutina ? `
        <p class="campo__etiqueta" style="margin:12px 0 4px">¿Qué hacemos con la rutina?</p>
        <div class="pila" id="nv-que" style="gap:8px">
          ${libre ? `<button type="button" class="opcion-fila" data-que="pasar" aria-pressed="true"><strong>Pasarla ${esc(aDia(libre, hoy))}</strong><span>Está libre y cumple las reglas de descanso.</span></button>` : ''}
          ${corrida.cambios.length ? `<button type="button" class="opcion-fila" data-que="correr" aria-pressed="${libre ? 'false' : 'true'}"><strong>Correr la semana</strong><span>${esc(resumenCorrida)}${corrida.avisos.length ? ' · ⚠ queda pierna cerca del derby' : ''}</span></button>` : ''}
          <button type="button" class="opcion-fila" data-que="perder" aria-pressed="${!libre && !corrida.cambios.length ? 'true' : 'false'}"><strong>No se recupera</strong><span>La rutina sigue su orden la próxima vez.</span></button>
        </div>` : ''}
      <p class="ayuda" style="margin:10px 0 0">La meta de calorías de cada día se recalcula sola.</p>
      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
        <button type="button" class="boton" id="nv-ok">Listo</button>
      </div>
    </div>`, 'No voy');

  const elegir = (grupo, attr) => d.querySelectorAll(`${grupo} [${attr}]`).forEach((b) => b.addEventListener('click', () => {
    d.querySelectorAll(`${grupo} [${attr}]`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    if (grupo === '#nv-quien') {
      // «Solo yo» no corre la semana del hogar: solo se puede pasar mi rutina a otro día o dejarla.
      const correr = d.querySelector('[data-que="correr"]');
      if (correr) correr.hidden = b.dataset.quien === 'yo';
      if (correr?.hidden && correr.getAttribute('aria-pressed') === 'true') d.querySelector('[data-que="perder"]').click();
    }
  }));
  elegir('#nv-quien', 'data-quien');
  elegir('#nv-que', 'data-que');

  d.querySelector('#nv-ok').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true; b.textContent = 'Guardando…';
    const quien = d.querySelector('#nv-quien [aria-pressed="true"]')?.dataset.quien ?? 'todos';
    const que = d.querySelector('#nv-que [aria-pressed="true"]')?.dataset.que ?? 'perder';
    try {
      let texto;
      if (quien === 'yo') {
        // El evento queda para los demás; si es un hogar de dos, pasa a «solo» del otro.
        if (otros.length === 1) datos(await sb.from('calendario').update({ asistencia: 'solo', persona_id: otros[0].id }).eq('id', ev.id).select('id'));
        if (que === 'pasar' && libre) {
          datos(await sb.from('calendario').insert({ hogar_id: estado.yo.hogar_id, fecha: libre, tipo: ev.tipo, rutina_id: ev.rutina_id,
            hora_inicio: ev.hora_inicio, asistencia: 'solo', persona_id: yo }).select('id'));
          texto = `Tu ${rutina.nombre} pasó ${aDia(libre, hoy)}.`;
        } else texto = 'Listo: no vas, los demás sí.';
      } else if (que === 'pasar' && libre) {
        datos(await sb.from('calendario').update({ fecha: libre, omitido: false }).eq('id', ev.id).select('id'));
        texto = `${rutina.nombre} pasó ${aDia(libre, hoy)}.`;
      } else if (que === 'correr' && corrida.cambios.length) {
        for (const c of corrida.cambios) datos(await sb.from('calendario').update({ rutina_id: c.a }).eq('id', c.id).select('id'));
        datos(await sb.from('calendario').update({ omitido: true }).eq('id', ev.id).select('id'));
        texto = `Semana corrida: ${resumenCorrida}.`;
      } else {
        datos(await sb.from('calendario').update({ omitido: true }).eq('id', ev.id).select('id'));
        texto = rutina ? `Listo, ${diaTxt(ev.fecha, hoy)} no van. La rutina no se recupera.` : 'Listo, marcado como que no van.';
      }
      sb.from('cambios_plan').insert({ persona_id: yo, tipo: 'cambiar_dia', descripcion: texto.slice(0, 300), desde: ev.fecha, hasta: ev.fecha })
        .then(({ error }) => { if (error) console.warn('cambios_plan:', error.message); }, () => {});
      anotarSinIA('no_voy');
      d.close();
      aviso(texto);
      import('./nativo.js').then((m) => m.sincronizarAgenda?.().catch(() => {}));
      alListo();
    } catch (err) {
      avisoError(err);
      b.disabled = false; b.textContent = 'Listo';
    }
  });
}
