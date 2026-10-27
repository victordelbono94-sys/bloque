// Pantalla Perfil: mis datos, el hogar, exportar todo y cerrar sesión.
import { sb, estado, datos, cargarPersonas } from '../db.js';
import { esc, aviso, avisoError } from '../ui.js';
import { hoyISO } from '../fechas.js';

const NIVELES = { bajo: 'Bajo', moderado: 'Moderado', alto: 'Alto', muy_alto: 'Muy alto' };

// Todo lo que se exporta. La seguridad por filas ya limita cada tabla al hogar.
const TABLAS = [
  'hogares', 'personas', 'calendario', 'clases', 'actividades_extra', 'estado_diario', 'objetivos',
  'mediciones_corporales', 'actividad_diaria', 'sesiones_banda', 'maquinas', 'ejercicios',
  'ejercicio_alternativas', 'rutinas', 'rutina_ejercicios', 'metas_ejercicio', 'sesiones', 'series',
  'recetas', 'ingredientes', 'comidas', 'porciones', 'chat_mensajes',
];

export async function vistaPerfil(app) {
  const yo = estado.yo;
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

  app.querySelector('#exportar-json').addEventListener('click', exportarJSON);
  app.querySelector('#exportar-csv').addEventListener('click', exportarCSV);
  app.querySelector('#salir').addEventListener('click', () => sb.auth.signOut());
}

function descargar(nombre, contenido, tipo) {
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
