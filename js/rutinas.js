// Datos de rutinas: ejercicios en orden, metas de cada persona y alternativas.
import { sb, datos } from './db.js';
import { num } from './ui.js';
import { zonasDe } from './iconos.js';
import { hoyISO } from './fechas.js';
import { variarRutina, alternativasDe } from './variacion.js';

export const FOCOS = {
  masa_muscular: 'Masa muscular',
  perder_grasa: 'Perder grasa',
  cardio: 'Cardio',
  fuerza: 'Fuerza',
  recuperacion: 'Liviano · día de derby',
  mixto: 'Mixto',
};

const CAMPOS_EJERCICIO = 'id, nombre, grupo_muscular, unidad, por_lado, descripcion, imagenes, tecnica, video_url, maquina:maquinas(id, nombre)';

/**
 * Rutina con sus ejercicios. Con `fecha`, los ejercicios ya vienen variados para esa semana
 * (básicos fijos 4 semanas, accesorios que rotan cada semana; ver variacion.js).
 * `variar: false` devuelve la rutina tal como está guardada (para editarla).
 */
export async function cargarRutina(rutinaId, { fecha = hoyISO(), variar = true } = {}) {
  const rutina = datos(await sb.from('rutinas').select('*').eq('id', rutinaId).single());
  const guardados = datos(await sb.from('rutina_ejercicios')
    .select(`id, orden, series_base, reps_base, descanso_base, ejercicio:ejercicios(${CAMPOS_EJERCICIO})`)
    .eq('rutina_id', rutinaId).order('orden'));
  const catalogo = variar ? datos(await sb.from('ejercicios').select(CAMPOS_EJERCICIO).eq('hogar_id', rutina.hogar_id)) : [];
  const ids = guardados.map((i) => i.id);
  const ejIds = guardados.map((i) => i.ejercicio.id);

  const [metas, pares] = await Promise.all([
    ids.length ? sb.from('metas_ejercicio').select('*').in('rutina_ejercicio_id', ids).then(datos) : [],
    ejIds.length ? sb.from('ejercicio_alternativas').select('ejercicio_id, alternativa_id').in('ejercicio_id', ejIds).then(datos) : [],
  ]);
  const altIds = [...new Set(pares.map((p) => p.alternativa_id))];
  const alts = altIds.length
    ? datos(await sb.from('ejercicios').select('id, nombre, grupo_muscular, unidad, por_lado, descripcion, imagenes, tecnica, video_url, maquina:maquinas(id, nombre)').in('id', altIds))
    : [];

  for (const it of guardados) {
    it.metas = Object.fromEntries(metas.filter((m) => m.rutina_ejercicio_id === it.id).map((m) => [m.persona_id, m]));
    it.alternativas = pares
      .filter((p) => p.ejercicio_id === it.ejercicio.id)
      .map((p) => alts.find((a) => a.id === p.alternativa_id))
      .filter(Boolean);
  }
  if (!variar) return { rutina, items: guardados };
  const items = variarRutina(guardados, catalogo, fecha);
  // «¿Ocupada? Cámbiala por»: siempre del mismo músculo y movimiento, sin repetir lo que ya está en la rutina.
  for (const it of items) it.alternativas = alternativasDe(it, items, catalogo, it.alternativas);
  return { rutina, items };
}

// "4 × 8 · 60 kg" o "3 × 40 s"
export function textoMeta(meta, unidad) {
  if (!meta) return 'Sin meta';
  const cantidad = unidad === 'segundos' ? `${meta.series} × ${meta.reps} s` : `${meta.series} × ${meta.reps}`;
  const peso = meta.peso_kg != null ? ` · ${num(meta.peso_kg, meta.peso_kg % 1 ? 1 : 0)} kg` : '';
  return cantidad + peso;
}

export function textoDescanso(seg) {
  if (!seg) return 'sin descanso';
  const m = Math.floor(seg / 60), s = seg % 60;
  return m ? `${m}:${String(s).padStart(2, '0')} min` : `${s} s`;
}

// Redondea al múltiplo de 2,5 kg más cercano (lo que permiten los discos y las máquinas).
export function redondearPeso(kg) {
  return Math.max(0, Math.round(kg / 2.5) * 2.5);
}

// Zonas del cuerpo y cantidad de ejercicios de cada rutina (para el mapa y las etiquetas).
export async function resumenRutinas(rutinaIds) {
  if (!rutinaIds.length) return {};
  const filas = datos(await sb.from('rutina_ejercicios')
    .select('rutina_id, ejercicio:ejercicios(grupo_muscular)').in('rutina_id', rutinaIds));
  const res = {};
  for (const id of rutinaIds) {
    const propias = filas.filter((f) => f.rutina_id === id);
    res[id] = { cuantos: propias.length, zonas: zonasDe(propias.map((f) => f.ejercicio?.grupo_muscular)) };
  }
  return res;
}
