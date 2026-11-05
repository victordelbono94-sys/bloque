// Alimentos: el catálogo (base + los del hogar), Open Food Facts (gratis, con muchos
// productos de Ecuador) y el cálculo de macros por gramos.
import { sb, estado, datos } from './db.js';

let catalogo = null;
const normal = (t) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Catálogo grande por país: viaja con la app (js/catalogo/*.json), así busca al instante y sin conexión.
// Se genera con supabase/catalogo/generar.py. Al elegir uno, se guarda en el hogar (guardarAlimento).
let estaticos = null;
async function cargarEstaticos() {
  if (estaticos) return estaticos;
  const pais = String(estado.equipo?.pais ?? 'EC').toUpperCase();
  const leer = (f) => fetch(new URL(`./catalogo/${f}.json`, import.meta.url)).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const [universal, delPais] = await Promise.all([leer('universal'), /^[A-Z]{2}$/.test(pais) ? leer(pais) : []]);
  estaticos = [...delPais, ...universal];
  return estaticos;
}

export async function cargarCatalogo(forzar = false) {
  if (catalogo && !forzar) return catalogo;
  const [deLaBase, delPais] = await Promise.all([
    sb.from('alimentos').select('*').order('nombre').then(datos),
    cargarEstaticos(),
  ]);
  // Lo que ya está en la base manda (tiene id y puede tener datos del hogar); del catálogo del país se suman
  // las porciones y sinónimos que le falten, y se agrega lo que todavía no está.
  const porNombre = new Map(deLaBase.map((a) => [normal(a.nombre), a]));
  const extra = [];
  for (const e of delPais) {
    const ya = porNombre.get(normal(e.nombre));
    if (ya) {
      if (!ya.porciones?.length) ya.porciones = e.porciones;
      if (!ya.sinonimos) ya.sinonimos = e.sinonimos;
    } else extra.push({ ...e });
  }
  catalogo = [...deLaBase, ...extra];
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
  const q = palabras.join(' ');
  const puntaje = (a) => {
    const n = normal(a.nombre);
    return (a.hogar_id ? 0 : 1) // lo que ya usaron en el hogar, primero
      + (n.startsWith(q) ? 0 : n.includes(q) ? 1 : 2) // después, lo que empieza igual
      + n.length / 1000;
  };
  return lista
    .filter((a) => { const t = normal(`${a.nombre} ${a.marca ?? ''} ${a.sinonimos ?? ''}`); return palabras.every((p) => t.includes(p)); })
    .sort((a, b) => puntaje(a) - puntaje(b))
    .slice(0, 20);
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
  // Del catálogo del país: si el hogar ya lo guardó antes, se usa ese (no se duplica).
  if (!a.codigo_barras) {
    const ya = (await cargarCatalogo()).find((x) => x.id && x.hogar_id === estado.yo.hogar_id && normal(x.nombre) === normal(a.nombre));
    if (ya) return ya;
  }
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
  if (catalogo) {
    // El que estaba sin guardar (del catálogo del país) se reemplaza por el guardado.
    const i = catalogo.findIndex((x) => !x.id && normal(x.nombre) === normal(data.nombre));
    if (i >= 0) catalogo.splice(i, 1, data); else catalogo.push(data);
  }
  return data;
}
