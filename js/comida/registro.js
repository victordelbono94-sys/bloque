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
          <span id="r-paso">${varios ? 'Paso 1 de 2 · qué comiste' : 'Qué comiste'}</span>
        </div>
      </header>
      <div class="reg__cuerpo" id="r-cuerpo"></div>
      <footer class="reg__pie" id="r-pie"></footer>
    </div>`, editar ? 'Editar comida' : 'Agregar comida', { pantalla: true });
  const $ = (q) => d.querySelector(q);

  // ---------- Paso 1: qué comiste ----------
  const pintarPaso1 = () => {
    paso = 1;
    $('#r-paso').textContent = varios ? 'Paso 1 de 2 · qué comiste' : 'Qué comiste';
    $('#r-cuerpo').innerHTML = `
      <div class="chips chips--scroll reg__momentos" id="r-momento" aria-label="Momento">
        ${Object.entries(MOMENTOS).map(([v, t]) => `<button type="button" class="chip chip--mini" data-valor="${v}" aria-pressed="${v === momento}">${t}</button>`).join('')}
      </div>

      <section class="ia-caja" id="r-ia">
        <div class="ia-caja__cab">
          <span class="ia-logo" aria-hidden="true">${ICONO.chispa}</span>
          <div><strong>IA de Bloque</strong><span>Saca una foto, cuéntale qué comiste, o las dos cosas</span></div>
        </div>
        <div class="ia-foto" id="r-foto" hidden>
          <img alt="Foto del plato">
          <button type="button" class="ia-foto__quitar" id="r-foto-quitar" aria-label="Quitar la foto">${ICONO.x}</button>
        </div>
        <textarea id="r-texto" rows="2" maxlength="600" placeholder="«3 huevos en tortilla con 200 g de fideos y un café con leche»">${esc(op.texto ?? '')}</textarea>
        <div class="ia-caja__botones">
          <label class="boton boton--sec boton--chico ia-boton">${ICONO.camara}<span>Cámara</span><input type="file" id="r-camara" accept="image/*" capture="environment" hidden></label>
          <label class="boton boton--sec boton--chico ia-boton">${ICONO.galeria}<span>Galería</span><input type="file" id="r-galeria" accept="image/*" hidden></label>
          <button type="button" class="boton boton--ia" id="r-leer">${ICONO.chispa}<span>Leer</span></button>
        </div>
        <p class="ia-estado" id="r-estado" hidden></p>
      </section>

      <div class="reg__manual">
        <button type="button" class="enlace-manual" id="r-buscar-abrir">${ICONO.buscar} O agrégalo a mano: buscar o escanear</button>
        <div id="r-buscar" hidden></div>
        ${(ctx.habituales?.length || ctx.frecuentes?.length) ? `
          <div class="frecuentes" aria-label="Agregar rápido">
            ${(ctx.habituales?.length ? ctx.habituales : ctx.frecuentes).map((f, i) => `<button type="button" class="chip chip--mini" data-frec="${i}">+ ${esc(nombreCorto(f.alimento))} <span class="quieto">${esc(cantidadTexto(f.alimento, f.gramos))}</span></button>`).join('')}
          </div>` : ''}
      </div>

      <div id="r-items" class="pila" style="gap:8px"></div>
      <div class="comida-total" id="r-total"></div>
      <div class="consejo" id="r-consejo" hidden>
        <div class="consejo__meta" id="r-meta"></div>
        <div class="consejo__fila">
          <input id="r-pregunta" type="text" maxlength="200" placeholder="¿Y si le pongo leche al café? ¿Una lata de atún?" aria-label="Pregúntale a la IA">
          <button type="button" class="boton boton--sec boton--chico" id="r-preguntar">${ICONO.chispa}</button>
        </div>
        <div id="r-respuesta"></div>
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
        texto: pregunta || undefined,
        contexto: {
          objetivo: OBJETIVOS[b.info.foco]?.nombre ?? b.info.foco,
          comida: MOMENTOS[momento],
          meta_de_esta_comida: { kcal: b.meta, proteina_g: b.protMeta },
          esta_comida: items.map((it) => { const m = macros(it.alimento, it.gramos); return { nombre: it.alimento.nombre, gramos: Math.round(it.gramos), kcal: Math.round(m.kcal), proteina_g: Math.round(m.proteina) }; }),
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
          `<button type="button" class="chip chip--mini chip--sugerencia" data-sug="${k}">+ ${esc(x.cantidad || `${Math.round(x.gramos)} g`)} ${esc(x.nombre.toLowerCase())} · ${kc(x.kcal * x.gramos / 100)} kcal</button>`).join('')}</div>` : ''}`;
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
    const boton = $('#r-leer');
    boton.disabled = true;
    try {
      if (fotoPendiente) {
        mensaje(texto ? 'Mirando la foto y lo que le agregaste…' : 'Mirando la foto…', true);
        const r = await gemini('foto', { imagen: await fotoBase64(fotoPendiente), tipo: 'image/jpeg', texto: texto || undefined });
        if (!r.alimentos?.length) { mensaje('No reconocí comida en la foto. Prueba más cerca o escríbelo.'); return; }
        for (const x of r.alimentos) agregar(await aAlimento(x), x.gramos);
        quitarFoto();
        $('#r-texto').value = '';
        mensaje('Listo. Revisa las cantidades: la IA las estima a ojo.');
      } else {
        mensaje('Leyendo…', true);
        const otro = estado.personas.find((p) => p.id !== estado.yo.id);
        const r = await gemini('texto', { texto, personas: { yo: estado.yo.nombre, otro: otro?.nombre ?? null } });
        const lista = r.alimentos ?? [];
        if (!lista.length) { mensaje('No entendí comida en eso. Prueba con otras palabras o agrégalo a mano.'); return; }
        if (r.momento) { momento = r.momento; d.querySelectorAll('#r-momento [data-valor]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.valor === momento))); }
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
    d.querySelectorAll('#r-momento [data-valor]').forEach((b) => b.addEventListener('click', () => {
      momento = b.dataset.valor;
      d.querySelectorAll('#r-momento [data-valor]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      pintarMeta();
    }));
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
    const lista = ctx.habituales?.length ? ctx.habituales : ctx.frecuentes;
    d.querySelectorAll('[data-frec]').forEach((b) => b.addEventListener('click', () => { const f = lista[Number(b.dataset.frec)]; agregar(f.alimento, f.gramos); }));
    $('#r-preguntar').addEventListener('click', () => { const q = $('#r-pregunta').value.trim(); $('#r-pregunta').value = ''; aconsejar(q || `¿Qué le agrego a este ${MOMENTOS[momento].toLowerCase()} para mi objetivo?`); });
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
    $('#r-paso').textContent = 'Paso 2 de 2 · quién comió';
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
