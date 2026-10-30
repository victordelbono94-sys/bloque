// Pantalla Hoy: qué toca, cómo está cada uno y su última medición.
import { IC } from '../iconos.js';
import { sb, estado, datos } from '../db.js';
import { esc, num, aviso, avisoError, grupoChips, valorChips, cara } from '../ui.js';
import { hoyISO, sumarDias, diaLargo, diaCorto, numeroDia, fechaCorta, hora } from '../fechas.js';
import { TIPOS, horaEfectiva, textoAsistencia, nombreEvento, iconoEvento } from '../eventos.js';
import { iconoTipo, mapaCuerpo, chipsZonas } from '../iconos.js';
import { resumenRutinas } from '../rutinas.js';
import { actividad, actividadDe, emparejar, minutos, porConfirmar } from '../actividades.js';
import { calcularSemaforo, esDescanso, textoSemaforo } from '../semaforo.js';
import { empezarSesion } from './sesion.js';
import { cargarCumplimiento, cargarSyncs } from '../hecho.js';
import { queFalta } from '../plan.js';
import { resumenComidaHoy } from './comida.js';
import { litros } from '../hidratacion.js';
import { abrirDialogo } from '../ui.js';
import { asistentes, htmlAsistentes, esIndividual } from '../asistentes.js';
import { recuperar } from './semana.js';
import { cargarPorConfirmar, htmlPorConfirmar, conectarPorConfirmar } from '../confirmar.js';

export async function vistaHoy(app) {
  const hoy = hoyISO();
  const ayer = sumarDias(hoy, -1);
  const hogar = estado.yo.hogar_id;
  const ids = estado.personas.map((p) => p.id);

  const desdeAyer = new Date(`${ayer}T00:00:00`).toISOString();
  const porConfirmarP = cargarPorConfirmar().catch(() => []);
  const [eventos, estados, mediciones, extrasTodos, actividadDia, entrenosBanda] = await Promise.all([
    sb.from('calendario').select('*').eq('hogar_id', hogar)
      .gte('fecha', ayer).lte('fecha', sumarDias(hoy, 7))
      .order('fecha').order('hora_inicio', { nullsFirst: true }).then(datos),
    sb.from('estado_diario').select('*').in('persona_id', ids).eq('fecha', hoy).then(datos),
    sb.from('mediciones_corporales').select('persona_id, medido_en, peso_kg, grasa_pct, masa_muscular_kg')
      .in('persona_id', ids).order('medido_en', { ascending: false }).limit(40).then(datos),
    sb.from('actividades_extra').select('*').in('persona_id', ids).eq('fecha', ayer).then(datos),
    sb.from('actividad_diaria').select('*').in('persona_id', ids).in('fecha', [ayer, hoy]).then(datos),
    sb.from('sesiones_banda').select('persona_id, inicio, fin, tipo, calorias, calorias_estimadas, fc_promedio, confirmado').or('confirmado.is.null,confirmado.neq.nada')
      .in('persona_id', ids).gte('inicio', desdeAyer).order('inicio').then(datos),
  ]);
  // Datos de la banda por persona: hoy (pasos, calorías), anoche (sueño) y entrenos de ayer.
  const banda = (personaId) => {
    const deHoyB = actividadDia.find((a) => a.persona_id === personaId && a.fecha === hoy);
    const deAyerB = actividadDia.find((a) => a.persona_id === personaId && a.fecha === ayer);
    const entrenos = entrenosBanda.filter((s) => s.persona_id === personaId);
    const inicioHoy = new Date(`${hoy}T00:00:00`).getTime();
    return {
      hoy: deHoyB,
      ayer: deAyerB,
      suenoMin: deHoyB?.sueno_min ?? null,
      entrenosHoy: entrenos.filter((s) => new Date(s.inicio).getTime() >= inicioHoy),
      entrenosAyer: entrenos.filter((s) => new Date(s.inicio).getTime() < inicioHoy),
    };
  };

  // Sin hora, el gym (de mañana) va antes que el derby.
  const ORDEN_TIPO = { gym: 0, clase: 1, otro: 1, derby: 2, descanso: 3 };
  eventos.sort((x, y) => x.fecha.localeCompare(y.fecha)
    || horaEfectiva(x).localeCompare(horaEfectiva(y))
    || ORDEN_TIPO[x.tipo] - ORDEN_TIPO[y.tipo]);
  const deHoy = eventos.filter((e) => e.fecha === hoy);
  // Lo de ayer que no se hizo no cansa: el semáforo de cada uno solo cuenta lo cumplido.
  const pasados = datos(await sb.from('calendario').select('*').eq('hogar_id', hogar)
    .gte('fecha', sumarDias(hoy, -7)).lt('fecha', ayer).eq('tipo', 'gym').not('rutina_id', 'is', null));
  const todosAyer = eventos.filter((e) => e.fecha === ayer);
  const cumplidoDe = Object.fromEntries(await Promise.all(estado.personas.map(async (p) =>
    [p.id, await cargarCumplimiento([...pasados, ...todosAyer], p.id)])));
  const ayerDe = (personaId) => todosAyer.filter((e) => cumplidoDe[personaId](e) !== 'no_hecho');
  const deAyer = ayerDe(estado.yo.id);
  const [syncs, falta, comidaHoy] = await Promise.all([cargarSyncs(), queFalta().catch(() => []), resumenComidaHoy().catch(() => null)]);
  const quienesDe = (ev) => asistentes(ev, deHoy, entrenosBanda, syncs);
  // Gyms de la última semana que no hice y siguen sin recuperar.
  const pendientes = [...pasados, ...todosAyer].filter((e) => e.tipo === 'gym' && e.rutina_id && !e.omitido && cumplidoDe[estado.yo.id](e) === 'no_hecho');
  const porConfirmarLista = await porConfirmarP;

  // Rutinas del día y entrenos ya empezados.
  const proximo = eventos.find((e) => e.fecha > hoy && e.tipo !== 'descanso');
  const conRutina = deHoy.filter((e) => e.rutina_id);
  const idsRutinas = [...new Set([...conRutina.map((e) => e.rutina_id), proximo?.rutina_id, ...pendientes.map((e) => e.rutina_id)].filter(Boolean))];
  const [rutinas, sesiones] = idsRutinas.length ? await Promise.all([
    sb.from('rutinas').select('id, nombre, foco').in('id', idsRutinas).then(datos),
    sb.from('sesiones').select('id, calendario_id, terminados, terminada_en').in('calendario_id', conRutina.map((e) => e.id)).then(datos),
  ]) : [[], []];
  const resumen = await resumenRutinas(conRutina.map((e) => e.rutina_id));
  // Las rutinas de los días de derby son livianas a propósito: el semáforo lo tiene en cuenta.
  for (const e of deHoy) e.liviana = rutinas.find((r) => r.id === e.rutina_id)?.foco === 'recuperacion';
  const rutinaProxima = rutinas.find((r) => r.id === proximo?.rutina_id);
  const mia = banda(estado.yo.id);
  const extrasAyer = extrasTodos.filter((x) => x.persona_id === estado.yo.id);
  const contexto = { hoy, deAyer, deHoy, extrasAyer, suenoMin: mia.suenoMin, bandaAyer: mia.entrenosAyer, bandaHoy: mia.entrenosHoy };
  // Semáforo de cualquiera con lo que se sabe (sin check-in, sale estimado).
  const semaforoDe = (personaId, est) => {
    const b = banda(personaId);
    return calcularSemaforo({
      cansancio: est?.cansancio ?? null, dolor: est?.dolor_muscular ?? null, ayer: ayerDe(personaId), hoy: deHoy,
      extrasAyer: extrasTodos.filter((x) => x.persona_id === personaId), personaId,
      suenoMin: b.suenoMin, bandaAyer: b.entrenosAyer, bandaHoy: b.entrenosHoy,
    });
  };

  // El semáforo se recalcula al abrir Hoy: pueden haber llegado datos de la banda
  // o cambiado el plan desde el check-in. Solo se guarda si cambió.
  const mio = estados.find((e) => e.persona_id === estado.yo.id);
  if (mio && (mio.cansancio != null || mio.dolor_muscular != null)) {
    const r = semaforoDe(estado.yo.id, mio);
    if (r.semaforo !== mio.semaforo || r.motivo !== mio.motivo) {
      const { error } = await sb.from('estado_diario')
        .update({ ...r, calculado_en: new Date().toISOString() })
        .eq('persona_id', estado.yo.id).eq('fecha', hoy);
      if (!error) Object.assign(mio, r);
    }
  }

  let verId = null;
  try { verId = sessionStorage.getItem('bloque-hoy-ver'); } catch { /* nada */ }
  const personaVista = estado.personas.find((p) => p.id === verId) ?? estado.yo;
  app.innerHTML = `
    <header class="encabezado encabezado--fijo">
      <div>
        <h1 class="titulo">Hoy</h1>
        <p class="subtitulo">${esc(diaLargo(hoy))}</p>
      </div>
      <a class="avatar" href="#/perfil" aria-label="Perfil y ajustes">${cara(estado.yo)}</a>
    </header>

    ${falta.length ? `
      <a class="tarjeta completar-aviso" href="#/completar">
        <span class="completar-aviso__icono" aria-hidden="true">✦</span>
        <span><strong>Completa tu perfil</strong><span class="quieto">${falta.includes('plan') ? 'Faltan datos para armar tus rutinas y tu agenda.' : 'Faltan datos para calcular bien tus calorías.'} Toma 2 minutos.</span></span>
        <span class="plan__flecha" aria-hidden="true">›</span>
      </a>` : ''}

    <div id="por-confirmar" class="pila" style="gap:12px">${htmlPorConfirmar(porConfirmarLista)}</div>
    ${[1, 2].includes(new Date().getDay()) ? `
      <button type="button" class="tarjeta semana-aviso" id="ver-semana">
        <span class="semana-aviso__icono" aria-hidden="true">${IC.grafico}</span>
        <span><strong>Tu resumen de la semana</strong><span class="quieto">Peso, calorías, proteína, entrenos y sueño, con 3 cambios para esta semana.</span></span>
        <span class="plan__flecha" aria-hidden="true">›</span>
      </button>` : ''}
    ${htmlCuerpoPendiente(mediciones.filter((m) => m.persona_id === estado.yo.id))}

    <section class="tarjeta" aria-labelledby="plan-hoy">
      ${pendientes.map((e) => `
        <div class="pendiente">
          <span class="pendiente__texto"><strong>${esc(rutinas.find((r) => r.id === e.rutina_id)?.nombre ?? 'Gym')}</strong> quedó pendiente del ${esc(diaCorto(e.fecha))} ${numeroDia(e.fecha)}</span>
          <button type="button" class="boton boton--chico" data-recuperar="${esc(e.id)}">Recuperar</button>
        </div>`).join('')}
      <div class="fila fila--entre" style="margin-bottom:6px">
        <h2 class="seccion__titulo" id="plan-hoy" style="margin:0">Plan de hoy</h2>
        <a class="enlace-chico" href="#/semana">Ver semana ›</a>
      </div>
      ${deHoy.length || mia.entrenosHoy.length
        ? `<ol class="plan">${lineaDeTiempo(deHoy, mia.entrenosHoy, rutinas, sesiones, resumen, quienesDe)}</ol>`
        : `<p class="vacio" style="padding-top:4px">No hay nada agendado. ¿Qué hacen hoy?</p>
           <div class="chips" id="rapido">
             ${Object.entries(TIPOS).filter(([v]) => v !== 'otro').map(([v, t]) => `<button type="button" class="chip chip--icono" data-valor="${v}">${iconoTipo(v)}${t}</button>`).join('')}
             <a class="chip chip--icono" href="#/semana" style="text-decoration:none;display:inline-flex;align-items:center">${iconoTipo('otro')}Otro…</a>
           </div>`}
      ${proximo ? `<p class="plan__proximo"><span class="quieto">Después</span> ${iconoEvento(proximo)} <strong>${esc(rutinaProxima?.nombre ?? nombreEvento(proximo))}</strong> <span class="quieto">${esc(diaCorto(proximo.fecha))} ${numeroDia(proximo.fecha)}${proximo.hora_inicio ? ` · ${esc(hora(proximo.hora_inicio))}` : ''}</span></p>` : ''}
    </section>

    ${htmlNumerosHoy(comidaHoy, mia)}

    <section class="seccion" aria-labelledby="como-titulo">
      <div class="fila fila--entre como-cabeza">
        <h2 class="seccion__titulo" id="como-titulo" style="margin:0">${esc(personaVista.id === estado.yo.id ? 'Cómo estoy' : `Cómo está ${personaVista.nombre}`)}</h2>
      </div>
      ${estado.personas.length > 1 ? `
        <div class="ver-persona" role="tablist" aria-label="De quién ver el semáforo">
          ${estado.personas.map((p) => {
            const est = estados.find((e) => e.persona_id === p.id);
            const sem = (est && (est.cansancio != null || est.dolor_muscular != null) ? est : semaforoDe(p.id, est))?.semaforo;
            return `<button type="button" class="ver-persona__op" role="tab" data-ver-como="${esc(p.id)}" aria-selected="${p.id === personaVista.id}">
              <span class="ver-persona__cara">${cara(p)}</span><span>${esc(p.id === estado.yo.id ? 'Yo' : p.nombre)}</span>
              ${sem ? `<span class="punto punto--${sem}" aria-label="Semáforo ${sem}"></span>` : ''}
            </button>`;
          }).join('')}
        </div>` : ''}
      ${estado.personas.map((p) => `<div class="como-persona" data-persona-como="${esc(p.id)}" ${p.id === personaVista.id ? '' : 'hidden'}>
        ${tarjetaPersona(p, estados.find((e) => e.persona_id === p.id), mediciones.find((m) => m.persona_id === p.id), esDescanso(deHoy, p.id), banda(p.id), semaforoDe)}
        <div class="como-molestias" data-molestias="${esc(p.id)}"></div>
      </div>`).join('')}
    </section>`;
  // Cambiar de persona: se muestra su semáforo y sus datos (se recuerda mientras la app esté abierta).
  app.querySelectorAll('[data-ver-como]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.verComo;
    try { sessionStorage.setItem('bloque-hoy-ver', id); } catch { /* nada */ }
    app.querySelectorAll('[data-ver-como]').forEach((o) => o.setAttribute('aria-selected', String(o === b)));
    app.querySelectorAll('[data-persona-como]').forEach((c) => {
      const ver = c.dataset.personaComo === id;
      c.hidden = !ver;
      if (ver) { c.classList.remove('fundido'); void c.offsetWidth; c.classList.add('fundido'); }
    });
    const p = estado.personas.find((x) => x.id === id);
    app.querySelector('#como-titulo').textContent = p.id === estado.yo.id ? 'Cómo estoy' : `Cómo está ${p.nombre}`;
  }));

  conectarPendientes(app, () => vistaHoy(app));
  conectarPorConfirmar(app.querySelector('#por-confirmar'), porConfirmarLista, () => vistaHoy(app));
  app.querySelector('#ver-semana')?.addEventListener('click', async () => (await import('../semanal.js')).abrirResumenSemanal());
  // Molestias o lesiones de cada uno (las tuyas se marcan y se cierran desde acá).
  import('../molestias.js').then(async (M) => {
    for (const cont of app.querySelectorAll('[data-molestias]')) {
      const id = cont.dataset.molestias, propio = id === estado.yo.id;
      cont.innerHTML = M.htmlMolestias(await M.cargarMolestias(id), { propio });
      if (propio) M.conectarMolestias(cont, () => vistaHoy(app));
    }
  });
  conectarCheckIn(app, contexto, estados.find((e) => e.persona_id === estado.yo.id));
  conectarRapido(app, hoy);
  if (falta.length) avisarPerfil(falta);
  app.querySelectorAll('[data-recuperar]').forEach((b) => b.addEventListener('click', () =>
    recuperar(pendientes.find((e) => e.id === b.dataset.recuperar), rutinas, () => vistaHoy(app))));
  app.querySelectorAll('[data-empezar]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await empezarSesion(deHoy.find((e) => e.id === b.dataset.empezar));
    } catch (err) {
      avisoError(err);
      b.disabled = false;
    }
  }));
}

export const ICONO_RELOJ = '<svg class="icono" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6" width="11" height="12" rx="3.5"/><path d="M9 6l.6-3h4.8l.6 3M9 18l.6 3h4.8l.6-3M12 9.5V12l1.6 1.2"/></svg>';
export const horaLocal = (iso) => new Date(iso).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false });

export function datosSesion(s) {
  const min = minutos(s);
  return [min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`,
    s.calorias != null ? `${s.calorias_estimadas ? '≈ ' : ''}${s.calorias} kcal` : null, s.fc_promedio ? `${s.fc_promedio} ppm` : null].filter(Boolean).join(' · ');
}

// Plan y reloj juntos, en orden de hora. Lo que el reloj registró y coincide con algo
// agendado se marca en ese paso; lo demás aparece como actividad propia (las caminatas, juntas).
function lineaDeTiempo(deHoy, entrenosHoy, rutinas, sesiones, resumen, quienesDe) {
  const mios = deHoy.filter((e) => e.asistencia === 'juntos' || e.persona_id === estado.yo.id);
  const { pares, sueltas } = emparejar(mios, entrenosHoy);
  const pasos = deHoy.map((e) => ({ orden: horaEfectiva(e), html: htmlPlan(e, rutinas, sesiones, resumen, pares.get(e), quienesDe) }));
  const caminatas = sueltas.filter((s) => s.tipo === 'caminar');
  const otras = sueltas.filter((s) => s.tipo !== 'caminar');
  for (const s of otras) pasos.push({ orden: horaLocal(s.inicio), html: htmlActividad(actividadDe(s).nombre, actividadDe(s).icono, horaLocal(s.inicio), datosSesion(s)) });
  if (caminatas.length) {
    const total = { inicio: null, fin: null, calorias: caminatas.reduce((a, s) => a + (s.calorias ?? 0), 0) || null };
    const min = caminatas.reduce((a, s) => a + minutos(s), 0);
    const texto = [`${min} min${caminatas.length > 1 ? ' en total' : ''}`, total.calorias ? `${total.calorias} kcal` : null].filter(Boolean).join(' · ');
    const a = actividad('caminar');
    pasos.push({ orden: horaLocal(caminatas[0].inicio), html: htmlActividad(caminatas.length > 1 ? a.plural : a.nombre, a.icono, caminatas.length > 1 ? '' : horaLocal(caminatas[0].inicio), texto) });
  }
  return pasos.sort((x, y) => x.orden.localeCompare(y.orden)).map((p) => p.html).join('');
}

// Algo que hiciste y registró el reloj sin estar agendado.
function htmlActividad(nombre, icono, horaTxt, detalle) {
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

// Un evento del plan como paso de la línea de tiempo; el gym trae su rutina y el botón para entrenar.
function htmlPlan(ev, rutinas, sesiones, resumen, reloj, quienesDe) {
  const rutina = rutinas.find((r) => r.id === ev.rutina_id);
  // Derby y otros: cada uno va por su cuenta; se ve quién fue según su reloj.
  const individual = esIndividual(ev) && estado.personas.length > 1;
  const detalle = [individual ? null : textoAsistencia(ev), ev.notas].filter(Boolean).join(' · ');
  let extra = '';
  if (rutina) {
    const sesion = sesiones.find((s) => s.calendario_id === ev.id && !s.terminada_en) ?? sesiones.find((s) => s.calendario_id === ev.id);
    const voy = ev.asistencia === 'juntos' || ev.persona_id === estado.yo.id;
    let accion = '';
    if (sesion?.terminados.includes(estado.yo.id)) {
      accion = `<a class="boton boton--sec boton--chico boton--bloque" href="#/sesion/${esc(sesion.id)}">✓ Hecho · ver entreno</a>`;
    } else if (sesion) {
      accion = `<a class="boton boton--chico boton--bloque" href="#/sesion/${esc(sesion.id)}">${voy ? 'Continuar entreno' : 'Ver entreno'}</a>`;
    } else if (voy) {
      accion = `<button type="button" class="boton boton--chico boton--bloque" data-empezar="${esc(ev.id)}">Empezar entreno</button>`;
    }
    const zonas = resumen[rutina.id]?.zonas ?? [];
    extra = `
      <a class="plan__rutina" href="#/entreno/${esc(rutina.id)}" aria-label="Ver rutina ${esc(rutina.nombre)}">
        <span class="plan__rutina-texto">
          <strong>${esc(rutina.nombre)}</strong>
          ${zonas.length ? chipsZonas(zonas) : ''}
        </span>
        ${zonas.length ? mapaCuerpo(zonas, { alto: 64 }) : ''}
        <span class="plan__flecha" aria-hidden="true">›</span>
      </a>
      ${accion}`;
  }
  return `
    <li class="plan__item">
      <span class="plan__icono plan__icono--${esc(ev.tipo)}">${iconoEvento(ev)}</span>
      <div class="plan__cuerpo">
        <div class="plan__titulo">
          <strong>${esc(nombreEvento(ev))}</strong>
          ${ev.hora_inicio ? `<span class="plan__hora">${esc(hora(ev.hora_inicio))}</span>` : ''}
        </div>
        ${detalle ? `<span class="plan__detalle">${esc(detalle)}</span>` : ''}
        ${individual ? htmlAsistentes(quienesDe(ev)) : reloj ? `<span class="plan__reloj">${ICONO_RELOJ}<span>Registrado · ${esc(datosSesion(reloj))}</span></span>` : ''}
        ${extra}
      </div>
    </li>`;
}

// Botones para marcar el día sin ir a Semana. Va para los dos, sin hora.
function conectarRapido(app, hoy) {
  app.querySelectorAll('#rapido .chip').forEach((chip) => chip.addEventListener('click', async () => {
    app.querySelectorAll('#rapido .chip').forEach((c) => { c.disabled = true; });
    chip.setAttribute('aria-pressed', 'true');
    try {
      datos(await sb.from('calendario').insert({
        hogar_id: estado.yo.hogar_id, fecha: hoy, tipo: chip.dataset.valor, asistencia: 'juntos',
      }));
      aviso(`${TIPOS[chip.dataset.valor]} agendado para hoy.`);
      await vistaHoy(app);
    } catch (err) {
      avisoError(err);
      app.querySelectorAll('#rapido .chip').forEach((c) => { c.disabled = false; });
    }
  }));
}

function tarjetaPersona(p, est, med, descanso, b, semaforoDe) {
  const soyYo = p.id === estado.yo.id;
  const hecho = est && (est.cansancio != null || est.dolor_muscular != null);
  // Sin check-in igual se estima con el sueño y lo que registró el reloj.
  const mostrar = hecho ? est : { ...semaforoDe(p.id, est), estimado: true };
  return `
    <article class="tarjeta persona">
      ${heroSemaforo(mostrar, descanso, soyYo)}
      ${hecho ? resumenCheckIn(est, soyYo) : ''}
      ${soyYo ? formularioCheckIn(est, hecho) : ''}
      ${htmlDatos(med, b)}
    </article>`;
}

// El semáforo como protagonista: las tres luces, el estado grande y el porqué.
function heroSemaforo(est, descanso, soyYo) {
  const sem = est?.semaforo;
  const pista = est?.estimado ? `<span class="semaforo__estimado">${soyYo ? 'Estimado · marca cómo te sientes para afinarlo' : 'Estimado · todavía no marcó cómo se siente'}</span>` : '';
  const luces = ['rojo', 'ambar', 'verde'].map((c) => `<i class="luz luz--${c} ${sem === c ? 'luz--on' : ''}"></i>`).join('');
  if (!sem) {
    return `
      <div class="semaforo semaforo--vacio">
        <span class="semaforo__luces" aria-hidden="true">${luces}</span>
        <div>
          <span class="semaforo__estado">Sin semáforo</span>
          <p class="semaforo__motivo">${soyYo ? 'Marca cómo te sientes y lo calculo.' : 'Se calcula cuando marque cómo se siente.'}</p>
        </div>
      </div>`;
  }
  return `
    <div class="semaforo semaforo--${sem}" role="status">
      <span class="semaforo__luces" aria-hidden="true">${luces}</span>
      <div>
        <span class="semaforo__estado">${esc(textoSemaforo(sem, descanso))}</span>
        ${est.motivo ? `<p class="semaforo__motivo">${esc(est.motivo)}</p>` : ''}
        ${pista}
      </div>
    </div>`;
}

// Cansancio y dolor ya marcados: dos medidores en una línea.
function resumenCheckIn(est, soyYo) {
  const medidor = (nombre, v) => `
    <span class="medidor" aria-label="${nombre} ${v ?? 'sin marcar'} de 5">
      <span class="medidor__nombre">${nombre}</span>
      <span class="medidor__barras" aria-hidden="true">${[1, 2, 3, 4, 5].map((n) => `<i class="${v != null && n <= v ? `on n${v}` : ''}"></i>`).join('')}</span>
      <strong>${v ?? '—'}</strong>
    </span>`;
  return `
    <div class="checkin-resumen">
      ${medidor('Cansancio', est.cansancio)}
      ${medidor('Dolor', est.dolor_muscular)}
      ${soyYo ? '<button type="button" class="boton boton--texto boton--chico" id="editar-checkin" aria-expanded="false" aria-controls="checkin">Editar</button>' : ''}
    </div>`;
}

function chips(nombre, actual) {
  return [1, 2, 3, 4, 5].map((n) =>
    `<button type="button" class="chip" data-valor="${n}" aria-pressed="${actual === n}" aria-label="${nombre} ${n} de 5">${n}</button>`
  ).join('');
}

function formularioCheckIn(est, hecho) {
  return `
    <div class="pila checkin" id="checkin" ${hecho ? 'hidden' : ''}>
      <fieldset class="campo">
        <legend>Cansancio <span class="quieto">· 1 fresco, 5 agotado</span></legend>
        <div class="chips" id="cansancio">${chips('Cansancio', est?.cansancio ?? null)}</div>
      </fieldset>
      <fieldset class="campo">
        <legend>Dolor muscular <span class="quieto">· 1 nada, 5 mucho</span></legend>
        <div class="chips" id="dolor">${chips('Dolor muscular', est?.dolor_muscular ?? null)}</div>
      </fieldset>
      <button type="button" class="boton boton--chico" id="guardar-checkin">${hecho ? 'Actualizar' : 'Calcular mi semáforo'}</button>
      <p class="ayuda">Usa cómo te sientes, lo que hiciste ayer y hoy, y el sueño y los entrenos de la banda.</p>
    </div>`;
}

function conectarCheckIn(app, { hoy, deAyer, deHoy, extrasAyer, suenoMin, bandaAyer, bandaHoy }, est) {
  const cont = app.querySelector('#checkin');
  if (!cont) return;
  const editar = app.querySelector('#editar-checkin');
  editar?.addEventListener('click', () => {
    const abrir = cont.hidden;
    cont.hidden = !abrir;
    editar.textContent = abrir ? 'Cerrar' : 'Editar';
    editar.setAttribute('aria-expanded', String(abrir));
  });
  const cansancio = cont.querySelector('#cansancio');
  const dolor = cont.querySelector('#dolor');
  grupoChips(cansancio);
  grupoChips(dolor);
  const boton = cont.querySelector('#guardar-checkin');
  boton.addEventListener('click', async () => {
    const c = valorChips(cansancio), d = valorChips(dolor);
    if (!c && !d) return aviso('Elige al menos un valor.');
    boton.disabled = true;
    const cansancioN = c ? Number(c) : est?.cansancio ?? null;
    const dolorN = d ? Number(d) : est?.dolor_muscular ?? null;
    const { semaforo, motivo } = calcularSemaforo({
      cansancio: cansancioN, dolor: dolorN, ayer: deAyer, hoy: deHoy, extrasAyer, personaId: estado.yo.id,
      suenoMin, bandaAyer, bandaHoy,
    });
    try {
      datos(await sb.from('estado_diario').upsert({
        persona_id: estado.yo.id,
        fecha: hoy,
        cansancio: cansancioN,
        dolor_muscular: dolorN,
        semaforo,
        motivo,
        calculado_en: new Date().toISOString(),
      }, { onConflict: 'persona_id,fecha' }));
      aviso(`Semáforo: ${textoSemaforo(semaforo, esDescanso(deHoy, estado.yo.id)).toLowerCase()}.`);
      await vistaHoy(app);
    } catch (err) {
      avisoError(err);
      boton.disabled = false;
    }
  });
}

// Cuerpo y banda en una grilla compacta: peso, grasa, músculo / sueño, pasos, activas.
function htmlDatos(med, b) {
  const h = b.hoy ?? {};
  const fmt = (v, d = 1) => (v != null ? num(v, d) : null);
  const sueno = b.suenoMin != null && b.suenoMin > 0
    ? `${Math.floor(b.suenoMin / 60)}<span class="dato-unidad">h</span>${String(b.suenoMin % 60).padStart(2, '0')}`
    : null;
  const celdas = [
    ['Peso', fmt(med?.peso_kg), 'kg'],
    ['Grasa', fmt(med?.grasa_pct), '%'],
    ['Músculo', fmt(med?.masa_muscular_kg), 'kg'],
    ['Sueño', sueno, '', b.suenoMin != null && b.suenoMin > 0 && b.suenoMin < 360],
    ['Pasos', h.pasos != null ? Number(h.pasos).toLocaleString('es-EC') : null, ''],
    ['Activas', h.calorias_activas != null ? Number(h.calorias_activas).toLocaleString('es-EC') : null, 'kcal'],
  ];
  if (celdas.every((c) => c[1] == null)) return '';
  const pie = [med ? `Medición del ${fechaCorta(med.medido_en)}` : null].filter(Boolean);
  return `
    <div class="datos">
      ${celdas.map(([nombre, valor, unidad, alerta]) => `
        <div class="dato ${alerta ? 'dato--alerta' : ''}">
          <span class="dato__nombre">${nombre}</span>
          <span class="dato__valor">${valor ?? '<span class="quieto">—</span>'}${valor != null && unidad ? `<span class="dato-unidad">${unidad}</span>` : ''}</span>
        </div>`).join('')}
    </div>
    ${pie.length ? `<p class="datos__pie">${esc(pie.join(' · '))}</p>` : ''}`;
}

// Una vez por sesión: si falta el perfil, se ofrece ir al asistente.
function avisarPerfil(falta) {
  try { if (sessionStorage.getItem('bloque-aviso-perfil')) return; sessionStorage.setItem('bloque-aviso-perfil', '1'); } catch { /* nada */ }
  const d = abrirDialogo(`
    <div class="dialogo">
      <h2 class="tarjeta__titulo">Terminemos tu perfil</h2>
      <p style="margin:0">${falta.includes('plan')
        ? 'Todavía no tienes rutinas ni agenda. Con unos datos (tu cuerpo, objetivo, deporte y días de gym) Bloq arma todo por ti.'
        : 'Faltan algunos datos (tu cuerpo u objetivo) para calcular bien tus calorías y tus entrenos.'}</p>
      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" data-cerrar>Después</button>
        <a class="boton" href="#/completar" id="ir-completar">Completar ahora</a>
      </div>
    </div>`, 'Completar perfil');
  d.querySelector('#ir-completar').addEventListener('click', () => d.close());
}

// Hoy en números: lo que falta comer, lo que falta tomar y lo que quemaste según el reloj. Toca → Comida.
function htmlNumerosHoy(x, banda) {
  if (!x?.metas?.ok) return '';
  const falta = Math.round(x.metas.kcal - x.comido.kcal);
  const aguaFalta = x.agua.meta - x.agua.tomado;
  const quemado = banda?.hoy?.calorias_activas ?? x.metas.medido ?? 0;
  const anillo = (pct, clase) => `<svg class="anillo ${clase}" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5" class="anillo__fondo"/><circle cx="18" cy="18" r="15.5" class="anillo__valor" stroke-dasharray="${Math.round(Math.min(100, Math.max(0, pct)) * 0.974)} 100"/></svg>`;
  return `
    <a class="tarjeta numeros-hoy" href="#/comida" aria-label="Ver Comida">
      <div class="numero-hoy">
        ${anillo((x.comido.kcal / x.metas.kcal) * 100, 'anillo--kcal')}
        <span><strong>${falta > 0 ? kc(falta) : '✓'}</strong><span>${falta > 0 ? 'kcal por comer' : 'meta de comida'}</span></span>
      </div>
      <div class="numero-hoy">
        ${anillo((x.agua.tomado / x.agua.meta) * 100, 'anillo--agua')}
        <span><strong>${aguaFalta > 0 ? litros(aguaFalta) : '✓'}</strong><span>${aguaFalta > 0 ? 'de agua' : 'agua al día'}</span></span>
      </div>
      <div class="numero-hoy">
        <span class="numero-hoy__fuego" aria-hidden="true">${IC.fuego}</span>
        <span><strong>${kc(quemado)}</strong><span>kcal quemadas</span></span>
      </div>
    </a>`;
}
const kc = (n) => Math.round(n).toLocaleString('es-EC');

// Pesarse seguido y en las mismas condiciones: la meta de calorías se ajusta sola con la tendencia del peso.
// También avisa si faltan datos que hacen las metas más precisas (% de grasa, experiencia en el gym).
function htmlCuerpoPendiente(mias) {
  const ahora = new Date();
  const conPeso = mias.filter((m) => m.peso_kg != null);
  const ultimo = conPeso[0] ? new Date(conPeso[0].medido_en) : null;
  const dias = ultimo ? Math.floor((ahora - ultimo) / 864e5) : null;
  const hoyCal = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
  const pesadoHoy = conPeso.some((m) => String(m.medido_en).slice(0, 10) === hoyCal);
  const tocaHoy = [1, 4].includes(ahora.getDay()) && ahora.getHours() < 12 && !pesadoHoy;
  const sinGrasa = !mias.some((m) => m.grasa_pct != null && (ahora - new Date(m.medido_en)) < 60 * 864e5);
  const items = [];
  const ultimoPeso = conPeso[0]?.peso_kg;
  // Cada sugerencia se responde acá mismo, sin ir a otra pantalla.
  if (tocaHoy || dias == null || dias >= 4) {
    items.push(`<form class="pendiente pendiente--resp" data-resp="peso" novalidate>
      <span class="pendiente__texto"><strong>${tocaHoy ? 'Hoy toca pesarte' : dias == null ? 'Registra tu peso' : `Hace ${dias} días que no te pesas`}</strong>
      <span class="quieto">Al levantarte, en ayunas y después del baño: así tu meta de calorías se ajusta con datos confiables.</span></span>
      <div class="resp-fila">
        <label class="resp-campo"><input type="text" inputmode="decimal" autocomplete="off" name="peso" placeholder="${ultimoPeso ? esc(String(Number(ultimoPeso))) : '70'}" aria-label="Peso en kg"><span>kg</span></label>
        <label class="resp-campo"><input type="text" inputmode="decimal" autocomplete="off" name="grasa" placeholder="—" aria-label="Grasa corporal (opcional)"><span>% grasa</span></label>
        <button type="submit" class="boton boton--chico">Guardar</button>
      </div>
    </form>`);
  }
  if (sinGrasa && conPeso.length && !items.length) {
    items.push(`<form class="pendiente pendiente--resp" data-resp="grasa" novalidate>
      <span class="pendiente__texto"><strong>Agrega tu % de grasa</strong>
      <span class="quieto">Con tu balanza de bioimpedancia: las calorías y la proteína se calculan sobre tu masa magra y quedan más precisas.</span></span>
      <div class="resp-fila">
        <label class="resp-campo"><input type="text" inputmode="decimal" autocomplete="off" name="grasa" placeholder="25" aria-label="Grasa corporal en %"><span>%</span></label>
        <button type="submit" class="boton boton--chico">Guardar</button>
      </div>
    </form>`);
  }
  if (!estado.yo.experiencia) {
    items.push(`<div class="pendiente pendiente--resp" data-resp="experiencia">
      <span class="pendiente__texto"><strong>¿Cuánta experiencia tienes en el gym?</strong>
      <span class="quieto">Así ajustamos las series y la progresión de tus rutinas.</span></span>
      <div class="chips resp-chips">
        <button type="button" class="chip" data-exp="principiante">Menos de 1 año</button>
        <button type="button" class="chip" data-exp="intermedio">1 a 3 años</button>
        <button type="button" class="chip" data-exp="avanzado">Más de 3 años</button>
      </div>
    </div>`);
  }
  return items.length ? `<section class="tarjeta cuerpo-pendiente">${items.join('')}</section>` : '';
}

// Respuestas en el lugar: peso, % de grasa y experiencia se guardan sin salir de Hoy.
const borradorPendientes = {};
function conectarPendientes(app, recargar) {
  const caja = app.querySelector('.cuerpo-pendiente');
  if (!caja) return;
  // Si Hoy se vuelve a dibujar (al sincronizar), no se pierde lo que estabas escribiendo.
  caja.querySelectorAll('form[data-resp] input').forEach((i) => {
    const k = `${i.form.dataset.resp}-${i.name}`;
    if (borradorPendientes[k]) i.value = borradorPendientes[k];
    i.addEventListener('input', () => { borradorPendientes[k] = i.value; });
  });
  const quitar = (el, despues) => {
    el.classList.add('pendiente--hecho');
    setTimeout(() => {
      el.remove();
      if (!caja.querySelector('.pendiente')) caja.remove();
      despues?.();
    }, 380);
  };
  const leer = (input, min, max, nombre) => {
    if (!input || input.value === '') return null;
    const v = Number(String(input.value).replace(',', '.'));
    if (!Number.isFinite(v) || v < min || v > max) { input.focus(); throw new Error(`${nombre}: revisa el valor (entre ${min} y ${max}).`); }
    return v;
  };
  caja.querySelectorAll('form[data-resp]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    let peso = null, grasa = null;
    try {
      peso = leer(f.elements.peso, 30, 250, 'Peso');
      grasa = leer(f.elements.grasa, 3, 60, 'Grasa');
    } catch (err) { return aviso(err.message, 'error'); }
    if (f.dataset.resp === 'peso' && peso == null) { f.elements.peso.focus(); return aviso('Escribe tu peso.', 'error'); }
    if (f.dataset.resp === 'grasa' && grasa == null) { f.elements.grasa.focus(); return aviso('Escribe tu % de grasa.', 'error'); }
    const boton = f.querySelector('[type=submit]');
    boton.disabled = true;
    try {
      datos(await sb.from('mediciones_corporales').insert({ persona_id: estado.yo.id, peso_kg: peso, grasa_pct: grasa, origen: 'manual' }));
      f.querySelector('input')?.blur();
      for (const k of Object.keys(borradorPendientes)) delete borradorPendientes[k];
      aviso(peso != null ? `Listo: ${num(peso)} kg. Tu meta se recalcula.` : 'Listo: % de grasa guardado.');
      quitar(f, recargar);
    } catch (err) { avisoError(err); boton.disabled = false; }
  }));
  caja.querySelectorAll('[data-exp]').forEach((b) => b.addEventListener('click', async () => {
    const cont = b.closest('[data-resp]');
    cont.querySelectorAll('[data-exp]').forEach((x) => { x.disabled = true; x.setAttribute('aria-pressed', String(x === b)); });
    try {
      datos(await sb.from('personas').update({ experiencia: b.dataset.exp }).eq('id', estado.yo.id).select('id'));
      estado.yo.experiencia = b.dataset.exp;
      const p = estado.personas.find((x) => x.id === estado.yo.id);
      if (p) p.experiencia = b.dataset.exp;
      aviso('Anotado. Tus rutinas se ajustan a eso.');
      quitar(cont);
    } catch (err) { avisoError(err); cont.querySelectorAll('[data-exp]').forEach((x) => { x.disabled = false; }); }
  }));
}
