// Datos de rutinas: ejercicios en orden, metas de cada persona y alternativas.
import { sb, datos } from './db.js';
import { num } from './ui.js';

export const FOCOS = {
  masa_muscular: 'Masa muscular',
  perder_grasa: 'Perder grasa',
  cardio: 'Cardio',
  fuerza: 'Fuerza',
  recuperacion: 'Liviano · día de derby',
  mixto: 'Mixto',
};

export async function cargarRutina(rutinaId) {
  const rutina = datos(await sb.from('rutinas').select('*').eq('id', rutinaId).single());
  const items = datos(await sb.from('rutina_ejercicios')
    .select('id, orden, series_base, reps_base, descanso_base, ejercicio:ejercicios(id, nombre, grupo_muscular, unidad, descripcion, maquina:maquinas(id, nombre))')
    .eq('rutina_id', rutinaId).order('orden'));
  const ids = items.map((i) => i.id);
  const ejIds = items.map((i) => i.ejercicio.id);

  const [metas, pares] = await Promise.all([
    ids.length ? sb.from('metas_ejercicio').select('*').in('rutina_ejercicio_id', ids).then(datos) : [],
    ejIds.length ? sb.from('ejercicio_alternativas').select('ejercicio_id, alternativa_id').in('ejercicio_id', ejIds).then(datos) : [],
  ]);
  const altIds = [...new Set(pares.map((p) => p.alternativa_id))];
  const alts = altIds.length
    ? datos(await sb.from('ejercicios').select('id, nombre, grupo_muscular, unidad, descripcion, maquina:maquinas(id, nombre)').in('id', altIds))
    : [];

  for (const it of items) {
    it.metas = Object.fromEntries(metas.filter((m) => m.rutina_ejercicio_id === it.id).map((m) => [m.persona_id, m]));
    it.alternativas = pares
      .filter((p) => p.ejercicio_id === it.ejercicio.id)
      .map((p) => alts.find((a) => a.id === p.alternativa_id))
      .filter(Boolean);
  }
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
