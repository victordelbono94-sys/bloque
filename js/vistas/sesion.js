// Sesión en vivo: los dos entrenan la misma rutina, cada uno registra sus series.
// Entre series hay temporizador de descanso y sugerencias según cómo se sintió.
// Al terminar, las metas se ajustan con lo que hizo cada uno.
import { sb, estado, datos } from '../db.js';
import { esc, num, aviso, avisoError, abrirDialogo, grupoChips, valorChips } from '../ui.js';
import { hoyISO } from '../fechas.js';
import { cargarRutina, textoMeta, redondearPeso } from '../rutinas.js';
import { textoSemaforo } from '../semaforo.js';
import { abrirFicha, miniatura } from '../ficha.js';

const ESFUERZOS = [
  { valor: 6, texto: 'Fácil' },
  { valor: 8, texto: 'Justo' },
  { valor: 10, texto: 'Al límite' },
];

// ---------- Empezar o unirse ----------

export async function empezarSesion(evento) {
  const abiertas = datos(await sb.from('sesiones').select('id, terminados')
    .eq('calendario_id', evento.id).is('terminada_en', null).order('iniciada_en', { ascending: false }).limit(1));
  let id = abiertas[0]?.id;
  if (!id) {
    const nueva = datos(await sb.from('sesiones').insert({
      hogar_id: estado.yo.hogar_id,
      calendario_id: evento.id,
      rutina_id: evento.rutina_id,
      iniciada_por: estado.yo.id,
    }).select('id').single());
    id = nueva.id;
  }
  location.hash = `#/sesion/${id}`;
}

// ---------- Estado de la pantalla ----------

let actual = null;        // { sesion, rutina, items, participantes, series, sugerencias, cambios }
let sondeo = null;        // intervalo que trae las series del otro
let reloj = null;         // intervalo del tiempo transcurrido
let descanso = null;      // { fin, intervalo }

function limpiar() {
  clearInterval(sondeo); sondeo = null;
  clearInterval(reloj); reloj = null;
  pararDescanso();
}

window.addEventListener('hashchange', () => {
  if (!location.hash.startsWith('#/sesion/')) limpiar();
});

const claveCambios = (id) => `bloque-cambios-${id}`;
function leerCambios(id) {
  try { return JSON.parse(localStorage.getItem(claveCambios(id)) || '{}'); } catch { return {}; }
}
function guardarCambios(id, cambios) {
  try { localStorage.setItem(claveCambios(id), JSON.stringify(cambios)); } catch { /* sin almacenamiento: solo dura esta visita */ }
}

// ---------- Vista ----------

export async function vistaSesion(app) {
  limpiar();
  const id = location.hash.split('/')[2];
  const sesion = datos(await sb.from('sesiones').select('*').eq('id', id).maybeSingle());
  if (!sesion) {
    app.innerHTML = '<p class="vacio">No encontré ese entreno.</p><a class="boton boton--sec" href="#/hoy">Volver a Hoy</a>';
    return;
  }
  const [{ rutina, items }, evento, series, miEstado] = await Promise.all([
    cargarRutina(sesion.rutina_id),
    sesion.calendario_id ? sb.from('calendario').select('*').eq('id', sesion.calendario_id).maybeSingle().then(datos) : null,
    sb.from('series').select('*').eq('sesion_id', id).order('hecha_en').then(datos),
    sb.from('estado_diario').select('*').eq('persona_id', estado.yo.id).eq('fecha', hoyISO()).maybeSingle().then(datos),
  ]);

  const participantes = !evento || evento.asistencia === 'juntos'
    ? estado.personas
    : estado.personas.filter((p) => p.id === evento.persona_id);
  // Yo primero; si el evento era "solo" de otro, igual puedo mirar.
  participantes.sort((a, b) => (a.id === estado.yo.id ? -1 : b.id === estado.yo.id ? 1 : 0));

  actual = { sesion, rutina, items, participantes, series, sugerencias: {}, cambios: leerCambios(id) };
  const yoParticipo = participantes.some((p) => p.id === estado.yo.id);
  const terminé = sesion.terminados.includes(estado.yo.id);
  const sem = miEstado?.semaforo;

  app.innerHTML = `
    <header class="encabezado">
      <div>
        <a href="#/hoy" class="boton boton--texto" style="padding:0;min-height:32px">‹ Hoy</a>
        <h1 class="titulo">${esc(rutina.nombre)}</h1>
        <p class="subtitulo"><span id="transcurrido"></span> · ${esc(participantes.length > 1 ? `${participantes.filter((p) => p.id !== estado.yo.id).map((p) => p.nombre).join(', ')} y yo` : (participantes[0]?.id === estado.yo.id ? 'Solo yo' : `Solo ${participantes[0]?.nombre ?? ''}`))}</p>
      </div>
    </header>

    ${sem && sem !== 'verde' ? `
      <div class="aviso-fijo aviso-fijo--${sem}">
        <span class="punto punto--${sem}" aria-hidden="true"></span>
        <div>
          <strong>${esc(textoSemaforo(sem, false))}</strong>
          <p style="margin:2px 0 0">${sem === 'rojo'
            ? 'Hoy conviene descansar. Si igual entrenas, hazlo suave y corto.'
            : 'Baja un 10 % el peso o haz una serie menos en los ejercicios pesados.'}${miEstado.motivo ? ` (${esc(miEstado.motivo)})` : ''}</p>
        </div>
      </div>` : ''}

    <div class="pila" id="ejercicios">
      ${items.map((it, i) => tarjetaEjercicio(it, i)).join('')}
    </div>

    ${yoParticipo ? `
      <button type="button" class="boton boton--bloque" style="margin-top:20px" id="terminar" ${terminé ? 'disabled' : ''}>
        ${terminé ? 'Ya terminaste este entreno' : 'Terminar mi entreno'}
      </button>` : ''}`;

  conectar(app);

  const pintarReloj = () => {
    const el = app.querySelector('#transcurrido');
    if (!el) return;
    const min = Math.max(0, Math.round((Date.now() - new Date(sesion.iniciada_en)) / 60000));
    el.textContent = min < 1 ? 'Recién empieza' : `${min} min`;
  };
  pintarReloj();
  reloj = setInterval(pintarReloj, 30000);

  // Trae cada pocos segundos lo que registra el otro.
  if (participantes.length > 1) {
    sondeo = setInterval(async () => {
      if (!actual || actual.sesion.id !== id || document.hidden) return;
      const { data } = await sb.from('series').select('*').eq('sesion_id', id).order('hecha_en');
      if (!data) return;
      actual.series = data;
      actual.participantes.filter((p) => p.id !== estado.yo.id).forEach((p) =>
        actual.items.forEach((it) => repintarFila(app, it, p)));
    }, 8000);
  }
}

function ejercicioDe(it, personaId) {
  // Para mí: el que elegí en esta sesión. Para el otro: el que registró.
  if (personaId === estado.yo.id) {
    const altId = actual.cambios[it.id];
    return it.alternativas.find((a) => a.id === altId) ?? it.ejercicio;
  }
  const hecha = actual.series.find((s) => s.persona_id === personaId && s.sustituye_a === it.ejercicio.id);
  return hecha ? (it.alternativas.find((a) => a.id === hecha.ejercicio_id) ?? it.ejercicio) : it.ejercicio;
}

function seriesDe(it, personaId) {
  return actual.series
    .filter((s) => s.persona_id === personaId && (s.ejercicio_id === it.ejercicio.id || s.sustituye_a === it.ejercicio.id))
    .sort((a, b) => a.numero - b.numero);
}

function tarjetaEjercicio(it, i) {
  const mio = ejercicioDe(it, estado.yo.id);
  const cambiado = mio.id !== it.ejercicio.id;
  return `
    <article class="tarjeta" id="ej-${esc(it.id)}">
      <button type="button" class="ejercicio__cabeza" data-ficha="${esc(it.id)}" aria-label="Cómo se hace ${esc(mio.nombre)}">
        ${miniatura(mio, 64)}
        <span style="min-width:0;flex:1">
          <span class="fila" style="gap:8px;align-items:baseline">
            <span class="numero-ejercicio">${i + 1}</span>
            <span class="ejercicio__nombre">${esc(mio.nombre)}</span>
          </span>
          <span class="quieto" style="display:block;margin:4px 0 0">${esc(mio.grupo_muscular)}${mio.maquina ? ` · ${esc(mio.maquina.nombre)}` : ''}${cambiado ? ` · en vez de ${esc(it.ejercicio.nombre)}` : ''}</span>
          <span class="ejercicio__como">Cómo se hace ›</span>
        </span>
      </button>
      ${it.alternativas.length && actual.participantes.some((p) => p.id === estado.yo.id) ? `
        <button type="button" class="boton boton--sec boton--chico boton--ocupada" style="margin-top:10px" data-cambiar="${esc(it.id)}">
          ¿Máquina ocupada? Cambiar ejercicio
        </button>` : ''}
      <div class="pila" style="gap:10px;margin-top:14px">
        ${actual.participantes.map((p) => `<div id="fila-${esc(it.id)}-${esc(p.id)}">${filaPersona(it, p)}</div>`).join('')}
      </div>
    </article>`;
}

function filaPersona(it, p) {
  const soyYo = p.id === estado.yo.id;
  const meta = it.metas[p.id];
  const ej = ejercicioDe(it, p.id);
  const hechas = seriesDe(it, p.id);
  const planeadas = meta?.series ?? it.series_base;
  const total = Math.max(planeadas, hechas.length);
  const unidad = ej.unidad === 'segundos' ? 's' : '';

  const huecos = Array.from({ length: total }, (_, k) => {
    const s = hechas[k];
    const texto = s
      ? `${s.reps}${unidad}${s.peso_kg != null ? `×${num(s.peso_kg, s.peso_kg % 1 ? 1 : 0)}` : ''}`
      : String(k + 1);
    const clase = `serie ${s ? 'serie--hecha' : ''} ${s?.esfuerzo === 10 ? 'serie--limite' : ''}`;
    if (!soyYo) return `<span class="${clase}" aria-label="Serie ${k + 1}${s ? `: ${texto}` : ', pendiente'}">${esc(texto)}</span>`;
    return `<button type="button" class="${clase}" data-serie="${k + 1}" data-re="${esc(it.id)}" aria-label="Serie ${k + 1}${s ? `: ${texto}, editar` : ', registrar'}">${esc(texto)}</button>`;
  }).join('');

  const extra = soyYo && hechas.length >= planeadas
    ? `<button type="button" class="serie serie--extra" data-serie="${hechas.length + 1}" data-re="${esc(it.id)}" aria-label="Agregar una serie">+</button>` : '';
  const sugerencia = soyYo ? actual.sugerencias[it.id] : null;
  const pesoDefinir = meta && meta.peso_kg == null && ej.unidad === 'reps' && !hechas.length;

  return `
    <div class="fila fila--entre" style="gap:8px">
      <span class="meta-fila__nombre">${esc(soyYo ? 'Yo' : p.nombre)}</span>
      <span class="quieto">${esc(textoMeta(meta, ej.unidad))}${pesoDefinir ? ' · elige tu peso' : ''}</span>
    </div>
    <div class="series" style="margin-top:6px">${huecos}${extra}</div>
    ${sugerencia ? `<p class="sugerencia">${esc(sugerencia)}</p>` : ''}`;
}

function repintarFila(app, it, p) {
  const cont = app.querySelector(`#fila-${CSS.escape(it.id)}-${CSS.escape(p.id)}`);
  if (!cont) return;
  cont.innerHTML = filaPersona(it, p);
  if (p.id === estado.yo.id) conectarFila(app, cont);
}

function conectar(app) {
  app.querySelectorAll('[id^="fila-"]').forEach((cont) => conectarFila(app, cont));
  app.querySelectorAll('[data-cambiar]').forEach((b) => b.addEventListener('click', () => {
    const it = actual.items.find((x) => x.id === b.dataset.cambiar);
    elegirAlternativa(app, it);
  }));
  app.querySelectorAll('[data-ficha]').forEach((b) => b.addEventListener('click', () => {
    verFicha(app, actual.items.find((x) => x.id === b.dataset.ficha));
  }));
  app.querySelector('#terminar')?.addEventListener('click', () => terminar(app));
}

function conectarFila(app, cont) {
  cont.querySelectorAll('button[data-serie]').forEach((b) => b.addEventListener('click', () => {
    const it = actual.items.find((x) => x.id === b.dataset.re);
    registrarSerie(app, it, Number(b.dataset.serie));
  }));
}

// ---------- Cambiar de ejercicio ----------

// Ficha del ejercicio que estoy haciendo, con las alternativas listas para usar.
function verFicha(app, it) {
  const mio = ejercicioDe(it, estado.yo.id);
  const opciones = [it.ejercicio, ...it.alternativas].filter((o) => o.id !== mio.id);
  const participo = actual.participantes.some((p) => p.id === estado.yo.id);
  abrirFicha(mio, {
    alternativas: opciones,
    actualId: mio.id,
    alElegir: participo ? (id) => aplicarCambio(app, it, id) : null,
  });
}

function elegirAlternativa(app, it) {
  const actualId = ejercicioDe(it, estado.yo.id).id;
  const opciones = [it.ejercicio, ...it.alternativas];
  const d = abrirDialogo(`
    <div class="dialogo">
      <h2 class="tarjeta__titulo">Cambiar ejercicio</h2>
      <p class="quieto" style="margin:-8px 0 0">Solo para ti en este entreno. Trabajan el mismo grupo muscular.</p>
      <div class="pila" style="gap:8px">
        ${opciones.map((o) => `
          <div class="alternativa ${o.id === actualId ? 'alternativa--actual' : ''}">
            <button type="button" class="alternativa__ver" data-op="${esc(o.id)}" aria-pressed="${o.id === actualId}">
              ${miniatura(o, 48)}
              <span class="alternativa__texto">
                <strong>${esc(o.nombre)}</strong>
                <span class="quieto">${o.id === it.ejercicio.id ? 'El de la rutina' : esc(o.maquina?.nombre ?? 'Peso libre')}</span>
              </span>
            </button>
            <button type="button" class="boton boton--texto boton--chico" data-info="${esc(o.id)}" aria-label="Cómo se hace ${esc(o.nombre)}">Ver</button>
          </div>`).join('')}
      </div>
      <div class="dialogo__pie"><button type="button" class="boton boton--sec" data-cerrar>Cerrar</button></div>
    </div>`, 'Cambiar ejercicio');
  d.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', () => {
    d.close();
    aplicarCambio(app, it, b.dataset.op);
  }));
  d.querySelectorAll('[data-info]').forEach((b) => b.addEventListener('click', () => {
    const o = opciones.find((x) => x.id === b.dataset.info);
    d.close();
    setTimeout(() => abrirFicha(o, {
      alternativas: opciones.filter((x) => x.id !== o.id),
      actualId,
      alElegir: (id) => aplicarCambio(app, it, id),
      alUsarEste: o.id !== actualId ? () => aplicarCambio(app, it, o.id) : null,
    }), 200);
  }));
}

function aplicarCambio(app, it, opId) {
  const actualId = ejercicioDe(it, estado.yo.id).id;
  if (opId === actualId) return;
  if (seriesDe(it, estado.yo.id).length) {
    aviso('Ya registraste series de este ejercicio; el cambio aplica a las siguientes.');
  }
  if (opId === it.ejercicio.id) delete actual.cambios[it.id];
  else actual.cambios[it.id] = opId;
  guardarCambios(actual.sesion.id, actual.cambios);
  const tarjeta = app.querySelector(`#ej-${CSS.escape(it.id)}`);
  const indice = actual.items.indexOf(it);
  tarjeta.outerHTML = tarjetaEjercicio(it, indice);
  const nueva = app.querySelector(`#ej-${CSS.escape(it.id)}`);
  nueva.querySelectorAll('[id^="fila-"]').forEach((cont) => conectarFila(app, cont));
  nueva.querySelector('[data-cambiar]')?.addEventListener('click', () => elegirAlternativa(app, it));
  nueva.querySelector('[data-ficha]')?.addEventListener('click', () => verFicha(app, it));
  aviso(`Cambiado a ${ejercicioDe(it, estado.yo.id).nombre}.`);
}

// ---------- Registrar una serie ----------

function registrarSerie(app, it, numero) {
  const ej = ejercicioDe(it, estado.yo.id);
  const meta = it.metas[estado.yo.id];
  const hechas = seriesDe(it, estado.yo.id);
  const existente = hechas.find((s) => s.numero === numero);
  const segundos = ej.unidad === 'segundos';
  const ultima = hechas.at(-1);
  const pesoSugerido = actual.sugerencias[`${it.id}:peso`];
  const reps = existente?.reps ?? meta?.reps ?? it.reps_base;
  const peso = existente?.peso_kg ?? pesoSugerido ?? ultima?.peso_kg ?? meta?.peso_kg ?? '';
  const esfuerzo = existente?.esfuerzo ?? 8;

  const d = abrirDialogo(`
    <form class="dialogo" novalidate>
      <h2 class="tarjeta__titulo">${esc(ej.nombre)}</h2>
      <p class="quieto" style="margin:-8px 0 0">Serie ${numero}${meta ? ` · meta ${esc(textoMeta(meta, ej.unidad))}` : ''}</p>

      <div class="campo">
        <label for="reps">${segundos ? 'Segundos' : 'Repeticiones'}</label>
        <div class="paso">
          <button type="button" class="paso__boton" data-paso="reps" data-delta="${segundos ? -5 : -1}" aria-label="Menos">−</button>
          <input id="reps" type="number" inputmode="numeric" min="0" max="${segundos ? 600 : 100}" value="${reps}">
          <button type="button" class="paso__boton" data-paso="reps" data-delta="${segundos ? 5 : 1}" aria-label="Más">+</button>
        </div>
      </div>

      <div class="campo">
        <label for="peso">Peso (kg)${segundos ? ' · opcional' : ''}</label>
        <div class="paso">
          <button type="button" class="paso__boton" data-paso="peso" data-delta="-2.5" aria-label="Menos 2,5 kg">−</button>
          <input id="peso" type="number" inputmode="decimal" min="0" max="500" step="0.5" value="${peso}" placeholder="${segundos ? 'Sin peso' : 'kg'}">
          <button type="button" class="paso__boton" data-paso="peso" data-delta="2.5" aria-label="Más 2,5 kg">+</button>
        </div>
      </div>

      <fieldset class="campo">
        <legend>¿Cómo se sintió?</legend>
        <div class="chips" id="esfuerzo">
          ${ESFUERZOS.map((e) => `<button type="button" class="chip" data-valor="${e.valor}" aria-pressed="${e.valor === esfuerzo}">${e.texto}</button>`).join('')}
        </div>
      </fieldset>

      <div class="dialogo__pie">
        ${existente ? '<button type="button" class="boton boton--peligro" id="borrar" style="margin-right:auto">Borrar</button>' : ''}
        <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
        <button type="submit" class="boton" id="guardar">${existente ? 'Guardar' : 'Listo'}</button>
      </div>
    </form>`, `Serie ${numero}`);

  grupoChips(d.querySelector('#esfuerzo'));
  d.querySelectorAll('[data-paso]').forEach((b) => b.addEventListener('click', () => {
    const input = d.querySelector(`#${b.dataset.paso}`);
    const base = input.value === '' ? (b.dataset.paso === 'peso' ? 0 : 0) : Number(input.value);
    input.value = String(Math.max(0, Math.round((base + Number(b.dataset.delta)) * 10) / 10));
  }));

  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = Number(d.querySelector('#reps').value);
    const pTexto = d.querySelector('#peso').value;
    const p = pTexto === '' ? null : Number(pTexto);
    if (!Number.isFinite(r) || r < 0 || r > (segundos ? 600 : 100)) return aviso('Revisa las repeticiones.', 'error');
    if (p != null && (!Number.isFinite(p) || p < 0 || p > 500)) return aviso('Revisa el peso.', 'error');
    if (!segundos && p == null) return aviso('Anota el peso que usaste.', 'error');
    const esf = Number(valorChips(d.querySelector('#esfuerzo')) ?? 8);
    const fila = {
      sesion_id: actual.sesion.id,
      persona_id: estado.yo.id,
      ejercicio_id: ej.id,
      sustituye_a: ej.id === it.ejercicio.id ? null : it.ejercicio.id,
      numero,
      reps: r,
      peso_kg: p,
      esfuerzo: esf,
    };
    const boton = d.querySelector('#guardar');
    boton.disabled = true;
    try {
      if (existente) {
        const nueva = datos(await sb.from('series').update(fila).eq('id', existente.id).select().single());
        actual.series = actual.series.map((s) => (s.id === existente.id ? nueva : s));
      } else {
        const nueva = datos(await sb.from('series').insert(fila).select().single());
        actual.series.push(nueva);
      }
      d.close();
      sugerir(it, { reps: r, peso: p, esfuerzo: esf, meta, segundos });
      repintarFila(app, it, estado.yo);
      if (!existente) {
        const quedan = (meta?.series ?? it.series_base) - seriesDe(it, estado.yo.id).length;
        const seg = meta?.descanso_seg ?? it.descanso_base;
        if (quedan > 0 && seg) empezarDescanso(seg);
        else if (quedan <= 0) aviso('Ejercicio completo.');
      }
    } catch (err) {
      avisoError(err);
      boton.disabled = false;
    }
  });

  d.querySelector('#borrar')?.addEventListener('click', async () => {
    try {
      datos(await sb.from('series').delete().eq('id', existente.id));
      actual.series = actual.series.filter((s) => s.id !== existente.id);
      d.close();
      repintarFila(app, it, estado.yo);
    } catch (err) {
      avisoError(err);
    }
  });
}

// Sugerencia para la siguiente serie según cómo se sintió esta.
function sugerir(it, { reps, peso, esfuerzo, meta, segundos }) {
  const objetivo = meta?.reps ?? it.reps_base;
  let texto = null;
  let pesoSiguiente = null;
  if (segundos) {
    if (esfuerzo === 10 && reps < objetivo) texto = 'Si la siguiente cuesta igual, corta un poco antes y mantén la forma.';
    else if (esfuerzo === 6) texto = 'Te sobró: aguanta unos segundos más en la siguiente.';
  } else if (peso != null) {
    if (esfuerzo === 10 && reps < objetivo) {
      pesoSiguiente = redondearPeso(peso * 0.9);
      texto = `No llegaste a ${objetivo}: baja a ${num(pesoSiguiente, pesoSiguiente % 1 ? 1 : 0)} kg en la siguiente.`;
    } else if (esfuerzo === 6 && reps >= objetivo) {
      pesoSiguiente = redondearPeso(peso + 2.5);
      texto = `Te sobró: prueba con ${num(pesoSiguiente, pesoSiguiente % 1 ? 1 : 0)} kg en la siguiente.`;
    } else if (esfuerzo === 10) {
      texto = 'Al límite pero llegaste: mantén el peso y cuida la técnica.';
    }
  }
  actual.sugerencias[it.id] = texto;
  actual.sugerencias[`${it.id}:peso`] = pesoSiguiente;
}

// ---------- Temporizador de descanso ----------

function empezarDescanso(segundos) {
  pararDescanso();
  const barra = document.createElement('div');
  barra.className = 'descanso';
  barra.setAttribute('role', 'timer');
  barra.innerHTML = `
    <div class="descanso__barra"><span></span></div>
    <span class="descanso__texto">Descanso <strong></strong></span>
    <button type="button" class="boton boton--sec boton--chico" data-mas>+15 s</button>
    <button type="button" class="boton boton--chico" data-saltar>Seguir</button>`;
  document.body.appendChild(barra);
  const total = segundos * 1000;
  descanso = { fin: Date.now() + total, total, barra, intervalo: null };
  const pintar = () => {
    const resta = Math.max(0, descanso.fin - Date.now());
    const s = Math.ceil(resta / 1000);
    barra.querySelector('strong').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    barra.querySelector('.descanso__barra span').style.transform = `scaleX(${resta / descanso.total})`;
    if (resta <= 0) {
      pararDescanso();
      try { navigator.vibrate?.([200, 100, 200]); } catch { /* sin vibración */ }
      aviso('¡A la siguiente serie!');
    }
  };
  barra.querySelector('[data-saltar]').addEventListener('click', pararDescanso);
  barra.querySelector('[data-mas]').addEventListener('click', () => {
    descanso.fin += 15000; descanso.total += 15000; pintar();
  });
  pintar();
  descanso.intervalo = setInterval(pintar, 250);
  requestAnimationFrame(() => barra.classList.add('descanso--visible'));
}

function pararDescanso() {
  if (!descanso) return;
  clearInterval(descanso.intervalo);
  const barra = descanso.barra;
  barra.classList.remove('descanso--visible');
  setTimeout(() => barra.remove(), 250);
  descanso = null;
}

// ---------- Terminar ----------

// Ajuste de metas según lo que hizo cada uno en este entreno.
function calcularAjustes() {
  const ajustes = [];
  for (const it of actual.items) {
    const meta = it.metas[estado.yo.id];
    if (!meta) continue;
    if (actual.cambios[it.id]) continue; // hizo otro ejercicio: no se toca la meta del original
    const hechas = seriesDe(it, estado.yo.id).filter((s) => s.ejercicio_id === it.ejercicio.id);
    if (!hechas.length) continue;
    const segundos = it.ejercicio.unidad === 'segundos';
    const esfuerzoMedio = hechas.reduce((a, s) => a + (s.esfuerzo ?? 8), 0) / hechas.length;
    const cumplio = hechas.length >= meta.series && hechas.every((s) => s.reps >= meta.reps);

    if (segundos) {
      if (cumplio && esfuerzoMedio <= 8) ajustes.push({ it, meta, cambio: { reps: meta.reps + 5 }, texto: `${meta.reps} → ${meta.reps + 5} s` });
      continue;
    }
    const pesos = hechas.map((s) => s.peso_kg).filter((p) => p != null);
    if (!pesos.length) continue;
    if (meta.peso_kg == null) {
      const validas = hechas.filter((s) => s.peso_kg != null && s.reps >= meta.reps).map((s) => s.peso_kg);
      const punto = Math.max(...(validas.length ? validas : pesos));
      ajustes.push({ it, meta, cambio: { peso_kg: punto }, texto: `punto de partida: ${num(punto, punto % 1 ? 1 : 0)} kg` });
      continue;
    }
    const cargaCumplida = cumplio && hechas.every((s) => (s.peso_kg ?? 0) >= meta.peso_kg);
    const sufrio = hechas.some((s) => s.esfuerzo === 10 && s.reps < meta.reps - 1);
    if (cargaCumplida && esfuerzoMedio <= 8) {
      const salto = meta.peso_kg >= 60 && /pierna|glúteo|cuádriceps|espalda/i.test(it.ejercicio.grupo_muscular) ? 5 : 2.5;
      const nuevo = meta.peso_kg + salto;
      ajustes.push({ it, meta, cambio: { peso_kg: nuevo }, texto: `${num(meta.peso_kg, meta.peso_kg % 1 ? 1 : 0)} → ${num(nuevo, nuevo % 1 ? 1 : 0)} kg` });
    } else if (sufrio) {
      const nuevo = redondearPeso(meta.peso_kg * 0.95);
      if (nuevo < meta.peso_kg) ajustes.push({ it, meta, cambio: { peso_kg: nuevo }, texto: `${num(meta.peso_kg, meta.peso_kg % 1 ? 1 : 0)} → ${num(nuevo, nuevo % 1 ? 1 : 0)} kg para consolidar` });
    }
  }
  return ajustes;
}

function terminar(app) {
  const mias = actual.series.filter((s) => s.persona_id === estado.yo.id);
  const planeadas = actual.items.reduce((a, it) => a + (it.metas[estado.yo.id]?.series ?? it.series_base), 0);
  const volumen = mias.reduce((a, s) => a + (s.peso_kg ?? 0) * s.reps, 0);
  const minutos = Math.max(1, Math.round((Date.now() - new Date(actual.sesion.iniciada_en)) / 60000));
  const ajustes = calcularAjustes();

  const d = abrirDialogo(`
    <div class="dialogo">
      <h2 class="tarjeta__titulo">Terminar mi entreno</h2>
      <div class="grilla-3">
        <div><span class="dato-grande">${mias.length}</span><span class="dato-unidad">/${planeadas}</span><p class="quieto" style="margin:4px 0 0">series</p></div>
        <div><span class="dato-grande">${minutos}</span><span class="dato-unidad">min</span><p class="quieto" style="margin:4px 0 0">duración</p></div>
        <div><span class="dato-grande">${num(volumen / 1000, 1)}</span><span class="dato-unidad">t</span><p class="quieto" style="margin:4px 0 0">levantadas</p></div>
      </div>
      ${ajustes.length ? `
        <div>
          <p class="seccion__titulo" style="margin:4px 0 8px">Próxima vez</p>
          <ul class="lista-ajustes">
            ${ajustes.map((a) => `<li><strong>${esc(a.it.ejercicio.nombre)}</strong><span>${esc(a.texto)}</span></li>`).join('')}
          </ul>
        </div>` : '<p class="quieto">Las metas quedan igual para la próxima.</p>'}
      ${mias.length < planeadas ? `<p class="ayuda">Te faltaron ${planeadas - mias.length} series. No pasa nada: las metas solo suben con lo que completaste.</p>` : ''}
      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" data-cerrar>Seguir entrenando</button>
        <button type="button" class="boton" id="confirmar">Terminar</button>
      </div>
    </div>`, 'Terminar mi entreno');

  const confirmar = d.querySelector('#confirmar');
  confirmar.addEventListener('click', async () => {
    confirmar.disabled = true;
    try {
      for (const a of ajustes) datos(await sb.from('metas_ejercicio').update(a.cambio).eq('id', a.meta.id));
      const fresca = datos(await sb.from('sesiones').select('terminados').eq('id', actual.sesion.id).single());
      const terminados = [...new Set([...fresca.terminados, estado.yo.id])];
      const todos = actual.participantes.every((p) => terminados.includes(p.id));
      datos(await sb.from('sesiones').update({
        terminados,
        ...(todos ? { terminada_en: new Date().toISOString() } : {}),
      }).eq('id', actual.sesion.id));
      try { localStorage.removeItem(claveCambios(actual.sesion.id)); } catch { /* nada */ }
      d.close();
      limpiar();
      aviso(ajustes.length ? `¡Buen entreno! ${ajustes.length} metas actualizadas.` : '¡Buen entreno!');
      location.hash = '#/hoy';
    } catch (err) {
      avisoError(err);
      confirmar.disabled = false;
    }
  });
}

