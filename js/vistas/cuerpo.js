// Pantalla Cuerpo: peso y bioimpedancia de cada uno, con su tendencia.
// Cada medición es un registro nuevo; nunca se sobrescribe el historial.
import { sb, estado, datos, nombrePersona } from '../db.js';
import { esc, num, aviso, avisoError, abrirDialogo, grupoChips, valorChips, graficaLinea } from '../ui.js';
import { fechaCorta, ahoraLocalInput } from '../fechas.js';

const CAMPOS = [
  { id: 'peso_kg', etiqueta: 'Peso', unidad: 'kg', min: 30, max: 250, paso: 0.1 },
  { id: 'grasa_pct', etiqueta: 'Grasa', unidad: '%', min: 2, max: 70, paso: 0.1 },
  { id: 'masa_muscular_kg', etiqueta: 'Masa muscular', unidad: 'kg', min: 5, max: 120, paso: 0.1 },
  { id: 'masa_magra_kg', etiqueta: 'Masa magra', unidad: 'kg', min: 10, max: 150, paso: 0.1 },
  { id: 'agua_pct', etiqueta: 'Agua', unidad: '%', min: 20, max: 80, paso: 0.1 },
  { id: 'grasa_visceral', etiqueta: 'Grasa visceral', unidad: '', min: 1, max: 60, paso: 0.5 },
  { id: 'masa_osea_kg', etiqueta: 'Masa ósea', unidad: 'kg', min: 0.5, max: 10, paso: 0.01 },
  { id: 'metabolismo_basal_kcal', etiqueta: 'Metabolismo basal', unidad: 'kcal', min: 600, max: 4500, paso: 1 },
];

const ORIGENES = { manual: 'A mano', balanza: 'Balanza', hospital: 'Hospital deportivo', health_connect: 'Health Connect' };

const GRAFICAS = [
  { id: 'peso_kg', titulo: 'Peso', unidad: 'kg' },
  { id: 'grasa_pct', titulo: 'Grasa', unidad: '%' },
  { id: 'masa_muscular_kg', titulo: 'Masa muscular', unidad: 'kg' },
];

export async function vistaCuerpo(app) {
  const param = location.hash.split('/')[2];
  const persona = estado.personas.find((p) => p.id === param) ?? estado.yo;
  const soyYo = persona.id === estado.yo.id;

  const mediciones = await sb.from('mediciones_corporales').select('*')
    .eq('persona_id', persona.id).order('medido_en', { ascending: false }).limit(200).then(datos);

  const cronologico = [...mediciones].reverse();

  app.innerHTML = `
    <header class="encabezado">
      <div>
        <h1 class="titulo">Cuerpo</h1>
        <p class="subtitulo">Peso y bioimpedancia</p>
      </div>
      <button type="button" class="boton boton--sec boton--chico" id="ver-semana">📊 Semana</button>
    </header>

    ${estado.personas.length > 1 ? `
      <nav class="chips" aria-label="Persona">
        ${estado.personas.map((p) => `<a class="chip" style="display:inline-flex;align-items:center;text-decoration:none" href="#/cuerpo/${esc(p.id)}" ${p.id === persona.id ? 'aria-current="page"' : ''}>${esc(p.id === estado.yo.id ? 'Yo' : p.nombre)}</a>`).join('')}
      </nav>` : ''}

    ${soyYo ? '<button type="button" class="boton boton--bloque" style="margin-top:16px" id="nueva">Nueva medición</button>' : ''}

    ${GRAFICAS.map((g) => {
      const puntos = cronologico
        .filter((m) => m[g.id] != null)
        .map((m) => ({ fecha: new Date(m.medido_en), valor: Number(m[g.id]), referencia: m.es_referencia }));
      if (!puntos.length) return '';
      const ultimo = puntos.at(-1);
      const primero = puntos[0];
      const cambio = ultimo.valor - primero.valor;
      return `
        <section class="tarjeta seccion" aria-labelledby="g-${g.id}">
          <div class="fila fila--entre" style="align-items:flex-end">
            <div>
              <h2 class="seccion__titulo" id="g-${g.id}" style="margin:0 0 6px">${g.titulo}</h2>
              <span class="dato-grande">${num(ultimo.valor)}</span><span class="dato-unidad">${g.unidad}</span>
            </div>
            ${puntos.length > 1 ? `<span class="quieto">${cambio > 0 ? '+' : ''}${num(cambio)} ${g.unidad} desde ${esc(fechaCorta(primero.fecha))}</span>` : ''}
          </div>
          <div style="margin-top:12px">${graficaLinea(puntos, { unidad: g.unidad })}</div>
        </section>`;
    }).join('')}

    <section class="seccion" aria-labelledby="historial">
      <h2 class="seccion__titulo" id="historial">Historial</h2>
      <div class="tarjeta">
        ${mediciones.length ? mediciones.map((m) => itemMedicion(m, soyYo)).join('') : `<p class="vacio">${soyYo ? 'Todavía no hay mediciones. Agrega la primera.' : `${esc(nombrePersona(persona.id))} todavía no tiene mediciones.`}</p>`}
      </div>
      <p class="ayuda" style="margin-top:10px">El punto lleno en la gráfica marca una medición de referencia, como las pruebas del hospital deportivo.</p>
    </section>`;

  const recargar = () => vistaCuerpo(app);
  app.querySelector('#ver-semana')?.addEventListener('click', async () => (await import('../semanal.js')).abrirResumenSemanal(persona.id));
  app.querySelector('#nueva')?.addEventListener('click', () => dialogoMedicion(recargar));
  app.querySelectorAll('[data-borrar]').forEach((b) =>
    b.addEventListener('click', () => borrarMedicion(b.dataset.borrar, recargar)));
}

function itemMedicion(m, soyYo) {
  const valores = CAMPOS
    .filter((c) => m[c.id] != null)
    .map((c) => `<span>${c.etiqueta}: <strong>${num(m[c.id], c.paso < 0.1 ? 2 : c.paso < 1 ? 1 : 0)}</strong>${c.unidad ? ` ${c.unidad}` : ''}</span>`)
    .join('');
  const borrable = soyYo && m.origen !== 'health_connect';
  return `
    <div class="medicion">
      <div class="fila fila--entre">
        <div class="fila" style="gap:8px;flex-wrap:wrap">
          <strong>${esc(fechaCorta(m.medido_en))}</strong>
          <span class="quieto">${esc(ORIGENES[m.origen] ?? m.origen)}</span>
          ${m.es_referencia ? '<span class="etiqueta etiqueta--referencia">Referencia</span>' : ''}
        </div>
        ${borrable ? `<button type="button" class="boton boton--peligro" data-borrar="${esc(m.id)}" aria-label="Eliminar medición del ${esc(fechaCorta(m.medido_en))}">Eliminar</button>` : ''}
      </div>
      <div class="medicion__datos">${valores}</div>
      ${m.notas ? `<p class="quieto" style="margin:6px 0 0">${esc(m.notas)}</p>` : ''}
    </div>`;
}

function dialogoMedicion(alGuardar) {
  const d = abrirDialogo(`
    <form class="dialogo" novalidate>
      <h2 class="tarjeta__titulo">Nueva medición</h2>

      <div class="campo">
        <label for="medido_en">Fecha y hora</label>
        <input id="medido_en" type="datetime-local" value="${ahoraLocalInput()}" required>
      </div>

      <fieldset class="campo">
        <legend>De dónde viene</legend>
        <div class="chips" id="origen">
          <button type="button" class="chip" data-valor="manual" aria-pressed="true">A mano</button>
          <button type="button" class="chip" data-valor="balanza" aria-pressed="false">Balanza</button>
          <button type="button" class="chip" data-valor="hospital" aria-pressed="false">Hospital deportivo</button>
        </div>
      </fieldset>

      <div class="grilla-2">
        ${CAMPOS.map((c) => `
          <div class="campo">
            <label for="${c.id}">${c.etiqueta}${c.unidad ? ` (${c.unidad})` : ''}</label>
            <input id="${c.id}" type="number" inputmode="decimal" min="${c.min}" max="${c.max}" step="${c.paso}">
          </div>`).join('')}
      </div>

      <label class="campo campo--check" for="es_referencia">
        <input id="es_referencia" type="checkbox">
        Es una medición de referencia
      </label>

      <div class="campo">
        <label for="notas">Notas</label>
        <input id="notas" type="text" maxlength="200" placeholder="Opcional">
      </div>

      <p class="ayuda">Llena solo lo que tengas. Lo que Health Connect soporta se sincroniza con el teléfono.</p>

      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
        <button type="submit" class="boton" id="guardar">Guardar</button>
      </div>
    </form>`, 'Nueva medición', { pantalla: true });

  const origen = d.querySelector('#origen');
  const referencia = d.querySelector('#es_referencia');
  grupoChips(origen, (v) => { referencia.checked = v === 'hospital'; });

  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fila = {
      persona_id: estado.yo.id,
      medido_en: new Date(d.querySelector('#medido_en').value).toISOString(),
      origen: valorChips(origen),
      es_referencia: referencia.checked,
      notas: d.querySelector('#notas').value.trim() || null,
    };
    let alguno = false;
    for (const c of CAMPOS) {
      const input = d.querySelector(`#${c.id}`);
      if (input.value === '') { fila[c.id] = null; continue; }
      const v = Number(input.value);
      if (!Number.isFinite(v) || v < c.min || v > c.max) {
        input.focus();
        return aviso(`${c.etiqueta}: revisa el valor (entre ${c.min} y ${c.max}).`, 'error');
      }
      fila[c.id] = v;
      alguno = true;
    }
    if (!alguno) return aviso('Ingresa al menos un dato.', 'error');
    if (Number.isNaN(Date.parse(fila.medido_en))) return aviso('Revisa la fecha.', 'error');

    const boton = d.querySelector('#guardar');
    boton.disabled = true;
    try {
      datos(await sb.from('mediciones_corporales').insert(fila));
      d.close();
      aviso('Medición guardada.');
      alGuardar();
    } catch (err) {
      avisoError(err);
      boton.disabled = false;
    }
  });
}

function borrarMedicion(id, alTerminar) {
  const d = abrirDialogo(`
    <div class="dialogo">
      <h2 class="tarjeta__titulo">¿Eliminar la medición?</h2>
      <p>Se borra de Bloque. Si ya se había sincronizado con Health Connect, bórrala también allá.</p>
      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
        <button type="button" class="boton" id="confirmar">Eliminar</button>
      </div>
    </div>`, 'Eliminar medición');
  d.querySelector('#confirmar').addEventListener('click', async () => {
    try {
      datos(await sb.from('mediciones_corporales').delete().eq('id', id));
      d.close();
      aviso('Eliminada.');
      alTerminar();
    } catch (err) {
      avisoError(err);
    }
  });
}
