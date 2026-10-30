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
import { IC } from './iconos.js';
import { fuentesProteina } from './dieta.js';

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
  // «Muy cerca»: a menos del 12 % de la meta (un día que te faltaron unos carbohidratos no es un día perdido).
  const cerca = registrados.filter((d) => d.diag?.estado !== 'justo' && Math.abs(d.comido.kcal - d.metas.kcal) <= d.metas.kcal * 0.12).length;
  const protOk = registrados.filter((d) => d.comido.proteina >= d.metas.proteina * 0.9).length;
  const protCerca = registrados.filter((d) => d.comido.proteina < d.metas.proteina * 0.9 && d.comido.proteina >= d.metas.proteina * 0.75).length;
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
  if (registrados.length < 5) sugerencias.push({ p: 10, i: IC.camara, ti: 'Registra todas tus comidas', t: `Anotaste ${registrados.length} de 7 días. Con todo registrado, tu meta y tu gasto real se afinan. Una foto del plato basta.` });
  if (ajuste.kcal) sugerencias.push({ p: 9, i: IC.balanza, ti: ajuste.kcal > 0 ? 'Tu meta subió un poco' : 'Tu meta bajó un poco', t: `${ajuste.nota} Ya está aplicado: solo sigue tu meta del día.` });
  if (kcalComida != null && kcalMeta != null) {
    const dif = kcalComida - kcalMeta;
    if (ganar && dif < -200) sugerencias.push({ p: 8, i: IC.comida, ti: 'Come un poco más', t: `Te faltaron ~${r(-dif)} kcal por día. Suma un snack de ~${r(Math.min(600, -dif))} kcal: yogur griego con avena y maní, o un batido con banana.` });
    if (bajar && dif > 150) sugerencias.push({ p: 8, i: IC.comida, ti: 'Achica un poco las porciones', t: `Te pasaste ~${r(dif)} kcal por día. Menos carbohidratos en la cena o una fruta en vez de un snack.` });
    if (!ganar && !bajar && Math.abs(dif) > 300) sugerencias.push({ p: 6, i: IC.comida, ti: dif > 0 ? 'Achica una porción' : 'Suma un snack', t: `Estuviste ~${r(Math.abs(dif))} kcal por día ${dif > 0 ? 'arriba' : 'debajo'} de tu meta.` });
  }
  if (registrados.length >= 3 && protOk < Math.ceil(registrados.length * 0.6)) {
    sugerencias.push({ p: 8, i: IC.proteina, ti: 'Sube la proteína', t: `Promediaste ${r(protComida)} de ${r(protMeta)} g. Pon ~${ppc} g en cada comida principal: ${fuentesProteina(persona).slice(0, 4).join(', ')}.` });
  }
  if (agendados >= 2 && hechos / agendados < 0.7) sugerencias.push({ p: 7, i: IC.pesa, ti: 'No te saltes entrenos', t: `Hiciste ${hechos} de ${agendados}. Si un día no puedes, muévelo con «Recuperar» en vez de saltarlo.` });
  if (suenoProm != null && suenoProm < 420) sugerencias.push({ p: 7, i: IC.sueno, ti: 'Duerme un poco más', t: `Promediaste ${(suenoProm / 60).toFixed(1).replace('.', ',')} h. El músculo se recupera durmiendo: apunta a 7–8 h.` });
  if (aguaPct != null && aguaPct < 0.8) sugerencias.push({ p: 5, i: IC.agua, ti: 'Toma más agua', t: `Llegaste al ${Math.round(aguaPct * 100)} % de lo que necesitas. Una botella en el gym y el derby, y un vaso con cada comida.` });
  if (!sugerencias.length) sugerencias.push({ p: 1, i: IC.check, ti: 'Sigue así', t: 'Semana muy pareja. Para progresar más, sube un poco el peso en los ejercicios que te salieron «fácil».' });
  sugerencias.sort((a, b) => b.p - a.p);

  const racha = await rachaSemanas(persona.id).catch(() => 0);
  // Rachas de días seguidos (hasta ayer).
  const seguidos = (ok) => { let n = 0; for (let k = 0; k < 30; k++) { const v = ok(sumarDias(fin, -k)); if (v === false || v == null) break; n++; } return n; };
  const kcalDia = new Map();
  for (const x of porc21) kcalDia.set(x.comida.fecha, (kcalDia.get(x.comida.fecha) ?? 0) + Number(x.kcal ?? 0));
  const diaDe = (f) => porDia.find((d) => d.fecha === f);
  const rachas = {
    gym: racha,
    registro: seguidos((f) => (f < d21 ? null : (kcalDia.get(f) ?? 0) > 800)),
    agua: seguidos((f) => { const d = diaDe(f); return d ? d.agua.tomado >= d.agua.meta * 0.9 : null; }),
    proteina: seguidos((f) => { const d = diaDe(f); return d && d.registrado && d.metas.ok ? d.comido.proteina >= d.metas.proteina * 0.9 : null; }),
    pasos: seguidos((f) => { const d = dias.find((x) => x.fecha === f); return d ? Number(d.pasos ?? 0) >= 7000 : null; }),
  };
  const pesoActual = pesoAct != null ? Number(pesoAct) : null;
  const ritmo = ritmoEsperado(foco, pesoActual, notas.find((n) => n.tipo === 'ritmo')?.valor);
  const gasto = gastoReal(porc21, mediciones, d21, fin, persona);
  const gastoEstimado = prom(registrados, (d) => d.metas.gasto);
  return {
    racha, rachas, cerca, protCerca, ritmo, gasto, gastoEstimado, pesoActual, notas,
    proyeccion: pesoActual != null ? {
      real: tendencia?.kgSemana != null ? pesoActual + tendencia.kgSemana * 4 : null,
      ideal: pesoActual + ((ritmo.min + ritmo.max) / 2) * 4,
    } : null, persona, ini, fin, foco, porDia, registrados: registrados.length, enMeta, protOk, kcalComida, kcalMeta, protComida, protMeta,
    agendados, hechos, suenoProm, aguaPct, pesoIni, pesoFin, tendencia, sugerencias: sugerencias.slice(0, 3).map((x) => ({ icono: x.i, titulo: x.ti, texto: x.t })),
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

const kgTxt = (n, signo = false, dec = 2) => `${signo && n > 0 ? '+' : ''}${n.toLocaleString('es-EC', { maximumFractionDigits: dec })}`;

/** Gráfico de las próximas 4 semanas: a tu ritmo (línea) frente a la zona ideal (banda). */
function graficoProyeccion(s, estado) {
  const p0 = s.pesoActual, real = s.tendencia?.kgSemana ?? null;
  const { min, max } = s.ritmo;
  const finReal = real != null ? p0 + real * 4 : null;
  const finMin = p0 + min * 4, finMax = p0 + max * 4;
  const vals = [p0, finMin, finMax, ...(finReal != null ? [finReal] : [])];
  let y0 = Math.min(...vals), y1 = Math.max(...vals);
  const m = Math.max(0.4, (y1 - y0) * 0.25); y0 -= m; y1 += m;
  const W = 300, H = 120, X = (sem) => 40 + sem * 52, Y = (v) => 12 + (1 - (v - y0) / (y1 - y0)) * (H - 34);
  const color = estado === 'ok' ? '#C6F432' : estado === 'sin' ? '#A9ADB8' : '#F5B841';
  return `
    <svg class="proy-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Proyección de tu peso en 4 semanas">
      ${[0, 1, 2, 3, 4].map((k) => `<line x1="${X(k)}" x2="${X(k)}" y1="8" y2="${H - 22}" class="proy-svg__guia"/><text x="${X(k)}" y="${H - 6}" text-anchor="middle">${k === 0 ? 'hoy' : `${k} sem`}</text>`).join('')}
      <path class="proy-svg__zona" d="M${X(0)} ${Y(p0)} L${X(4)} ${Y(finMin)} L${X(4)} ${Y(finMax)} Z"/>
      <text class="proy-svg__zona-txt" x="${X(4) + 6}" y="${(Y(finMin) + Y(finMax)) / 2 + 4}">ideal</text>
      ${finReal != null ? `<path class="proy-svg__real" d="M${X(0)} ${Y(p0)} L${X(4)} ${Y(finReal)}" stroke="${color}" pathLength="1"/>
        <circle cx="${X(4)}" cy="${Y(finReal)}" r="5" fill="${color}" class="proy-svg__fin"/>
        <text class="proy-svg__valor" x="${X(4) - 8}" y="${Y(finReal) + (finReal > (finMin + finMax) / 2 ? -10 : 18)}" text-anchor="end" fill="${color}">${kgTxt(finReal, false, 1)} kg</text>` : ''}
      <circle cx="${X(0)}" cy="${Y(p0)}" r="5" class="proy-svg__hoy"/>
      <text class="proy-svg__valor" x="${X(0) + 8}" y="${Y(p0) - 10}">${kgTxt(p0, false, 1)} kg</text>
    </svg>`;
}

const fila = (icono, titulo, detalle, estado) => `<div class="sem2-fila"><span class="sem2-fila__icono" aria-hidden="true">${icono}</span>
  <span class="sem2-fila__txt"><strong>${titulo}</strong><span>${detalle}</span></span>
  <span class="sem2-chip sem2-chip--${estado}">${{ ok: 'Bien', casi: 'Casi', ojo: 'Puedes mejorar', sin: 'Sin datos' }[estado]}</span></div>`;
const nivel = (x, bien, casi) => (x == null ? 'sin' : x >= bien ? 'ok' : x >= casi ? 'casi' : 'ojo');

/** «Cómo te fue», en tono amable: si casi llegaste, te lo dice. */
function filasComoTeFue(s) {
  const reg = s.registrados || 0;
  const pl = (n, a, b) => `${n} ${n === 1 ? a : b}`;
  const kcal = !reg ? ['sin', 'No registraste comidas: con una foto del plato basta.']
    : s.enMeta && s.cerca ? [nivel((s.enMeta + s.cerca) / reg, 0.6, 0.3), `Cumpliste tu meta ${pl(s.enMeta, 'día', 'días')} y estuviste muy cerca ${pl(s.cerca, 'día', 'días')} más.`]
    : s.enMeta ? [nivel(s.enMeta / reg, 0.6, 0.3), `Cumpliste tu meta ${s.enMeta} de ${reg} días registrados.`]
    : s.cerca ? ['casi', `Estuviste muy cerca de tu meta ${s.cerca} de ${reg} días: te faltó poquito.`]
    : ['ojo', `Te quedaste lejos de tu meta estos días. Esta semana se puede: mira «Calorías día por día».`];
  const prot = !reg ? ['sin', 'Sin comidas registradas.']
    : s.protOk ? [nivel((s.protOk + s.protCerca * 0.5) / reg, 0.6, 0.3), `Llegaste a tu proteína ${pl(s.protOk, 'día', 'días')}${s.protCerca ? ` y casi ${pl(s.protCerca, 'día', 'días')} más` : ''}.`]
    : s.protCerca ? ['casi', `Casi llegas a tu proteína ${pl(s.protCerca, 'día', 'días')} (promedio ${r(s.protComida)} de ${r(s.protMeta)} g).`]
    : ['ojo', `Vas en ${r(s.protComida ?? 0)} de ${r(s.protMeta ?? 0)} g por día: suma una porción en cada comida.`];
  const ent = !s.agendados ? ['sin', 'No tenías entrenos agendados.'] : [nivel(s.hechos / s.agendados, 0.7, 0.4), `Fuiste a ${s.hechos} de ${s.agendados} entrenos${s.hechos ? ': cada uno suma' : ''}.`];
  const sue = s.suenoProm == null ? ['sin', 'Sin datos del reloj.'] : [nivel(s.suenoProm / 60, 7, 6.3), `Dormiste ${(s.suenoProm / 60).toFixed(1).replace('.', ',')} h por noche (lo ideal: 7–9 h).`];
  const agu = s.aguaPct == null ? ['sin', 'No registraste agua.'] : [nivel(s.aguaPct, 0.8, 0.6), `Tomaste el ${Math.round(s.aguaPct * 100)} % del agua que necesitas.`];
  return [
    fila(IC.comida, 'Calorías', kcal[1], kcal[0]),
    fila(IC.proteina, 'Proteína', prot[1], prot[0]),
    fila(IC.pesa, 'Entrenos', ent[1], ent[0]),
    fila(IC.sueno, 'Sueño', sue[1], sue[0]),
    fila(IC.agua, 'Agua', agu[1], agu[0]),
  ];
}

function consejoCalorias(s) {
  const reg = s.porDia.filter((d) => d.registrado && d.metas.ok);
  if (!reg.length) return '<p class="sem2-veredicto">Registra tus comidas de hoy y acá ves cómo vas día a día.</p>';
  const dif = reg.reduce((a, d) => a + (d.comido.kcal - d.metas.kcal), 0) / reg.length;
  const meta = reg.reduce((a, d) => a + d.metas.kcal, 0) / reg.length;
  const ganar = s.foco === 'masa_muscular', bajar = s.foco === 'perder_grasa' || s.foco === 'recomposicion';
  let txt, tono = 'ok';
  if (Math.abs(dif) <= meta * 0.08) txt = `Vas muy parejo con tu meta (±${r(Math.abs(dif))} kcal por día). Hoy sigue igual: tu meta del día ya cuenta tus entrenos.`;
  else if (dif < 0) {
    tono = ganar ? 'ojo' : 'casi';
    txt = ganar
      ? `Te quedaste ~${r(-dif)} kcal por debajo por día, y para ganar músculo hace falta comer más. Hoy y los próximos días suma un snack de ~${r(Math.min(600, -dif))} kcal (yogur griego con avena, pan con mantequilla de maní o un batido).`
      : bajar ? `Comiste ~${r(-dif)} kcal menos por día de lo planeado. Bajar más rápido no es mejor: puede costar músculo. Hoy llega a tu meta, sobre todo con proteína y carbohidratos alrededor del entreno.`
        : `Te quedaste ~${r(-dif)} kcal por debajo por día. Hoy suma una porción más en el almuerzo o la cena.`;
  } else {
    tono = bajar ? 'ojo' : 'casi';
    txt = bajar
      ? `Te pasaste ~${r(dif)} kcal por día. Hoy y los próximos días achica un poco los carbohidratos de la cena o cambia un snack por fruta: sin recortar la proteína.`
      : ganar ? `Comiste ~${r(dif)} kcal más por día: está bien para ganar, solo cuida que no suba muy rápido tu peso.`
        : `Te pasaste ~${r(dif)} kcal por día. Hoy achica una porción para compensar.`;
  }
  return `<p class="sem2-veredicto sem2-veredicto--${tono === 'casi' ? 'ojo' : tono}">${esc(txt)}</p>`;
}

/** El resumen de la semana: ritmo del peso, proyección, gasto real, cómo te fue y qué hacer. */
export function htmlSemana(s, { compacto = false } = {}) {
  const real = s.tendencia?.kgSemana ?? null;
  const { min, max } = s.ritmo;
  const centro = (min + max) / 2;
  const bajar = centro < -0.05, subir = centro > 0.05;
  const estadoRitmo = real == null ? 'sin' : real >= min - 0.05 && real <= max + 0.05 ? 'ok'
    : (bajar ? (real > max ? 'lento' : 'rapido') : subir ? (real < min ? 'contra' : 'rapido') : 'fuera');
  // Va en contra del objetivo: quiere subir y baja, o quiere bajar y sube.
  const contra = real != null && ((subir && real < -0.05) || (bajar && real > 0.05));
  const est = contra ? 'contra' : estadoRitmo;
  const kgAbs = (v) => kgTxt(Math.abs(v), false, 2);
  const ideal = bajar ? `bajar ${kgAbs(max)}–${kgAbs(min)} kg` : subir ? `subir ${kgAbs(min)}–${kgAbs(max)} kg` : 'mantenerte (±' + kgAbs(max) + ' kg)';
  const tuRitmo = real == null ? 'sin datos' : Math.abs(real) < 0.05 ? 'estable' : real < 0 ? `bajando ${kgAbs(real)} kg` : `subiendo ${kgAbs(real)} kg`;
  const veredicto = {
    sin: ['', 'Pésate 2 o 3 veces por semana, al levantarte, para ver tu ritmo.'],
    ok: ['ok', '✓ Vas al ritmo ideal. Sigue así.'],
    lento: ['ojo', 'Vas más lento de lo ideal. Bloq ya ajustó tu meta de calorías.'],
    rapido: ['ojo', bajar ? 'Vas más rápido de lo ideal: puede costar músculo. Bloq sumó calorías a tu meta.' : 'Subes más rápido de lo ideal: puede ser grasa. Bloq restó un poco a tu meta.'],
    fuera: ['ojo', 'Tu peso se está moviendo. Bloq ajustó tu meta para mantenerte.'],
    contra: ['mal', subir ? `Estás bajando de peso y tu objetivo es subir. Come un poco más: Bloq ya sumó calorías a tu meta.` : `Estás subiendo de peso y tu objetivo es bajar. Bloq restó calorías a tu meta.`],
  }[est];
  const escala = 1;
  const pos = (v) => `${((Math.max(-escala, Math.min(escala, v)) + escala) / (2 * escala)) * 100}%`;

  const barras = s.porDia.map((d) => {
    const pct = d.metas.ok && d.metas.kcal ? Math.min(140, Math.round(d.comido.kcal / d.metas.kcal * 100)) : 0;
    const cls = !d.registrado ? 'sin' : d.diag?.estado === 'justo' ? 'ok' : d.diag?.estado === 'pasado' ? 'pasado' : 'falta';
    return `<div class="semana-dia"><div class="semana-dia__barra"><span class="semana-dia__fill semana-dia__fill--${cls}" style="height:${Math.max(4, pct * 0.7)}%"></span><i class="semana-dia__meta"></i></div>
      <span class="semana-dia__nombre">${esc(diaCorto(d.fecha).slice(0, 2))}</span>${d.hechos ? '<span class="semana-dia__entreno" title="Entreno hecho">●</span>' : '<span class="semana-dia__entreno semana-dia__entreno--no"></span>'}</div>`;
  }).join('');
  const g = s.gasto;
  const difGasto = g?.listo && s.gastoEstimado ? g.kcal - s.gastoEstimado : null;
  const reg = s.registrados || 0;

  return `
    <div class="sem2">
      <section class="sem2-ritmo sem2-ritmo--${est}">
        <p class="sem2-titulo">Ritmo de tu peso <span>por semana</span></p>
        <div class="sem2-ritmo__datos">
          <div><span>${IC.objetivo} Ideal para tu objetivo</span><strong>${esc(ideal)}</strong></div>
          <div><span>${IC.ritmo} Tu ritmo (4 semanas)</span><strong class="sem2-ritmo__real">${esc(tuRitmo)}</strong></div>
        </div>
        <div class="sem2-escala" aria-hidden="true">
          <div class="sem2-escala__pista">
            <span class="sem2-escala__zona" style="left:${pos(Math.min(min, max))};width:calc(${pos(Math.max(min, max))} - ${pos(Math.min(min, max))})"><em>ideal</em></span>
            ${real != null ? `<span class="sem2-escala__tu" style="left:${pos(real)}"><em>tú</em></span>` : ''}
          </div>
          <div class="sem2-escala__marcas"><span>−1 kg</span><span>−0,5</span><span>0</span><span>+0,5</span><span>+1 kg</span></div>
        </div>
        <p class="sem2-veredicto sem2-veredicto--${veredicto[0]}">${esc(veredicto[1])}</p>
      </section>

      ${s.proyeccion ? `
      <section class="sem2-proy sem2-ritmo--${est}">
        <p class="sem2-titulo">Tu peso en 4 semanas</p>
        ${graficoProyeccion(s, est)}
        <p class="sem2-veredicto sem2-veredicto--${veredicto[0]}">${s.proyeccion.real != null
          ? `A este ritmo llegarías a <strong>${kgTxt(s.proyeccion.real, false, 1)} kg</strong>. La banda verde es donde deberías estar según tu objetivo (${kgTxt(s.pesoActual + min * 4, false, 1)}–${kgTxt(s.pesoActual + max * 4, false, 1)} kg).`
          : 'La banda verde es donde deberías estar según tu objetivo. Con más pesajes aparece tu línea.'}</p>
      </section>` : ''}

      <section class="sem2-gasto">
        <span class="sem2-gasto__icono" aria-hidden="true">${IC.fuego}</span>
        <div>${g?.listo
          ? `<strong>Tu gasto real: ~${r(g.kcal)} kcal/día</strong><span>Aprendido de ${g.diasRegistrados} días de comidas y ${g.pesajes} pesajes${difGasto != null && Math.abs(difGasto) >= 120 ? ` · ${difGasto > 0 ? `${r(difGasto)} más` : `${r(-difGasto)} menos`} de lo que estimaba Bloq` : ''}.</span>`
          : `<strong>Aprendiendo tu metabolismo</strong><span>Con ${g?.falta?.dias ? `${g.falta.dias} día${g.falta.dias === 1 ? '' : 's'} más de comidas registradas` : ''}${g?.falta?.dias && (g?.falta?.pesajes || g?.falta?.rango) ? ' y ' : ''}${g?.falta?.pesajes ? `${g.falta.pesajes} pesaje${g.falta.pesajes === 1 ? '' : 's'} más` : g?.falta?.rango ? 'pesajes en al menos 10 días' : ''} Bloq calcula cuánto gastas de verdad.</span>`}</div>
      </section>

      <section class="sem2-filas">
        <p class="sem2-titulo">Cómo te fue <span>últimos 7 días</span></p>
        ${filasComoTeFue(s).join('')}
      </section>

      <section class="sem2-detalle">
        <p class="sem2-titulo">Calorías día por día</p>
        <div class="sem2-detalle__cont">
          ${consejoCalorias(s)}
          <div class="semana-dias">${barras}</div>
          <p class="sem2-leyenda"><span><i class="sem2-leyenda__meta"></i> meta del día</span><span><b>●</b> entreno hecho</span><span><i class="sem2-leyenda__ok"></i> en tu meta</span></p>
        </div>
      </section>

      <section class="sem2-plan">
        <p class="sem2-titulo">Qué hacer esta semana</p>
        ${s.sugerencias.map((x, k) => `<div class="sem2-plan__item" style="--k:${k}"><span class="sem2-plan__icono" aria-hidden="true">${x.icono ?? ''}</span><div><strong>${esc(x.titulo)}</strong><p>${esc(x.texto)}</p></div></div>`).join('')}
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
