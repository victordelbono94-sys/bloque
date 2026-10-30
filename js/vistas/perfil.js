// Pantalla Perfil: mis datos, el hogar, exportar todo y cerrar sesión.
import { sb, estado, datos, cargarPersonas } from '../db.js';
import { esc, aviso, avisoError, abrirDialogo, cara } from '../ui.js';
import { hoyISO, fechaCorta } from '../fechas.js';
import {
  enApp, APK, estadoNativo, pedirPermisos, sincronizarAhora, alEventoNativo, abrirExterno, guardarArchivo, asegurarVinculo, buscarActualizacion,
  soportaAvisos, configurarAvisos, pedirNotificaciones, pedirUbicacion, abrirAjustesApp, ubicacionActual, sincronizarAgenda,
} from '../nativo.js';
import { crearMapa, buscarLugares } from '../mapa.js';
import {
  nombreDeporte, selectorDeporte, conectarDeporte, compartirInvitacion, copiar, soyAdmin,
  unirmeEquipo, salirDelEquipo, quitarDelEquipo, editarEquipo, convertirEnEquipo,
} from '../equipo.js';

const NIVELES = { bajo: 'Bajo', moderado: 'Moderado', alto: 'Alto', muy_alto: 'Muy alto' };

// Todo lo que se exporta. La seguridad por filas ya limita cada tabla al hogar.
const TABLAS = [
  'hogares', 'personas', 'calendario', 'clases', 'actividades_extra', 'estado_diario', 'objetivos',
  'mediciones_corporales', 'actividad_diaria', 'sesiones_banda', 'maquinas', 'ejercicios',
  'ejercicio_alternativas', 'rutinas', 'rutina_ejercicios', 'metas_ejercicio', 'sesiones', 'series',
  'recetas', 'ingredientes', 'comidas', 'porciones', 'chat_mensajes', 'dispositivos', 'lugares',
];
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
      <div class="foto-perfil">
        <span class="avatar avatar--grande" id="foto-actual">${cara(yo)}</span>
        <div class="foto-perfil__botones">
          <button type="button" class="boton boton--sec boton--chico" id="foto-subir">${yo.avatar_url ? 'Cambiar foto' : 'Subir foto'}</button>
          ${fotoGoogle() && yo.avatar_url !== fotoGoogle() ? '<button type="button" class="boton boton--texto boton--chico" id="foto-google">Usar la de Google</button>' : ''}
          ${yo.avatar_url ? '<button type="button" class="boton boton--texto boton--chico" id="foto-quitar">Quitar</button>' : ''}
        </div>
        <input type="file" id="foto-archivo" accept="image/*" hidden>
      </div>
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
          <label for="experiencia">Experiencia en el gym</label>
          <select id="experiencia">
            <option value="">Sin indicar</option>
            <option value="principiante" ${yo.experiencia === 'principiante' ? 'selected' : ''}>Principiante (menos de 1 año)</option>
            <option value="intermedio" ${yo.experiencia === 'intermedio' ? 'selected' : ''}>Intermedio (1 a 3 años)</option>
            <option value="avanzado" ${yo.experiencia === 'avanzado' ? 'selected' : ''}>Avanzado (más de 3 años)</option>
          </select>
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

    <section class="seccion" aria-labelledby="equipo">
      <h2 class="seccion__titulo" id="equipo">${estado.equipo?.personal ? 'Tu espacio' : 'Hogar'}</h2>
      ${htmlEquipo()}
    </section>

    <section class="seccion" aria-labelledby="gimnasio">
      <h2 class="seccion__titulo" id="gimnasio">Gimnasio</h2>
      <div class="tarjeta pila" id="gimnasio-tarjeta">${htmlGimnasio(gimnasio)}</div>
    </section>

    ${enApp ? `
      <section class="seccion" aria-labelledby="t-notif">
        <h2 class="seccion__titulo" id="t-notif">Notificaciones</h2>
        <div class="tarjeta pila" id="avisos-tarjeta">
          <p class="seccion__titulo" style="margin:0">Gym</p>
          ${htmlAvisos(estadoNativo(), gimnasio)}
        </div>
      </section>` : ''}

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
        <p class="quieto" style="margin:0">Descarga una copia completa de los datos de tu hogar en cualquier momento.</p>
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
        experiencia: app.querySelector('#experiencia').value || null,
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

  conectarEquipo(app);
  conectarFoto(app);
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
          <p class="quieto" style="margin:2px 0 0">Te avisa al llegar acá</p>
        </div>
        <button type="button" class="boton boton--texto boton--chico" id="lugar-editar">Cambiar</button>
      </div>
      <div class="mapa-caja mapa-caja--chica" id="lugar-mapa" aria-label="Mapa del gimnasio"></div>`;
  }
  const b = borrador ?? { nombre: g?.nombre ?? '', lat: g?.lat ?? null, lng: g?.lng ?? null };
  return `
    <p class="quieto" style="margin:0">Busca el gimnasio y revisa que el pin quede encima. Si no está justo, toca el punto exacto en el mapa.</p>
    <div class="campo buscador">
      <label for="lugar-buscar">Buscar</label>
      <input id="lugar-buscar" type="search" autocomplete="off" placeholder="Ej.: Smart Fit Plataforma Financiera" value="">
      <div class="buscador__lista" id="lugar-resultados" role="listbox" hidden></div>
    </div>
    <div class="mapa-caja" id="lugar-mapa" aria-label="Mapa: toca para poner el pin"></div>
    <button type="button" class="boton boton--texto boton--chico" id="lugar-aqui" style="align-self:flex-start;padding:0">Usar mi ubicación actual</button>
    <div class="campo">
      <label for="lugar-nombre">Nombre</label>
      <input id="lugar-nombre" type="text" maxlength="80" placeholder="Smart Fit Plataforma Financiera" value="${esc(b.nombre)}">
    </div>
    <div class="fila" style="gap:8px;justify-content:flex-end">
      ${g ? '<button type="button" class="boton boton--sec boton--chico" id="lugar-cancelar">Cancelar</button>' : ''}
      <button type="button" class="boton boton--chico" id="lugar-guardar" ${b.lat == null ? 'disabled' : ''}>Guardar gimnasio</button>
    </div>`;
}

function conectarGimnasio(app, gimnasio) {
  const tarjeta = app.querySelector('#gimnasio-tarjeta');
  let borrador = null;
  let mapa = null;
  const pintar = (editando) => {
    mapa?.destruir(); mapa = null;
    tarjeta.innerHTML = htmlGimnasio(gimnasio, editando, borrador);
    conectar(editando);
  };
  const conectar = (editando) => {
    const caja = tarjeta.querySelector('#lugar-mapa');
    tarjeta.querySelector('#lugar-editar')?.addEventListener('click', () => {
      borrador = { nombre: gimnasio.nombre, lat: gimnasio.lat, lng: gimnasio.lng };
      pintar(true);
    });
    if (!editando && gimnasio) {
      crearMapa(caja, { lat: gimnasio.lat, lng: gimnasio.lng }, { zoom: 16 }).then((m) => { mapa = m; })
        .catch(() => { caja.innerHTML = `<a class="boton boton--sec boton--chico" href="${esc(urlMapa(gimnasio))}">Ver en el mapa</a>`; });
      return;
    }
    borrador ??= { nombre: gimnasio?.nombre ?? '', lat: gimnasio?.lat ?? null, lng: gimnasio?.lng ?? null };
    const guardar = tarjeta.querySelector('#lugar-guardar');
    const nombre = tarjeta.querySelector('#lugar-nombre');
    const ubicar = (lat, lng, nuevoNombre) => {
      borrador.lat = lat; borrador.lng = lng;
      if (nuevoNombre && !nombre.value.trim()) nombre.value = nuevoNombre;
      guardar.disabled = false;
      mapa?.mover(lat, lng);
    };
    crearMapa(caja, borrador.lat != null ? { lat: borrador.lat, lng: borrador.lng } : null, {
      alMover: ({ lat, lng }) => { borrador.lat = lat; borrador.lng = lng; guardar.disabled = false; },
    }).then((m) => { mapa = m; })
      .catch(() => { caja.innerHTML = '<p class="quieto" style="padding:16px">No se pudo cargar el mapa. Revisa la conexión.</p>'; });

    // Buscador: resultados mientras escribes.
    const buscar = tarjeta.querySelector('#lugar-buscar');
    const lista = tarjeta.querySelector('#lugar-resultados');
    let espera = null, pedido = 0, resultados = [];
    buscar.addEventListener('input', () => {
      clearTimeout(espera);
      const texto = buscar.value;
      if (texto.trim().length < 3) { lista.hidden = true; return; }
      espera = setTimeout(async () => {
        const turno = ++pedido;
        lista.hidden = false;
        lista.innerHTML = '<p class="quieto buscador__vacio">Buscando…</p>';
        try {
          resultados = await buscarLugares(texto, borrador.lat != null ? { lat: borrador.lat, lng: borrador.lng } : undefined);
          if (turno !== pedido) return;
          lista.innerHTML = resultados.length
            ? resultados.map((r, i) => `
                <button type="button" class="buscador__item" role="option" data-i="${i}">
                  <strong>${esc(r.nombre)}</strong>${r.detalle ? `<span class="quieto">${esc(r.detalle)}</span>` : ''}
                </button>`).join('')
            : '<p class="quieto buscador__vacio">No encontré nada. Prueba con la calle o el edificio, y después toca el punto en el mapa.</p>';
        } catch (err) {
          if (turno === pedido) lista.innerHTML = `<p class="quieto buscador__vacio">${esc(err.message)}</p>`;
        }
      }, 400);
    });
    lista.addEventListener('click', (e) => {
      const item = e.target.closest('[data-i]');
      if (!item) return;
      const r = resultados[Number(item.dataset.i)];
      lista.hidden = true;
      buscar.value = r.nombre;
      ubicar(r.lat, r.lng, r.nombre);
    });

    const aqui = tarjeta.querySelector('#lugar-aqui');
    aqui.addEventListener('click', async () => {
      aqui.disabled = true;
      aqui.textContent = 'Buscando tu ubicación…';
      try {
        const u = await ubicacionActual();
        ubicar(u.lat, u.lng);
      } catch (err) {
        aviso(err.message, 'error');
      }
      aqui.disabled = false;
      aqui.textContent = 'Usar mi ubicación actual';
    });
    tarjeta.querySelector('#lugar-cancelar')?.addEventListener('click', () => { borrador = null; pintar(false); });
    guardar.addEventListener('click', async () => {
      const n = nombre.value.trim() || buscar.value.trim();
      if (!n) { nombre.focus(); return aviso('Ponle un nombre.', 'error'); }
      if (borrador.lat == null) return aviso('Elige el lugar en el mapa.', 'error');
      guardar.disabled = true;
      const fila = { nombre: n, lat: borrador.lat, lng: borrador.lng };
      try {
        const guardado = gimnasio
          ? datos(await sb.from('lugares').update(fila).eq('id', gimnasio.id).select().single())
          : datos(await sb.from('lugares').insert({ ...fila, radio_m: 150, hogar_id: estado.yo.hogar_id, tipo: 'gimnasio' }).select().single());
        gimnasio = guardado;
        gimnasioActual = guardado;
        borrador = null;
        aviso('Gimnasio guardado.');
        pintar(false);
        sincronizarAgenda().catch(() => {});
        if (enApp) window.bloqueNativoEvento('estado', estadoNativo()); // repinta los avisos
      } catch (err) {
        avisoError(err);
        guardar.disabled = false;
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
    ${sinNotif && (a.llegada || a.hora || a.reloj || a.despertar || a.agua || a.comidas) ? `
      <div class="aviso-falta aviso-falta--bloque">
        <p style="margin:0">Las notificaciones de Bloque están apagadas.</p>
        <button type="button" class="boton boton--chico" data-aviso="notificaciones">Permitir notificaciones</button>
      </div>` : ''}
    ${fila('aviso-llegada', 'Al llegar al gimnasio', 'Si hoy toca gym, te avisa con el botón Comenzar.', a.llegada, faltaLlegada)}
    ${fila('aviso-hora', 'A la hora del gym', 'Por si la ubicación tarda o vas a otro lado.', a.hora, a.hora ? `
      <div class="chips" id="aviso-minutos" style="margin-left:34px">
        ${[0, 10, 30].map((m) => `<button type="button" class="chip" data-valor="${m}" aria-pressed="${(a.minutosAntes ?? 10) === m}">${m ? `${m} min antes` : 'A la hora'}</button>`).join('')}
      </div>` : '')}
    ${fila('aviso-reloj', 'Cuando el reloj registre un entreno', 'Si grabaste fuerza en la banda y no abriste el entreno en Bloque, te ofrece anotar las series.', a.reloj)}
    ${a.confirmable ? fila('aviso-confirmar', '¿Qué fue este entreno?', 'Si el reloj guarda un «otro entreno» (patinaje, eSports…), te pregunta qué fue en vez de adivinar. Respondes desde la notificación.', a.confirmar !== false) : ''}
    <p class="seccion__titulo" style="margin:10px 0 0">Bienestar</p>
    ${a.bienestar ? `
      ${fila('aviso-despertar', 'Al despertar: ¿cómo amaneciste?', 'Una hora después de que la pulsera registra que te despertaste: cuánto dormiste y marcas tu cansancio desde la notificación.', a.despertar !== false)}
      ${fila('aviso-agua', 'Recordatorios de agua', 'A media mañana, al almuerzo, a media tarde y en la noche, si todavía no llegas a tu meta.', a.agua)}
      ${fila('aviso-comidas', 'Si no registraste el almuerzo o la cena', 'A las 14:30 y a las 21:00, solo si falta registrarlo.', a.comidas)}`
    : '<p class="quieto" style="margin:0">Actualiza la app para activar los avisos de sueño, agua y comidas.</p>'}`;
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
      despertar: tarjeta.querySelector('#aviso-despertar')?.checked ?? true,
      confirmar: tarjeta.querySelector('#aviso-confirmar')?.checked ?? true,
      agua: tarjeta.querySelector('#aviso-agua')?.checked ?? false,
      comidas: tarjeta.querySelector('#aviso-comidas')?.checked ?? false,
      minutosAntes: Number(tarjeta.querySelector('#aviso-minutos [aria-pressed="true"]')?.dataset.valor ?? estadoNativo()?.avisos?.minutosAntes ?? 10),
    });
    const guardar = (pedir) => {
      const c = leer();
      configurarAvisos(c);
      const a = estadoNativo()?.avisos ?? {};
      if ((c.llegada || c.hora || c.reloj || c.despertar || c.agua || c.comidas) && !a.notificaciones) pedirNotificaciones();
      else if (pedir === 'llegada' && c.llegada && a.ubicacion !== 'siempre') pedirUbicacion();
      sincronizarAgenda().catch(() => {});
    };
    tarjeta.querySelector('#aviso-llegada').addEventListener('change', () => guardar('llegada'));
    tarjeta.querySelector('#aviso-hora').addEventListener('change', () => guardar());
    tarjeta.querySelector('#aviso-reloj').addEventListener('change', () => guardar());
    ['#aviso-despertar', '#aviso-confirmar', '#aviso-agua', '#aviso-comidas'].forEach((id) => tarjeta.querySelector(id)?.addEventListener('change', () => guardar()));
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
    tarjeta.innerHTML = `<p class="seccion__titulo" style="margin:0">Gym</p>${htmlAvisos(e, gimnasioActual)}`;
    conectar();
  });
}

// ---------- Equipo ----------
const ICONO_COMPARTIR = '<svg class="icono" viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/></svg>';

function htmlEquipo() {
  const eq = estado.equipo;
  if (!eq) return '';
  const admin = soyAdmin();
  if (eq.personal) {
    return `
      <div class="tarjeta pila">
        <div class="fila fila--entre">
          <div>
            <strong>Espacio personal</strong>
            <p class="quieto" style="margin:2px 0 0">${esc(nombreDeporte(eq.deporte))}</p>
          </div>
          <button type="button" class="boton boton--texto boton--chico" id="eq-deporte">Cambiar deporte</button>
        </div>
        <p class="ayuda" style="margin:0">¿Entrenas con alguien? Crea un hogar para compartir la semana, las rutinas y la comida, o únete al de otra persona.</p>
        <div class="grilla-2">
          <button type="button" class="boton" id="eq-crear">Crear hogar</button>
          <button type="button" class="boton boton--sec" id="eq-unirme">Tengo un código</button>
        </div>
      </div>`;
  }
  return `
    <div class="tarjeta pila">
      <div class="fila fila--entre">
        <div style="min-width:0">
          <strong class="equipo__nombre">${esc(eq.nombre)}</strong>
          <p class="quieto" style="margin:2px 0 0">${esc(nombreDeporte(eq.deporte))} · ${estado.personas.length} ${estado.personas.length === 1 ? 'persona' : 'personas'}</p>
        </div>
        ${admin ? '<button type="button" class="boton boton--texto boton--chico" id="eq-editar">Editar</button>' : ''}
      </div>
      <ul class="miembros">
        ${estado.personas.map((p) => `
          <li class="miembro">
            <span class="miembro__avatar" aria-hidden="true">${cara(p)}</span>
            <span class="miembro__nombre">${esc(p.nombre)}${p.id === estado.yo.id ? ' <span class="quieto">(tú)</span>' : ''}</span>
            ${p.id === eq.admin_id ? '<span class="etiqueta etiqueta--mini">Admin</span>' : ''}
            ${admin && p.id !== estado.yo.id ? `<button type="button" class="boton boton--texto boton--chico miembro__quitar" data-quitar-miembro="${esc(p.id)}" aria-label="Quitar a ${esc(p.nombre)} del hogar">Quitar</button>` : ''}
          </li>`).join('')}
      </ul>
      <div class="invitar">
        <p class="seccion__titulo" style="margin:0">Invitar</p>
        <button type="button" class="codigo" id="eq-copiar" aria-label="Copiar el código ${esc(eq.codigo)}">${esc(eq.codigo)}</button>
        <p class="ayuda" style="margin:0">Quien se une instala la app, entra con Google y usa este código.</p>
        <div class="grilla-2">
          <button type="button" class="boton" style="gap:8px" id="eq-compartir">${ICONO_COMPARTIR}Compartir</button>
          ${admin ? '<button type="button" class="boton boton--sec" id="eq-codigo">Renovar</button>' : '<button type="button" class="boton boton--sec" id="eq-copiar2">Copiar código</button>'}
        </div>
      </div>
      <button type="button" class="boton boton--peligro" id="eq-salir">Salir del hogar</button>
    </div>`;
}

function confirmar(titulo, texto, accion, { boton = 'Confirmar', peligro = false } = {}) {
  const d = abrirDialogo(`
    <div class="dialogo">
      <h2 class="tarjeta__titulo">${esc(titulo)}</h2>
      <p style="margin:0">${texto}</p>
      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
        <button type="button" class="boton ${peligro ? 'boton--peligro' : ''}" id="ok">${esc(boton)}</button>
      </div>
    </div>`, titulo);
  d.querySelector('#ok').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try { await accion(); d.close(); } catch (err) { avisoError(err); e.currentTarget.disabled = false; }
  });
}

// Pedir un texto (nombre del hogar, código) con un diálogo simple.
function pedirTexto(titulo, { etiqueta, valor = '', placeholder = '', codigo = false, ayuda = '', boton = 'Guardar', conDeporte = null }, accion) {
  const d = abrirDialogo(`
    <form class="dialogo" novalidate>
      <h2 class="tarjeta__titulo">${esc(titulo)}</h2>
      ${etiqueta ? `<div class="campo">
        <label for="t-valor">${esc(etiqueta)}</label>
        <input id="t-valor" type="text" maxlength="${codigo ? 6 : 40}" ${codigo ? 'class="input-codigo" autocapitalize="characters" autocomplete="off" spellcheck="false"' : ''} value="${esc(valor)}" placeholder="${esc(placeholder)}">
      </div>` : ''}
      ${ayuda ? `<p class="ayuda" style="margin:0">${ayuda}</p>` : ''}
      ${conDeporte !== null ? `<div class="campo"><label>Deporte</label>${selectorDeporte(conDeporte)}</div>` : ''}
      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
        <button type="submit" class="boton" id="ok">${esc(boton)}</button>
      </div>
    </form>`, titulo);
  const input = d.querySelector('#t-valor');
  if (codigo) input.addEventListener('input', () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  const leerDeporte = conDeporte !== null ? conectarDeporte(d) : () => null;
  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = d.querySelector('#ok');
    ok.disabled = true;
    try { await accion(input?.value.trim() ?? '', leerDeporte()); d.close(); } catch (err) { avisoError(err); ok.disabled = false; }
  });
}

function conectarEquipo(app) {
  const eq = estado.equipo;
  if (!eq) return;
  const recargar = async (mensaje) => { await cargarPersonas(); aviso(mensaje); vistaPerfil(app); };
  const cambiarDeEquipo = async (mensaje) => { aviso(mensaje); setTimeout(() => { location.replace('#/hoy'); location.reload(); }, 900); };
  const $ = (s) => app.querySelector(s);

  $('#eq-deporte')?.addEventListener('click', () => pedirTexto('Tu deporte', { conDeporte: eq.deporte }, async (_, deporte) => {
    await editarEquipo({ deporte }); await recargar('Deporte actualizado.');
  }));
  $('#eq-crear')?.addEventListener('click', () => pedirTexto('Crear un hogar', {
    etiqueta: 'Nombre del hogar', placeholder: 'Ej. Casa Del Bono', boton: 'Crear',
    ayuda: 'Lo que ya registraste se queda. Después te damos un código para invitar a los demás.', conDeporte: eq.deporte,
  }, async (nombre, deporte) => {
    await convertirEnEquipo(nombre);
    if (deporte && deporte !== eq.deporte) await editarEquipo({ deporte });
    await recargar('Hogar creado. Ya puedes invitar gente.');
  }));
  $('#eq-unirme')?.addEventListener('click', () => pedirTexto('Unirme a un hogar', {
    etiqueta: 'Código', placeholder: 'ABC123', codigo: true, boton: 'Unirme',
    ayuda: 'Tus mediciones, entrenos y comidas van contigo al hogar.',
  }, async (codigo) => {
    if (codigo.length !== 6) throw Object.assign(new Error('El código tiene 6 letras o números.'), { code: 'P0001' });
    await unirmeEquipo(codigo); await cambiarDeEquipo('¡Listo! Ya estás en el hogar.');
  }));
  $('#eq-editar')?.addEventListener('click', () => pedirTexto('Editar hogar', { etiqueta: 'Nombre', valor: eq.nombre, conDeporte: eq.deporte }, async (nombre, deporte) => {
    await editarEquipo({ nombre, deporte }); await recargar('Hogar actualizado.');
  }));
  const copiarCodigo = () => copiar(eq.codigo, `Código ${eq.codigo} copiado.`);
  $('#eq-copiar')?.addEventListener('click', copiarCodigo);
  $('#eq-copiar2')?.addEventListener('click', copiarCodigo);
  $('#eq-compartir')?.addEventListener('click', () => compartirInvitacion(eq));
  $('#eq-codigo')?.addEventListener('click', () => confirmar('Nuevo código', 'El código actual deja de funcionar. Quienes ya están en el hogar no se ven afectados.', async () => {
    await editarEquipo({ nuevoCodigo: true }); await recargar('Código nuevo listo.');
  }, { boton: 'Cambiar código' }));
  app.querySelectorAll('[data-quitar-miembro]').forEach((b) => b.addEventListener('click', () => {
    const p = estado.personas.find((x) => x.id === b.dataset.quitarMiembro);
    confirmar(`¿Quitar a ${p.nombre}?`, `${esc(p.nombre)} deja de ver la semana, las rutinas y las comidas del hogar. Su cuenta sigue funcionando en un espacio personal, con sus mediciones y entrenos.`, async () => {
      await quitarDelEquipo(p.id); await recargar(`${p.nombre} ya no está en el hogar.`);
    }, { boton: 'Quitar', peligro: true });
  }));
  $('#eq-salir')?.addEventListener('click', () => {
    const otros = estado.personas.length > 1;
    const texto = soyAdmin() && otros
      ? `Dejas de ver lo del hogar y pasas a un espacio personal con tus mediciones y entrenos. El rol de admin pasa a quien lleva más tiempo en el hogar.`
      : 'Dejas de ver lo del hogar y pasas a un espacio personal con tus mediciones y entrenos.';
    confirmar('¿Salir del hogar?', texto, async () => {
      await salirDelEquipo(); await cambiarDeEquipo('Saliste del hogar.');
    }, { boton: 'Salir', peligro: true });
  });
}

// ---------- Foto de perfil ----------
const fotoGoogle = () => {
  const m = estado.usuario?.user_metadata ?? {};
  const url = m.avatar_url ?? m.picture;
  return url?.startsWith('https://') ? url : null;
};

/** Recorta al centro en cuadrado, achica a 384 px y devuelve un JPEG. */
async function fotoCuadrada(archivo) {
  const img = await createImageBitmap(archivo);
  const lado = Math.min(img.width, img.height);
  const lienzo = document.createElement('canvas');
  lienzo.width = lienzo.height = Math.min(384, lado);
  lienzo.getContext('2d').drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, lienzo.width, lienzo.height);
  return new Promise((ok) => lienzo.toBlob(ok, 'image/jpeg', 0.86));
}

function conectarFoto(app) {
  const yo = estado.yo;
  const guardar = async (url, mensaje) => {
    datos(await sb.from('personas').update({ avatar_url: url }).eq('id', yo.id));
    await cargarPersonas();
    aviso(mensaje);
    vistaPerfil(app);
  };
  const archivo = app.querySelector('#foto-archivo');
  app.querySelector('#foto-subir').addEventListener('click', () => archivo.click());
  archivo.addEventListener('change', async () => {
    const f = archivo.files?.[0];
    archivo.value = '';
    if (!f) return;
    const boton = app.querySelector('#foto-subir');
    boton.disabled = true;
    boton.textContent = 'Subiendo…';
    try {
      const blob = await fotoCuadrada(f);
      const ruta = `${yo.id}/avatar.jpg`;
      datos(await sb.storage.from('avatares').upload(ruta, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' }));
      const { data } = sb.storage.from('avatares').getPublicUrl(ruta);
      await guardar(`${data.publicUrl}?v=${Date.now()}`, 'Foto actualizada.');
    } catch (err) {
      avisoError(err);
      boton.disabled = false;
      boton.textContent = 'Cambiar foto';
    }
  });
  app.querySelector('#foto-google')?.addEventListener('click', () => guardar(fotoGoogle(), 'Listo: tu foto de Google.').catch(avisoError));
  app.querySelector('#foto-quitar')?.addEventListener('click', async () => {
    try {
      await sb.storage.from('avatares').remove([`${yo.id}/avatar.jpg`]);
      await guardar(null, 'Foto quitada.');
    } catch (err) { avisoError(err); }
  });
}
