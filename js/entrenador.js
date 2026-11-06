// Entrenador IA: un chat para ajustar la rutina (también la de un entreno en curso) o armar rutinas nuevas.
// La IA sabe el deporte del hogar y evita sumar fatiga donde el deporte ya carga (derby → menos cuádriceps,
// más glúteos y femorales). Lo que propone se ve antes de aplicarlo.
import { llamarIA } from './ia.js';
import { sb, estado, datos } from './db.js';
import { esc, aviso, avisoError, abrirDialogo } from './ui.js';
import { deporte } from './deportes.js';
import { hoyISO, sumarDias, diaCorto, aISO } from './fechas.js';
import { cargarRutina } from './rutinas.js';
import { familiaDe } from './variacion.js';
import { htmlCabecera, htmlCompositor, conectarCompositor, burbujaPensando, bajar, cubo } from './chatia.js';

const CHISPA = '<svg class="icono" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';

// Deportes que ya cargan mucho los cuádriceps: el gym de piernas va a glúteos y femorales.
export const CARGA_CUADRICEPS = new Set(['roller_derby', 'patinaje', 'hockey', 'ciclismo', 'mtb', 'esqui', 'snowboard', 'speed_skating']);
const normal = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** ¿Esta rutina carga cuádriceps que el deporte ya trabaja? Para sugerir ajustarla. */
export function sobraCuadriceps(items) {
  if (!CARGA_CUADRICEPS.has(estado.equipo?.deporte)) return false;
  const grupos = items.map((it) => normal(it.ejercicio?.grupo_muscular));
  const aislado = grupos.some((g) => g === 'cuadriceps');
  const dominantes = grupos.filter((g) => g === 'cuadriceps' || g === 'piernas').length;
  return aislado || dominantes >= 2;
}

async function contexto(rutinaId, enCurso = false) {
  const hogar = estado.yo.hogar_id;
  const hoy = hoyISO();
  const hace21 = sumarDias(hoy, -21);
  const [catalogo, rutinas, items, objetivos, agenda, molestias, sesiones] = await Promise.all([
    sb.from('ejercicios').select('id, nombre, grupo_muscular, unidad, por_lado').eq('hogar_id', hogar).order('grupo_muscular').then(datos),
    sb.from('rutinas').select('id, nombre, foco, notas').eq('hogar_id', hogar).order('creada_en').then(datos),
    sb.from('rutina_ejercicios').select('rutina_id, orden, series_base, reps_base, descanso_base, ejercicio:ejercicios(id, nombre, grupo_muscular)')
      .in('rutina_id', (await sb.from('rutinas').select('id').eq('hogar_id', hogar).then(datos)).map((r) => r.id)).order('orden').then(datos),
    sb.from('objetivos').select('persona_id, foco, desde').in('persona_id', estado.personas.map((p) => p.id)).order('desde', { ascending: false }).then(datos).catch(() => []),
    sb.from('calendario').select('fecha, tipo, hora_inicio, rutina_id, actividad').eq('hogar_id', hogar).gte('fecha', hoy).lte('fecha', sumarDias(hoy, 10)).order('fecha').then(datos),
    sb.from('molestias').select('persona_id, zona, intensidad, nota, desde').in('persona_id', estado.personas.map((p) => p.id)).is('hasta', null).then(datos).catch(() => []),
    // Lo que de verdad hicieron las últimas 3 semanas (para variar y no repetir).
    sb.from('sesiones').select('id, iniciada_en, rutina_id, series(persona_id, ejercicio_id, reps, peso_kg)').eq('hogar_id', hogar)
      .gte('iniciada_en', new Date(`${hace21}T00:00:00`).toISOString()).order('iniciada_en').then(datos).catch(() => []),
  ]);
  // La versión de esta semana de la rutina que se está mirando (los accesorios rotan solos).
  const estaSemana = rutinaId ? await cargarRutina(rutinaId).then((r) => r.items).catch(() => null) : null;
  const nombreEj = (id) => catalogo.find((e) => e.id === id)?.nombre ?? null;
  const conFamilia = (nombre) => { const f = familiaDe(nombre); return f ? `${nombre} [${f.clave}: ${f.musculo}${f.basico ? ', básico' : ''}]` : nombre; };
  const hoyHecho = sesiones.filter((x) => aISO(new Date(x.iniciada_en)) === hoy)
    .flatMap((x) => (x.series ?? []).map((s) => nombreEj(s.ejercicio_id))).filter(Boolean);
  const dep = deporte(estado.equipo?.deporte);
  const nombreRutina = (id) => rutinas.find((r) => r.id === id)?.nombre ?? null;
  return {
    catalogo, rutinas, items,
    ia: {
      hoy,
      deporte: dep ? { nombre: dep.nombre, exige: dep.exige, zonas: dep.zonas, carga_cuadriceps: CARGA_CUADRICEPS.has(dep.clave) } : null,
      personas: estado.personas.map((p) => ({
        nombre: p.nombre, objetivo: objetivos.find((o) => o.persona_id === p.id)?.foco ?? null,
        experiencia: p.experiencia ?? null, sexo: p.sexo ?? null,
        molestias_activas: molestias.filter((m) => m.persona_id === p.id).map((m) => ({ zona: m.zona, intensidad: ['', 'leve', 'molesta', 'duele'][m.intensidad], nota: m.nota, desde: m.desde })),
      })),
      agenda_proximos_dias: agenda.map((e) => ({ fecha: e.fecha, dia: diaCorto(e.fecha), tipo: e.tipo, hora: e.hora_inicio?.slice(0, 5) ?? null, rutina: nombreRutina(e.rutina_id), actividad: e.actividad })),
      rutina_que_estamos_viendo: rutinaId ? nombreRutina(rutinaId) : null,
      rutina_esta_semana: estaSemana ? estaSemana.map((it) => ({ nombre: it.ejercicio.nombre, ...(it.rotado ? { en_vez_de: it.original.nombre, rota: it.rotado } : {}) })) : null,
      entreno_en_curso: enCurso ? { ya_hechos_hoy: [...new Set(hoyHecho)] } : null,
      historial_ultimas_3_semanas: sesiones.map((x) => ({
        fecha: aISO(new Date(x.iniciada_en)), rutina: nombreRutina(x.rutina_id),
        ejercicios: [...new Set((x.series ?? []).map((s) => nombreEj(s.ejercicio_id)).filter(Boolean))],
      })).filter((x) => x.ejercicios.length),
      rutinas: rutinas.map((r) => ({
        nombre: r.nombre, foco: r.foco,
        ejercicios: items.filter((i) => i.rutina_id === r.id).map((i) => ({ nombre: i.ejercicio.nombre, grupo: i.ejercicio.grupo_muscular, series: i.series_base, reps: i.reps_base })),
      })),
      catalogo: catalogo.map((e) => `${conFamilia(e.nombre)} (${e.grupo_muscular})`),
    },
  };
}

function preguntar(mensaje, ctxIA, historial) {
  return llamarIA('entrenador', { mensaje, contexto: ctxIA, historial }, { manual: 'Puedes editar la rutina a mano.' });
}

/**
 * Abre el chat del entrenador.
 * @param {{ rutinaId?: string, enCurso?: boolean, mensaje?: string, alAplicar?: Function }} op
 */
export async function abrirEntrenador({ rutinaId = null, enCurso = false, mensaje = '', alAplicar = () => {} } = {}) {
  const d = abrirDialogo(`
    <div class="reg chatia">
      ${htmlCabecera({ titulo: 'Entrenador IA', sub: 'Cargando tus rutinas…', subId: 'en-sub' })}
      <div class="chatia__cuerpo" id="en-chat" aria-live="polite">
        <div class="chatia__bienvenida" id="en-hola">${cubo('cubo--grande')}<h3>Entrenador IA</h3><p>Leyendo tus rutinas y tu deporte…</p></div>
      </div>
      <footer class="chatia__pie">
        <div class="chatia__chips" id="en-rapidos"></div>
        ${htmlCompositor({ id: 'en', placeholder: 'Pídele un cambio o una rutina nueva…', foto: false, ids: { texto: 'en-texto', enviar: 'en-enviar' } })}
      </footer>
    </div>`, 'Entrenador IA', { pantalla: true });
  const $ = (q) => d.querySelector(q);
  const chat = $('#en-chat');
  const compositor = conectarCompositor(d, { texto: '#en-texto', enviar: '#en-enviar', alEnviar: () => enviar($('#en-texto').value) });
  const historial = [];
  let datosCtx = null;
  d.proteger = () => !!$('#en-texto').value.trim();

  const burbuja = (rol, html) => {
    chat.insertAdjacentHTML('beforeend', `<div class="chatia__msg chatia__msg--${rol}">${html}</div>`);
    bajar(chat.lastElementChild);
    return chat.lastElementChild;
  };

  try {
    datosCtx = await contexto(rutinaId, enCurso);
  } catch (e) { avisoError(e); d.close(); return; }
  const rutinaActual = datosCtx.rutinas.find((r) => r.id === rutinaId);
  const dep = deporte(estado.equipo?.deporte);
  $('#en-sub').textContent = rutinaActual ? `Ajustando «${rutinaActual.nombre}»${enCurso ? ' · entreno en curso' : ''}` : 'Arma o ajusta tus rutinas';

  const rapidos = rutinaActual
    ? [
      dep && CARGA_CUADRICEPS.has(dep.clave) ? `Menos cuádriceps y más glúteos y femorales, por el ${dep.nombre.toLowerCase()}` : 'Más glúteos y femorales, menos cuádriceps',
      dep?.clave === 'roller_derby' ? 'Agrega un ejercicio de pliometría para derby' : 'Agrega un ejercicio de potencia',
      'Hazla más corta, unos 45 minutos',
      'La máquina está ocupada: cámbiame un ejercicio',
    ]
    : [
      dep ? `Ármame una rutina de piernas pensada para ${dep.nombre.toLowerCase()}` : 'Ármame una rutina de piernas',
      'Ármame una semana de gym según mis días',
      'Una rutina corta de 30 minutos de cuerpo completo',
      'Core y estabilidad para el día de deporte',
    ];
  $('#en-rapidos').innerHTML = rapidos.map((t) => `<button type="button" class="chip chip--mini" data-rapido>${esc(t)}</button>`).join('');

  $('#en-hola').innerHTML = `${cubo('cubo--grande cubo--quieto')}<h3>${rutinaActual ? esc(rutinaActual.nombre) : 'Tu entrenador'}</h3><p>${rutinaActual
    ? `${dep ? `Sé que hacen ${esc(dep.nombre.toLowerCase())} y lo tengo en cuenta. ` : ''}Dime qué quieres cambiar${enCurso ? ', incluso en pleno entreno' : ''}.`
    : `${dep ? `Sé que hacen ${esc(dep.nombre.toLowerCase())}. ` : ''}Te armo rutinas nuevas o ajusto las que tienen. ¿Qué necesitas?`}</p>`;

  const enviar = async (texto) => {
    texto = texto.trim();
    if (!texto) return;
    compositor.limpiar();
    $('#en-rapidos').hidden = true;
    $('#en-hola')?.remove();
    burbuja('yo', esc(texto));
    const pensando = burbujaPensando(chat, ['Pensando…', 'Revisando tus rutinas…', 'Cuidando lo que ya carga el deporte…', 'Eligiendo ejercicios…']);
    $('#en-enviar').disabled = true;
    try {
      const r = await preguntar(texto, datosCtx.ia, historial);
      historial.push({ rol: 'yo', texto }, { rol: 'ia', texto: r.respuesta });
      pensando.terminar(`<span>${esc(r.respuesta || 'Listo.')}</span>`);
      for (const prop of r.rutinas ?? []) pintarPropuesta(prop);
    } catch (e) {
      pensando.terminar(`<span class="quieto">${esc(e.message)}</span>`);
    } finally { $('#en-enviar').disabled = false; }
  };

  // ---------- Propuesta: qué entra, qué sale, y aplicar ----------
  const buscarEjercicio = (nombre) => {
    const n = normal(nombre);
    return datosCtx.catalogo.find((e) => normal(e.nombre) === n)
      ?? datosCtx.catalogo.find((e) => normal(e.nombre).includes(n) || n.includes(normal(e.nombre))) ?? null;
  };
  const rutinaDe = (prop) => {
    if (prop.accion !== 'editar') return null;
    const n = normal(prop.nombre_original || prop.nombre);
    return datosCtx.rutinas.find((r) => normal(r.nombre) === n) ?? (rutinaActual && datosCtx.rutinas.length ? rutinaActual : null);
  };

  const pintarPropuesta = (prop) => {
    const destino = rutinaDe(prop);
    const antes = destino ? datosCtx.items.filter((i) => i.rutina_id === destino.id) : [];
    const ejs = prop.ejercicios.map((e) => ({ ...e, existente: buscarEjercicio(e.nombre) }));
    const idsNuevos = new Set(ejs.map((e) => e.existente?.id).filter(Boolean));
    const salen = antes.filter((i) => !idsNuevos.has(i.ejercicio.id));
    const tarjeta = burbuja('propuesta', `
      <div class="propuesta">
        <p class="propuesta__titulo">${destino ? `Cambios en «${esc(destino.nombre)}»` : `Rutina nueva: «${esc(prop.nombre)}»`}</p>
        <ol class="propuesta__lista">
          ${ejs.map((e) => {
            const estaba = antes.find((i) => i.ejercicio.id === e.existente?.id);
            const yaHoy = enCurso && (datosCtx.ia.entreno_en_curso?.ya_hechos_hoy ?? []).some((n) => normal(n) === normal(e.existente?.nombre ?? e.nombre)) && !estaba;
            const etiqueta = yaHoy ? '<span class="etiqueta etiqueta--mini">ya lo hiciste hoy</span>'
              : !e.existente ? '<span class="etiqueta etiqueta--mini etiqueta--nuevo">nuevo</span>'
              : destino && !estaba ? '<span class="etiqueta etiqueta--mini etiqueta--entra">entra</span>'
              : estaba && (estaba.series_base !== e.series || estaba.reps_base !== e.reps) ? '<span class="etiqueta etiqueta--mini">cambia</span>' : '';
            return `<li><span><strong>${esc(e.existente?.nombre ?? e.nombre)}</strong> ${etiqueta}<span class="quieto"> · ${e.series} × ${e.reps}${e.unidad === 'segundos' ? ' s' : ''}${e.por_lado ? ' por lado' : ''}</span></span>${e.nota && !e.existente ? `<span class="ayuda">${esc(e.nota)}</span>` : ''}</li>`;
          }).join('')}
        </ol>
        ${salen.length ? `<p class="propuesta__salen">Sale: ${salen.map((i) => esc(i.ejercicio.nombre)).join(', ')}</p>` : ''}
        ${destino && enCurso ? '<p class="ayuda" style="margin:6px 0 0">Esto cambia la rutina guardada (también las próximas semanas). Para cambiar solo hoy, usa «¿Ocupada? Cámbiala por» en el ejercicio.</p>' : ''}
        <button type="button" class="boton boton--ia boton--chico" data-aplicar>${CHISPA} ${destino ? 'Aplicar cambios' : 'Crear rutina'}</button>
      </div>`);
    tarjeta.querySelector('[data-aplicar]').addEventListener('click', async (ev) => {
      const b = ev.currentTarget;
      b.disabled = true;
      b.textContent = 'Aplicando…';
      try {
        const id = await aplicar(prop, ejs, destino);
        b.outerHTML = `<p class="propuesta__hecho">✓ ${destino ? 'Cambios aplicados' : 'Rutina creada'}</p>`;
        datosCtx = await contexto(rutinaId, enCurso); // para los próximos pedidos
        aviso(destino ? 'Rutina actualizada.' : 'Rutina creada: la ves al agendar un gym.');
        alAplicar(id);
      } catch (e) {
        avisoError(e);
        b.disabled = false;
        b.innerHTML = `${CHISPA} Reintentar`;
      }
    });
  };

  const aplicar = async (prop, ejs, destino) => {
    const hogar = estado.yo.hogar_id;
    // Los ejercicios que no están en el catálogo se agregan (con la nota de cómo se hace).
    for (const e of ejs) {
      if (e.existente) continue;
      e.existente = datos(await sb.from('ejercicios').insert({
        hogar_id: hogar, nombre: e.nombre, grupo_muscular: e.grupo_muscular, unidad: e.unidad, por_lado: e.por_lado,
        descripcion: e.nota || null, tecnica: e.nota ? [e.nota] : [],
      }).select('id, nombre, grupo_muscular, unidad, por_lado').single());
      datosCtx.catalogo.push(e.existente);
    }
    let rutinaId2 = destino?.id;
    if (!rutinaId2) {
      rutinaId2 = datos(await sb.from('rutinas').insert({
        hogar_id: hogar, nombre: prop.nombre, foco: prop.foco, autor: 'gemini', creada_por: estado.yo.id, notas: prop.notas,
      }).select('id').single()).id;
    } else if (prop.notas || prop.nombre !== destino.nombre) {
      datos(await sb.from('rutinas').update({ notas: prop.notas ?? destino.notas, nombre: prop.nombre || destino.nombre }).eq('id', rutinaId2).select('id'));
    }
    await aplicarEjercicios(rutinaId2, ejs.map((e) => ({ ejercicio_id: e.existente.id, series: e.series, reps: e.reps, descanso: e.descanso_seg })));
    return rutinaId2;
  };

  d.querySelectorAll('[data-rapido]').forEach((b) => b.addEventListener('click', () => enviar(b.textContent)));
  if (mensaje) enviar(mensaje);
  return d;
}

/**
 * Deja la rutina con estos ejercicios en este orden: conserva los que quedan (con las metas y pesos de cada uno),
 * quita los que salen y agrega los nuevos (sus metas se crean solas).
 */
export async function aplicarEjercicios(rutinaId, lista) {
  const actuales = datos(await sb.from('rutina_ejercicios').select('id, ejercicio_id, orden').eq('rutina_id', rutinaId));
  // Se corre el orden para reordenar sin chocar con unique(rutina_id, orden).
  for (const it of actuales) datos(await sb.from('rutina_ejercicios').update({ orden: it.orden + 1000 }).eq('id', it.id).select('id'));
  const quedan = new Set(lista.map((x) => x.ejercicio_id));
  const salen = actuales.filter((it) => !quedan.has(it.ejercicio_id));
  if (salen.length) datos(await sb.from('rutina_ejercicios').delete().in('id', salen.map((x) => x.id)).select('id'));
  const usados = new Set();
  let k = 0;
  for (const x of lista) {
    if (usados.has(x.ejercicio_id)) continue;
    usados.add(x.ejercicio_id);
    k++;
    const previo = actuales.find((it) => it.ejercicio_id === x.ejercicio_id);
    if (previo) {
      datos(await sb.from('rutina_ejercicios').update({ orden: k, series_base: x.series, reps_base: x.reps, ...(x.descanso != null ? { descanso_base: x.descanso } : {}) }).eq('id', previo.id).select('id'));
      datos(await sb.from('metas_ejercicio').update({ series: x.series, reps: x.reps }).eq('rutina_ejercicio_id', previo.id).select('id'));
    } else {
      datos(await sb.from('rutina_ejercicios').insert({ rutina_id: rutinaId, ejercicio_id: x.ejercicio_id, orden: k, series_base: x.series, reps_base: x.reps, descanso_base: x.descanso ?? 90 }).select('id'));
    }
  }
}
