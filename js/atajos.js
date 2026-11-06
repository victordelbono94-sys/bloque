// Atajos sin IA: lo simple se entiende en el teléfono, al instante y sin gastar consultas.
// - leerMedicion("peso 66,4", "66 kg", "grasa 12 %") → { peso_kg, grasa_pct, ... }
// - leerAgua("tomé 500 ml", "un vaso de agua", "1,5 litros") → ml
// - Mis platos: guardar un plato (lo que la IA calculó o lo que se armó a mano) y encontrarlo por su nombre.
import { sb, estado, datos } from './db.js';

const n = (t) => Number(String(t).replace(',', '.'));
export const normal = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Palabras que pueden acompañar un dato sin cambiar el sentido («hoy peso 66», «mi peso es de 66 kg»).
const RELLENO = /\b(hoy|ahora|ayer|mi|me|es|son|de|del|la|el|en|y|con|estoy|amaneci|pese|peso|pesé|pesando|kg|kilos?|%|por|ciento|grasa|musculo|músculo|agua|corporal|masa|muscular)\b/gi;

/** Medición simple escrita (sin foto). Devuelve null si el texto dice algo más que números de peso o composición. */
export function leerMedicion(texto) {
  const t = ` ${String(texto).toLowerCase()} `;
  const m = {};
  const peso = t.match(/(?:peso|pes[eé]|pesando|amanec[ií](?:\s+con)?)\s*(?:es\s*)?(?:de\s*)?(\d{2,3}(?:[.,]\d{1,2})?)/) ?? t.match(/^\s*(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:kg|kilos?)?\s*$/);
  if (peso) m.peso_kg = n(peso[1]);
  const grasa = t.match(/grasa\s*(?:corporal\s*)?(?:es\s*)?(?:de\s*)?(\d{1,2}(?:[.,]\d)?)\s*%?/) ?? t.match(/(\d{1,2}(?:[.,]\d)?)\s*%\s*(?:de\s*)?grasa/);
  if (grasa) m.grasa_pct = n(grasa[1]);
  const musc = t.match(/m[uú]sculo\s*(?:esquel[eé]tico\s*)?(?:es\s*)?(?:de\s*)?(\d{2}(?:[.,]\d{1,2})?)/);
  if (musc) m.musculo_esqueletico_kg = n(musc[1]);
  const agua = t.match(/agua\s*(?:corporal\s*)?(?:es\s*)?(?:de\s*)?(\d{2}(?:[.,]\d)?)\s*%/);
  if (agua) m.agua_pct = n(agua[1]);
  if (!Object.keys(m).length) return null;
  // Rangos razonables; si algo queda afuera, mejor que lo mire la IA.
  if (m.peso_kg != null && !(m.peso_kg >= 30 && m.peso_kg <= 250)) return null;
  if (m.grasa_pct != null && !(m.grasa_pct >= 2 && m.grasa_pct <= 65)) return null;
  if (m.musculo_esqueletico_kg != null && !(m.musculo_esqueletico_kg >= 10 && m.musculo_esqueletico_kg <= 80)) return null;
  if (m.agua_pct != null && !(m.agua_pct >= 30 && m.agua_pct <= 80)) return null;
  // Lo que sobra después de quitar números y palabras de relleno tiene que ser casi nada.
  const resto = t.replace(/\d+(?:[.,]\d+)?/g, ' ').replace(RELLENO, ' ').replace(/[^a-zñáéíóú]+/g, ' ').trim();
  if (resto.length > 3) return null;
  return { ...m, origen: 'manual' };
}

/** Agua escrita («tomé 500 ml», «2 vasos de agua», «1,5 l de agua»). Devuelve ml o null. */
export function leerAgua(texto) {
  // Sin tildes pero con la coma decimal («1,5 litros»).
  const t = String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9ñ.,% ]+/g, ' ').trim();
  if (!/\bagua\b|\bml\b|\blitros?\b|\bvasos?\b|\bbotellas?\b/.test(t)) return null;
  if (/\b(cafe|jugo|leche|te|batido|cola|cerveza|gaseosa|colada)\b/.test(t)) return null; // otras bebidas: van como comida
  let ml = null;
  const mlM = t.match(/(\d+(?:[.,]\d+)?)\s*ml\b/); if (mlM) ml = n(mlM[1]);
  const lM = t.match(/(\d+(?:[.,]\d+)?)\s*(?:l|lt|litros?)\b/); if (!ml && lM) ml = n(lM[1]) * 1000;
  const cant = (re, por) => { const x = t.match(re); return x ? (x[1] ? (x[1] === 'un' || x[1] === 'una' ? 1 : n(x[1])) : 1) * por : null; };
  if (!ml) ml = cant(/(\d+|un|una)?\s*vasos?\b/, 250) ?? cant(/(\d+|un|una)?\s*botellas?\b/, 500);
  if (!ml || ml < 50 || ml > 5000) return null;
  const resto = t.replace(/\d+(?:[.,]\d+)?/g, ' ').replace(/[.,]/g, ' ')
    .replace(/\b(tome|me tome|tomamos|bebi|agua|ml|l|lt|litros?|vasos?|botellas?|de|un|una|y|hoy|en|el|la|gym|entreno|medio)\b/g, ' ').trim();
  return resto.length > 3 ? null : Math.round(ml);
}

// ---------- Mis platos ----------
let cache = null;
export async function misPlatos(forzar = false) {
  if (cache && !forzar) return cache;
  try {
    cache = datos(await sb.from('platos').select('*').eq('hogar_id', estado.yo.hogar_id).order('usado_en', { ascending: false }).limit(200));
  } catch { cache = []; }
  return cache;
}

/** Busca un plato guardado que coincida con lo escrito («arroz con menestra», «el desayuno de siempre»). */
export async function buscarPlato(texto) {
  const t = normal(texto).replace(/\b(comi|comimos|desayune|almorce|cene|de|el|la|un|una|lo|mismo|que|hoy|ayer)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length < 4) return null;
  const lista = await misPlatos();
  return lista.find((p) => p.clave === t) ?? lista.find((p) => t.length >= 6 && (p.clave.includes(t) || t.includes(p.clave))) ?? null;
}

/**
 * Guarda (o actualiza) un plato del hogar. items: [{ nombre, gramos, kcal, proteina_g, carbohidratos_g, grasas_g, alimento_id? }]
 * con los valores por 100 g, para UNA porción de una persona.
 */
export async function guardarPlato(nombre, items, { momento = null, origen = 'ia' } = {}) {
  const clave = normal(nombre);
  if (!clave || !items?.length) return null;
  const fila = { hogar_id: estado.yo.hogar_id, nombre: String(nombre).slice(0, 80), clave, items, momento, origen, creado_por: estado.yo.id, usado_en: new Date().toISOString() };
  try {
    const previo = (await misPlatos()).find((p) => p.clave === clave);
    // Lo corregido a mano manda: un plato manual no se pisa con lo que calcule la IA.
    if (previo?.origen === 'manual' && origen === 'ia') return previo;
    const r = previo
      ? datos(await sb.from('platos').update({ ...fila, veces: (previo.veces ?? 1) + 1 }).eq('id', previo.id).select().single())
      : datos(await sb.from('platos').insert(fila).select().single());
    cache = null;
    return r;
  } catch (e) { console.warn('platos:', e?.message); return null; }
}

/** Marca un plato como usado (sube en la lista). */
export function usarPlato(p) {
  sb.from('platos').update({ usado_en: new Date().toISOString(), veces: (p.veces ?? 1) + 1 }).eq('id', p.id)
    .then(({ error }) => { if (error) console.warn('platos:', error.message); }, () => {});
  cache = null;
}

/** Mis platos: revisar, corregir gramos, renombrar o borrar. Lo que se corrige a mano queda como «manual» y la IA no lo pisa. */
export async function dialogoMisPlatos(alCambiar = () => {}) {
  const { esc, aviso, avisoError, abrirDialogo } = await import('./ui.js');
  const lista = await misPlatos(true);
  const kcal = (p) => Math.round(p.items.reduce((a, i) => a + (Number(i.kcal) || 0) * (Number(i.gramos) || 0) / 100, 0));
  const d = abrirDialogo(`
    <div class="dialogo">
      <h2 class="tarjeta__titulo">Mis platos</h2>
      <p class="quieto" style="margin:-6px 0 0">Se registran con un toque y sin IA. Los gramos son de tu porción.</p>
      <div class="pila" id="mp-lista" style="gap:10px">
        ${lista.length ? lista.map((p, k) => `
          <details class="mp" data-k="${k}">
            <summary><strong>${esc(p.nombre)}</strong><span class="quieto"> · ${kcal(p)} kcal${p.origen === 'manual' ? ' · corregido' : ''}</span></summary>
            <label class="campo"><span class="campo__etiqueta">Nombre</span><input type="text" data-nombre value="${esc(p.nombre)}" maxlength="80"></label>
            ${p.items.map((i, j) => `<label class="mp__item"><span>${esc(i.nombre)}</span><input type="number" inputmode="decimal" min="0" step="5" data-g="${j}" value="${Math.round(Number(i.gramos) || 0)}"> g</label>`).join('')}
            <div class="fila fila--entre" style="margin-top:8px">
              <button type="button" class="boton boton--texto boton--chico" data-borrar style="color:var(--error)">Borrar</button>
              <button type="button" class="boton boton--chico" data-guardar>Guardar</button>
            </div>
          </details>`).join('') : '<p class="quieto">Todavía no hay platos. Se guardan solos cuando registras una comida con la IA.</p>'}
      </div>
      <div class="dialogo__pie"><button type="button" class="boton boton--sec" data-cerrar>Cerrar</button></div>
    </div>`, 'Mis platos');
  d.querySelectorAll('.mp').forEach((el) => {
    const p = lista[Number(el.dataset.k)];
    el.querySelector('[data-guardar]').addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true;
      const nombre = el.querySelector('[data-nombre]').value.trim() || p.nombre;
      const items = p.items.map((i, j) => ({ ...i, gramos: Math.max(0, Number(el.querySelector(`[data-g="${j}"]`).value) || 0) })).filter((i) => i.gramos > 0);
      try {
        datos(await sb.from('platos').update({ nombre, clave: normal(nombre), items, origen: 'manual' }).eq('id', p.id).select('id'));
        cache = null; aviso('Plato guardado.'); alCambiar();
        el.querySelector('summary .quieto').textContent = ` · ${kcal({ items })} kcal · corregido`;
      } catch (err) { avisoError(err); }
      b.disabled = false;
    });
    el.querySelector('[data-borrar]').addEventListener('click', async () => {
      try {
        datos(await sb.from('platos').delete().eq('id', p.id).select('id'));
        cache = null; el.remove(); aviso('Plato borrado.'); alCambiar();
      } catch (err) { avisoError(err); }
    });
  });
}
