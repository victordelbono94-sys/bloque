// Resumen semanal: cómo te fue los últimos 7 días (peso, calorías y proteína frente a tu meta de cada día,
// entrenos hechos, sueño y agua) y 2-3 cambios concretos para la semana que viene.
import { sb, estado, datos } from './db.js';
import { esc, abrirDialogo, cara } from './ui.js';
import { hoyISO, sumarDias, diaCorto, numeroDia } from './fechas.js';
import { calcularMetas, diagnosticoDia, tendenciaPeso, ajustePorPeso, OBJETIVOS } from './nutricion.js';
import { metaAgua, aguaDeComidas } from './hidratacion.js';
import { esIndividual } from './actividades.js';
import { cargarCumplimiento } from './hecho.js';
import { rachaSemanas } from './logros.js';

const fechaLocal = (iso) => {
  const f = new Date(iso);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
};
const r = (n) => Math.round(n).toLocaleString('es-EC');

/** Calcula el resumen de los 7 días anteriores a hoy para una persona. */
export async function calcularSemana(persona) {
  const fin = sumarDias(hoyISO(), -1);
  const ini = sumarDias(fin, -6);
  const antes = sumarDias(ini, -15);
  const hogar = estado.yo.hogar_id;
  const [comidas, eventos, sesiones, dias, mediciones, objetivos, agua] = await Promise.all([
    sb.from('comidas').select('fecha, comida_items(gramos, persona_id, alimento:alimentos(nombre)), porciones(*)').eq('hogar_id', hogar).gte('fecha', ini).lte('fecha', fin).then(datos),
    sb.from('calendario').select('*').eq('hogar_id', hogar).gte('fecha', ini).lte('fecha', fin).then(datos),
    sb.from('sesiones_banda').select('tipo, inicio, fin, calorias, calorias_estimadas, fc_promedio, confirmado').eq('persona_id', persona.id)
      .or('confirmado.is.null,confirmado.neq.nada').gte('inicio', new Date(`${antes}T00:00:00`).toISOString()).lte('inicio', new Date(`${fin}T23:59:59`).toISOString()).then(datos),
    sb.from('actividad_diaria').select('fecha, pasos, calorias_activas, calorias_totales, sueno_min').eq('persona_id', persona.id).gte('fecha', antes).lte('fecha', fin).then(datos),
    sb.from('mediciones_corporales').select('medido_en, peso_kg, grasa_pct, masa_magra_kg').eq('persona_id', persona.id).order('medido_en', { ascending: false }).limit(60).then(datos),
    sb.from('objetivos').select('foco, desde').eq('persona_id', persona.id).order('desde', { ascending: false }).limit(1).then(datos),
    sb.from('hidratacion').select('fecha, ml').eq('persona_id', persona.id).gte('fecha', ini).lte('fecha', fin).then(datos),
  ]);
  // Para aprender el gasto real: 3 semanas de comidas registradas y el ritmo que eligió (si habló con la IA del cuerpo).
  const d21 = sumarDias(fin, -20);
  const [porc21, notas] = await Promise.all([
    sb.from('porciones').select('kcal, comida:comidas!inner(fecha, hogar_id)').eq('persona_id', persona.id).eq('comida.hogar_id', hogar)
      .gte('comida.fecha', d21).lte('comida.fecha', fin).then(datos).catch(() => []),
    sb.from('notas_cuerpo').select('tipo, texto, valor, creada_en').eq('persona_id', persona.id).order('creada_en', { ascending: false }).limit(12).then(datos).catch(() => []),
  ]);
  const foco = objetivos[0]?.foco ?? 'recomposicion';
  const tendencia = tendenciaPeso(mediciones, foco);
  const suyos = eventos.filter((e) => e.tipo !== 'descanso' && (e.asistencia === 'juntos' || e.persona_id === persona.id));
  const cumple = suyos.length ? await cargarCumplimiento(suyos, persona.id) : () => null;

  const porDia = [];
  for (let i = 0; i < 7; i++) {
    const f = sumarDias(ini, i);
    const med = mediciones.find((m) => m.peso_kg != null && fechaLocal(m.medido_en) <= f) ?? mediciones.find((m) => m.peso_kg != null) ?? null;
    const grasa = mediciones.find((m) => m.grasa_pct != null && fechaLocal(m.medido_en) <= f);
    const delDia = suyos.filter((e) => e.fecha === f);
    const hechos = delDia.filter((e) => cumple(e) === 'hecho');
    // Los entrenos individuales que no hizo no suman gasto ese día.
    const eventosGasto = delDia.filter((e) => !esIndividual(e) || cumple(e) === 'hecho');
    const relojDia = sesiones.filter((s) => fechaLocal(s.inicio) === f);
    const historial = {
      dias: dias.filter((d) => d.fecha < f && d.fecha >= sumarDias(f, -15)),
      sesiones: sesiones.filter((s) => fechaLocal(s.inicio) < f).map((s) => ({ fecha: fechaLocal(s.inicio), calorias: s.calorias })),
    };
    const metas = calcularMetas({
      persona, medicion: med ? { ...med, grasa_pct: med.grasa_pct ?? grasa?.grasa_pct ?? null } : null, foco,
      eventos: eventosGasto, entrenosReloj: relojDia, hoy: new Date(`${f}T12:00:00`), historial, tendencia,
    });
    const delasComidas = comidas.filter((c) => c.fecha === f);
    const porciones = delasComidas.flatMap((c) => c.porciones.filter((x) => x.persona_id === persona.id));
    const comido = porciones.reduce((a, x) => ({
      kcal: a.kcal + Number(x.kcal ?? 0), proteina: a.proteina + Number(x.proteina_g ?? 0),
      carbos: a.carbos + Number(x.carbohidratos_g ?? 0), grasas: a.grasas + Number(x.grasas_g ?? 0),
    }), { kcal: 0, proteina: 0, carbos: 0, grasas: 0 });
    const diag = metas.ok ? diagnosticoDia({ metas, comido, hora: 23 }) : null;
    const tomado = aguaDeComidas(delasComidas, persona.id) + agua.filter((a) => a.fecha === f).reduce((a, x) => a + Number(x.ml), 0);
    const sueno = dias.find((d) => d.fecha === f)?.sueno_min ?? null;
    porDia.push({
      fecha: f, metas, comido, diag, registrado: comido.kcal > 300,
      agendados: delDia.length, hechos: hechos.length, sueno,
      agua: { tomado, meta: metaAgua({ peso: metas.ok ? metas.peso : null, ejercicioKcal: metas.ok ? metas.ejercicio : 0 }) },
    });
  }

  const registrados = porDia.filter((d) => d.registrado && d.metas.ok);
  const enMeta = registrados.filter((d) => d.diag?.estado === 'justo').length;
  const protOk = registrados.filter((d) => d.comido.proteina >= d.metas.proteina * 0.9).length;
  const prom = (lista, fn) => (lista.length ? lista.reduce((a, x) => a + fn(x), 0) / lista.length : null);
  const kcalComida = prom(registrados, (d) => d.comido.kcal);
  const kcalMeta = prom(registrados, (d) => d.metas.kcal);
  const protComida = prom(registrados, (d) => d.comido.proteina);
  const protMeta = prom(registrados, (d) => d.metas.proteina);
  const agendados = porDia.reduce((a, d) => a + d.agendados, 0);
  const hechos = porDia.reduce((a, d) => a + d.hechos, 0);
  const suenos = porDia.map((d) => d.sueno).filter((x) => x != null && x > 120);
  const suenoProm = suenos.length ? suenos.reduce((a, b) => a + b, 0) / suenos.length : null;
  const conAgua = porDia.filter((d) => d.agua.tomado > 0);
  const aguaPct = conAgua.length ? prom(conAgua, (d) => d.agua.tomado / d.agua.meta) : null;
  const pesos = mediciones.filter((m) => m.peso_kg != null && fechaLocal(m.medido_en) >= sumarDias(ini, -3) && fechaLocal(m.medido_en) <= fin);
  const pesoFin = pesos[0]?.peso_kg != null ? Number(pesos[0].peso_kg) : null;
  const pesoIni = pesos.at(-1)?.peso_kg != null ? Number(pesos.at(-1).peso_kg) : null;
  const pesoAct = mediciones.find((m) => m.peso_kg != null)?.peso_kg;
  const ajuste = ajustePorPeso(tendencia, foco, pesoAct ? Number(pesoAct) : null);

  // ---------- Qué cambiar (las 3 más importantes) ----------
  const sugerencias = [];
  const ganar = foco === 'masa_muscular';
  const bajar = foco === 'perder_grasa';
  const ppc = registrados[0]?.metas.proteinaPorComida ?? 30;
  if (registrados.length < 5) sugerencias.push({ p: 10, t: `Registra todas tus comidas: con ${registrados.length} de 7 días la app no puede afinar tu meta. La foto + «Enviar» toma 10 segundos.` });
  if (ajuste.kcal) sugerencias.push({ p: 9, t: `${ajuste.nota} Ya está aplicado en tus metas.` });
  if (kcalComida != null && kcalMeta != null) {
    const dif = kcalComida - kcalMeta;
    if (ganar && dif < -200) sugerencias.push({ p: 8, t: `Comiste ~${r(-dif)} kcal menos que tu meta por día. Para ganar masa suma un snack de ~${r(Math.min(600, -dif))} kcal (yogur griego con avena y maní, o un batido con banana).` });
    if (bajar && dif > 150) sugerencias.push({ p: 8, t: `Comiste ~${r(dif)} kcal más que tu meta por día. Achica las porciones de carbohidratos de la cena o cambia un snack por fruta.` });
    if (!ganar && !bajar && Math.abs(dif) > 300) sugerencias.push({ p: 6, t: `Comiste ~${r(Math.abs(dif))} kcal ${dif > 0 ? 'más' : 'menos'} que tu meta por día: ${dif > 0 ? 'achica una porción' : 'suma un snack'} para acercarte.` });
  }
  if (registrados.length >= 3 && protOk < Math.ceil(registrados.length * 0.6)) {
    sugerencias.push({ p: 8, t: `Llegaste a tu proteína ${protOk} de ${registrados.length} días (promedio ${r(protComida)} de ${r(protMeta)} g). Pon ~${ppc} g en cada comida principal: huevos, pollo, atún, yogur griego o un batido.` });
  }
  if (agendados >= 2 && hechos / agendados < 0.7) sugerencias.push({ p: 7, t: `Hiciste ${hechos} de ${agendados} entrenos. Si la semana no da, mueve el que falta con «Recuperar» en vez de saltarlo.` });
  if (suenoProm != null && suenoProm < 420) sugerencias.push({ p: 7, t: `Dormiste ${(suenoProm / 60).toFixed(1).replace('.', ',')} h en promedio. El músculo se recupera durmiendo: apunta a 7–8 h, sobre todo después del derby.` });
  if (aguaPct != null && aguaPct < 0.8) sugerencias.push({ p: 5, t: `Llegaste en promedio al ${Math.round(aguaPct * 100)} % de tu agua. Lleva una botella al gym y al derby, y un vaso con cada comida.` });
  if (!sugerencias.length) sugerencias.push({ p: 1, t: 'Semana muy pareja: sigue así. Si quieres progresar más, sube un poco el peso en los ejercicios que te salieron «fácil».' });
  sugerencias.sort((a, b) => b.p - a.p);

  const racha = await rachaSemanas(persona.id).catch(() => 0);
  const pesoActual = pesoAct != null ? Number(pesoAct) : null;
  const ritmo = ritmoEsperado(foco, pesoActual, notas.find((n) => n.tipo === 'ritmo')?.valor);
  const gasto = gastoReal(porc21, mediciones, d21, fin, persona);
  const gastoEstimado = prom(registrados, (d) => d.metas.gasto);
  return {
    racha, ritmo, gasto, gastoEstimado, pesoActual, notas,
    proyeccion: pesoActual != null ? {
      real: tendencia?.kgSemana != null ? pesoActual + tendencia.kgSemana * 4 : null,
      ideal: pesoActual + ((ritmo.min + ritmo.max) / 2) * 4,
    } : null, persona, ini, fin, foco, porDia, registrados: registrados.length, enMeta, protOk, kcalComida, kcalMeta, protComida, protMeta,
    agendados, hechos, suenoProm, aguaPct, pesoIni, pesoFin, tendencia, sugerencias: sugerencias.slice(0, 3).map((x) => x.t),
  };
}

/** Ritmo sano de cambio de peso por semana según el objetivo (o el que eligió con la IA). */
export function ritmoEsperado(foco, peso, elegido = null) {
  const p = peso ?? 70;
  const R = {
    perder_grasa: [-0.01, -0.005], recomposicion: [-0.004, -0.001], masa_muscular: [0.0015, 0.004],
    mantenimiento: [-0.0015, 0.0015], cardio: [-0.0015, 0.0015],
  }[foco] ?? [-0.0015, 0.0015];
  if (elegido != null && Number.isFinite(Number(elegido))) {
    const v = Number(elegido);
    return { min: Math.round((v - 0.1) * 100) / 100, max: Math.round((v + 0.1) * 100) / 100, elegido: v };
  }
  const a = Math.round(R[0] * p * 100) / 100, b = Math.round(R[1] * p * 100) / 100;
  return { min: Math.min(a, b), max: Math.max(a, b), elegido: null };
}

/**
 * Gasto real aprendido (como hacen las apps de nutrición adaptativas): lo que comiste en promedio, corregido por lo que
 * hizo tu peso. Si comiste 2.400 al día y bajaste 0,3 kg por semana, tu gasto real es ~2.400 + 0,3 × 7.700 / 7 ≈ 2.730.
 * Necesita ≥ 10 días bien registrados y ≥ 3 pesajes que cubran ≥ 10 días.
 */
export function gastoReal(porciones, mediciones, desde, hasta, persona) {
  const porDia = new Map();
  for (const x of porciones) porDia.set(x.comida.fecha, (porDia.get(x.comida.fecha) ?? 0) + Number(x.kcal ?? 0));
  const dias = [...porDia.values()].filter((k) => k > 900);
  const pesos = mediciones.filter((m) => m.peso_kg != null && fechaLocal(m.medido_en) >= desde && fechaLocal(m.medido_en) <= hasta)
    .map((m) => ({ x: new Date(m.medido_en).getTime() / 864e5, y: Number(m.peso_kg) }));
  const falta = { dias: Math.max(0, 10 - dias.length), pesajes: Math.max(0, 3 - pesos.length) };
  if (dias.length < 10 || pesos.length < 3) return { listo: false, falta, diasRegistrados: dias.length, pesajes: pesos.length };
  const xs = pesos.map((p) => p.x);
  if (Math.max(...xs) - Math.min(...xs) < 10) return { listo: false, falta: { ...falta, rango: true }, diasRegistrados: dias.length, pesajes: pesos.length };
  const mx = xs.reduce((a, b) => a + b, 0) / pesos.length, my = pesos.reduce((a, p) => a + p.y, 0) / pesos.length;
  const kgDia = pesos.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / pesos.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  const comido = dias.reduce((a, b) => a + b, 0) / dias.length;
  const kcal = Math.round((comido - kgDia * 7700) / 10) * 10;
  return { listo: true, kcal: Math.max(1200, Math.min(5500, kcal)), comido: Math.round(comido), kgSemana: Math.round(kgDia * 700) / 100, diasRegistrados: dias.length, pesajes: pesos.length };
}

const ICONOS_KPI = { comida: '🍽️', proteina: '🥩', entreno: '🏋️', sueno: '😴', agua: '💧' };
const kgTxt = (n, signo = false, dec = 2) => `${signo && n > 0 ? '+' : ''}${n.toLocaleString('es-EC', { maximumFractionDigits: dec })}`;

/** El resumen de la semana: ritmo del peso frente a lo ideal, proyección, gasto real aprendido, indicadores y plan. */
export function htmlSemana(s, { compacto = false } = {}) {
  const real = s.tendencia?.kgSemana ?? null;
  const { min, max } = s.ritmo;
  const centro = (min + max) / 2;
  const bajar = centro < -0.05, subir = centro > 0.05;
  const estadoRitmo = real == null ? 'sin' : real >= min - 0.05 && real <= max + 0.05 ? 'ok'
    : (bajar ? (real > max ? 'lento' : 'rapido') : subir ? (real < min ? 'lento' : 'rapido') : 'fuera');
  const escala = 1.2;
  const pos = (v) => `${((Math.max(-escala, Math.min(escala, v)) + escala) / (2 * escala)) * 100}%`;
  const verbo = bajar ? 'bajar' : subir ? 'subir' : 'mantenerte entre';
  const rangoTxt = bajar || subir
    ? `${verbo} ${kgTxt(Math.abs(bajar ? max : min))}–${kgTxt(Math.abs(bajar ? min : max))} kg por semana`
    : `${verbo} ${kgTxt(min, true)} y ${kgTxt(max, true)} kg por semana`;
  const textoRitmo = {
    sin: 'Pésate 2 o 3 veces por semana (al levantarte) y acá ves si vas al ritmo de tu objetivo.',
    ok: '¡Vas al ritmo justo! Sigue así.',
    lento: bajar ? 'Vas más lento de lo ideal: la app ya ajustó tu meta. Si quieres, cuéntale a la IA cómo vienes.' : 'Vas más lento de lo ideal: la app ya sumó calorías a tu meta.',
    rapido: bajar ? 'Vas más rápido de lo ideal: puede costar músculo. La app sumó calorías a tu meta.' : 'Subes rápido: puede ser grasa. La app restó un poco a tu meta.',
    fuera: 'Tu peso se está moviendo: la app ajustó tu meta para mantenerte.',
  }[estadoRitmo];

  const kpi = (icono, valor, etiqueta, ok) => `<div class="kpi2 ${ok === true ? 'kpi2--ok' : ok === false ? 'kpi2--ojo' : ''}"><span class="kpi2__icono" aria-hidden="true">${icono}</span><strong>${valor}</strong><span>${etiqueta}</span></div>`;
  const barras = s.porDia.map((d) => {
    const pct = d.metas.ok && d.metas.kcal ? Math.min(140, Math.round(d.comido.kcal / d.metas.kcal * 100)) : 0;
    const cls = !d.registrado ? 'sin' : d.diag?.estado === 'justo' ? 'ok' : d.diag?.estado === 'pasado' ? 'pasado' : 'falta';
    return `<div class="semana-dia"><div class="semana-dia__barra"><span class="semana-dia__fill semana-dia__fill--${cls}" style="height:${Math.max(4, pct * 0.7)}%"></span><i class="semana-dia__meta"></i></div>
      <span class="semana-dia__nombre">${esc(diaCorto(d.fecha).slice(0, 2))}</span>${d.hechos ? '<span class="semana-dia__entreno" title="Entreno hecho">●</span>' : '<span class="semana-dia__entreno semana-dia__entreno--no"></span>'}</div>`;
  }).join('');
  const g = s.gasto;
  const difGasto = g?.listo && s.gastoEstimado ? g.kcal - s.gastoEstimado : null;

  return `
    <div class="sem2">
      <section class="sem2-ritmo sem2-ritmo--${estadoRitmo}">
        <div class="sem2-ritmo__cab">
          <span>Ritmo de tu peso</span>
          <strong>${real == null ? '—' : `${kgTxt(real, true)} kg/sem`}</strong>
        </div>
        <div class="sem2-gauge" role="img" aria-label="Ideal: ${esc(rangoTxt)}${real != null ? `; real ${kgTxt(real, true)} kg por semana` : ''}">
          <span class="sem2-gauge__cero" style="left:${pos(0)}"></span>
          <span class="sem2-gauge__zona" style="left:${pos(Math.min(min, max))};width:calc(${pos(Math.max(min, max))} - ${pos(Math.min(min, max))})"></span>
          ${real != null ? `<span class="sem2-gauge__marca" style="left:${pos(real)}"></span>` : ''}
        </div>
        <div class="sem2-gauge__escala"><span>bajar</span><span>0</span><span>subir</span></div>
        <p class="sem2-ritmo__txt">Lo ideal${s.ritmo.elegido != null ? ' (el ritmo que elegiste)' : ` para «${esc(OBJETIVOS[s.foco]?.nombre ?? '')}»`}: <strong>${esc(rangoTxt)}</strong>. ${esc(textoRitmo)}</p>
      </section>

      ${s.proyeccion ? `
      <section class="sem2-proy">
        <div class="sem2-tile"><span>Hoy</span><strong>${kgTxt(s.pesoActual, false, 1)}<small> kg</small></strong></div>
        <div class="sem2-flecha" aria-hidden="true">→</div>
        <div class="sem2-tile"><span>En 4 semanas${s.proyeccion.real != null ? ', a este ritmo' : ''}</span><strong>${kgTxt(s.proyeccion.real ?? s.proyeccion.ideal, false, 1)}<small> kg</small></strong></div>
        <div class="sem2-tile sem2-tile--ideal"><span>Con el ritmo ideal</span><strong>${kgTxt(s.proyeccion.ideal, false, 1)}<small> kg</small></strong></div>
      </section>` : ''}

      <section class="sem2-gasto">
        <span class="sem2-gasto__icono" aria-hidden="true">🔥</span>
        <div>${g?.listo
          ? `<strong>Tu gasto real: ~${r(g.kcal)} kcal/día</strong><span>Aprendido de ${g.diasRegistrados} días de comidas y ${g.pesajes} pesajes${difGasto != null && Math.abs(difGasto) >= 120 ? ` · ${difGasto > 0 ? `${r(difGasto)} más` : `${r(-difGasto)} menos`} de lo que estimaba la app` : ''}.</span>`
          : `<strong>Aprendiendo tu metabolismo</strong><span>Con ${g?.falta?.dias ? `${g.falta.dias} día${g.falta.dias === 1 ? '' : 's'} más de comidas registradas` : ''}${g?.falta?.dias && (g?.falta?.pesajes || g?.falta?.rango) ? ' y ' : ''}${g?.falta?.pesajes ? `${g.falta.pesajes} pesaje${g.falta.pesajes === 1 ? '' : 's'} más` : g?.falta?.rango ? 'pesajes en al menos 10 días' : ''} la app calcula cuánto gastas de verdad.</span>`}</div>
      </section>

      <section class="sem2-kpis">
        ${kpi(ICONOS_KPI.comida, `${s.enMeta}/${s.registrados || 0}`, 'días en tu meta', s.registrados ? s.enMeta >= s.registrados * 0.6 : null)}
        ${kpi(ICONOS_KPI.proteina, `${s.protOk}/${s.registrados || 0}`, 'días con proteína', s.registrados ? s.protOk >= s.registrados * 0.6 : null)}
        ${kpi(ICONOS_KPI.entreno, `${s.hechos}/${s.agendados}`, 'entrenos', s.agendados ? s.hechos / s.agendados >= 0.7 : null)}
        ${kpi(ICONOS_KPI.sueno, s.suenoProm != null ? `${(s.suenoProm / 60).toFixed(1).replace('.', ',')} h` : '—', 'sueño', s.suenoProm != null ? s.suenoProm >= 420 : null)}
        ${kpi(ICONOS_KPI.agua, s.aguaPct != null ? `${Math.round(s.aguaPct * 100)}%` : '—', 'de tu agua', s.aguaPct != null ? s.aguaPct >= 0.8 : null)}
        ${kpi('🔥', s.racha ? `${s.racha}` : '0', s.racha === 1 ? 'semana de racha' : 'semanas de racha', s.racha ? true : null)}
      </section>

      <details class="sem2-detalle" ${compacto ? '' : 'open'}>
        <summary>Calorías día por día</summary>
        <div class="semana-dias">${barras}</div>
        <p class="ayuda" style="margin:8px 0 0">La línea es tu meta de cada día (cambia con los entrenos). ● = entreno hecho.</p>
      </details>

      <section class="sem2-plan">
        <p class="sem2-plan__titulo">Para esta semana</p>
        ${s.sugerencias.map((t, k) => `<div class="sem2-plan__item" style="--k:${k}"><span>${k + 1}</span><p>${esc(t)}</p></div>`).join('')}
      </section>
    </div>`;
}

/** Abre el resumen semanal (con las caras del hogar para ver el de cada uno). */
export async function abrirResumenSemanal(personaId = estado.yo.id) {
  const d = abrirDialogo(`
    <div class="dialogo semana">
      <h2 class="tarjeta__titulo">Tu semana</h2>
      ${estado.personas.length > 1 ? `<div class="ver-persona" role="tablist">${estado.personas.map((p) => `
        <button type="button" class="ver-persona__op" role="tab" data-semana="${esc(p.id)}" aria-selected="${p.id === personaId}">
          <span class="ver-persona__cara">${cara(p)}</span><span>${esc(p.id === estado.yo.id ? 'Yo' : p.nombre)}</span></button>`).join('')}</div>` : ''}
      <div id="sem-cuerpo"><p class="cargando">Armando tu resumen…</p></div>
    </div>`, 'Resumen semanal', { pantalla: true });
  const pintar = async (id) => {
    const cont = d.querySelector('#sem-cuerpo');
    cont.innerHTML = '<p class="cargando">Armando tu resumen…</p>';
    try {
      const s = await calcularSemana(estado.personas.find((p) => p.id === id));
      cont.innerHTML = htmlSemana(s);
      d.querySelector('h2').textContent = id === estado.yo.id ? 'Tu semana' : `La semana de ${s.persona.nombre}`;
    } catch (e) {
      cont.innerHTML = `<p class="vacio">No se pudo armar el resumen. ${esc(e.message ?? '')}</p>`;
    }
  };
  d.querySelectorAll('[data-semana]').forEach((b) => b.addEventListener('click', () => {
    d.querySelectorAll('[data-semana]').forEach((o) => o.setAttribute('aria-selected', String(o === b)));
    pintar(b.dataset.semana);
  }));
  pintar(personaId);
}
