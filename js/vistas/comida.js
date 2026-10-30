// Pantalla Comida, en tres pestañas:
//   Día      → cuánto falta, registrar rápido (escribir, foto, frecuentes), qué comer ahora y lo comido
//   Semana   → cómo vienen los últimos 7 días contra la meta
//   Despensa → lo que hay en casa (cargado con Gemini) e ideas para cocinar con eso
import { emparejar, esIndividual, asistenciaIndividual, porConfirmar } from '../actividades.js';
import { cargarSyncs } from '../hecho.js';
import { htmlCompositor, conectarCompositor, burbujaPensando, cubo, htmlCabecera, fabIA } from '../chatia.js';
import { deporte } from '../deportes.js';
import { metaAgua, aguaDeComidas, cargarAgua, sumarAgua, borrarAgua, litros } from '../hidratacion.js';
import { sb, estado, datos } from '../db.js';
import { esc, aviso, avisoError, abrirDialogo, cara } from '../ui.js';
import { hoyISO, sumarDias, diaLargo, diaCorto, numeroDia } from '../fechas.js';
import { calcularMetas, consejosDelDia, diagnosticoDia, snacksDelDia, tendenciaPeso, OBJETIVOS } from '../nutricion.js';
import { ritmoEsperado } from '../semanal.js';
import { macros, sumar, cargarCatalogo } from '../alimentos.js';
import { panelBuscar } from '../comida/buscar.js';
import { abrirRegistro } from '../comida/registro.js';
import {
  MOMENTOS, ORDEN_MOMENTO, kc, g, cantidadTexto, momentoPorHora, gemini, fotoBase64, aAlimento, frecuentes, habitualesAhora, normalizar,
} from '../comida/comun.js';

const ICONO_FOTO = '<svg class="icono" viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
const ICONO_CHISPA = '<svg class="icono" viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';

function unir(l) { return l.length < 2 ? l[0] : `${l.slice(0, -1).join(', ')} y ${l.at(-1)}`; }


// ---------- Entrada ----------

export async function vistaComida(app) {
  const param = location.hash.split('/')[2] ?? '';
  const pestana = param === 'semana' ? 'semana' : param === 'despensa' ? 'despensa' : 'dia';
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : hoyISO();
  try {
    await cargarCatalogo();
    // Semana y Despensa ya no son pestañas: se abren como hojas sobre el día de hoy.
    if (pestana !== 'dia') history.replaceState(null, '', `${location.pathname}#/comida`);
    await vistaDia(app, fecha);
    if (pestana === 'semana') abrirSemana();
    if (pestana === 'despensa') abrirDespensa(() => vistaDia(app, fecha));
  } catch (err) {
    // La base todavía no tiene las tablas de la dieta (falta aplicar la migración).
    if (['PGRST205', '42P01', 'PGRST200'].includes(err?.code) || /alimentos|despensa|comida_items/.test(err?.message ?? '')) {
      app.innerHTML = `
        <header class="encabezado encabezado--fijo"><div><h1 class="titulo">Alimentación</h1></div></header>
        <div class="tarjeta"><p style="margin:0"><strong>Casi lista.</strong> Falta terminar de preparar la base de datos de la dieta.</p></div>`;
      return;
    }
    throw err;
  }
}

// Hoja de pantalla completa con la misma cabecera de los chats (para Semana y Despensa).
function abrirHoja(titulo, sub, render, alCerrar) {
  const d = abrirDialogo(`<div class="reg chatia">${htmlCabecera({ titulo, sub })}<div class="chatia__cuerpo hoja-cuerpo"></div></div>`, titulo, { pantalla: true });
  if (alCerrar) d.addEventListener('close', alCerrar);
  // Si desde la hoja se va a otro día, la hoja se cierra.
  const alNavegar = () => { window.removeEventListener('hashchange', alNavegar); d.close(); };
  window.addEventListener('hashchange', alNavegar);
  d.addEventListener('close', () => window.removeEventListener('hashchange', alNavegar));
  render(d.querySelector('.hoja-cuerpo'));
  return d;
}
const abrirSemana = () => abrirHoja('Tu semana', 'Últimos 7 días', (c) => vistaSemana(c, { enHoja: true }).catch(avisoError));
const abrirDespensa = (alCerrar) => abrirHoja('Despensa', 'Lo que hay en casa', (c) => vistaDespensa(c, { enHoja: true }).catch(avisoError), alCerrar);
const rutaDia = (f) => (f === hoyISO() ? '#/comida' : `#/comida/${f}`);

/** ‹ Ayer (hoy) · ‹ Hoy (ayer) · ‹ › Hoy (antes). */
function navDias(fecha) {
  const hoy = hoyISO(), ayer = sumarDias(hoy, -1);
  const atras = `<a class="boton boton--sec boton--chico nav-dia" href="${rutaDia(sumarDias(fecha, -1))}" aria-label="Día anterior">‹${fecha === hoy ? '<span>Ayer</span>' : ''}</a>`;
  const adelante = fecha < ayer ? `<a class="boton boton--sec boton--chico nav-dia" href="${rutaDia(sumarDias(fecha, 1))}" aria-label="Día siguiente">›</a>` : '';
  const aHoy = fecha !== hoy ? '<a class="boton boton--chico nav-dia nav-dia--hoy" href="#/comida">Hoy</a>' : '';
  return `${atras}${adelante}${aHoy}`;
}

const ordenar = (comidas) => [...comidas].sort((a, b) =>
  (a.hora ?? '99').localeCompare(b.hora ?? '99') || ORDEN_MOMENTO.indexOf(a.momento) - ORDEN_MOMENTO.indexOf(b.momento));

// ---------- Día ----------

async function vistaDia(app, fecha) {
  const esHoy = fecha === hoyISO();
  const [d, frec, habituales] = await Promise.all([cargarDia(fecha), frecuentes(10), esHoy ? habitualesAhora(6).catch(() => []) : []]);
  const personas = [...estado.personas].sort((a, b) => (a.id === estado.yo.id ? -1 : b.id === estado.yo.id ? 1 : 0));
  const info = personas.map((p) => datosPersona(p, d));
  const yo = info[0];
  // A quién se mira en el resumen (las caras de arriba): yo por defecto.
  let verId = null;
  try { verId = sessionStorage.getItem('bloque-comida-ver'); } catch { /* nada */ }
  const visto = info.find((x) => x.p.id === verId) ?? yo;
  const snacks = esHoy ? snacksDelDia(yo.eventos, yo.metas.ok ? yo.metas.peso : null) : [];
  const ctx = {
    fecha, esHoy, info, despensa: d.despensa, frecuentes: frec, habituales,
    recargar: (f) => { if (f && f !== fecha) location.hash = f === hoyISO() ? '#/comida' : `#/comida/${f}`; else vistaDia(app, fecha); },
  };

  app.innerHTML = `
    <header class="encabezado encabezado--fijo">
      <div>
        <h1 class="titulo">Alimentación</h1>
        <p class="subtitulo">${esc(esHoy ? 'Hoy' : diaLargo(fecha))}</p>
      </div>
      <div class="fila nav-dias">
        ${navDias(fecha)}
      </div>
    </header>


    ${info.length > 1 ? `
      <div class="ver-persona" role="tablist" aria-label="De quién ver el día">
        ${info.map((x) => `<button type="button" class="ver-persona__op" role="tab" data-ver="${esc(x.p.id)}" aria-selected="${x === visto}">
          <span class="ver-persona__cara">${cara(x.p)}</span><span>${esc(x === yo ? 'Yo' : x.p.nombre)}</span>
        </button>`).join('')}
      </div>` : ''}
    <div id="resumen-persona" class="resumen-persona">${htmlResumen(visto, true, esHoy && visto === yo, visto === yo)}</div>

    <button type="button" class="tarjeta semana-comida" id="ver-semana-comida" aria-label="Ver tu semana">
      <span class="semana-comida__cab"><strong>Tu semana</strong><span class="plan__flecha" aria-hidden="true">›</span></span>
      <span class="semana-comida__datos" id="semana-comida-datos"><span class="quieto">Cargando…</span></span>
    </button>

    ${htmlTuObjetivo(yo)}

    <section class="seccion" aria-labelledby="t-comidas">
      <h2 class="seccion__titulo" id="t-comidas">${esHoy ? 'Lo que comieron hoy' : 'Lo que comieron'}</h2>
      ${d.comidas.length
        ? htmlComidasDia(ordenar(d.comidas))
        : `<p class="vacio">Todavía nada${esHoy ? ' hoy' : ''}. Toca «Agregar comida» para anotarla.</p>`}
    </section>

    ${esHoy ? `
      <details class="seccion acordeon" id="acordeon-ahora" ${(() => { try { return localStorage.getItem('bloque-ahora-cerrado') === '1' ? '' : 'open'; } catch { return 'open'; } })()}>
        <summary class="acordeon__cab"><h2 class="seccion__titulo" id="t-ahora" style="margin:0">¿Qué como ahora?</h2><span class="acordeon__flecha" aria-hidden="true"></span></summary>
        <div class="acordeon__cuerpo"><div class="acordeon__interior">
          <div class="tarjeta pila" style="gap:12px">
            ${snacks.map(htmlSnack).join('')}
            <div class="fila fila--entre ideas__cab"><p class="seccion__titulo ideas__titulo" style="margin:0">${ICONO_CHISPA} Ideas con lo que hay en casa</p><button type="button" class="enlace-chico enlace-boton" id="ver-despensa">Ver despensa ›</button></div>
            <div id="ideas" class="pila" style="gap:12px"></div>
            <button type="button" class="boton boton--sec" id="ideas-btn" hidden>${ICONO_CHISPA} Otras ideas</button>
          </div>
        </div></div>
      </details>` : ''}`;
  // Arriba de todo: pedir lo que hay en casa (despensa), si no se pospuso.
  if (esHoy) app.querySelector('.encabezado').insertAdjacentHTML('afterend', htmlPedirDespensa(d.despensa));

  // Agregar comida: botón flotante (abre el chat con la IA).
  fabIA('Agregar comida', () => abrirRegistro(ctx, {}), /^#\/comida/);
  const despensaYRecargar = () => abrirDespensa(() => vistaDia(app, fecha));
  app.querySelector('#ver-despensa')?.addEventListener('click', despensaYRecargar);
  conectarPedirDespensa(app, despensaYRecargar);
  conectarAcordeon(app.querySelector('#acordeon-ahora'));
  app.querySelector('#ver-semana-comida').addEventListener('click', abrirSemana);
  tarjetaSemana(app.querySelector('#semana-comida-datos'), yo);
  conectarAgua(app);

  app.querySelectorAll('[data-comida]').forEach((b) => b.addEventListener('click', () =>
    abrirRegistro(ctx, { comida: d.comidas.find((c) => c.id === b.dataset.comida) })));
  app.querySelector('#cambiar-objetivo')?.addEventListener('click', () => dialogoObjetivo(yo.foco, () => vistaDia(app, fecha)));
  const botonIdeas = app.querySelector('#ideas-btn');
  botonIdeas?.addEventListener('click', (e) => mostrarIdeas(ctx, app.querySelector('#ideas'), e.currentTarget));
  // Las ideas se cargan solas cuando la sección aparece en pantalla (y quedan guardadas 30 min).
  const contIdeas = app.querySelector('#ideas');
  if (contIdeas && botonIdeas) {
    const obs = new IntersectionObserver((en) => {
      if (!en.some((x) => x.isIntersecting)) return;
      obs.disconnect();
      mostrarIdeas(ctx, contIdeas, botonIdeas).then(() => { botonIdeas.hidden = false; });
    }, { root: document.getElementById('app'), rootMargin: '200px 0px' });
    obs.observe(contIdeas);
  }
  app.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => {
    try { sessionStorage.setItem('bloque-comida-ver', b.dataset.ver); } catch { /* nada */ }
    const x = info.find((y) => y.p.id === b.dataset.ver);
    app.querySelectorAll('[data-ver]').forEach((o) => o.setAttribute('aria-selected', String(o === b)));
    const cont = app.querySelector('#resumen-persona');
    cont.classList.remove('fundido'); void cont.offsetWidth;
    cont.innerHTML = htmlResumen(x, true, esHoy && x === yo, x === yo);
    cont.classList.add('fundido');
    if (x === yo) conectarAgua(app);
  }));
}

const ICONO_MOMENTO = { desayuno: '☕', almuerzo: '🍽️', merienda: '🥪', cena: '🌙', snack: '🍎', pre_entreno: '⚡', post_entreno: '💪' };
const persona = (id) => estado.personas.find((p) => p.id === id);
const caras = (ids) => `<span class="caras">${ids.map((id) => `<span class="caras__una">${cara(persona(id))}</span>`).join('')}</span>`;

// «3 huevos», «100 g de fideos cocidos».
function linea(alimento, gramos) {
  const t = cantidadTexto(alimento, gramos);
  const nombre = alimento.nombre.replace(/\s*\(.*\)\s*/g, '').replace(/ entero$/i, '').toLowerCase();
  if (t.endsWith(' g')) return `${t} de ${nombre}`;
  // «3 huevos» ya dice qué es; «1 vaso» o «2 cucharadas» no: se agrega de qué.
  const clave = nombre.split(' ')[0].slice(0, 4);
  return t.toLowerCase().includes(clave) ? t : `${t} de ${nombre}`;
}

/**
 * Lo que comieron, por momento del día (si los dos anotaron el desayuno por separado, se ve junto).
 * En cada momento: qué fue compartido, qué comió cada uno, y las calorías de cada persona.
 */
function htmlComidasDia(comidas) {
  // Se juntan las del mismo momento si están cerca en la hora (si los dos anotaron el almuerzo por separado);
  // dos «snacks» a las 00:18 y a las 23:57 son comidas distintas y van aparte.
  const minutos = (c) => (c.hora ? Number(c.hora.slice(0, 2)) * 60 + Number(c.hora.slice(3, 5)) : null);
  const grupos = [];
  for (const c of comidas) {
    const m = minutos(c);
    const g = grupos.find((x) => x.momento === c.momento && (m == null || x.min == null || Math.abs(m - x.min) <= 180));
    if (g) { g.comidas.push(c); if (g.min == null) g.min = m; } else grupos.push({ momento: c.momento, comidas: [c], min: m });
  }
  return `<div class="tarjeta comidas-dia"><ol class="plan">${grupos.map((g) => {
    const horas = g.comidas.map((c) => c.hora?.slice(0, 5)).filter(Boolean).sort();
    // Calorías por persona en este momento.
    const porPersona = new Map();
    for (const c of g.comidas) for (const x of c.porciones) {
      const t = porPersona.get(x.persona_id) ?? { kcal: 0, prot: 0 };
      t.kcal += Number(x.kcal ?? 0); t.prot += Number(x.proteina_g ?? 0);
      porPersona.set(x.persona_id, t);
    }
    // Renglones por «dueño»: compartido entre varios, cada uno lo mismo (c/u) o de una persona.
    const filas = new Map();
    const sumarFila = (ids, texto, comidaId, cu = false) => {
      const clave = `${cu ? 'cu' : ''}${[...ids].sort().join(',')}`;
      const f = filas.get(clave) ?? { ids, lineas: [], comidaId, cu };
      f.lineas.push(texto);
      filas.set(clave, f);
    };
    for (const c of g.comidas) {
      const comieron = c.porciones.map((x) => x.persona_id);
      const propios = new Map();
      for (const i of c.comida_items) {
        if (i.persona_id) { (propios.get(i.persona_id) ?? propios.set(i.persona_id, []).get(i.persona_id)).push(linea(i.alimento, Number(i.gramos))); }
        else sumarFila(comieron, linea(i.alimento, Number(i.gramos)), c.id);
      }
      const listas = [...propios.values()].map((l) => l.join('|'));
      if (propios.size > 1 && listas.every((l) => l === listas[0])) {
        for (const t of [...propios.values()][0]) sumarFila([...propios.keys()], t, c.id, true);
      } else for (const [id, l] of propios) for (const t of l) sumarFila([id], t, c.id);
    }
    return `
      <li class="plan__item comida-momento">
        <span class="plan__icono comida-momento__icono" aria-hidden="true">${ICONO_MOMENTO[g.momento] ?? '🍴'}</span>
        <div class="plan__cuerpo">
          <div class="plan__titulo">
            <strong>${esc(MOMENTOS[g.momento] ?? g.momento)}</strong>
            <span class="plan__hora">${esc(horas.length > 1 && horas[0] !== horas.at(-1) ? `${horas[0]}–${horas.at(-1)}` : horas[0] ?? '')}</span>
          </div>
          <div class="comida-momento__totales">${[...porPersona.entries()].map(([id, t]) => `
            <span class="persona-kcal" title="Proteína ${Math.round(t.prot)} g">${caras([id])}<strong>${kc(t.kcal)}</strong> kcal</span>`).join('')}</div>
          ${[...filas.values()].map((f) => `
            <button type="button" class="comida-renglon" data-comida="${esc(f.comidaId)}" aria-label="Editar ${esc(MOMENTOS[g.momento] ?? '')}">
              ${caras(f.ids)}
              <span class="comida-renglon__texto">
                <span class="comida-renglon__quien">${esc(f.cu ? 'Cada uno' : f.ids.length > 1 ? 'Compartido' : (f.ids[0] === estado.yo.id ? 'Yo' : persona(f.ids[0])?.nombre ?? ''))}</span>
                ${esc(f.lineas.join(' · '))}${f.cu ? ' <span class="quieto">(c/u)</span>' : ''}
              </span>
              <span class="plan__flecha" aria-hidden="true">›</span>
            </button>`).join('')}
        </div>
      </li>`;
  }).join('')}</ol></div>`;
}

// ---------- Ideas con Gemini ----------

async function mostrarIdeas(ctx, cont, boton) {
  const yo = ctx.info[0];
  const clave = `bloque-ideas-${ctx.fecha}-${ctx.despensa.length}`;
  let ideas = null;
  try { const c = JSON.parse(sessionStorage.getItem(clave) ?? 'null'); if (c && Date.now() - c.t < 30 * 60e3 && !boton.dataset.otra) ideas = c.ideas; } catch { /* sin caché */ }
  if (!ideas) {
    boton.disabled = true;
    cont.innerHTML = '';
    burbujaPensando(cont, ['Pensando ideas…', 'Mirando tu despensa…', 'Viendo lo que te falta hoy…'], 'chatia__msg chatia__msg--ia chatia__msg--solo');
    const ahora = new Date();
    const falta = yo.metas.ok ? {
      kcal: Math.round(yo.metas.kcal - yo.comido.kcal), proteina_g: Math.round(yo.metas.proteina - yo.comido.proteina),
      carbohidratos_g: Math.round(yo.metas.carbos - yo.comido.carbos), grasas_g: Math.round(yo.metas.grasas - yo.comido.grasas),
    } : null;
    const contexto = {
      objetivo: OBJETIVOS[yo.foco]?.nombre, peso_kg: yo.metas.peso ?? null,
      hora: `${ahora.getHours()}:${String(ahora.getMinutes()).padStart(2, '0')}`, proxima_comida: MOMENTOS[momentoPorHora(ahora)],
      falta_hoy: falta,
      entrenos_hoy: yo.eventos.filter((e) => e.tipo !== 'descanso').map((e) => ({ tipo: e.tipo === 'otro' ? e.actividad : e.tipo, hora: e.hora_inicio?.slice(0, 5) ?? null })),
      despensa: ctx.despensa.map((p) => ({ nombre: p.alimento.nombre, quedan_g: Math.round(p.gramos_restantes) })),
      deporte: deporte(estado.equipo?.deporte)?.nombre ?? null,
    };
    const bajos = await import('../micros.js').then((M) => M.bajosParaIA()).catch(() => null);
    if (bajos) contexto.vitaminas_minerales_bajos_esta_semana = bajos;
    try {
      ideas = (await gemini('ideas', { contexto })).ideas ?? [];
      try { sessionStorage.setItem(clave, JSON.stringify({ t: Date.now(), ideas })); } catch { /* sin caché */ }
    } catch (err) {
      cont.innerHTML = `<p class="quieto" style="margin:0">${esc(err.message)}</p>`;
      boton.disabled = false;
      return;
    }
    boton.disabled = false;
  }
  if (!ideas.length) { cont.innerHTML = '<p class="quieto" style="margin:0">No salieron ideas. Prueba de nuevo.</p>'; return; }
  boton.innerHTML = `${ICONO_CHISPA} Otras ideas`;
  boton.dataset.otra = '1';
  cont.innerHTML = ideas.map((idea, i) => {
    const t = sumar(idea.ingredientes.map((a) => macros(a, a.gramos)));
    return `
      <article class="idea">
        <div class="fila fila--entre" style="align-items:flex-start"><strong>${esc(idea.titulo)}</strong><span class="quieto" style="white-space:nowrap">${kc(t.kcal)} kcal</span></div>
        <p class="quieto idea__porque">${esc(idea.por_que)}</p>
        <ul class="idea__ingredientes">${idea.ingredientes.map((a) => `<li>${esc(a.nombre)} · ${g(a.gramos)}${a.de_despensa ? ' <span class="etiqueta etiqueta--mini">en casa</span>' : ''}</li>`).join('')}</ul>
        <p class="quieto idea__macros">P ${Math.round(t.proteina)} · C ${Math.round(t.carbos)} · G ${Math.round(t.grasas)}</p>
        ${idea.pasos ? `<details><summary>Cómo hacerlo</summary><p class="idea__pasos">${esc(idea.pasos)}</p></details>` : ''}
        <button type="button" class="boton boton--chico" data-idea="${i}">Comí esto</button>
      </article>`;
  }).join('');
  cont.querySelectorAll('[data-idea]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const idea = ideas[Number(b.dataset.idea)];
      const items = [];
      for (const a of idea.ingredientes) {
        const alimento = await aAlimento(a);
        const paquete = a.de_despensa ? ctx.despensa.find((p) => p.alimento_id === alimento.id && Number(p.gramos_restantes) > 0) ?? null : null;
        items.push({ alimento, gramos: a.gramos, paquete });
      }
      abrirRegistro(ctx, { items });
    } catch (err) { avisoError(err); }
    b.disabled = false;
  }));
}

// ---------- Semana ----------

async function vistaSemana(app, { enHoja = false } = {}) {
  const hoy = hoyISO();
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(hoy, i - 6));
  const ids = estado.personas.map((p) => p.id);
  const desde = new Date(`${dias[0]}T00:00:00`).toISOString();
  const [eventos, mediciones, objetivos, reloj, comidas] = await Promise.all([
    sb.from('calendario').select('*').eq('hogar_id', estado.yo.hogar_id).gte('fecha', dias[0]).lte('fecha', hoy).then(datos),
    sb.from('mediciones_corporales').select('persona_id, medido_en, peso_kg, grasa_pct, masa_magra_kg').in('persona_id', ids).order('medido_en', { ascending: false }).limit(120).then(datos),
    sb.from('objetivos').select('*').in('persona_id', ids).order('desde', { ascending: false }).then(datos),
    sb.from('sesiones_banda').select('persona_id, calorias, calorias_estimadas, inicio, fin, tipo, fc_promedio, confirmado').or('confirmado.is.null,confirmado.neq.nada').in('persona_id', ids).gte('inicio', desde).then(datos),
    sb.from('comidas').select('fecha, porciones(*)').eq('hogar_id', estado.yo.hogar_id).gte('fecha', dias[0]).lte('fecha', hoy).then(datos),
  ]);
  const rutinaIds = [...new Set(eventos.map((e) => e.rutina_id).filter(Boolean))];
  const rutinas = rutinaIds.length ? datos(await sb.from('rutinas').select('id, foco').in('id', rutinaIds)) : [];
  for (const e of eventos) e.liviana = rutinas.find((r) => r.id === e.rutina_id)?.foco === 'recuperacion';
  const yo = estado.yo;
  const fechaLocal = (iso) => { const t = new Date(iso); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  const filas = dias.map((f) => {
    const dia = { fecha: f, eventos: eventos.filter((e) => e.fecha === f), mediciones, objetivos, comidas: comidas.filter((c) => c.fecha === f), reloj: reloj.filter((s) => fechaLocal(s.inicio) === f) };
    return datosPersona(yo, dia);
  });
  const conDatos = filas.filter((x) => x.comido.kcal > 0);
  const prom = (k) => conDatos.length ? conDatos.reduce((a, x) => a + x.comido[k], 0) / conDatos.length : 0;
  const promMeta = (k) => conDatos.length ? conDatos.reduce((a, x) => a + (x.metas.ok ? x.metas[k] : 0), 0) / conDatos.length : 0;
  const tendencia = filas.at(-1).tendencia;

  app.innerHTML = `
    ${enHoja ? '' : '<header class="encabezado encabezado--fijo"><div><h1 class="titulo">Alimentación</h1><p class="subtitulo">Últimos 7 días</p></div></header>'}
    <section class="tarjeta">
      ${conDatos.length ? `
        <div class="grilla-2">
          <div><p class="quieto" style="margin:0 0 4px">Calorías por día</p><span class="dato-medio">${kc(prom('kcal'))}</span>${promMeta('kcal') ? `<span class="dato-unidad">de ${kc(promMeta('kcal'))}</span>` : ''}</div>
          <div><p class="quieto" style="margin:0 0 4px">Proteína por día</p><span class="dato-medio">${Math.round(prom('proteina'))}</span><span class="dato-unidad">g${promMeta('proteina') ? ` de ${Math.round(promMeta('proteina'))}` : ''}</span></div>
        </div>
        <p class="ayuda" style="margin-top:10px">Promedio de los ${conDatos.length} días con comidas registradas.</p>`
        : '<p class="quieto" style="margin:0">Cuando registres comidas, acá ves cómo vas contra tu meta cada día.</p>'}
      ${tendencia?.nota ? `<ul class="notas-comida">${`<li>${esc(tendencia.nota)}</li>`}</ul>` : ''}
    </section>
    <section class="seccion" id="micros-semana">
      ${estado.personas.length > 1 ? `<div class="ver-persona" role="tablist" aria-label="De quién ver vitaminas y minerales" style="margin-bottom:10px">
        ${estado.personas.map((p) => `<button type="button" class="ver-persona__op" role="tab" data-micros="${esc(p.id)}" aria-selected="${p.id === yo.id}">
          <span class="ver-persona__cara">${cara(p)}</span><span>${esc(p.id === yo.id ? 'Yo' : p.nombre)}</span></button>`).join('')}
      </div>` : ''}
      <div id="micros-cont"><section class="tarjeta micros"><h2 class="seccion__titulo" style="margin:0">Vitaminas y minerales</h2><p class="quieto" style="margin:8px 0 0">Calculando…</p></section></div>
    </section>
    <section class="seccion">
      <div class="pila" style="gap:8px">
        ${filas.map((x, i) => [x, dias[i]]).reverse().map(([x, f]) => {
          const meta = x.metas.ok ? x.metas.kcal : null;
          const pct = meta ? Math.min(100, (x.comido.kcal / meta) * 100) : 0;
          const estadoDia = !x.comido.kcal ? 'vacio' : !meta ? '' : x.comido.kcal < meta * 0.85 ? 'bajo' : x.comido.kcal > meta * 1.1 ? 'alto' : 'bien';
          return `
            <a class="tarjeta semana-dia" href="${f === hoy ? '#/comida' : `#/comida/${f}`}">
              <div class="semana-dia__fecha"><span>${esc(f === hoy ? 'Hoy' : diaCorto(f))}</span><strong>${numeroDia(f)}</strong></div>
              <div class="semana-dia__datos">
                <div class="fila fila--entre"><span>${x.comido.kcal ? `${kc(x.comido.kcal)}${meta ? ` / ${kc(meta)}` : ''} kcal` : '<span class="quieto">Sin registros</span>'}</span>
                  <span class="quieto">${x.comido.kcal ? `P ${Math.round(x.comido.proteina)}${x.metas.ok ? `/${x.metas.proteina}` : ''} g` : ''}</span></div>
                <div class="kcal__barra semana-dia__barra semana-dia__barra--${estadoDia}"><span style="width:${pct}%"></span></div>
              </div>
            </a>`;
        }).join('')}
      </div>
    </section>`;
  conectarMicros(app);
}

// Vitaminas y minerales de la semana (de cada persona del hogar).
async function conectarMicros(app) {
  const cont = app.querySelector('#micros-cont');
  if (!cont) return;
  const M = await import('../micros.js');
  const ver = async (id) => {
    const p = estado.personas.find((x) => x.id === id) ?? estado.yo;
    app.querySelectorAll('[data-micros]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.micros === p.id)));
    try {
      const a = await M.analisisSemana(p);
      if (cont.isConnected && (app.querySelector('[data-micros][aria-selected=true]')?.dataset.micros ?? estado.yo.id) === p.id) cont.innerHTML = M.htmlMicros(a, p);
    } catch (e) { cont.innerHTML = `<section class="tarjeta"><p class="quieto" style="margin:0">${esc(e.message ?? 'No se pudo calcular.')}</p></section>`; }
  };
  app.querySelectorAll('[data-micros]').forEach((b) => b.addEventListener('click', () => ver(b.dataset.micros)));
  ver(estado.yo.id);
}

// ---------- Despensa ----------

async function vistaDespensa(app, { enHoja = false } = {}) {
  const despensa = datos(await sb.from('despensa').select('*, alimento:alimentos(*)').eq('hogar_id', estado.yo.hogar_id)
    .is('terminado_en', null).order('agregado_en', { ascending: false }));
  const fecha = hoyISO();
  const recargar = () => vistaDespensa(app, { enHoja });

  app.innerHTML = `
    ${enHoja ? '' : '<header class="encabezado encabezado--fijo"><div><h1 class="titulo">Alimentación</h1><p class="subtitulo">Lo que hay en casa</p></div></header>'}
    <section class="tarjeta pila" style="gap:10px">
      <h2 class="seccion__titulo" style="margin:0">Agregar lo que compraste</h2>
      <div class="chatia__compositor--suelto">${htmlCompositor({
        id: 'dp', placeholder: 'Ej.: 1 kg de arroz, 30 huevos, 2 L de leche',
        ids: { texto: 'dp-texto', enviar: 'dp-leer', camara: 'dp-camara', galeria: 'dp-archivo', foto: 'dp-foto-prev', quitar: 'dp-foto-quitar', estado: 'dp-estado' },
      })}</div>
      <div class="fila" style="gap:8px;flex-wrap:wrap;align-items:center">
        <button type="button" class="chip chip--mini" id="dp-manual">🔍 Buscar o escanear</button>
        <span class="ayuda" style="margin:0">o una foto de las fundas, la alacena, la refri o el ticket.</span>
      </div>
      <div id="dp-revision"></div>
    </section>

    <section class="seccion" aria-labelledby="t-casa">
      <h2 class="seccion__titulo" id="t-casa">En casa${despensa.length ? ` · ${despensa.length}` : ''}</h2>
      ${despensa.length ? `
        <div class="tarjeta pila" style="gap:12px">${agrupar(despensa).map(htmlGrupo).join('')}</div>
        <button type="button" class="boton boton--sec boton--bloque" id="ideas-btn" style="margin-top:12px">${ICONO_CHISPA} Ideas para cocinar con esto</button>
        <div id="ideas" class="pila" style="gap:12px;margin-top:12px"></div>`
        : '<p class="vacio">La despensa está vacía. Escribe arriba lo que compraste.</p>'}
    </section>`;

  const revision = app.querySelector('#dp-revision');
  const procesar = async (cuerpo, boton) => {
    boton.disabled = true;
    revision.innerHTML = '';
    burbujaPensando(revision, cuerpo.imagen ? ['Mirando la foto…', 'Reconociendo productos…', 'Calculando envases…'] : ['Leyendo tu lista…', 'Buscando cada producto…'], 'chatia__msg chatia__msg--ia chatia__msg--solo');
    try {
      const { productos = [] } = await gemini('despensa', cuerpo);
      if (!productos.length) { revision.innerHTML = '<p class="quieto" style="margin:0">No encontré comida ahí. Prueba de nuevo.</p>'; return; }
      revisarProductos(revision, productos, recargar);
    } catch (err) {
      revision.innerHTML = `<p class="quieto" style="margin:0">${esc(err.message)}</p>`;
    } finally { boton.disabled = false; }
  };
  const dpCompositor = conectarCompositor(app, {
    texto: '#dp-texto', enviar: '#dp-leer',
    alEnviar: () => {
      const texto = app.querySelector('#dp-texto').value.trim();
      if (!texto) return app.querySelector('#dp-texto').focus();
      dpCompositor.limpiar();
      procesar({ texto }, app.querySelector('#dp-leer'));
    },
  });
  for (const id of ['#dp-camara', '#dp-archivo']) {
    app.querySelector(id).addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      const texto = app.querySelector('#dp-texto').value.trim();
      dpCompositor.limpiar();
      procesar({ imagen: await fotoBase64(f), tipo: 'image/jpeg', texto }, app.querySelector('#dp-leer'));
    });
  }
  app.querySelector('#dp-manual').addEventListener('click', () => dialogoPaquete({ recargar }));
  app.querySelectorAll('[data-paquete]').forEach((b) => b.addEventListener('click', () =>
    dialogoEditarPaquete(despensa.find((x) => x.id === b.dataset.paquete), { recargar })));
  app.querySelector('#ideas-btn')?.addEventListener('click', async (e) => {
    // Ideas con la despensa: se arma el contexto del día de hoy.
    const boton = e.currentTarget;
    boton.disabled = true;
    const d = await cargarDia(fecha);
    boton.disabled = false;
    const yo = datosPersona(estado.yo, d);
    const ctx = { fecha, esHoy: true, info: [yo, ...estado.personas.filter((p) => p.id !== estado.yo.id).map((p) => datosPersona(p, d))], despensa, frecuentes: [], recargar: () => { location.hash = '#/comida'; } };
    mostrarIdeas(ctx, app.querySelector('#ideas'), boton);
  });
}

// Paquetes iguales juntos: "Fideos · 2 paquetes · 680 g de 800 g". Se edita primero el que está abierto.
function agrupar(despensa) {
  const grupos = new Map();
  for (const x of despensa) {
    const gr = grupos.get(x.alimento_id) ?? { alimento: x.alimento, paquetes: [] };
    gr.paquetes.push(x);
    grupos.set(x.alimento_id, gr);
  }
  return [...grupos.values()].map((gr) => ({
    ...gr,
    paquetes: gr.paquetes.sort((a, b) => a.gramos_restantes / a.gramos_total - b.gramos_restantes / b.gramos_total),
  }));
}

function htmlGrupo(gr) {
  const quedan = gr.paquetes.reduce((a, x) => a + Number(x.gramos_restantes), 0);
  const total = gr.paquetes.reduce((a, x) => a + Number(x.gramos_total), 0);
  const pct = Math.max(0, Math.min(100, (quedan / total) * 100));
  const n = gr.paquetes.length;
  return `
    <button type="button" class="paquete" data-paquete="${esc(gr.paquetes[0].id)}">
      <div class="fila fila--entre"><strong>${esc(gr.alimento.nombre)}</strong><span class="quieto">${cantidadTexto(gr.alimento, quedan)}${n > 1 ? ` · ${n} paquetes` : ''}</span></div>
      ${gr.alimento.marca ? `<span class="quieto" style="font-size:13px">${esc(gr.alimento.marca)}</span>` : ''}
      <div class="paquete__barra"><span style="width:${pct}%"></span></div>
    </button>`;
}

// Revisar lo que leyó Gemini antes de guardarlo en la despensa.
function revisarProductos(cont, productos, alGuardar) {
  cont.innerHTML = `
    <div class="revision">
      <p class="seccion__titulo" style="margin:4px 0 8px">Revisa y agrega</p>
      ${productos.map((p, i) => `
        <label class="revision__fila">
          <input type="checkbox" data-sel="${i}" checked>
          <span class="revision__nombre"><strong>${esc(p.nombre)}</strong>${p.marca ? ` <span class="quieto">· ${esc(p.marca)}</span>` : ''}</span>
          <span class="revision__cant">
            <input type="number" inputmode="numeric" min="1" max="60" value="${p.envases}" data-env="${i}" aria-label="Cuántos">
            ×
            <input type="number" inputmode="decimal" min="1" value="${Math.round(p.gramos_envase)}" data-gr="${i}" aria-label="Gramos de cada uno"> g
          </span>
        </label>`).join('')}
      <button type="button" class="boton boton--chico" id="dp-agregar" style="margin-top:10px">Agregar a la despensa</button>
    </div>`;
  cont.querySelector('#dp-agregar').addEventListener('click', async (e) => {
    const boton = e.currentTarget;
    boton.disabled = true;
    try {
      const filas = [];
      for (const [i, p] of productos.entries()) {
        if (!cont.querySelector(`[data-sel="${i}"]`).checked) continue;
        const envases = Math.max(1, Number(cont.querySelector(`[data-env="${i}"]`).value) || 1);
        const gramos = Math.max(1, Number(cont.querySelector(`[data-gr="${i}"]`).value) || p.gramos_envase);
        const alimento = await aAlimento(p);
        // Paquetes grandes (fideos, arroz) van uno por uno; lo chico (huevos) va junto.
        const separados = envases <= 6 && gramos >= 150;
        for (let k = 0; k < (separados ? envases : 1); k++) {
          const total = separados ? gramos : gramos * envases;
          filas.push({ hogar_id: estado.yo.hogar_id, alimento_id: alimento.id, gramos_total: total, gramos_restantes: total });
        }
      }
      if (filas.length) datos(await sb.from('despensa').insert(filas));
      aviso(`${filas.length} ${filas.length === 1 ? 'producto agregado' : 'productos agregados'} a la despensa.`);
      alGuardar();
    } catch (err) {
      avisoError(err);
      boton.disabled = false;
    }
  });
}

// ---------- Datos (compartidos) y piezas ----------

async function cargarDia(fecha) {
  const ids = estado.personas.map((p) => p.id);
  const hogar = estado.yo.hogar_id;
  const desde = new Date(`${fecha}T00:00:00`), hasta = new Date(`${fecha}T23:59:59`);
  const [eventos, mediciones, objetivos, reloj, comidas, despensa] = await Promise.all([
    sb.from('calendario').select('*').eq('hogar_id', hogar).eq('fecha', fecha).then(datos),
    sb.from('mediciones_corporales').select('persona_id, medido_en, peso_kg, grasa_pct, masa_magra_kg')
      .in('persona_id', ids).order('medido_en', { ascending: false }).limit(120).then(datos),
    sb.from('objetivos').select('*').in('persona_id', ids).order('desde', { ascending: false }).then(datos),
    sb.from('sesiones_banda').select('persona_id, calorias, calorias_estimadas, inicio, fin, tipo, fc_promedio, confirmado').or('confirmado.is.null,confirmado.neq.nada').in('persona_id', ids)
      .gte('inicio', desde.toISOString()).lte('inicio', hasta.toISOString()).then(datos),
    sb.from('comidas').select('*, comida_items(id, gramos, despensa_id, persona_id, alimento:alimentos(*)), porciones(*)')
      .eq('hogar_id', hogar).eq('fecha', fecha).order('hora', { nullsFirst: true }).then(datos),
    sb.from('despensa').select('*, alimento:alimentos(*)').eq('hogar_id', hogar).is('terminado_en', null)
      .order('agregado_en', { ascending: false }).then(datos),
  ]);
  const rutinaIds = [...new Set(eventos.map((e) => e.rutina_id).filter(Boolean))];
  const rutinas = rutinaIds.length ? datos(await sb.from('rutinas').select('id, foco').in('id', rutinaIds)) : [];
  for (const e of eventos) e.liviana = rutinas.find((r) => r.id === e.rutina_id)?.foco === 'recuperacion';
  // Últimas 2 semanas del reloj (sin el día que se mira): cuánto te movés fuera de los entrenos.
  const hace15 = sumarDias(fecha, -15);
  const [syncs, agua, diasReloj, sesionesReloj] = await Promise.all([
    cargarSyncs(), cargarAgua(fecha, ids).catch(() => []),
    sb.from('actividad_diaria').select('persona_id, fecha, pasos, calorias_activas, calorias_totales').in('persona_id', ids)
      .gte('fecha', hace15).lt('fecha', fecha).then(datos).catch(() => []),
    sb.from('sesiones_banda').select('persona_id, inicio, calorias').or('confirmado.is.null,confirmado.neq.nada').in('persona_id', ids)
      .gte('inicio', new Date(`${hace15}T00:00:00`).toISOString()).lt('inicio', desde.toISOString()).then(datos).catch(() => []),
  ]);
  return { fecha, eventos, mediciones, objetivos, reloj, comidas, despensa, syncs, agua, diasReloj, sesionesReloj };
}

function datosPersona(p, d) {
  const medicion = d.mediciones.find((m) => m.persona_id === p.id && m.peso_kg != null) ?? null;
  const grasa = d.mediciones.find((m) => m.persona_id === p.id && m.grasa_pct != null);
  const med = medicion ? { ...medicion, grasa_pct: medicion.grasa_pct ?? grasa?.grasa_pct ?? null } : null;
  const foco = d.objetivos.find((o) => o.persona_id === p.id)?.foco ?? 'recomposicion';
  const suyos = d.eventos.filter((e) => e.asistencia === 'juntos' || e.persona_id === p.id);
  // Derby y otros: si su reloj muestra que no fue, ese gasto no se cuenta.
  const relojP = d.reloj.filter((s) => s.persona_id === p.id);
  const { pares } = emparejar(suyos.filter((e) => e.tipo !== 'descanso'), relojP);
  const eventos = suyos.filter((e) => !esIndividual(e) || asistenciaIndividual(e, pares.get(e) ?? null, d.syncs?.[p.id], new Date(), relojP.some(porConfirmar)) !== 'no_fue');
  const tendencia = tendenciaPeso(d.mediciones.filter((m) => m.persona_id === p.id), foco);
  const fechaLocalDe = (iso) => { const f = new Date(iso); return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`; };
  const metas = calcularMetas({
    persona: p, medicion: med, foco, eventos,
    entrenosReloj: d.reloj.filter((s) => s.persona_id === p.id),
    hoy: new Date(`${d.fecha}T12:00:00`),
    tendencia,
    historial: {
      dias: (d.diasReloj ?? []).filter((x) => x.persona_id === p.id),
      sesiones: (d.sesionesReloj ?? []).filter((x) => x.persona_id === p.id).map((x) => ({ fecha: fechaLocalDe(x.inicio), calorias: x.calorias })),
    },
  });
  const comido = sumar(d.comidas.flatMap((c) => c.porciones.filter((x) => x.persona_id === p.id))
    .map((x) => ({ kcal: Number(x.kcal ?? 0), proteina: Number(x.proteina_g ?? 0), carbos: Number(x.carbohidratos_g ?? 0), grasas: Number(x.grasas_g ?? 0) })));
  const entradas = (d.agua ?? []).filter((x) => x.persona_id === p.id);
  const agua = {
    meta: metaAgua({ peso: metas.ok ? metas.peso : null, ejercicioKcal: metas.ok ? metas.ejercicio : 0 }),
    deComidas: aguaDeComidas(d.comidas, p.id),
    entradas,
  };
  agua.tomado = agua.deComidas + entradas.reduce((a, x) => a + x.ml, 0);
  return { p, metas, comido, foco, eventos, tendencia, agua, med };
}


function barra(nombre, valor, meta, clase) {
  const pct = meta > 0 ? Math.min(100, (valor / meta) * 100) : 0;
  return `
    <div class="macro">
      <div class="macro__fila"><span>${nombre}</span><span><strong>${Math.round(valor)}</strong> / ${Math.round(meta)} g</span></div>
      <div class="macro__barra"><span class="${clase}" style="width:${pct}%"></span></div>
    </div>`;
}

// Hidratación dentro del resumen del día: un vaso con agua que sube, y botones rápidos.
function htmlAgua(x, esHoy, mio = true) {
  const { meta, tomado, deComidas, entradas } = x.agua;
  const pct = Math.min(100, Math.round((tomado / meta) * 100));
  const falta = meta - tomado;
  const entreno = esHoy && (x.eventos ?? []).find((e) => ['derby', 'gym', 'otro'].includes(e.tipo));
  return `
    <div class="agua-dia" id="agua-dia" data-tomado="${tomado}" data-meta="${meta}" data-bebidas="${deComidas}" data-entreno="${entreno ? (entreno.tipo === 'derby' ? 'derby' : 'otro') : ''}" data-entradas='${esc(JSON.stringify(entradas.map((e) => ({ id: e.id, ml: e.ml }))))}'>
      <div class="vaso" aria-hidden="true">
        <div class="vaso__agua" style="height:${pct}%">
          <svg class="vaso__ola" viewBox="0 0 120 12" preserveAspectRatio="none"><path d="M0 6 Q15 0 30 6 T60 6 T90 6 T120 6 V12 H0Z"/></svg>
          <svg class="vaso__ola vaso__ola--2" viewBox="0 0 120 12" preserveAspectRatio="none"><path d="M0 6 Q15 12 30 6 T60 6 T90 6 T120 6 V12 H0Z"/></svg>
          <span class="vaso__burbuja"></span><span class="vaso__burbuja"></span><span class="vaso__burbuja"></span>
        </div>
      </div>
      <div class="agua-dia__texto">
        <div class="macro__fila"><span>Agua</span><span><strong id="agua-tomado">${litros(tomado)}</strong> / ${litros(meta)}</span></div>
        <p class="agua-dia__estado ${falta <= 0 ? 'hecho' : ''}" id="agua-estado">${falta <= 0 ? 'Meta de agua cumplida ✓' : `${mio ? 'Te' : 'Le'} falta ${litros(falta)}`}${deComidas ? ` · ${litros(deComidas)} de bebidas` : ''}${entreno ? ` · ${entreno.tipo === 'derby' ? 'lleva ~1 L al derby' : 'lleva ~500 ml al entreno'}` : ''}</p>
        ${esHoy ? `
          <div class="agua-dia__botones">
            <button type="button" class="chip chip--mini chip--agua" data-agua="250">+ Vaso</button>
            <button type="button" class="chip chip--mini chip--agua" data-agua="500">+ Botella</button>
            <button type="button" class="chip chip--mini chip--agua" data-agua="750">+ Termo</button>
            <button type="button" class="chip chip--mini agua-deshacer" id="agua-deshacer" ${entradas.length ? '' : 'hidden'}>↶ ${entradas.length ? `${entradas.at(-1).ml} ml` : ''}</button>
          </div>` : ''}
      </div>
    </div>`;
}

function htmlResumen(x, esYo, esHoy = true, mio = esYo) {
  const { p, metas, comido } = x;
  if (!metas.ok) {
    return `
      <section class="tarjeta dia-comida ${esYo ? '' : 'dia-comida--otro'}" style="margin-top:12px">
        <h2 class="tarjeta__titulo">${esc(mio ? 'Mi día' : p.nombre)}</h2>
        <p class="quieto" style="margin:8px 0 0">Para calcular ${mio ? 'tu meta' : 'su meta'} falta ${esc(unir(metas.falta))}.</p>
        ${mio ? '<a class="boton boton--sec boton--chico" style="margin-top:12px" href="#/perfil">Completar perfil</a>' : `<p class="ayuda" style="margin-top:6px">${esc(p.nombre)} lo completa desde su Perfil y Cuerpo.</p>`}
        ${comido.kcal ? `<p class="quieto" style="margin:10px 0 0">Comido hoy: ${kc(comido.kcal)} kcal · ${g(comido.proteina)} de proteína</p>` : ''}
        ${esYo ? htmlAgua(x, esHoy, mio) : ''}
      </section>`;
  }
  const quedan = metas.kcal - comido.kcal;
  const pct = Math.min(100, (comido.kcal / metas.kcal) * 100);
  if (!esYo) {
    return `
      <section class="tarjeta dia-comida dia-comida--otro" style="margin-top:12px">
        <div class="fila fila--entre"><strong>${esc(p.nombre)}</strong><span class="quieto">${kc(comido.kcal)} / ${kc(metas.kcal)} kcal</span></div>
        <div class="kcal__barra" style="margin-top:8px"><span style="width:${pct}%"></span></div>
        <p class="quieto" style="margin:8px 0 0">Proteína ${Math.round(comido.proteina)} / ${metas.proteina} g · ${esc(OBJETIVOS[x.foco]?.nombre ?? '')}</p>
      </section>`;
  }
  const notas = [...metas.notas, ...consejosDelDia(metas, comido)].filter(Boolean); // la tendencia del peso ya ajusta la meta (y avisa en metas.notas)
  return `
    <section class="tarjeta dia-comida" style="margin-top:4px">
      <div class="kcal">
        <div>${quedan >= 25
          ? `<span class="kcal__texto kcal__texto--arriba">Faltan</span><span class="kcal__numero">${kc(quedan)}</span><span class="kcal__texto">kcal por comer</span>`
          : quedan > -25
            ? '<span class="kcal__numero kcal__numero--ok">Meta cumplida ✓</span><span class="kcal__texto">Ya no te faltan calorías hoy</span>'
            : `<span class="kcal__texto kcal__texto--arriba">Te pasaste</span><span class="kcal__numero">+${kc(-quedan)}</span><span class="kcal__texto">kcal de más</span>`}
        </div>
        <span class="quieto kcal__meta">${kc(comido.kcal)} de ${kc(metas.kcal)}</span>
      </div>
      <div class="kcal__barra"><span style="width:${pct}%"></span></div>
      <div class="macros">
        ${barra('Proteína', comido.proteina, metas.proteina, 'm-prot')}
        ${barra('Carbohidratos', comido.carbos, metas.carbos, 'm-carb')}
        ${barra('Grasas', comido.grasas, metas.grasas, 'm-gras')}
      </div>
      ${htmlAgua(x, esHoy, mio)}
      ${notas.length ? `<ul class="notas-comida">${notas.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    </section>`;
}

function htmlSnack(s) {
  return `
    <div class="snack">
      <div class="snack__cabeza"><span class="snack__hora">${esc(s.hora)}</span><strong>${esc(s.titulo)}</strong></div>
      <p class="quieto" style="margin:4px 0 8px">${esc(s.detalle)}</p>
      <ul class="snack__opciones">${s.opciones.map((o) => `<li>${esc(o.texto)} <span class="quieto">· ${o.carbos} g carb · ${o.proteina} g prot</span></li>`).join('')}</ul>
    </div>`;
}


function htmlPaquete(x) {
  const pct = Math.max(0, Math.min(100, (x.gramos_restantes / x.gramos_total) * 100));
  return `
    <button type="button" class="paquete" data-paquete="${esc(x.id)}">
      <div class="fila fila--entre"><strong>${esc(x.alimento.nombre)}</strong><span class="quieto">${g(x.gramos_restantes)} de ${g(x.gramos_total)}</span></div>
      ${x.alimento.marca ? `<span class="quieto" style="font-size:13px">${esc(x.alimento.marca)}</span>` : ''}
      <div class="paquete__barra"><span style="width:${pct}%"></span></div>
    </button>`;
}



function dialogoPaquete(ctx) {
  let elegido = null;
  const d = abrirDialogo(`
    <form class="dialogo" novalidate>
      <h2 class="tarjeta__titulo">Agregar a la despensa</h2>
      <div id="buscar"></div>
      <div id="paso2" hidden class="pila" style="gap:12px">
        <p style="margin:0"><strong id="p-nombre"></strong></p>
        <div class="campo">
          <label for="p-gramos">¿Cuántos gramos trae el paquete?</label>
          <input id="p-gramos" type="number" inputmode="decimal" min="1" step="1">
        </div>
      </div>
      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
        <button type="submit" class="boton" id="guardar" disabled>Agregar</button>
      </div>
    </form>`, 'Agregar a la despensa', { pantalla: true });
  panelBuscar(d.querySelector('#buscar'), {
    alElegir: (a) => {
      elegido = a;
      d.querySelector('#buscar').hidden = true;
      d.querySelector('#paso2').hidden = false;
      d.querySelector('#p-nombre').textContent = `${a.nombre}${a.marca ? ` · ${a.marca}` : ''}`;
      d.querySelector('#p-gramos').value = a.paquete_g ? Math.round(a.paquete_g) : '';
      d.querySelector('#guardar').disabled = false;
      d.querySelector('#p-gramos').focus();
    },
  });
  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const gramos = Number(d.querySelector('#p-gramos').value);
    if (!elegido || !(gramos > 0)) return aviso('Escribe cuántos gramos trae.', 'error');
    try {
      datos(await sb.from('despensa').insert({ hogar_id: estado.yo.hogar_id, alimento_id: elegido.id, gramos_total: gramos, gramos_restantes: gramos }));
      if (!elegido.paquete_g && elegido.hogar_id) await sb.from('alimentos').update({ paquete_g: gramos }).eq('id', elegido.id);
      d.close();
      aviso(`${elegido.nombre} en la despensa.`);
      ctx.recargar();
    } catch (err) { avisoError(err); }
  });
}

function dialogoEditarPaquete(x, ctx) {
  const d = abrirDialogo(`
    <form class="dialogo" novalidate>
      <h2 class="tarjeta__titulo">${esc(x.alimento.nombre)}</h2>
      <div class="campo">
        <label for="restan">Quedan (g)</label>
        <input id="restan" type="number" inputmode="decimal" min="0" max="${x.gramos_total}" value="${Math.round(x.gramos_restantes)}">
      </div>
      <div class="dialogo__pie">
        <button type="button" class="boton boton--peligro" id="terminar" style="margin-right:auto">Se terminó</button>
        <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
        <button type="submit" class="boton">Guardar</button>
      </div>
    </form>`, 'Editar paquete');
  const guardar = async (restan) => {
    try {
      datos(await sb.from('despensa').update({ gramos_restantes: restan, terminado_en: restan < 1 ? new Date().toISOString() : null }).eq('id', x.id));
      d.close();
      ctx.recargar();
    } catch (err) { avisoError(err); }
  };
  d.querySelector('#terminar').addEventListener('click', () => guardar(0));
  d.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Number(d.querySelector('#restan').value);
    guardar(Math.max(0, Math.min(Number(x.gramos_total), v || 0)));
  });
}


function dialogoObjetivo(actual, alGuardar) {
  const d = abrirDialogo(`
    <form class="dialogo" novalidate>
      <h2 class="tarjeta__titulo">Mi objetivo</h2>
      <p class="ayuda" style="margin:0">Desde hoy tus metas de calorías, proteína y entrenos se reajustan. Lo que ya pasó queda como está.</p>
      <div class="pila" style="gap:8px" id="focos">
        ${['recomposicion', 'masa_muscular', 'perder_grasa', 'mantenimiento'].map((f) => `
          <button type="button" class="opcion" data-valor="${f}" aria-pressed="${f === actual}">
            <strong>${esc(OBJETIVOS[f].nombre)}</strong>
            <span class="quieto">${{
              recomposicion: 'Proteína alta y un déficit chico (o comer a mantenimiento si ya tienes poca grasa).',
              masa_muscular: 'Comer por encima del gasto, con proteína alta, para subir de peso ganando músculo.',
              perder_grasa: 'Déficit más marcado, con proteína alta para no perder músculo.',
              mantenimiento: 'Comer lo que gastas.',
            }[f]}</span>
          </button>`).join('')}
      </div>
      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
        <button type="submit" class="boton">Guardar</button>
      </div>
    </form>`, 'Mi objetivo');
  let elegido = actual;
  d.querySelectorAll('#focos .opcion').forEach((b) => b.addEventListener('click', () => {
    elegido = b.dataset.valor;
    d.querySelectorAll('#focos .opcion').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      // Un objetivo por día: si ya lo cambiaste hoy, se reemplaza.
      datos(await sb.from('objetivos').delete().eq('persona_id', estado.yo.id).eq('desde', hoyISO()));
      datos(await sb.from('objetivos').insert({ persona_id: estado.yo.id, foco: elegido, desde: hoyISO() }));
      d.close();
      aviso('Objetivo guardado.');
      alGuardar();
    } catch (err) { avisoError(err); }
  });
}

// Sumar o quitar agua sin recargar: el vaso sube (o baja) con olas, la cifra cuenta y los textos se funden.
function conectarAgua(app) {
  const caja = app.querySelector('#agua-dia');
  if (!caja) return;
  let pila = [];
  try { pila = JSON.parse(caja.dataset.entradas || '[]'); } catch { /* nada */ }
  const deshacer = caja.querySelector('#agua-deshacer');
  const pintarDeshacer = () => {
    if (!deshacer) return;
    deshacer.hidden = !pila.length;
    if (pila.length) deshacer.textContent = `↶ ${pila.at(-1).ml} ml`;
  };
  const fundir = (el, texto) => {
    if (el.textContent === texto) return;
    el.classList.remove('fundido'); void el.offsetWidth;
    el.textContent = texto;
    el.classList.add('fundido');
  };
  const pintar = (tomado, sube) => {
    const meta = Number(caja.dataset.meta);
    const desde = Number(caja.dataset.tomado);
    caja.dataset.tomado = tomado;
    caja.querySelector('.vaso__agua').style.height = `${Math.min(100, Math.round((tomado / meta) * 100))}%`;
    const falta = meta - tomado;
    const estado = caja.querySelector('#agua-estado');
    estado.classList.toggle('hecho', falta <= 0);
    const bebidas = Number(caja.dataset.bebidas);
    const extra = [bebidas ? `${litros(bebidas)} de bebidas` : '', caja.dataset.entreno ? (caja.dataset.entreno === 'derby' ? 'lleva ~1 L al derby' : 'lleva ~500 ml al entreno') : ''].filter(Boolean).join(' · ');
    fundir(estado, `${falta <= 0 ? 'Meta de agua cumplida ✓' : `Te falta ${litros(falta)}`}${extra ? ` · ${extra}` : ''}`);
    caja.classList.remove('agua-dia--sube', 'agua-dia--baja'); void caja.offsetWidth;
    caja.classList.add(sube ? 'agua-dia--sube' : 'agua-dia--baja');
    const num = caja.querySelector('#agua-tomado'), t0 = performance.now();
    const contar = (t) => {
      const k = Math.min(1, (t - t0) / 900);
      num.textContent = litros(desde + (tomado - desde) * (1 - (1 - k) ** 3));
      if (k < 1) requestAnimationFrame(contar);
    };
    requestAnimationFrame(contar);
  };
  caja.querySelectorAll('[data-agua]').forEach((b) => b.addEventListener('click', async () => {
    const ml = Number(b.dataset.agua);
    const antes = Number(caja.dataset.tomado);
    pintar(antes + ml, true); // se ve al instante; si falla, se vuelve atrás
    try {
      const fila = await sumarAgua(ml);
      pila.push({ id: fila.id, ml });
      pintarDeshacer();
      try { navigator.vibrate?.(20); } catch { /* nada */ }
    } catch (err) { avisoError(err); pintar(antes, false); }
  }));
  deshacer?.addEventListener('click', async () => {
    const ultima = pila.pop();
    if (!ultima) return;
    const antes = Number(caja.dataset.tomado);
    pintar(Math.max(0, antes - ultima.ml), false);
    pintarDeshacer();
    try { await borrarAgua(ultima.id); } catch (err) { avisoError(err); pila.push(ultima); pintar(antes, true); pintarDeshacer(); }
  });
}

/** Para Hoy: lo que me falta comer y tomar hoy (meta, comido y agua). */
export async function resumenComidaHoy() {
  const d = await cargarDia(hoyISO());
  return datosPersona(estado.yo, d);
}

// Tarjeta «Tu semana» del día: promedio de calorías y proteína, barras de los 7 días y lo que viene bajo en vitaminas y minerales.
async function tarjetaSemana(cont, yo) {
  if (!cont) return;
  try {
    const hoy = hoyISO();
    const dias = Array.from({ length: 7 }, (_, i) => sumarDias(hoy, i - 6));
    const filas = datos(await sb.from('porciones').select('kcal, proteina_g, comida:comidas!inner(fecha, hogar_id)')
      .eq('persona_id', yo.p.id).eq('comida.hogar_id', estado.yo.hogar_id).gte('comida.fecha', dias[0]).lte('comida.fecha', hoy));
    const porDia = dias.map((f) => filas.filter((x) => x.comida.fecha === f).reduce((a, x) => ({ kcal: a.kcal + Number(x.kcal ?? 0), prot: a.prot + Number(x.proteina_g ?? 0) }), { kcal: 0, prot: 0 }));
    const con = porDia.filter((x, i) => x.kcal > 300 && dias[i] !== hoy);
    const meta = yo.metas.ok ? yo.metas.kcal : null;
    const max = Math.max(meta ?? 0, ...porDia.map((x) => x.kcal), 1);
    const prom = (k) => (con.length ? Math.round(con.reduce((a, x) => a + x[k], 0) / con.length) : 0);
    cont.innerHTML = `
      <span class="semana-comida__barras" aria-hidden="true">${porDia.map((x, i) => `<i style="--h:${Math.max(4, (x.kcal / max) * 100)}%" class="${dias[i] === hoy ? 'hoy' : ''}"></i>`).join('')}${meta ? `<b style="--h:${(meta / max) * 100}%"></b>` : ''}</span>
      <span class="semana-comida__texto">${con.length
        ? `<strong>${kc(prom('kcal'))}</strong> kcal/día · <strong>${prom('prot')}</strong> g de proteína<br><span class="quieto">Promedio de ${con.length} día${con.length === 1 ? '' : 's'} registrado${con.length === 1 ? '' : 's'}</span>`
        : '<span class="quieto">Registra tus comidas y acá ves cómo va tu semana.</span>'}<span class="semana-comida__micros" id="semana-comida-micros"></span></span>`;
    const bajos = await import('../micros.js').then((M) => M.bajosParaIA()).catch(() => null);
    const m = cont.querySelector('#semana-comida-micros');
    if (m && bajos?.length) m.innerHTML = `<br><span class="semana-comida__aviso">Vas bajo en ${esc(bajos.map((b) => b.nutriente.toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' y $1'))}</span>`;
  } catch { cont.innerHTML = '<span class="quieto">Toca para ver tu semana.</span>'; }
}

// ---------- Despensa: tarjeta arriba para contar qué hay en casa ----------
const CLAVE_DESPENSA = () => `bloque-despensa-pospuesta-${estado.yo.id}`;
function htmlPedirDespensa(despensa) {
  let hasta = null;
  try { hasta = localStorage.getItem(CLAVE_DESPENSA()); } catch { /* nada */ }
  if (hasta && hasta > hoyISO()) return '';
  // Si la despensa se actualizó hace poco (menos de 15 días), no hace falta pedirla.
  const reciente = despensa.some((p) => p.agregado_en && (Date.now() - new Date(p.agregado_en)) < 15 * 864e5);
  if (reciente) return '';
  return `
    <section class="tarjeta pedir-despensa" id="pedir-despensa">
      <div class="pedir-despensa__cab"><span class="pedir-despensa__icono" aria-hidden="true">🛒</span>
        <div><strong>¿Qué tienes en casa para comer o cocinar?</strong>
        <p>Pásame una foto de la refri, la alacena o el ticket del súper, o escríbelo. Así te armo recetas con lo que tienes, aprendo tus gustos y te sugiero qué comprar.</p></div></div>
      <div class="pedir-despensa__botones">
        <button type="button" class="boton boton--chico" id="pd-abrir">Contarle a la IA</button>
        <button type="button" class="boton boton--texto boton--chico" id="pd-manana">Mañana</button>
        <button type="button" class="boton boton--texto boton--chico" id="pd-ignorar">Ignorar</button>
      </div>
    </section>`;
}
function conectarPedirDespensa(app, abrir) {
  const caja = app.querySelector('#pedir-despensa');
  if (!caja) return;
  const posponer = (dias, texto) => {
    try { localStorage.setItem(CLAVE_DESPENSA(), sumarDias(hoyISO(), dias)); } catch { /* nada */ }
    caja.classList.add('pedir-despensa--sale');
    setTimeout(() => caja.remove(), 320);
    aviso(texto);
  };
  caja.querySelector('#pd-abrir').addEventListener('click', abrir);
  caja.querySelector('#pd-manana').addEventListener('click', () => posponer(1, 'Te lo recuerdo mañana.'));
  caja.querySelector('#pd-ignorar').addEventListener('click', () => posponer(15, 'Listo, te lo vuelvo a preguntar en 15 días. La despensa está en «¿Qué como ahora?».'));
}

// ---------- Acordeón con animación ----------
function conectarAcordeon(det) {
  if (!det) return;
  const sum = det.querySelector('summary'), cuerpo = det.querySelector('.acordeon__cuerpo');
  sum.addEventListener('click', (e) => {
    e.preventDefault();
    const abrir = !det.open;
    try { localStorage.setItem('bloque-ahora-cerrado', abrir ? '0' : '1'); } catch { /* nada */ }
    if (abrir) {
      det.open = true;
      const alto = cuerpo.scrollHeight;
      cuerpo.animate([{ height: '0px', opacity: 0 }, { height: `${alto}px`, opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
    } else {
      const alto = cuerpo.scrollHeight;
      const an = cuerpo.animate([{ height: `${alto}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 260, easing: 'cubic-bezier(.4,0,.2,1)' });
      an.onfinish = () => { det.open = false; };
    }
  });
}

// ---------- Tu objetivo: cómo vas, en palabras ----------
function htmlTuObjetivo(x) {
  const m = x.metas;
  const obj = OBJETIVOS[x.foco];
  if (!obj) return '';
  const peso = m.ok ? m.peso : null;
  const real = x.tendencia?.kgSemana ?? null;
  const r = ritmoEsperado(x.foco, peso);
  const bajar = (r.min + r.max) / 2 < -0.05, subir = (r.min + r.max) / 2 > 0.05;
  const kg = (v) => Math.abs(v).toLocaleString('es-EC', { maximumFractionDigits: 2 });
  let estado = 'sin', como = 'Pésate 2 o 3 veces por semana para ver si vas bien.';
  if (real != null) {
    const ok = real >= r.min - 0.05 && real <= r.max + 0.05;
    const contra = (subir && real < -0.05) || (bajar && real > 0.05);
    estado = ok ? 'ok' : contra ? 'mal' : 'ojo';
    const va = Math.abs(real) < 0.05 ? 'Tu peso está estable' : `Estás ${real < 0 ? 'bajando' : 'subiendo'} ${kg(real)} kg por semana`;
    const ideal = bajar ? `lo ideal es bajar ${kg(r.max)}–${kg(r.min)} kg` : subir ? `lo ideal es subir ${kg(r.min)}–${kg(r.max)} kg` : 'lo ideal es mantenerte';
    como = `${va}; ${ideal}. ${ok ? '¡Vas bien!' : contra ? 'Vas en contra de tu objetivo: tu meta ya se ajustó.' : 'Tu meta de calorías ya se ajustó para corregirlo.'}`;
  }
  const dif = m.ok ? Math.round((1 - m.kcal / m.gasto) * 100) : null;
  const plan = m.ok ? (dif > 3 ? `Comes ~${dif} % menos de lo que gastas (~${kc(m.gasto)} kcal hoy)` : dif < -3 ? `Comes ~${-dif} % más de lo que gastas (~${kc(m.gasto)} kcal hoy)` : `Comes lo mismo que gastas (~${kc(m.gasto)} kcal hoy)`) : null;
  const porque = { recomposicion: 'para bajar grasa sin perder músculo, con proteína alta.', masa_muscular: 'para subir de peso ganando músculo.', perder_grasa: 'para bajar de peso cuidando el músculo con proteína alta.', mantenimiento: 'para mantener tu peso.', cardio: 'con energía para tus entrenos de cardio.' }[x.foco] ?? '';
  return `
    <section class="tarjeta tu-objetivo tu-objetivo--${estado}">
      <div class="tu-objetivo__cab"><span aria-hidden="true">🎯</span><div><small>Tu objetivo</small><strong>${esc(obj.nombre)}</strong></div></div>
      <p class="tu-objetivo__como">${esc(como)}</p>
      ${plan ? `<p class="tu-objetivo__plan">${esc(plan)}${m.ajustePeso > 0 ? ': subí tu meta porque tu peso va más rápido de lo ideal, así no pierdes músculo.' : m.ajustePeso < 0 ? ': bajé tu meta porque tu peso no está respondiendo.' : ` ${porque}`}${m.vidaDiaria ? ' Tu gasto sale de tu reloj.' : ''}</p>` : ''}
      <div class="tu-objetivo__botones">
        <button type="button" class="boton boton--sec boton--chico" id="cambiar-objetivo">Cambiar mi objetivo</button>
        <a class="enlace-chico" href="#/cuerpo">Ver mi progreso ›</a>
      </div>
    </section>`;
}
