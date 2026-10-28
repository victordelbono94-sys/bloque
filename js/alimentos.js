// Alimentos: el catálogo (base + los del hogar), Open Food Facts (gratis, con muchos
// productos de Ecuador) y el cálculo de macros por gramos.
import { sb, estado, datos } from './db.js';

let catalogo = null;
const normal = (t) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export async function cargarCatalogo(forzar = false) {
  if (catalogo && !forzar) return catalogo;
  catalogo = datos(await sb.from('alimentos').select('*').order('nombre'));
  return catalogo;
}

/** Macros de una cantidad de un alimento (valores por 100 g). */
export function macros(a, gramos) {
  const f = (Number(gramos) || 0) / 100;
  return {
    kcal: Number(a.kcal) * f,
    proteina: Number(a.proteina_g) * f,
    carbos: Number(a.carbohidratos_g) * f,
    grasas: Number(a.grasas_g) * f,
  };
}

export function sumar(lista) {
  return lista.reduce((t, m) => ({ kcal: t.kcal + m.kcal, proteina: t.proteina + m.proteina, carbos: t.carbos + m.carbos, grasas: t.grasas + m.grasas }),
    { kcal: 0, proteina: 0, carbos: 0, grasas: 0 });
}

/** Busca en el catálogo: todas las palabras tienen que aparecer, sin importar tildes. */
export async function buscarEnCatalogo(texto) {
  const palabras = normal(texto).split(/\s+/).filter(Boolean);
  if (!palabras.length) return [];
  const lista = await cargarCatalogo();
  return lista
    .filter((a) => { const t = normal(`${a.nombre} ${a.marca ?? ''}`); return palabras.every((p) => t.includes(p)); })
    .sort((a, b) => (b.hogar_id ? 1 : 0) - (a.hogar_id ? 1 : 0) || a.nombre.length - b.nombre.length)
    .slice(0, 12);
}

// ---------- Open Food Facts ----------
const CAMPOS = 'code,product_name,product_name_es,brands,nutriments,product_quantity,serving_quantity,quantity';

function deOFF(p) {
  const n = p.nutriments ?? {};
  const kcal = n['energy-kcal_100g'] ?? (n['energy_100g'] != null ? n['energy_100g'] / 4.184 : null);
  const nombre = (p.product_name_es || p.product_name || '').trim();
  if (kcal == null || !nombre) return null;
  const num = (v) => (v == null || Number.isNaN(Number(v)) ? 0 : Math.min(100, Math.max(0, Number(v))));
  return {
    nombre: nombre.slice(0, 120),
    marca: (p.brands ?? '').split(',')[0].trim().slice(0, 80) || null,
    codigo_barras: /^[0-9]{6,14}$/.test(p.code ?? '') ? p.code : null,
    kcal: Math.round(Math.min(950, kcal) * 10) / 10,
    proteina_g: num(n.proteins_100g),
    carbohidratos_g: num(n.carbohydrates_100g),
    grasas_g: num(n.fat_100g),
    fibra_g: n.fiber_100g != null ? num(n.fiber_100g) : null,
    paquete_g: Number(p.product_quantity) > 0 ? Number(p.product_quantity) : null,
    porcion_g: Number(p.serving_quantity) > 0 ? Number(p.serving_quantity) : null,
    porcion_nombre: Number(p.serving_quantity) > 0 ? '1 porción' : null,
    origen: 'openfoodfacts',
  };
}

export async function buscarEnOFF(texto) {
  const q = encodeURIComponent(texto.trim());
  const url = (pais) => `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1&page_size=15&fields=${CAMPOS}${pais ? '&tagtype_0=countries&tag_contains_0=contains&tag_0=ecuador' : ''}`;
  const leer = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error('Open Food Facts no responde.'); return (await r.json()).products ?? []; };
  let productos = await leer(url(true));
  if (productos.length < 4) productos = productos.concat(await leer(url(false)));
  const vistos = new Set();
  return productos.map(deOFF).filter((a) => a && !vistos.has(a.codigo_barras ?? a.nombre) && vistos.add(a.codigo_barras ?? a.nombre)).slice(0, 12);
}

/** Por código de barras: primero lo guardado en el hogar, después Open Food Facts. */
export async function porCodigo(codigo) {
  const lista = await cargarCatalogo();
  const propio = lista.find((a) => a.codigo_barras === codigo);
  if (propio) return propio;
  const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(codigo)}?fields=${CAMPOS}`);
  if (!r.ok) return null;
  const j = await r.json();
  return j.status === 1 ? deOFF({ ...j.product, code: codigo }) : null;
}

/** Guarda en el catálogo del hogar un alimento que todavía no tiene id (de Open Food Facts o a mano). */
export async function guardarAlimento(a) {
  if (a.id) return a;
  const fila = { ...a, hogar_id: estado.yo.hogar_id };
  const { data, error } = await sb.from('alimentos').insert(fila).select().single();
  if (error) {
    // Ya estaba guardado con ese código: se usa el existente.
    if (error.code === '23505' && a.codigo_barras) {
      const ya = datos(await sb.from('alimentos').select('*').eq('hogar_id', estado.yo.hogar_id).eq('codigo_barras', a.codigo_barras).single());
      return ya;
    }
    throw error;
  }
  catalogo?.push(data);
  return data;
}
