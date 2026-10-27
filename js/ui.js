// Utilidades de interfaz: escapar texto, avisos, diálogos y gráficas.

export function esc(valor) {
  return String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Número con coma decimal, como se escribe en Ecuador.
export function num(valor, decimales = 1) {
  return Number(valor).toLocaleString('es-EC', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

let temporizadorAviso;
export function aviso(texto, tipo = 'ok') {
  const el = document.getElementById('aviso');
  el.textContent = texto;
  el.className = tipo === 'error' ? 'aviso aviso--error' : 'aviso';
  el.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { el.hidden = true; }, 3200);
}

export function avisoError(error) {
  console.error(error);
  aviso(mensajeError(error), 'error');
}

function mensajeError(error) {
  const texto = String(error?.message || error || '');
  if (/row-level security/i.test(texto)) return 'No tienes permiso para cambiar eso.';
  if (/Failed to fetch|NetworkError/i.test(texto)) return 'Sin conexión. Intenta de nuevo.';
  return 'Algo salió mal. Intenta de nuevo.';
}

// Abre un <dialog> con el HTML dado y devuelve el elemento. Se elimina al cerrarse.
export function abrirDialogo(html, etiqueta) {
  const d = document.createElement('dialog');
  d.setAttribute('aria-label', etiqueta);
  d.innerHTML = html;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.querySelectorAll('[data-cerrar]').forEach((b) => b.addEventListener('click', () => d.close()));
  d.showModal();
  return d;
}

// Botones tipo chip que se comportan como un grupo de opción única.
export function grupoChips(contenedor, alCambiar) {
  contenedor.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      contenedor.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', 'true');
      alCambiar?.(chip.dataset.valor);
    });
  });
}

export function valorChips(contenedor) {
  return contenedor.querySelector('.chip[aria-pressed="true"]')?.dataset.valor ?? null;
}

// Gráfica de línea simple en SVG. puntos: [{ fecha: Date, valor: number, referencia: bool }]
export function graficaLinea(puntos, { unidad = '', decimales = 1 } = {}) {
  if (puntos.length < 2) {
    return '<p class="vacio">Con dos mediciones o más aparece la tendencia.</p>';
  }
  const W = 320, H = 150, izq = 36, der = 12, arr = 14, aba = 24;
  const xs = puntos.map((p) => p.fecha.getTime());
  const ys = puntos.map((p) => p.valor);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const margen = Math.max((y1 - y0) * 0.15, 0.5);
  y0 -= margen; y1 += margen;
  const X = (t) => izq + ((t - x0) / (x1 - x0 || 1)) * (W - izq - der);
  const Y = (v) => arr + (1 - (v - y0) / (y1 - y0 || 1)) * (H - arr - aba);
  const d = puntos.map((p, i) => `${i ? 'L' : 'M'}${X(p.fecha.getTime()).toFixed(1)} ${Y(p.valor).toFixed(1)}`).join(' ');
  const ticks = [y0 + margen, (y0 + y1) / 2, y1 - margen];
  const fmt = (f) => f.toLocaleDateString('es-EC', { day: 'numeric', month: 'short' });
  const etiqueta = puntos.map((p) => `${fmt(p.fecha)}: ${num(p.valor, decimales)} ${unidad}`).join(', ');
  return `
    <svg class="grafica" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(etiqueta)}">
      ${ticks.map((t) => `<line class="eje" x1="${izq}" x2="${W - der}" y1="${Y(t)}" y2="${Y(t)}" stroke-dasharray="2 4"/>
        <text x="${izq - 6}" y="${Y(t) + 4}" text-anchor="end">${num(t, decimales)}</text>`).join('')}
      <path class="linea" d="${d}"/>
      ${puntos.map((p) => `<circle class="${p.referencia ? 'punto-ref' : 'punto-g'}" cx="${X(p.fecha.getTime())}" cy="${Y(p.valor)}" r="${p.referencia ? 5 : 3.5}"/>`).join('')}
      <text x="${izq}" y="${H - 6}">${fmt(puntos[0].fecha)}</text>
      <text x="${W - der}" y="${H - 6}" text-anchor="end">${fmt(puntos.at(-1).fecha)}</text>
    </svg>`;
}
