// Pantalla Perfil: mis datos, el hogar, exportar todo y cerrar sesión.
import { sb, estado, datos, cargarPersonas } from '../db.js';
import { esc, aviso, avisoError } from '../ui.js';
import { hoyISO, fechaCorta } from '../fechas.js';
import {
  enApp, APK, estadoNativo, pedirPermisos, sincronizarAhora, alEventoNativo, abrirExterno, guardarArchivo, asegurarVinculo, buscarActualizacion,
  soportaAvisos, configurarAvisos, pedirNotificaciones, pedirUbicacion, abrirAjustesApp, ubicacionActual, sincronizarAgenda,
} from '../nativo.js';

const NIVELES = { bajo: 'Bajo', moderado: 'Moderado', alto: 'Alto', muy_alto: 'Muy alto' };

// Todo lo que se exporta. La seguridad por filas ya limita cada tabla al hogar.
const TABLAS = [
  'hogares', 'personas', 'calendario', 'clases', 'actividades_extra', 'estado_diario', 'objetivos',
  'mediciones_corporales', 'actividad_diaria', 'sesiones_banda', 'maquinas', 'ejercicios',
  'ejercicio_alternativas', 'rutinas', 'rutina_ejercicios', 'metas_ejercicio', 'sesiones', 'series',
  'recetas', 'ingredientes', 'comidas', 'porciones', 'chat_mensajes', 'dispositivos', 'lugares',
];
const RADIOS = [100, 150, 250, 400];
let gimnasioActual = null; // el que ve la tarjeta de avisos

export async function vistaPerfil(app) {
  const yo = estado.yo;
  const [dispositivos, lugares] = await Promise.all([
    sb.from('dispositivos').select('id, nombre, creado_en, ultimo_sync').order('creado_en').then(datos),
    sb.from('lugares').select('*').eq('hogar_id', yo.hogar_id).eq('tipo', 'gimnasio').order('creado_en').limit(1).then(datos),
  ]);
  const gimnasio = lugares[0] ?? null;
  gimnasioActual = gimnasio;
  app.innerHTML = `
    <header class="encabezado">
      <div>
        <h1 class="titulo">Perfil</h1>
        <p class="subtitulo">${esc(estado.usuario?.email ?? '')}</p>
      </div>
    </header>

    <form class="tarjeta pila" id="perfil" novalidate>
      <h2 class="seccion__titulo" style="margin:0">Mis datos</h2>
      <p class="ayuda">Se usan para calcular metas de calorías y el metabolismo.</p>
      <div class="campo">
        <label for="nombre">Nombre</label>
        <input id="nombre" type="text" maxlength="40" required value="${esc(yo.nombre)}">
      </div>
      <div class="grilla-2">
        <div class="campo">
          <label for="fecha_nacimiento">Fecha de nacimiento</label>
          <input id="fecha_nacimiento" type="date" max="${hoyISO()}" value="${esc(yo.fecha_nacimiento ?? '')}">
        </div>
        <div class="campo">
          <label for="altura_cm">Altura (cm)</label>
          <input id="altura_cm" type="number" inputmode="decimal" min="100" max="250" step="0.5" value="${esc(yo.altura_cm ?? '')}">
        </div>
        <div class="campo">
          <label for="sexo">Sexo</label>
          <select id="sexo">
            <option value="">Sin indicar</option>
            <option value="m" ${yo.sexo === 'm' ? 'selected' : ''}>Masculino</option>
            <option value="f" ${yo.sexo === 'f' ? 'selected' : ''}>Femenino</option>
          </select>
        </div>
        <div class="campo">
          <label for="nivel_actividad">Nivel de actividad</label>
          <select id="nivel_actividad">
            <option value="">Sin indicar</option>
            ${Object.entries(NIVELES).map(([v, t]) => `<option value="${v}" ${yo.nivel_actividad === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
      </div>
      <button type="submit" class="boton" id="guardar">Guardar</button>
    </form>

    <section class="seccion" aria-labelledby="hogar">
      <h2 class="seccion__titulo" id="hogar">Hogar</h2>
      <div class="tarjeta pila" style="gap:6px">
        ${estado.personas.map((p) => `<div class="fila fila--entre"><strong>${esc(p.nombre)}</strong>${p.id === yo.id ? '<span class="quieto">Tú</span>' : ''}</div>`).join('')}
      </div>
    </section>

    <section class="seccion" aria-labelledby="gimnasio">
      <h2 class="seccion__titulo" id="gimnasio">Gimnasio y avisos</h2>
      <div class="tarjeta pila" id="gimnasio-tarjeta">${htmlGimnasio(gimnasio)}</div>
      ${enApp ? `<div class="tarjeta pila" id="avisos-tarjeta" style="margin-top:12px">${htmlAvisos(estadoNativo(), gimnasio)}</div>` : ''}
    </section>

    <section class="seccion" aria-labelledby="banda">
      <h2 class="seccion__titulo" id="banda">Banda y Health Connect</h2>
      <div class="tarjeta pila" id="banda-tarjeta">
        ${enApp ? htmlNativo(estadoNativo()) : `
          <p class="quieto" style="margin:0">Los datos de la banda llegan desde la app Bloque para Android, que lee Health Connect.</p>
          <a class="boton boton--sec" href="${APK}">Descargar la app Bloque</a>`}
        ${dispositivos.length ? `
          <div class="pila" style="gap:10px;margin-top:4px">
            <p class="seccion__titulo" style="margin:6px 0 0">Teléfonos conectados</p>
            ${dispositivos.map((d) => `
              <div class="fila fila--entre">
                <div>
                  <strong>${esc(d.nombre)}</strong>
                  <p class="quieto" style="margin:2px 0 0">${d.ultimo_sync ? `Sincronizó ${esc(haceCuanto(d.ultimo_sync))}` : 'Todavía no sincronizó'}</p>
                </div>
                <button type="button" class="boton boton--peligro boton--chico" data-quitar="${esc(d.id)}" aria-label="Quitar ${esc(d.nombre)}">Quitar</button>
              </div>`).join('')}
          </div>` : ''}
      </div>
    </section>

    <section class="seccion" aria-labelledby="datos">
      <h2 class="seccion__titulo" id="datos">Tus datos son tuyos</h2>
      <div class="tarjeta pila">
        <p class="quieto" style="margin:0">Descarga una copia completa del hogar en cualquier momento.</p>
        <button type="button" class="boton boton--sec" id="exportar-json">Exportar todo (JSON)</button>
        <button type="button" class="boton boton--sec" id="exportar-csv">Exportar mediciones (CSV)</button>
      </div>
    </section>

    <button type="button" class="boton boton--texto boton--bloque" style="margin-top:20px" id="salir">Cerrar sesión</button>`;

  app.querySelector('#perfil').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = app.querySelector('#nombre').value.trim();
    if (!nombre) return aviso('El nombre no puede quedar vacío.', 'error');
    const alturaTexto = app.querySelector('#altura_cm').value;
    const altura = alturaTexto === '' ? null : Number(alturaTexto);
    if (altura != null && (altura < 100 || altura > 250)) return aviso('Revisa la altura (entre 100 y 250 cm).', 'error');
    const boton = app.querySelector('#guardar');
    boton.disabled = true;
    try {
      datos(await sb.from('personas').update({
        nombre,
        fecha_nacimiento: app.querySelector('#fecha_nacimiento').value || null,
        altura_cm: altura,
        sexo: app.querySelector('#sexo').value || null,
        nivel_actividad: app.querySelector('#nivel_actividad').value || null,
      }).eq('id', yo.id));
      await cargarPersonas();
      aviso('Perfil guardado.');
    } catch (err) {
      avisoError(err);
    } finally {
      boton.disabled = false;
    }
  });

  conectarNativo(app);
  conectarGimnasio(app, gimnasio);
  conectarAvisos(app);
  app.querySelectorAll('[data-quitar]').forEach((b) => b.addEventListener('click', async () => {
    try {
      datos(await sb.from('dispositivos').delete().eq('id', b.dataset.quitar));
      aviso('Teléfono desvinculado.');
      vistaPerfil(app);
    } catch (err) {
      avisoError(err);
    }
  }));
  app.querySelector('#exportar-json').addEventListener('click', exportarJSON);
  app.querySelector('#exportar-csv').addEventListener('click', exportarCSV);
  app.querySelector('#salir').addEventListener('click', () => sb.auth.signOut());
}

function descargar(nombre, contenido, tipo) {
  if (guardarArchivo(nombre, contenido, tipo)) return; // en la app, va a Descargas
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportarJSON() {
  try {
    const copia = { exportado_en: new Date().toISOString(), tablas: {} };
    for (const t of TABLAS) copia.tablas[t] = datos(await sb.from(t).select('*'));
    descargar(`bloque-${hoyISO()}.json`, JSON.stringify(copia, null, 2), 'application/json');
  } catch (err) {
    avisoError(err);
  }
}

async function exportarCSV() {
  try {
    const filas = datos(await sb.from('mediciones_corporales').select('*').order('medido_en'));
    const nombres = Object.fromEntries(estado.personas.map((p) => [p.id, p.nombre]));
    const columnas = ['persona', 'medido_en', 'peso_kg', 'grasa_pct', 'masa_muscular_kg', 'masa_magra_kg', 'agua_pct',
      'grasa_visceral', 'masa_osea_kg', 'metabolismo_basal_kcal', 'origen', 'es_referencia', 'notas'];
    const celda = (v) => {
      const t = v == null ? '' : String(v);
      return /[",\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
    };
    const csv = [columnas.join(',')]
      .concat(filas.map((f) => columnas.map((c) => celda(c === 'persona' ? nombres[f.persona_id] : f[c])).join(',')))
      .join('\n');
    descargar(`bloque-mediciones-${hoyISO()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
  } catch (err) {
    avisoError(err);
  }
}

function haceCuanto(fecha) {
  const min = Math.round((Date.now() - new Date(fecha)) / 60000);
  if (min < 2) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `el ${fechaCorta(fecha)}`;
}

// Estado de Health Connect dentro de la app.
function htmlNativo(e) {
  if (!e) return '<p class="quieto" style="margin:0">No se pudo leer el estado de la app.</p>';
  if (!e.hcDisponible) {
    return `<p style="margin:0">Health Connect no está disponible en este teléfono.</p>
      <button type="button" class="boton boton--sec" data-nativo="permisos">Instalar Health Connect</button>`;
  }
  if (!e.permisosLectura) {
    return `<p style="margin:0"><strong>Falta dar permisos.</strong> Bloque necesita leer pasos, sueño, frecuencia cardiaca, entrenos y peso.</p>
      <button type="button" class="boton" data-nativo="permisos">Dar permisos de Health Connect</button>`;
  }
  const ultima = e.ultimaSync ? `Sincronizó ${haceCuanto(e.ultimaSync)}` : 'Todavía no sincronizó';
  return `
    <div class="fila fila--entre">
      <div>
        <strong>${e.sincronizando ? 'Sincronizando…' : esc(ultima)}</strong>
        ${e.ultimoResultado && !e.sincronizando ? `<p class="quieto" style="margin:2px 0 0">${esc(e.ultimoResultado)}</p>` : ''}
      </div>
      <button type="button" class="boton boton--sec boton--chico" data-nativo="sync" ${e.sincronizando ? 'disabled' : ''}>Sincronizar</button>
    </div>
    <p class="ayuda" style="margin:0">${e.segundoPlano ? 'Se sincroniza sola cada hora, aunque la app esté cerrada.' : 'Activa «Acceder a datos en segundo plano» para que se sincronice sola con la app cerrada.'}</p>
    ${e.faltanPermisos ? '<button type="button" class="boton boton--sec" data-nativo="permisos">Revisar permisos</button>' : ''}
    <div class="fila fila--entre">
      <span class="quieto">App versión 1.0.${esc(e.version)}</span>
      <button type="button" class="boton boton--texto boton--chico" data-nativo="actualizar">Buscar actualización</button>
    </div>`;
}

function conectarNativo(app) {
  const tarjeta = app.querySelector('#banda-tarjeta');
  const conectarBotones = () => {
    tarjeta.querySelectorAll('[data-nativo]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.nativo === 'permisos') pedirPermisos();
      if (b.dataset.nativo === 'sync') sincronizarAhora();
      if (b.dataset.nativo === 'actualizar') { buscarActualizacion(); aviso('Buscando actualizaciones…'); }
    }));
  };
  tarjeta.querySelectorAll('a[href^="https://github.com"]').forEach((a) => a.addEventListener('click', (e) => {
    if (enApp) { e.preventDefault(); abrirExterno(a.href); }
  }));
  if (!enApp) return;
  conectarBotones();
  // La parte de la app se repinta sola cuando cambia el estado de Health Connect.
  const quitar = alEventoNativo('estado', (e) => {
    if (!document.body.contains(tarjeta)) return quitar();
    const lista = tarjeta.querySelector('.pila');
    tarjeta.innerHTML = htmlNativo(e);
    if (lista) tarjeta.appendChild(lista);
    conectarBotones();
  });
  const quitarSync = alEventoNativo('sync', (r) => {
    if (!document.body.contains(tarjeta)) return quitarSync();
    if (r?.ok) aviso(`Sincronizado: ${r.resumen}`);
    else if (r?.error === 'permisos') aviso('Falta algún permiso de Health Connect.', 'error');
    else if (r?.error === 'no_vinculado') asegurarVinculo().then(() => aviso('Teléfono conectado de nuevo.')).catch(avisoError);
    else aviso('No se pudo sincronizar. Revisa la conexión.', 'error');
  });
}

// ---------- Gimnasio ----------
function urlMapa(l) {
  return `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`;
}

function htmlGimnasio(g, editando = !g, borrador = null) {
  if (!editando) {
    return `
      <div class="lugar">
        <span class="lugar__icono" aria-hidden="true"><svg class="icono" viewBox="0 0 24 24"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg></span>
        <div style="flex:1;min-width:0">
          <strong>${esc(g.nombre)}</strong>
          <p class="quieto" style="margin:2px 0 0">Aviso a ${g.radio_m} m a la redonda</p>
        </div>
      </div>
      <div class="fila" style="gap:8px;flex-wrap:wrap">
        <a class="boton boton--sec boton--chico" href="${esc(urlMapa(g))}" data-externo>Ver en el mapa</a>
        <button type="button" class="boton boton--texto boton--chico" id="lugar-editar">Cambiar</button>
      </div>`;
  }
  const b = borrador ?? { nombre: g?.nombre ?? 'Smart Fit Plataforma Financiera', radio_m: g?.radio_m ?? 150, lat: g?.lat ?? null, lng: g?.lng ?? null };
  return `
    <p class="quieto" style="margin:0">Guarda dónde entrenan para que la app les avise al llegar.</p>
    <div class="campo">
      <label for="lugar-nombre">Nombre</label>
      <input id="lugar-nombre" type="text" maxlength="80" value="${esc(b.nombre)}">
    </div>
    <div class="pila" style="gap:8px">
      <button type="button" class="boton boton--sec" id="lugar-aqui">
        <svg class="icono" viewBox="0 0 24 24" aria-hidden="true" style="width:20px;height:20px"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/></svg>
        Estoy en el gym: usar mi ubicación
      </button>
      <div class="campo">
        <label for="lugar-enlace">O pega un enlace de Google Maps</label>
        <input id="lugar-enlace" type="url" inputmode="url" placeholder="https://www.google.com/maps/…">
      </div>
      <p class="ayuda" id="lugar-coords">${b.lat != null ? `Ubicación lista${b.precision ? ` (precisión ±${b.precision} m)` : ''} · <a href="${esc(urlMapa(b))}" data-externo>revisar en el mapa</a>` : 'Todavía sin ubicación.'}</p>
    </div>
    <fieldset class="campo">
      <legend>Avisar a</legend>
      <div class="chips" id="lugar-radio">${RADIOS.map((r) => `<button type="button" class="chip" data-valor="${r}" aria-pressed="${b.radio_m === r}">${r} m</button>`).join('')}</div>
    </fieldset>
    <div class="fila" style="gap:8px;justify-content:flex-end">
      ${g ? '<button type="button" class="boton boton--sec boton--chico" id="lugar-cancelar">Cancelar</button>' : ''}
      <button type="button" class="boton boton--chico" id="lugar-guardar" ${b.lat == null ? 'disabled' : ''}>Guardar gimnasio</button>
    </div>`;
}

// Coordenadas de un enlace de Google Maps (o «-0.18, -78.48» escrito a mano).
export function coordsDeEnlace(texto) {
  const t = decodeURIComponent(texto || '');
  const patrones = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
    /[?&](?:q|query|ll|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/];
  for (const p of patrones) {
    const m = p.exec(t);
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

function conectarGimnasio(app, gimnasio) {
  const tarjeta = app.querySelector('#gimnasio-tarjeta');
  let borrador = null;
  const pintar = (editando) => {
    tarjeta.innerHTML = htmlGimnasio(gimnasio, editando, borrador);
    conectar(editando);
  };
  const conectar = (editando) => {
    tarjeta.querySelectorAll('[data-externo]').forEach((a) => a.addEventListener('click', (e) => {
      if (enApp) { e.preventDefault(); abrirExterno(a.href); }
    }));
    tarjeta.querySelector('#lugar-editar')?.addEventListener('click', () => { borrador = null; pintar(true); });
    if (!editando && gimnasio) return;
    const leer = () => {
      borrador = {
        ...(borrador ?? { lat: gimnasio?.lat ?? null, lng: gimnasio?.lng ?? null }),
        nombre: tarjeta.querySelector('#lugar-nombre').value,
        radio_m: Number(tarjeta.querySelector('#lugar-radio [aria-pressed="true"]')?.dataset.valor ?? 150),
      };
    };
    tarjeta.querySelectorAll('#lugar-radio .chip').forEach((c) => c.addEventListener('click', () => {
      tarjeta.querySelectorAll('#lugar-radio .chip').forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
    }));
    tarjeta.querySelector('#lugar-cancelar')?.addEventListener('click', () => { borrador = null; pintar(false); });
    const boton = tarjeta.querySelector('#lugar-aqui');
    boton.addEventListener('click', async () => {
      leer();
      boton.disabled = true;
      boton.lastChild.textContent = ' Buscando tu ubicación…';
      try {
        const u = await ubicacionActual();
        borrador = { ...borrador, lat: u.lat, lng: u.lng, precision: u.precision };
        pintar(true);
      } catch (err) {
        aviso(err.message, 'error');
        boton.disabled = false;
        boton.lastChild.textContent = ' Estoy en el gym: usar mi ubicación';
      }
    });
    tarjeta.querySelector('#lugar-enlace').addEventListener('change', (e) => {
      const c = coordsDeEnlace(e.target.value);
      if (!c) {
        aviso(/goo\.gl|maps\.app/.test(e.target.value)
          ? 'Ese enlace corto no trae la ubicación. Ábrelo en el navegador y copia el enlace largo.'
          : 'No encontré coordenadas en ese enlace.', 'error');
        return;
      }
      leer();
      borrador = { ...borrador, ...c, precision: null };
      pintar(true);
    });
    tarjeta.querySelector('#lugar-guardar').addEventListener('click', async (e) => {
      leer();
      const nombre = borrador.nombre.trim();
      if (!nombre) return aviso('Ponle un nombre.', 'error');
      e.target.disabled = true;
      const fila = { nombre, lat: borrador.lat, lng: borrador.lng, radio_m: borrador.radio_m };
      try {
        const guardado = gimnasio
          ? datos(await sb.from('lugares').update(fila).eq('id', gimnasio.id).select().single())
          : datos(await sb.from('lugares').insert({ ...fila, hogar_id: estado.yo.hogar_id, tipo: 'gimnasio' }).select().single());
        gimnasio = guardado;
        borrador = null;
        aviso('Gimnasio guardado.');
        pintar(false);
        sincronizarAgenda().catch(() => {});
        gimnasioActual = guardado;
        if (enApp) window.bloqueNativoEvento('estado', estadoNativo()); // repinta los avisos
      } catch (err) {
        avisoError(err);
        e.target.disabled = false;
      }
    });
  };
  conectar(!gimnasio);
}

// ---------- Avisos (por teléfono) ----------
function htmlAvisos(e, gimnasio) {
  if (!soportaAvisos) {
    return `<p style="margin:0"><strong>Avisos al llegar al gym</strong></p>
      <p class="quieto" style="margin:0">Para activarlos, actualiza la app Bloque.</p>
      <button type="button" class="boton boton--sec" data-aviso="actualizar">Buscar actualización</button>`;
  }
  const a = e?.avisos ?? {};
  const sinNotif = !a.notificaciones;
  const fila = (id, titulo, texto, activo, extra = '') => `
    <div class="aviso-opcion">
      <label class="campo--check" for="${id}">
        <input type="checkbox" id="${id}" ${activo ? 'checked' : ''}>
        <span><strong>${titulo}</strong><span class="quieto aviso-opcion__texto">${texto}</span></span>
      </label>
      ${extra}
    </div>`;
  let faltaLlegada = '';
  if (a.llegada) {
    if (!gimnasio) faltaLlegada = '<p class="aviso-falta">Primero guarda el gimnasio arriba.</p>';
    else if (a.playServices === false) faltaLlegada = '<p class="aviso-falta">Este teléfono no tiene los servicios de Google que hacen falta para la ubicación.</p>';
    else if (a.ubicacion !== 'siempre') {
      const texto = {
        en_uso: 'Falta elegir «Permitir todo el tiempo» en la ubicación, para avisar con la app cerrada.',
        aproximada: 'Falta activar «Usar ubicación precisa»: con la aproximada Android no sabe si entraste al gym.',
      }[a.ubicacion] ?? 'Falta el permiso de ubicación.';
      faltaLlegada = `<p class="aviso-falta">${texto}</p>
        <button type="button" class="boton boton--sec boton--chico" data-aviso="ubicacion">${a.ubicacion === 'no' ? 'Dar permiso de ubicación' : 'Abrir permiso de ubicación'}</button>`;
    }
  }
  return `
    ${sinNotif && (a.llegada || a.hora || a.reloj) ? `
      <div class="aviso-falta aviso-falta--bloque">
        <p style="margin:0">Las notificaciones de Bloque están apagadas.</p>
        <button type="button" class="boton boton--chico" data-aviso="notificaciones">Permitir notificaciones</button>
      </div>` : ''}
    ${fila('aviso-llegada', 'Al llegar al gimnasio', 'Si hoy toca gym, te avisa con el botón Comenzar.', a.llegada, faltaLlegada)}
    ${fila('aviso-hora', 'A la hora del gym', 'Por si la ubicación tarda o vas a otro lado.', a.hora, a.hora ? `
      <div class="chips" id="aviso-minutos" style="margin-left:34px">
        ${[0, 10, 30].map((m) => `<button type="button" class="chip" data-valor="${m}" aria-pressed="${(a.minutosAntes ?? 10) === m}">${m ? `${m} min antes` : 'A la hora'}</button>`).join('')}
      </div>` : '')}
    ${fila('aviso-reloj', 'Cuando el reloj registre un entreno', 'Si grabaste fuerza en la banda y no abriste el entreno en Bloque, te ofrece anotar las series.', a.reloj)}`;
}

function conectarAvisos(app) {
  const tarjeta = app.querySelector('#avisos-tarjeta');
  if (!tarjeta) return;
  const conectar = () => {
    tarjeta.querySelector('[data-aviso="actualizar"]')?.addEventListener('click', () => { buscarActualizacion(); aviso('Buscando actualizaciones…'); });
    if (!soportaAvisos) return;
    const leer = () => ({
      llegada: tarjeta.querySelector('#aviso-llegada').checked,
      hora: tarjeta.querySelector('#aviso-hora').checked,
      reloj: tarjeta.querySelector('#aviso-reloj').checked,
      minutosAntes: Number(tarjeta.querySelector('#aviso-minutos [aria-pressed="true"]')?.dataset.valor ?? estadoNativo()?.avisos?.minutosAntes ?? 10),
    });
    const guardar = (pedir) => {
      const c = leer();
      configurarAvisos(c);
      const a = estadoNativo()?.avisos ?? {};
      if ((c.llegada || c.hora || c.reloj) && !a.notificaciones) pedirNotificaciones();
      else if (pedir === 'llegada' && c.llegada && a.ubicacion !== 'siempre') pedirUbicacion();
      sincronizarAgenda().catch(() => {});
    };
    tarjeta.querySelector('#aviso-llegada').addEventListener('change', () => guardar('llegada'));
    tarjeta.querySelector('#aviso-hora').addEventListener('change', () => guardar());
    tarjeta.querySelector('#aviso-reloj').addEventListener('change', () => guardar());
    tarjeta.querySelectorAll('#aviso-minutos .chip').forEach((c) => c.addEventListener('click', () => {
      tarjeta.querySelectorAll('#aviso-minutos .chip').forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
      guardar();
    }));
    tarjeta.querySelector('[data-aviso="notificaciones"]')?.addEventListener('click', () => pedirNotificaciones());
    tarjeta.querySelector('[data-aviso="ubicacion"]')?.addEventListener('click', () => {
      const u = estadoNativo()?.avisos?.ubicacion;
      if (u === 'aproximada') abrirAjustesApp(); else pedirUbicacion();
    });
  };
  conectar();
  if (!soportaAvisos) return;
  // Se repinta cuando la app avisa que cambió un permiso o un ajuste.
  const quitar = alEventoNativo('estado', (e) => {
    if (!document.body.contains(tarjeta)) return quitar();
    tarjeta.innerHTML = htmlAvisos(e, gimnasioActual);
    conectar();
  });
}
