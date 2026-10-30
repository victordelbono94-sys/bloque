// Piezas comunes de los chats con la IA (registro de comida, entrenador, despensa): la misma cabecera,
// el mismo cuadro para escribir, las mismas burbujas y la animación de «pensando» con el cubo de Bloq.
import { esc } from './ui.js';

export const ICONOS = {
  x: '<svg class="icono" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  atras: '<svg class="icono" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  camara: '<svg class="icono" viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  galeria: '<svg class="icono" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-5 4 4 2.5-2.5L20 18"/></svg>',
  chispa: '<svg class="icono icono--lleno" viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>',
  flecha: '<svg class="icono" viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  chevron: '<svg class="icono" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
};

/** El cubo de Bloq: cambia de forma mientras la IA piensa. */
export const cubo = (clase = '') => `<span class="cubo ${clase}" aria-hidden="true"><i></i></span>`;

/** Cabecera: cerrar (o atrás) a la izquierda, título y subtítulo, y una acción a la derecha. */
export function htmlCabecera({ titulo, sub = '', subId = '', accion = '', izquierda = 'cerrar' }) {
  return `
    <header class="chatia__cab">
      <button type="button" class="chatia__boton-cab" ${izquierda === 'cerrar' ? 'data-cerrar aria-label="Cerrar"' : 'data-atras aria-label="Atrás"'}>${izquierda === 'cerrar' ? ICONOS.x : ICONOS.atras}</button>
      <div class="chatia__titulo"><h2>${esc(titulo)}</h2><span class="chatia__sub" ${subId ? `id="${subId}"` : ''}>${sub}</span></div>
      <div class="chatia__accion">${accion}</div>
    </header>`;
}

/** Cuadro para escribir: cámara y galería adentro (opcional), crece al escribir, y el botón pasa de ✦ a ↑. */
export function htmlCompositor({ id, placeholder, foto = true, valor = '', ids = {} }) {
  const i = { texto: `${id}-texto`, enviar: `${id}-enviar`, camara: `${id}-camara`, galeria: `${id}-galeria`, foto: `${id}-foto`, quitar: `${id}-foto-quitar`, estado: `${id}-estado`, ...ids };
  return `
    <section class="chatia__compositor" id="${id}">
      ${foto ? `<div class="chatia__adjunto" id="${i.foto}" hidden>
        <img alt="Foto">
        <button type="button" class="chatia__adjunto-quitar" id="${i.quitar}" aria-label="Quitar la foto">${ICONOS.x}</button>
      </div>` : ''}
      <p class="chatia__estado" id="${i.estado}" hidden></p>
      <div class="chatia__fila">
        ${foto ? `<label class="chatia__icono" aria-label="Sacar foto">${ICONOS.camara}<input type="file" id="${i.camara}" accept="image/*" capture="environment" hidden></label>
        <label class="chatia__icono" aria-label="Elegir de la galería">${ICONOS.galeria}<input type="file" id="${i.galeria}" accept="image/*" hidden></label>` : ''}
        <textarea id="${i.texto}" rows="1" maxlength="1200" placeholder="${esc(placeholder)}">${esc(valor)}</textarea>
        <button type="button" class="chatia__enviar" id="${i.enviar}" aria-label="Enviar">
          <span class="chatia__enviar-chispa">${ICONOS.chispa}</span><span class="chatia__enviar-flecha">${ICONOS.flecha}</span>
        </button>
      </div>
    </section>`;
}

/** Conecta el cuadro: crece con el texto, Enter envía, y el botón se transforma cuando hay algo para mandar. */
export function conectarCompositor(raiz, { texto, enviar, alEnviar, hayAdjunto = () => false }) {
  const t = raiz.querySelector(texto), b = raiz.querySelector(enviar);
  const actualizar = () => {
    t.style.height = 'auto';
    t.style.height = `${Math.min(132, t.scrollHeight)}px`;
    b.classList.toggle('chatia__enviar--listo', !!t.value.trim() || hayAdjunto());
  };
  t.addEventListener('input', actualizar);
  t.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); alEnviar(); } });
  b.addEventListener('click', () => alEnviar());
  actualizar();
  return { actualizar, limpiar: () => { t.value = ''; actualizar(); } };
}

const FRASES = ['Pensando…', 'Mirando los números…', 'Armando la respuesta…'];
/**
 * Burbuja de «pensando»: el cubo cambia de forma y la frase va rotando. Devuelve el elemento;
 * al reemplazar su contenido la animación se detiene sola.
 */
export function burbujaPensando(cont, frases = FRASES, clase = 'chatia__msg chatia__msg--ia') {
  cont.insertAdjacentHTML('beforeend', `<div class="${clase} chatia__msg--pensando">${cubo()}<span class="chatia__frase">${esc(frases[0])}</span></div>`);
  const el = cont.lastElementChild;
  let k = 0;
  const reloj = setInterval(() => {
    const f = el.querySelector('.chatia__frase');
    if (!f || !el.isConnected) return clearInterval(reloj);
    k = (k + 1) % frases.length;
    f.classList.remove('chatia__frase--entra'); void f.offsetWidth;
    f.textContent = frases[k];
    f.classList.add('chatia__frase--entra');
  }, 1800);
  el.terminar = (html) => { clearInterval(reloj); el.classList.remove('chatia__msg--pensando'); el.innerHTML = html; el.classList.add('chatia__msg--llega'); };
  if (!clase.includes('--solo')) bajar(el);
  return el;
}

/** Lleva el chat hasta el último mensaje (suave). */
export const bajar = (el) => requestAnimationFrame(() => el?.scrollIntoView({ behavior: 'smooth', block: 'end' }));

/** Bienvenida cuando todavía no hay nada: el cubo, un saludo y sugerencias para tocar. */
export function htmlBienvenida({ titulo, texto, sugerencias = [] }) {
  return `
    <div class="chatia__bienvenida">
      ${cubo('cubo--grande cubo--quieto')}
      <h3>${esc(titulo)}</h3>
      <p>${texto}</p>
      ${sugerencias.length ? `<div class="chatia__sugerencias">${sugerencias.map((s, k) => `<button type="button" class="chatia__sugerencia" data-sugerencia="${k}" style="--k:${k}">${s.icono ? `<span aria-hidden="true">${s.icono}</span>` : ''}${esc(s.texto)}</button>`).join('')}</div>` : ''}
    </div>`;
}
