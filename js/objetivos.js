// Mis objetivos: tu deporte, cuántos días vas al gym y al deporte, tu objetivo corporal y tu experiencia.
// Se cambian conversando con la IA («no hago derby esta semana», «voy a ir 2 veces al gym», «cambio a crossfit»):
// la IA propone acciones, las confirmas y la app cambia la agenda, el objetivo o el deporte. La dieta y la carga de
// los entrenos se recalculan solas porque salen de ahí.
import { sb, estado, datos, cargarPersonas } from './db.js';
import { esc, aviso, avisoError, abrirDialogo } from './ui.js';
import { hoyISO, sumarDias, diaCorto } from './fechas.js';
import { deporte, LISTA, nombreDeporte } from './deportes.js';
import { OBJETIVOS } from './nutricion.js';
import { IC } from './iconos.js';
import { htmlCabecera, htmlCompositor, conectarCompositor, burbujaPensando, bajar, htmlBienvenida } from './chatia.js';

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const EXPERIENCIA = { principiante: 'Principiante', intermedio: 'Intermedio', avanzado: 'Avanzado' };
const diaSemana = (f) => new Date(`${f}T12:00`).getDay();
const fechaTxt = (f) => `${diaCorto(f)} ${Number(f.slice(8))}/${Number(f.slice(5, 7))}`;

async function cargar() {
  const yo = estado.yo, hoy = hoyISO();
  const [agenda, obj, cambios, rutinas] = await Promise.all([
    sb.from('calendario').select('id, fecha, tipo, actividad, asistencia, persona_id, rutina_id, hora_inicio, omitido').eq('hogar_id', yo.hogar_id)
      .gte('fecha', hoy).lte('fecha', sumarDias(hoy, 27)).order('fecha').then(datos),
    sb.from('objetivos').select('foco').eq('persona_id', yo.id).order('desde', { ascending: false }).limit(1).then(datos).catch(() => []),
    sb.from('cambios_plan').select('*').eq('persona_id', yo.id).order('creada_en', { ascending: false }).limit(10).then(datos).catch(() => []),
    sb.from('rutinas').select('id, nombre, foco').eq('hogar_id', yo.hogar_id).order('creada_en').then(datos).catch(() => []),
  ]);
  const mios = agenda.filter((e) => !e.omitido && (e.asistencia === 'juntos' || e.persona_id === yo.id));
  const dos = mios.filter((e) => e.fecha < sumarDias(hoy, 14));
  const patron = (tipos) => {
    const evs = dos.filter((e) => tipos.includes(e.tipo));
    const dias = [...new Set(evs.map((e) => diaSemana(e.fecha)))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    return { porSemana: Math.round(evs.length / 2 * 10) / 10, dias };
  };
  return {
    agenda, mios, rutinas, foco: obj[0]?.foco ?? 'recomposicion',
    gym: patron(['gym']), deporte: patron(['derby', 'otro']),
    cambios: cambios.filter((c) => !c.hasta || c.hasta >= hoy),
  };
}

/** La tarjeta de Perfil. */
export async function htmlMisObjetivos() {
  const d = await cargar();
  const dep = deporte(estado.equipo?.deporte);
  const veces = (p) => (p.porSemana ? `${String(p.porSemana).replace('.', ',')} ${p.porSemana === 1 ? 'vez' : 'veces'} por semana${p.dias.length ? ` · ${p.dias.map((x) => DIAS[x]).join(', ')}` : ''}` : 'Nada agendado');
  return `
    <section class="tarjeta mis-objetivos" id="mis-objetivos">
      <div class="fila fila--entre"><h2 class="seccion__titulo" style="margin:0">Mis objetivos</h2></div>
      <div class="obj-lista">
        <div class="obj-item"><span class="obj-item__icono" aria-hidden="true">${IC.medalla}</span><span><small>Deporte</small><strong>${esc(dep.nombre)}</strong><em>${esc(veces(d.deporte))}</em></span></div>
        <div class="obj-item"><span class="obj-item__icono" aria-hidden="true">${IC.pesa}</span><span><small>Gym</small><strong>${esc(veces(d.gym))}</strong></span></div>
        <div class="obj-item"><span class="obj-item__icono" aria-hidden="true">${IC.objetivo}</span><span><small>Objetivo corporal</small><strong>${esc(OBJETIVOS[d.foco]?.nombre ?? '')}</strong></span></div>
        <div class="obj-item"><span class="obj-item__icono" aria-hidden="true">${IC.grafico}</span><span><small>Experiencia en el gym</small><strong>${esc(EXPERIENCIA[estado.yo.experiencia] ?? 'Sin definir')}</strong></span></div>
      </div>
      ${d.cambios.length ? `<div class="obj-cambios"><small>Cambios activos</small>${d.cambios.slice(0, 4).map((c) => `<span class="obj-cambio">${esc(c.descripcion ?? '')}</span>`).join('')}</div>` : ''}
      <button type="button" class="boton boton--ia boton--bloque" id="obj-ia">${'<svg class="icono" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>'} Cambiar mis objetivos</button>
      <p class="ayuda" style="margin:0">Ej.: «esta semana no hago derby», «el sábado en vez de derby vamos al gym», «ahora quiero ganar músculo». Tu dieta y tus entrenos se readaptan solos.</p>
    </section>`;
}

export function conectarMisObjetivos(cont, alCambiar) {
  cont.querySelector('#obj-ia')?.addEventListener('click', () => abrirObjetivosIA({ alCambiar }));
}

// ---------- Aplicar las acciones ----------
const otro = () => estado.personas.find((p) => p.id !== estado.yo.id);
const tiposDe = (actividad) => (actividad === 'gym' ? ['gym'] : actividad === 'todo' ? ['gym', 'derby', 'otro'] : ['derby', 'otro']);

/** Saca a esta persona (o a todos) de un entreno: se borra; si es «juntos» y solo se baja uno, queda solo para el otro. */
async function sacarDe(e, quien) {
  const yo = estado.yo.id;
  if (quien === 'todos' || estado.personas.length === 1 || e.persona_id === yo) {
    datos(await sb.from('calendario').delete().eq('id', e.id).select('id'));
  } else if (e.asistencia === 'juntos' && estado.personas.length === 2) {
    datos(await sb.from('calendario').update({ asistencia: 'solo', persona_id: otro().id }).eq('id', e.id).select('id'));
  }
}

async function aplicar(a, d) {
  const yo = estado.yo, hoy = hoyISO();
  const registrar = (extra) => sb.from('cambios_plan').insert({ persona_id: yo.id, tipo: a.tipo, descripcion: a.resumen, ...extra }).then(() => {}, () => {});
  if (a.tipo === 'pausa') {
    const desde = a.desde && a.desde > hoy ? a.desde : hoy, hasta = a.hasta ?? sumarDias(desde, 6);
    const evs = d.agenda.filter((e) => !e.omitido && e.fecha >= desde && e.fecha <= hasta && tiposDe(a.actividad).includes(e.tipo)
      && !(a.actividad === 'deporte' && e.tipo === 'otro' && ['caminar', 'yoga', 'clase'].includes(e.actividad))
      && (a.quien === 'todos' || e.asistencia === 'juntos' || e.persona_id === yo.id));
    for (const e of evs) await sacarDe(e, a.quien);
    await registrar({ desde, hasta });
    return `${evs.length} entreno${evs.length === 1 ? '' : 's'} fuera de tu agenda`;
  }
  if (a.tipo === 'frecuencia_gym') {
    if (!a.dias?.length) throw new Error('Faltan los días.');
    const desde = a.desde && a.desde > hoy ? a.desde : sumarDias(hoy, 1);
    const futuros = d.agenda.filter((e) => e.tipo === 'gym' && !e.omitido && e.fecha >= desde && (e.asistencia === 'juntos' || e.persona_id === yo.id));
    // Las rutinas siguen rotando en el mismo orden; la hora, la más usada.
    const rutinas = [...new Set(futuros.map((e) => e.rutina_id).filter(Boolean))];
    const horas = futuros.map((e) => e.hora_inicio).filter(Boolean);
    const hora = horas.sort((x, y) => horas.filter((h) => h === y).length - horas.filter((h) => h === x).length)[0] ?? null;
    const soloYo = a.quien === 'yo' && estado.personas.length === 2;
    for (const e of futuros) {
      if (soloYo && e.asistencia === 'juntos') datos(await sb.from('calendario').update({ asistencia: 'solo', persona_id: otro().id }).eq('id', e.id).select('id'));
      else datos(await sb.from('calendario').delete().eq('id', e.id).select('id'));
    }
    const nuevos = [];
    let k = 0;
    for (let i = 0; i < 28; i++) {
      const f = sumarDias(desde, i);
      if (!a.dias.includes(diaSemana(f))) continue;
      nuevos.push({
        hogar_id: yo.hogar_id, fecha: f, tipo: 'gym', hora_inicio: hora, rutina_id: rutinas.length ? rutinas[k++ % rutinas.length] : null,
        asistencia: soloYo || (a.quien === 'yo' && estado.personas.length > 2) ? 'solo' : 'juntos', persona_id: soloYo ? yo.id : null,
      });
    }
    if (nuevos.length) datos(await sb.from('calendario').insert(nuevos).select('id'));
    await registrar({ desde });
    return `Gym ${a.dias.length} ${a.dias.length === 1 ? 'vez' : 'veces'} por semana (${a.dias.sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7)).map((x) => DIAS[x]).join(', ')})`;
  }
  if (a.tipo === 'cambiar_dia') return cambiarDia(a, d);
  if (a.tipo === 'objetivo') {
    if (!OBJETIVOS[a.foco]) throw new Error('Objetivo no válido.');
    datos(await sb.from('objetivos').delete().eq('persona_id', yo.id).eq('desde', hoy).select('id'));
    datos(await sb.from('objetivos').insert({ persona_id: yo.id, foco: a.foco }).select('id'));
    await registrar({ desde: hoy });
    return `Objetivo: ${OBJETIVOS[a.foco].nombre}`;
  }
  if (a.tipo === 'deporte') {
    if (!LISTA.some((x) => x.clave === a.deporte)) throw new Error('No conozco ese deporte.');
    const { editarEquipo } = await import('./equipo.js');
    await editarEquipo({ deporte: a.deporte });
    if (estado.equipo) estado.equipo.deporte = a.deporte;
    await registrar({ desde: hoy });
    return `Deporte: ${nombreDeporte(a.deporte)}`;
  }
  if (a.tipo === 'experiencia') {
    datos(await sb.from('personas').update({ experiencia: a.experiencia }).eq('id', yo.id).select('id'));
    yo.experiencia = a.experiencia;
    await cargarPersonas().catch(() => {});
    return `Experiencia: ${EXPERIENCIA[a.experiencia]}`;
  }
  return 'Listo';
}

// Un día puntual: saca el entreno que había (para ti o para todos) y pone el nuevo, con su rutina.
const normal = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
async function cambiarDia(a, d) {
  const yo = estado.yo;
  if (!a.fecha || a.fecha < hoyISO()) throw new Error('Ese día ya pasó.');
  const deTipos = a.de === 'gym' ? ['gym'] : a.de === 'deporte' ? ['derby', 'otro', 'clase'] : a.de === 'otro' ? ['otro', 'clase'] : ['gym', 'derby', 'otro', 'clase'];
  const evs = d.agenda.filter((e) => e.fecha === a.fecha && !e.omitido && deTipos.includes(e.tipo)
    && (a.quien === 'todos' || e.asistencia === 'juntos' || e.persona_id === yo.id));
  const hora = a.hora ?? evs.find((e) => e.hora_inicio)?.hora_inicio ?? null;
  for (const e of evs) await sacarDe(e, a.quien);
  let nuevo = null;
  if (a.a !== 'descanso') {
    const rutina = a.a === 'gym' && a.rutina ? d.rutinas.find((r) => normal(r.nombre) === normal(a.rutina))
      ?? d.rutinas.find((r) => normal(r.nombre).includes(normal(a.rutina)) || normal(a.rutina).includes(normal(r.nombre))) : null;
    const tipo = a.a === 'gym' ? 'gym' : a.a === 'deporte' ? (estado.equipo?.deporte === 'roller_derby' ? 'derby' : 'otro') : 'otro';
    const soloYo = a.quien === 'yo' && estado.personas.length > 1;
    // Si ese día ya tenía un gym (y no era lo que se cambió), no se duplica: se le pone la rutina nueva.
    const yaHay = tipo === 'gym' && d.agenda.find((e) => e.fecha === a.fecha && e.tipo === 'gym' && !e.omitido && !evs.includes(e)
      && (e.asistencia === 'juntos' || e.persona_id === yo.id));
    if (yaHay) {
      if (rutina) datos(await sb.from('calendario').update({ rutina_id: rutina.id }).eq('id', yaHay.id).select('id'));
      nuevo = { id: yaHay.id };
    } else nuevo = datos(await sb.from('calendario').insert({
      hogar_id: yo.hogar_id, fecha: a.fecha, tipo, hora_inicio: hora, rutina_id: rutina?.id ?? null,
      actividad: tipo === 'otro' && a.a === 'deporte' ? estado.equipo?.deporte ?? null : null,
      asistencia: soloYo ? 'solo' : 'juntos', persona_id: soloYo ? yo.id : null,
    }).select('id').single());
    // Si pidió una rutina que no existe, después se ofrece armarla y queda asignada a este día.
    if (a.a === 'gym' && !rutina && a.crear_rutina) a.pendiente = { eventoId: nuevo.id, que: a.crear_rutina };
  }
  await sb.from('cambios_plan').insert({ persona_id: yo.id, tipo: 'cambiar_dia', descripcion: a.resumen, desde: a.fecha, hasta: a.fecha }).then(() => {}, () => {});
  return a.resumen || `${fechaTxt(a.fecha)}: cambiado`;
}

// ---------- El chat ----------
export function abrirObjetivosIA({ alCambiar = () => {} } = {}) {
  const dlg = abrirDialogo(`
    <div class="reg chatia">
      ${htmlCabecera({ titulo: 'Mis objetivos', sub: 'Cambia tu plan conversando' })}
      <div class="chatia__cuerpo" id="ob-chat" aria-live="polite">
        <div id="ob-hola">${htmlBienvenida({
          titulo: '¿Qué cambió?',
          texto: 'Cuéntame si vas a dejar el deporte unos días, si un día cambias un entreno por otro, si cambias de deporte, si vas a ir más o menos al gym o si cambia tu objetivo. Yo readapto tu plan, tu dieta y tus entrenos.',
          sugerencias: [
            { icono: IC.pausa, texto: 'Esta semana no voy a hacer mi deporte' },
            { icono: IC.pesa, texto: 'Voy a ir solo 2 veces al gym' },
            { icono: IC.objetivo, texto: 'Ahora quiero ganar músculo' },
            { icono: IC.cambio, texto: 'Cambié de deporte' },
            { icono: IC.calendario, texto: 'Un día cambio el deporte por gym' },
          ],
        })}</div>
      </div>
      <footer class="chatia__pie">${htmlCompositor({ id: 'ob', placeholder: 'Ej.: no voy a derby hasta el domingo', foto: false, ids: { texto: 'ob-texto', enviar: 'ob-enviar' } })}</footer>
    </div>`, 'Mis objetivos', { pantalla: true });
  const $ = (q) => dlg.querySelector(q);
  const chat = $('#ob-chat');
  const historial = [];
  let datosPlan = null;
  const recargarDatos = async () => { datosPlan = await cargar(); };
  recargarDatos().catch(() => {});
  dlg.proteger = () => !!$('#ob-texto').value.trim();

  const burbuja = (rol, html) => {
    $('#ob-hola')?.remove();
    chat.insertAdjacentHTML('beforeend', `<div class="chatia__msg chatia__msg--${rol}">${html}</div>`);
    bajar(chat.lastElementChild);
    return chat.lastElementChild;
  };
  const contexto = () => {
    const d = datosPlan;
    const dep = deporte(estado.equipo?.deporte);
    return {
      hoy: hoyISO(), dia_de_hoy: DIAS[diaSemana(hoyISO())],
      quien_escribe: estado.yo.nombre, personas_del_hogar: estado.personas.map((p) => p.nombre),
      deporte: { clave: dep.clave, nombre: dep.nombre }, objetivo: d?.foco, experiencia: estado.yo.experiencia ?? null,
      gym: d ? { veces_por_semana: d.gym.porSemana, dias: d.gym.dias.map((x) => DIAS[x]) } : null,
      deporte_agenda: d ? { veces_por_semana: d.deporte.porSemana, dias: d.deporte.dias.map((x) => DIAS[x]) } : null,
      agenda_proximas_3_semanas: (d?.agenda ?? []).filter((e) => e.fecha < sumarDias(hoyISO(), 21) && e.tipo !== 'descanso').map((e) => ({
        fecha: e.fecha, dia: DIAS[diaSemana(e.fecha)], tipo: e.tipo, actividad: e.actividad, rutina: d.rutinas.find((r) => r.id === e.rutina_id)?.nombre ?? null, quien: e.asistencia === 'juntos' ? 'juntos' : (estado.personas.find((p) => p.id === e.persona_id)?.nombre ?? ''), cancelado: e.omitido,
      })),
      cambios_activos: (d?.cambios ?? []).map((c) => c.descripcion),
      rutinas_del_hogar: (d?.rutinas ?? []).map((r) => r.nombre),
      deportes_posibles: LISTA.map((x) => `${x.clave}: ${x.nombre}`).join('; '),
    };
  };

  const enviar = async (texto) => {
    texto = (texto ?? $('#ob-texto').value).trim();
    if (!texto) return;
    compositor.limpiar();
    burbuja('yo', esc(texto));
    const pensando = burbujaPensando(chat, ['Pensando…', 'Revisando tu agenda…', 'Viendo cómo readaptar tu plan…']);
    $('#ob-enviar').disabled = true;
    try {
      if (!datosPlan) await recargarDatos();
      const espera = new Promise((_, no) => setTimeout(() => no(new Error('La IA tardó demasiado. Prueba de nuevo.')), 70000));
      const { data: r, error } = await Promise.race([sb.functions.invoke('objetivos', { body: { mensaje: texto, contexto: contexto(), historial: historial.slice(-8) } }), espera]);
      if (error) throw new Error('No se pudo conectar con la IA. Prueba en un rato.');
      historial.push({ rol: 'yo', texto }, { rol: 'ia', texto: [r.respuesta, r.duda].filter(Boolean).join(' ') });
      pensando.terminar(`<span>${esc(r.respuesta || 'Listo.')}</span>${r.duda ? `<p class="ia-msg__duda">${esc(r.duda)}</p>` : ''}${r.opciones?.length ? `<div class="chips ia-msg__opciones">${r.opciones.map((o, k) => `<button type="button" class="chip chip--mini" data-op="${k}">${esc(o)}</button>`).join('')}</div>` : ''}`);
      pensando.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', () => { pensando.querySelector('.ia-msg__opciones')?.remove(); enviar(r.opciones[Number(b.dataset.op)]); }));
      if (r.acciones?.length) {
        const t = burbuja('propuesta', `
          <div class="medicion-ia">
            <p class="medicion-ia__titulo">Cambios en tu plan</p>
            <ul class="obj-acciones">${r.acciones.map((a) => `<li>${esc(a.resumen)}${a.quien === 'yo' && estado.personas.length > 1 && a.tipo !== 'objetivo' && a.tipo !== 'experiencia' ? ' <span class="quieto">(solo tú)</span>' : ''}</li>`).join('')}</ul>
            <div class="medicion-ia__acciones"><button type="button" class="chatia__seguir" data-aplicar>Aplicar</button></div>
          </div>`);
        t.querySelector('[data-aplicar]').addEventListener('click', async (e) => {
          const b = e.currentTarget;
          b.disabled = true; b.textContent = 'Aplicando…';
          try {
            await recargarDatos();
            const hechos = [];
            for (const a of r.acciones) hechos.push(await aplicar(a, datosPlan));
            await recargarDatos();
            b.parentElement.innerHTML = `<p class="propuesta__hecho">✓ ${esc(hechos.join(' · '))}</p>`;
            aviso('Plan actualizado: tu dieta y tus entrenos ya se readaptaron.');
            import('./nativo.js').then((m) => m.sincronizarAgenda?.().catch(() => {}));
            alCambiar();
            // Una rutina que no existía (ej. pliometría): se ofrece armarla y queda puesta en ese día.
            for (const a of r.acciones.filter((x) => x.pendiente)) {
              const o = burbuja('ia', `<span>No tienen una rutina de ${esc(a.pendiente.que)}. ¿Te la armo y la dejo puesta para el ${esc(fechaTxt(a.fecha))}?</span><div class="chips"><button type="button" class="chip chip--mini chip--sugerencia" data-armar>✦ Sí, armar la rutina</button></div>`);
              o.querySelector('[data-armar]').addEventListener('click', async (ev) => {
                ev.currentTarget.closest('.chips').remove();
                const { abrirEntrenador } = await import('./entrenador.js');
                abrirEntrenador({
                  mensaje: `Ármame una rutina de ${a.pendiente.que} para el ${fechaTxt(a.fecha)} (va en lugar del ${a.de === 'gym' ? 'gym de siempre' : nombreDeporte(estado.equipo?.deporte).toLowerCase()} de ese día).`,
                  alAplicar: async (id) => {
                    try {
                      datos(await sb.from('calendario').update({ rutina_id: id }).eq('id', a.pendiente.eventoId).select('id'));
                      aviso(`Rutina puesta para el ${fechaTxt(a.fecha)}.`);
                      alCambiar();
                    } catch (err) { avisoError(err); }
                  },
                });
              });
            }
            // Si cambió el deporte o la frecuencia, se ofrece ajustar las rutinas.
            if (r.acciones.some((a) => a.tipo === 'deporte' || a.tipo === 'frecuencia_gym')) {
              const o = burbuja('ia', `<span>¿Ajusto tus rutinas al nuevo plan?</span><div class="chips"><button type="button" class="chip chip--mini chip--sugerencia" data-rutinas>✦ Sí, ajustar rutinas</button></div>`);
              o.querySelector('[data-rutinas]').addEventListener('click', async () => {
                const { abrirEntrenador } = await import('./entrenador.js');
                abrirEntrenador({ mensaje: r.acciones.some((a) => a.tipo === 'deporte')
                  ? `Cambié de deporte a ${deporte(estado.equipo?.deporte).nombre}. Ajusta mis rutinas para complementarlo.`
                  : `Ahora voy al gym ${r.acciones.find((a) => a.tipo === 'frecuencia_gym')?.dias?.length} veces por semana. Reorganiza mis rutinas para esa cantidad de días.` });
              });
            }
          } catch (err) { avisoError(err); b.disabled = false; b.textContent = 'Reintentar'; }
        });
      }
    } catch (e) {
      pensando.terminar(`<span class="quieto">${esc(e.message)}</span>`);
    } finally { $('#ob-enviar').disabled = false; }
  };
  const compositor = conectarCompositor(dlg, { texto: '#ob-texto', enviar: '#ob-enviar', alEnviar: () => enviar() });
  dlg.querySelectorAll('[data-sugerencia]').forEach((b) => b.addEventListener('click', () => {
    const k = Number(b.dataset.sugerencia);
    const t = ['Esta semana no voy a hacer mi deporte', 'Voy a ir solo 2 veces al gym', 'Ahora quiero ganar músculo', 'Cambié de deporte'][k];
    const prellenar = { 3: 'Cambié de deporte a ', 4: `El sábado en vez de ${nombreDeporte(estado.equipo?.deporte).toLowerCase()} vamos al gym a hacer ` }[k];
    if (prellenar) { $('#ob-texto').value = prellenar; $('#ob-texto').focus(); compositor.actualizar(); return; }
    enviar(t);
  }));
  return dlg;
}

