// Vitaminas y minerales: lo que aportaron tus comidas de la semana frente a lo que necesitas.
// Las metas parten de las recomendaciones por sexo y edad (IOM/EFSA) y se adaptan a lo que entrenas:
//   - sudor: cada entreno suma sodio, potasio, magnesio, calcio y zinc según las calorías que quemaste (≈ 1 L de sudor cada 700 kcal);
//   - deporte: los de resistencia suben el hierro; mucho volumen semanal sube hierro y magnesio.
// Lo estimado de una foto tiene mucho margen, por eso se mira el promedio de la semana y solo con varios días registrados.
import { sb, estado, datos } from './db.js';
import { hoyISO, sumarDias } from './fechas.js';
import { edad, gastoEvento } from './nutricion.js';
import { deporte } from './deportes.js';
import { esc } from './ui.js';
import { encaja } from './dieta.js';

export const DIAS_MINIMOS = 5;

export const NUTRIENTES = [
  {
    clave: 'potasio_mg', nombre: 'Potasio', unidad: 'mg', icono: 'K',
    para: 'Contracción muscular y equilibrio de líquidos; ayuda a evitar calambres junto con el sodio y el magnesio.',
    fuentes: ['guineo o plátano', 'papa con cáscara', 'aguacate', 'fréjol o lenteja', 'chochos', 'tomate de árbol', 'naranjilla', 'yogur'],
    extra: 'Con comida se cubre fácil. No tomes pastillas de potasio sin indicación médica.',
  },
  {
    clave: 'magnesio_mg', nombre: 'Magnesio', unidad: 'mg', icono: 'Mg',
    para: 'Energía, recuperación muscular, sueño y calambres. Se pierde algo con el sudor.',
    fuentes: ['chochos', 'fréjol negro', 'avena', 'maní o almendras', 'pepas de zambo', 'quinua', 'chocolate negro', 'espinaca'],
    extra: 'Si sale bajo varias semanas seguidas, el magnesio (citrato o glicinato) es un suplemento común y seguro para deportistas: pregunta en la farmacia.',
  },
  {
    clave: 'sodio_mg', nombre: 'Sodio', unidad: 'mg', icono: 'Na', rango: true,
    para: 'Es lo que más se pierde en el sudor. Sin él, cuesta hidratarse y aparecen calambres en entrenos largos.',
    fuentes: ['agua con electrolitos en el entreno', 'una pizca de sal en el agua', 'caldo', 'galletas saladas después de entrenar'],
    extra: 'No cuenta la sal que le agregas en la mesa. En entrenos largos o de mucho sudor, agua con electrolitos (sodio + potasio).',
  },
  {
    clave: 'calcio_mg', nombre: 'Calcio', unidad: 'mg', icono: 'Ca',
    para: 'Huesos fuertes, sobre todo con golpes, caídas y saltos.',
    fuentes: ['leche', 'yogur', 'queso fresco', 'sardinas en lata (con espinas)', 'chochos', 'brócoli'],
    extra: 'Primero con lácteos o chochos; el suplemento solo si tu médico lo indica.',
  },
  {
    clave: 'hierro_mg', nombre: 'Hierro', unidad: 'mg', icono: 'Fe',
    para: 'Lleva el oxígeno a los músculos: sin hierro suficiente, el cardio y la energía caen.',
    fuentes: ['carne roja', 'hígado o menudencia', 'lenteja o fréjol con limón', 'quinua', 'espinaca', 'huevo'],
    extra: 'Comer las legumbres con algo de vitamina C (limón, naranja) ayuda a absorberlo. No tomes hierro sin un examen de sangre (ferritina): el exceso hace daño.',
  },
  {
    clave: 'zinc_mg', nombre: 'Zinc', unidad: 'mg', icono: 'Zn',
    para: 'Recuperación, defensas y hormonas; se pierde algo con el sudor.',
    fuentes: ['carne', 'camarón o mariscos', 'huevo', 'pepas de zambo', 'maní', 'lenteja'],
    extra: 'Con comida variada se cubre.',
  },
  {
    clave: 'vitamina_c_mg', nombre: 'Vitamina C', unidad: 'mg', icono: 'C',
    para: 'Defensas, tendones y ligamentos (colágeno) y absorción del hierro.',
    fuentes: ['guayaba', 'naranja o mandarina', 'tomate de árbol', 'naranjilla', 'maracuyá', 'pimiento', 'brócoli'],
    extra: 'Con una fruta al día suele alcanzar.',
  },
  {
    clave: 'vitamina_d_ug', nombre: 'Vitamina D', unidad: 'µg', icono: 'D', sol: true,
    para: 'Huesos, músculo y defensas. Casi toda viene del sol, poca de la comida.',
    fuentes: ['15–20 min de sol en brazos y cara', 'huevo (la yema)', 'sardina', 'atún', 'salmón o trucha'],
    extra: 'La comida casi nunca alcanza y es normal que salga bajo. Si casi no te da el sol, pide un examen de vitamina D antes de suplementar.',
  },
  {
    clave: 'b12_ug', nombre: 'Vitamina B12', unidad: 'µg', icono: 'B12',
    para: 'Energía y glóbulos rojos.',
    fuentes: ['huevo', 'leche y yogur', 'carne o pollo', 'atún o sardina', 'hígado'],
    extra: 'Si comes poca carne, huevo o lácteos, se suplementa fácil; mejor confirmarlo con un examen.',
  },
  {
    clave: 'omega3_mg', nombre: 'Omega-3', unidad: 'mg', icono: 'Ω3',
    para: 'Antiinflamatorio: ayuda a la recuperación y las articulaciones.',
    fuentes: ['sardina', 'atún', 'trucha', 'salmón', 'caballa'],
    extra: 'Si casi no comes pescado, el omega-3 en cápsulas es una opción común. La chía y la linaza ayudan, pero menos.',
  },
  {
    clave: 'fibra_g', nombre: 'Fibra', unidad: 'g', icono: 'Fi',
    para: 'Digestión, saciedad y energía estable.',
    fuentes: ['avena', 'fréjol o lenteja', 'chochos', 'fruta con cáscara', 'verduras', 'pan integral', 'quinua'],
    extra: 'Súmala de a poco y con agua.',
  },
];
const POR_CLAVE = Object.fromEntries(NUTRIENTES.map((n) => [n.clave, n]));
export const nutriente = (c) => POR_CLAVE[c];

/**
 * Meta de un día para una persona.
 * @param {object} p persona (sexo, fecha_nacimiento)
 * @param {object} dia { ejercicio: kcal de entrenos ese día, kcal: lo que comió (para la fibra) }
 * @param {object} contexto { deporte: clave, kcalSemana: kcal de entrenos en 7 días }
 */
export function metasMicros(p, { ejercicio = 0, kcal = 0 } = {}, { deporte: dep = estado.equipo?.deporte, kcalSemana = 0 } = {}) {
  const mujer = p?.sexo === 'f';
  const anios = edad(p?.fecha_nacimiento) ?? 30;
  const m = {
    potasio_mg: mujer ? 2600 : 3400,
    magnesio_mg: mujer ? (anios <= 30 ? 310 : 320) : (anios <= 30 ? 400 : 420),
    sodio_mg: 1500,
    calcio_mg: (mujer && anios > 50) || anios > 70 ? 1200 : 1000,
    hierro_mg: mujer && anios <= 50 ? 18 : 8,
    zinc_mg: mujer ? 8 : 11,
    vitamina_c_mg: mujer ? 75 : 90,
    vitamina_d_ug: anios > 70 ? 20 : 15,
    b12_ug: 2.4,
    omega3_mg: 250,
    fibra_g: Math.min(45, Math.max(mujer ? 25 : 30, Math.round((kcal || 2200) / 1000 * 14))),
  };
  const notas = [];
  // Sudor: ~1 L cada 700 kcal de entreno.
  const sudor = Math.max(0, ejercicio) / 700;
  m.sodio_mg += 800 * sudor;
  m.potasio_mg += 200 * sudor;
  m.magnesio_mg += 15 * sudor;
  m.calcio_mg += 25 * sudor;
  m.zinc_mg += 0.5 * sudor;
  // Deporte y volumen.
  const d = deporte(dep);
  if (d.exige?.includes('resistencia')) { m.hierro_mg *= 1.3; m.magnesio_mg *= 1.1; notas.push(`${d.nombre}: más hierro y magnesio por el trabajo de resistencia.`); }
  if (d.exige?.includes('contacto') || d.exige?.includes('potencia')) notas.push(`${d.nombre}: calcio y vitamina D importan más por los golpes y saltos.`);
  if (kcalSemana > 2500) { m.hierro_mg *= 1.15; m.magnesio_mg *= 1.1; m.zinc_mg *= 1.1; }
  m.sodioMax = 2300 + 800 * sudor;
  return { metas: m, notas, sudor };
}

/** Lo que aportó un día para una persona (y qué parte de sus calorías tiene micros calculados). */
export function microsDelDia(comidas, personaId) {
  const total = Object.fromEntries(NUTRIENTES.map((n) => [n.clave, 0]));
  let kcal = 0, kcalConMicros = 0;
  const faltan = new Set();
  for (const c of comidas) {
    const parte = c.porciones?.find((x) => x.persona_id === personaId);
    for (const it of c.comida_items ?? []) {
      const gramos = it.persona_id ? (it.persona_id === personaId ? Number(it.gramos) : 0) : (parte ? Number(it.gramos) * Number(parte.fraccion ?? 1) : 0);
      if (!gramos || !it.alimento) continue;
      const k = (Number(it.alimento.kcal) || 0) * gramos / 100;
      kcal += k;
      const mi = it.alimento.micros;
      if (!mi) { faltan.add(it.alimento.id); continue; }
      kcalConMicros += k;
      for (const n of NUTRIENTES) total[n.clave] += (Number(mi[n.clave]) || 0) * gramos / 100;
    }
  }
  return { total, kcal, cobertura: kcal ? kcalConMicros / kcal : 1, faltan };
}

let completando = null;
/** Pide a la IA los micros de los alimentos que todavía no los tienen (en tandas). */
export async function completarMicros(ids) {
  const lista = [...new Set(ids)].filter(Boolean);
  if (!lista.length) return {};
  if (completando) await completando.catch(() => {});
  completando = (async () => {
    const res = {};
    for (let i = 0; i < lista.length; i += 30) {
      const { data, error } = await sb.functions.invoke('micros', { body: { ids: lista.slice(i, i + 30) } });
      if (error && !data?.micros) break;
      Object.assign(res, data?.micros ?? {});
    }
    return res;
  })();
  try { return await completando; } finally { completando = null; }
}

const fechaLocal = (iso) => { const t = new Date(iso); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

/**
 * Análisis de los últimos 7 días de una persona: promedio de cada nutriente frente a su meta (adaptada a cada día).
 * @returns {Promise<{ listo, dias, diasMedidos, cobertura, filas: Array<{n, valor, meta, max, pct, estado}>, bajos, notas }>}
 */
export async function analisisSemana(persona = estado.yo, { completar = true } = {}) {
  const hoy = hoyISO();
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(hoy, i - 6));
  const desde = new Date(`${dias[0]}T00:00:00`).toISOString();
  const [comidas, reloj, eventos, med] = await Promise.all([
    sb.from('comidas').select('id, fecha, porciones(persona_id, fraccion, kcal), comida_items(gramos, persona_id, alimento:alimentos(id, kcal, micros))')
      .eq('hogar_id', estado.yo.hogar_id).gte('fecha', dias[0]).lte('fecha', hoy).then(datos),
    sb.from('sesiones_banda').select('inicio, calorias, confirmado').eq('persona_id', persona.id).or('confirmado.is.null,confirmado.neq.nada').gte('inicio', desde).then(datos).catch(() => []),
    sb.from('calendario').select('*').eq('hogar_id', estado.yo.hogar_id).gte('fecha', dias[0]).lte('fecha', hoy).then(datos).catch(() => []),
    sb.from('mediciones_corporales').select('peso_kg').eq('persona_id', persona.id).not('peso_kg', 'is', null).order('medido_en', { ascending: false }).limit(1).then(datos).catch(() => []),
  ]);
  const peso = med[0]?.peso_kg ? Number(med[0].peso_kg) : 70;
  // Entrenos de cada día: lo que midió el reloj; si no hay reloj ese día, lo agendado (gym, deporte).
  const ejercicioDe = (f) => {
    const medido = reloj.filter((s) => fechaLocal(s.inicio) === f).reduce((a, s) => a + (Number(s.calorias) || 0), 0);
    if (medido) return medido;
    if (f === hoy) return 0; // hoy: lo que todavía no pasó no se cuenta
    return eventos.filter((e) => e.fecha === f && e.tipo !== 'descanso' && !e.omitido && (e.asistencia === 'juntos' || e.persona_id === persona.id))
      .reduce((a, e) => a + gastoEvento(e, peso), 0);
  };
  const kcalSemana = dias.reduce((a, f) => a + ejercicioDe(f), 0);
  const porDia = dias.map((f) => ({ f, ...microsDelDia(comidas.filter((c) => c.fecha === f), persona.id), ejercicio: ejercicioDe(f) }));

  // Si hay alimentos sin calcular, se piden y se vuelve a sumar.
  const faltan = new Set(porDia.flatMap((d) => [...d.faltan]));
  if (completar && faltan.size) {
    const nuevos = await completarMicros([...faltan]).catch(() => ({}));
    if (Object.keys(nuevos).length) {
      for (const c of comidas) for (const it of c.comida_items ?? []) if (it.alimento && nuevos[it.alimento.id]) it.alimento.micros = nuevos[it.alimento.id];
      porDia.splice(0, 7, ...dias.map((f) => ({ f, ...microsDelDia(comidas.filter((c) => c.fecha === f), persona.id), ejercicio: ejercicioDe(f) })));
    }
  }

  // Día medido: comió algo razonable (≥ 900 kcal registradas). Hoy solo cuenta si ya pasó la mayor parte.
  const medidos = porDia.filter((d) => d.kcal >= 900 && (d.f !== hoy || new Date().getHours() >= 20));
  const cobertura = medidos.length ? medidos.reduce((a, d) => a + d.cobertura * d.kcal, 0) / medidos.reduce((a, d) => a + d.kcal, 0) : 0;
  const listo = medidos.length >= DIAS_MINIMOS && cobertura >= 0.7;
  const metasDias = medidos.map((d) => metasMicros(persona, { ejercicio: d.ejercicio, kcal: d.kcal }, { kcalSemana }));
  const prom = (fn) => (medidos.length ? medidos.reduce((a, d, i) => a + fn(d, i), 0) / medidos.length : 0);
  const filas = NUTRIENTES.map((n) => {
    // Lo que aportaron, corregido por lo que no se pudo calcular (si a un día le falta el 10 %, se escala).
    const valor = prom((d) => d.total[n.clave] / Math.max(0.7, d.cobertura));
    const meta = prom((_, i) => metasDias[i].metas[n.clave]);
    const max = n.rango ? prom((_, i) => metasDias[i].metas.sodioMax) : null;
    const pct = meta ? valor / meta : 0;
    let est = pct < 0.7 ? 'bajo' : pct < 0.9 ? 'justo' : 'bien';
    if (n.rango && max && valor > max) est = 'alto';
    if (n.sol && est !== 'bien') est = 'sol';
    return { n, valor, meta, max, pct, estado: est };
  });
  const bajos = filas.filter((x) => x.estado === 'bajo' && !x.n.rango).sort((a, b) => a.pct - b.pct);
  // Sodio bajo solo importa si entrenas fuerte: ahí se sugieren electrolitos.
  const sodio = filas.find((x) => x.n.clave === 'sodio_mg');
  if (sodio?.estado === 'bajo' && kcalSemana > 1500) bajos.push(sodio);
  return {
    listo, dias: porDia.length, diasMedidos: medidos.length, cobertura, filas, bajos,
    notas: metasDias[0]?.notas ?? metasMicros(persona, {}, { kcalSemana }).notas, kcalSemana,
  };
}

const formato = (v, unidad) => (unidad === 'µg' || (unidad === 'mg' && v < 20) ? (Math.round(v * 10) / 10).toLocaleString('es-EC') : Math.round(v).toLocaleString('es-EC'));

/** Lo que va al contexto de la IA (ideas y chat de la comida): nutrientes bajos de la semana y con qué cubrirlos. */
export function paraIA(a) {
  if (!a?.listo || !a.bajos.length) return null;
  return a.bajos.slice(0, 4).map((x) => ({
    nutriente: x.n.nombre, cubre_pct: Math.round(x.pct * 100), alimentos_que_lo_aportan: x.n.fuentes.filter((f) => encaja(f)).slice(0, 6),
  }));
}

/** El termómetro de vitaminas y minerales de la semana. */
export function htmlMicros(a, persona = estado.yo) {
  const propio = persona.id === estado.yo.id;
  if (!a.listo) {
    const n = Math.min(a.diasMedidos, DIAS_MINIMOS);
    return `
      <section class="tarjeta micros micros--espera">
        <h2 class="seccion__titulo" style="margin:0">Vitaminas y minerales</h2>
        <p style="margin:8px 0 6px">${propio ? 'Aparece' : 'Aparecerá'} cuando haya ${DIAS_MINIMOS} días con comidas registradas en la semana${propio ? '' : ` de ${esc(persona.nombre)}`}: con pocos días el estimado no es confiable.</p>
        <div class="micros__progreso" aria-label="${n} de ${DIAS_MINIMOS} días"><span style="width:${(n / DIAS_MINIMOS) * 100}%"></span></div>
        <p class="ayuda" style="margin:6px 0 0">${n} de ${DIAS_MINIMOS} días${a.diasMedidos >= DIAS_MINIMOS && a.cobertura < 0.7 ? ' · calculando los alimentos…' : ''}. Cuentan los días con al menos ~900 kcal registradas.</p>
      </section>`;
  }
  const resumen = a.bajos.length
    ? `<p class="micros__resumen">${propio ? 'Esta semana vas bajo' : `${esc(persona.nombre)} va bajo`} en <strong>${a.bajos.map((x) => x.n.nombre.toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' y $1')}</strong>.</p>
       <div class="micros__sugerencias">${a.bajos.slice(0, 3).map((x) => `<p><span class="micro-sim" aria-hidden="true">${x.n.icono}</span> <strong>${esc(x.n.nombre)}:</strong> ${esc(x.n.fuentes.filter((f) => encaja(f, persona)).slice(0, 4).join(', '))}.</p>`).join('')}</div>`
    : `<p class="micros__resumen">${propio ? 'Vas bien' : `${esc(persona.nombre)} va bien`} en vitaminas y minerales esta semana.</p>`;
  return `
    <section class="tarjeta micros">
      <div class="fila fila--entre"><h2 class="seccion__titulo" style="margin:0">Vitaminas y minerales</h2><span class="quieto" style="font-size:12px">promedio · ${a.diasMedidos} días</span></div>
      ${resumen}
      <div class="micros__lista">
        ${a.filas.map((x) => `
          <details class="micro micro--${x.estado}">
            <summary>
              <span class="micro__nombre"><span class="micro-sim" aria-hidden="true">${x.n.icono}</span> ${esc(x.n.nombre)}</span>
              <span class="micro__valor">${formato(x.valor, x.n.unidad)}<span class="quieto"> / ${formato(x.meta, x.n.unidad)}${x.max ? `–${formato(x.max, x.n.unidad)}` : ''} ${x.n.unidad}</span></span>
              <span class="micro__barra"><span style="width:${Math.min(100, x.pct * 100)}%"></span>${x.max ? `<i style="left:${Math.min(100, (x.max / Math.max(x.max, x.valor)) * 100)}%"></i>` : ''}</span>
            </summary>
            <div class="micro__detalle">
              <p>${esc(x.n.para)}</p>
              <p><strong>Lo encuentras en:</strong> ${esc(x.n.fuentes.filter((f) => encaja(f, persona)).join(', '))}.</p>
              <p class="quieto">${esc(x.n.extra)}</p>
            </div>
          </details>`).join('')}
      </div>
      ${a.notas.length || a.kcalSemana > 0 ? `<p class="ayuda" style="margin:10px 0 0">Metas según ${propio ? 'tu' : 'su'} sexo y edad, ajustadas a ${a.kcalSemana > 0 ? `los entrenos de la semana (${Math.round(a.kcalSemana).toLocaleString('es-EC')} kcal: más sodio, potasio y magnesio por el sudor)` : 'la actividad'}.${a.notas.length ? ` ${esc(a.notas.join(' '))}` : ''}</p>` : ''}
      <p class="ayuda" style="margin:6px 0 0">Estimado de las comidas registradas (puede variar ±30 %). No reemplaza un examen de sangre.</p>
    </section>`;
}

const cache = new Map();
/** Nutrientes bajos de la semana para darle a la IA (con caché de 30 min; sin esperar a calcular alimentos nuevos). */
export async function bajosParaIA(persona = estado.yo) {
  const c = cache.get(persona.id);
  if (c && Date.now() - c.t < 30 * 60e3) return c.v;
  try {
    const v = paraIA(await analisisSemana(persona, { completar: false }));
    cache.set(persona.id, { t: Date.now(), v });
    return v;
  } catch { return null; }
}
export const olvidarMicros = () => cache.clear();
