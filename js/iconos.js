// Íconos de línea de Bloque y el mapa del cuerpo que muestra qué se trabaja.

const svg = (cuerpo, clase = 'icono') =>
  `<svg class="${clase}" viewBox="0 0 24 24" aria-hidden="true">${cuerpo}</svg>`;

// Un ícono por tipo de evento.
export const ICONO_TIPO = {
  gym: svg('<path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11"/>'),
  // Patín de derby: bota, chasis y cuatro ruedas.
  derby: svg('<path d="M6 3.5h5v7.5h5.5a3.5 3.5 0 0 1 3.5 3.5v1H4.5V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M8 6.5h3M8 9h3"/><circle cx="7" cy="19" r="1.8"/><circle cx="12" cy="19" r="1.8"/><circle cx="17" cy="19" r="1.8"/>'),
  clase: svg('<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.3A4.5 4.5 0 0 1 21 18.6"/>'),
  descanso: svg('<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.3 6.3 0 0 0 10 10z"/>'),
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

function figura(bloques, zonas, dx) {
  return bloques.map(([zona, x, y, w, h, r]) => {
    const clase = zona === 'cabeza' || zona === 'cadera' ? 'mapa__neutro' : zonas.has(zona) ? 'mapa__on' : 'mapa__off';
    return `<rect class="${clase}" x="${x + dx}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;
  }).join('');
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
