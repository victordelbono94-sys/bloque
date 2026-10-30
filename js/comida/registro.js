// Agregar o editar una comida, en una pantalla con dos pasos:
//   1. Qué comiste: la IA al centro (foto, texto o ambos) o a mano (buscar, escanear, habituales).
//      Debajo, la lista para revisar y si alcanza para esa comida (desayuno, almuerzo…) con sugerencias.
//   2. Quién comió (solo si en el hogar hay más personas): uno, varios, y si fue un plato cada uno o compartido.
import { sb, estado } from '../db.js';
import { esc, aviso, avisoError, abrirDialogo, cara } from '../ui.js';
import { hoyISO } from '../fechas.js';
import { macros, sumar } from '../alimentos.js';
import { OBJETIVOS } from '../nutricion.js';
import { panelBuscar } from './buscar.js';
import { esLiquido } from '../hidratacion.js';
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
    <div class="reg">
      <header class="reg__cab">
        <button type="button" class="reg__cerrar" data-cerrar aria-label="Cerrar">${ICONO.x}</button>
        <div class="reg__titulo">
          <h2>${editar ? 'Editar comida' : 'Agregar comida'}</h2>
          <span id="r-paso">${varios ? 'Paso 1 de 2' : ''}</span>
        </div>
        <button type="button" class="momento-pill" id="r-momento-btn" aria-expanded="false" aria-label="Cambiar el momento"></button>
      </header>
      <div class="chips chips--scroll reg__momentos" id="r-momento" aria-label="Momento" hidden>
        ${Object.entries(MOMENTOS).map(([v, t]) => `<button type="button" class="chip chip--mini" data-valor="${v}">${t}</button>`).join('')}
      </div>
      <div class="reg__cuerpo" id="r-cuerpo"></div>
      <footer class="reg__pie" id="r-pie"></footer>
    </div>`, editar ? 'Editar comida' : 'Agregar comida', { pantalla: true });
  const $ = (q) => d.querySelector(q);
  // Atrás, tocar afuera o deslizar no borran lo anotado sin preguntar.
  d.proteger = () => paso === 2 || !!fotoPendiente || !!$('#r-texto')?.value.trim() || (!editar && items.length > 0);
  const pintarMomento = () => {
    $('#r-momento-btn').textContent = `${MOMENTOS[momento]} ▾`;
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
    $('#r-paso').textContent = varios ? 'Paso 1 de 2' : '';
    $('#r-momento-btn').hidden = false;
    // Arriba (lo que se desplaza): tu plato con su desglose y la conversación con la IA.
    // Abajo, fijo como en una app de mensajes: el total + «Seguir», y el cuadro para escribirle a la IA o mandar una foto.
    $('#r-cuerpo').innerHTML = `
      <div class="frecuentes reg__rapidos" id="r-rapidos" aria-label="Agregar rápido">
        <button type="button" class="chip chip--mini chip--buscar" id="r-buscar-abrir">${ICONO.buscar} Buscar</button>
        ${lista.map((f, i) => `<button type="button" class="chip chip--mini" data-frec="${i}">+ ${esc(nombreCorto(f.alimento))}</button>`).join('')}
      </div>
      <div id="r-buscar" hidden></div>
      <p class="reg__vacio" id="r-vacio">Escríbele abajo qué comiste o mándale una foto: la IA arma el plato y te dice cómo vas.</p>
      <div id="r-items" class="pila" style="gap:8px"></div>
      <div class="consejo" id="r-consejo" hidden>
        <div class="consejo__meta" id="r-meta"></div>
      </div>
      ${editar ? '<button type="button" class="boton boton--texto boton--chico reg__borrar" id="r-borrar">Eliminar esta comida</button>' : ''}
      <div class="ia-chat" id="r-chat" aria-live="polite">${chatLog.join('')}</div>`;
    $('#r-pie').innerHTML = `
      <div class="reg__resumen" id="r-resumen" hidden>
        <span class="comida-total" id="r-total"></span>
        <button type="button" class="boton boton--chico reg__seguir" id="r-seguir" disabled>${varios ? 'Seguir ›' : (editar ? 'Guardar cambios' : 'Guardar')}</button>
      </div>
      <section class="reg__compositor" id="r-ia">
        <div class="ia-foto ia-foto--mini" id="r-foto" hidden>
          <img alt="Foto del plato">
          <button type="button" class="ia-foto__quitar" id="r-foto-quitar" aria-label="Quitar la foto">${ICONO.x}</button>
        </div>
        <p class="ia-estado" id="r-estado" hidden></p>
        <div class="reg__fila-escribir">
          <label class="ia-icono" aria-label="Sacar foto">${ICONO.camara}<input type="file" id="r-camara" accept="image/*" capture="environment" hidden></label>
          <label class="ia-icono" aria-label="Elegir de la galería">${ICONO.galeria}<input type="file" id="r-galeria" accept="image/*" hidden></label>
          <textarea id="r-texto" rows="1" maxlength="600" placeholder="¿Qué comiste?">${esc(op.texto ?? '')}</textarea>
          <button type="button" class="reg__enviar" id="r-leer" aria-label="Enviar a la IA">${ICONO.chispa}</button>
        </div>
      </section>`;
    conectarPaso1();
    pintarItems();
    if (fotoPendiente) mostrarFoto(fotoPendiente);
  };

  const mensaje = (t, cargando = false) => {
    const el = $('#r-estado');
    if (!el) return;
    el.hidden = !t; el.textContent = t ?? '';
    $('#r-ia')?.classList.toggle('ia-caja--pensando', cargando);
  };

  const agregar = (alimento, gramos, paquete = null, persona = null) => { items.push({ alimento, gramos: Number(gramos) || 100, paquete, persona }); pintarItems(); };
  const paqueteDe = (alimento) => ctx.despensa.find((p) => p.alimento_id === alimento.id && Number(p.gramos_restantes) > 0);

  const pintarItems = () => {
    const cont = $('#r-items');
    if (!cont) return;
    cont.innerHTML = items.length ? items.map((it, i) => {
      const m = macros(it.alimento, it.gramos);
      const paquete = it.paquete, enDespensa = !paquete && paqueteDe(it.alimento);
      const dueno = it.persona ? estado.personas.find((p) => p.id === it.persona) : null;
      return `
        <div class="item-comida">
          <div class="item-comida__texto">
            <span class="item-comida__titulo"><strong>${esc(it.alimento.nombre)}</strong>${dueno ? `<span class="dueno dueno--${dueno.id === estado.yo.id ? 'yo' : 'otro'}">${esc(dueno.id === estado.yo.id ? 'Yo' : dueno.nombre)}</span>` : ''}</span>
            <span class="quieto">${esc(cantidadTexto(it.alimento, it.gramos))}${cantidadTexto(it.alimento, it.gramos).endsWith(' g') ? '' : ` · ${g(it.gramos)}`} · ${kc(m.kcal)} kcal · P ${Math.round(m.proteina)}</span>
            ${paquete ? `<button type="button" class="chip chip--mini chip--activo" data-despensa="${i}">De la despensa ✓</button>`
              : enDespensa ? `<button type="button" class="chip chip--mini" data-despensa="${i}">Descontar de la despensa</button>` : ''}
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
    $('#r-total').innerHTML = items.length ? `<strong>${kc(total.kcal)} kcal</strong> · P ${Math.round(total.proteina)} · C ${Math.round(total.carbos)} · G ${Math.round(total.grasas)}` : '';
    $('#r-seguir').disabled = !items.length;
    $('#r-resumen').hidden = !items.length;
    if ($('#r-vacio')) $('#r-vacio').hidden = !!items.length || chatLog.length > 0;
    if ($('#r-rapidos')) $('#r-rapidos').hidden = items.length > 2;
    if ($('#r-texto') && !fotoPendiente) $('#r-texto').placeholder = items.length ? 'Agrega, corrige o pregunta…' : '¿Qué comiste?';
    pintarMeta();

    const pasoDe = (it) => (Number(it.alimento.porcion_g) > 0 && Number(it.alimento.porcion_g) <= 250 ? Number(it.alimento.porcion_g) : 10);
    cont.querySelectorAll('[data-gramos]').forEach((inp) => inp.addEventListener('change', () => { const v = Number(inp.value); items[Number(inp.dataset.gramos)].gramos = v > 0 ? v : 1; pintarItems(); }));
    cont.querySelectorAll('[data-mas]').forEach((b) => b.addEventListener('click', () => { const it = items[Number(b.dataset.mas)]; it.gramos += pasoDe(it); pintarItems(); }));
    cont.querySelectorAll('[data-menos]').forEach((b) => b.addEventListener('click', () => { const it = items[Number(b.dataset.menos)]; it.gramos = Math.max(1, it.gramos - pasoDe(it)); pintarItems(); }));
    cont.querySelectorAll('[data-quitar]').forEach((b) => b.addEventListener('click', () => { items.splice(Number(b.dataset.quitar), 1); pintarItems(); }));
    cont.querySelectorAll('[data-despensa]').forEach((b) => b.addEventListener('click', () => { const it = items[Number(b.dataset.despensa)]; it.paquete = it.paquete ? null : paqueteDe(it.alimento); pintarItems(); }));
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
    const protMeta = Math.round(Math.min(k >= 0 ? protDisp * (parte / resto) : protDisp, info.metas.proteina * parte * 1.75));
    const restoDia = disponible - mio.kcal;
    const quemado = Math.round(info.metas.medido || info.metas.ejercicio || 0);
    return { info, mio, meta, protMeta, falta: meta - mio.kcal, restoDia, disponible, quemado, medido: !!info.metas.medido };
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
    // El veredicto depende del objetivo y del DÍA, no solo de esta comida: pasarse un poco es bueno para ganar masa,
    // neutro para mantener y algo a cuidar para bajar de peso. Solo «reta» cuando de verdad importa.
    const ganar = b.info.foco === 'masa_muscular' || b.info.metas.magro;
    const bajar = b.info.foco === 'perder_grasa';
    const exceso = -b.restoDia;                      // > 0: con esta comida te pasas del día
    const tope = b.info.metas.kcal;
    const bien = (t) => `<strong class="hecho">${t}</strong>`;
    const ojo = (t) => `<strong class="consejo__falta">${t}</strong>`;
    let estadoTxt;
    if (b.falta > 120 && !bajar) estadoTxt = `${ojo(`Te faltan ~${kc(b.falta)} kcal`)} para ${esc(unBuen)}`;
    else if (b.falta > 120) estadoTxt = `Te quedan ~${kc(b.falta)} kcal para ${femenino ? 'esta' : 'este'} ${esc(nombre)}, sin salirte del déficit`;
    else if (b.falta >= -b.meta * 0.35) estadoTxt = bien(`${femenino ? 'Buena' : 'Buen'} ${esc(nombre)} ✓`);
    else if (exceso <= 0) estadoTxt = `${bien('Comida grande, pero vas bien en el día ✓')}`;
    else if (ganar) estadoTxt = exceso <= tope * 0.15
      ? bien(`Te pasas ~${kc(exceso)} kcal del día: para ganar masa está bien ✓`)
      : `${ojo(`Te pasas ~${kc(exceso)} kcal del día`)}: es mucho incluso para ganar masa`;
    else if (bajar) estadoTxt = `${ojo(`Te pasas ~${kc(exceso)} kcal del día`)}: para bajar de peso conviene achicar una porción`;
    else estadoTxt = exceso <= tope * 0.05
      ? bien('Casi justo en el día ✓')
      : `${ojo(`Te pasas ~${kc(exceso)} kcal del día`)}: si puedes, achica una porción`;
    const despues = fecha !== hoyISO() ? '' : b.restoDia >= 0 ? ` · después te quedan ${kc(b.restoDia)} kcal en el día` : '';
    $('#r-meta').innerHTML = `
      <div class="meta-comida__fila"><span>${MOMENTOS[momento]}${varios ? ' · tu parte' : ''}</span><span><strong>${kc(b.mio.kcal)}</strong> / ~${kc(b.meta)} kcal · P ${Math.round(b.mio.proteina)}/${b.protMeta} g</span></div>
      <div class="meta-comida__barra"><span style="width:${pct}%"></span></div>
      <p class="meta-comida__txt">${estadoTxt}${despues}</p>
      <p class="meta-comida__base">Antes de esta comida te quedaban <strong>${kc(b.disponible)} kcal</strong>${b.quemado ? ` · ${b.medido ? 'quemaste' : 'entrenos de hoy:'} ~${kc(b.quemado)} kcal${b.medido ? ' según tu reloj' : ''} (ya sumadas)` : ''}</p>`;
  };

  // ---------- Una sola conversación con la IA sobre el plato ----------
  // Lo que escribas arriba va acá: comida nueva, órdenes («quita el arroz», «es para los dos») o preguntas.
  const burbuja = (rol, html) => {
    const b = `<div class="ia-msg ia-msg--${rol}">${html}</div>`;
    chatLog.push(b);
    const cont = $('#r-chat');
    if (!cont) return null;
    cont.insertAdjacentHTML('beforeend', b);
    return cont.lastElementChild;
  };
  // Lo que se toma (bebidas, caldos, sopas) cuenta para la hidratación: gramos ≈ ml.
  const aguaDelPlato = () => items.filter((it) => esLiquido(it.alimento)).reduce((a, it) => a + Number(it.gramos || 0), 0);
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
        meta_de_esta_comida: { kcal: b.meta, proteina_g: b.protMeta, carbos_g: Math.round((b.info.metas.carbos ?? 0) * (PARTE_COMIDA[momento] ?? 0.25)) },
        le_quedaban_kcal_antes_de_esta_comida: Math.round(b.disponible),
        le_quedan_kcal_en_el_dia_despues: Math.round(b.restoDia),
        quemo_entrenando_hoy_kcal: b.quemado,
        entrenos_hoy: (b.info.eventos ?? []).filter((e) => e.tipo !== 'descanso').map((e) => e.tipo),
      } : {}),
      hogar: hogarContexto() ?? [],
      personas_del_hogar: estado.personas.map((p) => p.nombre),
      despensa: (ctx.despensa ?? []).slice(0, 30).map((p) => p.alimento?.nombre).filter(Boolean),
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
      items.push({ alimento: await aAlimento(x), gramos: Number(x.gramos) || 100, paquete: null, persona });
      if (persona && !quien.includes(persona)) quien = [...quien, persona];
    }
    const nuevos = (r.quien ?? []).map(idDe).filter(Boolean);
    if (nuevos.length) quien = [...new Set(nuevos)];
    if (r.reparto) reparto = r.reparto;
    if (r.asignar?.length) aplicarReparto(r.asignar, { callado: true });
    if (items.some((it) => it.persona) && quien.length > 1 && reparto !== 'cada_uno') reparto = 'distinto';
    if (r.momento && MOMENTOS[r.momento]) { momento = r.momento; pintarMomento(); }
    pintarItems();
  };
  const hablar = async (texto, { auto = false } = {}) => {
    if (!auto) {
      burbuja('yo', esc(texto));
      historial.push({ rol: 'yo', texto });
    }
    const pensando = burbuja('ia', '<span class="ia-puntos"><i></i><i></i><i></i></span>');
    pensando?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
      if (aguaSumada >= 50) r.respuesta = `${r.respuesta ?? ''} 💧 Suma ~${Math.round(aguaSumada / 10) * 10} ml a tu agua del día.`.trim();
      historial.push({ rol: 'ia', texto: [r.respuesta, r.duda].filter(Boolean).join(' ') });
      const html = `<span class="ia-logo ia-logo--mini" aria-hidden="true">${ICONO.chispa}</span><span>${esc(r.respuesta || 'Listo.')}</span>
        ${r.sugerencias?.length ? `<div class="chips">${r.sugerencias.map((x, k) =>
          `<button type="button" class="chip chip--mini chip--sugerencia" data-sug="${k}">+ ${esc(x.cantidad || `${Math.round(x.gramos)} g`)} ${esc(x.nombre.toLowerCase())} · ${kc(x.kcal * x.gramos / 100)} kcal</button>`).join('')}</div>` : ''}
        ${htmlReparto(r.reparto_sugerido)}
        ${r.duda ? `<p class="ia-msg__duda">${esc(r.duda)}</p>` : ''}
        ${r.opciones?.length ? `<div class="chips ia-msg__opciones">${r.opciones.map((o, k) => `<button type="button" class="chip chip--mini" data-opcion="${k}">${esc(o)}</button>`).join('')}</div>` : ''}`;
      chatLog.pop();
      chatLog.push(`<div class="ia-msg ia-msg--ia">${esc([r.respuesta || 'Listo.', r.duda].filter(Boolean).join(' '))}</div>`); // al volver del paso 2, sin botones
      if (pensando) {
        pensando.innerHTML = html;
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
        pensando.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } catch (err) {
      chatLog.pop();
      if (pensando) pensando.innerHTML = `<span class="quieto">${esc(err.message)}</span>`;
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
  const mostrarFoto = (archivo) => {
    const caja = $('#r-foto');
    if (!caja) return;
    caja.hidden = false;
    caja.querySelector('img').src = URL.createObjectURL(archivo);
    $('#r-texto').placeholder = 'Algo que no se ve, o pregunta…';
    
  };
  const quitarFoto = () => {
    fotoPendiente = null;
    $('#r-foto').hidden = true;
    $('#r-texto').placeholder = items.length ? 'Agrega, corrige o pregunta…' : '¿Qué comiste?';
    
  };
  const leer = async () => {
    const texto = $('#r-texto').value.trim();
    if (!fotoPendiente && !texto) return $('#r-texto').focus();
    const boton = $('#r-leer');
    boton.disabled = true;
    $('#r-texto').value = '';
    $('#r-texto').style.height = '';
    try {
      if (fotoPendiente) {
        // Con foto: primero se lee el plato. Lo que escribiste va como aclaración del plato, salvo que sea una pregunta.
        const pregunta = esPregunta(texto) ? texto : '';
        mensaje(texto && !pregunta ? 'Mirando la foto y lo que le agregaste…' : 'Mirando la foto…', true);
        const r = await gemini('foto', { imagen: await fotoBase64(fotoPendiente), tipo: 'image/jpeg', texto: (pregunta ? '' : texto) || undefined });
        if (!r.alimentos?.length) { mensaje('No reconocí comida en la foto. Prueba más cerca o escríbelo.'); return; }
        for (const x of r.alimentos) agregar(await aAlimento(x), x.gramos);
        // Lo que vio en la foto queda en la conversación: así después puedes decir «la foto era para los dos».
        const visto = `📷 En la foto veo: ${r.alimentos.map((x) => `${x.nombre.toLowerCase()} (${Math.round(x.gramos)} g)`).join(', ')}.`;
        burbuja('ia', esc(visto));
        historial.push({ rol: 'yo', texto: texto && !pregunta ? `Te mando una foto del plato. ${texto}` : 'Te mando una foto del plato.' }, { rol: 'ia', texto: visto });
        quitarFoto();
        mensaje(null);
        $('#r-ia')?.classList.remove('ia-caja--pensando');
        // Y la IA revisa el plato sola (proteína, carbohidratos y verduras), o responde lo que preguntaste.
        await hablar(pregunta || REVISION, { auto: !pregunta });
      } else {
        await hablar(texto);
      }
    } catch (err) {
      mensaje(`${err.message} Mientras tanto, agrégalo a mano.`);
    } finally {
      boton.disabled = false;
      $('#r-ia')?.classList.remove('ia-caja--pensando');
    }
  };

  const conectarPaso1 = () => {
    const texto = $('#r-texto');
    const ajustar = () => { texto.style.height = 'auto'; texto.style.height = `${Math.min(120, texto.scrollHeight)}px`; };
    texto.addEventListener('input', ajustar);
    $('#r-leer').addEventListener('click', leer);
    $('#r-texto').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); leer(); } });
    for (const id of ['#r-camara', '#r-galeria']) {
      $(id).addEventListener('change', (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        fotoPendiente = f;
        mostrarFoto(f);
        mensaje('📷 Foto lista. Si le pusiste algo que no se ve, escríbelo; después toca «Enviar».');
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
      return [id, { kcal: propio.kcal + compartido.kcal * f, proteina: propio.proteina + compartido.proteina * f }];
    });
  };

  const pintarPaso2 = () => {
    paso = 2;
    $('#r-paso').textContent = 'Paso 2 de 2';
    $('#r-momento-btn').hidden = true;
    $('#r-momento').hidden = true;
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
    $('#r-pie').innerHTML = `
      <button type="button" class="boton boton--sec" id="r-atras">Atrás</button>
      <button type="button" class="boton reg__seguir" id="r-guardar">${editar ? 'Guardar cambios' : 'Guardar'}</button>`;
    d.querySelectorAll('[data-persona]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.persona;
      quien = quien.includes(id) ? quien.filter((x) => x !== id) : [...quien, id];
      if (!quien.length) quien = [id];
      pintarPaso2();
    }));
    d.querySelectorAll('[data-reparto]').forEach((b) => b.addEventListener('click', () => { reparto = b.dataset.reparto; pintarPaso2(); }));
    d.querySelectorAll('[data-dueno]').forEach((b) => b.addEventListener('click', () => { items[Number(b.dataset.dueno)].persona = b.dataset.id || null; pintarPaso2(); }));
    $('#r-atras').addEventListener('click', pintarPaso1);
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

  pintarPaso1();
  if (op.foto) { fotoPendiente = op.foto; mostrarFoto(op.foto); mensaje('📷 Foto lista. Si le pusiste algo que no se ve, escríbelo; después toca «Enviar».'); }
  else if (op.texto) leer();
  return d;
}
