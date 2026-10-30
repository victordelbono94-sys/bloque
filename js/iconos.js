// Íconos de línea de Bloq y el mapa del cuerpo que muestra qué se trabaja.

const svg = (cuerpo, clase = 'icono') =>
  `<svg class="${clase}" viewBox="0 0 24 24" aria-hidden="true">${cuerpo}</svg>`;

// Un ícono por tipo de evento.
export const ICONO_TIPO = {
  gym: svg('<path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11"/>'),
  // Patín de derby: bota, chasis y cuatro ruedas.
  derby: svg('<path d="M6 3.5h5v7.5h5.5a3.5 3.5 0 0 1 3.5 3.5v1H4.5V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M8 6.5h3M8 9h3"/><circle cx="7" cy="19" r="1.8"/><circle cx="12" cy="19" r="1.8"/><circle cx="17" cy="19" r="1.8"/>'),
  clase: svg('<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.3A4.5 4.5 0 0 1 21 18.6"/>'),
  descanso: svg('<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.3 6.3 0 0 0 10 10z"/>'),
  otro: svg('<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>'),
};

export const iconoTipo = (tipo) => ICONO_TIPO[tipo] ?? ICONO_TIPO.gym;

// ---------- Mapa del cuerpo ----------
// Una figura de bloques redondeados (como el logo), de frente y de espalda.
// Cada bloque es una zona; se iluminan las que trabaja la rutina.
const FRENTE = [
  ['cabeza', 20, 1, 10, 11, 4],
  ['trapecios', 16, 13, 18, 4, 2],
  ['hombros', 8, 17, 8, 8, 3], ['hombros', 34, 17, 8, 8, 3],
  ['pecho', 17, 18, 7.6, 10, 3], ['pecho', 25.4, 18, 7.6, 10, 3],
  ['biceps', 7.5, 26, 7, 11, 3], ['biceps', 35.5, 26, 7, 11, 3],
  ['antebrazos', 6, 38, 6.5, 12, 3], ['antebrazos', 37.5, 38, 6.5, 12, 3],
  ['core', 18, 29.5, 14, 16, 3],
  ['cadera', 18, 46.5, 14, 5, 2],
  ['cuadriceps', 17, 52.5, 7.4, 21, 3], ['cuadriceps', 25.6, 52.5, 7.4, 21, 3],
  ['pantorrillas', 17.6, 75, 6.2, 18, 3], ['pantorrillas', 26.2, 75, 6.2, 18, 3],
];
const ESPALDA = [
  ['cabeza', 20, 1, 10, 11, 4],
  ['trapecios', 15, 13, 20, 8, 3],
  ['hombros', 8, 17, 8, 8, 3], ['hombros', 34, 17, 8, 8, 3],
  ['espalda', 17, 22, 16, 13, 3],
  ['triceps', 7.5, 26, 7, 11, 3], ['triceps', 35.5, 26, 7, 11, 3],
  ['antebrazos', 6, 38, 6.5, 12, 3], ['antebrazos', 37.5, 38, 6.5, 12, 3],
  ['lumbar', 19, 36, 12, 9.5, 3],
  ['gluteos', 17, 46.5, 16, 9, 3.5],
  ['isquios', 17, 56.5, 7.4, 17, 3], ['isquios', 25.6, 56.5, 7.4, 17, 3],
  ['pantorrillas', 17.6, 75, 6.2, 18, 3], ['pantorrillas', 26.2, 75, 6.2, 18, 3],
];

// Nombre corto de cada zona para las etiquetas.
export const NOMBRE_ZONA = {
  trapecios: 'Trapecios', hombros: 'Hombros', pecho: 'Pecho', biceps: 'Bíceps', triceps: 'Tríceps',
  antebrazos: 'Antebrazos', core: 'Core', espalda: 'Espalda', lumbar: 'Lumbar', gluteos: 'Glúteos',
  cuadriceps: 'Cuádriceps', isquios: 'Isquios', pantorrillas: 'Pantorrillas',
};

const REGLAS = [
  ['trapecio', ['trapecios']],
  ['hombro', ['hombros']],
  ['pecho', ['pecho']],
  ['bicep', ['biceps']],
  ['tricep', ['triceps']],
  ['antebrazo', ['antebrazos']],
  ['agarre', ['antebrazos']],
  ['core', ['core']],
  ['estabilidad', ['core']],
  ['lumbar', ['lumbar']],
  ['espalda alta', ['espalda', 'trapecios']],
  ['espalda', ['espalda']],
  ['glute', ['gluteos']],
  ['cuadricep', ['cuadriceps']],
  ['aductor', ['cuadriceps']],
  ['isquio', ['isquios']],
  ['pantorrilla', ['pantorrillas']],
  ['pierna', ['cuadriceps', 'isquios', 'gluteos']],
];

const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Zonas que trabaja una lista de grupos musculares, ordenadas por cuántos ejercicios las tocan. */
export function zonasDe(grupos) {
  const cuenta = new Map();
  for (const g of grupos) {
    const t = sinTildes(g ?? '');
    const zonas = new Set();
    for (const [clave, zs] of REGLAS) if (t.includes(clave)) zs.forEach((z) => zonas.add(z));
    zonas.forEach((z) => cuenta.set(z, (cuenta.get(z) ?? 0) + 1));
  }
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([z]) => z);
}

// La figura de Bloq: un pictograma de línea, como las señales deportivas (cabeza redonda, extremidades
// como tubos huecos con punta redondeada, separadas del tronco por un pequeño hueco).
// POSE es la figura de Cuerpo y del menú: estirando de costado. Se dibuja con máscaras: cada pieza es un
// trazo grueso blanco con uno más fino negro encima (queda el contorno), y las piezas de adelante abren
// antes un hueco en lo que tapan. viewBox 0 0 48 48 (la figura ocupa x 9.5–38.5).
const POSE_W = 4.6, POSE_T = 1.6, POSE_G = 1.3;
const POSE = {
  fondo: [
    ['poli', 'M22.4 14.6L26 17L21.2 29L14.6 24.8Z'],
    ['tubo', 'M12.2 45.5L14.6 24.8L22.4 14.6L22.8 2.8L31.6 2.6'],
  ],
  frente: [
    ['tubo', 'M22.2 31.6L27.8 45.5'],
    ['tubo', 'M31.8 19.6L36 25.8L28.6 30.4'],
    ['circ', [34.6, 11, 2.7]],
  ],
};
function capaPose([tipo, d], color, extra, w0 = POSE_W) {
  const w = Math.max(0.01, w0 + extra);
  if (tipo === 'circ') return `<circle cx="${d[0]}" cy="${d[1]}" r="${d[2] + w / 2}" fill="${color}"/>`;
  return `<path d="${d}" stroke="${color}" stroke-width="${w}" fill="${tipo === 'poli' ? color : 'none'}"/>`;
}
const lineaPose = (w = POSE_W, t = POSE_T, g = POSE_G) => POSE.fondo.map((p) => capaPose(p, '#fff', 0, w)).join('')
  + POSE.fondo.map((p) => capaPose(p, '#000', -2 * t, w)).join('')
  + POSE.frente.map((p) => capaPose(p, '#000', 2 * g, w) + capaPose(p, '#fff', 0, w) + capaPose(p, '#000', -2 * t, w)).join('');
const LINEA_POSE = lineaPose();
// En tamaño ícono (24 px) la línea va más gruesa para que pese igual que los demás íconos.
const LINEA_ICONO = lineaPose(5.4, 2.3, 1.4);
const SILUETA_POSE = POSE.fondo.map((p) => capaPose(p, '#fff', 0)).join('')
  + POSE.frente.map((p) => capaPose(p, '#000', 2 * POSE_G) + capaPose(p, '#fff', 0)).join('');
const mascara = (id, contenido) => `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48"><g stroke-linecap="round" stroke-linejoin="round">${contenido}</g></mask>`;
/** Máscaras de la pose: `${id}l` es la línea (el dibujo), `${id}s` la silueta entera (para llenarla con un dato). */
export const mascarasPose = (id) => mascara(`${id}l`, LINEA_POSE) + mascara(`${id}s`, SILUETA_POSE);
/** El ícono de la figura, en el color del texto. */
export const iconoCuerpo = (id = 'fig-ic', clase = 'icono') => `<svg class="${clase}" viewBox="7 -1 34 50" aria-hidden="true"><defs>${mascara(id, LINEA_ICONO)}</defs><rect width="48" height="48" fill="currentColor" stroke="none" mask="url(#${id})"/></svg>`;

// Figura de pie (frente y espalda) para el mapa de músculos de los ejercicios, con el mismo lenguaje:
// cabeza redonda, tronco que se angosta, brazos y piernas de trazo grueso. viewBox 0 0 50 94.
export const FIGURA = '<circle cx="25" cy="6" r="5.5"/>'
  + '<path d="M19.5 15.5h11c2.6 0 4.4 1.6 4.2 4.1L32.4 47.2a2.5 2.5 0 0 1-2.5 2.3h-9.8a2.5 2.5 0 0 1-2.5-2.3L15.3 19.6c-.2-2.5 1.6-4.1 4.2-4.1z"/>'
  + '<g stroke-linecap="round" fill="none"><path d="M12.4 19.5L10.8 44" stroke-width="5"/><path d="M37.6 19.5L39.2 44" stroke-width="5"/>'
  + '<path d="M21 55.5V89.5" stroke-width="6"/><path d="M29 55.5V89.5" stroke-width="6"/></g>';
/** Máscara con la forma de la figura (para llenarla con un dato o encender zonas). */
export const mascaraFigura = (id) => `<mask id="${id}" maskUnits="userSpaceOnUse" x="-5" y="-5" width="60" height="104"><g fill="#fff" stroke="#fff">${FIGURA}</g></mask>`;
let idMascara = 0;
function figura(bloques, zonas, dx) {
  const id = `fig${++idMascara}`;
  return `<g transform="translate(${dx} 0)">
    <defs>${mascaraFigura(id)}</defs>
    <g class="mapa__base">${FIGURA}</g>
    <g mask="url(#${id})">${bloques.filter(([zona]) => zona !== 'cabeza' && zona !== 'cadera').map(([zona, x, y, w, h, r]) =>
      `<rect class="${zonas.has(zona) ? 'mapa__on' : 'mapa__off'}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`).join('')}</g>
  </g>`;
}

/** Mapa del cuerpo de frente y de espalda con las zonas encendidas. */
export function mapaCuerpo(zonas, { alto = 72, etiqueta = '' } = {}) {
  const set = new Set(zonas);
  const ancho = Math.round(alto * 100 / 94);
  const nombres = zonas.map((z) => NOMBRE_ZONA[z]).filter(Boolean).join(', ');
  return `<svg class="mapa" viewBox="0 0 100 94" width="${ancho}" height="${alto}" role="img" aria-label="${etiqueta || `Trabaja: ${nombres}`}">
    ${figura(FRENTE, set, 0)}${figura(ESPALDA, set, 50)}
  </svg>`;
}

/** Etiquetas de las zonas principales (máximo `cuantas`). */
export function chipsZonas(zonas, cuantas = 3) {
  return `<span class="zonas">${zonas.slice(0, cuantas).map((z) => `<span class="zona">${NOMBRE_ZONA[z]}</span>`).join('')}</span>`;
}

// Íconos de línea para la interfaz (en vez de emojis). Heredan el color del texto.
const ic = (d) => `<svg class="icono icono-ui" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
export const IC = {
  objetivo: ic('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
  ritmo: ic('<path d="M3 17l5-5 4 3 8-8"/><path d="M15 7h5v5"/>'),
  fuego: ic('<path d="M12 21c-4 0-6.5-2.6-6.5-6 0-3.5 2.5-5.5 3.5-8 1.5 1.5 2 3 2 4.5 1-1 1.8-2.6 1.8-4.5 3 2 5.7 5 5.7 8.3 0 3.3-2.5 5.7-6.5 5.7z"/>'),
  comida: ic('<path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M17 3c-2 1.5-3 4-3 7h3v11"/>'),
  proteina: ic('<path d="M8 8h8l-1 12a1.6 1.6 0 0 1-1.6 1.5h-2.8A1.6 1.6 0 0 1 9 20z"/><path d="M8.6 8V5.2c0-.7.5-1.2 1.2-1.2h4.4c.7 0 1.2.5 1.2 1.2V8M9.5 13h5"/>'),
  taza: ic('<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5c0 1 1 1.5 1 2.5M12 3.5c0 1 1 1.5 1 2.5"/>'),
  luna: ic('<path d="M19 14.5A7.5 7.5 0 1 1 9.5 5a6 6 0 0 0 9.5 9.5z"/>'),
  rayo: ic('<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>'),
  manzana: ic('<path d="M12 7.5c-2-1.5-6-1-6 4 0 4 2.5 8.5 4.5 8.5 1 0 1-.5 1.5-.5s.5.5 1.5.5c2 0 4.5-4.5 4.5-8.5 0-5-4-5.5-6-4z"/><path d="M12 7.5c0-2 1-3.5 2.5-4"/>'),
  medalla: ic('<circle cx="12" cy="15" r="5"/><path d="M9 10.5L6.5 3.5h4L12 7l1.5-3.5h4L15 10.5"/>'),
  trofeo: ic('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20.5h7M9.5 17h5v3.5h-5z"/>'),
  buscar: ic('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
  pausa: ic('<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>'),
  cambio: ic('<path d="M4 9h13l-3.5-3.5M20 15H7l3.5 3.5"/>'),
  curita: ic('<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="M10.5 10.5h.01M13.5 13.5h.01M13.5 10.5h.01M10.5 13.5h.01"/>'),
  pregunta: ic('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01"/>'),
  pesa: ic('<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>'),
  sueno: ic('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  agua: ic('<path d="M12 3.5c3 4 6 7.2 6 10.5a6 6 0 0 1-12 0c0-3.3 3-6.5 6-10.5z"/>'),
  pasos: ic('<path d="M8 3.5c1.7 0 2.5 1.8 2.5 4S9.5 12 8 12 5.5 9.7 5.5 7.5 6.3 3.5 8 3.5zM16 9c1.7 0 2.5 1.8 2.5 4s-1 4.5-2.5 4.5-2.5-2.3-2.5-4.5S14.3 9 16 9zM6 15h4M14 20.5h4"/>'),
  nota: ic('<path d="M5 4h10l4 4v12H5z"/><path d="M8 11h8M8 15h6"/>'),
  camara: ic('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  documento: ic('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>'),
  grafico: ic('<path d="M4 20V4M4 20h16"/><path d="M8 16l3-4 3 2 5-7"/>'),
  mano: ic('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-.5a5 5 0 0 1-4.2-2.3L4 14.5a1.5 1.5 0 0 1 2.5-1.6L8 15"/>'),
  check: ic('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  alerta: ic('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.5"/>'),
  balanza: ic('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 9.5a4 4 0 0 1 6 0M12 9.5l1.5-1.5"/>'),
  calendario: ic('<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
  racha: ic('<path d="M12 21c-4 0-6.5-2.6-6.5-6 0-3.5 2.5-5.5 3.5-8 1.5 1.5 2 3 2 4.5 1-1 1.8-2.6 1.8-4.5 3 2 5.7 5 5.7 8.3 0 3.3-2.5 5.7-6.5 5.7z"/>'),
};
