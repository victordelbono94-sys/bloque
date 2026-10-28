// Pantalla Comida: metas del día de cada uno, lo que comieron, snacks para los
// entrenos y la despensa (paquetes que se van usando).
import { sb, estado, datos, nombrePersona, otraPersona } from '../db.js';
import { esc, aviso, avisoError, abrirDialogo, grupoChips, valorChips } from '../ui.js';
import { hoyISO, sumarDias, diaLargo, diaCorto, numeroDia } from '../fechas.js';
import { calcularMetas, consejosDelDia, snacksDelDia, tendenciaPeso, OBJETIVOS } from '../nutricion.js';
import { buscarEnCatalogo, buscarEnOFF, porCodigo, guardarAlimento, macros, sumar, cargarCatalogo } from '../alimentos.js';
import { escanearCodigo } from '../escaner.js';

const MOMENTOS = {
  desayuno: 'Desayuno', almuerzo: 'Almuerzo', merienda: 'Merienda', cena: 'Cena', snack: 'Snack',
  pre_entreno: 'Antes de entrenar', post_entreno: 'Después de entrenar',
};
const kc = (n) => Math.round(n).toLocaleString('es-EC');
const g = (n) => `${Math.round(n)} g`;

function momentoPorHora(d = new Date()) {
  const m = d.getHours() * 60 + d.getMinutes();
  if (m < 630) return 'desayuno';
  if (m < 930) return 'almuerzo';
  if (m < 1110) return 'merienda';
  return 'cena';
}

// ---------- Datos del día ----------

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
    sb.from('comidas').select('*, comida_items(id, gramos, despensa_id, alimento:alimentos(*)), porciones(*)')
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

// ---------- Pantalla ----------

export async function vistaComida(app) {
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(location.hash.split('/')[2] ?? '') ? location.hash.split('/')[2] : hoyISO();
  const esHoy = fecha === hoyISO();
  let d;
  try {
    [d] = await Promise.all([cargarDia(fecha), cargarCatalogo()]);
  } catch (err) {
    // La base todavía no tiene las tablas de la dieta (falta aplicar la migración).
    if (['PGRST205', '42P01', 'PGRST200'].includes(err?.code) || /alimentos|despensa|comida_items/.test(err?.message ?? '')) {
      app.innerHTML = `
        <header class="encabezado"><div><h1 class="titulo">Comida</h1></div></header>
        <div class="tarjeta"><p style="margin:0"><strong>Casi lista.</strong> Falta terminar de preparar la base de datos de la dieta. Vuelve a abrir esta sección en un rato.</p></div>`;
      return;
    }
    throw err;
  }
  const personas = [...estado.personas].sort((a, b) => (a.id === estado.yo.id ? -1 : b.id === estado.yo.id ? 1 : 0));
  const info = personas.map((p) => datosPersona(p, d));
  const yo = info[0];
  const snacks = esHoy ? snacksDelDia(yo.eventos, yo.metas.ok ? yo.metas.peso : null) : [];

  app.innerHTML = `
    <header class="encabezado">
      <div>
        <h1 class="titulo">Comida</h1>
        <p class="subtitulo">${esc(esHoy ? 'Hoy' : diaLargo(fecha))}</p>
      </div>
      <div class="fila" style="gap:6px">
        <a class="boton boton--sec boton--chico boton--icono" href="#/comida/${sumarDias(fecha, -1)}" aria-label="Día anterior">‹</a>
        ${esHoy ? '' : `<a class="boton boton--sec boton--chico" href="#/comida">Hoy</a>`}
        ${esHoy ? '' : `<a class="boton boton--sec boton--chico boton--icono" href="#/comida/${sumarDias(fecha, 1)}" aria-label="Día siguiente">›</a>`}
      </div>
    </header>

    ${htmlResumen(yo, true)}
    ${info.slice(1).map((x) => htmlResumen(x, false)).join('')}

    <button type="button" class="boton boton--bloque" id="registrar" style="margin-top:16px">+ Registrar comida</button>

    ${snacks.length ? `
      <section class="seccion" aria-labelledby="t-snacks">
        <h2 class="seccion__titulo" id="t-snacks">Para tus entrenos de hoy</h2>
        <div class="tarjeta pila snacks">${snacks.map(htmlSnack).join('')}</div>
      </section>` : ''}

    <section class="seccion" aria-labelledby="t-comidas">
      <h2 class="seccion__titulo" id="t-comidas">${esHoy ? 'Lo que comieron hoy' : 'Lo que comieron'}</h2>
      ${d.comidas.length
        ? `<div class="pila">${d.comidas.map(htmlComida).join('')}</div>`
        : '<p class="vacio">Todavía nada. Registra la primera comida del día.</p>'}
    </section>

    <section class="seccion" aria-labelledby="t-despensa">
      <div class="fila fila--entre" style="margin-bottom:10px">
        <h2 class="seccion__titulo" id="t-despensa" style="margin:0">Despensa</h2>
        <button type="button" class="boton boton--texto boton--chico" id="agregar-paquete">+ Agregar paquete</button>
      </div>
      ${d.despensa.length
        ? `<div class="tarjeta pila" style="gap:12px">${d.despensa.map(htmlPaquete).join('')}</div>`
        : '<p class="vacio">Carga los paquetes que compras (fideos, arroz, avena…) y al registrar una comida eliges cuánto usaste.</p>'}
    </section>`;

  const recargar = () => vistaComida(app);
  const ctx = { fecha, esHoy, info, despensa: d.despensa, recargar };
  app.querySelector('#registrar').addEventListener('click', () => dialogoComida(ctx));
  app.querySelector('#agregar-paquete').addEventListener('click', () => dialogoPaquete(ctx));
  app.querySelectorAll('[data-comida]').forEach((b) => b.addEventListener('click', () =>
    dialogoDetalle(d.comidas.find((c) => c.id === b.dataset.comida), ctx)));
  app.querySelectorAll('[data-paquete]').forEach((b) => b.addEventListener('click', () =>
    dialogoEditarPaquete(d.despensa.find((x) => x.id === b.dataset.paquete), ctx)));
  app.querySelector('#cambiar-objetivo')?.addEventListener('click', () => dialogoObjetivo(yo.foco, recargar));
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

function htmlComida(c) {
  const nombres = c.comida_items.map((i) => i.alimento?.nombre).filter(Boolean);
  const texto = c.descripcion || nombres.slice(0, 4).join(', ') + (nombres.length > 4 ? '…' : '');
  return `
    <button type="button" class="tarjeta comida-fila" data-comida="${esc(c.id)}">
      <div class="fila fila--entre">
        <strong>${esc(MOMENTOS[c.momento] ?? c.momento)}</strong>
        <span class="quieto">${c.hora ? esc(c.hora.slice(0, 5)) : ''}</span>
      </div>
      <p class="comida-fila__texto">${esc(texto || 'Sin detalle')}</p>
      <div class="comida-fila__porciones">
        ${c.porciones.map((x) => `<span>${esc(x.persona_id === estado.yo.id ? 'Yo' : nombrePersona(x.persona_id))} <strong>${kc(x.kcal ?? 0)}</strong> kcal · ${Math.round(x.proteina_g ?? 0)} g prot</span>`).join('')}
      </div>
    </button>`;
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

function unir(l) { return l.length < 2 ? l[0] : `${l.slice(0, -1).join(', ')} y ${l.at(-1)}`; }

// ---------- Buscar un alimento (catálogo, Open Food Facts, código, a mano) ----------

/**
 * Panel de búsqueda dentro de un diálogo.
 * @param {HTMLElement} cont
 * @param {{ despensa?: Array, alElegir: (alimento, paquete) => void }} op
 */
function panelBuscar(cont, { despensa = [], alElegir }) {
  cont.innerHTML = `
    <div class="ba">
      <div class="ba__fila">
        <input type="search" id="ba-q" autocomplete="off" placeholder="Buscar: arroz, huevo, avena Quaker…" aria-label="Buscar alimento">
        <button type="button" class="boton boton--sec boton--icono" id="ba-escanear" aria-label="Escanear código de barras">
          <svg class="icono" viewBox="0 0 24 24" style="width:22px;height:22px"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M7 8v8M10 8v8M13 8v8M16.5 8v8"/></svg>
        </button>
      </div>
      <div class="ba__res" id="ba-res"></div>
      <button type="button" class="boton boton--texto boton--chico" id="ba-crear" style="align-self:flex-start;padding:0">No está: crear con la etiqueta</button>
      <div id="ba-form" hidden></div>
    </div>`;
  const q = cont.querySelector('#ba-q');
  const res = cont.querySelector('#ba-res');
  let pedido = 0, espera = null, offLista = [];

  const fila = (a, i, origen, extra = '') => `
    <button type="button" class="ba__item" data-origen="${origen}" data-i="${i}">
      <span><strong>${esc(a.nombre)}</strong>${a.marca ? ` <span class="quieto">· ${esc(a.marca)}</span>` : ''}</span>
      <span class="quieto">${extra || `${kc(a.kcal)} kcal · P ${Math.round(a.proteina_g)} · C ${Math.round(a.carbohidratos_g)} · G ${Math.round(a.grasas_g)} por 100 g`}</span>
    </button>`;

  let enDespensa = [], enCatalogo = [];
  const pintar = (cargandoOFF = false) => {
    res.innerHTML = [
      enDespensa.length ? `<p class="ba__grupo">En la despensa</p>${enDespensa.map((x, i) => fila(x.alimento, i, 'despensa', `Quedan ${g(x.gramos_restantes)}`)).join('')}` : '',
      enCatalogo.length ? `<p class="ba__grupo">Alimentos</p>${enCatalogo.map((a, i) => fila(a, i, 'catalogo')).join('')}` : '',
      offLista.length ? `<p class="ba__grupo">Productos (Open Food Facts)</p>${offLista.map((a, i) => fila(a, i, 'off')).join('')}` : '',
      cargandoOFF ? '<p class="quieto ba__vacio">Buscando productos con marca…</p>' : '',
      !cargandoOFF && q.value.trim().length >= 2 && !enDespensa.length && !enCatalogo.length && !offLista.length
        ? '<p class="quieto ba__vacio">No encontré nada. Escanea el código o créalo con la etiqueta.</p>' : '',
    ].join('');
  };
  const filtrarDespensa = (t) => {
    const n = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return despensa.filter((x) => !n || x.alimento.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(n));
  };
  enDespensa = filtrarDespensa('');
  pintar();

  q.addEventListener('input', () => {
    clearTimeout(espera);
    const t = q.value.trim();
    const turno = ++pedido;
    offLista = [];
    enDespensa = filtrarDespensa(t);
    buscarEnCatalogo(t).then((l) => { if (turno === pedido) { enCatalogo = l; pintar(t.length >= 3); } });
    if (t.length < 3) { enCatalogo = t ? enCatalogo : []; pintar(); return; }
    espera = setTimeout(async () => {
      try {
        const l = await buscarEnOFF(t);
        if (turno !== pedido) return;
        const propios = new Set(enCatalogo.map((a) => a.codigo_barras).filter(Boolean));
        offLista = l.filter((a) => !a.codigo_barras || !propios.has(a.codigo_barras));
      } catch { offLista = []; }
      if (turno === pedido) pintar();
    }, 600);
  });

  const elegir = async (a, paquete = null) => {
    try {
      const guardado = await guardarAlimento(a);
      alElegir(guardado, paquete);
    } catch (err) { avisoError(err); }
  };
  res.addEventListener('click', (e) => {
    const b = e.target.closest('.ba__item');
    if (!b) return;
    const i = Number(b.dataset.i);
    if (b.dataset.origen === 'despensa') elegir(enDespensa[i].alimento, enDespensa[i]);
    else if (b.dataset.origen === 'catalogo') elegir(enCatalogo[i]);
    else elegir(offLista[i]);
  });

  const formulario = (codigo = '', nombre = '') => {
    const f = cont.querySelector('#ba-form');
    f.hidden = false;
    f.innerHTML = `
      <div class="ba__manual pila" style="gap:10px">
        <p class="seccion__titulo" style="margin:0">Nuevo alimento · valores por 100 g</p>
        <div class="campo"><label for="m-nombre">Nombre</label><input id="m-nombre" maxlength="120" value="${esc(nombre)}"></div>
        <div class="grilla-2">
          <div class="campo"><label for="m-kcal">Calorías</label><input id="m-kcal" type="number" inputmode="decimal" min="0" max="950" step="0.1"></div>
          <div class="campo"><label for="m-prot">Proteína (g)</label><input id="m-prot" type="number" inputmode="decimal" min="0" max="100" step="0.1"></div>
          <div class="campo"><label for="m-carb">Carbohidratos (g)</label><input id="m-carb" type="number" inputmode="decimal" min="0" max="100" step="0.1"></div>
          <div class="campo"><label for="m-gras">Grasas (g)</label><input id="m-gras" type="number" inputmode="decimal" min="0" max="100" step="0.1"></div>
        </div>
        <div class="grilla-2">
          <div class="campo"><label for="m-paquete">El paquete trae (g)</label><input id="m-paquete" type="number" inputmode="decimal" min="1" placeholder="Opcional"></div>
          <div class="campo"><label for="m-codigo">Código de barras</label><input id="m-codigo" inputmode="numeric" maxlength="14" value="${esc(codigo)}" placeholder="Opcional"></div>
        </div>
        <p class="ayuda">Si la etiqueta da los valores por porción, divide por los gramos de la porción y multiplica por 100.</p>
        <button type="button" class="boton boton--chico" id="m-guardar">Guardar y usar</button>
      </div>`;
    f.querySelector('#m-guardar').addEventListener('click', () => {
      const v = (id) => f.querySelector(`#${id}`).value.trim();
      const n = (id) => (v(id) === '' ? null : Number(v(id)));
      if (!v('m-nombre')) return aviso('Ponle un nombre.', 'error');
      if (n('m-kcal') == null || n('m-kcal') > 950) return aviso('Revisa las calorías por 100 g.', 'error');
      const cod = v('m-codigo').replace(/\D/g, '');
      elegir({
        nombre: v('m-nombre'), kcal: n('m-kcal'), proteina_g: n('m-prot') ?? 0, carbohidratos_g: n('m-carb') ?? 0,
        grasas_g: n('m-gras') ?? 0, paquete_g: n('m-paquete'), codigo_barras: cod.length >= 6 ? cod : null, origen: 'manual',
      });
    });
    f.querySelector('#m-nombre').focus();
  };
  cont.querySelector('#ba-crear').addEventListener('click', () => formulario('', q.value.trim()));
  cont.querySelector('#ba-escanear').addEventListener('click', async () => {
    const codigo = await escanearCodigo();
    if (!codigo) return;
    try {
      const a = await porCodigo(codigo);
      if (a) return elegir(a);
      aviso('Ese producto no está en Open Food Facts: cárgalo con la etiqueta.');
      formulario(codigo, '');
    } catch (err) { avisoError(err); }
  });
  return { enfocar: () => q.focus() };
}

// ---------- Registrar una comida ----------

function dialogoComida(ctx) {
  const otro = otraPersona();
  const yoInfo = ctx.info[0];
  const otroInfo = ctx.info.find((x) => x.p.id === otro?.id);
  // Reparto por defecto: según las metas de calorías de cada uno.
  const pctYo = yoInfo.metas.ok && otroInfo?.metas.ok
    ? Math.round((yoInfo.metas.kcal / (yoInfo.metas.kcal + otroInfo.metas.kcal)) * 100) : 50;
  const items = [];

  const d = abrirDialogo(`
    <form class="dialogo comida-dialogo" novalidate>
      <h2 class="tarjeta__titulo">Registrar comida</h2>
      <div class="chips" id="momento" aria-label="Momento">
        ${Object.entries(MOMENTOS).map(([v, t]) => `<button type="button" class="chip" data-valor="${v}" aria-pressed="${v === momentoPorHora()}">${t}</button>`).join('')}
      </div>
      <div class="chips" id="quien" aria-label="Quién comió">
        ${otro ? `<button type="button" class="chip" data-valor="juntos" aria-pressed="true">${esc(otro.nombre)} y yo</button>` : ''}
        <button type="button" class="chip" data-valor="yo" aria-pressed="${!otro}">Solo yo</button>
        ${otro ? `<button type="button" class="chip" data-valor="otro" aria-pressed="false">Solo ${esc(otro.nombre)}</button>` : ''}
      </div>
      ${otro ? `
        <div class="campo" id="campo-reparto">
          <label for="reparto">Cuánto comió cada uno</label>
          <input id="reparto" type="range" min="10" max="90" step="5" value="${pctYo}">
          <div class="fila fila--entre quieto" style="font-size:14px"><span id="r-yo"></span><span id="r-otro"></span></div>
        </div>` : ''}

      <div id="items" class="pila" style="gap:8px"></div>
      <div id="buscar"></div>

      <div class="campo">
        <label for="descripcion">Nota</label>
        <input id="descripcion" maxlength="120" placeholder="Opcional: «almuerzo en la oficina»">
      </div>
      <div class="comida-total" id="total"></div>
      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
        <button type="submit" class="boton" id="guardar" disabled>Guardar</button>
      </div>
    </form>`, 'Registrar comida');

  const quien = d.querySelector('#quien');
  const reparto = d.querySelector('#reparto');
  const campoReparto = d.querySelector('#campo-reparto');
  grupoChips(d.querySelector('#momento'));
  grupoChips(quien, (v) => { if (campoReparto) campoReparto.hidden = v !== 'juntos'; pintar(); });
  reparto?.addEventListener('input', () => pintar());

  const fracciones = () => {
    const v = valorChips(quien);
    if (v === 'yo') return [[estado.yo.id, 1]];
    if (v === 'otro') return [[otro.id, 1]];
    const f = Number(reparto.value) / 100;
    return [[estado.yo.id, f], [otro.id, 1 - f]];
  };

  const pintar = () => {
    const cont = d.querySelector('#items');
    cont.innerHTML = items.map((it, i) => {
      const m = macros(it.alimento, it.gramos);
      return `
        <div class="item-comida">
          <div class="item-comida__info">
            <strong>${esc(it.alimento.nombre)}</strong>
            <span class="quieto">${kc(m.kcal)} kcal · P ${Math.round(m.proteina)} · C ${Math.round(m.carbos)} · G ${Math.round(m.grasas)}${it.paquete ? ` · de la despensa` : ''}</span>
            <div class="item-comida__atajos">
              ${it.alimento.porcion_g ? `<button type="button" class="chip chip--mini" data-mas="${i}">+ ${esc(it.alimento.porcion_nombre ?? 'porción')}</button>` : ''}
              ${it.paquete ? `<button type="button" class="chip chip--mini" data-todo="${i}">Todo (${g(it.paquete.gramos_restantes)})</button>` : ''}
            </div>
          </div>
          <label class="item-comida__gramos"><input type="number" inputmode="decimal" min="1" step="1" value="${Math.round(it.gramos)}" data-gramos="${i}" aria-label="Gramos de ${esc(it.alimento.nombre)}"> g</label>
          <button type="button" class="item-comida__quitar" data-quitar="${i}" aria-label="Quitar ${esc(it.alimento.nombre)}">×</button>
        </div>`;
    }).join('');
    const total = sumar(items.map((it) => macros(it.alimento, it.gramos)));
    const fr = fracciones();
    if (reparto) {
      d.querySelector('#r-yo').textContent = `Yo ${reparto.value}% · ${kc(total.kcal * reparto.value / 100)} kcal`;
      d.querySelector('#r-otro').textContent = `${otro.nombre} ${100 - reparto.value}% · ${kc(total.kcal * (100 - reparto.value) / 100)} kcal`;
    }
    d.querySelector('#total').innerHTML = items.length ? `
      <strong>Total ${kc(total.kcal)} kcal</strong> · P ${Math.round(total.proteina)} · C ${Math.round(total.carbos)} · G ${Math.round(total.grasas)}
      ${fr.length > 1 ? '' : `<span class="quieto"> · para ${esc(fr[0][0] === estado.yo.id ? 'mí' : otro.nombre)}</span>`}` : '';
    d.querySelector('#guardar').disabled = !items.length;
    cont.querySelectorAll('[data-gramos]').forEach((inp) => inp.addEventListener('change', () => {
      const v = Number(inp.value);
      items[Number(inp.dataset.gramos)].gramos = v > 0 ? v : 1;
      pintar();
    }));
    cont.querySelectorAll('[data-quitar]').forEach((b) => b.addEventListener('click', () => { items.splice(Number(b.dataset.quitar), 1); pintar(); }));
    cont.querySelectorAll('[data-mas]').forEach((b) => b.addEventListener('click', () => {
      const it = items[Number(b.dataset.mas)];
      it.gramos = (it.sinTocar ? 0 : it.gramos) + Number(it.alimento.porcion_g);
      it.sinTocar = false;
      pintar();
    }));
    cont.querySelectorAll('[data-todo]').forEach((b) => b.addEventListener('click', () => {
      const it = items[Number(b.dataset.todo)];
      it.gramos = Number(it.paquete.gramos_restantes);
      pintar();
    }));
  };

  panelBuscar(d.querySelector('#buscar'), {
    despensa: ctx.despensa,
    alElegir: (alimento, paquete) => {
      const gramos = paquete ? Number(paquete.gramos_restantes) : Number(alimento.porcion_g ?? 100);
      items.push({ alimento, gramos, paquete, sinTocar: !paquete });
      d.querySelector('#ba-q').value = '';
      d.querySelector('#ba-q').dispatchEvent(new Event('input'));
      d.querySelector('#ba-form').hidden = true;
      pintar();
    },
  });
  pintar();

  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!items.length) return;
    const boton = d.querySelector('#guardar');
    boton.disabled = true;
    const ahora = new Date();
    try {
      const comida = datos(await sb.from('comidas').insert({
        hogar_id: estado.yo.hogar_id,
        fecha: ctx.fecha,
        momento: valorChips(d.querySelector('#momento')) ?? momentoPorHora(),
        hora: ctx.esHoy ? `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}` : null,
        descripcion: d.querySelector('#descripcion').value.trim() || null,
        creada_por: estado.yo.id,
      }).select('id').single());
      datos(await sb.from('comida_items').insert(items.map((it) => ({
        comida_id: comida.id, alimento_id: it.alimento.id, gramos: Math.round(it.gramos * 10) / 10, despensa_id: it.paquete?.id ?? null,
      }))));
      const total = sumar(items.map((it) => macros(it.alimento, it.gramos)));
      const r1 = (n) => Math.round(n * 10) / 10;
      datos(await sb.from('porciones').insert(fracciones().map(([persona, f]) => ({
        comida_id: comida.id, persona_id: persona, fraccion: Math.round(f * 1000) / 1000,
        kcal: r1(total.kcal * f), proteina_g: r1(total.proteina * f), carbohidratos_g: r1(total.carbos * f), grasas_g: r1(total.grasas * f),
      }))));
      // Lo usado sale de la despensa.
      for (const it of items.filter((x) => x.paquete)) {
        const quedan = Math.max(0, Number(it.paquete.gramos_restantes) - it.gramos);
        await sb.from('despensa').update({ gramos_restantes: quedan, terminado_en: quedan < 1 ? new Date().toISOString() : null }).eq('id', it.paquete.id);
      }
      d.close();
      aviso(`Registrado: ${kc(total.kcal)} kcal.`);
      ctx.recargar();
    } catch (err) {
      avisoError(err);
      boton.disabled = false;
    }
  });
}

function dialogoDetalle(c, ctx) {
  const total = sumar(c.comida_items.map((i) => macros(i.alimento, i.gramos)));
  const d = abrirDialogo(`
    <div class="dialogo">
      <h2 class="tarjeta__titulo">${esc(MOMENTOS[c.momento] ?? c.momento)}${c.hora ? ` · ${esc(c.hora.slice(0, 5))}` : ''}</h2>
      ${c.descripcion ? `<p class="quieto" style="margin:-8px 0 0">${esc(c.descripcion)}</p>` : ''}
      <ul class="lista-ajustes">
        ${c.comida_items.map((i) => `<li>${esc(i.alimento.nombre)} <span>${g(i.gramos)} · ${kc(macros(i.alimento, i.gramos).kcal)} kcal</span></li>`).join('')}
      </ul>
      <p style="margin:0"><strong>Total ${kc(total.kcal)} kcal</strong> · P ${Math.round(total.proteina)} · C ${Math.round(total.carbos)} · G ${Math.round(total.grasas)}</p>
      <div class="pila" style="gap:4px">
        ${c.porciones.map((x) => `<p class="quieto" style="margin:0">${esc(x.persona_id === estado.yo.id ? 'Yo' : nombrePersona(x.persona_id))}: ${Math.round(Number(x.fraccion) * 100)}% · ${kc(x.kcal)} kcal · ${Math.round(x.proteina_g)} g de proteína</p>`).join('')}
      </div>
      <div class="dialogo__pie">
        <button type="button" class="boton boton--peligro" id="borrar" style="margin-right:auto">Eliminar</button>
        <button type="button" class="boton boton--sec" data-cerrar>Cerrar</button>
      </div>
    </div>`, 'Detalle de la comida');
  d.querySelector('#borrar').addEventListener('click', async () => {
    try {
      // Lo que salió de la despensa vuelve.
      for (const i of c.comida_items.filter((x) => x.despensa_id)) {
        const p = datos(await sb.from('despensa').select('gramos_restantes, gramos_total').eq('id', i.despensa_id).maybeSingle());
        if (p) await sb.from('despensa').update({ gramos_restantes: Math.min(Number(p.gramos_total), Number(p.gramos_restantes) + Number(i.gramos)), terminado_en: null }).eq('id', i.despensa_id);
      }
      datos(await sb.from('comidas').delete().eq('id', c.id));
      d.close();
      aviso('Comida eliminada.');
      ctx.recargar();
    } catch (err) { avisoError(err); }
  });
}

// ---------- Despensa ----------

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

// ---------- Objetivo ----------

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
