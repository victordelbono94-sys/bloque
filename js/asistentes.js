// Quién fue a un entreno individual (derby, otros): una fila por persona con lo que midió su reloj.
import { estado } from './db.js';
import { esc, cara } from './ui.js';
import { emparejar, asistenciaIndividual, esIndividual } from './actividades.js';
import { incluyeA } from './eventos.js';

const fechaLocal = (iso) => {
  const f = new Date(iso);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
};

/**
 * Para cada persona del evento: su entreno del reloj (si coincide) y si fue.
 * @param ev evento individual
 * @param delDia eventos de ese día (para emparejar bien si hay varios)
 * @param banda entrenos del reloj de todos ({ persona_id, tipo, inicio, fin, calorias, calorias_estimadas })
 * @param syncs { personaId: última sincronización }
 */
export function asistentes(ev, delDia, banda, syncs) {
  return estado.personas.filter((p) => incluyeA(ev, p.id)).map((p) => {
    const suyos = delDia.filter((e) => e.tipo !== 'descanso' && incluyeA(e, p.id));
    const bandaDia = banda.filter((s) => s.persona_id === p.id && fechaLocal(s.inicio) === ev.fecha);
    const sesion = emparejar(suyos, bandaDia).pares.get(ev) ?? null;
    return { p, sesion, estado: asistenciaIndividual(ev, sesion, syncs[p.id]) };
  });
}

export function htmlAsistentes(lista) {
  return `<div class="asisten">${lista.map(({ p, sesion, estado: e }) => {
    const nombre = p.id === estado.yo.id ? 'Yo' : p.nombre;
    const detalle = e === 'fue'
      ? `✓${sesion?.calorias != null ? ` ${sesion.calorias_estimadas ? '≈' : ''}${sesion.calorias} kcal` : ''}`
      : e === 'no_fue' ? 'No fue' : '';
    return `<span class="asiste asiste--${e}"><span class="asiste__cara" aria-hidden="true">${cara(p)}</span>${esc(nombre)}${detalle ? ` <strong>${esc(detalle)}</strong>` : ''}</span>`;
  }).join('')}</div>`;
}

export { esIndividual };
