// Pantalla Hoy: qué toca, cómo está cada uno y su última medición.
import { sb, estado, datos } from '../db.js';
import { esc, num, aviso, avisoError, grupoChips, valorChips } from '../ui.js';
import { hoyISO, sumarDias, diaLargo, diaCorto, numeroDia, fechaCorta, hora } from '../fechas.js';
import { TIPOS, horaEfectiva, textoAsistencia, nombreEvento, iconoEvento } from '../eventos.js';
import { iconoTipo, mapaCuerpo, chipsZonas } from '../iconos.js';
import { resumenRutinas } from '../rutinas.js';
import { actividad, emparejar, minutos } from '../actividades.js';
import { calcularSemaforo, esDescanso, textoSemaforo } from '../semaforo.js';
import { empezarSesion } from './sesion.js';

export async function vistaHoy(app) {
  const hoy = hoyISO();
  const ayer = sumarDias(hoy, -1);
  const hogar = estado.yo.hogar_id;
  const ids = estado.personas.map((p) => p.id);

  const desdeAyer = new Date(`${ayer}T00:00:00`).toISOString();
  const [eventos, estados, mediciones, extrasTodos, actividadDia, entrenosBanda] = await Promise.all([
    sb.from('calendario').select('*').eq('hogar_id', hogar)
      .gte('fecha', ayer).lte('fecha', sumarDias(hoy, 7))
      .order('fecha').order('hora_inicio', { nullsFirst: true }).then(datos),
    sb.from('estado_diario').select('*').in('persona_id', ids).eq('fecha', hoy).then(datos),
    sb.from('mediciones_corporales').select('persona_id, medido_en, peso_kg, grasa_pct, masa_muscular_kg')
      .in('persona_id', ids).order('medido_en', { ascending: false }).limit(40).then(datos),
    sb.from('actividades_extra').select('*').in('persona_id', ids).eq('fecha', ayer).then(datos),
    sb.from('actividad_diaria').select('*').in('persona_id', ids).in('fecha', [ayer, hoy]).then(datos),
    sb.from('sesiones_banda').select('persona_id, inicio, fin, tipo, calorias, fc_promedio')
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
  const deAyer = eventos.filter((e) => e.fecha === ayer);
  const deHoy = eventos.filter((e) => e.fecha === hoy);

  // Rutinas del día y entrenos ya empezados.
  const proximo = eventos.find((e) => e.fecha > hoy && e.tipo !== 'descanso');
  const conRutina = deHoy.filter((e) => e.rutina_id);
  const idsRutinas = [...new Set([...conRutina.map((e) => e.rutina_id), proximo?.rutina_id].filter(Boolean))];
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
      cansancio: est?.cansancio ?? null, dolor: est?.dolor_muscular ?? null, ayer: deAyer, hoy: deHoy,
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

  app.innerHTML = `
    <header class="encabezado">
      <div>
        <h1 class="titulo">Hoy</h1>
        <p class="subtitulo">${esc(diaLargo(hoy))}</p>
      </div>
      <span class="wordmark" aria-hidden="true">b<span class="wordmark__bloque"></span></span>
    </header>

    <section class="tarjeta" aria-labelledby="plan-hoy">
      <div class="fila fila--entre" style="margin-bottom:6px">
        <h2 class="seccion__titulo" id="plan-hoy" style="margin:0">Plan de hoy</h2>
        <a class="enlace-chico" href="#/semana">Semana ›</a>
      </div>
      ${deHoy.length || mia.entrenosHoy.length
        ? `<ol class="plan">${lineaDeTiempo(deHoy, mia.entrenosHoy, rutinas, sesiones, resumen)}</ol>`
        : `<p class="vacio" style="padding-top:4px">No hay nada agendado. ¿Qué hacen hoy?</p>
           <div class="chips" id="rapido">
             ${Object.entries(TIPOS).filter(([v]) => v !== 'otro').map(([v, t]) => `<button type="button" class="chip chip--icono" data-valor="${v}">${iconoTipo(v)}${t}</button>`).join('')}
             <a class="chip chip--icono" href="#/semana" style="text-decoration:none;display:inline-flex;align-items:center">${iconoTipo('otro')}Otro…</a>
           </div>`}
      ${proximo ? `<p class="plan__proximo"><span class="quieto">Después</span> ${iconoEvento(proximo)} <strong>${esc(rutinaProxima?.nombre ?? nombreEvento(proximo))}</strong> <span class="quieto">${esc(diaCorto(proximo.fecha))} ${numeroDia(proximo.fecha)}${proximo.hora_inicio ? ` · ${esc(hora(proximo.hora_inicio))}` : ''}</span></p>` : ''}
    </section>

    ${estado.personas.map((p, i) => `
      <section class="seccion" aria-labelledby="como-${i}">
        <h2 class="seccion__titulo" id="como-${i}">${p.id === estado.yo.id ? 'Cómo estoy' : `Cómo está ${esc(p.nombre)}`}</h2>
        ${tarjetaPersona(p, estados.find((e) => e.persona_id === p.id), mediciones.find((m) => m.persona_id === p.id), esDescanso(deHoy, p.id), banda(p.id), semaforoDe)}
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

const ICONO_RELOJ = '<svg class="icono" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6" width="11" height="12" rx="3.5"/><path d="M9 6l.6-3h4.8l.6 3M9 18l.6 3h4.8l.6-3M12 9.5V12l1.6 1.2"/></svg>';
const horaLocal = (iso) => new Date(iso).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false });

function datosSesion(s) {
  const min = minutos(s);
  return [min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`,
    s.calorias != null ? `${s.calorias} kcal` : null, s.fc_promedio ? `${s.fc_promedio} ppm` : null].filter(Boolean).join(' · ');
}

// Plan y reloj juntos, en orden de hora. Lo que el reloj registró y coincide con algo
// agendado se marca en ese paso; lo demás aparece como actividad propia (las caminatas, juntas).
function lineaDeTiempo(deHoy, entrenosHoy, rutinas, sesiones, resumen) {
  const mios = deHoy.filter((e) => e.asistencia === 'juntos' || e.persona_id === estado.yo.id);
  const { pares, sueltas } = emparejar(mios, entrenosHoy);
  const pasos = deHoy.map((e) => ({ orden: horaEfectiva(e), html: htmlPlan(e, rutinas, sesiones, resumen, pares.get(e)) }));
  const caminatas = sueltas.filter((s) => s.tipo === 'caminar');
  const otras = sueltas.filter((s) => s.tipo !== 'caminar');
  for (const s of otras) pasos.push({ orden: horaLocal(s.inicio), html: htmlActividad(actividad(s.tipo).nombre, actividad(s.tipo).icono, horaLocal(s.inicio), datosSesion(s)) });
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
function htmlPlan(ev, rutinas, sesiones, resumen, reloj) {
  const rutina = rutinas.find((r) => r.id === ev.rutina_id);
  const detalle = [textoAsistencia(ev), ev.notas].filter(Boolean).join(' · ');
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
        ${reloj ? `<span class="plan__reloj">${ICONO_RELOJ}<span>Registrado · ${esc(datosSesion(reloj))}</span></span>` : ''}
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
