// Pantalla Hoy: qué toca, cómo está cada uno y su última medición.
import { sb, estado, datos } from '../db.js';
import { esc, num, aviso, avisoError, grupoChips, valorChips } from '../ui.js';
import { hoyISO, sumarDias, diaLargo, diaCorto, numeroDia, fechaCorta } from '../fechas.js';
import { TIPOS, htmlEvento, horaEfectiva } from '../eventos.js';
import { calcularSemaforo, esDescanso, textoSemaforo } from '../semaforo.js';
import { empezarSesion } from './sesion.js';

export async function vistaHoy(app) {
  const hoy = hoyISO();
  const ayer = sumarDias(hoy, -1);
  const hogar = estado.yo.hogar_id;
  const ids = estado.personas.map((p) => p.id);

  const desdeAyer = new Date(`${ayer}T00:00:00`).toISOString();
  const [eventos, estados, mediciones, extrasAyer, actividad, entrenosBanda] = await Promise.all([
    sb.from('calendario').select('*').eq('hogar_id', hogar)
      .gte('fecha', ayer).lte('fecha', sumarDias(hoy, 7))
      .order('fecha').order('hora_inicio', { nullsFirst: true }).then(datos),
    sb.from('estado_diario').select('*').in('persona_id', ids).eq('fecha', hoy).then(datos),
    sb.from('mediciones_corporales').select('persona_id, medido_en, peso_kg, grasa_pct, masa_muscular_kg')
      .in('persona_id', ids).order('medido_en', { ascending: false }).limit(40).then(datos),
    sb.from('actividades_extra').select('*').eq('persona_id', estado.yo.id).eq('fecha', ayer).then(datos),
    sb.from('actividad_diaria').select('*').in('persona_id', ids).in('fecha', [ayer, hoy]).then(datos),
    sb.from('sesiones_banda').select('persona_id, inicio, fin, tipo, calorias, fc_promedio')
      .in('persona_id', ids).gte('inicio', desdeAyer).order('inicio').then(datos),
  ]);
  // Datos de la banda por persona: hoy (pasos, calorías), anoche (sueño) y entrenos de ayer.
  const banda = (personaId) => {
    const deHoyB = actividad.find((a) => a.persona_id === personaId && a.fecha === hoy);
    const deAyerB = actividad.find((a) => a.persona_id === personaId && a.fecha === ayer);
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
  const ORDEN_TIPO = { gym: 0, clase: 1, derby: 2, descanso: 3 };
  eventos.sort((x, y) => x.fecha.localeCompare(y.fecha)
    || horaEfectiva(x).localeCompare(horaEfectiva(y))
    || ORDEN_TIPO[x.tipo] - ORDEN_TIPO[y.tipo]);
  const deAyer = eventos.filter((e) => e.fecha === ayer);
  const deHoy = eventos.filter((e) => e.fecha === hoy);

  // Rutinas del día y entrenos ya empezados.
  const conRutina = deHoy.filter((e) => e.rutina_id);
  const [rutinas, sesiones] = conRutina.length ? await Promise.all([
    sb.from('rutinas').select('id, nombre, foco').in('id', conRutina.map((e) => e.rutina_id)).then(datos),
    sb.from('sesiones').select('id, calendario_id, terminados, terminada_en').in('calendario_id', conRutina.map((e) => e.id)).then(datos),
  ]) : [[], []];
  // Las rutinas de los días de derby son livianas a propósito: el semáforo lo tiene en cuenta.
  for (const e of deHoy) e.liviana = rutinas.find((r) => r.id === e.rutina_id)?.foco === 'recuperacion';
  const proximo = eventos.find((e) => e.fecha > hoy && e.tipo !== 'descanso');
  const mia = banda(estado.yo.id);
  const contexto = { hoy, deAyer, deHoy, extrasAyer, suenoMin: mia.suenoMin, bandaAyer: mia.entrenosAyer };

  // El semáforo se recalcula al abrir Hoy: pueden haber llegado datos de la banda
  // o cambiado el plan desde el check-in. Solo se guarda si cambió.
  const mio = estados.find((e) => e.persona_id === estado.yo.id);
  if (mio && (mio.cansancio != null || mio.dolor_muscular != null)) {
    const r = calcularSemaforo({
      cansancio: mio.cansancio, dolor: mio.dolor_muscular, ayer: deAyer, hoy: deHoy, extrasAyer, personaId: estado.yo.id,
      suenoMin: mia.suenoMin, bandaAyer: mia.entrenosAyer,
    });
    if (r.semaforo !== mio.semaforo || r.motivo !== mio.motivo) {
      const { error } = await sb.from('estado_diario')
        .update({ ...r, calculado_en: new Date().toISOString() })
        .eq('persona_id', estado.yo.id).eq('fecha', hoy);
      if (!error) Object.assign(mio, r);
    }
  }

  app.innerHTML = `
    <header class="encabezado">
      <div>
        <h1 class="titulo">Hoy</h1>
        <p class="subtitulo">${esc(diaLargo(hoy))}</p>
      </div>
      <span class="wordmark" aria-hidden="true">b<span class="wordmark__bloque"></span></span>
    </header>

    <section class="tarjeta" aria-labelledby="plan-hoy">
      <h2 class="seccion__titulo" id="plan-hoy">Plan de hoy</h2>
      ${deHoy.length
        ? `<div class="pila">${deHoy.map((e) => htmlPlan(e, rutinas, sesiones)).join('')}</div>`
        : `<p class="vacio" style="padding-top:0">No hay nada agendado. ¿Qué hacen hoy?</p>
           <div class="chips" id="rapido">
             ${Object.entries(TIPOS).map(([v, t]) => `<button type="button" class="chip" data-valor="${v}">${t}</button>`).join('')}
           </div>`}
      ${proximo ? `<p class="quieto" style="margin:12px 0 0">Próximo: ${esc(diaCorto(proximo.fecha))} ${numeroDia(proximo.fecha)} · ${esc(htmlTextoPlano(proximo))}</p>` : ''}
      <a class="boton boton--sec boton--chico" style="margin-top:14px" href="#/semana">Ver la semana</a>
    </section>

    ${estado.personas.map((p, i) => `
      <section class="seccion" aria-labelledby="como-${i}">
        <h2 class="seccion__titulo" id="como-${i}">${p.id === estado.yo.id ? 'Cómo estoy' : `Cómo está ${esc(p.nombre)}`}</h2>
        ${tarjetaPersona(p, estados.find((e) => e.persona_id === p.id), mediciones.find((m) => m.persona_id === p.id), esDescanso(deHoy, p.id), banda(p.id))}
      </section>`).join('')}`;

  conectarCheckIn(app, contexto, estados.find((e) => e.persona_id === estado.yo.id));
  conectarRapido(app, hoy);
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

// Un evento del plan; si es gym con rutina, con su botón para entrenar.
function htmlPlan(ev, rutinas, sesiones) {
  const rutina = rutinas.find((r) => r.id === ev.rutina_id);
  if (!rutina) return `<div class="evento">${htmlEvento(ev)}</div>`;
  const sesion = sesiones.find((s) => s.calendario_id === ev.id && !s.terminada_en) ?? sesiones.find((s) => s.calendario_id === ev.id);
  const voy = ev.asistencia === 'juntos' || ev.persona_id === estado.yo.id;
  let accion = '';
  if (sesion?.terminados.includes(estado.yo.id)) {
    accion = `<a class="boton boton--sec boton--chico" href="#/sesion/${esc(sesion.id)}">Ver entreno de hoy</a>`;
  } else if (sesion) {
    accion = `<a class="boton boton--chico" href="#/sesion/${esc(sesion.id)}">${voy ? 'Continuar entreno' : 'Ver entreno'}</a>`;
  } else if (voy) {
    accion = `<button type="button" class="boton boton--chico" data-empezar="${esc(ev.id)}">Empezar entreno</button>`;
  }
  return `
    <div class="evento-gym">
      <div class="evento">${htmlEvento(ev)}</div>
      <span class="evento-gym__rutina"><strong>${esc(rutina.nombre)}</strong> · <a href="#/entreno/${esc(rutina.id)}">ver rutina</a></span>
      ${accion ? `<div>${accion}</div>` : ''}
    </div>`;
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

function htmlTextoPlano(ev) {
  const div = document.createElement('div');
  div.innerHTML = htmlEvento(ev);
  return div.textContent.replace(/\s+/g, ' ').trim();
}

function tarjetaPersona(p, est, med, descanso, b) {
  const soyYo = p.id === estado.yo.id;
  const sem = est?.semaforo;
  return `
    <article class="tarjeta">
      <div class="fila fila--entre">
        <h3 class="tarjeta__titulo">${esc(p.nombre)}</h3>
        <span class="fila" style="gap:8px">
          <span class="punto ${sem ? `punto--${sem}` : ''}" aria-hidden="true"></span>
          <span class="quieto">${sem ? esc(textoSemaforo(sem, descanso)) : 'Sin semáforo aún'}</span>
        </span>
      </div>
      ${est?.motivo ? `<p class="motivo"><strong>Por qué:</strong> ${esc(est.motivo)}</p>` : ''}

      <div class="grilla-2" style="margin-top:14px">
        <div>
          <p class="quieto" style="margin:0 0 4px">Peso</p>
          ${med?.peso_kg != null ? `<span class="dato-grande">${num(med.peso_kg)}</span><span class="dato-unidad">kg</span>` : '<span class="quieto">—</span>'}
        </div>
        <div>
          <p class="quieto" style="margin:0 0 4px">Grasa</p>
          ${med?.grasa_pct != null ? `<span class="dato-grande">${num(med.grasa_pct)}</span><span class="dato-unidad">%</span>` : '<span class="quieto">—</span>'}
        </div>
      </div>
      ${med ? `<p class="quieto" style="margin:8px 0 0">Última medición: ${esc(fechaCorta(med.medido_en))}</p>` : ''}
      ${htmlBanda(b)}

      ${soyYo ? formularioCheckIn(est) : resumenCheckIn(est)}
    </article>`;
}

function chips(nombre, actual) {
  return [1, 2, 3, 4, 5].map((n) =>
    `<button type="button" class="chip" data-valor="${n}" aria-pressed="${actual === n}" aria-label="${nombre} ${n} de 5">${n}</button>`
  ).join('');
}

function formularioCheckIn(est) {
  return `
    <div class="pila" style="margin-top:18px" id="checkin">
      <fieldset class="campo">
        <legend>Cansancio (1 = fresco, 5 = agotado)</legend>
        <div class="chips" id="cansancio">${chips('Cansancio', est?.cansancio ?? null)}</div>
      </fieldset>
      <fieldset class="campo">
        <legend>Dolor muscular (1 = nada, 5 = mucho)</legend>
        <div class="chips" id="dolor">${chips('Dolor muscular', est?.dolor_muscular ?? null)}</div>
      </fieldset>
      <button type="button" class="boton boton--chico" id="guardar-checkin">${est ? 'Actualizar' : 'Calcular mi semáforo'}</button>
      <p class="ayuda">El semáforo usa cómo te sientes, lo que hicieron ayer y hoy, y el sueño y los entrenos de la banda.</p>
    </div>`;
}

function resumenCheckIn(est) {
  if (!est || (est.cansancio == null && est.dolor_muscular == null)) {
    return '<p class="quieto" style="margin:14px 0 0">Todavía no registró cómo se siente hoy.</p>';
  }
  return `<p class="quieto" style="margin:14px 0 0">Cansancio ${est.cansancio ?? '—'}/5 · Dolor muscular ${est.dolor_muscular ?? '—'}/5</p>`;
}

function conectarCheckIn(app, { hoy, deAyer, deHoy, extrasAyer, suenoMin, bandaAyer }, est) {
  const cont = app.querySelector('#checkin');
  if (!cont) return;
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
      suenoMin, bandaAyer,
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

// Pasos, sueño, calorías y entrenos del día según la banda.
function htmlBanda(b) {
  if (!b.hoy && !b.ayer && !b.entrenosHoy.length) return '';
  const h = b.hoy ?? {};
  const sueno = b.suenoMin != null
    ? `${Math.floor(b.suenoMin / 60)}<span class="dato-unidad">h</span> ${String(b.suenoMin % 60).padStart(2, '0')}<span class="dato-unidad">min</span>`
    : '—';
  const pasos = h.pasos != null ? Number(h.pasos).toLocaleString('es-EC') : '—';
  const kcal = h.calorias_activas != null ? `${Number(h.calorias_activas).toLocaleString('es-EC')}<span class="dato-unidad">kcal</span>` : '—';
  return `
    <div class="banda">
      <div><p class="quieto">Sueño</p><span class="dato-medio">${sueno}</span></div>
      <div><p class="quieto">Pasos</p><span class="dato-medio">${pasos}</span></div>
      <div><p class="quieto">Activas</p><span class="dato-medio">${kcal}</span></div>
    </div>
    ${b.entrenosHoy.map((s) => {
      const min = Math.round((new Date(s.fin) - new Date(s.inicio)) / 60000);
      return `<p class="quieto" style="margin:6px 0 0">Banda: ${esc(s.tipo)} · ${min} min${s.calorias != null ? ` · ${s.calorias} kcal` : ''}${s.fc_promedio ? ` · ${s.fc_promedio} ppm` : ''}</p>`;
    }).join('')}`;
}
