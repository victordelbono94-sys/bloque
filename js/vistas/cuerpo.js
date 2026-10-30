// Pantalla Cuerpo: peso y bioimpedancia de cada uno, con su tendencia.
// Cada medición es un registro nuevo; nunca se sobrescribe el historial.
import { sb, estado, datos, nombrePersona } from '../db.js';
import { esc, num, aviso, avisoError, abrirDialogo, grupoChips, valorChips, cara } from '../ui.js';
import { fabIA, htmlCabecera } from '../chatia.js';
import { SILUETA, IC } from '../iconos.js';
import { fechaCorta, ahoraLocalInput } from '../fechas.js';

const CAMPOS = [
  { id: 'peso_kg', etiqueta: 'Peso', unidad: 'kg', min: 30, max: 250, paso: 0.1 },
  { id: 'grasa_pct', etiqueta: 'Grasa', unidad: '%', min: 2, max: 70, paso: 0.1 },
  { id: 'masa_muscular_kg', etiqueta: 'Masa muscular', unidad: 'kg', min: 5, max: 120, paso: 0.1 },
  { id: 'masa_magra_kg', etiqueta: 'Masa magra', unidad: 'kg', min: 10, max: 150, paso: 0.1 },
  { id: 'agua_pct', etiqueta: 'Agua', unidad: '%', min: 20, max: 80, paso: 0.1 },
  { id: 'grasa_visceral', etiqueta: 'Grasa visceral', unidad: '', min: 1, max: 60, paso: 0.5 },
  { id: 'masa_osea_kg', etiqueta: 'Masa ósea', unidad: 'kg', min: 0.5, max: 10, paso: 0.01 },
  { id: 'metabolismo_basal_kcal', etiqueta: 'Metabolismo basal', unidad: 'kcal', min: 600, max: 4500, paso: 1 },
  { id: 'masa_grasa_kg', etiqueta: 'Masa grasa', unidad: 'kg', min: 1, max: 200, paso: 0.1 },
  { id: 'musculo_esqueletico_kg', etiqueta: 'Músculo esquelético', unidad: 'kg', min: 5, max: 100, paso: 0.1 },
  { id: 'agua_intracelular_l', etiqueta: 'Agua intracelular', unidad: 'L', min: 5, max: 60, paso: 0.1 },
  { id: 'agua_extracelular_l', etiqueta: 'Agua extracelular', unidad: 'L', min: 3, max: 40, paso: 0.1 },
  { id: 'angulo_fase', etiqueta: 'Ángulo de fase', unidad: '°', min: 1, max: 15, paso: 0.1 },
];

const ORIGENES = { manual: 'A mano', balanza: 'Balanza', hospital: 'Hospital deportivo', health_connect: 'Health Connect' };

// Todo lo que trae una bioimpedancia. nivel: cuánto se «llena» la silueta. bueno: hacia dónde conviene que vaya.
const METRICAS = [
  { id: 'peso_kg', nombre: 'Peso', unidad: 'kg', color: '#C6F432', info: 'Lo que pesas en total. Mira la tendencia de semanas, no un día.' },
  { id: 'grasa_pct', nombre: 'Grasa', unidad: '%', color: '#F5B841', bueno: -1, nivel: (v) => Math.min(1, v / 45), info: 'Porcentaje de tu peso que es grasa.' },
  { id: 'masa_grasa_kg', nombre: 'Masa grasa', unidad: 'kg', color: '#F5B841', bueno: -1, nivel: (v, p) => (p ? Math.min(1, v / p / 0.45) : 0.4), info: 'Los kilos de grasa total.' },
  { id: 'grasa_visceral', nombre: 'Visceral', unidad: '', color: '#FF8B6B', bueno: -1, info: 'Grasa alrededor de los órganos del abdomen. En la mayoría de balanzas, 1–12 es el rango habitual.' },
  { id: 'masa_muscular_kg', nombre: 'Músculo', unidad: 'kg', color: '#7CF2B6', bueno: 1, nivel: (v, p) => (p ? Math.min(1, v / p / 0.6) : 0.6), info: 'Kilos de músculo (incluye el agua del músculo).' },
  { id: 'musculo_esqueletico_kg', nombre: 'Esquelético', unidad: 'kg', color: '#5EE6C8', bueno: 1, nivel: (v, p) => (p ? Math.min(1, v / p / 0.5) : 0.5), info: 'El músculo que mueves al entrenar: el que más importa para la fuerza.' },
  { id: 'masa_magra_kg', nombre: 'Masa magra', unidad: 'kg', color: '#9AD0FF', bueno: 1, nivel: (v, p) => (p ? Math.min(1, v / p) : 0.8), info: 'Todo lo que no es grasa: músculo, huesos, órganos y agua.' },
  { id: 'agua_pct', nombre: 'Agua', unidad: '%', color: '#4FC3F7', bueno: 1, nivel: (v) => v / 100, info: 'Agua corporal total. Se ve afectada por lo que tomaste, la sal y el entreno del día.' },
  { id: 'masa_osea_kg', nombre: 'Ósea', unidad: 'kg', color: '#D7D9DE', info: 'Estimación de los minerales de tus huesos. Cambia muy poco.' },
  { id: 'metabolismo_basal_kcal', nombre: 'Basal', unidad: 'kcal', color: '#FF8B6B', bueno: 1, dec: 0, info: 'Calorías que tu cuerpo gasta en reposo. Sube cuando ganas músculo.' },
  { id: 'angulo_fase', nombre: 'Ángulo de fase', unidad: '°', color: '#B79CFF', bueno: 1, nivel: (v) => Math.min(1, v / 10), info: 'Refleja la salud y la hidratación de tus células: más alto suele ser mejor.' },
];
const PRINCIPALES = ['peso_kg', 'grasa_pct', 'masa_muscular_kg', 'agua_pct', 'grasa_visceral', 'metabolismo_basal_kcal'];

/** Completa lo que se puede calcular de una misma medición (masa grasa y magra a partir del peso y el %). */
function completar(m) {
  const x = { ...m };
  if (x.masa_grasa_kg == null && x.peso_kg != null && x.grasa_pct != null) x.masa_grasa_kg = Math.round(Number(x.peso_kg) * Number(x.grasa_pct)) / 100;
  if (x.masa_magra_kg == null && x.peso_kg != null && x.masa_grasa_kg != null) x.masa_magra_kg = Math.round((Number(x.peso_kg) - Number(x.masa_grasa_kg)) * 10) / 10;
  return x;
}

function htmlCuerpoVisual(m, valor, peso) {
  const nivel = m.nivel ? m.nivel(valor, peso) : 1;
  const alto = 94 * nivel, y = 94 - alto;
  const id = `c${Math.random().toString(36).slice(2, 7)}`;
  return `
    <svg class="cuerpo-svg" viewBox="0 0 50 94" aria-hidden="true">
      <defs><clipPath id="${id}"><path d="${SILUETA}"/></clipPath>
        <linearGradient id="${id}g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${m.color}"/><stop offset="1" stop-color="${m.color}" stop-opacity=".55"/></linearGradient></defs>
      <path class="cuerpo-svg__base" d="${SILUETA}"/>
      <g clip-path="url(#${id})">
        ${m.id === 'grasa_visceral'
          ? `<ellipse cx="25" cy="40" rx="${5 + Math.min(7, valor * 0.5)}" ry="${4 + Math.min(5, valor * 0.35)}" fill="${m.color}" opacity="${Math.min(0.95, 0.4 + valor / 20)}" class="cuerpo-svg__visceral"/>`
          : `<rect class="cuerpo-svg__nivel" x="0" y="${y}" width="50" height="${alto}" fill="url(#${id}g)"/>
             ${m.id === 'agua_pct' ? `<path class="cuerpo-svg__ola" d="M-6 ${y} q6 -2.5 12 0 t12 0 t12 0 t12 0 t12 0 v4 h-60z" fill="${m.color}" opacity=".7"/>` : ''}`}
      </g>
      ${m.nivel ? `<line class="cuerpo-svg__linea" x1="2" x2="48" y1="${y}" y2="${y}" stroke="${m.color}"/>` : ''}
    </svg>`;
}

function sparkline(puntos, color) {
  if (puntos.length < 2) return '';
  const ys = puntos.map((p) => p.valor), xs = puntos.map((p) => p.fecha.getTime());
  const y0 = Math.min(...ys), y1 = Math.max(...ys), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const X = (t) => 2 + ((t - x0) / (x1 - x0 || 1)) * 196, Y = (v) => 40 - ((v - y0) / (y1 - y0 || 1)) * 34;
  const d = puntos.map((p, i) => `${i ? 'L' : 'M'}${X(p.fecha.getTime()).toFixed(1)} ${Y(p.valor).toFixed(1)}`).join(' ');
  const u = puntos.at(-1);
  return `<svg class="sparkline" viewBox="0 0 200 44" preserveAspectRatio="none" aria-hidden="true">
    <path d="${d} L198 44 L2 44Z" fill="${color}" opacity=".12"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" pathLength="1" class="sparkline__linea"/>
    <circle cx="${X(u.fecha.getTime())}" cy="${Y(u.valor)}" r="3" fill="${color}"/></svg>`;
}

const ICONO_HISTORIAL = '<svg class="icono" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4h4"/><path d="M12 7.5V12l3 2"/></svg>';

// ---------- Historial: cómo estabas antes y cómo estás hoy ----------
const PERIODOS = [['30', '1 mes'], ['90', '3 meses'], ['todo', 'Todo']];
function compararPeriodo(mediciones, dias, foco) {
  const cron = [...mediciones].reverse();
  const ultima = (id) => mediciones.find((m) => m[id] != null);
  const limite = dias === 'todo' ? null : Date.now() - Number(dias) * 864e5;
  const inicial = (id) => (limite == null ? cron.find((m) => m[id] != null)
    : (cron.filter((m) => m[id] != null && new Date(m.medido_en).getTime() <= limite).at(-1) ?? cron.find((m) => m[id] != null && new Date(m.medido_en).getTime() >= limite)));
  return METRICAS.map((m) => {
    const a = inicial(m.id), b = ultima(m.id);
    if (!a || !b || a === b) return null;
    const cambio = Number(b[m.id]) - Number(a[m.id]);
    const bueno = m.id === 'peso_kg' ? ({ masa_muscular: 1, perder_grasa: -1, recomposicion: -1 }[foco] ?? 0) : (m.bueno ?? 0);
    const tono = Math.abs(cambio) < 0.1 || !bueno ? 'igual' : Math.sign(cambio) === bueno ? 'bien' : 'ojo';
    return { m, antes: Number(a[m.id]), ahora: Number(b[m.id]), cambio, tono, desde: a.medido_en };
  }).filter(Boolean);
}
function resumenProgreso(filas, foco) {
  const de = (id) => filas.find((f) => f.m.id === id);
  const g = de('grasa_pct'), mu = de('masa_muscular_kg'), p = de('peso_kg');
  const logros = [], falta = [];
  if (g && mu) {
    if (g.cambio < -0.3 && mu.cambio >= -0.2) logros.push('Bajaste grasa sin perder músculo: es justo lo que se busca.');
    else if (g.cambio < -0.3 && mu.cambio < -0.2) { logros.push(`Bajaste ${num(Math.abs(g.cambio))} % de grasa.`); falta.push(`También bajó ${num(Math.abs(mu.cambio))} kg de músculo: sube la proteína y no recortes tantas calorías.`); }
    else if (mu.cambio > 0.3 && g.cambio <= 0.3) logros.push(`Ganaste ${num(mu.cambio)} kg de músculo sin sumar grasa.`);
    else if (mu.cambio > 0.3 && g.cambio > 0.3) { logros.push(`Ganaste ${num(mu.cambio)} kg de músculo.`); falta.push(foco === 'masa_muscular' ? `La grasa subió ${num(g.cambio)} %: si quieres frenarla, come un poco menos de lo que comes ahora.` : `La grasa subió ${num(g.cambio)} %, y tu objetivo es bajarla: revisa porciones y snacks, y sigue tu meta de calorías.`); }
    else if (g.cambio > 0.3) falta.push(`La grasa subió ${num(g.cambio)} %: revisa las porciones y los snacks.`);
  } else if (g) {
    if (g.cambio < -0.3) logros.push(`Bajaste ${num(Math.abs(g.cambio))} % de grasa.`); else if (g.cambio > 0.3) falta.push(`La grasa subió ${num(g.cambio)} %.`);
  }
  if (p) {
    const quiere = { masa_muscular: 'subir', perder_grasa: 'bajar', recomposicion: 'bajar' }[foco];
    if (quiere === 'subir' && p.cambio < -0.3) falta.push(`Tu peso bajó ${num(Math.abs(p.cambio))} kg y tu objetivo es subir: hace falta comer más.`);
    else if (quiere === 'bajar' && p.cambio > 0.3) falta.push(`Tu peso subió ${num(p.cambio)} kg y tu objetivo es bajar.`);
    else if (quiere && Math.abs(p.cambio) >= 0.3) logros.push(`Tu peso ${p.cambio < 0 ? 'bajó' : 'subió'} ${num(Math.abs(p.cambio))} kg, en línea con tu objetivo.`);
  }
  if (!g) falta.push('Carga tu % de grasa (bioimpedancia) para ver si cambia grasa o músculo, no solo el peso.');
  return { logros, falta };
}
const tabs = (per) => `<div class="cuerpo-hero__tabs hist-tabs" role="tablist">${[...PERIODOS, ['semana', 'Por semana'], ['mes', 'Por mes']].map(([k, t]) => `<button type="button" class="cuerpo-tab" data-per="${k}" aria-selected="${k === per}" style="--c:#C6F432">${t}</button>`).join('')}</div>`;
function abrirHistorial(persona, mediciones, foco, soyYo, recargar) {
  const d = abrirDialogo(`<div class="reg chatia">${htmlCabecera({ titulo: 'Tu progreso', sub: `${mediciones.length} medicion${mediciones.length === 1 ? '' : 'es'}` })}<div class="chatia__cuerpo" id="hist"></div></div>`, 'Historial', { pantalla: true });
  const cont = d.querySelector('#hist');
  // Por semana o por mes: el promedio de cada período y cuánto cambió frente al anterior.
  const agrupado = (modo) => {
    const clave = (f) => {
      const x = new Date(f);
      if (modo === 'mes') return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
      const l = new Date(x); l.setDate(x.getDate() - ((x.getDay() + 6) % 7));
      return `${l.getFullYear()}-${String(l.getMonth() + 1).padStart(2, '0')}-${String(l.getDate()).padStart(2, '0')}`;
    };
    const grupos = new Map();
    for (const m of [...mediciones].reverse()) { const k = clave(m.medido_en); (grupos.get(k) ?? grupos.set(k, []).get(k)).push(m); }
    const ids = ['peso_kg', 'grasa_pct', 'masa_muscular_kg', 'agua_pct'];
    const filas = [...grupos.entries()].map(([k, ms]) => ({ k, v: Object.fromEntries(ids.map((id) => { const xs = ms.map((m) => m[id]).filter((v) => v != null).map(Number); return [id, xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null]; })) }));
    const nombre = (k) => (modo === 'mes'
      ? new Date(`${k}-15T12:00`).toLocaleDateString('es-EC', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase())
      : `Semana del ${new Date(`${k}T12:00`).toLocaleDateString('es-EC', { day: 'numeric', month: 'short' })}`);
    const cols = ids.filter((id) => filas.some((f) => f.v[id] != null));
    return `
      <div class="per-tabla" style="--cols:${cols.length}">
        <div class="per-tabla__cab"><span></span>${cols.map((id) => `<span>${METRICAS.find((m) => m.id === id).nombre}</span>`).join('')}</div>
        ${filas.slice(-12).reverse().map((f, i, arr) => {
          const prev = arr[i + 1];
          return `<div class="per-tabla__fila"><span class="per-tabla__nombre">${esc(nombre(f.k))}</span>${cols.map((id) => {
            const v = f.v[id], p = prev?.v[id];
            const m = METRICAS.find((x) => x.id === id);
            const bueno = id === 'peso_kg' ? ({ masa_muscular: 1, perder_grasa: -1, recomposicion: -1 }[foco] ?? 0) : (m.bueno ?? 0);
            const dif = v != null && p != null ? v - p : null;
            const tono = dif == null || Math.abs(dif) < 0.1 || !bueno ? '' : Math.sign(dif) === bueno ? 'bien' : 'ojo';
            return `<span>${v == null ? '<em>—</em>' : `<strong>${num(v)}</strong>${dif != null && Math.abs(dif) >= 0.1 ? `<small class="per-dif per-dif--${tono}">${dif > 0 ? '+' : ''}${num(dif)}</small>` : ''}`}</span>`;
          }).join('')}</div>`;
        }).join('')}
      </div>`;
  };
  const pintar = (per) => {
    if (per === 'semana' || per === 'mes') {
      cont.innerHTML = `${tabs(per)}${agrupado(per)}<p class="ayuda" style="margin:0">Promedio de las mediciones de cada ${per === 'mes' ? 'mes' : 'semana'}; al lado, cuánto cambió frente al anterior (verde si va hacia tu objetivo).</p>`;
      cont.querySelectorAll('[data-per]').forEach((b) => b.addEventListener('click', () => pintar(b.dataset.per)));
      return;
    }
    const filas = compararPeriodo(mediciones, per, foco);
    const { logros, falta } = resumenProgreso(filas, foco);
    cont.innerHTML = `
      ${tabs(per)}
      ${filas.length ? `
        <section class="prog">
          <p class="sem2-titulo">Antes y ahora <span>desde ${esc(fechaCorta(filas[0].desde))}</span></p>
          ${filas.map((f) => `
            <div class="prog__fila prog__fila--${f.tono}">
              <span class="prog__nombre" style="--c:${f.m.color}">${f.m.nombre}</span>
              <span class="prog__antes">${num(f.antes)}</span>
              <span class="prog__flecha" aria-hidden="true">→</span>
              <span class="prog__ahora">${num(f.ahora)} <small>${f.m.unidad}</small></span>
              <span class="prog__cambio">${f.cambio > 0 ? '+' : ''}${num(f.cambio)}</span>
            </div>`).join('')}
        </section>
        ${logros.length ? `<section class="prog-caja prog-caja--bien"><strong>${IC.check} Lo que mejoraste</strong>${logros.map((t) => `<p>${esc(t)}</p>`).join('')}</section>` : ''}
        ${falta.length ? `<section class="prog-caja prog-caja--ojo"><strong>Qué falta mejorar</strong>${falta.map((t) => `<p>${esc(t)}</p>`).join('')}</section>` : ''}`
        : '<p class="vacio">Con dos mediciones o más en este período aparece la comparación.</p>'}
      <section class="seccion" style="margin:0">
        <p class="sem2-titulo">Todas las mediciones</p>
        <div class="tarjeta">${mediciones.length ? mediciones.map((m) => itemMedicion(m, soyYo)).join('') : '<p class="vacio">Todavía no hay mediciones.</p>'}</div>
      </section>`;
    cont.querySelectorAll('[data-per]').forEach((b) => b.addEventListener('click', () => pintar(b.dataset.per)));
    cont.querySelectorAll('[data-borrar]').forEach((b) => b.addEventListener('click', () => borrarMedicion(b.dataset.borrar, () => { d.close(); recargar(); })));
  };
  pintar(mediciones.length > 1 && (Date.now() - new Date(mediciones.at(-1).medido_en)) > 90 * 864e5 ? '90' : 'todo');
}

export async function vistaCuerpo(app) {
  const param = location.hash.split('/')[2];
  const persona = estado.personas.find((p) => p.id === param) ?? estado.yo;
  const soyYo = persona.id === estado.yo.id;

  const [crudas, objetivo] = await Promise.all([
    sb.from('mediciones_corporales').select('*').eq('persona_id', persona.id).order('medido_en', { ascending: false }).limit(200).then(datos),
    sb.from('objetivos').select('foco').eq('persona_id', persona.id).order('desde', { ascending: false }).limit(1).then(datos).catch(() => []),
  ]);
  const mediciones = crudas.map(completar);
  const foco = objetivo[0]?.foco ?? 'recomposicion';
  const cronologico = [...mediciones].reverse();
  const conDatos = METRICAS.filter((m) => mediciones.some((x) => x[m.id] != null));
  let elegida = (() => { try { return sessionStorage.getItem('bloque-cuerpo-metrica'); } catch { return null; } })();
  if (!conDatos.some((m) => m.id === elegida)) elegida = conDatos[0]?.id ?? 'peso_kg';
  const pesoActual = Number(mediciones.find((m) => m.peso_kg != null)?.peso_kg) || null;

  const htmlMetrica = (id) => {
    const m = METRICAS.find((x) => x.id === id);
    const puntos = cronologico.filter((x) => x[id] != null).map((x) => ({ fecha: new Date(x.medido_en), valor: Number(x[id]) }));
    if (!puntos.length) return '<p class="quieto" style="margin:0">Sin datos todavía.</p>';
    const u = puntos.at(-1);
    const hace = puntos.filter((p) => p.fecha <= new Date(u.fecha.getTime() - 25 * 864e5)).at(-1) ?? puntos[0];
    const cambio = u.valor - hace.valor;
    const bueno = m.id === 'peso_kg' ? ({ masa_muscular: 1, perder_grasa: -1, recomposicion: -1 }[foco] ?? 0) : (m.bueno ?? 0);
    const tono = !puntos.length || hace === u || Math.abs(cambio) < 0.05 || !bueno ? '' : Math.sign(cambio) === bueno ? 'bien' : 'ojo';
    const dec = m.dec ?? 1;
    return `
      <div class="cuerpo-hero__visual">${htmlCuerpoVisual(m, u.valor, pesoActual)}</div>
      <div class="cuerpo-hero__datos">
        <span class="cuerpo-hero__nombre">${m.nombre}</span>
        <span class="cuerpo-hero__valor"><strong>${num(u.valor, dec)}</strong>${m.unidad ? `<small>${m.unidad}</small>` : ''}</span>
        ${hace !== u ? `<span class="cuerpo-hero__cambio cuerpo-hero__cambio--${tono}">${cambio > 0 ? '▲' : cambio < 0 ? '▼' : '='} ${num(Math.abs(cambio), dec)} ${m.unidad} <span>desde ${esc(fechaCorta(hace.fecha))}</span></span>` : ''}
        ${sparkline(puntos.slice(-14), m.color)}
        <span class="cuerpo-hero__fecha">Última medición: ${esc(fechaCorta(u.fecha))}</span>
      </div>
      <p class="cuerpo-hero__info">${esc(m.info)}</p>`;
  };
  // Tiles con todo lo de la bioimpedancia (lo que no tiene dato queda en gris, invitando a cargarlo).
  const ultimoDe = (id) => mediciones.find((x) => x[id] != null);
  const visibles = METRICAS.filter((m) => PRINCIPALES.includes(m.id) || ultimoDe(m.id));
  const htmlTiles = (sel) => visibles.map((m) => {
    const u = ultimoDe(m.id);
    return `<button type="button" class="cuerpo-tile ${u ? '' : 'cuerpo-tile--sin'}" data-metrica="${m.id}" aria-pressed="${m.id === sel}" style="--c:${m.color}" ${u ? '' : 'data-sin="1"'}>
      <small>${m.nombre}</small><strong>${u ? num(Number(u[m.id]), m.dec ?? 1) : '—'}${u && m.unidad ? `<em>${m.unidad}</em>` : ''}</strong></button>`;
  }).join('');
  // ¿La última bioimpedancia (con % de grasa) tiene más de un mes?
  const bio = mediciones.find((x) => x.grasa_pct != null || x.masa_muscular_kg != null);
  const diasBio = bio ? Math.floor((Date.now() - new Date(bio.medido_en)) / 864e5) : null;
  const avisoBio = soyYo && (diasBio == null || diasBio > 30) ? `
    <section class="tarjeta aviso-bio">
      <span class="aviso-bio__icono">${IC.balanza}</span>
      <div><strong>${diasBio == null ? 'Haz una prueba de bioimpedancia' : 'Tus datos de composición están desactualizados'}</strong>
      <p>${diasBio == null ? 'Con tu % de grasa, músculo y agua, Bloq calcula tus metas sobre tu masa magra y ves si cambia grasa o músculo.' : `Tu última bioimpedancia es de hace ${diasBio} días. Se aconseja una nueva una vez al mes para que tus metas sigan precisas.`}</p>
      <button type="button" class="boton boton--sec boton--chico" id="cargar-bio">Cargar resultados</button></div>
    </section>` : '';

  app.innerHTML = `
    <header class="encabezado encabezado--fijo">
      <div>
        <h1 class="titulo">Cuerpo</h1>
        <p class="subtitulo">${soyYo ? 'Tu peso y composición esta semana' : `Peso y composición de ${esc(persona.nombre)}`}</p>
      </div>
      <button type="button" class="boton boton--sec boton--chico nav-dia" id="ver-historial" aria-label="Historial y progreso">${ICONO_HISTORIAL}</button>
    </header>

    ${estado.personas.length > 1 ? `
      <div class="ver-persona" role="tablist" aria-label="Persona">
        ${estado.personas.map((p) => `<a class="ver-persona__op" role="tab" href="#/cuerpo/${esc(p.id)}" aria-selected="${p.id === persona.id}" style="text-decoration:none;color:inherit">
          <span class="ver-persona__cara">${cara(p)}</span><span>${esc(p.id === estado.yo.id ? 'Yo' : p.nombre)}</span></a>`).join('')}
      </div>` : ''}

    ${conDatos.length ? `
      <section class="tarjeta cuerpo-hero">
        <div class="cuerpo-hero__fila" id="cuerpo-metrica">${htmlMetrica(elegida)}</div>
        <div class="cuerpo-tiles" aria-label="Tu composición">${htmlTiles(elegida)}</div>
      </section>
      ${avisoBio}` : `
      <section class="tarjeta cuerpo-vacio">
        <p style="margin:0"><strong>${soyYo ? 'Carga tu primera medición' : `${esc(persona.nombre)} todavía no tiene mediciones`}</strong></p>
        ${soyYo ? '<p class="quieto" style="margin:6px 0 0">Toca «Nueva medición»: escribe tu peso o mándale a la IA una foto de la balanza o el PDF de tu bioimpedancia.</p>' : ''}
      </section>`}

    <section class="seccion" aria-labelledby="t-semana-cuerpo">
      <h2 class="seccion__titulo" id="t-semana-cuerpo">Esta semana</h2>
      <div id="semana-cuerpo">
        <div class="chatia__msg chatia__msg--ia chatia__msg--solo chatia__msg--pensando" style="background:none;padding:0">${'<span class="cubo" aria-hidden="true"><i></i></span>'}<span class="chatia__frase">Armando tu semana…</span></div>
      </div>
    </section>`;

  const recargar = () => vistaCuerpo(app);
  const abrirIA = async () => (await import('../cuerpoia.js')).abrirCuerpoIA({ alGuardar: recargar, manual: (v) => dialogoMedicion(recargar, v ?? {}) });
  app.querySelector('#cargar-bio')?.addEventListener('click', abrirIA);
  app.querySelectorAll('[data-metrica]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.sin) { if (soyYo) abrirIA(); return; }
    try { sessionStorage.setItem('bloque-cuerpo-metrica', b.dataset.metrica); } catch { /* nada */ }
    app.querySelectorAll('[data-metrica]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    const cont = app.querySelector('#cuerpo-metrica');
    cont.classList.remove('fundido'); void cont.offsetWidth;
    cont.innerHTML = htmlMetrica(b.dataset.metrica);
    cont.classList.add('fundido');
  }));
  app.querySelector('#ver-historial').addEventListener('click', () => abrirHistorial(persona, mediciones, foco, soyYo, recargar));
  if (soyYo) {
    fabIA('Nueva medición', abrirIA, /^#\/cuerpo/);
  } else document.querySelector('.fab-ia')?.remove();

  // La semana (ritmo del peso, proyección, gasto real e indicadores).
  import('../semanal.js').then(async (S) => {
    const cont = app.querySelector('#semana-cuerpo');
    try {
      const sem = await S.calcularSemana(persona);
      if (cont.isConnected) cont.innerHTML = S.htmlSemana(sem, { compacto: true });
    } catch (e) { if (cont.isConnected) cont.innerHTML = `<p class="quieto" style="margin:0">No se pudo armar la semana. ${esc(e.message ?? '')}</p>`; }
  });
}

function itemMedicion(m, soyYo) {
  const valores = CAMPOS
    .filter((c) => m[c.id] != null)
    .map((c) => `<span>${c.etiqueta}: <strong>${num(m[c.id], c.paso < 0.1 ? 2 : c.paso < 1 ? 1 : 0)}</strong>${c.unidad ? ` ${c.unidad}` : ''}</span>`)
    .join('');
  const borrable = soyYo && m.origen !== 'health_connect';
  return `
    <div class="medicion">
      <div class="fila fila--entre">
        <div class="fila" style="gap:8px;flex-wrap:wrap">
          <strong>${esc(fechaCorta(m.medido_en))}</strong>
          <span class="quieto">${esc(ORIGENES[m.origen] ?? m.origen)}</span>
          ${m.es_referencia ? '<span class="etiqueta etiqueta--referencia">Referencia</span>' : ''}
        </div>
        ${borrable ? `<button type="button" class="boton boton--peligro" data-borrar="${esc(m.id)}" aria-label="Eliminar medición del ${esc(fechaCorta(m.medido_en))}">Eliminar</button>` : ''}
      </div>
      <div class="medicion__datos">${valores}</div>
      ${m.notas ? `<p class="quieto" style="margin:6px 0 0">${esc(m.notas)}</p>` : ''}
    </div>`;
}

export function dialogoMedicion(alGuardar, valores = {}) {
  const d = abrirDialogo(`
    <form class="dialogo" novalidate>
      <h2 class="tarjeta__titulo">Nueva medición</h2>

      <div class="campo">
        <label for="medido_en">Fecha y hora</label>
        <input id="medido_en" type="datetime-local" value="${ahoraLocalInput()}" required>
      </div>

      <fieldset class="campo">
        <legend>De dónde viene</legend>
        <div class="chips" id="origen">
          <button type="button" class="chip" data-valor="manual" aria-pressed="true">A mano</button>
          <button type="button" class="chip" data-valor="balanza" aria-pressed="false">Balanza</button>
          <button type="button" class="chip" data-valor="hospital" aria-pressed="false">Hospital deportivo</button>
        </div>
      </fieldset>

      <div class="grilla-2">
        ${CAMPOS.map((c) => `
          <div class="campo">
            <label for="${c.id}">${c.etiqueta}${c.unidad ? ` (${c.unidad})` : ''}</label>
            <input id="${c.id}" type="number" inputmode="decimal" min="${c.min}" max="${c.max}" step="${c.paso}">
          </div>`).join('')}
      </div>

      <label class="campo campo--check" for="es_referencia">
        <input id="es_referencia" type="checkbox">
        Es una medición de referencia
      </label>

      <div class="campo">
        <label for="notas">Notas</label>
        <input id="notas" type="text" maxlength="200" placeholder="Opcional">
      </div>

      <p class="ayuda">Llena solo lo que tengas. Lo que Health Connect soporta se sincroniza con el teléfono.</p>

      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
        <button type="submit" class="boton" id="guardar">Guardar</button>
      </div>
    </form>`, 'Nueva medición', { pantalla: true });

  const origen = d.querySelector('#origen');
  const referencia = d.querySelector('#es_referencia');
  grupoChips(origen, (v) => { referencia.checked = v === 'hospital'; });
  // Si viene de la IA (corregir a mano), se completa con lo que leyó.
  for (const c of CAMPOS) if (valores[c.id] != null) d.querySelector(`#${c.id}`).value = valores[c.id];
  if (valores.medido_en) d.querySelector('#medido_en').value = `${valores.medido_en}T08:00`;
  if (valores.origen) {
    origen.querySelectorAll('[data-valor]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.valor === valores.origen)));
    referencia.checked = valores.origen === 'hospital';
  }

  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fila = {
      persona_id: estado.yo.id,
      medido_en: new Date(d.querySelector('#medido_en').value).toISOString(),
      origen: valorChips(origen),
      es_referencia: referencia.checked,
      notas: d.querySelector('#notas').value.trim() || null,
    };
    let alguno = false;
    for (const c of CAMPOS) {
      const input = d.querySelector(`#${c.id}`);
      if (input.value === '') { fila[c.id] = null; continue; }
      const v = Number(input.value);
      if (!Number.isFinite(v) || v < c.min || v > c.max) {
        input.focus();
        return aviso(`${c.etiqueta}: revisa el valor (entre ${c.min} y ${c.max}).`, 'error');
      }
      fila[c.id] = v;
      alguno = true;
    }
    if (!alguno) return aviso('Ingresa al menos un dato.', 'error');
    if (Number.isNaN(Date.parse(fila.medido_en))) return aviso('Revisa la fecha.', 'error');

    const boton = d.querySelector('#guardar');
    boton.disabled = true;
    try {
      datos(await sb.from('mediciones_corporales').insert(fila));
      d.close();
      aviso('Medición guardada.');
      alGuardar();
    } catch (err) {
      avisoError(err);
      boton.disabled = false;
    }
  });
}

function borrarMedicion(id, alTerminar) {
  const d = abrirDialogo(`
    <div class="dialogo">
      <h2 class="tarjeta__titulo">¿Eliminar la medición?</h2>
      <p>Se borra de Bloq. Si ya se había sincronizado con Health Connect, bórrala también allá.</p>
      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
        <button type="button" class="boton" id="confirmar">Eliminar</button>
      </div>
    </div>`, 'Eliminar medición');
  d.querySelector('#confirmar').addEventListener('click', async () => {
    try {
      datos(await sb.from('mediciones_corporales').delete().eq('id', id));
      d.close();
      aviso('Eliminada.');
      alTerminar();
    } catch (err) {
      avisoError(err);
    }
  });
}
