// Pantalla Entrenos: la semana en orden, día por día. Cada entreno muestra su rutina
// (con el mapa del cuerpo), lo que registró el reloj y si ya se hizo; desde acá se agrega,
// se edita y se empieza. Abajo, todas las rutinas.
import { sincronizarAgenda } from '../nativo.js';
import { sb, estado, datos, otraPersona } from '../db.js';
import { esc, aviso, avisoError, abrirDialogo, grupoChips, valorChips } from '../ui.js';
import { hoyISO, sumarDias, inicioSemana, rangoSemana, numeroDia, diaLargo, hora } from '../fechas.js';
import { TIPOS, textoJuntos, horaEfectiva, nombreEvento, iconoEvento, textoAsistencia } from '../eventos.js';
import { OTROS, emparejar, actividad, actividadDe, minutos } from '../actividades.js';
import { FOCOS, resumenRutinas } from '../rutinas.js';
import { mapaCuerpo, chipsZonas } from '../iconos.js';
import { ICONO_RELOJ, horaLocal, datosSesion } from './hoy.js';
import { empezarSesion } from './sesion.js';
import { cargarCumplimiento, proximoDiaLibre, cargarSyncs } from '../hecho.js';
import { asistentes, htmlAsistentes, esIndividual } from '../asistentes.js';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const LAPIZ = '<svg class="icono" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>';
// Sin hora, el gym (de mañana) va antes que el derby.
const ORDEN_TIPO = { gym: 0, clase: 1, otro: 1, derby: 2, descanso: 3 };

// Entrenos es una línea de tiempo continua: abre en hoy (o en el día del link), el encabezado queda fijo
// y al llegar arriba o abajo se cargan las semanas anteriores o siguientes.
export async function vistaSemana(app) {
  const param = location.hash.split('/')[2];
  const hoy = hoyISO();
  const foco = /^\d{4}-\d{2}-\d{2}$/.test(param ?? '') ? param : hoy;
  const lunes0 = inicioSemana(foco);
  const hogar = estado.yo.hogar_id;
  const rutinas = datos(await sb.from('rutinas').select('id, nombre, foco').eq('hogar_id', hogar).order('creada_en'));
  const eventosPorId = new Map();
  const semanas = await Promise.all([sumarDias(lunes0, -7), lunes0, sumarDias(lunes0, 7)].map((l) => cargarSemana(l, rutinas, eventosPorId)));

  app.innerHTML = `
    <header class="encabezado encabezado--fijo">
      <div>
        <h1 class="titulo">Entrenos</h1>
        <p class="subtitulo" id="sem-rango">${esc(rangoSemana(lunes0))}</p>
      </div>
      <button type="button" class="boton boton--sec boton--chico" id="ir-hoy" hidden>↓ Hoy</button>
    </header>
    <div class="linea-semanas" id="semanas">
      <div class="centinela" id="cent-arriba" aria-hidden="true"></div>
      ${semanas.join('')}
      <div class="centinela" id="cent-abajo" aria-hidden="true"></div>
    </div>`;

  // Rutinas con IA: botón flotante (fuera de la vista animada para que quede fijo sobre la barra de abajo).
  document.querySelector('.fab-ia')?.remove();
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'fab-ia';
  fab.setAttribute('aria-label', 'Rutinas con IA');
  fab.innerHTML = '<svg class="icono" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg><span>Rutinas con IA</span>';
  fab.addEventListener('click', async () => {
    const { abrirEntrenador } = await import('../entrenador.js');
    abrirEntrenador({ alAplicar: () => {} });
  });
  document.body.appendChild(fab);
  const quitarFab = () => { if (!/^#\/semana/.test(location.hash)) { fab.remove(); window.removeEventListener('hashchange', quitarFab); } };
  window.addEventListener('hashchange', quitarFab);
  const cont = app.querySelector('#semanas');
  const scroller = document.getElementById('app');
  let primera = sumarDias(lunes0, -7), ultima = sumarDias(lunes0, 7), cargando = false;
  const recargarSemana = async (lunes) => {
    const viejo = cont.querySelector(`[data-lunes="${lunes}"]`);
    if (!viejo) return;
    viejo.outerHTML = await cargarSemana(lunes, rutinas, eventosPorId);
  };
  const semanaDe = (el) => el.closest('[data-lunes]')?.dataset.lunes;

  // Un solo manejador para todo (las semanas se agregan sobre la marcha).
  cont.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-agregar], [data-editar], [data-empezar], [data-recuperar], [data-copiar]');
    if (!b) return;
    const lunes = semanaDe(b);
    const listo = () => recargarSemana(lunes);
    if (b.dataset.agregar) dialogoEvento({ fecha: b.dataset.agregar }, rutinas, async (fecha) => { await listo(); if (fecha && inicioSemana(fecha) !== lunes) recargarSemana(inicioSemana(fecha)); });
    else if (b.dataset.editar) dialogoEvento(eventosPorId.get(b.dataset.editar), rutinas, listo);
    else if (b.dataset.recuperar) recuperar(eventosPorId.get(b.dataset.recuperar), rutinas, () => { listo(); recargarSemana(inicioSemana(hoy)); });
    else if (b.dataset.copiar) copiarSemana([...eventosPorId.values()].filter((x) => inicioSemana(x.fecha) === b.dataset.copiar), b.dataset.copiar);
    else if (b.dataset.empezar) {
      b.disabled = true;
      try { await empezarSesion(eventosPorId.get(b.dataset.empezar)); } catch (err) { avisoError(err); b.disabled = false; }
    }
  });

  // Semanas infinitas: arriba se agrega la anterior (sin que la vista salte), abajo la siguiente.
  const agregarArriba = async () => {
    if (cargando) return; cargando = true;
    primera = sumarDias(primera, -7);
    const html = await cargarSemana(primera, rutinas, eventosPorId);
    const alto = scroller.scrollHeight, arriba = scroller.scrollTop;
    cont.querySelector('#cent-arriba').insertAdjacentHTML('afterend', html);
    scroller.scrollTop = arriba + (scroller.scrollHeight - alto);
    cargando = false;
  };
  const agregarAbajo = async () => {
    if (cargando) return; cargando = true;
    ultima = sumarDias(ultima, 7);
    cont.querySelector('#cent-abajo').insertAdjacentHTML('beforebegin', await cargarSemana(ultima, rutinas, eventosPorId));
    cargando = false;
  };
  const obs = new IntersectionObserver((entradas) => {
    for (const en of entradas) {
      if (!en.isIntersecting) continue;
      if (en.target.id === 'cent-arriba') agregarArriba();
      else agregarAbajo();
    }
  }, { root: scroller, rootMargin: '600px 0px' });

  // El rango del encabezado sigue a la semana que se ve; «Hoy» aparece cuando hoy quedó fuera de la vista.
  const encabezado = app.querySelector('.encabezado--fijo');
  const rango = app.querySelector('#sem-rango');
  const irHoy = app.querySelector('#ir-hoy');
  const alDesplazar = () => {
    if (!app.isConnected) return scroller.removeEventListener('scroll', alDesplazar);
    const tope = scroller.getBoundingClientRect().top + encabezado.offsetHeight + 8;
    const bloques = [...cont.querySelectorAll('[data-lunes]')];
    const visible = bloques.filter((x) => x.getBoundingClientRect().top <= tope).at(-1) ?? bloques[0];
    if (visible) rango.textContent = rangoSemana(visible.dataset.lunes);
    const hoyEl = cont.querySelector('.sdia--hoy');
    if (hoyEl) {
      const r = hoyEl.getBoundingClientRect();
      const fuera = r.bottom < tope || r.top > window.innerHeight - 80;
      irHoy.hidden = !fuera;
      irHoy.textContent = r.top > window.innerHeight - 80 ? '↓ Hoy' : '↑ Hoy';
    } else irHoy.hidden = false;
  };
  const centrar = (fecha, suave = false) => {
    const el = cont.querySelector(`[data-dia="${fecha}"]`) ?? cont.querySelector('.sdia--hoy');
    if (!el) return;
    const destino = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - encabezado.offsetHeight - 8;
    scroller.scrollTo({ top: destino, behavior: suave ? 'smooth' : 'auto' });
  };
  irHoy.addEventListener('click', async () => {
    if (!cont.querySelector('.sdia--hoy')) { location.hash = '#/semana'; return; }
    centrar(hoy, true);
  });
  // Después de que la pantalla se monta (el router deja el scroll arriba), se va al día.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    centrar(foco);
    alDesplazar();
    scroller.addEventListener('scroll', alDesplazar, { passive: true });
    setTimeout(() => { obs.observe(cont.querySelector('#cent-arriba')); obs.observe(cont.querySelector('#cent-abajo')); }, 400);
  }));
  sincronizarAgenda().catch(() => {}); // los avisos de la app siguen al plan
}

// Una semana de la línea de tiempo: separador con el rango y los 7 días.
async function cargarSemana(lunes, rutinas, eventosPorId) {
  const domingo = sumarDias(lunes, 6);
  const hoy = hoyISO();
  const hogar = estado.yo.hogar_id;
  const [eventos, bandaTodos, syncs] = await Promise.all([
    sb.from('calendario').select('*').eq('hogar_id', hogar).gte('fecha', lunes).lte('fecha', domingo)
      .order('fecha').order('hora_inicio', { nullsFirst: true }).then(datos),
    sb.from('sesiones_banda').select('persona_id, inicio, fin, tipo, calorias, calorias_estimadas, fc_promedio, confirmado').or('confirmado.is.null,confirmado.neq.nada').in('persona_id', estado.personas.map((p) => p.id))
      .gte('inicio', new Date(`${lunes}T00:00:00`).toISOString())
      .lt('inicio', new Date(`${sumarDias(domingo, 1)}T00:00:00`).toISOString()).order('inicio').then(datos),
    cargarSyncs(),
  ]);
  for (const e of eventos) eventosPorId.set(e.id, e);
  const banda = bandaTodos.filter((s) => s.persona_id === estado.yo.id);
  eventos.sort((a, b) => a.fecha.localeCompare(b.fecha) || horaEfectiva(a).localeCompare(horaEfectiva(b)) || ORDEN_TIPO[a.tipo] - ORDEN_TIPO[b.tipo]);
  const conRutina = eventos.filter((e) => e.rutina_id);
  const [sesiones, resumen, cumplido] = await Promise.all([
    conRutina.length ? sb.from('sesiones').select('id, calendario_id, terminados, terminada_en').in('calendario_id', conRutina.map((e) => e.id)).then(datos) : [],
    resumenRutinas([...new Set(conRutina.map((e) => e.rutina_id))]),
    cargarCumplimiento(eventos, estado.yo.id),
  ]);
  const ctx = { hoy, rutinas, sesiones, resumen, cumplido, bandaTodos, syncs };
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
  const estaSemana = lunes === inicioSemana(hoy);
  return `
    <section class="semana-bloque" data-lunes="${lunes}">
      <div class="semana-sep">
        <span>${estaSemana ? 'Esta semana · ' : ''}${esc(rangoSemana(lunes))}</span>
        ${eventos.length ? `<button type="button" class="enlace-chico" data-copiar="${lunes}">Repetir en la siguiente</button>` : ''}
      </div>
      <div class="semana">
        ${dias.map((d) => htmlDia(d, eventos.filter((e) => e.fecha === d), banda.filter((s) => fechaLocal(s.inicio) === d), ctx)).join('')}
      </div>
    </section>`;
}

// Un entreno que no se hizo: pasarlo a otro día (desde hoy) o dejarlo.
export async function recuperar(ev, rutinas, alListo) {
  const hoy = hoyISO();
  const proximos = datos(await sb.from('calendario').select('*').eq('hogar_id', estado.yo.hogar_id)
    .gte('fecha', hoy).lte('fecha', sumarDias(hoy, 7)));
  const sugerido = proximoDiaLibre(proximos, hoy);
  const nombre = rutinas.find((r) => r.id === ev.rutina_id)?.nombre ?? nombreEvento(ev);
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(hoy, i));
  const d = abrirDialogo(`
    <div class="dialogo">
      <h2 class="tarjeta__titulo">Recuperar ${esc(nombre)}</h2>
      <p class="quieto" style="margin:-8px 0 0">Quedó pendiente del ${esc(diaLargo(ev.fecha).toLowerCase())}. ¿Qué día la hacen?</p>
      <div class="dias-elegir">
        ${dias.map((f) => {
          const ese = proximos.filter((e) => e.fecha === f && !e.omitido);
          const txt = ese.length ? ese.map((e) => nombreEvento(e)).join(' + ') : 'Libre';
          return `<button type="button" class="dia-elegir" data-dia="${f}" aria-pressed="${f === sugerido}">
            <strong>${f === hoy ? 'Hoy' : esc(DIAS[new Date(`${f}T12:00`).getDay()])} ${numeroDia(f)}</strong>
            <span>${esc(txt)}</span>
          </button>`;
        }).join('')}
      </div>
      <div class="dialogo__pie">
        <button type="button" class="boton boton--texto" id="omitir" style="margin-right:auto">No recuperar</button>
        <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
        <button type="button" class="boton" id="mover">Pasar ahí</button>
      </div>
    </div>`, 'Recuperar entreno');
  let elegido = sugerido;
  d.querySelectorAll('[data-dia]').forEach((b) => b.addEventListener('click', () => {
    elegido = b.dataset.dia;
    d.querySelectorAll('[data-dia]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  d.querySelector('#mover').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      datos(await sb.from('calendario').update({ fecha: elegido, omitido: false }).eq('id', ev.id));
      d.close();
      aviso(`${nombre} pasó al ${diaLargo(elegido).toLowerCase()}.`);
      alListo();
    } catch (err) { avisoError(err); e.currentTarget.disabled = false; }
  });
  d.querySelector('#omitir').addEventListener('click', async () => {
    try {
      datos(await sb.from('calendario').update({ omitido: true }).eq('id', ev.id));
      d.close();
      aviso('Listo, no se recupera.');
      alListo();
    } catch (err) { avisoError(err); }
  });
}

const fechaLocal = (iso) => {
  const f = new Date(iso);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
};

// Un día: su encabezado, lo agendado y lo que registró el reloj, en orden de hora.
function htmlDia(d, delDia, bandaDia, ctx) {
  const pasado = d < ctx.hoy, esHoy = d === ctx.hoy;
  const mios = delDia.filter((e) => e.asistencia === 'juntos' || e.persona_id === estado.yo.id);
  const { pares, sueltas } = emparejar(mios, bandaDia);
  const pasos = delDia.map((e) => ({ orden: horaEfectiva(e), html: htmlEntreno(e, ctx, pares.get(e), { pasado, esHoy, delDia }) }));
  const caminatas = sueltas.filter((s) => s.tipo === 'caminar');
  for (const s of sueltas.filter((x) => x.tipo !== 'caminar')) {
    pasos.push({ orden: horaLocal(s.inicio), html: htmlReloj(actividadDe(s).nombre, actividadDe(s).icono, horaLocal(s.inicio), datosSesion(s)) });
  }
  if (caminatas.length) {
    const a = actividad('caminar');
    const min = caminatas.reduce((t, s) => t + minutos(s), 0);
    const kcal = caminatas.reduce((t, s) => t + (s.calorias ?? 0), 0);
    pasos.push({ orden: horaLocal(caminatas[0].inicio), html: htmlReloj(caminatas.length > 1 ? a.plural : a.nombre, a.icono, '', [`${min} min`, kcal ? `${kcal} kcal` : null].filter(Boolean).join(' · ')) });
  }
  pasos.sort((x, y) => x.orden.localeCompare(y.orden));
  const f = new Date(`${d}T12:00`);
  return `
    <section class="sdia ${esHoy ? 'sdia--hoy' : ''} ${pasado ? 'sdia--pasado' : ''}" data-dia="${d}" aria-label="${esc(diaLargo(d))}">
      <header class="sdia__cab">
        <span class="sdia__num">${numeroDia(d)}</span>
        <span class="sdia__nombre">${esc(DIAS[f.getDay()])}</span>
        ${esHoy ? '<span class="sello-hoy"><span class="sello-hoy__punto" aria-hidden="true"></span>Hoy</span>' : ''}
        <button type="button" class="sdia__agregar" data-agregar="${d}" aria-label="Agregar entreno el ${esc(diaLargo(d))}">+ Agregar</button>
      </header>
      ${pasos.length ? `<ol class="plan">${pasos.map((p) => p.html).join('')}</ol>` : `<p class="sdia__libre">${pasado ? 'Nada registrado' : 'Libre'}</p>`}
    </section>`;
}

// Un entreno agendado. Tocar el título edita; la rutina abre sus ejercicios.
// En días pasados se ve compacto: qué fue y si se hizo.
function htmlEntreno(ev, { hoy, rutinas, sesiones, resumen, cumplido, bandaTodos, syncs }, reloj, { pasado, esHoy, delDia }) {
  // Derby y otros: cada uno va por su cuenta; se muestra quién fue según su reloj.
  const individual = esIndividual(ev) && estado.personas.length > 1;
  const quienes = individual ? asistentes(ev, delDia, bandaTodos, syncs) : null;
  const rutina = rutinas.find((r) => r.id === ev.rutina_id);
  const sesion = rutina ? (sesiones.find((s) => s.calendario_id === ev.id && !s.terminada_en) ?? sesiones.find((s) => s.calendario_id === ev.id)) : null;
  const cumple = cumplido(ev);
  const hecho = cumple === 'hecho';
  const voy = ev.asistencia === 'juntos' || ev.persona_id === estado.yo.id;
  const detalle = [individual ? null : textoAsistencia(ev), ev.notas].filter(Boolean).join(' · ');
  let estadoTxt = '';
  if (individual) estadoTxt = '';
  else if (hecho) estadoTxt = '<span class="hecho">✓ Hecho</span>';
  else if (cumple === 'no_hecho') estadoTxt = ev.omitido ? '<span class="quieto">No fuiste</span>' : '<span class="no-hecho">No fuiste</span>';

  let extra = '';
  if (rutina) {
    const zonas = resumen[rutina.id]?.zonas ?? [];
    let accion = '';
    if (sesion) accion = `<a class="boton ${hecho ? 'boton--sec' : ''} boton--chico boton--bloque" href="#/sesion/${esc(sesion.id)}">${hecho ? 'Ver entreno' : voy ? 'Continuar entreno' : 'Ver entreno'}</a>`;
    else if (esHoy && voy) accion = `<button type="button" class="boton boton--chico boton--bloque" data-empezar="${esc(ev.id)}">Empezar entreno</button>`;
    extra = `
      <a class="plan__rutina ${pasado ? 'plan__rutina--chica' : ''}" href="#/entreno/${esc(rutina.id)}" aria-label="Ver rutina ${esc(rutina.nombre)}">
        <span class="plan__rutina-texto">
          <strong>${esc(rutina.nombre)}</strong>
          ${zonas.length && !pasado ? chipsZonas(zonas) : ''}
        </span>
        ${zonas.length ? mapaCuerpo(zonas, { alto: pasado ? 40 : 64 }) : ''}
        <span class="plan__flecha" aria-hidden="true">›</span>
      </a>
      ${accion}`;
  }
  return `
    <li class="plan__item">
      <span class="plan__icono plan__icono--${esc(ev.tipo)}">${iconoEvento(ev)}</span>
      <div class="plan__cuerpo">
        <button type="button" class="plan__editable" data-editar="${esc(ev.id)}" aria-label="Editar ${esc(nombreEvento(ev))}">
          <span class="plan__titulo">
            <strong>${esc(nombreEvento(ev))}</strong>
            <span class="plan__hora">${ev.hora_inicio ? esc(hora(ev.hora_inicio)) : ''}<span class="plan__lapiz">${LAPIZ}</span></span>
          </span>
          ${detalle || estadoTxt ? `<span class="plan__detalle">${[detalle ? esc(detalle) : '', estadoTxt].filter(Boolean).join(' · ')}</span>` : ''}
        </button>
        ${individual ? htmlAsistentes(quienes) : reloj ? `<span class="plan__reloj">${ICONO_RELOJ}<span>Registrado · ${esc(datosSesion(reloj))}</span></span>` : ''}
        ${extra}
        ${cumple === 'no_hecho' && !ev.omitido && ev.tipo === 'gym' && ev.fecha >= sumarDias(hoy, -7)
          ? `<button type="button" class="boton boton--sec boton--chico" data-recuperar="${esc(ev.id)}">Recuperar este entreno</button>` : ''}
      </div>
    </li>`;
}

// Algo que registró el reloj sin estar agendado.
function htmlReloj(nombre, icono, horaTxt, detalle) {
  return `
    <li class="plan__item plan__item--reloj">
      <span class="plan__icono plan__icono--reloj">${icono}</span>
      <div class="plan__cuerpo">
        <div class="plan__titulo">
          <strong>${esc(nombre)}</strong>
          ${horaTxt ? `<span class="plan__hora">${esc(horaTxt)}</span>` : ''}
        </div>
        <span class="plan__reloj">${ICONO_RELOJ}<span>Del reloj · ${esc(detalle)}</span></span>
      </div>
    </li>`;
}

function dialogoEvento(ev, rutinas, alGuardar) {
  const nuevo = !ev.id;
  const otro = otraPersona();
  const asistenciaActual = ev.asistencia === 'solo' ? ev.persona_id : 'juntos';
  const tipoActual = ev.tipo === 'clase' ? 'otro' : ev.tipo ?? 'gym';
  const actividadActual = ev.actividad ?? (ev.tipo === 'clase' ? 'clase' : null);

  const d = abrirDialogo(`
    <form class="dialogo" method="dialog">
      <h2 class="tarjeta__titulo">${nuevo ? 'Agregar' : 'Editar'} · ${esc(diaLargo(ev.fecha))}</h2>

      <fieldset class="campo" aria-label="Tipo de actividad">
        <div class="chips" id="tipo">
          ${Object.entries(TIPOS).map(([v, t]) => `<button type="button" class="chip" data-valor="${v}" aria-pressed="${v === tipoActual}">${t}</button>`).join('')}
        </div>
      </fieldset>

      <fieldset class="campo" id="campo-actividad" aria-label="Qué entreno">
        <div class="chips" id="actividad">
          ${OTROS.map((o) => `<button type="button" class="chip chip--icono" data-valor="${o.clave}" aria-pressed="${o.clave === actividadActual}">${o.icono}${esc(o.nombre)}</button>`).join('')}
        </div>
      </fieldset>

      <div class="campo" id="campo-rutina">
        <label for="rutina">Rutina</label>
        <select id="rutina">
          <option value="">Sin rutina</option>
          ${rutinas.map((r) => `<option value="${esc(r.id)}" ${r.id === ev.rutina_id ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')}
        </select>
      </div>

      <div class="campo">
        <label for="hora">Hora</label>
        <input id="hora" type="time" value="${esc(hora(ev.hora_inicio))}">
      </div>

      <fieldset class="campo" id="campo-asistencia" aria-label="Quién va">
        <div class="chips" id="asistencia">
          <button type="button" class="chip" data-valor="juntos" aria-pressed="${asistenciaActual === 'juntos'}">${esc(textoJuntos())}</button>
          <button type="button" class="chip" data-valor="${esc(estado.yo.id)}" aria-pressed="${asistenciaActual === estado.yo.id}">Solo yo</button>
          ${otro ? `<button type="button" class="chip" data-valor="${esc(otro.id)}" aria-pressed="${asistenciaActual === otro.id}">Solo ${esc(otro.nombre)}</button>` : ''}
        </div>
      </fieldset>

      <div class="campo">
        <label for="notas">Notas</label>
        <input id="notas" type="text" maxlength="120" placeholder="Opcional" value="${esc(ev.notas ?? '')}">
      </div>

      <div class="dialogo__pie">
        ${nuevo ? '' : '<button type="button" class="boton boton--peligro" id="borrar" style="margin-right:auto">Eliminar</button>'}
        <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
        <button type="submit" class="boton" id="guardar">Guardar</button>
      </div>
    </form>`, nuevo ? 'Agregar al calendario' : 'Editar evento', { pantalla: true });

  const tipo = d.querySelector('#tipo');
  const asistencia = d.querySelector('#asistencia');
  const campoAsistencia = d.querySelector('#campo-asistencia');
  const campoRutina = d.querySelector('#campo-rutina');
  const actividadEl = d.querySelector('#actividad');
  const campoActividad = d.querySelector('#campo-actividad');
  const mostrarAsistencia = (t) => {
    campoAsistencia.hidden = t === 'descanso' || estado.personas.length < 2;
    campoRutina.hidden = t !== 'gym';
    campoActividad.hidden = t !== 'otro';
  };
  grupoChips(tipo, mostrarAsistencia);
  grupoChips(asistencia);
  grupoChips(actividadEl);
  mostrarAsistencia(tipoActual);

  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = valorChips(tipo);
    const act = t === 'otro' ? valorChips(actividadEl) : null;
    if (t === 'otro' && !act) return aviso('Elige qué entreno es.', 'error');
    const a = t === 'descanso' ? 'juntos' : valorChips(asistencia);
    const fila = {
      hogar_id: estado.yo.hogar_id,
      fecha: ev.fecha,
      tipo: t,
      hora_inicio: d.querySelector('#hora').value || null,
      asistencia: a === 'juntos' ? 'juntos' : 'solo',
      persona_id: a === 'juntos' ? null : a,
      notas: d.querySelector('#notas').value.trim() || null,
      rutina_id: t === 'gym' ? d.querySelector('#rutina').value || null : null,
      actividad: act,
    };
    const boton = d.querySelector('#guardar');
    boton.disabled = true;
    try {
      if (nuevo) datos(await sb.from('calendario').insert(fila));
      else datos(await sb.from('calendario').update(fila).eq('id', ev.id));
      d.close();
      aviso('Calendario actualizado.');
      alGuardar();
    } catch (err) {
      avisoError(err);
      boton.disabled = false;
    }
  });

  d.querySelector('#borrar')?.addEventListener('click', async () => {
    try {
      datos(await sb.from('calendario').delete().eq('id', ev.id));
      d.close();
      aviso('Eliminado.');
      alGuardar();
    } catch (err) {
      avisoError(err);
    }
  });
}

function copiarSemana(eventos, lunes) {
  const siguiente = sumarDias(lunes, 7);
  const d = abrirDialogo(`
    <div class="dialogo">
      <h2 class="tarjeta__titulo">Repetir la semana</h2>
      <p>Se copian los ${eventos.length} eventos de esta semana a la del ${esc(rangoSemana(siguiente))}. Lo que ya esté agendado allá se mantiene.</p>
      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
        <button type="button" class="boton" id="confirmar">Repetir</button>
      </div>
    </div>`, 'Repetir la semana');

  const confirmar = d.querySelector('#confirmar');
  confirmar.addEventListener('click', async () => {
    confirmar.disabled = true;
    try {
      const existentes = await sb.from('calendario').select('fecha, tipo, hora_inicio')
        .eq('hogar_id', estado.yo.hogar_id).gte('fecha', siguiente).lte('fecha', sumarDias(siguiente, 6)).then(datos);
      const clave = (x) => `${x.fecha}|${x.tipo}|${x.hora_inicio ?? ''}`;
      const ya = new Set(existentes.map(clave));
      const copias = eventos
        .map(({ id, ...resto }) => ({ ...resto, fecha: sumarDias(resto.fecha, 7) }))
        .filter((x) => !ya.has(clave(x)));
      if (copias.length) datos(await sb.from('calendario').insert(copias));
      d.close();
      aviso(copias.length ? `Listo: ${copias.length} eventos copiados.` : 'La semana siguiente ya tenía todo.');
      location.hash = `#/semana/${siguiente}`; // la navegación vuelve a cargar la vista
    } catch (err) {
      avisoError(err);
      confirmar.disabled = false;
    }
  });
}
