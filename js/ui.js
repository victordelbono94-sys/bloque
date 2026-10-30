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
  el.hidden = false;
  el.classList.toggle('aviso--error', tipo === 'error');
  el.classList.remove('aviso--visible');
  void el.offsetWidth; // reinicia la animación si ya estaba visible
  el.classList.add('aviso--visible');
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => el.classList.remove('aviso--visible'), 3200);
}

export function avisoError(error) {
  console.error(error);
  aviso(mensajeError(error), 'error');
}

function mensajeError(error) {
  const texto = String(error?.message || error || '');
  if (error?.code === 'P0001') return texto; // mensajes propios de la base (ej. «Código no válido»)
  if (/row-level security/i.test(texto)) return 'No tienes permiso para cambiar eso.';
  if (/Failed to fetch|NetworkError/i.test(texto)) return 'Sin conexión. Intenta de nuevo.';
  return 'Algo salió mal. Intenta de nuevo.';
}

const sinMovimiento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Abre un <dialog> con el HTML dado y devuelve el elemento. Se elimina al cerrarse.
// En el teléfono es una hoja que sube desde abajo: se cierra tocando afuera, deslizándola
// hacia abajo desde arriba (o desde cualquier parte si ya está al tope) y con el gesto de atrás.
export function abrirDialogo(html, etiqueta, { pantalla = false } = {}) {
  const d = document.createElement('dialog');
  // pantalla: ocupa toda la pantalla (para lo que es mucho para una hoja), y entra desde abajo igual.
  if (pantalla) d.classList.add('pantalla');
  d.setAttribute('aria-label', etiqueta);
  d.innerHTML = html;
  document.body.appendChild(d);

  const cerrarDeVerdad = d.close.bind(d);
  let cerrando = false;
  d.close = () => {
    if (cerrando || !d.open) return;
    cerrando = true;
    if (sinMovimiento()) return cerrarDeVerdad();
    d.classList.add('saliendo');
    setTimeout(cerrarDeVerdad, 200);
  };
  // Cerrar por el usuario (atrás, tocar afuera, deslizar, X, Esc). Si la hoja tiene algo sin guardar
  // (d.proteger() devuelve true), primero pregunta; cerrar desde el código (al guardar) usa d.close().
  d.descartar = () => {
    if (cerrando || !d.open) return;
    if (typeof d.proteger === 'function' && d.proteger()) return preguntarDescartar(d);
    d.close();
  };
  d.addEventListener('cancel', (e) => { e.preventDefault(); d.descartar(); }); // tecla Esc
  // Tocar afuera (el fondo): por coordenadas, porque en Android el toque al fondo no siempre llega como click.
  d.addEventListener('pointerdown', (e) => {
    const r = d.getBoundingClientRect();
    if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) d.descartar();
  });
  // Pantalla completa con contenido común: una X arriba para cerrar.
  if (pantalla && !d.querySelector('.reg')) {
    d.insertAdjacentHTML('afterbegin', '<button type="button" class="pantalla__cerrar" data-cerrar aria-label="Cerrar"><svg class="icono" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>');
  }
  d.addEventListener('close', () => d.remove());
  d.querySelectorAll('[data-cerrar]').forEach((b) => b.addEventListener('click', () => d.descartar()));
  // El foco va al título, no al primer campo, para no abrir el teclado de golpe.
  const titulo = d.querySelector('h2');
  if (titulo) { titulo.tabIndex = -1; titulo.autofocus = true; titulo.style.outline = 'none'; }
  d.showModal();

  arrastrarParaCerrar(d);
  return d;
}

// Deslizar la hoja hacia abajo para cerrarla (solo en pantallas de teléfono).
function arrastrarParaCerrar(d) {
  if (!matchMedia('(max-width: 600px)').matches) return;
  let inicioY = 0, inicioT = 0, dy = 0, arrastrando = false, posible = false;
  d.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    const r = d.getBoundingClientRect();
    // Desde la zona de arriba (la manija y el título) siempre; desde el resto, solo si ya está al tope.
    const desdeArriba = t.clientY - r.top < 64;
    const enCampo = e.target.closest('input, textarea, select, .chips--scroll, .paso-mini');
    posible = !enCampo && (desdeArriba || d.scrollTop <= 0);
    inicioY = t.clientY; inicioT = Date.now(); dy = 0; arrastrando = false;
  }, { passive: true });
  d.addEventListener('touchmove', (e) => {
    if (!posible) return;
    dy = e.touches[0].clientY - inicioY;
    if (!arrastrando && dy > 8 && d.scrollTop <= 0) arrastrando = true;
    if (!arrastrando) return;
    e.preventDefault();
    d.style.transition = 'none';
    d.style.transform = `translateY(${Math.max(0, dy)}px)`;
  }, { passive: false });
  d.addEventListener('touchend', () => {
    if (!arrastrando) return;
    const rapido = dy / Math.max(1, Date.now() - inicioT) > 0.6;
    d.style.transition = 'transform 0.2s ease';
    if ((dy > Math.min(140, d.offsetHeight * 0.25) || (rapido && dy > 40)) && typeof d.proteger === 'function' && d.proteger()) {
      d.style.transform = '';
      preguntarDescartar(d);
    } else if (dy > Math.min(140, d.offsetHeight * 0.25) || (rapido && dy > 40)) {
      d.style.transform = `translateY(${d.offsetHeight}px)`;
      d.classList.add('sin-animacion');
      setTimeout(() => d.close(), 180);
    } else {
      d.style.transform = '';
    }
    arrastrando = false;
  });
}

// Botones tipo chip que se comportan como un grupo de opción única.
export function grupoChips(contenedor, alCambiar) {
  contenedor.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      contenedor.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', 'true');
      chip.classList.remove('pop');
      void chip.offsetWidth;
      chip.classList.add('pop');
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
      <path class="linea" d="${d}" pathLength="1"/>
      ${puntos.map((p, i) => `<circle class="${p.referencia ? 'punto-ref' : 'punto-g'}" style="animation-delay:${(0.15 + 0.6 * i / (puntos.length - 1)).toFixed(2)}s" cx="${X(p.fecha.getTime())}" cy="${Y(p.valor)}" r="${p.referencia ? 5 : 3.5}"/>`).join('')}
      <text x="${izq}" y="${H - 6}">${fmt(puntos[0].fecha)}</text>
      <text x="${W - der}" y="${H - 6}" text-anchor="end">${fmt(puntos.at(-1).fecha)}</text>
    </svg>`;
}

// Contenido de un avatar: la foto de la persona (Google o subida) o su inicial si no hay o no carga.
export function cara(p) {
  const inicial = esc((p?.nombre ?? '?').trim().charAt(0).toUpperCase() || '?');
  if (!p?.avatar_url) return inicial;
  return `<img src="${esc(p.avatar_url)}" alt="" referrerpolicy="no-referrer" loading="lazy" decoding="async" onerror="this.parentNode.textContent='${inicial}'">`;
}

// Gesto o botón de atrás de Android: la app nativa pregunta primero acá. Si hay una hoja abierta,
// se cierra la de más arriba y no se navega.
// Con el teclado abierto, atrás solo baja el teclado (no cierra la hoja ni se pierde lo escrito).
let altoMax = window.innerHeight;
window.addEventListener('resize', () => { if (!tecladoAbierto()) altoMax = Math.max(altoMax, window.innerHeight); });
window.addEventListener('orientationchange', () => { altoMax = 0; setTimeout(() => { altoMax = window.innerHeight; }, 400); });
function tecladoAbierto() {
  const alto = window.visualViewport?.height ?? window.innerHeight;
  return alto < altoMax * 0.78;
}
window.bloqueAtras = () => {
  const foco = document.activeElement;
  const escribiendo = foco && foco.matches?.('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, [contenteditable="true"]');
  if (escribiendo && tecladoAbierto()) { foco.blur(); return true; }
  const abiertas = [...document.querySelectorAll('dialog[open]')];
  if (!abiertas.length) { if (escribiendo) foco.blur(); return false; }
  const arriba = abiertas.at(-1);
  if (arriba.descartar) arriba.descartar(); else arriba.close();
  return true;
};

/** «¿Descartar lo que anotaste?» antes de cerrar una hoja con cambios sin guardar. */
function preguntarDescartar(d) {
  if (document.querySelector('dialog.descartar[open]')) return;
  const q = abrirDialogo(`
    <div class="dialogo">
      <h2 class="tarjeta__titulo">${esc(d.textoDescartar ?? '¿Descartar lo que anotaste?')}</h2>
      <p class="quieto" style="margin:-6px 0 0">Si sales ahora se pierde lo que escribiste y la foto.</p>
      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" id="dsc-seguir">Seguir editando</button>
        <button type="button" class="boton boton--peligro" id="dsc-salir">Descartar</button>
      </div>
    </div>`, 'Descartar cambios');
  q.classList.add('descartar');
  q.querySelector('#dsc-seguir').addEventListener('click', () => q.close());
  q.querySelector('#dsc-salir').addEventListener('click', () => { q.close(); d.close(); });
}
