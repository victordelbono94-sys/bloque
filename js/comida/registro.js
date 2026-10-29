// Registrar o editar una comida en una sola hoja:
//   escribir "3 huevos y un café con leche" (Gemini lo interpreta), sacar una foto,
//   tocar un frecuente, o buscar/escanear. Después se ajustan cantidades y se guarda.
import { estado, otraPersona } from '../db.js';
import { esc, aviso, avisoError, abrirDialogo, grupoChips, valorChips } from '../ui.js';
import { hoyISO } from '../fechas.js';
import { macros, sumar } from '../alimentos.js';
import { OBJETIVOS } from '../nutricion.js';
import { panelBuscar } from './buscar.js';
import {
  MOMENTOS, momentoPorHora, momentoSugerido, kc, g, cantidadTexto, gemini, fotoBase64, aAlimento, guardarComida, borrarComida,
} from './comun.js';

const ICONO = {
  foto: '<svg class="icono" viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  codigo: '<svg class="icono" viewBox="0 0 24 24"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M7 8v8M10 8v8M13 8v8M16.5 8v8"/></svg>',
  buscar: '<svg class="icono" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
  menos: '<svg class="icono" viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
  mas: '<svg class="icono" viewBox="0 0 24 24"><path d="M6 12h12M12 6v12"/></svg>',
};

const leerQuien = (momento) => { try { return localStorage.getItem(`bloque-quien-${momento}`); } catch { return null; } };
const guardarQuien = (momento, v) => { try { localStorage.setItem(`bloque-quien-${momento}`, v); } catch { /* sin almacenamiento */ } };

/**
 * @param {object} ctx { fecha, esHoy, info, despensa, frecuentes, recargar }
 * @param {object} [op] { comida, items, texto, foto, momento, repetir }
 */
export function abrirRegistro(ctx, op = {}) {
  const otro = otraPersona();
  const editar = op.comida && !op.repetir;
  const fecha = op.repetir ? hoyISO() : (op.comida?.fecha ?? ctx.fecha);
  const items = (op.items ?? op.comida?.comida_items?.map((i) => ({
    alimento: i.alimento, gramos: Number(i.gramos), persona: i.persona_id ?? null,
    paquete: !op.repetir && i.despensa_id ? ctx.despensa.find((p) => p.id === i.despensa_id) ?? { id: i.despensa_id, gramos_restantes: 0 } : null,
  })) ?? []).map((x) => ({ ...x }));

  const sugerido = fecha === hoyISO() ? momentoSugerido(ctx.info?.[0]?.eventos ?? []) : null;
  const momento0 = op.momento ?? op.comida?.momento ?? sugerido ?? momentoPorHora();
  // Quién comió: lo de la comida que se edita, o lo último que eligieron para ese momento.
  const porciones = op.comida?.porciones ?? [];
  let quien0 = porciones.length === 1 ? (porciones[0].persona_id === estado.yo.id ? 'yo' : 'otro') : porciones.length > 1 ? 'juntos' : null;
  quien0 ??= leerQuien(momento0) ?? (['almuerzo', 'cena'].includes(momento0) && otro ? 'juntos' : 'yo');
  if (!otro) quien0 = 'yo';
  // Comidas viejas con un reparto distinto de la mitad: lo compartido pasa a renglones de cada uno.
  const mia = porciones.find((x) => x.persona_id === estado.yo.id);
  if (porciones.length > 1 && mia && Math.abs(Number(mia.fraccion) - 0.5) > 0.01) {
    const f = Number(mia.fraccion);
    for (const it of items.filter((x) => !x.persona)) {
      items.push({ ...it, persona: otro.id, gramos: it.gramos * (1 - f), paquete: null });
      it.persona = estado.yo.id; it.gramos *= f;
    }
  }

  const d = abrirDialogo(`
    <form class="dialogo registro" novalidate>
      <h2 class="tarjeta__titulo">${editar ? 'Editar comida' : op.repetir ? 'Repetir comida' : 'Registrar comida'}</h2>

      ${otro ? `
        <fieldset class="quien">
          <legend>¿Quién comió?</legend>
          <div class="quien__opciones" id="r-quien">
            <button type="button" class="chip quien__op" data-valor="juntos" aria-pressed="${quien0 === 'juntos'}">
              <span class="quien__caras" aria-hidden="true"><span>${esc(inicial(estado.yo))}</span><span>${esc(inicial(otro))}</span></span>${esc(otro.nombre)} y yo
            </button>
            <button type="button" class="chip quien__op" data-valor="yo" aria-pressed="${quien0 === 'yo'}">
              <span class="quien__caras" aria-hidden="true"><span>${esc(inicial(estado.yo))}</span></span>Solo yo
            </button>
            <button type="button" class="chip quien__op" data-valor="otro" aria-pressed="${quien0 === 'otro'}">
              <span class="quien__caras" aria-hidden="true"><span>${esc(inicial(otro))}</span></span>Solo ${esc(otro.nombre)}
            </button>
          </div>
          <p class="ayuda quien__ayuda" id="r-ayuda-juntos" ${quien0 === 'juntos' ? '' : 'hidden'}>Lo que diga «Los dos» se reparte a la mitad. Si comieron distinto, toca «Separar» y pon cuánto comió cada uno.</p>
        </fieldset>` : ''}

      <fieldset class="cuando">
        <legend>¿Cuándo?${!op.comida && !op.momento && sugerido ? ' <span class="quieto">· elegido por la hora</span>' : ''}</legend>
        <div class="chips chips--scroll" id="r-momento" aria-label="Momento">
          ${Object.entries(MOMENTOS).map(([v, t]) => `<button type="button" class="chip chip--mini" data-valor="${v}" aria-pressed="${v === momento0}">${t}</button>`).join('')}
        </div>
      </fieldset>

      <div class="registro__entrada">
        <textarea id="r-texto" rows="2" maxlength="600" placeholder="Escribe qué comieron: «yo 3 huevos y café; ${esc(otro?.nombre ?? 'él')} 2 huevos y leche» o «café con leche»">${esc(op.texto ?? '')}</textarea>
        <div class="registro__botones">
          <button type="button" class="boton boton--chico" id="r-leer">Agregar</button>
          <button type="button" class="boton boton--sec boton--chico boton--icono" id="r-foto" aria-label="Foto del plato">${ICONO.foto}</button>
          <button type="button" class="boton boton--sec boton--chico boton--icono" id="r-buscar-abrir" aria-label="Buscar o escanear">${ICONO.buscar}</button>
          <input type="file" id="r-archivo" accept="image/*" hidden>
        </div>
      </div>
      <p class="registro__estado" id="r-estado" hidden></p>
      <div id="r-buscar" hidden></div>

      ${ctx.frecuentes?.length ? `
        <div class="frecuentes" aria-label="Agregar rápido">
          ${ctx.frecuentes.map((f, i) => `<button type="button" class="chip chip--mini" data-frec="${i}">+ ${esc(nombreCorto(f.alimento))} <span class="quieto">${esc(cantidadTexto(f.alimento, f.gramos))}</span></button>`).join('')}
        </div>` : ''}

      <div id="r-items" class="pila" style="gap:8px"></div>


      <div class="comida-total" id="r-total"></div>
      <div class="consejo" id="r-consejo" hidden>
        <p class="consejo__meta" id="r-meta"></p>
        <div class="consejo__fila">
          <input id="r-pregunta" type="text" maxlength="200" placeholder="¿Y si agrego una lata de atún? ¿Me alcanza?" aria-label="Pregúntale a Gemini">
          <button type="button" class="boton boton--sec boton--chico" id="r-preguntar">Preguntar</button>
        </div>
        <div id="r-respuesta"></div>
      </div>
      <div class="dialogo__pie">
        ${editar ? '<button type="button" class="boton boton--peligro" id="r-borrar" style="margin-right:auto">Eliminar</button>' : ''}
        ${op.comida && !op.repetir ? '<button type="button" class="boton boton--sec" id="r-repetir">Repetir hoy</button>' : ''}
        <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
        <button type="submit" class="boton" id="r-guardar">${editar ? 'Guardar cambios' : 'Guardar'}</button>
      </div>
    </form>`, editar ? 'Editar comida' : 'Registrar comida');

  const $ = (s) => d.querySelector(s);
  const estadoEl = $('#r-estado');
  const quien = $('#r-quien');
  grupoChips($('#r-momento'));
  if (quien) grupoChips(quien, () => pintar());
  const quienAhora = () => (quien ? valorChips(quien) : 'yo');
  const elegirQuien = (v) => {
    if (!quien) return;
    quien.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.valor === v)));
  };

  const mensaje = (t) => { estadoEl.hidden = !t; estadoEl.textContent = t ?? ''; };
  const fracciones = () => {
    const v = quienAhora();
    if (v === 'yo') return [[estado.yo.id, 1]];
    if (v === 'otro') return [[otro.id, 1]];
    return [[estado.yo.id, 0.5], [otro.id, 0.5]];
  };
  const paqueteDe = (alimento) => ctx.despensa.find((p) => p.alimento_id === alimento.id && Number(p.gramos_restantes) > 0);

  function pintar() {
    const cont = $('#r-items');
    cont.innerHTML = items.length ? items.map((it, i) => {
      const m = macros(it.alimento, it.gramos);
      const paquete = it.paquete ?? null;
      const enDespensa = !paquete && paqueteDe(it.alimento);
      return `
        <div class="item-comida">
          <div class="item-comida__info">
            <span class="item-comida__titulo">
              <strong>${esc(it.alimento.nombre)}</strong>
              ${quienAhora() === 'juntos' ? `
                <button type="button" class="dueno dueno--${it.persona === estado.yo.id ? 'yo' : it.persona ? 'otro' : 'ambos'}" data-dueno="${i}" aria-label="De quién es: tocar para cambiar">${it.persona === estado.yo.id ? 'Solo yo' : it.persona ? `Solo ${esc(otro.nombre)}` : 'Los dos · mitad c/u'}</button>
                ${!it.persona ? `<button type="button" class="dueno dueno--accion" data-separar="${i}">Separar</button>` : ''}` : ''}
            </span>
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
    }).join('') : '<p class="quieto" style="margin:0;font-size:14px">Todavía nada. Escribe, saca una foto o toca un frecuente.</p>';

    const total = sumar(items.map((it) => macros(it.alimento, it.gramos)));
    const juntos = quienAhora() === 'juntos';
    const compartidos = items.filter((it) => !it.persona);
    if (quien) $('#r-ayuda-juntos').hidden = !juntos;
    const porPersona = porciones2(items, fracciones());
    $('#r-total').innerHTML = !items.length ? '' : juntos
      ? `<div class="total-personas">${porPersona.map(([id, m]) => `<span><strong>${id === estado.yo.id ? 'Yo' : esc(otro.nombre)}</strong> ${kc(m.kcal)} kcal · P ${Math.round(m.proteina)}</span>`).join('')}</div>`
      : `<strong>${kc(total.kcal)} kcal</strong> · P ${Math.round(total.proteina)} · C ${Math.round(total.carbos)} · G ${Math.round(total.grasas)}`;
    $('#r-guardar').disabled = !items.length;
    pintarMeta();

    const paso = (it) => Number(it.alimento.porcion_g) > 0 && Number(it.alimento.porcion_g) <= 250 ? Number(it.alimento.porcion_g) : 10;
    cont.querySelectorAll('[data-gramos]').forEach((inp) => inp.addEventListener('change', () => {
      const v = Number(inp.value);
      items[Number(inp.dataset.gramos)].gramos = v > 0 ? v : 1;
      pintar();
    }));
    cont.querySelectorAll('[data-mas]').forEach((b) => b.addEventListener('click', () => { const it = items[Number(b.dataset.mas)]; it.gramos += paso(it); pintar(); }));
    cont.querySelectorAll('[data-menos]').forEach((b) => b.addEventListener('click', () => { const it = items[Number(b.dataset.menos)]; it.gramos = Math.max(1, it.gramos - paso(it)); pintar(); }));
    cont.querySelectorAll('[data-quitar]').forEach((b) => b.addEventListener('click', () => { items.splice(Number(b.dataset.quitar), 1); pintar(); }));
    cont.querySelectorAll('[data-separar]').forEach((b) => b.addEventListener('click', () => {
      // Un renglón para cada uno, con la mitad de partida; después se ajusta cada cantidad.
      const k = Number(b.dataset.separar), it = items[k];
      const mitad = Math.round(it.gramos / 2);
      items.splice(k, 1, { ...it, persona: estado.yo.id, gramos: mitad }, { ...it, persona: otro.id, gramos: mitad, paquete: null });
      pintar();
      cont.querySelectorAll('[data-gramos]')[k]?.focus();
    }));
    cont.querySelectorAll('[data-dueno]').forEach((b) => b.addEventListener('click', () => {
      // Los dos → Yo → el otro → Los dos
      const it = items[Number(b.dataset.dueno)];
      it.persona = !it.persona ? estado.yo.id : it.persona === estado.yo.id ? otro.id : null;
      pintar();
    }));
    cont.querySelectorAll('[data-despensa]').forEach((b) => b.addEventListener('click', () => {
      const it = items[Number(b.dataset.despensa)];
      it.paquete = it.paquete ? null : paqueteDe(it.alimento);
      pintar();
    }));
  }

  // ---------- ¿Con esto llego a la meta? ----------
  // De quién se mira la meta: el otro si la comida es solo suya; si no, la mía.
  const personaMeta = () => (quienAhora() === 'otro' && otro ? otro.id : estado.yo.id);
  const balance = () => {
    const pid = personaMeta();
    const info = ctx.info?.find((x) => x.p.id === pid);
    if (!info?.metas?.ok || fecha !== hoyISO()) return null;
    const juntos = quienAhora() === 'juntos';
    const este = juntos ? (porciones2(items, fracciones()).find(([id]) => id === pid)?.[1] ?? sumar([])) : sumar(items.map((it) => macros(it.alimento, it.gramos)));
    // Si se está editando, lo comido ya incluye la versión anterior de esta comida.
    const antes = op.comida && !op.repetir ? op.comida.porciones?.find((x) => x.persona_id === pid) : null;
    const comido = {
      kcal: info.comido.kcal - Number(antes?.kcal ?? 0), proteina: info.comido.proteina - Number(antes?.proteina_g ?? 0),
      carbos: info.comido.carbos - Number(antes?.carbohidratos_g ?? 0), grasas: info.comido.grasas - Number(antes?.grasas_g ?? 0),
    };
    return { pid, info, este, comido, total: comido.kcal + este.kcal, falta: info.metas.kcal - comido.kcal - este.kcal };
  };
  const pintarMeta = () => {
    const b = items.length ? balance() : null;
    $('#r-consejo').hidden = !b;
    if (!b) return;
    const quienTxt = b.pid === estado.yo.id ? '' : ` (${b.info.p.nombre})`;
    const prot = Math.round(b.comido.proteina + b.este.proteina);
    $('#r-meta').innerHTML = b.falta > 50
      ? `Con este plato llegas a <strong>${kc(b.total)}</strong> de ${kc(b.info.metas.kcal)} kcal hoy${esc(quienTxt)} · <strong class="consejo__falta">te faltan ${kc(b.falta)}</strong> · P ${prot}/${Math.round(b.info.metas.proteina)} g`
      : `Con este plato llegas a <strong>${kc(b.total)}</strong> de ${kc(b.info.metas.kcal)} kcal${esc(quienTxt)}: <strong class="hecho">meta cumplida ✓</strong>`;
  };
  const aconsejar = async (pregunta = '') => {
    const b = balance();
    if (!b) return;
    if (!pregunta && b.falta < 200) return; // ya está cerca: no hace falta gastar una consulta
    const cont = $('#r-respuesta');
    const boton = $('#r-preguntar');
    boton.disabled = true;
    cont.innerHTML = '<p class="quieto consejo__cargando">Gemini está pensando…</p>';
    try {
      const r = await gemini('consejo', {
        texto: pregunta || undefined,
        contexto: {
          objetivo: OBJETIVOS[b.info.foco]?.nombre ?? b.info.foco,
          meta_dia: { kcal: Math.round(b.info.metas.kcal), proteina_g: Math.round(b.info.metas.proteina), carbos_g: Math.round(b.info.metas.carbos), grasas_g: Math.round(b.info.metas.grasas) },
          ya_comio_hoy: { kcal: Math.round(b.comido.kcal), proteina_g: Math.round(b.comido.proteina) },
          este_plato: items.map((it) => { const m = macros(it.alimento, it.gramos); return { nombre: it.alimento.nombre, gramos: Math.round(it.gramos), kcal: Math.round(m.kcal), proteina_g: Math.round(m.proteina) }; }),
          con_este_plato_queda: { kcal: Math.round(b.total), le_faltan_kcal: Math.round(b.falta) },
          entrenos_hoy: (b.info.eventos ?? []).filter((e) => e.tipo !== 'descanso').map((e) => e.tipo),
          despensa: (ctx.despensa ?? []).slice(0, 30).map((p) => p.alimento?.nombre).filter(Boolean),
        },
      });
      cont.innerHTML = `
        <p class="consejo__respuesta">${esc(r.respuesta)}</p>
        ${r.sugerencias?.length ? `<div class="chips">${r.sugerencias.map((x, k) =>
          `<button type="button" class="chip chip--mini chip--sugerencia" data-sug="${k}">+ ${esc(x.cantidad || `${Math.round(x.gramos)} g`)} ${esc(x.nombre.toLowerCase())} · ${kc(x.kcal * x.gramos / 100)} kcal</button>`).join('')}</div>` : ''}`;
      cont.querySelectorAll('[data-sug]').forEach((btn) => btn.addEventListener('click', async () => {
        btn.disabled = true;
        const x = r.sugerencias[Number(btn.dataset.sug)];
        agregar(await aAlimento(x), x.gramos, null, quienAhora() === 'juntos' ? b.pid : null);
        btn.remove();
      }));
    } catch (err) {
      cont.innerHTML = `<p class="quieto">${esc(err.message)}</p>`;
    } finally { boton.disabled = false; }
  };
  $('#r-preguntar').addEventListener('click', () => { const q = $('#r-pregunta').value.trim(); $('#r-pregunta').value = ''; aconsejar(q || '¿Qué me falta para llegar a mi meta de hoy?'); });
  $('#r-pregunta').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#r-preguntar').click(); } });

  const agregar = (alimento, gramos, paquete = null, persona = null) => { items.push({ alimento, gramos: Number(gramos) || 100, paquete, persona }); pintar(); };

  // Escribir y que Gemini lo interprete. Si hay una foto lista, va la foto con el texto como agregado.
  const leer = async () => {
    const texto = $('#r-texto').value.trim();
    if (fotoPendiente) return analizar(fotoPendiente, texto);
    if (!texto) return $('#r-texto').focus();
    const boton = $('#r-leer');
    boton.disabled = true;
    mensaje('Leyendo con Gemini…');
    try {
      const r = await gemini('texto', { texto, personas: { yo: estado.yo.nombre, otro: otro?.nombre ?? null } });
      const lista = r.alimentos ?? [];
      if (!lista.length) { mensaje('No entendí comida en eso. Prueba con otras palabras o búscalo.'); return; }
      // Si el texto dice el momento («desayunamos», «antes del derby»), se marca ese.
      if (r.momento) {
        for (const b of d.querySelectorAll('#r-momento [data-valor]')) b.setAttribute('aria-pressed', String(b.dataset.valor === r.momento));
        d.querySelector('.cuando .quieto')?.remove();
      }
      // ¿De quién habla? Si menciona a los dos, la comida pasa a «los dos» y cada cosa va a su dueño.
      const deYo = lista.some((x) => x.gramos_yo > 0), deOtro = otro && lista.some((x) => x.gramos_otro > 0);
      if (deYo && deOtro) elegirQuien('juntos');
      else if (deOtro && !deYo) elegirQuien('otro');
      else if (deYo && quienAhora() === 'otro') elegirQuien('yo');
      const ambos = quienAhora() === 'juntos';
      for (const x of lista) {
        const alimento = await aAlimento(x);
        if (!ambos) { agregar(alimento, (x.gramos_yo || 0) + (x.gramos_otro || 0)); continue; }
        if (x.gramos_yo > 0) agregar(alimento, x.gramos_yo, null, estado.yo.id);
        if (x.gramos_otro > 0) agregar(alimento, x.gramos_otro, null, otro.id);
      }
      $('#r-texto').value = '';
      mensaje(ambos && deYo && deOtro ? 'Separé lo de cada uno. Toca «Yo», «Los dos» o el nombre para cambiar de quién es algo.' : null);
      aconsejar();
    } catch (err) {
      mensaje(`${err.message} Mientras tanto, usa la lupa para buscarlo.`);
    } finally {
      boton.disabled = false;
    }
  };
  $('#r-leer').addEventListener('click', leer);
  $('#r-texto').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); leer(); } });

  // Foto del plato: queda lista y se puede sumar texto («le puse 100 g de mozzarella») antes de leerla.
  let fotoPendiente = null;
  const prepararFoto = (archivo) => {
    fotoPendiente = archivo;
    $('#r-leer').textContent = 'Leer foto';
    $('#r-foto').classList.add('boton--foto-lista');
    mensaje('📷 Foto lista. ¿Le agregaste algo que no se ve (queso, aceite, salsa…)? Escríbelo y toca «Leer foto».');
    $('#r-texto').placeholder = 'Opcional: «le puse 100 g de mozzarella y 2 cucharadas de aceite de oliva»';
    $('#r-texto').focus();
  };
  const analizar = async (archivo, extra = '') => {
    const boton = $('#r-leer');
    boton.disabled = true;
    mensaje(extra ? 'Mirando la foto y lo que agregaste…' : 'Mirando la foto con Gemini…');
    try {
      const r = await gemini('foto', { imagen: await fotoBase64(archivo), tipo: 'image/jpeg', texto: extra || undefined });
      if (!r.alimentos?.length) { mensaje('No reconocí comida en la foto. Prueba más cerca o escríbelo.'); return; }
      for (const x of r.alimentos) agregar(await aAlimento(x), x.gramos);
      fotoPendiente = null;
      $('#r-texto').value = '';
      $('#r-leer').textContent = 'Agregar';
      $('#r-foto').classList.remove('boton--foto-lista');
      mensaje('Revisa las cantidades: Gemini las estima a ojo.');
      aconsejar(); // ¿con esto llega a la meta?
    } catch (err) { mensaje(err.message); } finally { boton.disabled = false; }
  };
  $('#r-foto').addEventListener('click', () => $('#r-archivo').click());
  $('#r-archivo').addEventListener('change', () => { const f = $('#r-archivo').files?.[0]; $('#r-archivo').value = ''; if (f) prepararFoto(f); });

  // Buscar, escanear o crear a mano.
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

  d.querySelectorAll('[data-frec]').forEach((b) => b.addEventListener('click', () => {
    const f = ctx.frecuentes[Number(b.dataset.frec)];
    agregar(f.alimento, f.gramos);
  }));

  $('#r-borrar')?.addEventListener('click', async () => {
    try {
      await borrarComida(op.comida);
      d.close();
      aviso('Comida eliminada.');
      ctx.recargar();
    } catch (err) { avisoError(err); }
  });
  $('#r-repetir')?.addEventListener('click', () => {
    d.close();
    setTimeout(() => abrirRegistro(ctx, { comida: op.comida, repetir: true }), 200);
  });

  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!items.length) return;
    const boton = $('#r-guardar');
    boton.disabled = true;
    const ahora = new Date();
    const momento = valorChips($('#r-momento')) ?? momentoPorHora();
    if (quien) guardarQuien(momento, valorChips(quien));
    try {
      const { total } = await guardarComida({
        anterior: editar ? op.comida : null,
        fecha,
        hora: editar ? op.comida.hora : (fecha === hoyISO() ? `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}` : null),
        momento,
        descripcion: editar ? op.comida.descripcion : null,
        items: quienAhora() === 'juntos' ? items : items.map((it) => ({ ...it, persona: null })),
        fracciones: fracciones(),
      });
      d.close();
      aviso(editar ? 'Comida actualizada.' : `Registrado: ${kc(total.kcal)} kcal.`);
      ctx.recargar(fecha);
    } catch (err) {
      avisoError(err);
      boton.disabled = false;
    }
  });

  pintar();
  if (op.texto) leer();
  if (op.foto) prepararFoto(op.foto);
  return d;
}

// Lo que come cada uno: lo suyo más su parte de lo compartido.
function porciones2(items, fracciones) {
  const compartido = sumar(items.filter((it) => !it.persona).map((it) => macros(it.alimento, it.gramos)));
  return fracciones.map(([id, f]) => {
    const propio = sumar(items.filter((it) => it.persona === id).map((it) => macros(it.alimento, it.gramos)));
    return [id, { kcal: propio.kcal + compartido.kcal * f, proteina: propio.proteina + compartido.proteina * f }];
  });
}

const inicial = (p) => (p?.nombre ?? '?').trim().charAt(0).toUpperCase();

// "Banana (guineo)" → "Banana"; "Proteína whey (polvo)" → "Proteína whey".
function nombreCorto(a) {
  return a.nombre.replace(/\s*\(.*\)\s*/g, '').replace(/ entero$/i, '').slice(0, 22);
}
