// Agregar o editar una comida, en una pantalla con dos pasos:
//   1. Qué comiste: la IA al centro (foto, texto o ambos) o a mano (buscar, escanear, habituales).
//      Debajo, la lista para revisar y si alcanza para esa comida (desayuno, almuerzo…) con sugerencias.
//   2. Quién comió (solo si en el hogar hay más personas): uno, varios, y si fue un plato cada uno o compartido.
import { estado } from '../db.js';
import { esc, aviso, avisoError, abrirDialogo, cara } from '../ui.js';
import { hoyISO } from '../fechas.js';
import { macros, sumar } from '../alimentos.js';
import { OBJETIVOS } from '../nutricion.js';
import { panelBuscar } from './buscar.js';
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
    $('#r-cuerpo').innerHTML = `
      <section class="ia-caja ia-caja--compacta" id="r-ia">
        <div class="ia-foto" id="r-foto" hidden>
          <img alt="Foto del plato">
          <button type="button" class="ia-foto__quitar" id="r-foto-quitar" aria-label="Quitar la foto">${ICONO.x}</button>
        </div>
        <textarea id="r-texto" rows="2" maxlength="600" placeholder="Cuéntale a la IA qué comiste, o saca una foto">${esc(op.texto ?? '')}</textarea>
        <div class="ia-comp__barra">
          <label class="ia-icono" aria-label="Sacar foto">${ICONO.camara}<input type="file" id="r-camara" accept="image/*" capture="environment" hidden></label>
          <label class="ia-icono" aria-label="Elegir de la galería">${ICONO.galeria}<input type="file" id="r-galeria" accept="image/*" hidden></label>
          <button type="button" class="boton boton--ia boton--chico ia-comp__leer" id="r-leer">${ICONO.chispa}<span>Leer</span></button>
        </div>
        <p class="ia-estado" id="r-estado" hidden></p>
      </section>

      <div class="frecuentes reg__rapidos" aria-label="Agregar rápido">
        <button type="button" class="chip chip--mini chip--buscar" id="r-buscar-abrir">${ICONO.buscar} Buscar</button>
        ${lista.map((f, i) => `<button type="button" class="chip chip--mini" data-frec="${i}">+ ${esc(nombreCorto(f.alimento))}</button>`).join('')}
      </div>
      <div id="r-buscar" hidden></div>

      <div id="r-items" class="pila" style="gap:8px"></div>
      <div class="comida-total" id="r-total"></div>
      <div class="consejo" id="r-consejo" hidden>
        <div class="consejo__meta" id="r-meta"></div>
        <div id="r-respuesta"></div>
        <div class="consejo__fila" id="r-pregunta-fila">
          <input id="r-pregunta" type="text" maxlength="200" placeholder="Pregúntale: ¿me falta proteína o verduras?" aria-label="Pregúntale a la IA">
          <button type="button" class="boton boton--ia boton--chico" id="r-preguntar" aria-label="Preguntar">${ICONO.chispa}</button>
        </div>
      </div>`;
    $('#r-pie').innerHTML = `
      ${editar ? '<button type="button" class="boton boton--peligro" id="r-borrar">Eliminar</button>' : ''}
      <button type="button" class="boton reg__seguir" id="r-seguir" disabled>${varios ? 'Seguir' : (editar ? 'Guardar cambios' : 'Guardar')}</button>`;
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
    if ($('#r-texto') && !fotoPendiente) $('#r-texto').placeholder = items.length ? 'Agrega algo más, o pregúntale sobre el plato (¿me falta proteína?)' : 'Cuéntale a la IA qué comiste, o saca una foto';
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
    const meta = Math.round(info.metas.kcal * (PARTE_COMIDA[momento] ?? 0.25) / 10) * 10;
    const protMeta = Math.round(info.metas.proteina * (PARTE_COMIDA[momento] ?? 0.25));
    const antes = op.comida?.porciones?.find((x) => x.persona_id === estado.yo.id);
    const restoDia = info.metas.kcal - (info.comido.kcal - Number(antes?.kcal ?? 0)) - mio.kcal;
    return { info, mio, meta, protMeta, falta: meta - mio.kcal, restoDia };
  };
  const pintarMeta = () => {
    const b = items.length && paso === 1 ? balance() : null;
    const caja = $('#r-consejo');
    if (!caja) return;
    caja.hidden = !b;
    if (!b) return;
    const nombre = MOMENTOS[momento].toLowerCase();
    const pct = Math.min(100, Math.round((b.mio.kcal / b.meta) * 100));
    const estadoTxt = b.falta > 120 ? `<strong class="consejo__falta">Te faltan ~${kc(b.falta)} kcal</strong> para un buen ${esc(nombre)}`
      : b.falta < -b.meta * 0.35 ? `<strong class="consejo__falta">Te pasaste ~${kc(-b.falta)} kcal</strong> de lo ideal para un ${esc(nombre)}`
      : `<strong class="hecho">Buen ${esc(nombre)} ✓</strong>`;
    $('#r-meta').innerHTML = `
      <div class="meta-comida__fila"><span>${MOMENTOS[momento]}${varios ? ' · tu parte' : ''}</span><span><strong>${kc(b.mio.kcal)}</strong> / ~${kc(b.meta)} kcal · P ${Math.round(b.mio.proteina)}/${b.protMeta} g</span></div>
      <div class="meta-comida__barra"><span style="width:${pct}%"></span></div>
      <p class="meta-comida__txt">${estadoTxt}${fecha === hoyISO() ? ` · en el día te quedan ${kc(Math.max(0, b.restoDia))} kcal` : ''}</p>`;
  };

  const aconsejar = async (pregunta = '') => {
    const b = balance();
    if (!b) return;
    if (!pregunta && b.falta <= 120 && b.falta >= -b.meta * 0.35) return; // está bien: no hace falta preguntar
    const cont = $('#r-respuesta');
    const boton = $('#r-preguntar');
    boton.disabled = true;
    cont.innerHTML = '<p class="consejo__cargando"><span class="ia-puntos"><i></i><i></i><i></i></span> La IA está pensando…</p>';
    try {
      const r = await gemini('consejo', {
        texto: pregunta ? `${pregunta}\n(Contesta mirando el balance del plato: proteína, carbohidratos, grasas y verduras o fibra; si faltan verduras, sugiere cuáles y cuántos gramos.)` : undefined,
        contexto: {
          objetivo: OBJETIVOS[b.info.foco]?.nombre ?? b.info.foco,
          comida: MOMENTOS[momento],
          meta_de_esta_comida: { kcal: b.meta, proteina_g: b.protMeta, carbos_g: Math.round((b.info.metas.carbos ?? 0) * (PARTE_COMIDA[momento] ?? 0.25)) },
          esta_comida: items.map((it) => {
            const m = macros(it.alimento, it.gramos);
            const dueno = it.persona ? estado.personas.find((p) => p.id === it.persona)?.nombre : null;
            return { nombre: it.alimento.nombre, gramos: Math.round(it.gramos), kcal: Math.round(m.kcal), proteina_g: Math.round(m.proteina), carbos_g: Math.round(m.carbos), grasas_g: Math.round(m.grasas), ...(dueno ? { de: dueno } : {}) };
          }),
          quien_pregunta: estado.yo.nombre,
          hogar: hogarContexto(),
          le_faltan_kcal_en_esta_comida: Math.round(b.falta),
          meta_del_dia: { kcal: Math.round(b.info.metas.kcal), proteina_g: Math.round(b.info.metas.proteina) },
          le_quedan_kcal_en_el_dia: Math.round(b.restoDia),
          entrenos_hoy: (b.info.eventos ?? []).filter((e) => e.tipo !== 'descanso').map((e) => e.tipo),
          despensa: (ctx.despensa ?? []).slice(0, 30).map((p) => p.alimento?.nombre).filter(Boolean),
        },
      });
      cont.innerHTML = `
        <p class="consejo__respuesta"><span class="ia-logo ia-logo--mini" aria-hidden="true">${ICONO.chispa}</span>${esc(r.respuesta)}</p>
        ${r.sugerencias?.length ? `<div class="chips">${r.sugerencias.map((x, k) =>
          `<button type="button" class="chip chip--mini chip--sugerencia" data-sug="${k}">+ ${esc(x.cantidad || `${Math.round(x.gramos)} g`)} ${esc(x.nombre.toLowerCase())} · ${kc(x.kcal * x.gramos / 100)} kcal</button>`).join('')}</div>` : ''}
        ${htmlReparto(r.reparto)}`;
      cont.querySelector('#r-aplicar-reparto')?.addEventListener('click', (e) => { aplicarReparto(r.reparto); e.currentTarget.closest('.reparto-ia').remove(); });
      cont.querySelectorAll('[data-sug]').forEach((btn) => btn.addEventListener('click', async () => {
        btn.disabled = true;
        const x = r.sugerencias[Number(btn.dataset.sug)];
        agregar(await aAlimento(x), x.gramos, null, reparto === 'distinto' ? estado.yo.id : null);
        btn.remove();
      }));
    } catch (err) {
      cont.innerHTML = `<p class="quieto">${esc(err.message)}</p>`;
    } finally { if (boton) boton.disabled = false; }
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
  const itemPorNombre = (n) => {
    const t = String(n ?? '').trim().toLowerCase();
    return items.find((it) => it.alimento.nombre.toLowerCase() === t)
      ?? items.find((it) => it.alimento.nombre.toLowerCase().includes(t) || t.includes(it.alimento.nombre.toLowerCase())) ?? null;
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
  const aplicarReparto = (sugerido) => {
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
    aviso('Reparto aplicado: revísalo en el paso 2.');
  };

  // ---------- La IA: texto, foto o ambas ----------
  const mostrarFoto = (archivo) => {
    const caja = $('#r-foto');
    if (!caja) return;
    caja.hidden = false;
    caja.querySelector('img').src = URL.createObjectURL(archivo);
    $('#r-texto').placeholder = 'Opcional: lo que no se ve («le puse 100 g de mozzarella y 2 cucharadas de aceite»)';
    
  };
  const quitarFoto = () => {
    fotoPendiente = null;
    $('#r-foto').hidden = true;
    $('#r-texto').placeholder = '«3 huevos en tortilla con 200 g de fideos y un café con leche»';
    
  };
  const leer = async () => {
    const texto = $('#r-texto').value.trim();
    if (!fotoPendiente && !texto) return $('#r-texto').focus();
    // Sin foto, una pregunta sobre lo que ya está en el plato va directo a la IA (no se lee como comida).
    if (!fotoPendiente && items.length && esPregunta(texto)) {
      $('#r-texto').value = '';
      aconsejar(texto);
      $('#r-consejo')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const boton = $('#r-leer');
    boton.disabled = true;
    try {
      // «¿Con esto de carbohidratos estoy bien?»: con foto, una pregunta no es parte del plato; primero se lee la foto y después se pregunta.
      const pregunta = esPregunta(texto) ? texto : '';
      if (fotoPendiente) {
        mensaje(pregunta ? 'Mirando la foto…' : texto ? 'Mirando la foto y lo que le agregaste…' : 'Mirando la foto…', true);
        const r = await gemini('foto', { imagen: await fotoBase64(fotoPendiente), tipo: 'image/jpeg', texto: (pregunta ? '' : texto) || undefined });
        if (!r.alimentos?.length) { mensaje('No reconocí comida en la foto. Prueba más cerca o escríbelo.'); return; }
        for (const x of r.alimentos) agregar(await aAlimento(x), x.gramos);
        quitarFoto();
        $('#r-texto').value = '';
        mensaje(pregunta ? 'Listo. Ahora respondo tu pregunta abajo 👇' : 'Listo. Revisa las cantidades: la IA las estima a ojo.');
        // Con foto, la IA revisa siempre el plato (proteína, carbohidratos y verduras), o responde lo que preguntaste.
        aconsejar(pregunta || REVISION);
        setTimeout(() => $('#r-consejo')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
        return;
      } else {
        mensaje('Leyendo…', true);
        const otro = estado.personas.find((p) => p.id !== estado.yo.id);
        const r = await gemini('texto', { texto, personas: { yo: estado.yo.nombre, otro: otro?.nombre ?? null } });
        const lista = r.alimentos ?? [];
        if (!lista.length) { mensaje('No entendí comida en eso. Prueba con otras palabras o agrégalo a mano.'); return; }
        if (r.momento) { momento = r.momento; pintarMomento(); }
        // Si habla de los dos, cada cosa va a su dueño y en el paso 2 quedan elegidos ambos.
        const deYo = lista.some((x) => x.gramos_yo > 0), deOtro = otro && lista.some((x) => x.gramos_otro > 0);
        for (const x of lista) {
          const alimento = await aAlimento(x);
          if (deYo && deOtro) {
            if (x.gramos_yo > 0) agregar(alimento, x.gramos_yo, null, estado.yo.id);
            if (x.gramos_otro > 0) agregar(alimento, x.gramos_otro, null, otro.id);
          } else agregar(alimento, (x.gramos_yo || 0) + (x.gramos_otro || 0));
        }
        if (deYo && deOtro) { quien = [estado.yo.id, otro.id]; reparto = 'distinto'; }
        else if (deOtro) quien = [otro.id];
        $('#r-texto').value = '';
        mensaje(deYo && deOtro ? `Separé lo de cada uno: lo ves en el paso 2.` : null);
      }
      aconsejar();
    } catch (err) {
      mensaje(`${err.message} Mientras tanto, agrégalo a mano.`);
    } finally {
      boton.disabled = false;
      $('#r-ia')?.classList.remove('ia-caja--pensando');
    }
  };

  const conectarPaso1 = () => {
    const texto = $('#r-texto');
    const ajustar = () => { texto.style.height = 'auto'; texto.style.height = `${Math.min(160, texto.scrollHeight)}px`; };
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
        mensaje('📷 Foto lista. Si le pusiste algo que no se ve, escríbelo; después toca «Leer foto».');
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
    $('#r-preguntar').addEventListener('click', () => { const q = $('#r-pregunta').value.trim(); $('#r-pregunta').value = ''; aconsejar(q || REVISION); });
    $('#r-pregunta').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#r-preguntar').click(); } });
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
  if (op.foto) { fotoPendiente = op.foto; mostrarFoto(op.foto); mensaje('📷 Foto lista. Si le pusiste algo que no se ve, escríbelo; después toca «Leer foto».'); }
  else if (op.texto) leer();
  return d;
}
