// Ficha de un ejercicio: fotos del movimiento, técnica, video y alternativas.
import { esc, abrirDialogo } from './ui.js';
import { abrirExterno } from './nativo.js';

const ICONO = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11"/></svg>`;

export function urlVideo(ej) {
  return ej.video_url || `https://www.youtube.com/results?search_query=${encodeURIComponent(`${ej.nombre} técnica correcta`)}`;
}

// Miniatura cuadrada: la foto del final del movimiento, o un ícono si no hay.
export function miniatura(ej, tam = 56) {
  const foto = ej.imagenes?.[1] ?? ej.imagenes?.[0];
  return foto
    ? `<img class="miniatura" src="${esc(foto)}" alt="" width="${tam}" height="${tam}" loading="lazy" decoding="async">`
    : `<span class="miniatura miniatura--vacia" style="width:${tam}px;height:${tam}px">${ICONO}</span>`;
}

// Las dos fotos (inicio y final) alternan como una animación corta.
function animacion(ej) {
  if (!ej.imagenes?.length) {
    return `<div class="ficha__sin-foto">${ICONO}<span>Sin foto todavía. Mira el video para ver el movimiento.</span></div>`;
  }
  const [a, b] = ej.imagenes;
  return `
    <div class="ficha__fotos ${b ? 'ficha__fotos--animada' : ''}" role="img" aria-label="Cómo se hace ${esc(ej.nombre)}: posición inicial y final">
      <img src="${esc(a)}" alt="" decoding="async">
      ${b ? `<img src="${esc(b)}" alt="" decoding="async">` : ''}
      ${b ? '<span class="ficha__fase" aria-hidden="true"><span>Inicio</span><span>Final</span></span>' : ''}
    </div>`;
}

/**
 * Abre la ficha. Con `alElegir`, cada alternativa trae «Usar esta» (en un entreno).
 * @param {object} ej ejercicio
 * @param {object} [op]
 * @param {Array} [op.alternativas]
 * @param {(id: string) => void} [op.alElegir]
 * @param {string} [op.actualId] el que se está haciendo ahora
 * @param {() => void} [op.alUsarEste] muestra «Usar este ejercicio» para elegir el de la ficha
 */
export function abrirFicha(ej, { alternativas = [], alElegir = null, actualId = null, alUsarEste = null } = {}) {
  const d = abrirDialogo(`
    <div class="dialogo ficha">
      <h2 class="tarjeta__titulo">${esc(ej.nombre)}</h2>
      <p class="quieto" style="margin:-10px 0 0">${esc(ej.grupo_muscular)}${ej.maquina ? ` · ${esc(ej.maquina.nombre)}` : ' · peso libre'}</p>
      ${animacion(ej)}
      ${ej.tecnica?.length ? `
        <div>
          <p class="seccion__titulo" style="margin:0 0 8px">Cómo se hace</p>
          <ol class="ficha__tecnica">${ej.tecnica.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
        </div>` : ''}
      ${ej.descripcion && !ej.tecnica?.includes(ej.descripcion) ? `<p class="ayuda" style="margin:0">${esc(ej.descripcion)}</p>` : ''}
      <button type="button" class="boton boton--sec" id="video">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style="fill:currentColor"><path d="M8 5v14l11-7z"/></svg>
        Ver video
      </button>
      ${alternativas.length ? `
        <div>
          <p class="seccion__titulo" style="margin:4px 0 8px">${alElegir ? '¿Ocupada? Cámbiala por' : 'Si la máquina está ocupada'}</p>
          <div class="pila" style="gap:8px">
            ${alternativas.map((a) => `
              <div class="alternativa ${a.id === actualId ? 'alternativa--actual' : ''}">
                <button type="button" class="alternativa__ver" data-ver="${esc(a.id)}" aria-label="Ver cómo se hace ${esc(a.nombre)}">
                  ${miniatura(a, 48)}
                  <span class="alternativa__texto">
                    <strong>${esc(a.nombre)}</strong>
                    <span class="quieto">${esc(a.maquina?.nombre ?? 'Peso libre')}</span>
                  </span>
                </button>
                ${alElegir ? (a.id === actualId
                  ? '<span class="etiqueta">Ahora</span>'
                  : `<button type="button" class="boton boton--chico" data-usar="${esc(a.id)}">Usar</button>`) : ''}
              </div>`).join('')}
          </div>
        </div>` : ''}
      <div class="dialogo__pie">
        ${alUsarEste ? '<button type="button" class="boton" id="usar-este">Usar este ejercicio</button>' : ''}
        <button type="button" class="boton boton--sec" data-cerrar>Cerrar</button>
      </div>
    </div>`, `Cómo se hace ${ej.nombre}`);

  d.querySelector('#video').addEventListener('click', () => abrirExterno(urlVideo(ej)));
  d.querySelector('#usar-este')?.addEventListener('click', () => { d.close(); alUsarEste(); });
  d.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => {
    const alt = alternativas.find((a) => a.id === b.dataset.ver);
    // La ficha de la alternativa ofrece volver al original como opción.
    const otras = [ej, ...alternativas.filter((a) => a.id !== alt.id)];
    d.close();
    setTimeout(() => abrirFicha(alt, {
      alternativas: otras, alElegir, actualId,
      alUsarEste: alElegir && alt.id !== actualId ? () => alElegir(alt.id) : null,
    }), 200);
  }));
  d.querySelectorAll('[data-usar]').forEach((b) => b.addEventListener('click', () => {
    d.close();
    alElegir(b.dataset.usar);
  }));
  return d;
}
