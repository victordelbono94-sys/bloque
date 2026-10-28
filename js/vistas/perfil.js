// Pantalla Perfil: mis datos, el hogar, exportar todo y cerrar sesión.
import { sb, estado, datos, cargarPersonas } from '../db.js';
import { esc, aviso, avisoError } from '../ui.js';
import { hoyISO, fechaCorta } from '../fechas.js';
import {
  enApp, APK, estadoNativo, pedirPermisos, sincronizarAhora, alEventoNativo, abrirExterno, guardarArchivo, asegurarVinculo, buscarActualizacion,
} from '../nativo.js';

const NIVELES = { bajo: 'Bajo', moderado: 'Moderado', alto: 'Alto', muy_alto: 'Muy alto' };

// Todo lo que se exporta. La seguridad por filas ya limita cada tabla al hogar.
const TABLAS = [
  'hogares', 'personas', 'calendario', 'clases', 'actividades_extra', 'estado_diario', 'objetivos',
  'mediciones_corporales', 'actividad_diaria', 'sesiones_banda', 'maquinas', 'ejercicios',
  'ejercicio_alternativas', 'rutinas', 'rutina_ejercicios', 'metas_ejercicio', 'sesiones', 'series',
  'recetas', 'ingredientes', 'comidas', 'porciones', 'chat_mensajes', 'dispositivos',
];

export async function vistaPerfil(app) {
  const yo = estado.yo;
  const dispositivos = datos(await sb.from('dispositivos').select('id, nombre, creado_en, ultimo_sync').order('creado_en'));
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
