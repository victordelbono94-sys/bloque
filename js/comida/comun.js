// Lo que comparten las partes de Comida: Gemini, cantidades legibles, guardar y borrar comidas.
import { sb, estado, datos } from '../db.js';
import { buscarEnCatalogo, guardarAlimento, cargarCatalogo, macros, sumar } from '../alimentos.js';

export const MOMENTOS = {
  desayuno: 'Desayuno', almuerzo: 'Almuerzo', merienda: 'Merienda', cena: 'Cena', snack: 'Snack',
  pre_entreno: 'Antes de entrenar', post_entreno: 'Después de entrenar',
};
export const ORDEN_MOMENTO = ['desayuno', 'snack', 'almuerzo', 'merienda', 'pre_entreno', 'post_entreno', 'cena'];
export const kc = (n) => Math.round(n).toLocaleString('es-EC');
export const g = (n) => `${Math.round(n)} g`;
export const normalizar = (t) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Por la hora: desayuno hasta 10:30, snack de media mañana hasta 12:00, almuerzo hasta 15:30,
// merienda hasta 18:30, cena hasta 23:00 y snack de noche después.
export function momentoPorHora(d = new Date()) {
  const m = d.getHours() * 60 + d.getMinutes();
  if (m >= 300 && m < 630) return 'desayuno';
  if (m >= 630 && m < 720) return 'snack';
  if (m >= 720 && m < 930) return 'almuerzo';
  if (m >= 930 && m < 1110) return 'merienda';
  // La cena va de 18:30 hasta las 2:00 (si comes tarde, sigue siendo la cena); de madrugada, snack.
  if (m >= 1110 || m < 120) return 'cena';
  return 'snack';
}

const DURACION = { derby: 120, gym: 60, otro: 60, clase: 60 };

/**
 * Momento sugerido: la hora, pero si falta poco para entrenar (hasta 90 min) es «antes de entrenar»
 * y si acaba de terminar (hasta 2 h) es «después de entrenar».
 */
export function momentoSugerido(eventos = [], d = new Date()) {
  const ahora = d.getHours() * 60 + d.getMinutes();
  for (const e of eventos) {
    // Solo con hora cargada: sin hora no sabemos si ya entrenaron.
    if (!DURACION[e.tipo] || !e.hora_inicio || (e.tipo === 'otro' && ['caminar', 'yoga'].includes(e.actividad))) continue;
    const [h, mm] = e.hora_inicio.slice(0, 5).split(':').map(Number);
    const inicio = h * 60 + mm, fin = inicio + DURACION[e.tipo];
    if (ahora >= inicio - 90 && ahora < inicio) return 'pre_entreno';
    if (ahora >= fin && ahora <= fin + 120) return 'post_entreno';
  }
  return momentoPorHora(d);
}

// ---------- Cantidades legibles: "3 huevos", "1 taza", "200 g" ----------
function plural(palabras) {
  const [p, ...resto] = palabras.split(' ');
  const sinTilde = p.replace(/ón$/, 'on').replace(/án$/, 'an').replace(/én$/, 'en').replace(/ín$/, 'in').replace(/ún$/, 'un');
  const pl = /[aeiouáéóp]$/i.test(p) ? `${p}s` : /z$/i.test(p) ? `${p.slice(0, -1)}ces` : `${sinTilde}es`;
  return [pl, ...resto].join(' ');
}
export function cantidadTexto(a, gramos) {
  const m = /^1\s+(.+)$/.exec(a?.porcion_nombre ?? '');
  if (m && /^porci[oó]n$/i.test(m[1])) return g(gramos); // "1 porción" no dice nada: mejor en gramos
  if (m && Number(a.porcion_g) > 0) {
    const n = gramos / Number(a.porcion_g);
    const medio = Math.round(n * 2) / 2;
    if (n >= 0.5 && n <= 60 && Math.abs(n - medio) < 0.06) {
      const t = medio === 1 ? m[1] : plural(m[1]);
      return `${String(medio).replace('.', ',')} ${t}`;
    }
  }
  return g(gramos);
}

// ---------- Gemini (función analizar-comida en el servidor) ----------
export async function gemini(modo, cuerpo) {
  // Tope de espera: si Gemini no contesta en 70 s, se avisa en vez de quedarse trabado.
  const espera = new Promise((_, no) => setTimeout(() => no(new Error('La IA tardó demasiado. Prueba de nuevo o búscalo a mano.')), 70000));
  const { data, error } = await Promise.race([sb.functions.invoke('analizar-comida', { body: { modo, ...cuerpo } }), espera]);
  if (error) {
    let codigo = null;
    try { codigo = (await error.context?.json?.())?.error; } catch { /* sin detalle */ }
    throw new Error({
      sin_clave: 'La IA no está disponible.',
      limite: 'La IA llegó al límite gratis por ahora. Prueba en un minuto.',
      imagen: 'La foto es muy pesada o no se pudo leer.',
      texto: 'Escribe qué comiste.',
      gemini: 'La IA está saturada en este momento. Prueba en un rato o búscalo a mano.',
      sesion: 'Tu sesión se venció: vuelve a entrar a Bloq.',
    }[codigo] ?? 'No se pudo conectar con la IA. Revisa la conexión.');
  }
  return data;
}

/** Achica una foto a 1024 px y la devuelve en base64 (JPEG). */
export async function fotoBase64(archivo) {
  const imagen = await createImageBitmap(archivo);
  const escala = Math.min(1, 1024 / Math.max(imagen.width, imagen.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(imagen.width * escala);
  lienzo.height = Math.round(imagen.height * escala);
  lienzo.getContext('2d').drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  return lienzo.toDataURL('image/jpeg', 0.82).split(',')[1];
}

/**
 * Convierte lo que devolvió Gemini en un alimento del catálogo: si ya existe uno con el
 * mismo nombre (base, de una foto anterior o del hogar), se usa ese; si no, se guarda.
 */
export async function aAlimento(x) {
  const lista = await cargarCatalogo();
  const n = normalizar(x.nombre);
  const igual = lista.find((a) => normalizar(a.nombre) === n)
    ?? (await buscarEnCatalogo(x.nombre)).find((a) => normalizar(a.nombre).startsWith(n) || n.startsWith(normalizar(a.nombre)));
  if (igual) return igual;
  return guardarAlimento({
    nombre: x.nombre, marca: x.marca ?? null, kcal: x.kcal, proteina_g: x.proteina_g,
    carbohidratos_g: x.carbohidratos_g, grasas_g: x.grasas_g, origen: 'gemini',
  });
}

// ---------- Lo más registrado (para agregar con un toque) ----------
const BASICOS = [['Café negro', 240], ['Leche entera', 250], ['Huevo entero', 100], ['Banana (guineo)', 120],
  ['Pan blanco', 50], ['Yogur griego natural', 170], ['Proteína whey (polvo)', 30], ['Arroz blanco cocido', 160]];

// Qué parte de la meta del día le toca a cada comida (para decir si un desayuno «está bien»).
export const PARTE_COMIDA = {
  desayuno: 0.25, almuerzo: 0.33, merienda: 0.12, cena: 0.25, snack: 0.08, pre_entreno: 0.08, post_entreno: 0.12,
};

/**
 * Lo que sueles comer a esta hora (±90 min, últimos 30 días), del más repetido al menos.
 * @returns {Promise<Array<{alimento, gramos, veces}>>}
 */
export async function habitualesAhora(hasta = 6, ahora = new Date()) {
  const desde = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const filas = datos(await sb.from('comida_items').select('gramos, persona_id, alimento:alimentos(*), comida:comidas!inner(fecha, hora, hogar_id)')
    .eq('comida.hogar_id', estado.yo.hogar_id).gte('comida.fecha', desde).not('comida.hora', 'is', null).limit(600));
  const min = ahora.getHours() * 60 + ahora.getMinutes();
  const porAlimento = new Map();
  for (const f of filas) {
    if (!f.alimento || (f.persona_id && f.persona_id !== estado.yo.id)) continue;
    const [h, m] = f.comida.hora.slice(0, 5).split(':').map(Number);
    const dif = Math.abs(h * 60 + m - min);
    if (Math.min(dif, 1440 - dif) > 90) continue;
    const x = porAlimento.get(f.alimento.id) ?? { alimento: f.alimento, veces: 0, gramos: [] };
    x.veces++; x.gramos.push(Number(f.gramos));
    porAlimento.set(f.alimento.id, x);
  }
  return [...porAlimento.values()].sort((a, b) => b.veces - a.veces).slice(0, hasta).map((x) => {
    const gs = x.gramos.sort((a, b) => a - b);
    return { alimento: x.alimento, gramos: gs[Math.floor(gs.length / 2)], veces: x.veces };
  });
}

export async function frecuentes(hasta = 10) {
  const desde = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const filas = datos(await sb.from('comida_items').select('gramos, alimento:alimentos(*), comida:comidas!inner(fecha, hogar_id)')
    .eq('comida.hogar_id', estado.yo.hogar_id).gte('comida.fecha', desde).limit(400));
  const porAlimento = new Map();
  for (const f of filas) {
    if (!f.alimento) continue;
    const x = porAlimento.get(f.alimento.id) ?? { alimento: f.alimento, veces: 0, gramos: [] };
    x.veces++; x.gramos.push(Number(f.gramos));
    porAlimento.set(f.alimento.id, x);
  }
  const lista = [...porAlimento.values()].sort((a, b) => b.veces - a.veces).map((x) => {
    const gs = x.gramos.sort((a, b) => a - b);
    return { alimento: x.alimento, gramos: gs[Math.floor(gs.length / 2)] };
  });
  // Completa con básicos si todavía hay pocos registros.
  if (lista.length < hasta) {
    const cat = await cargarCatalogo();
    for (const [nombre, gramos] of BASICOS) {
      const a = cat.find((x) => x.nombre === nombre && !x.hogar_id);
      if (a && !lista.some((x) => x.alimento.id === a.id)) lista.push({ alimento: a, gramos });
    }
  }
  return lista.slice(0, hasta);
}

// ---------- Guardar, editar y borrar ----------

/** Borra una comida y devuelve a la despensa lo que había salido de ella. */
export async function borrarComida(c) {
  for (const i of (c.comida_items ?? []).filter((x) => x.despensa_id)) {
    const p = datos(await sb.from('despensa').select('gramos_restantes, gramos_total').eq('id', i.despensa_id).maybeSingle());
    if (p) {
      await sb.from('despensa').update({
        gramos_restantes: Math.min(Number(p.gramos_total), Number(p.gramos_restantes) + Number(i.gramos)), terminado_en: null,
      }).eq('id', i.despensa_id);
    }
  }
  datos(await sb.from('comidas').delete().eq('id', c.id));
}

/**
 * Guarda una comida (nueva o editada). Editar = borrar la anterior (devolviendo la
 * despensa) y guardarla de nuevo, conservando fecha y hora.
 * @param {{ anterior?, fecha, hora, momento, descripcion, items: Array<{alimento, gramos, paquete?}>, fracciones: Array<[personaId, fraccion]> }} c
 */
export async function guardarComida(c) {
  if (c.anterior) {
    // La despensa se vuelve a leer después de devolver lo usado, para descontar bien.
    await borrarComida(c.anterior);
  }
  const comida = datos(await sb.from('comidas').insert({
    hogar_id: estado.yo.hogar_id, fecha: c.fecha, momento: c.momento, hora: c.hora,
    descripcion: c.descripcion || null, creada_por: estado.yo.id,
  }).select('id').single());
  datos(await sb.from('comida_items').insert(c.items.map((it) => ({
    comida_id: comida.id, alimento_id: it.alimento.id, gramos: Math.round(it.gramos * 10) / 10, despensa_id: it.paquete?.id ?? null,
    persona_id: it.persona ?? null,
  }))));
  const total = sumar(c.items.map((it) => macros(it.alimento, it.gramos)));
  // Cada uno: lo suyo + su parte (fracción) de lo compartido.
  const compartido = sumar(c.items.filter((it) => !it.persona).map((it) => macros(it.alimento, it.gramos)));
  const r1 = (n) => Math.round(n * 10) / 10;
  const filas = c.fracciones.map(([persona, f]) => {
    const propio = sumar(c.items.filter((it) => it.persona === persona).map((it) => macros(it.alimento, it.gramos)));
    const m = { kcal: propio.kcal + compartido.kcal * f, proteina: propio.proteina + compartido.proteina * f, carbos: propio.carbos + compartido.carbos * f, grasas: propio.grasas + compartido.grasas * f };
    return {
      comida_id: comida.id, persona_id: persona, fraccion: Math.round(f * 1000) / 1000,
      kcal: r1(m.kcal), proteina_g: r1(m.proteina), carbohidratos_g: r1(m.carbos), grasas_g: r1(m.grasas),
    };
  }).filter((x) => x.kcal > 0 || x.fraccion > 0);
  datos(await sb.from('porciones').insert(filas));
  for (const it of c.items.filter((x) => x.paquete)) {
    const p = datos(await sb.from('despensa').select('gramos_restantes').eq('id', it.paquete.id).maybeSingle());
    if (!p) continue;
    const quedan = Math.max(0, Number(p.gramos_restantes) - it.gramos);
    await sb.from('despensa').update({ gramos_restantes: quedan, terminado_en: quedan < 1 ? new Date().toISOString() : null }).eq('id', it.paquete.id);
  }
  // Vitaminas y minerales: se calculan en segundo plano los alimentos nuevos (para el resumen de la semana).
  const sinMicros = c.items.filter((it) => !it.alimento.micros).map((it) => it.alimento.id);
  import('../micros.js').then((M) => { M.olvidarMicros(); if (sinMicros.length) M.completarMicros(sinMicros).catch(() => {}); }).catch(() => {});
  return { id: comida.id, total };
}
