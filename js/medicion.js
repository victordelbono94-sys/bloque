// Nueva medición, paso a paso (pedido de Victor, 6/11): ¿qué quieres actualizar? → peso o bioimpedancia →
// a mano, con foto/captura o (bioimpedancia) con el PDF → revisar y guardar. Sin chat: la IA solo lee la foto o el PDF.
import { sb, estado, datos } from './db.js';
import { esc, aviso, avisoError, abrirDialogo } from './ui.js';
import { llamarIA } from './ia.js';
import { fotoBase64 } from './comida/comun.js';

// Mismos campos (y rangos) que la medición manual de Perfil.
export const CAMPOS_MEDICION = [
  { id: 'peso_kg', etiqueta: 'Peso', unidad: 'kg', min: 30, max: 250 },
  { id: 'grasa_pct', etiqueta: 'Grasa', unidad: '%', min: 2, max: 70 },
  { id: 'musculo_esqueletico_kg', etiqueta: 'Músculo esquelético', unidad: 'kg', min: 5, max: 100 },
  { id: 'masa_muscular_kg', etiqueta: 'Masa muscular', unidad: 'kg', min: 5, max: 120 },
  { id: 'masa_grasa_kg', etiqueta: 'Masa grasa', unidad: 'kg', min: 1, max: 200 },
  { id: 'masa_magra_kg', etiqueta: 'Masa magra', unidad: 'kg', min: 10, max: 150 },
  { id: 'agua_pct', etiqueta: 'Agua', unidad: '%', min: 20, max: 80 },
  { id: 'grasa_visceral', etiqueta: 'Grasa visceral', unidad: '', min: 1, max: 60 },
  { id: 'masa_osea_kg', etiqueta: 'Masa ósea', unidad: 'kg', min: 0.5, max: 10 },
  { id: 'metabolismo_basal_kcal', etiqueta: 'Metabolismo basal', unidad: 'kcal', min: 600, max: 4500 },
  { id: 'agua_intracelular_l', etiqueta: 'Agua intracelular', unidad: 'L', min: 5, max: 60 },
  { id: 'agua_extracelular_l', etiqueta: 'Agua extracelular', unidad: 'L', min: 3, max: 40 },
  { id: 'angulo_fase', etiqueta: 'Ángulo de fase', unidad: '°', min: 1, max: 15 },
];

// Acepta «66,4» y «66.4» (el teclado del teléfono en español pone coma: antes eso dejaba el peso vacío).
export const numero = (t) => { const v = Number(String(t ?? '').trim().replace(',', '.')); return String(t ?? '').trim() && Number.isFinite(v) ? v : null; };
const fmt = (v) => (v == null ? '' : String(Math.round(v * 100) / 100).replace('.', ','));
const ahoraLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const leerArchivo = (f) => new Promise((ok, no) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1]);
  r.onerror = () => no(new Error('No se pudo leer el archivo.'));
  r.readAsDataURL(f);
});

/** Abre el asistente. alGuardar() se llama después de guardar. */
export async function nuevaMedicion(alGuardar = () => {}) {
  let ultima = null;
  try {
    [ultima] = datos(await sb.from('mediciones_corporales').select('*').eq('persona_id', estado.yo.id).not('peso_kg', 'is', null)
      .order('medido_en', { ascending: false }).limit(1));
  } catch { /* sin datos */ }

  const d = abrirDialogo('<div class="dialogo med" id="med"></div>', 'Nueva medición');
  const caja = d.querySelector('#med');
  let tipo = null; // 'peso' | 'bio'

  const paso1 = () => {
    caja.innerHTML = `
      <h2 class="tarjeta__titulo">¿Qué quieres actualizar?</h2>
      <div class="pila" style="gap:10px">
        <button type="button" class="opcion-fila" data-tipo="peso"><strong>Peso</strong><span>De tu balanza de casa o del gym.</span></button>
        <button type="button" class="opcion-fila" data-tipo="bio"><strong>Bioimpedancia</strong><span>Grasa, músculo, agua y más: del PDF, de una foto o a mano.</span></button>
      </div>
      <div class="dialogo__pie"><button type="button" class="boton boton--sec" data-cerrar>Cancelar</button></div>`;
    caja.querySelectorAll('[data-tipo]').forEach((b) => b.addEventListener('click', () => { tipo = b.dataset.tipo; tipo === 'peso' ? pasoPeso() : pasoBio(); }));
  };

  // Peso: número grande con − / +, o foto de la balanza.
  const pasoPeso = (valor = ultima?.peso_kg ?? null) => {
    caja.innerHTML = `
      <h2 class="tarjeta__titulo">Peso</h2>
      <div class="med__peso">
        <button type="button" class="med__paso" data-delta="-0.1" aria-label="Menos 100 g">−</button>
        <label class="med__num"><input id="med-peso" type="text" inputmode="decimal" value="${esc(fmt(valor))}" placeholder="0,0" aria-label="Peso en kg"><span>kg</span></label>
        <button type="button" class="med__paso" data-delta="0.1" aria-label="Más 100 g">+</button>
      </div>
      ${ultima?.peso_kg ? `<p class="quieto" style="margin:0;text-align:center">La última vez: ${esc(fmt(ultima.peso_kg))} kg</p>` : ''}
      <button type="button" class="boton boton--sec" id="med-foto">Leer la balanza con una foto</button>
      <input type="file" id="med-foto-in" accept="image/*" capture="environment" hidden>
      <p class="quieto" id="med-estado" hidden></p>
      <div class="campo"><label for="med-fecha">Fecha y hora</label><input id="med-fecha" type="datetime-local" value="${ahoraLocal()}"></div>
      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" id="med-atras">Atrás</button>
        <button type="button" class="boton" id="med-guardar">Guardar</button>
      </div>`;
    const inp = caja.querySelector('#med-peso');
    caja.querySelectorAll('[data-delta]').forEach((b) => b.addEventListener('click', () => {
      const v = numero(inp.value) ?? ultima?.peso_kg ?? 60;
      inp.value = fmt(Math.round((v + Number(b.dataset.delta)) * 10) / 10);
    }));
    caja.querySelector('#med-atras').addEventListener('click', paso1);
    caja.querySelector('#med-foto').addEventListener('click', () => caja.querySelector('#med-foto-in').click());
    caja.querySelector('#med-foto-in').addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const r = await leerConIA(f, 'image/jpeg', 'Foto de la balanza: lee solo el peso (y grasa o músculo si la balanza los muestra).');
      if (r?.peso_kg) { inp.value = fmt(r.peso_kg); estadoTexto(`✓ Leí ${fmt(r.peso_kg)} kg. Revísalo antes de guardar.`); }
    });
    caja.querySelector('#med-guardar').addEventListener('click', () => {
      const v = numero(inp.value);
      if (v == null || v < 30 || v > 250) return aviso('Escribe tu peso en kg (entre 30 y 250).', 'error');
      guardar({ peso_kg: v, origen: 'balanza' });
    });
    setTimeout(() => inp.focus(), 100);
  };

  // Bioimpedancia: elegir de dónde vienen los datos.
  const pasoBio = () => {
    caja.innerHTML = `
      <h2 class="tarjeta__titulo">Bioimpedancia</h2>
      <p class="quieto" style="margin:-6px 0 0">¿Cómo quieres cargarla?</p>
      <div class="pila" style="gap:10px">
        <button type="button" class="opcion-fila" data-de="pdf"><strong>Subir el PDF</strong><span>El informe que te dieron. Saco todos los datos.</span></button>
        <button type="button" class="opcion-fila" data-de="foto"><strong>Foto o captura</strong><span>De la hoja impresa o de la pantalla.</span></button>
        <button type="button" class="opcion-fila" data-de="mano"><strong>Llenar a mano</strong><span>Solo los datos que tengas.</span></button>
      </div>
      <input type="file" id="med-pdf" accept="application/pdf" hidden>
      <input type="file" id="med-img" accept="image/*" hidden>
      <p class="quieto" id="med-estado" hidden></p>
      <div class="dialogo__pie"><button type="button" class="boton boton--sec" id="med-atras">Atrás</button></div>`;
    caja.querySelector('#med-atras').addEventListener('click', paso1);
    caja.querySelector('[data-de="pdf"]').addEventListener('click', () => caja.querySelector('#med-pdf').click());
    caja.querySelector('[data-de="foto"]').addEventListener('click', () => caja.querySelector('#med-img').click());
    caja.querySelector('[data-de="mano"]').addEventListener('click', () => revisar({}, 'manual'));
    const subir = async (f, tipoArch) => {
      if (!f) return;
      const r = await leerConIA(f, tipoArch, 'Informe de bioimpedancia: extrae TODOS los datos que aparezcan y la fecha de la medición.');
      if (r) revisar(r, 'hospital');
    };
    caja.querySelector('#med-pdf').addEventListener('change', (e) => subir(e.target.files?.[0], 'application/pdf'));
    caja.querySelector('#med-img').addEventListener('change', (e) => subir(e.target.files?.[0], 'image/jpeg'));
  };

  // Revisar antes de guardar: todos los campos editables, con lo que leyó la IA ya puesto.
  const revisar = (valores, origen) => {
    const leidos = CAMPOS_MEDICION.filter((c) => valores[c.id] != null).length;
    const fecha = valores.medido_en ? `${valores.medido_en}T08:00` : ahoraLocal();
    caja.innerHTML = `
      <h2 class="tarjeta__titulo">Revisa y guarda</h2>
      ${origen !== 'manual' ? `<p class="quieto" style="margin:-6px 0 0">${leidos ? `Encontré ${leidos} dato${leidos === 1 ? '' : 's'}. Corrige lo que haga falta.` : 'No encontré datos: complétalos a mano.'}</p>` : '<p class="quieto" style="margin:-6px 0 0">Llena solo lo que tengas.</p>'}
      <div class="grilla-2">
        ${CAMPOS_MEDICION.map((c) => `
          <div class="campo">
            <label for="mr-${c.id}">${c.etiqueta}${c.unidad ? ` (${c.unidad})` : ''}</label>
            <input id="mr-${c.id}" type="text" inputmode="decimal" value="${esc(fmt(valores[c.id]))}">
          </div>`).join('')}
      </div>
      <div class="campo"><label for="med-fecha">Fecha y hora</label><input id="med-fecha" type="datetime-local" value="${fecha}"></div>
      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" id="med-atras">Atrás</button>
        <button type="button" class="boton" id="med-guardar">Guardar</button>
      </div>`;
    caja.querySelector('#med-atras').addEventListener('click', pasoBio);
    caja.querySelector('#med-guardar').addEventListener('click', () => {
      const fila = { origen, es_referencia: origen === 'hospital' };
      for (const c of CAMPOS_MEDICION) {
        const t = caja.querySelector(`#mr-${c.id}`).value;
        const v = numero(t);
        if (t.trim() && (v == null || v < c.min || v > c.max)) return aviso(`${c.etiqueta}: revisa el valor (entre ${c.min} y ${c.max}).`, 'error');
        if (v != null) fila[c.id] = v;
      }
      if (!CAMPOS_MEDICION.some((c) => fila[c.id] != null)) return aviso('Escribe al menos un dato.', 'error');
      guardar(fila);
    });
  };

  const estadoTexto = (t) => { const p = caja.querySelector('#med-estado'); if (p) { p.hidden = !t; p.textContent = t; } };
  // La IA solo lee el archivo (con respaldo). Devuelve los valores o null.
  const leerConIA = async (archivo, tipoArch, mensaje) => {
    estadoTexto(tipoArch === 'application/pdf' ? 'Leyendo el PDF…' : 'Mirando la foto…');
    caja.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      const datosArch = tipoArch === 'application/pdf' ? await leerArchivo(archivo) : await fotoBase64(archivo);
      const r = await llamarIA('cuerpo', { mensaje, archivo: datosArch, tipo: tipoArch, contexto: {} }, { manual: 'Puedes llenarlo a mano.' });
      if (!r.medicion) { estadoTexto('No encontré datos en el archivo. Prueba otra foto o llénalo a mano.'); return null; }
      estadoTexto('');
      return r.medicion;
    } catch (err) {
      estadoTexto(err.message);
      return null;
    } finally {
      caja.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  };

  const guardar = async (valores) => {
    const boton = caja.querySelector('#med-guardar');
    const fechaTxt = caja.querySelector('#med-fecha')?.value;
    const medido = fechaTxt ? new Date(fechaTxt) : new Date();
    // Nunca con fecha futura (era el bug del peso de Sant del 4/11).
    const fila = { persona_id: estado.yo.id, ...valores, medido_en: (medido > new Date() ? new Date() : medido).toISOString() };
    boton.disabled = true;
    try {
      datos(await sb.from('mediciones_corporales').insert(fila).select('id'));
      d.close();
      aviso(fila.peso_kg != null && Object.keys(valores).length <= 2 ? `Peso guardado: ${fmt(fila.peso_kg)} kg.` : 'Medición guardada.');
      alGuardar();
    } catch (err) { avisoError(err); boton.disabled = false; }
  };

  paso1();
}
