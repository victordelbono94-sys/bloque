// Agregar o editar una comida, en una pantalla con dos pasos:
//   1. Qué comiste: la IA al centro (foto, texto o ambos) o a mano (buscar, escanear, habituales).
//      Debajo, la lista para revisar y si alcanza para esa comida (desayuno, almuerzo…) con sugerencias.
//   2. Quién comió (solo si en el hogar hay más personas): uno, varios, y si fue un plato cada uno o compartido.
import { sb, estado, datos } from '../db.js';
import { esc, aviso, avisoError, abrirDialogo, cara } from '../ui.js';
import { hoyISO } from '../fechas.js';
import { macros, sumar } from '../alimentos.js';
import { OBJETIVOS, diagnosticoDia } from '../nutricion.js';
import { panelBuscar } from './buscar.js';
import { esLiquido } from '../hidratacion.js';
import { ICONOS, htmlCompositor, conectarCompositor, burbujaPensando, htmlBienvenida, bajar } from '../chatia.js';
import { deporte } from '../deportes.js';
import { IC } from '../iconos.js';
import { tieneDieta, dietaParaIA, guardarDieta, dialogoDieta, TIPOS } from '../dieta.js';
import {
  MOMENTOS, PARTE_COMIDA, momentoPorHora, momentoSugerido, kc, g, cantidadTexto, gemini, fotoBase64, aAlimento,
  guardarComida, borrarComida,
} from './comun.js';

const ICONO = {
  camara: '<svg class="icono" viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  galeria: '<svg class="icono" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-5 4 4 2.5-2.5L20 18"/></svg>',
  buscar: '<svg class="icono" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
  menos: '<svg class="icono" viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
  mas: '<svg class="icono" viewBox="0 0 24 24"><path d="M6 12h12M12 6v12"/></svg>',
  chispa: '<svg class="icono" viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>',
  x: '<svg class="icono" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

const leerQuien = (momento) => { try { return JSON.parse(localStorage.getItem(`bloque-quien2-${momento}`) || 'null'); } catch { return null; } };
const guardarQuien = (momento, v) => { try { localStorage.setItem(`bloque-quien2-${momento}`, JSON.stringify(v)); } catch { /* nada */ } };
// ¿Es una pregunta sobre el plato (y no comida para agregar)? «me falta proteína», «está bien así», «¿le agrego arroz?»…
const esPregunta = (t) => /[?¿]/.test(t)
  || /^(qu[eé]|c[oó]mo|cu[aá]nt|est[aá]|estoy|me (falta|sobra|conviene|alcanza)|falta|sobra|deber|puedo|podr|sugi|recomi|alcanza|conviene|le (agrego|pongo|falta|sumo)|es (suficiente|mucho|poco)|tengo|hay|revis|dime|ayud|opina|vale)/i.test(t.trim());
const REVISION = 'Revisa este plato para mi objetivo: ¿cómo voy de proteína, carbohidratos y verduras? Si falta algo, dime qué agregar y cuánto; si sobra, qué quitar.';
const nombreCorto = (a) => a.nombre.replace(/\s*\(.*\)\s*/g, '').replace(/ entero$/i, '').slice(0, 24);

/**
 * @param {object} ctx { fecha, esHoy, info, despensa, frecuentes, habituales, recargar }
 * @param {object} [op] { comida, items, texto, foto, momento }
 */
export function abrirRegistro(ctx, op = {}) {
  const editar = !!op.comida;
  const fecha = op.comida?.fecha ?? ctx.fecha;
  const varios = estado.personas.length > 1;
  const items = (op.items ?? op.comida?.comida_items?.map((i) => ({
    alimento: i.alimento, gramos: Number(i.gramos), persona: i.persona_id ?? null,
    paquete: i.despensa_id ? ctx.despensa.find((p) => p.id === i.despensa_id) ?? { id: i.despensa_id, gramos_restantes: 0 } : null,
    gramosDespensa: i.gramos_despensa != null ? Number(i.gramos_despensa) : null,
  })) ?? []).map((x) => ({ ...x }));

  const sugerido = fecha === hoyISO() ? momentoSugerido(ctx.info?.[0]?.eventos ?? []) : null;
  let momento = op.momento ?? op.comida?.momento ?? sugerido ?? momentoPorHora();
  // Quién comió: lo de la comida que se edita, o lo último que eligieron para ese momento.
  const porciones = op.comida?.porciones ?? [];
  let quien = porciones.length ? porciones.map((x) => x.persona_id) : (leerQuien(momento) ?? [estado.yo.id]);
  quien = quien.filter((id) => estado.personas.some((p) => p.id === id));
  if (!quien.length) quien = [estado.yo.id];
  // Reparto cuando comen varios: 'compartido' (se divide), 'cada_uno' (un plato igual por persona), 'distinto' (cada cosa a su dueño).
  let reparto = items.some((it) => it.persona) ? 'distinto' : 'compartido';
  let paso = 1;
  let fotoPendiente = null;
  let sopaOfrecida = false; // ya se ofreció sumar el caldo de una sopa
  const chatLog = [];      // la conversación con la IA sobre este plato (se mantiene al volver del paso 2)
  const historial = [];    // lo mismo en texto, para que la IA recuerde lo hablado

  const d = abrirDialogo(`
    <div class="reg chatia">
      <header class="chatia__cab">
        <button type="button" class="chatia__boton-cab" id="r-izq" aria-label="Cerrar">${ICONOS.x}</button>
        <div class="chatia__titulo">
          <h2>${editar ? 'Editar comida' : 'Agregar comida'}</h2>
          <span class="chatia__sub"><button type="button" class="momento-pill" id="r-momento-btn" aria-expanded="false" aria-label="Cambiar el momento"></button><span id="r-paso"></span></span>
        </div>
        <div class="chatia__accion" id="r-accion"></div>
      </header>
      <div class="chips chips--scroll reg__momentos" id="r-momento" aria-label="Momento" hidden>
        ${Object.entries(MOMENTOS).map(([v, t]) => `<button type="button" class="chip chip--mini" data-valor="${v}">${t}</button>`).join('')}
      </div>
      <div class="chatia__cuerpo" id="r-cuerpo"></div>
      <footer class="chatia__pie" id="r-pie"></footer>
    </div>`, editar ? 'Editar comida' : 'Agregar comida', { pantalla: true });
  const $ = (q) => d.querySelector(q);
  // Izquierda: cerrar en el paso 1, volver en el paso 2.
  $('#r-izq').addEventListener('click', () => (paso === 2 ? pintarPaso1() : d.descartar()));
  // Atrás, tocar afuera o deslizar no borran lo anotado sin preguntar.
  d.proteger = () => paso === 2 || !!fotoPendiente || !!$('#r-texto')?.value.trim() || (!editar && items.length > 0);
  const pintarMomento = () => {
    $('#r-momento-btn').textContent = `${MOMENTOS[momento]} ▾`;
    if ($('#r-paso')) $('#r-paso').textContent = paso === 2 ? 'Paso 2 de 2 · quién comió' : '';
    d.querySelectorAll('#r-momento [data-valor]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.valor === momento)));
  };
  pintarMomento();
  $('#r-momento-btn').addEventListener('click', () => {
    const fila = $('#r-momento');
    fila.hidden = !fila.hidden;
    $('#r-momento-btn').setAttribute('aria-expanded', String(!fila.hidden));
  });
  d.querySelectorAll('#r-momento [data-valor]').forEach((b) => b.addEventListener('click', () => {
    momento = b.dataset.valor;
    pintarMomento();
    $('#r-momento').hidden = true;
    pintarMeta();
  }));

  // ---------- Paso 1: qué comiste ----------
  const lista = ctx.habituales?.length ? ctx.habituales : (ctx.frecuentes ?? []);
  const pintarPaso1 = () => {
    paso = 1;
    $('#r-momento-btn').hidden = false;
    pintarMomento();
    // Arriba (lo que se desplaza): tu plato con su desglose y la conversación con la IA.
    // Abajo, fijo como en una app de mensajes: el total + «Seguir», y el cuadro para escribirle a la IA o mandar una foto.
    $('#r-izq').innerHTML = ICONOS.x;
    $('#r-izq').setAttribute('aria-label', 'Cerrar');
    $('#r-accion').innerHTML = `<button type="button" class="chatia__seguir" id="r-seguir" disabled>${varios ? `Seguir${ICONOS.chevron}` : (editar ? 'Guardar' : 'Guardar')}</button>`;
    $('#r-cuerpo').innerHTML = `
      <div class="chatia__resumen" id="r-resumen" hidden><span>Tu plato</span><span class="comida-total" id="r-total"></span></div>
      <div id="r-buscar" hidden></div>
      <div id="r-vacio">${htmlBienvenida({
        titulo: '¿Qué comiste?',
        texto: 'Mándale una foto del plato o escríbelo como se lo contarías a alguien. La IA arma el plato y te dice cómo vas.',
        sugerencias: [
          { icono: IC.camara, texto: 'Sacar una foto del plato' },
          { icono: IC.nota, texto: '2 huevos revueltos, pan y café con leche' },
          { icono: IC.pregunta, texto: '¿Qué me conviene comer ahora?' },
        ],
      })}</div>
      <div id="r-items" class="pila" style="gap:8px"></div>
      <button type="button" class="chip chip--mini chip--sugerencia reg__de-despensa" id="r-de-despensa" hidden>+ Lo cociné con lo de la despensa</button>
      <div class="consejo" id="r-consejo" hidden>
        <div class="consejo__meta" id="r-meta"></div>
      </div>
      ${editar ? '<button type="button" class="boton boton--texto boton--chico reg__borrar" id="r-borrar">Eliminar esta comida</button>' : ''}
      <div class="ia-chat" id="r-chat" aria-live="polite">${chatLog.join('')}</div>`;
    $('#r-pie').hidden = false;
    $('#r-pie').innerHTML = `
      <div class="chatia__chips" id="r-rapidos" aria-label="Agregar rápido">
        <button type="button" class="chip chip--mini chip--buscar" id="r-buscar-abrir">${ICONO.buscar} Buscar</button>
        ${lista.map((f, i) => `<button type="button" class="chip chip--mini" data-frec="${i}">+ ${esc(nombreCorto(f.alimento))}</button>`).join('')}
      </div>
      ${htmlCompositor({
        id: 'r-ia', placeholder: '¿Qué comiste?', valor: op.texto ?? '',
        ids: { texto: 'r-texto', enviar: 'r-leer', camara: 'r-camara', galeria: 'r-galeria', foto: 'r-foto', quitar: 'r-foto-quitar', estado: 'r-estado' },
      })}`;
    conectarPaso1();
    pintarItems();
    if (fotoPendiente) mostrarFoto(fotoPendiente);
  };

  const mensaje = (t, cargando = false) => {
    const el = $('#r-estado');
    if (!el) return;
    el.hidden = !t; el.textContent = t ?? '';
  };

  const agregar = (alimento, gramos, paquete = null, persona = null) => { items.push({ alimento, gramos: Number(gramos) || 100, paquete, persona }); pintarItems(); };
  const paqueteDe = (alimento) => ctx.despensa.find((p) => p.alimento_id === alimento.id && Number(p.gramos_restantes) > 0);
  // El producto de la despensa que nombró la IA («Arroz blanco», «Huevos»): por nombre, el que tenga más usado primero.
  const sinTilde = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const paquetePorNombre = (nombre) => {
    const n = sinTilde(nombre);
    if (!n) return null;
    const hay = ctx.despensa.filter((p) => Number(p.gramos_restantes) > 0);
    return hay.find((p) => sinTilde(p.alimento?.nombre) === n)
      ?? hay.find((p) => sinTilde(p.alimento?.nombre).includes(n) || n.includes(sinTilde(p.alimento?.nombre))) ?? null;
  };

  // Guardar en la despensa (lo que no se come ahora): queda disponible para descontar después.
  const guardarEnDespensa = async (lista) => {
    const filas = lista.map((x) => ({ hogar_id: estado.yo.hogar_id, alimento_id: x.alimento.id, gramos_total: Math.round(x.gramos_total), gramos_restantes: Math.round(x.gramos_total) }));
    const nuevos = datos(await sb.from('despensa').insert(filas).select('*, alimento:alimentos(*)'));
    ctx.despensa = [...(ctx.despensa ?? []), ...nuevos];
    return nuevos;
  };

  let vistos = new Set();
  const pintarItems = () => {
    const cont = $('#r-items');
    if (!cont) return;
    const antes = vistos;
    vistos = new Set(items);
    cont.innerHTML = items.length ? items.map((it, i) => {
      const m = macros(it.alimento, it.gramos);
      const paquete = it.paquete, enDespensa = !paquete && paqueteDe(it.alimento);
      const dueno = it.persona ? estado.personas.find((p) => p.id === it.persona) : null;
      return `
        <div class="item-comida ${antes.has(it) ? 'item-comida--quieto' : ''}">
          <div class="item-comida__texto">
            <span class="item-comida__titulo"><strong>${esc(it.alimento.nombre)}</strong>${dueno ? `<span class="dueno dueno--${dueno.id === estado.yo.id ? 'yo' : 'otro'}">${esc(dueno.id === estado.yo.id ? 'Yo' : dueno.nombre)}</span>` : ''}</span>
            <span class="quieto">${esc(cantidadTexto(it.alimento, it.gramos))}${cantidadTexto(it.alimento, it.gramos).endsWith(' g') ? '' : ` · ${g(it.gramos)}`} · ${kc(m.kcal)} kcal · P ${Math.round(m.proteina)}</span>
            ${paquete ? `<button type="button" class="chip chip--mini chip--activo" data-despensa="${i}">De la despensa ✓${it.gramosDespensa && Math.round(it.gramosDespensa) !== Math.round(it.gramos) ? ` · usa ${g(it.gramosDespensa)}${paquete.alimento?.nombre && sinTilde(paquete.alimento.nombre) !== sinTilde(it.alimento.nombre) ? ` de ${esc(paquete.alimento.nombre.toLowerCase())}` : ''}` : ''}</button>`
              : enDespensa ? `<button type="button" class="chip chip--mini" data-despensa="${i}">Descontar de la despensa</button>` : ''}
            ${paquete ? '' : `<button type="button" class="item-comida__guardar" data-guardar="${i}">${IC.frasco}Es para guardar en la despensa</button>`}
          </div>
          <div class="paso-mini">
            <button type="button" data-menos="${i}" aria-label="Menos">${ICONO.menos}</button>
            <input type="number" inputmode="decimal" min="1" step="1" value="${Math.round(it.gramos)}" data-gramos="${i}" aria-label="Gramos de ${esc(it.alimento.nombre)}">
            <button type="button" data-mas="${i}" aria-label="Más">${ICONO.mas}</button>
          </div>
          <button type="button" class="item-comida__quitar" data-quitar="${i}" aria-label="Quitar ${esc(it.alimento.nombre)}">×</button>
        </div>`;
    }).join('') : '';
    const total = sumar(items.map((it) => macros(it.alimento, it.gramos)));
    $('#r-total').innerHTML = items.length ? `<strong>${kc(total.kcal)}</strong> kcal · P ${Math.round(total.proteina)} · C ${Math.round(total.carbos)} · G ${Math.round(total.grasas)}` : '';
    $('#r-seguir').disabled = !items.length;
    $('#r-resumen').hidden = !items.length;
    if ($('#r-de-despensa')) $('#r-de-despensa').hidden = !(ctx.despensa?.some((p) => Number(p.gramos_restantes) > 0) && items.length && items.some((it) => !it.paquete));
    if ($('#r-vacio')) $('#r-vacio').hidden = !!items.length || chatLog.length > 0;
    if ($('#r-rapidos')) $('#r-rapidos').hidden = items.length > 2;
    $('#r-ia') && conectado?.actualizar();
    if ($('#r-texto') && !fotoPendiente) $('#r-texto').placeholder = items.length ? 'Agrega, corrige o pregunta…' : '¿Qué comiste?';
    pintarMeta();

    const pasoDe = (it) => (Number(it.alimento.porcion_g) > 0 && Number(it.alimento.porcion_g) <= 250 ? Number(it.alimento.porcion_g) : 10);
    cont.querySelectorAll('[data-gramos]').forEach((inp) => inp.addEventListener('change', () => { const v = Number(inp.value); items[Number(inp.dataset.gramos)].gramos = v > 0 ? v : 1; pintarItems(); }));
    cont.querySelectorAll('[data-mas]').forEach((b) => b.addEventListener('click', () => { const it = items[Number(b.dataset.mas)]; it.gramos += pasoDe(it); pintarItems(); }));
    cont.querySelectorAll('[data-menos]').forEach((b) => b.addEventListener('click', () => { const it = items[Number(b.dataset.menos)]; it.gramos = Math.max(1, it.gramos - pasoDe(it)); pintarItems(); }));
    cont.querySelectorAll('[data-quitar]').forEach((b) => b.addEventListener('click', () => { items.splice(Number(b.dataset.quitar), 1); pintarItems(); }));
    // No se come ahora: va a la despensa (sale del plato).
    cont.querySelectorAll('[data-guardar]').forEach((b) => b.addEventListener('click', async () => {
      const it = items[Number(b.dataset.guardar)];
      b.disabled = true;
      try {
        await guardarEnDespensa([{ alimento: it.alimento, gramos_total: it.gramos }]);
        items.splice(items.indexOf(it), 1);
        pintarItems();
        aviso(`${it.alimento.nombre} quedó en la despensa (no cuenta como comido).`);
      } catch (err) { avisoError(err); b.disabled = false; }
    }));
    cont.querySelectorAll('[data-despensa]').forEach((b) => b.addEventListener('click', () => { const it = items[Number(b.dataset.despensa)]; it.paquete = it.paquete ? null : paqueteDe(it.alimento); it.gramosDespensa = null; pintarItems(); }));
  };

  // ¿Alcanza para esta comida? Se mira la parte del día que le toca (desayuno ~25 %, almuerzo ~33 %…).
  const balance = () => {
    const info = ctx.info?.find((x) => x.p.id === estado.yo.id);
    if (!info?.metas?.ok) return null;
    const mio = porPersona().find(([id]) => id === estado.yo.id)?.[1] ?? sumar(items.map((it) => macros(it.alimento, it.gramos)));
    // La meta de esta comida sale de lo que te QUEDA del día (meta, que ya suma lo que quemaste según el reloj, menos lo comido),
    // repartido entre esta comida y las principales que vienen después. La cena se lleva todo lo que queda.
    const antes = op.comida?.porciones?.find((x) => x.persona_id === estado.yo.id);
    const disponible = Math.max(0, info.metas.kcal - (info.comido.kcal - Number(antes?.kcal ?? 0)));
    const PRINCIPALES = ['desayuno', 'almuerzo', 'merienda', 'cena'];
    const k = PRINCIPALES.indexOf(momento);
    const parte = PARTE_COMIDA[momento] ?? 0.25;
    const resto = k >= 0 ? PRINCIPALES.slice(k).reduce((a, m) => a + (PARTE_COMIDA[m] ?? 0), 0) : 1;
    // Con tope: si te queda mucho para la cena, la meta no puede ser «todo el día» de una vez.
    const metaKcal = Math.min(k >= 0 ? disponible * (parte / resto) : disponible, info.metas.kcal * parte * 1.75);
    const meta = Math.round(metaKcal / 10) * 10;
    const protDisp = Math.max(0, info.metas.proteina - (info.comido.proteina - Number(antes?.proteina ?? 0)));
    // En las comidas principales, al menos lo que el músculo aprovecha de una vez (~0,4 g/kg, 25–45 g), si queda.
    const protMeta = Math.round(Math.min(
      Math.max(k >= 0 ? protDisp * (parte / resto) : protDisp * 0.5, k >= 0 ? Math.min(protDisp, info.metas.proteinaPorComida ?? 0) : 0),
      info.metas.proteina * parte * 1.75, protDisp || Infinity));
    const restoDia = disponible - mio.kcal;
    const quemado = Math.round(info.metas.medido || info.metas.ejercicio || 0);
    // El día completo con este plato: lo mismo que verá el resumen al guardar (mismo diagnóstico que usa la IA).
    const dia = {
      kcal: info.comido.kcal - Number(antes?.kcal ?? 0) + mio.kcal,
      proteina: info.comido.proteina - Number(antes?.proteina_g ?? antes?.proteina ?? 0) + mio.proteina,
      carbos: (info.comido.carbos ?? 0) + (mio.carbos ?? 0),
      grasas: (info.comido.grasas ?? 0) + (mio.grasas ?? 0),
    };
    const diag = diagnosticoDia({ metas: info.metas, comido: dia });
    return { info, mio, meta, protMeta, falta: meta - mio.kcal, restoDia, disponible, quemado, medido: !!info.metas.medido, diag };
  };
  const pintarMeta = () => {
    const b = items.length && paso === 1 ? balance() : null;
    const caja = $('#r-consejo');
    if (!caja) return;
    caja.hidden = !b;
    if (!b) return;
    const nombre = MOMENTOS[momento].toLowerCase();
    const femenino = ['merienda', 'cena'].includes(momento);
    const unBuen = `${femenino ? 'una buena' : 'un buen'} ${nombre}`;
    const pct = Math.min(100, Math.round((b.mio.kcal / b.meta) * 100));
    // El veredicto sale del mismo diagnóstico del día que usan el resumen y la IA: pasarse un poco es bueno para
    // ganar masa, neutro para mantener y algo a cuidar para bajar de peso. Solo «reta» cuando de verdad importa.
    const bajar = b.info.foco === 'perder_grasa';
    const bien = (t) => `<strong class="hecho">${t}</strong>`;
    const ojo = (t) => `<strong class="consejo__falta">${t}</strong>`;
    const tono = (t) => (b.diag.tono === 'ojo' ? ojo(t) : bien(t));
    let estadoTxt;
    if (b.diag.estado === 'pasado') estadoTxt = tono(b.diag.kcal);
    else if (b.falta > 120 && !bajar) estadoTxt = `${ojo(`Te faltan ~${kc(b.falta)} kcal`)} para ${esc(unBuen)}`;
    else if (b.falta > 120) estadoTxt = `Te quedan ~${kc(b.falta)} kcal para ${femenino ? 'esta' : 'este'} ${esc(nombre)}, sin salirte del déficit`;
    else if (b.falta >= -b.meta * 0.35) estadoTxt = bien(`${femenino ? 'Buena' : 'Buen'} ${esc(nombre)} ✓`);
    else estadoTxt = b.diag.exceso > 0 ? tono(b.diag.kcal) : bien('Comida grande, pero vas bien en el día ✓');
    const principal = ['desayuno', 'almuerzo', 'cena'].includes(momento);
    const faltaProtComida = principal && b.info.metas.proteinaPorComida ? b.info.metas.proteinaPorComida - b.mio.proteina : 0;
    const notaMacro = faltaProtComida > 8 && b.diag.estado !== 'pasado' && ['masa_muscular', 'recomposicion', 'perder_grasa'].includes(b.info.foco)
      ? `Para cuidar el músculo rinde más ~${b.info.metas.proteinaPorComida} g de proteína por comida: a esta le faltan ~${Math.round(faltaProtComida)} g.`
      : b.diag.notas.find((n) => /proteína|carbohidratos/.test(n));
    const despues = fecha !== hoyISO() ? '' : b.restoDia >= 0 ? ` · después te quedan ${kc(b.restoDia)} kcal en el día` : '';
    $('#r-meta').innerHTML = `
      <div class="meta-comida__fila"><span>${MOMENTOS[momento]}${varios ? ' · tu parte' : ''}</span><span><strong>${kc(b.mio.kcal)}</strong> / ~${kc(b.meta)} kcal · P ${Math.round(b.mio.proteina)}/${b.protMeta} g</span></div>
      <div class="meta-comida__barra"><span style="width:${pct}%"></span></div>
      <p class="meta-comida__txt">${estadoTxt}${despues}</p>
      ${notaMacro ? `<p class="meta-comida__base">${esc(notaMacro)}</p>` : ''}
      <p class="meta-comida__base">Antes de esta comida te quedaban <strong>${kc(b.disponible)} kcal</strong>${b.quemado ? ` · ${b.medido ? 'quemaste' : 'entrenos de hoy:'} ~${kc(b.quemado)} kcal${b.medido ? ' según tu reloj' : ''} (ya sumadas)` : ''}</p>`;
  };

  // ---------- Una sola conversación con la IA sobre el plato ----------
  // Lo que escribas arriba va acá: comida nueva, órdenes («quita el arroz», «es para los dos») o preguntas.
  const burbuja = (rol, html) => {
    const b = `<div class="chatia__msg chatia__msg--${rol}">${html}</div>`;
    chatLog.push(b);
    const cont = $('#r-chat');
    if (!cont) return null;
    if ($('#r-vacio')) $('#r-vacio').hidden = true;
    cont.insertAdjacentHTML('beforeend', b);
    bajar(cont.lastElementChild);
    return cont.lastElementChild;
  };
  // Lo que se toma (bebidas, caldos, sopas) cuenta para la hidratación: gramos ≈ ml.
  const aguaDelPlato = () => items.filter((it) => esLiquido(it.alimento)).reduce((a, it) => a + Number(it.gramos || 0), 0);
  // Vitaminas y minerales que vienen bajos en la semana: la IA los tiene en cuenta al sugerir.
  let microsBajos = null;
  import('../micros.js').then((M) => M.bajosParaIA()).then((v) => { microsBajos = v; }).catch(() => {});
  const contextoPlato = () => {
    const b = balance();
    const nombreDe = (id) => (id ? estado.personas.find((p) => p.id === id)?.nombre ?? null : null);
    return {
      quien_escribe: estado.yo.nombre,
      momento,
      plato: items.map((it) => {
        const m = macros(it.alimento, it.gramos);
        return { nombre: it.alimento.nombre, gramos: Math.round(it.gramos), de: nombreDe(it.persona) ?? 'compartido', kcal: Math.round(m.kcal), proteina_g: Math.round(m.proteina), carbos_g: Math.round(m.carbos), grasas_g: Math.round(m.grasas) };
      }),
      comen: quien.map(nombreDe).filter(Boolean),
      reparto,
      ...(b ? {
        objetivo: OBJETIVOS[b.info.foco]?.nombre ?? b.info.foco,
        // El cuerpo de quien escribe: las metas ya salen de acá (masa magra, peso, altura, edad), y la IA lo usa para opinar.
        cuerpo: {
          peso_kg: b.info.med?.peso_kg != null ? Number(b.info.med.peso_kg) : null,
          grasa_pct: b.info.med?.grasa_pct != null ? Number(b.info.med.grasa_pct) : null,
          masa_muscular_kg: b.info.med?.masa_muscular_kg != null ? Number(b.info.med.masa_muscular_kg) : null,
          altura_cm: estado.yo.altura_cm ?? null, sexo: estado.yo.sexo ?? null,
          muy_magro: !!b.info.metas.magro,
          tendencia_peso: b.info.tendencia?.nota ?? null,
        },
        metas_del_dia: { kcal: b.info.metas.kcal, proteina_g: b.info.metas.proteina, carbos_g: b.info.metas.carbos, grasas_g: b.info.metas.grasas },
        proteina_ideal_por_comida_g: b.info.metas.proteinaPorComida,
        meta_de_esta_comida: { kcal: b.meta, proteina_g: b.protMeta, carbos_g: Math.round((b.info.metas.carbos ?? 0) * (PARTE_COMIDA[momento] ?? 0.25)) },
        diagnostico_de_la_app: [b.diag.kcal, ...b.diag.notas.filter((n) => n !== b.diag.kcal)].filter(Boolean),
        regla: 'Lo que respondas tiene que coincidir con diagnostico_de_la_app (es lo que la persona ve en pantalla): si dice que está bien por su objetivo, no lo retes; usa esos mismos números.',
        le_quedaban_kcal_antes_de_esta_comida: Math.round(b.disponible),
        le_quedan_kcal_en_el_dia_despues: Math.round(b.restoDia),
        quemo_entrenando_hoy_kcal: b.quemado,
        entrenos_hoy: (b.info.eventos ?? []).filter((e) => e.tipo !== 'descanso').map((e) => e.tipo),
      } : {}),
      deporte: deporte(estado.equipo?.deporte)?.nombre ?? null,
      dieta: dietaParaIA(),
      ...(microsBajos ? { vitaminas_minerales_bajos_esta_semana: microsBajos } : {}),
      hogar: hogarContexto() ?? [],
      personas_del_hogar: estado.personas.map((p) => p.nombre),
      despensa: (ctx.despensa ?? []).filter((p) => p.alimento?.nombre && Number(p.gramos_restantes) > 0).slice(0, 40)
        .map((p) => ({ nombre: p.alimento.nombre, quedan_g: Math.round(Number(p.gramos_restantes)) })),
    };
  };
  const preguntarPlato = async (mensaje) => {
    const espera = new Promise((_, no) => setTimeout(() => no(new Error('La IA tardó demasiado. Prueba de nuevo.')), 60000));
    const { data, error } = await Promise.race([sb.functions.invoke('plato', { body: { mensaje, contexto: contextoPlato(), historial: historial.slice(-8) } }), espera]);
    if (error) {
      let codigo = null;
      try { codigo = (await error.context?.json?.())?.error; } catch { /* sin detalle */ }
      throw new Error({ limite: 'La IA llegó al límite gratis por ahora. Prueba en un minuto.', gemini: 'La IA está saturada. Prueba en un rato.', sesion: 'Tu sesión se venció: vuelve a entrar.' }[codigo] ?? 'No se pudo conectar con la IA. Revisa la conexión.');
    }
    return data;
  };
  const aplicarCambios = async (r) => {
    const idDe = (n) => personaPorNombre(n)?.id ?? null;
    for (const x of r.quitar ?? []) {
      const it = itemPorNombre(x.nombre, idDe(x.persona));
      if (it) items.splice(items.indexOf(it), 1);
    }
    for (const x of r.ajustar ?? []) {
      const it = itemPorNombre(x.nombre, idDe(x.persona));
      if (it) it.gramos = Number(x.gramos) || it.gramos;
    }
    for (const x of r.agregar ?? []) {
      const persona = x.persona ? idDe(x.persona) : null;
      const paquete = x.despensa ? paquetePorNombre(x.despensa) : null;
      items.push({ alimento: await aAlimento(x), gramos: Number(x.gramos) || 100, paquete, gramosDespensa: paquete && x.gramos_despensa ? Number(x.gramos_despensa) : null, persona });
      if (persona && !quien.includes(persona)) quien = [...quien, persona];
    }
    // «Lo hice con lo de la despensa»: lo que ya estaba en el plato se descuenta de esos productos.
    for (const x of r.de_despensa ?? []) {
      const it = itemPorNombre(x.nombre);
      const paquete = paquetePorNombre(x.despensa);
      if (it && paquete) { it.paquete = paquete; it.gramosDespensa = x.gramos_despensa ? Number(x.gramos_despensa) : null; }
    }
    const nuevos = (r.quien ?? []).map(idDe).filter(Boolean);
    if (nuevos.length) quien = [...new Set(nuevos)];
    if (r.reparto) reparto = r.reparto;
    if (r.asignar?.length) aplicarReparto(r.asignar, { callado: true });
    if (items.some((it) => it.persona) && quien.length > 1 && reparto !== 'cada_uno') reparto = 'distinto';
    if (r.momento && MOMENTOS[r.momento]) { momento = r.momento; pintarMomento(); }
    pintarItems();
  };
  // «Esta docena de huevos es para la despensa»: se muestra lo que va a guardar y se confirma.
  const mostrarParaDespensa = (lista) => {
    setTimeout(() => {
      const chat = $('#r-chat');
      if (!chat) return;
      chat.insertAdjacentHTML('beforeend', `<div class="chatia__msg chatia__msg--propuesta"><div class="medicion-ia">
        <p class="medicion-ia__titulo">Para la despensa (no cuenta como comido)</p>
        <ul class="obj-acciones">${lista.map((x) => `<li>${esc(x.nombre)} · ${x.envases > 1 ? `${x.envases} × ${g(x.gramos_envase)}` : g(x.gramos_envase * x.envases)}</li>`).join('')}</ul>
        <div class="medicion-ia__acciones"><button type="button" class="chatia__seguir" data-a-despensa>Guardar en la despensa</button></div></div></div>`);
      const caja = chat.lastElementChild;
      bajar(caja);
      caja.querySelector('[data-a-despensa]').addEventListener('click', async (e) => {
        const b = e.currentTarget;
        b.disabled = true; b.textContent = 'Guardando…';
        try {
          const filas = [];
          for (const x of lista) {
            const alimento = await aAlimento(x);
            // Paquetes grandes van uno por uno; lo chico (huevos) va junto.
            const separados = x.envases > 1 && x.envases <= 6 && x.gramos_envase >= 150;
            for (let k = 0; k < (separados ? x.envases : 1); k++) filas.push({ alimento, gramos_total: separados ? x.gramos_envase : x.gramos_envase * x.envases });
          }
          await guardarEnDespensa(filas);
          b.parentElement.innerHTML = `<p class="propuesta__hecho">✓ En la despensa</p>`;
          pintarItems();
        } catch (err) { avisoError(err); b.disabled = false; b.textContent = 'Reintentar'; }
      });
    }, 60);
  };

  const hablar = async (texto, { auto = false } = {}) => {
    if (!auto) {
      burbuja('yo', esc(texto));
      historial.push({ rol: 'yo', texto });
    }
    if ($('#r-vacio')) $('#r-vacio').hidden = true;
    chatLog.push('');
    const pensando = $('#r-chat') ? burbujaPensando($('#r-chat'), auto
      ? ['Revisando tu plato…', 'Mirando tu meta del día…', 'Pensando qué sugerirte…']
      : ['Pensando…', 'Mirando tu plato…', 'Revisando tu meta del día…']) : null;
    try {
      const r = await preguntarPlato(texto);
      const aguaAntes = aguaDelPlato();
      await aplicarCambios(r);
      const aguaSumada = aguaDelPlato() - aguaAntes;
      // Sopas, ramen, udon…: si el caldo no quedó en el plato, se ofrece sumarlo (cuenta como agua).
      const sopa = `${texto} ${items.map((it) => it.alimento.nombre).join(' ')}`.match(/\b(ramen|ud[oó]n|pho|sopa|caldo|locro|encebollado|sancocho|consom[eé]|fideos instant[aá]neos)/i);
      if (sopa && !aguaDelPlato() && !sopaOfrecida) {
        sopaOfrecida = true;
        const nombreSopa = /fideos instant/i.test(sopa[1]) ? 'ramen' : sopa[1].toLowerCase();
        r.sugerencias = [...(r.sugerencias ?? []), { nombre: /^(sopa|caldo)$/i.test(nombreSopa) ? `Caldo de ${nombreSopa === 'sopa' ? 'sopa' : 'carne'}` : `Caldo de ${nombreSopa}`, gramos: 400, cantidad: '💧 400 ml de', kcal: 15, proteina_g: 1, carbohidratos_g: 1, grasas_g: 0.5 }];
      }
      if (r.a_despensa?.length) mostrarParaDespensa(r.a_despensa);
      if (aguaSumada >= 50) r.respuesta = `${r.respuesta ?? ''} 💧 Suma ~${Math.round(aguaSumada / 10) * 10} ml a tu agua del día.`.trim();
      historial.push({ rol: 'ia', texto: [r.respuesta, r.duda].filter(Boolean).join(' ') });
      const html = `<span>${esc(r.respuesta || 'Listo.')}</span>
        ${r.sugerencias?.length ? `<div class="chips">${r.sugerencias.map((x, k) =>
          `<button type="button" class="chip chip--mini chip--sugerencia" data-sug="${k}">+ ${esc(x.cantidad || `${Math.round(x.gramos)} g`)} ${esc(x.nombre.toLowerCase())} · ${kc(x.kcal * x.gramos / 100)} kcal</button>`).join('')}</div>` : ''}
        ${htmlReparto(r.reparto_sugerido)}
        ${r.duda ? `<p class="ia-msg__duda">${esc(r.duda)}</p>` : ''}
        ${r.opciones?.length ? `<div class="chips ia-msg__opciones">${r.opciones.map((o, k) => `<button type="button" class="chip chip--mini" data-opcion="${k}">${esc(o)}</button>`).join('')}</div>` : ''}`;
      chatLog.pop();
      chatLog.push(`<div class="chatia__msg chatia__msg--ia">${esc([r.respuesta || 'Listo.', r.duda].filter(Boolean).join(' '))}</div>`); // al volver del paso 2, sin botones
      if (pensando) {
        pensando.terminar(html);
        // Si la IA tiene una duda, se responde tocando una opción (o escribiendo arriba).
        pensando.querySelectorAll('[data-opcion]').forEach((btn) => btn.addEventListener('click', () => {
          pensando.querySelector('.ia-msg__opciones')?.remove();
          hablar(r.opciones[Number(btn.dataset.opcion)]);
        }));
        pensando.querySelector('#r-aplicar-reparto')?.addEventListener('click', (e) => { aplicarReparto(r.reparto_sugerido); e.currentTarget.closest('.reparto-ia').remove(); });
        pensando.querySelectorAll('[data-sug]').forEach((btn) => btn.addEventListener('click', async () => {
          btn.disabled = true;
          const x = r.sugerencias[Number(btn.dataset.sug)];
          agregar(await aAlimento(x), x.gramos, null, reparto === 'distinto' ? estado.yo.id : null);
          btn.remove();
        }));
        bajar(pensando);
      }
    } catch (err) {
      chatLog.pop();
      if (pensando) pensando.terminar(`<span class="quieto">${esc(err.message)}</span>`);
    }
  };

  // Lo que le queda del día a cada persona del hogar: para que la IA pueda proponer cómo repartir el plato.
  const hogarContexto = () => {
    if (estado.personas.length < 2) return undefined;
    return (ctx.info ?? []).filter((x) => x.metas?.ok).map((x) => {
      const parte = PARTE_COMIDA[momento] ?? 0.25;
      const antes = op.comida?.porciones?.find((y) => y.persona_id === x.p.id);
      return {
        nombre: x.p.nombre, es_quien_pregunta: x.p.id === estado.yo.id, come_de_este_plato: quien.includes(x.p.id),
        objetivo: OBJETIVOS[x.foco]?.nombre ?? x.foco,
        peso_kg: x.med?.peso_kg != null ? Number(x.med.peso_kg) : null,
        grasa_pct: x.med?.grasa_pct != null ? Number(x.med.grasa_pct) : null,
        meta_de_esta_comida: { kcal: Math.round(x.metas.kcal * parte), proteina_g: Math.round(x.metas.proteina * parte), carbos_g: Math.round((x.metas.carbos ?? 0) * parte) },
        le_quedan_en_el_dia_sin_este_plato: {
          kcal: Math.round(x.metas.kcal - x.comido.kcal + Number(antes?.kcal ?? 0)),
          proteina_g: Math.round(x.metas.proteina - x.comido.proteina),
          carbos_g: Math.round((x.metas.carbos ?? 0) - (x.comido.carbos ?? 0)),
        },
      };
    });
  };
  const personaPorNombre = (n) => {
    const t = String(n ?? '').trim().toLowerCase();
    if (!t) return null;
    if (['yo', 'mi', 'mí'].includes(t)) return estado.yo;
    return estado.personas.find((p) => p.nombre.toLowerCase() === t)
      ?? estado.personas.find((p) => p.nombre.toLowerCase().startsWith(t) || t.startsWith(p.nombre.toLowerCase())) ?? null;
  };
  const itemPorNombre = (n, persona = null) => {
    const t = String(n ?? '').trim().toLowerCase();
    const candidatos = persona ? items.filter((it) => it.persona === persona) : items;
    const buscar = (lista) => lista.find((it) => it.alimento.nombre.toLowerCase() === t)
      ?? lista.find((it) => it.alimento.nombre.toLowerCase().includes(t) || t.includes(it.alimento.nombre.toLowerCase())) ?? null;
    return buscar(candidatos) ?? (persona ? buscar(items) : null);
  };
  // Reparto sugerido por la IA, agrupado por alimento: «Arroz: Yo 150 g · Vic 250 g».
  const htmlReparto = (reparto) => {
    const validos = (reparto ?? []).filter((x) => itemPorNombre(x.alimento) && personaPorNombre(x.persona));
    if (!validos.length) return '';
    const porAlimento = new Map();
    for (const x of validos) {
      const it = itemPorNombre(x.alimento);
      if (!porAlimento.has(it)) porAlimento.set(it, []);
      porAlimento.get(it).push(x);
    }
    return `
      <div class="reparto-ia">
        <p class="reparto-ia__titulo">Reparto sugerido</p>
        ${[...porAlimento].map(([it, xs]) => `<p class="reparto-ia__fila"><strong>${esc(nombreCorto(it.alimento))}</strong> ${xs.map((x) => {
          const p = personaPorNombre(x.persona);
          return `<span class="reparto-ia__persona"><span class="persona-op__cara persona-op__cara--mini">${cara(p)}</span>${esc(p.id === estado.yo.id ? 'Yo' : p.nombre)} ${g(x.gramos)}</span>`;
        }).join('')}</p>`).join('')}
        <button type="button" class="boton boton--ia boton--chico" id="r-aplicar-reparto">${ICONO.chispa} Aplicar reparto</button>
      </div>`;
  };
  const aplicarReparto = (sugerido, { callado = false } = {}) => {
    const validos = (sugerido ?? []).filter((x) => itemPorNombre(x.alimento) && personaPorNombre(x.persona) && Number(x.gramos) >= 0);
    const tocados = new Set();
    for (const x of validos) tocados.add(itemPorNombre(x.alimento));
    for (const it of tocados) {
      const xs = validos.filter((x) => itemPorNombre(x.alimento) === it);
      const pos = items.indexOf(it);
      const nuevos = xs.filter((x) => Number(x.gramos) > 0).map((x, k) => ({ ...it, gramos: Math.round(Number(x.gramos)), persona: personaPorNombre(x.persona).id, paquete: k === 0 ? it.paquete : null }));
      items.splice(pos, 1, ...nuevos);
      for (const x of xs) { const id = personaPorNombre(x.persona).id; if (!quien.includes(id)) quien = [...quien, id]; }
    }
    reparto = 'distinto';
    pintarItems();
    if (!callado) aviso('Reparto aplicado: revísalo en el paso 2.');
  };

  // ---------- La IA: texto, foto o ambas ----------
  let conectado = null;
  const mostrarFoto = (archivo) => {
    const caja = $('#r-foto');
    if (!caja) return;
    caja.hidden = false;
    caja.querySelector('img').src = URL.createObjectURL(archivo);
    $('#r-texto').placeholder = 'Algo que no se ve, o pregunta…';
    conectado?.actualizar();
  };
  const quitarFoto = () => {
    fotoPendiente = null;
    $('#r-foto').hidden = true;
    $('#r-texto').placeholder = items.length ? 'Agrega, corrige o pregunta…' : '¿Qué comiste?';
    mensaje(null);
    conectado?.actualizar();
  };
  const leer = async () => {
    const texto = $('#r-texto').value.trim();
    if (!fotoPendiente && !texto) return $('#r-texto').focus();
    const boton = $('#r-leer');
    boton.disabled = true;
    conectado?.limpiar();
    try {
      if (fotoPendiente) {
        // Con foto: primero se lee el plato. Lo que escribiste va como aclaración del plato, salvo que sea una pregunta.
        const pregunta = esPregunta(texto) ? texto : '';
        mensaje(null);
        const foto = fotoPendiente;
        if ($('#r-vacio')) $('#r-vacio').hidden = true;
        // Tu foto queda en la conversación, como en una app de mensajes.
        burbuja('yo', `<img class="chatia__foto" src="${URL.createObjectURL(foto)}" alt="Foto del plato">${texto ? `<span>${esc(texto)}</span>` : ''}`);
        quitarFoto();
        const viendo = burbujaPensando($('#r-chat'), texto && !pregunta
          ? ['Mirando la foto…', 'Sumando lo que le agregaste…', 'Calculando porciones…']
          : ['Mirando la foto…', 'Reconociendo los alimentos…', 'Calculando porciones…']);
        let r;
        try { r = await gemini('foto', { imagen: await fotoBase64(foto), tipo: 'image/jpeg', texto: (pregunta ? '' : texto) || undefined }); }
        catch (err) { viendo.terminar(`<span class="quieto">${esc(err.message)} Mientras tanto, agrégalo a mano.</span>`); return; }
        if (!r.alimentos?.length) { viendo.terminar('<span>No reconocí comida en la foto. Prueba más cerca o escríbelo.</span>'); return; }
        for (const x of r.alimentos) agregar(await aAlimento(x), x.gramos);
        // Lo que vio en la foto queda en la conversación: así después puedes decir «la foto era para los dos».
        const visto = `En la foto veo: ${r.alimentos.map((x) => `${x.nombre.toLowerCase()} (${Math.round(x.gramos)} g)`).join(', ')}.`;
        viendo.terminar(`<span>${esc(visto)}</span>`);
        chatLog.push(`<div class="chatia__msg chatia__msg--ia">${esc(visto)}</div>`);
        historial.push({ rol: 'yo', texto: texto && !pregunta ? `Te mando una foto del plato. ${texto}` : 'Te mando una foto del plato.' }, { rol: 'ia', texto: visto });
        // Y la IA revisa el plato sola (proteína, carbohidratos y verduras), o responde lo que preguntaste.
        await hablar(pregunta || REVISION, { auto: !pregunta });
      } else {
        await hablar(texto);
      }
    } catch (err) {
      mensaje(`${err.message} Mientras tanto, agrégalo a mano.`);
    } finally {
      boton.disabled = false;
    }
  };

  const conectarPaso1 = () => {
    conectado = conectarCompositor(d, { texto: '#r-texto', enviar: '#r-leer', alEnviar: leer, hayAdjunto: () => !!fotoPendiente });
    d.querySelectorAll('[data-sugerencia]').forEach((b) => b.addEventListener('click', () => {
      const k = Number(b.dataset.sugerencia);
      if (k === 0) return $('#r-camara').click();
      hablar(['', '2 huevos revueltos, pan y café con leche', '¿Qué me conviene comer ahora?'][k]);
    }));
    for (const id of ['#r-camara', '#r-galeria']) {
      $(id).addEventListener('change', (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        fotoPendiente = f;
        mostrarFoto(f);
        mensaje('Si le pusiste algo que no se ve, escríbelo. Después toca enviar.');
      });
    }
    $('#r-foto-quitar').addEventListener('click', quitarFoto);
    let buscadorListo = false;
    $('#r-buscar-abrir').addEventListener('click', () => {
      const cont = $('#r-buscar');
      cont.hidden = !cont.hidden;
      if (!buscadorListo) {
        buscadorListo = true;
        panelBuscar(cont, {
          despensa: ctx.despensa,
          alElegir: (alimento, paquete) => {
            agregar(alimento, paquete ? Math.min(Number(paquete.gramos_restantes), Number(alimento.porcion_g ?? 100)) : Number(alimento.porcion_g ?? 100), paquete);
            cont.hidden = true;
          },
        });
      }
      if (!cont.hidden) cont.querySelector('#ba-q')?.focus();
    });
    d.querySelectorAll('[data-frec]').forEach((b) => b.addEventListener('click', () => { const f = lista[Number(b.dataset.frec)]; agregar(f.alimento, f.gramos); }));
    $('#r-borrar')?.addEventListener('click', async () => {
      try { await borrarComida(op.comida); d.close(); aviso('Comida eliminada.'); ctx.recargar(); } catch (err) { avisoError(err); }
    });
    $('#r-seguir').addEventListener('click', () => (varios ? pintarPaso2() : guardar()));
  };

  // ---------- Paso 2: quién comió ----------
  // Lo que come cada persona elegida: lo suyo + su parte de lo compartido (o un plato entero cada uno).
  const fracciones = () => quien.map((id) => [id, reparto === 'cada_uno' ? 1 : 1 / quien.length]);
  const porPersona = () => {
    const compartido = sumar(items.filter((it) => !it.persona).map((it) => macros(it.alimento, it.gramos)));
    return fracciones().map(([id, f]) => {
      const propio = sumar(items.filter((it) => it.persona === id).map((it) => macros(it.alimento, it.gramos)));
      return [id, { kcal: propio.kcal + compartido.kcal * f, proteina: propio.proteina + compartido.proteina * f, carbos: propio.carbos + compartido.carbos * f, grasas: propio.grasas + compartido.grasas * f }];
    });
  };

  const pintarPaso2 = () => {
    paso = 2;
    pintarMomento();
    $('#r-momento-btn').hidden = true;
    $('#r-momento').hidden = true;
    $('#r-izq').innerHTML = ICONOS.atras;
    $('#r-izq').setAttribute('aria-label', 'Volver');
    $('#r-accion').innerHTML = `<button type="button" class="chatia__seguir" id="r-guardar">${editar ? 'Guardar' : 'Guardar'}</button>`;
    const variosElegidos = quien.length > 1;
    $('#r-cuerpo').innerHTML = `
      <h3 class="reg__pregunta">¿Quién comió?</h3>
      <div class="personas-elegir">
        ${estado.personas.map((p) => `
          <button type="button" class="persona-op" data-persona="${esc(p.id)}" aria-pressed="${quien.includes(p.id)}">
            <span class="persona-op__cara">${cara(p)}</span>
            <span>${esc(p.id === estado.yo.id ? 'Yo' : p.nombre)}</span>
            <span class="persona-op__check" aria-hidden="true">✓</span>
          </button>`).join('')}
      </div>
      ${variosElegidos ? `
        <h3 class="reg__pregunta">¿Cómo lo comieron?</h3>
        <div class="opciones">
          ${opcion('cada_uno', 'Un plato cada uno', 'Cada uno comió todo lo de la lista (ej. la foto es de un plato y había uno igual para cada uno).')}
          ${opcion('compartido', 'Lo compartieron', 'Se reparte en partes iguales entre los que comieron.')}
          ${opcion('distinto', 'Cada uno comió distinto', 'Elige de quién es cada cosa; lo que no tenga dueño se reparte.')}
        </div>
        ${reparto === 'distinto' ? `<div class="pila" style="gap:8px">${items.map((it, i) => `
          <div class="item-dueno">
            <span><strong>${esc(it.alimento.nombre)}</strong><span class="quieto"> · ${esc(cantidadTexto(it.alimento, it.gramos))}</span></span>
            <div class="chips">${[null, ...quien].map((id) => {
              const p = estado.personas.find((x) => x.id === id);
              return `<button type="button" class="chip chip--mini" data-dueno="${i}" data-id="${id ?? ''}" aria-pressed="${(it.persona ?? null) === id}">${id ? esc(p.id === estado.yo.id ? 'Yo' : p.nombre) : 'Compartido'}</button>`;
            }).join('')}</div>
          </div>`).join('')}</div>` : ''}` : ''}
      <div class="reparto-total">${porPersona().map(([id, m]) => {
        const p = estado.personas.find((x) => x.id === id);
        return `<span><span class="persona-op__cara persona-op__cara--mini">${cara(p)}</span><strong>${esc(id === estado.yo.id ? 'Yo' : p.nombre)}</strong> ${kc(m.kcal)} kcal · P ${Math.round(m.proteina)}</span>`;
      }).join('')}</div>`;
    $('#r-pie').innerHTML = '';
    $('#r-pie').hidden = true;
    d.querySelectorAll('[data-persona]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.persona;
      quien = quien.includes(id) ? quien.filter((x) => x !== id) : [...quien, id];
      if (!quien.length) quien = [id];
      pintarPaso2();
    }));
    d.querySelectorAll('[data-reparto]').forEach((b) => b.addEventListener('click', () => { reparto = b.dataset.reparto; pintarPaso2(); }));
    d.querySelectorAll('[data-dueno]').forEach((b) => b.addEventListener('click', () => { items[Number(b.dataset.dueno)].persona = b.dataset.id || null; pintarPaso2(); }));
    $('#r-guardar').addEventListener('click', guardar);
  };
  const opcion = (v, titulo, texto) => `
    <button type="button" class="opcion opcion--chica" data-reparto="${v}" aria-pressed="${reparto === v}">
      <span class="opcion__texto"><strong>${titulo}</strong><span>${texto}</span></span>
    </button>`;

  const guardar = async () => {
    if (!items.length) return;
    const boton = $('#r-guardar') ?? $('#r-seguir');
    boton.disabled = true;
    guardarQuien(momento, quien);
    const ahora = new Date();
    // Cómo quedan los renglones: uno solo come todo; «cada uno» = un renglón por persona con el plato entero.
    let lista = items.map((it) => ({ ...it }));
    if (quien.length === 1) lista = lista.map((it) => ({ ...it, persona: null }));
    else if (reparto === 'cada_uno') lista = quien.flatMap((id, k) => items.filter((it) => !it.persona).map((it) => ({ ...it, persona: id, paquete: k === 0 ? it.paquete : null })));
    else lista = lista.map((it) => (it.persona && !quien.includes(it.persona) ? { ...it, persona: null } : it));
    try {
      const { total } = await guardarComida({
        anterior: editar ? op.comida : null,
        fecha,
        hora: editar ? op.comida.hora : (fecha === hoyISO() ? `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}` : null),
        momento,
        descripcion: editar ? op.comida.descripcion : null,
        items: lista,
        fracciones: quien.map((id) => [id, quien.length === 1 ? 1 : 1 / quien.length]),
      });
      d.close();
      aviso(editar ? 'Comida actualizada.' : `Registrado: ${kc(total.kcal)} kcal.`);
      ctx.recargar(fecha);
    } catch (err) {
      avisoError(err);
      boton.disabled = false;
    }
  };

  // Atajo: descontar de la despensa lo que se usó (la IA ve qué producto es cada cosa y cuánto se gastó en crudo).
  d.addEventListener('click', (e) => {
    const b = e.target.closest('#r-de-despensa');
    if (!b) return;
    b.hidden = true;
    hablar('Lo cociné con lo de la despensa: descuenta lo que usé.');
  });

  pintarPaso1();
  // La primera vez: Bloq pregunta cómo comes (no asume que comes carne) y lo guarda.
  if (!tieneDieta() && !editar) {
    const b = burbuja('ia', `<span>Antes de empezar: ¿sigues alguna dieta o tienes restricciones? Así te sugiero solo lo que comes.</span>
      <div class="chips ia-msg__opciones">${['omnivora', 'vegetariana', 'vegana', 'pescetariana', 'keto'].map((k) => `<button type="button" class="chip chip--mini" data-dieta="${k}">${TIPOS[k]}</button>`).join('')}<button type="button" class="chip chip--mini" data-dieta="otra">Otra / restricciones…</button></div>`);
    b?.querySelectorAll('[data-dieta]').forEach((x) => x.addEventListener('click', async () => {
      if (x.dataset.dieta === 'otra') return dialogoDieta(() => { b.querySelector('.ia-msg__opciones')?.remove(); burbuja('ia', '<span>¡Listo, anotado! Ahora sí: ¿qué comiste?</span>'); });
      try { await guardarDieta({ tipo: x.dataset.dieta, restricciones: [] }); } catch { return; }
      b.querySelector('.ia-msg__opciones')?.remove();
      burbuja('yo', esc(TIPOS[x.dataset.dieta]));
      burbuja('ia', '<span>¡Anotado! Lo tengo en cuenta en todo. Ahora sí: ¿qué comiste?</span>');
    }));
  }
  if (op.foto) { fotoPendiente = op.foto; mostrarFoto(op.foto); mensaje('Si le pusiste algo que no se ve, escríbelo. Después toca enviar.'); }
  else if (op.texto) leer();
  return d;
}
