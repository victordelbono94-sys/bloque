// Registrar o editar una comida en una sola hoja:
//   escribir "3 huevos y un café con leche" (Gemini lo interpreta), sacar una foto,
//   tocar un frecuente, o buscar/escanear. Después se ajustan cantidades y se guarda.
import { estado, otraPersona } from '../db.js';
import { esc, aviso, avisoError, abrirDialogo, grupoChips, valorChips } from '../ui.js';
import { hoyISO } from '../fechas.js';
import { macros, sumar } from '../alimentos.js';
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

  const agregar = (alimento, gramos, paquete = null, persona = null) => { items.push({ alimento, gramos: Number(gramos) || 100, paquete, persona }); pintar(); };

  // Escribir y que Gemini lo interprete.
  const leer = async () => {
    const texto = $('#r-texto').value.trim();
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
    } catch (err) {
      mensaje(`${err.message} Mientras tanto, usa la lupa para buscarlo.`);
    } finally {
      boton.disabled = false;
    }
  };
  $('#r-leer').addEventListener('click', leer);
  $('#r-texto').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); leer(); } });

  // Foto del plato.
  const analizar = async (archivo) => {
    mensaje('Mirando la foto con Gemini…');
    try {
      const r = await gemini('foto', { imagen: await fotoBase64(archivo), tipo: 'image/jpeg' });
      if (!r.alimentos?.length) { mensaje('No reconocí comida en la foto. Prueba más cerca o escríbelo.'); return; }
      for (const x of r.alimentos) agregar(await aAlimento(x), x.gramos);
      mensaje('Revisa las cantidades: Gemini las estima a ojo.');
    } catch (err) { mensaje(err.message); }
  };
  $('#r-foto').addEventListener('click', () => $('#r-archivo').click());
  $('#r-archivo').addEventListener('change', () => { const f = $('#r-archivo').files?.[0]; $('#r-archivo').value = ''; if (f) analizar(f); });

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
  if (op.foto) analizar(op.foto);
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
