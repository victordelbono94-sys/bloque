// Pantalla Comida, en tres pestañas:
//   Día      → cuánto falta, registrar rápido (escribir, foto, frecuentes), qué comer ahora y lo comido
//   Semana   → cómo vienen los últimos 7 días contra la meta
//   Despensa → lo que hay en casa (cargado con Gemini) e ideas para cocinar con eso
import { sb, estado, datos } from '../db.js';
import { esc, aviso, avisoError, abrirDialogo } from '../ui.js';
import { hoyISO, sumarDias, diaLargo, diaCorto, numeroDia } from '../fechas.js';
import { calcularMetas, consejosDelDia, snacksDelDia, tendenciaPeso, OBJETIVOS } from '../nutricion.js';
import { macros, sumar, cargarCatalogo } from '../alimentos.js';
import { panelBuscar } from '../comida/buscar.js';
import { abrirRegistro } from '../comida/registro.js';
import {
  MOMENTOS, ORDEN_MOMENTO, kc, g, cantidadTexto, momentoPorHora, gemini, fotoBase64, aAlimento, frecuentes, normalizar,
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
    if (pestana === 'semana') return await vistaSemana(app);
    if (pestana === 'despensa') return await vistaDespensa(app);
    return await vistaDia(app, fecha);
  } catch (err) {
    // La base todavía no tiene las tablas de la dieta (falta aplicar la migración).
    if (['PGRST205', '42P01', 'PGRST200'].includes(err?.code) || /alimentos|despensa|comida_items/.test(err?.message ?? '')) {
      app.innerHTML = `
        <header class="encabezado"><div><h1 class="titulo">Comida</h1></div></header>
        <div class="tarjeta"><p style="margin:0"><strong>Casi lista.</strong> Falta terminar de preparar la base de datos de la dieta.</p></div>`;
      return;
    }
    throw err;
  }
}

function pestanas(activa, fecha) {
  const t = [['dia', 'Día', fecha && fecha !== hoyISO() ? `#/comida/${fecha}` : '#/comida'], ['semana', 'Semana', '#/comida/semana'], ['despensa', 'Despensa', '#/comida/despensa']];
  return `<nav class="segmentos" aria-label="Secciones de comida">${t.map(([k, n, h]) => `<a href="${h}" class="segmentos__item" ${k === activa ? 'aria-current="page"' : ''}>${n}</a>`).join('')}</nav>`;
}

const ordenar = (comidas) => [...comidas].sort((a, b) =>
  (a.hora ?? '99').localeCompare(b.hora ?? '99') || ORDEN_MOMENTO.indexOf(a.momento) - ORDEN_MOMENTO.indexOf(b.momento));

// ---------- Día ----------

async function vistaDia(app, fecha) {
  const esHoy = fecha === hoyISO();
  const [d, frec] = await Promise.all([cargarDia(fecha), frecuentes(10)]);
  const personas = [...estado.personas].sort((a, b) => (a.id === estado.yo.id ? -1 : b.id === estado.yo.id ? 1 : 0));
  const info = personas.map((p) => datosPersona(p, d));
  const yo = info[0];
  const snacks = esHoy ? snacksDelDia(yo.eventos, yo.metas.ok ? yo.metas.peso : null) : [];
  const ctx = {
    fecha, esHoy, info, despensa: d.despensa, frecuentes: frec,
    recargar: (f) => { if (f && f !== fecha) location.hash = f === hoyISO() ? '#/comida' : `#/comida/${f}`; else vistaDia(app, fecha); },
  };

  app.innerHTML = `
    <header class="encabezado">
      <div>
        <h1 class="titulo">Comida</h1>
        <p class="subtitulo">${esc(esHoy ? 'Hoy' : diaLargo(fecha))}</p>
      </div>
      <div class="fila" style="gap:6px">
        <a class="boton boton--sec boton--chico boton--icono" href="#/comida/${sumarDias(fecha, -1)}" aria-label="Día anterior">‹</a>
        ${esHoy ? '' : `<a class="boton boton--sec boton--chico boton--icono" href="${sumarDias(fecha, 1) === hoyISO() ? '#/comida' : `#/comida/${sumarDias(fecha, 1)}`}" aria-label="Día siguiente">›</a>`}
      </div>
    </header>
    ${pestanas('dia', fecha)}

    <section class="tarjeta rapido" aria-label="Registrar rápido">
      <form class="rapido__fila" id="rapido">
        <input id="rapido-texto" autocomplete="off" maxlength="400" placeholder="¿Qué comiste? «2 huevos y un café»" aria-label="Qué comiste">
        <button type="submit" class="boton boton--chico" aria-label="Registrar">Agregar</button>
        <button type="button" class="boton boton--sec boton--chico boton--icono" id="rapido-foto" aria-label="Foto del plato">${ICONO_FOTO}</button>
        <input type="file" id="rapido-archivo" accept="image/*" hidden>
      </form>
      ${frec.length ? `
        <div class="frecuentes">
          ${frec.map((f, i) => `<button type="button" class="chip chip--mini" data-frec="${i}">+ ${esc(f.alimento.nombre.replace(/\s*\(.*\)\s*/g, '').replace(/ entero$/i, ''))}</button>`).join('')}
        </div>` : ''}
    </section>

    ${htmlResumen(yo, true)}
    ${info.slice(1).map((x) => htmlResumen(x, false)).join('')}



    ${esHoy ? `
      <section class="seccion" aria-labelledby="t-ahora">
        <h2 class="seccion__titulo" id="t-ahora">¿Qué como ahora?</h2>
        <div class="tarjeta pila" style="gap:12px">
          ${snacks.length ? htmlSnack(snacks[0]) + (snacks.length > 1 ? `<details class="snacks-mas"><summary>Ver ${snacks.length - 1} más</summary>${snacks.slice(1).map(htmlSnack).join('')}</details>` : '') : ''}
          <button type="button" class="boton boton--sec" id="ideas-btn">${ICONO_CHISPA} Ideas con lo que hay en casa</button>
          <div id="ideas" class="pila" style="gap:12px"></div>
        </div>
      </section>` : ''}

    <section class="seccion" aria-labelledby="t-comidas">
      <h2 class="seccion__titulo" id="t-comidas">${esHoy ? 'Lo que comieron hoy' : 'Lo que comieron'}</h2>
      ${d.comidas.length
        ? `<div class="pila">${ordenar(d.comidas).map(htmlComida).join('')}</div>`
        : `<p class="vacio">Todavía nada${esHoy ? ' hoy' : ''}. Escribe arriba lo que comiste.</p>`}
    </section>`;

  const form = app.querySelector('#rapido');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const texto = app.querySelector('#rapido-texto').value.trim();
    abrirRegistro(ctx, texto ? { texto } : {});
  });
  app.querySelector('#rapido-foto').addEventListener('click', () => app.querySelector('#rapido-archivo').click());
  app.querySelector('#rapido-archivo').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) abrirRegistro(ctx, { foto: f });
  });
  app.querySelectorAll('[data-frec]').forEach((b) => b.addEventListener('click', () => {
    const f = frec[Number(b.dataset.frec)];
    abrirRegistro(ctx, { items: [{ alimento: f.alimento, gramos: f.gramos }] });
  }));
  app.querySelectorAll('[data-comida]').forEach((b) => b.addEventListener('click', () =>
    abrirRegistro(ctx, { comida: d.comidas.find((c) => c.id === b.dataset.comida) })));
  app.querySelector('#cambiar-objetivo')?.addEventListener('click', () => dialogoObjetivo(yo.foco, () => vistaDia(app, fecha)));
  app.querySelector('#ideas-btn')?.addEventListener('click', (e) => mostrarIdeas(ctx, app.querySelector('#ideas'), e.currentTarget));
}

function htmlComida(c) {
  const quienDe = (id) => (id === estado.yo.id ? 'Yo' : estado.personas.find((p) => p.id === id)?.nombre ?? '');
  // Un renglón por alimento: lo compartido, lo igual para los dos ("c/u") o cuánto comió cada uno.
  const grupos = new Map();
  for (const i of c.comida_items) {
    const gr = grupos.get(i.alimento.id) ?? { alimento: i.alimento, compartido: 0, personas: new Map() };
    if (i.persona_id) gr.personas.set(i.persona_id, (gr.personas.get(i.persona_id) ?? 0) + Number(i.gramos));
    else gr.compartido += Number(i.gramos);
    grupos.set(i.alimento.id, gr);
  }
  const lineas = [...grupos.values()].map((gr) => {
    const partes = [];
    if (gr.compartido) partes.push(cantidadTexto(gr.alimento, gr.compartido));
    const cada = [...gr.personas.entries()];
    if (cada.length === 2 && Math.abs(cada[0][1] - cada[1][1]) < 1) partes.push(`${cantidadTexto(gr.alimento, cada[0][1])} c/u`);
    else if (cada.length === 1) partes.push(`solo ${quienDe(cada[0][0]) === 'Yo' ? 'yo' : quienDe(cada[0][0])} ${cantidadTexto(gr.alimento, cada[0][1])}`);
    else for (const [id, gramos] of cada) partes.push(`${quienDe(id)} ${cantidadTexto(gr.alimento, gramos)}`);
    return `${gr.alimento.nombre} · ${partes.join(' · ')}`;
  });
  const total = sumar(c.comida_items.map((i) => macros(i.alimento, i.gramos)));
  return `
    <button type="button" class="tarjeta comida-fila" data-comida="${esc(c.id)}" aria-label="Editar ${esc(MOMENTOS[c.momento] ?? c.momento)}">
      <div class="fila fila--entre">
        <strong>${esc(MOMENTOS[c.momento] ?? c.momento)}${c.hora ? ` <span class="quieto">· ${esc(c.hora.slice(0, 5))}</span>` : ''}</strong>
        <span class="comida-fila__kcal">${kc(total.kcal)} kcal</span>
      </div>
      <ul class="comida-fila__items">${lineas.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      <div class="comida-fila__porciones">
        ${c.porciones.map((x) => `<span>${esc(x.persona_id === estado.yo.id ? 'Yo' : (estado.personas.find((p) => p.id === x.persona_id)?.nombre ?? ''))} <strong>${kc(x.kcal ?? 0)}</strong> kcal · ${Math.round(x.proteina_g ?? 0)} g prot</span>`).join('')}
        <span class="comida-fila__editar">Editar ›</span>
      </div>
    </button>`;
}

// ---------- Ideas con Gemini ----------

async function mostrarIdeas(ctx, cont, boton) {
  const yo = ctx.info[0];
  const clave = `bloque-ideas-${ctx.fecha}-${ctx.despensa.length}`;
  let ideas = null;
  try { const c = JSON.parse(sessionStorage.getItem(clave) ?? 'null'); if (c && Date.now() - c.t < 30 * 60e3 && !boton.dataset.otra) ideas = c.ideas; } catch { /* sin caché */ }
  if (!ideas) {
    boton.disabled = true;
    cont.innerHTML = '<p class="quieto" style="margin:0">Pensando ideas con tu despensa y lo que te falta hoy…</p>';
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
    };
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

async function vistaSemana(app) {
  const hoy = hoyISO();
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(hoy, i - 6));
  const ids = estado.personas.map((p) => p.id);
  const desde = new Date(`${dias[0]}T00:00:00`).toISOString();
  const [eventos, mediciones, objetivos, reloj, comidas] = await Promise.all([
    sb.from('calendario').select('*').eq('hogar_id', estado.yo.hogar_id).gte('fecha', dias[0]).lte('fecha', hoy).then(datos),
    sb.from('mediciones_corporales').select('persona_id, medido_en, peso_kg, grasa_pct, masa_magra_kg').in('persona_id', ids).order('medido_en', { ascending: false }).limit(120).then(datos),
    sb.from('objetivos').select('*').in('persona_id', ids).order('desde', { ascending: false }).then(datos),
    sb.from('sesiones_banda').select('persona_id, calorias, inicio').in('persona_id', ids).gte('inicio', desde).then(datos),
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
    <header class="encabezado"><div><h1 class="titulo">Comida</h1><p class="subtitulo">Últimos 7 días</p></div></header>
    ${pestanas('semana')}
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
}

// ---------- Despensa ----------

async function vistaDespensa(app) {
  const despensa = datos(await sb.from('despensa').select('*, alimento:alimentos(*)').eq('hogar_id', estado.yo.hogar_id)
    .is('terminado_en', null).order('agregado_en', { ascending: false }));
  const fecha = hoyISO();
  const recargar = () => vistaDespensa(app);

  app.innerHTML = `
    <header class="encabezado"><div><h1 class="titulo">Comida</h1><p class="subtitulo">Lo que hay en casa</p></div></header>
    ${pestanas('despensa')}
    <section class="tarjeta pila" style="gap:10px">
      <h2 class="seccion__titulo" style="margin:0">Agregar lo que compraste</h2>
      <textarea id="dp-texto" rows="2" maxlength="1200" class="area" placeholder="Ej.: 2 fundas de fideos de 400 g, 1 kg de arroz, 30 huevos, 2 litros de leche"></textarea>
      <div class="fila" style="gap:8px;flex-wrap:wrap">
        <button type="button" class="boton boton--chico" id="dp-leer">${ICONO_CHISPA} Agregar con Gemini</button>
        <button type="button" class="boton boton--sec boton--chico" id="dp-foto">${ICONO_FOTO} Foto de las compras</button>
        <button type="button" class="boton boton--texto boton--chico" id="dp-manual">Buscar o escanear</button>
        <input type="file" id="dp-archivo" accept="image/*" hidden>
      </div>
      <p class="ayuda" style="margin:0">Sirve una foto de las fundas, la alacena, la refri o el ticket.</p>
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
    revision.innerHTML = '<p class="quieto" style="margin:0">Gemini está leyendo…</p>';
    try {
      const { productos = [] } = await gemini('despensa', cuerpo);
      if (!productos.length) { revision.innerHTML = '<p class="quieto" style="margin:0">No encontré comida ahí. Prueba de nuevo.</p>'; return; }
      revisarProductos(revision, productos, recargar);
    } catch (err) {
      revision.innerHTML = `<p class="quieto" style="margin:0">${esc(err.message)}</p>`;
    } finally { boton.disabled = false; }
  };
  app.querySelector('#dp-leer').addEventListener('click', (e) => {
    const texto = app.querySelector('#dp-texto').value.trim();
    if (!texto) return app.querySelector('#dp-texto').focus();
    procesar({ texto }, e.currentTarget);
  });
  app.querySelector('#dp-foto').addEventListener('click', () => app.querySelector('#dp-archivo').click());
  app.querySelector('#dp-archivo').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) procesar({ imagen: await fotoBase64(f), tipo: 'image/jpeg', texto: app.querySelector('#dp-texto').value.trim() }, app.querySelector('#dp-foto'));
  });
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
    sb.from('sesiones_banda').select('persona_id, calorias, inicio').in('persona_id', ids)
      .gte('inicio', desde.toISOString()).lte('inicio', hasta.toISOString()).then(datos),
    sb.from('comidas').select('*, comida_items(id, gramos, despensa_id, persona_id, alimento:alimentos(*)), porciones(*)')
      .eq('hogar_id', hogar).eq('fecha', fecha).order('hora', { nullsFirst: true }).then(datos),
    sb.from('despensa').select('*, alimento:alimentos(*)').eq('hogar_id', hogar).is('terminado_en', null)
      .order('agregado_en', { ascending: false }).then(datos),
  ]);
  const rutinaIds = [...new Set(eventos.map((e) => e.rutina_id).filter(Boolean))];
  const rutinas = rutinaIds.length ? datos(await sb.from('rutinas').select('id, foco').in('id', rutinaIds)) : [];
  for (const e of eventos) e.liviana = rutinas.find((r) => r.id === e.rutina_id)?.foco === 'recuperacion';
  return { fecha, eventos, mediciones, objetivos, reloj, comidas, despensa };
}

function datosPersona(p, d) {
  const medicion = d.mediciones.find((m) => m.persona_id === p.id && m.peso_kg != null) ?? null;
  const grasa = d.mediciones.find((m) => m.persona_id === p.id && m.grasa_pct != null);
  const med = medicion ? { ...medicion, grasa_pct: medicion.grasa_pct ?? grasa?.grasa_pct ?? null } : null;
  const foco = d.objetivos.find((o) => o.persona_id === p.id)?.foco ?? 'recomposicion';
  const eventos = d.eventos.filter((e) => e.asistencia === 'juntos' || e.persona_id === p.id);
  const metas = calcularMetas({
    persona: p, medicion: med, foco, eventos,
    entrenosReloj: d.reloj.filter((s) => s.persona_id === p.id),
    hoy: new Date(`${d.fecha}T12:00:00`),
  });
  const comido = sumar(d.comidas.flatMap((c) => c.porciones.filter((x) => x.persona_id === p.id))
    .map((x) => ({ kcal: Number(x.kcal ?? 0), proteina: Number(x.proteina_g ?? 0), carbos: Number(x.carbohidratos_g ?? 0), grasas: Number(x.grasas_g ?? 0) })));
  const tendencia = tendenciaPeso(d.mediciones.filter((m) => m.persona_id === p.id), foco);
  return { p, metas, comido, foco, eventos, tendencia };
}


function barra(nombre, valor, meta, clase) {
  const pct = meta > 0 ? Math.min(100, (valor / meta) * 100) : 0;
  return `
    <div class="macro">
      <div class="macro__fila"><span>${nombre}</span><span><strong>${Math.round(valor)}</strong> / ${Math.round(meta)} g</span></div>
      <div class="macro__barra"><span class="${clase}" style="width:${pct}%"></span></div>
    </div>`;
}

function htmlResumen(x, esYo) {
  const { p, metas, comido } = x;
  if (!metas.ok) {
    return `
      <section class="tarjeta dia-comida ${esYo ? '' : 'dia-comida--otro'}" style="margin-top:12px">
        <h2 class="tarjeta__titulo">${esc(esYo ? 'Mi día' : p.nombre)}</h2>
        <p class="quieto" style="margin:8px 0 0">Para calcular ${esYo ? 'tu meta' : 'su meta'} falta ${esc(unir(metas.falta))}.</p>
        ${esYo ? '<a class="boton boton--sec boton--chico" style="margin-top:12px" href="#/perfil">Completar perfil</a>' : `<p class="ayuda" style="margin-top:6px">${esc(p.nombre)} lo completa desde su Perfil y Cuerpo.</p>`}
        ${comido.kcal ? `<p class="quieto" style="margin:10px 0 0">Comido hoy: ${kc(comido.kcal)} kcal · ${g(comido.proteina)} de proteína</p>` : ''}
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
  const notas = [...metas.notas, ...consejosDelDia(metas, comido), x.tendencia?.nota].filter(Boolean);
  return `
    <section class="tarjeta dia-comida" style="margin-top:4px">
      <div class="kcal">
        <div>
          <span class="kcal__numero">${kc(Math.abs(quedan))}</span>
          <span class="kcal__texto">${quedan >= 0 ? 'kcal por comer' : 'kcal de más'}</span>
        </div>
        <span class="quieto kcal__meta">${kc(comido.kcal)} de ${kc(metas.kcal)}</span>
      </div>
      <div class="kcal__barra"><span style="width:${pct}%"></span></div>
      <div class="macros">
        ${barra('Proteína', comido.proteina, metas.proteina, 'm-prot')}
        ${barra('Carbohidratos', comido.carbos, metas.carbos, 'm-carb')}
        ${barra('Grasas', comido.grasas, metas.grasas, 'm-gras')}
      </div>
      ${notas.length ? `<ul class="notas-comida">${notas.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      <p class="ayuda dia-comida__pie">
        Gasto estimado ${kc(metas.gasto)} kcal (${metas.medido ? `entrenos según el reloj: ${kc(metas.medido)}` : `entrenos: ${kc(metas.ejercicio)}`})
        · <button type="button" class="enlace-boton" id="cambiar-objetivo">${esc(OBJETIVOS[x.foco]?.nombre ?? 'Objetivo')}</button>
      </p>
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
    </form>`, 'Agregar a la despensa');
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
