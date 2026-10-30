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
  return {
    racha, persona, ini, fin, foco, porDia, registrados: registrados.length, enMeta, protOk, kcalComida, kcalMeta, protComida, protMeta,
    agendados, hechos, suenoProm, aguaPct, pesoIni, pesoFin, tendencia, sugerencias: sugerencias.slice(0, 3).map((x) => x.t),
  };
}

function htmlSemana(s) {
  const kpi = (valor, etiqueta, ok) => `<div class="semana-kpi ${ok === true ? 'semana-kpi--ok' : ok === false ? 'semana-kpi--ojo' : ''}"><strong>${valor}</strong><span>${etiqueta}</span></div>`;
  const kg = (n) => `${n.toLocaleString('es-EC', { maximumFractionDigits: 1 })} kg`;
  const cambio = s.pesoIni != null && s.pesoFin != null ? s.pesoFin - s.pesoIni : null;
  const ganar = s.foco === 'masa_muscular';
  const pesoOk = cambio == null ? null : ganar ? cambio >= 0 : s.foco === 'perder_grasa' || s.foco === 'recomposicion' ? cambio <= 0.2 : Math.abs(cambio) < 0.5;
  const barras = s.porDia.map((d) => {
    const pct = d.metas.ok && d.metas.kcal ? Math.min(140, Math.round(d.comido.kcal / d.metas.kcal * 100)) : 0;
    const cls = !d.registrado ? 'sin' : d.diag?.estado === 'justo' ? 'ok' : d.diag?.estado === 'pasado' ? 'pasado' : 'falta';
    return `<div class="semana-dia"><div class="semana-dia__barra"><span class="semana-dia__fill semana-dia__fill--${cls}" style="height:${Math.max(4, pct * 0.7)}%"></span><i class="semana-dia__meta"></i></div>
      <span class="semana-dia__nombre">${esc(diaCorto(d.fecha).slice(0, 2))}</span>${d.hechos ? '<span class="semana-dia__entreno" title="Entreno hecho">●</span>' : '<span class="semana-dia__entreno semana-dia__entreno--no"></span>'}</div>`;
  }).join('');
  return `
    <p class="quieto" style="margin:-6px 0 0">${esc(diaCorto(s.ini))} ${numeroDia(s.ini)} – ${esc(diaCorto(s.fin))} ${numeroDia(s.fin)} · ${esc(OBJETIVOS[s.foco]?.nombre ?? '')}</p>
    <div class="semana-kpis">
      ${kpi(cambio == null ? '—' : `${cambio > 0 ? '+' : ''}${kg(cambio)}`, s.pesoFin != null ? `peso (${kg(s.pesoFin)})` : 'pésate para ver el cambio', pesoOk)}
      ${kpi(`${s.enMeta}/${s.registrados || 0}`, 'días en tu meta de calorías', s.registrados ? s.enMeta >= s.registrados * 0.6 : null)}
      ${kpi(`${s.protOk}/${s.registrados || 0}`, 'días con tu proteína', s.registrados ? s.protOk >= s.registrados * 0.6 : null)}
      ${kpi(`${s.hechos}/${s.agendados}`, 'entrenos hechos', s.agendados ? s.hechos / s.agendados >= 0.7 : null)}
      ${kpi(s.suenoProm != null ? `${(s.suenoProm / 60).toFixed(1).replace('.', ',')} h` : '—', 'sueño promedio', s.suenoProm != null ? s.suenoProm >= 420 : null)}
      ${kpi(s.aguaPct != null ? `${Math.round(s.aguaPct * 100)} %` : '—', 'de tu agua', s.aguaPct != null ? s.aguaPct >= 0.8 : null)}
    </div>
    ${s.racha ? `<p class="racha">🔥 Racha: ${s.racha} semana${s.racha === 1 ? '' : 's'} seguida${s.racha === 1 ? '' : 's'} cumpliendo los gyms</p>` : ''}
    <section class="semana-grafico" aria-label="Calorías por día frente a la meta">
      <p class="seccion__titulo" style="margin:0 0 8px">Calorías frente a tu meta</p>
      <div class="semana-dias">${barras}</div>
      <p class="ayuda" style="margin:8px 0 0">La línea es tu meta de cada día (cambia con los entrenos). ● = entreno hecho.</p>
    </section>
    <section>
      <p class="seccion__titulo" style="margin:0 0 8px">Para esta semana</p>
      <ol class="semana-sugerencias">${s.sugerencias.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
    </section>`;
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
