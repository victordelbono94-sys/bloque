// Pantalla Cuerpo: peso y bioimpedancia de cada uno, con su tendencia.
// Cada medición es un registro nuevo; nunca se sobrescribe el historial.
import { sb, estado, datos, nombrePersona } from '../db.js';
import { esc, num, aviso, avisoError, abrirDialogo, grupoChips, valorChips, cara } from '../ui.js';
import { fabIA } from '../chatia.js';
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

// Lo que se puede ver en el cuerpo (el que tenga datos). bueno: hacia dónde es mejor que vaya (según el objetivo para el peso).
const METRICAS = [
  { id: 'peso_kg', nombre: 'Peso', unidad: 'kg', color: '#C6F432' },
  { id: 'grasa_pct', nombre: 'Grasa', unidad: '%', color: '#F5B841', bueno: -1, nivel: (v) => Math.min(1, v / 45) },
  { id: 'masa_muscular_kg', nombre: 'Músculo', unidad: 'kg', color: '#7CF2B6', bueno: 1 },
  { id: 'agua_pct', nombre: 'Agua', unidad: '%', color: '#4FC3F7', bueno: 1, nivel: (v) => v / 100 },
  { id: 'grasa_visceral', nombre: 'Visceral', unidad: '', color: '#FF8B6B', bueno: -1 },
];

// Silueta sin género: cabeza, tronco recto, brazos y piernas redondeados.
const SILUETA = 'M50 6a15 15 0 1 1 0 30a15 15 0 1 1 0-30z M37 40h26c9 0 15 6 16 14l5 44c1 5-6 7-8 2l-6-36v38l3 84c0 6-10 6-11 0l-6-70h-4l-6 70c-1 6-11 6-11 0l3-84V64l-6 36c-2 5-9 3-8-2l5-44c1-8 7-14 16-14z';

function htmlCuerpoVisual(m, valor, peso) {
  let nivel = 1;
  if (m.id === 'masa_muscular_kg' && peso) nivel = Math.min(1, valor / peso / 0.6);
  else if (m.nivel) nivel = m.nivel(valor);
  const alto = 200 * nivel;
  return `
    <svg class="cuerpo-svg" viewBox="0 0 100 200" aria-hidden="true">
      <defs><clipPath id="silueta"><path d="${SILUETA}"/></clipPath>
        <linearGradient id="relleno" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${m.color}" stop-opacity=".95"/><stop offset="1" stop-color="${m.color}" stop-opacity=".45"/></linearGradient></defs>
      <path d="${SILUETA}" class="cuerpo-svg__base"/>
      <g clip-path="url(#silueta)">
        ${m.id === 'grasa_visceral'
          ? `<ellipse cx="50" cy="88" rx="${10 + Math.min(14, valor)}" ry="${8 + Math.min(10, valor * 0.7)}" fill="${m.color}" opacity="${Math.min(0.95, 0.35 + valor / 20)}" class="cuerpo-svg__visceral"/>`
          : `<rect class="cuerpo-svg__nivel" x="0" y="${200 - alto}" width="100" height="${alto}" fill="url(#relleno)"/>
             ${m.id === 'agua_pct' ? `<path class="cuerpo-svg__ola" d="M0 ${200 - alto} q12 -5 25 0 t25 0 t25 0 t25 0 v8 h-100z" fill="${m.color}" opacity=".7"/>` : ''}`}
      </g>
      <path d="${SILUETA}" class="cuerpo-svg__borde"/>
      ${m.nivel || m.id === 'masa_muscular_kg' ? `<line class="cuerpo-svg__linea" x1="-6" x2="106" y1="${200 - alto}" y2="${200 - alto}" stroke="${m.color}"/>` : ''}
    </svg>`;
}

function sparkline(puntos, color) {
  if (puntos.length < 2) return '';
  const ys = puntos.map((p) => p.valor), xs = puntos.map((p) => p.fecha.getTime());
  const y0 = Math.min(...ys), y1 = Math.max(...ys), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const X = (t) => 2 + ((t - x0) / (x1 - x0 || 1)) * 196, Y = (v) => 40 - ((v - y0) / (y1 - y0 || 1)) * 34;
  const d = puntos.map((p, i) => `${i ? 'L' : 'M'}${X(p.fecha.getTime()).toFixed(1)} ${Y(p.valor).toFixed(1)}`).join(' ');
  const u = puntos.at(-1);
  return `<svg class="sparkline" viewBox="0 0 200 44" preserveAspectRatio="none" aria-hidden="true">
    <path d="${d} L198 44 L2 44Z" fill="${color}" opacity=".12"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" pathLength="1" class="sparkline__linea"/>
    <circle cx="${X(u.fecha.getTime())}" cy="${Y(u.valor)}" r="3" fill="${color}"/></svg>`;
}

export async function vistaCuerpo(app) {
  const param = location.hash.split('/')[2];
  const persona = estado.personas.find((p) => p.id === param) ?? estado.yo;
  const soyYo = persona.id === estado.yo.id;

  const [mediciones, objetivo] = await Promise.all([
    sb.from('mediciones_corporales').select('*').eq('persona_id', persona.id).order('medido_en', { ascending: false }).limit(200).then(datos),
    sb.from('objetivos').select('foco').eq('persona_id', persona.id).order('desde', { ascending: false }).limit(1).then(datos).catch(() => []),
  ]);
  const foco = objetivo[0]?.foco ?? 'recomposicion';
  const cronologico = [...mediciones].reverse();
  const conDatos = METRICAS.filter((m) => mediciones.some((x) => x[m.id] != null));
  let elegida = (() => { try { return sessionStorage.getItem('bloque-cuerpo-metrica'); } catch { return null; } })();
  if (!conDatos.some((m) => m.id === elegida)) elegida = conDatos[0]?.id ?? 'peso_kg';
  const pesoActual = Number(mediciones.find((m) => m.peso_kg != null)?.peso_kg) || null;

  const htmlMetrica = (id) => {
    const m = METRICAS.find((x) => x.id === id);
    const puntos = cronologico.filter((x) => x[id] != null).map((x) => ({ fecha: new Date(x.medido_en), valor: Number(x[id]) }));
    if (!puntos.length) return '<p class="quieto" style="margin:0">Sin datos todavía.</p>';
    const u = puntos.at(-1);
    const hace = puntos.filter((p) => p.fecha <= new Date(u.fecha.getTime() - 25 * 864e5)).at(-1) ?? puntos[0];
    const cambio = u.valor - hace.valor;
    const bueno = m.id === 'peso_kg' ? ({ masa_muscular: 1, perder_grasa: -1, recomposicion: -1 }[foco] ?? 0) : (m.bueno ?? 0);
    const tono = !puntos.length || hace === u || Math.abs(cambio) < 0.05 || !bueno ? '' : Math.sign(cambio) === bueno ? 'bien' : 'ojo';
    const dec = m.id === 'grasa_visceral' ? 1 : 1;
    return `
      <div class="cuerpo-hero__visual">${htmlCuerpoVisual(m, u.valor, pesoActual)}</div>
      <div class="cuerpo-hero__datos">
        <span class="cuerpo-hero__nombre">${m.nombre}</span>
        <span class="cuerpo-hero__valor"><strong>${num(u.valor, dec)}</strong>${m.unidad ? `<small>${m.unidad}</small>` : ''}</span>
        ${hace !== u ? `<span class="cuerpo-hero__cambio cuerpo-hero__cambio--${tono}">${cambio > 0 ? '▲' : cambio < 0 ? '▼' : '='} ${num(Math.abs(cambio), dec)} ${m.unidad} <span>desde ${esc(fechaCorta(hace.fecha))}</span></span>` : ''}
        ${sparkline(puntos.slice(-14), m.color)}
        <span class="cuerpo-hero__fecha">Última: ${esc(fechaCorta(u.fecha))}</span>
      </div>`;
  };

  app.innerHTML = `
    <header class="encabezado encabezado--fijo">
      <div>
        <h1 class="titulo">Cuerpo</h1>
        <p class="subtitulo">${soyYo ? 'Tu peso y composición' : `Peso y composición de ${esc(persona.nombre)}`}</p>
      </div>
    </header>

    ${estado.personas.length > 1 ? `
      <div class="ver-persona" role="tablist" aria-label="Persona">
        ${estado.personas.map((p) => `<a class="ver-persona__op" role="tab" href="#/cuerpo/${esc(p.id)}" aria-selected="${p.id === persona.id}" style="text-decoration:none;color:inherit">
          <span class="ver-persona__cara">${cara(p)}</span><span>${esc(p.id === estado.yo.id ? 'Yo' : p.nombre)}</span></a>`).join('')}
      </div>` : ''}

    ${conDatos.length ? `
      <section class="tarjeta cuerpo-hero">
        <div class="cuerpo-hero__fila" id="cuerpo-metrica">${htmlMetrica(elegida)}</div>
        <div class="cuerpo-hero__tabs" role="tablist" aria-label="Qué ver">
          ${conDatos.map((m) => `<button type="button" role="tab" class="cuerpo-tab" data-metrica="${m.id}" aria-selected="${m.id === elegida}" style="--c:${m.color}">${m.nombre}</button>`).join('')}
        </div>
      </section>` : `
      <section class="tarjeta cuerpo-vacio">
        <p style="margin:0"><strong>${soyYo ? 'Carga tu primera medición' : `${esc(persona.nombre)} todavía no tiene mediciones`}</strong></p>
        ${soyYo ? '<p class="quieto" style="margin:6px 0 0">Toca «Nueva medición»: escribe tu peso o mándale a la IA una foto de la balanza o el PDF de tu bioimpedancia.</p>' : ''}
      </section>`}

    <section class="seccion" aria-labelledby="t-semana-cuerpo">
      <h2 class="seccion__titulo" id="t-semana-cuerpo">Esta semana</h2>
      <div class="tarjeta" id="semana-cuerpo">
        <div class="chatia__msg chatia__msg--ia chatia__msg--solo chatia__msg--pensando" style="background:none;padding:0">${'<span class="cubo" aria-hidden="true"><i></i></span>'}<span class="chatia__frase">Armando tu semana…</span></div>
      </div>
    </section>

    <details class="seccion historial-cuerpo">
      <summary class="seccion__titulo">Historial · ${mediciones.length} medicion${mediciones.length === 1 ? '' : 'es'}</summary>
      <div class="tarjeta">
        ${mediciones.length ? mediciones.map((m) => itemMedicion(m, soyYo)).join('') : `<p class="vacio">${soyYo ? 'Todavía no hay mediciones.' : `${esc(nombrePersona(persona.id))} todavía no tiene mediciones.`}</p>`}
      </div>
    </details>`;

  const recargar = () => vistaCuerpo(app);
  app.querySelectorAll('[data-metrica]').forEach((b) => b.addEventListener('click', () => {
    try { sessionStorage.setItem('bloque-cuerpo-metrica', b.dataset.metrica); } catch { /* nada */ }
    app.querySelectorAll('[data-metrica]').forEach((o) => o.setAttribute('aria-selected', String(o === b)));
    const cont = app.querySelector('#cuerpo-metrica');
    cont.classList.remove('fundido'); void cont.offsetWidth;
    cont.innerHTML = htmlMetrica(b.dataset.metrica);
    cont.classList.add('fundido');
  }));
  app.querySelectorAll('[data-borrar]').forEach((b) =>
    b.addEventListener('click', () => borrarMedicion(b.dataset.borrar, recargar)));
  if (soyYo) {
    fabIA('Nueva medición', async () => (await import('../cuerpoia.js')).abrirCuerpoIA({ alGuardar: recargar, manual: (v) => dialogoMedicion(recargar, v ?? {}) }), /^#\/cuerpo/);
  } else document.querySelector('.fab-ia')?.remove();

  // La semana (ritmo del peso, proyección, gasto real e indicadores).
  import('../semanal.js').then(async (S) => {
    const cont = app.querySelector('#semana-cuerpo');
    try {
      const sem = await S.calcularSemana(persona);
      if (cont.isConnected) cont.innerHTML = S.htmlSemana(sem, { compacto: true });
    } catch (e) { if (cont.isConnected) cont.innerHTML = `<p class="quieto" style="margin:0">No se pudo armar la semana. ${esc(e.message ?? '')}</p>`; }
  });
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

export function dialogoMedicion(alGuardar, valores = {}) {
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
  // Si viene de la IA (corregir a mano), se completa con lo que leyó.
  for (const c of CAMPOS) if (valores[c.id] != null) d.querySelector(`#${c.id}`).value = valores[c.id];
  if (valores.medido_en) d.querySelector('#medido_en').value = `${valores.medido_en}T08:00`;
  if (valores.origen) {
    origen.querySelectorAll('[data-valor]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.valor === valores.origen)));
    referencia.checked = valores.origen === 'hospital';
  }

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
      <p>Se borra de Bloq. Si ya se había sincronizado con Health Connect, bórrala también allá.</p>
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
