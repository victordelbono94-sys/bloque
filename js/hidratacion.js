// Hidratación: cuánta agua conviene tomar hoy y cuánto llevas.
// Meta: 35 ml por kg de peso + ~0,8 ml por cada kcal de ejercicio (lo que se suda), con tope de 1,5 L extra.
// Cuenta lo que se registra a mano (vasos, botellas, en el entreno) y las bebidas de las comidas.
import { sb, estado, datos } from './db.js';
import { hoyISO } from './fechas.js';

// Bebidas que cuentan como líquido (gramos ≈ ml).
const LIQUIDO = /(\b(caldo|sopa|consom[eé]|crema de)\b)|^(agua|caf[eé]|t[eé]\b|t[eé] |infusi|aromática|leche|jugo|zumo|batido|smoothie|bebida|gaseosa|cola|soda|limonada|kombucha|isot[oó]nic|gatorade|powerade|electrol|caldo|sopa|colada|chocolate caliente|yogur bebible|prote[ií]na.*(batido|shake))/i;
export const esLiquido = (alimento) => LIQUIDO.test(alimento?.nombre ?? '');

export function metaAgua({ peso, ejercicioKcal = 0 }) {
  const base = peso ? peso * 35 : 2500;
  return Math.round((base + Math.min(1500, Math.max(0, ejercicioKcal) * 0.8)) / 50) * 50;
}

/** ml que tomó una persona en las comidas del día (lo propio + su parte de lo compartido). */
export function aguaDeComidas(comidas, personaId) {
  let ml = 0;
  for (const c of comidas) {
    const parte = c.porciones?.find((x) => x.persona_id === personaId);
    for (const it of c.comida_items ?? []) {
      if (!esLiquido(it.alimento)) continue;
      if (it.persona_id) { if (it.persona_id === personaId) ml += Number(it.gramos); }
      else if (parte) ml += Number(it.gramos) * Number(parte.fraccion ?? 1);
    }
  }
  return Math.round(ml);
}

export async function cargarAgua(fecha, ids) {
  return datos(await sb.from('hidratacion').select('*').in('persona_id', ids).eq('fecha', fecha).order('creado_en'));
}

export async function sumarAgua(ml, origen = 'manual', fecha = hoyISO()) {
  const ahora = new Date();
  return datos(await sb.from('hidratacion').insert({
    persona_id: estado.yo.id, fecha, ml, origen,
    hora: fecha === hoyISO() ? `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}` : null,
  }).select().single());
}

export async function borrarAgua(id) {
  datos(await sb.from('hidratacion').delete().eq('id', id));
}

export const litros = (ml) => `${(ml / 1000).toLocaleString('es-EC', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L`;
