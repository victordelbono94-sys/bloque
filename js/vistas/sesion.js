// Sesión en vivo: los dos entrenan la misma rutina, cada uno registra sus series.
// Entre series hay temporizador de descanso y sugerencias según cómo se sintió.
// Al terminar, las metas se ajustan con lo que hizo cada uno.
import { sb, estado, datos } from '../db.js';
import { esc, num, aviso, avisoError, abrirDialogo, grupoChips, valorChips } from '../ui.js';
import { hoyISO } from '../fechas.js';
import { cargarRutina, textoMeta, redondearPeso } from '../rutinas.js';
import { textoSemaforo } from '../semaforo.js';
import { abrirFicha, miniatura } from '../ficha.js';
import { sincronizarAgenda } from '../nativo.js';
import { emparejar, minutos } from '../actividades.js';
import { sumarAgua } from '../hidratacion.js';
import { ofrecerEstiramientos } from '../estiramientos.js';
import { zonasDe } from '../iconos.js';

const ESFUERZOS = [
  { valor: 6, texto: 'Fácil' },
  { valor: 8, texto: 'Justo' },
  { valor: 10, texto: 'Al límite' },
];

// ---------- Empezar o unirse ----------

export async function empezarSesion(evento, { reemplazar = false } = {}) {
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
  sincronizarAgenda().catch(() => {}); // que la app no avise de un entreno ya empezado
  if (reemplazar) location.replace(`#/sesion/${id}`);
  else location.hash = `#/sesion/${id}`;
}

// Desde la notificación de la app («Comenzar»): abre o crea el entreno de ese gym.
export async function vistaComenzar(app) {
  const id = location.hash.split('/')[2];
  app.innerHTML = '<p class="cargando">Abriendo el entreno…</p>';
  const evento = /^[0-9a-f-]{36}$/.test(id ?? '')
    ? datos(await sb.from('calendario').select('*').eq('id', id).maybeSingle())
    : null;
  if (!evento?.rutina_id) {
    app.innerHTML = '<p class="vacio">Ese gym ya no tiene rutina o se borró.</p><a class="boton boton--sec" href="#/hoy">Ir a Hoy</a>';
    return;
  }
  await empezarSesion(evento, { reemplazar: true });
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

  // Lo que grabó el reloj para este entreno (cuando ya sincronizó).
  let delReloj = null;
  if (evento) {
    const desde = new Date(`${evento.fecha}T00:00:00`), hasta = new Date(`${evento.fecha}T23:59:59`);
    const delDia = datos(await sb.from('sesiones_banda').select('tipo, inicio, fin, calorias, calorias_estimadas, fc_promedio, confirmado').or('confirmado.is.null,confirmado.neq.nada')
      .eq('persona_id', estado.yo.id).gte('inicio', desde.toISOString()).lte('inicio', hasta.toISOString()));
    delReloj = emparejar([evento], delDia).pares.get(evento) ?? null;
  }

  const participantes = !evento || evento.asistencia === 'juntos'
    ? estado.personas
    : estado.personas.filter((p) => p.id === evento.persona_id);
  // Yo primero; si el evento era "solo" de otro, igual puedo mirar.
  participantes.sort((a, b) => (a.id === estado.yo.id ? -1 : b.id === estado.yo.id ? 1 : 0));

  // La vez pasada de cada uno en estos ejercicios (para mostrarla y sugerir el peso).
  const ejIds = [...new Set(items.flatMap((it) => [it.ejercicio.id, ...it.alternativas.map((a) => a.id)]))];
  const previas = ejIds.length ? datos(await sb.from('series').select('sesion_id, persona_id, ejercicio_id, numero, reps, peso_kg, hecha_en')
    .in('persona_id', participantes.map((p) => p.id)).in('ejercicio_id', ejIds).neq('sesion_id', id)
    .order('hecha_en', { ascending: false }).limit(800)) : [];

  actual = { sesion, rutina, items, participantes, series, previas, sugerencias: {}, cambios: leerCambios(id) };
  const yoParticipo = participantes.some((p) => p.id === estado.yo.id);
  const terminé = sesion.terminados.includes(estado.yo.id);
  const sem = miEstado?.semaforo;

  app.innerHTML = `
    <header class="encabezado">
      <div>
        <a href="#/hoy" class="boton boton--texto" style="padding:0;min-height:32px">‹ Hoy</a>
        <h1 class="titulo">${esc(rutina.nombre)}</h1>
        <p class="subtitulo">${esc(participantes.length > 1 ? `${participantes.filter((p) => p.id !== estado.yo.id).map((p) => p.nombre).join(', ')} y yo` : (participantes[0]?.id === estado.yo.id ? 'Solo yo' : `Solo ${participantes[0]?.nombre ?? ''}`))}</p>
      </div>
    </header>

    <div class="sesion-barra">
    ${yoParticipo && !terminé ? '<button type="button" class="agua-rapido" id="agua-entreno" aria-label="Sumar 250 ml de agua">💧 +250 ml</button>' : ''}
    <div class="crono-sesion ${terminé ? 'crono-sesion--fin' : ''}" role="timer" aria-label="Tiempo de entreno">
      <svg class="icono" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9.5 2.5h5M12 2.5V5"/></svg>
      <span id="transcurrido">0:00</span>
      <span class="crono-sesion__txt">${terminé ? 'terminaste' : 'entrenando'}</span>
    </div>
    </div>

    ${delReloj ? `
      <p class="sesion-reloj">
        <svg class="icono" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6" width="11" height="12" rx="3.5"/><path d="M9 6l.6-3h4.8l.6 3M9 18l.6 3h4.8l.6-3M12 9.5V12l1.6 1.2"/></svg>
        <span><strong>Tu reloj registró:</strong> ${esc([`${minutos(delReloj)} min`, delReloj.calorias != null ? `${delReloj.calorias_estimadas ? '≈ ' : ''}${delReloj.calorias} kcal` : null, delReloj.fc_promedio ? `${delReloj.fc_promedio} ppm promedio` : null].filter(Boolean).join(' · '))}</span>
      </p>` : ''}

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
  // Agua durante el entreno: un toque por vaso; se suma a la hidratación del día.
  let aguaSesion = 0;
  app.querySelector('#agua-entreno')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      await sumarAgua(250, 'entreno');
      aguaSesion += 250;
      b.textContent = `💧 ${aguaSesion} ml`;
      aviso('+250 ml de agua 💧');
    } catch (err) { avisoError(err); } finally { b.disabled = false; }
  });

  // Cronómetro en vivo desde que empezó el entreno (h:mm:ss); si ya terminaste, queda quieto.
  const ultimaMia = series.filter((x) => x.persona_id === estado.yo.id).map((x) => x.hecha_en).sort().at(-1);
  const fin = terminé ? new Date(sesion.terminada_en ?? ultimaMia ?? Date.now()).getTime() : null;
  const pintarReloj = () => {
    const el = app.querySelector('#transcurrido');
    if (!el) return;
    const seg = Math.max(0, Math.floor(((fin ?? Date.now()) - new Date(sesion.iniciada_en)) / 1000));
    const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), x = seg % 60;
    el.textContent = h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  };
  pintarReloj();
  if (!terminé) reloj = setInterval(pintarReloj, 1000);

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

// Series de la última sesión anterior en que esa persona hizo ese ejercicio.
function ultimaVez(ejId, personaId) {
  const suyas = actual.previas.filter((x) => x.ejercicio_id === ejId && x.persona_id === personaId);
  if (!suyas.length) return [];
  const sesionId = suyas[0].sesion_id; // vienen de la más nueva a la más vieja
  return suyas.filter((x) => x.sesion_id === sesionId).sort((a, b) => a.numero - b.numero);
}
const kg = (n) => num(n, n % 1 ? 1 : 0);
function textoUltima(lista, segundos) {
  return lista.map((x) => `${x.reps}${segundos ? 's' : ''}${x.peso_kg != null ? `×${kg(Number(x.peso_kg))}` : ''}`).join(' · ');
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
  // Cada casilla es su número de serie (si anotaste la 3 antes que la 1, la 3 queda en su lugar).
  const mayor = hechas.reduce((a, x) => Math.max(a, x.numero), 0);
  const total = Math.max(planeadas, mayor);
  const unidad = ej.unidad === 'segundos' ? 's' : '';

  const huecos = Array.from({ length: total }, (_, k) => {
    const s = hechas.find((x) => x.numero === k + 1);
    const texto = s
      ? `${s.reps}${unidad}${s.peso_kg != null ? `×${num(s.peso_kg, s.peso_kg % 1 ? 1 : 0)}` : ''}`
      : String(k + 1);
    const clase = `serie ${s ? 'serie--hecha' : ''} ${s?.esfuerzo === 10 ? 'serie--limite' : ''}`;
    if (!soyYo) return `<span class="${clase}" aria-label="Serie ${k + 1}${s ? `: ${texto}` : ', pendiente'}">${esc(texto)}</span>`;
    return `<button type="button" class="${clase}" data-serie="${k + 1}" data-re="${esc(it.id)}" aria-label="Serie ${k + 1}${s ? `: ${texto}, editar` : ', registrar'}">${esc(texto)}</button>`;
  }).join('');

  const llenas = Array.from({ length: total }, (_, k) => hechas.some((x) => x.numero === k + 1)).every(Boolean);
  const extra = soyYo && llenas
    ? `<button type="button" class="serie serie--extra" data-serie="${total + 1}" data-re="${esc(it.id)}" aria-label="Agregar una serie">+</button>` : '';
  const sugerencia = soyYo ? actual.sugerencias[it.id] : null;
  const pesoDefinir = meta && meta.peso_kg == null && ej.unidad === 'reps' && !hechas.length;
  const antes = ultimaVez(ej.id, p.id);
  // ¿La meta subió respecto de la vez pasada?
  const maxAntes = Math.max(0, ...antes.map((x) => Number(x.peso_kg ?? 0)));
  const repsAntes = Math.max(0, ...antes.map((x) => x.reps));
  const sube = meta && antes.length && ((meta.peso_kg != null && Number(meta.peso_kg) > maxAntes) || (Number(meta.peso_kg ?? 0) >= maxAntes && meta.reps > repsAntes));

  return `
    <div class="fila fila--entre" style="gap:8px">
      <span class="meta-fila__nombre">${esc(soyYo ? 'Yo' : p.nombre)}</span>
      <span class="quieto">${sube ? '<span class="sube" title="Subió desde la vez pasada">↑</span> ' : ''}${esc(textoMeta(meta, ej.unidad))}${ej.por_lado ? ' · por lado' : ''}${pesoDefinir ? ' · elige tu peso' : ''}</span>
    </div>
    <div class="series" style="margin-top:6px">${huecos}${extra}</div>
    ${antes.length ? `<p class="ultima">La vez pasada: ${esc(textoUltima(antes, ej.unidad === 'segundos'))}</p>` : ''}
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
  const antes = ultimaVez(ej.id, estado.yo.id);
  const pesoAntes = antes.find((x) => x.numero === numero)?.peso_kg ?? antes.at(-1)?.peso_kg;
  const peso = existente?.peso_kg ?? pesoSugerido ?? ultima?.peso_kg ?? meta?.peso_kg ?? pesoAntes ?? '';
  const objetivoSeg = meta?.reps ?? it.reps_base;
  const esfuerzo = existente?.esfuerzo ?? 8;

  const d = abrirDialogo(`
    <form class="dialogo" novalidate>
      <h2 class="tarjeta__titulo">${esc(ej.nombre)}</h2>
      <p class="quieto" style="margin:-8px 0 0">Serie ${numero}${meta ? ` · meta ${esc(textoMeta(meta, ej.unidad))}` : ''}${ej.por_lado ? ' · por lado' : ''}</p>
      ${segundos ? `
        <div class="crono" id="crono">
          <span class="crono__fase" id="crono-fase">${ej.por_lado ? 'Lado derecho primero, después el izquierdo' : 'Cuando estés en posición'}</span>
          <span class="crono__tiempo" id="crono-t">${relojTxt(objetivoSeg)}</span>
          <div class="crono__barra"><span id="crono-barra"></span></div>
          <button type="button" class="boton boton--bloque" id="crono-ir">▶ Empezar ${objetivoSeg} s${ej.por_lado ? ' por lado' : ''}</button>
        </div>` : ''}

      <div class="campo">
        <label for="reps">${segundos ? 'Segundos' : 'Repeticiones'}${ej.por_lado ? ' (por lado)' : ''}</label>
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
  if (segundos) {
    const crono = cronometro(d, { segundos: () => Number(d.querySelector('#reps').value) || objetivoSeg, porLado: !!ej.por_lado });
    d.addEventListener('close', crono.parar);
  }
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
        const { data, error } = await sb.from('series').insert(fila).select().single();
        if (error?.code === '23505') {
          // Ya estaba (doble toque o la otra pestaña): se actualiza esa misma serie.
          const nueva = datos(await sb.from('series').update(fila).eq('sesion_id', fila.sesion_id).eq('persona_id', fila.persona_id)
            .eq('ejercicio_id', fila.ejercicio_id).eq('numero', numero).select().single());
          actual.series = [...actual.series.filter((x) => x.id !== nueva.id), nueva];
        } else {
          if (error) throw error;
          actual.series.push(data);
        }
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

// ---------- Temporizador de ejercicios por tiempo ----------

const relojTxt = (seg) => `${Math.floor(seg / 60)}:${String(Math.max(0, Math.ceil(seg)) % 60).padStart(2, '0')}`;

// Pitidos cortos (cuenta regresiva) y uno largo al cambiar de fase. Sin sonido si el navegador no deja.
let audio = null;
function pitido(largo = false) {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = largo ? 660 : 880;
    g.gain.setValueAtTime(0.25, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + (largo ? 0.6 : 0.15));
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + (largo ? 0.6 : 0.15));
  } catch { /* sin audio */ }
  try { navigator.vibrate?.(largo ? [300] : [60]); } catch { /* sin vibración */ }
}

/**
 * Cronómetro dentro del diálogo de la serie: 3 s para prepararse, el tiempo de la serie
 * y, si es por lado, 5 s para cambiar y el otro lado. Al terminar (o al parar) anota los segundos.
 */
function cronometro(d, { segundos, porLado }) {
  const $ = (q) => d.querySelector(q);
  const boton = $('#crono-ir'), fase = $('#crono-fase'), tiempo = $('#crono-t'), barra = $('#crono-barra'), caja = $('#crono');
  let fases = [], i = 0, inicioFase = 0, intervalo = null, ultimoPitido = null, bloqueo = null, logrado = 0;

  const armar = () => {
    const t = segundos();
    fases = porLado
      ? [{ t: 3, txt: 'Prepárate · lado derecho', tipo: 'prep' }, { t, txt: 'Lado derecho', tipo: 'trabajo' },
        { t: 5, txt: 'Cambia de lado', tipo: 'cambio' }, { t, txt: 'Lado izquierdo', tipo: 'trabajo' }]
      : [{ t: 3, txt: 'Prepárate', tipo: 'prep' }, { t, txt: '¡Aguanta!', tipo: 'trabajo' }];
  };
  const pintar = () => {
    const f = fases[i];
    const pasado = (Date.now() - inicioFase) / 1000;
    const resta = f.t - pasado;
    if (f.tipo === 'trabajo') logrado = Math.min(f.t, Math.floor(pasado));
    tiempo.textContent = relojTxt(resta);
    barra.style.transform = `scaleX(${Math.max(0, resta / f.t)})`;
    const seg = Math.ceil(resta);
    if (seg <= 3 && seg >= 1 && seg !== ultimoPitido) { ultimoPitido = seg; pitido(); }
    if (resta <= 0) siguiente();
  };
  const entrar = (k) => {
    i = k; inicioFase = Date.now(); ultimoPitido = null;
    const f = fases[i];
    fase.textContent = f.txt;
    caja.dataset.fase = f.tipo;
    if (k > 0) pitido(true);
  };
  const siguiente = () => {
    if (fases[i].tipo === 'trabajo') logrado = fases[i].t;
    if (i + 1 < fases.length) return entrar(i + 1);
    terminar(true);
  };
  const terminar = (completo) => {
    clearInterval(intervalo); intervalo = null;
    bloqueo?.release?.().catch(() => {}); bloqueo = null;
    if (completo) pitido(true);
    delete caja.dataset.fase;
    if (logrado > 0) $('#reps').value = String(logrado);
    fase.textContent = completo ? '¡Listo! Elige cómo se sintió y guarda.' : `Paraste en ${logrado} s. Ajusta si hace falta y guarda.`;
    tiempo.textContent = relojTxt(logrado || segundos());
    barra.style.transform = 'scaleX(0)';
    boton.textContent = '↻ Otra vez';
  };
  boton.addEventListener('click', async () => {
    if (intervalo) return terminar(false);
    armar(); logrado = 0;
    try { bloqueo = await navigator.wakeLock?.request('screen'); } catch { /* sin bloqueo de pantalla */ }
    boton.textContent = '■ Parar';
    entrar(0);
    pitido();
    pintar();
    intervalo = setInterval(pintar, 100);
  });
  return { parar: () => { clearInterval(intervalo); intervalo = null; bloqueo?.release?.().catch(() => {}); } };
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
    meta.peso_kg = Number(meta.peso_kg);
    const cargaCumplida = cumplio && hechas.every((s) => Number(s.peso_kg ?? 0) >= meta.peso_kg);
    const sufrio = hechas.some((s) => s.esfuerzo === 10 && s.reps < meta.reps - 1);
    const base = it.reps_base;
    if (cargaCumplida && esfuerzoMedio <= 8) {
      // Doble progresión: con pesos chicos (+2,5 kg es más del 12 %) primero se suben las reps
      // hasta base + 4; después se sube el peso y las reps vuelven a la base.
      const mancuerna = /mancuerna/i.test(it.ejercicio.nombre);
      const salto = meta.peso_kg >= 60 && /pierna|glúteo|cuádriceps|espalda/i.test(it.ejercicio.grupo_muscular) ? 5 : mancuerna ? 2 : 2.5;
      if (salto / meta.peso_kg > 0.12 && meta.reps < base + 4) {
        const reps = meta.reps + 2;
        ajustes.push({ it, meta, cambio: { reps }, texto: `${meta.reps} → ${reps} reps con ${kg(meta.peso_kg)} kg` });
      } else {
        const nuevo = meta.peso_kg + salto;
        const reps = Math.min(meta.reps, base);
        ajustes.push({ it, meta, cambio: { peso_kg: nuevo, reps }, texto: `${kg(meta.peso_kg)} → ${kg(nuevo)} kg${reps !== meta.reps ? ` · ${reps} reps` : ''}` });
      }
    } else if (sufrio) {
      const nuevo = redondearPeso(meta.peso_kg * 0.95);
      if (nuevo < meta.peso_kg) ajustes.push({ it, meta, cambio: { peso_kg: nuevo }, texto: `${kg(meta.peso_kg)} → ${kg(nuevo)} kg para consolidar` });
    } else if (cumplio) {
      ajustes.push({ it, meta, cambio: null, texto: `mismo peso: salió al límite, consolídalo` });
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
      for (const a of ajustes.filter((x) => x.cambio)) datos(await sb.from('metas_ejercicio').update(a.cambio).eq('id', a.meta.id));
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
      const subidas = ajustes.filter((x) => x.cambio).length;
      aviso(subidas ? `¡Buen entreno! ${subidas} metas actualizadas para la próxima.` : '¡Buen entreno!');
      // Estiramientos de lo que trabajaste; cortos si hay derby u otro entreno exigente en menos de 2 horas.
      const zonas = zonasDe(actual.items.map((it) => ejercicioDe(it, estado.yo.id).grupo_muscular));
      const ahora = new Date();
      const luego = datos(await sb.from('calendario').select('tipo, hora_inicio, asistencia, persona_id').eq('hogar_id', estado.yo.hogar_id)
        .eq('fecha', hoyISO()).in('tipo', ['derby', 'otro']).not('hora_inicio', 'is', null))
        .filter((e) => e.asistencia === 'juntos' || e.persona_id === estado.yo.id)
        .map((e) => ({ ...e, min: (new Date(`${hoyISO()}T${e.hora_inicio.slice(0, 5)}:00`) - ahora) / 60000 }))
        .find((e) => e.min > -15 && e.min <= 120);
      setTimeout(() => ofrecerEstiramientos(zonas, {
        corta: !!luego,
        motivo: luego ? `${luego.tipo === 'derby' ? 'Tienes derby' : 'Tienes otro entreno'} en ${Math.max(0, Math.round(luego.min))} min: suelta lo trabajado sin estirar a fondo (eso, mejor después).` : '',
        alTerminar: () => { location.hash = '#/hoy'; },
      }), 250);
    } catch (err) {
      avisoError(err);
      confirmar.disabled = false;
    }
  });
}

