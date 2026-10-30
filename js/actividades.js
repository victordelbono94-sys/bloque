// Entrenos que registra el reloj (vía Health Connect): nombre, ícono, carga y
// emparejamiento con lo agendado. Sin dependencias del navegador para poder probarlo.
import { ICONO_TIPO } from './iconos.js';

const svg = (c) => `<svg class="icono" viewBox="0 0 24 24" aria-hidden="true">${c}</svg>`;
const PULSO = svg('<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>');
const MONTANA = svg('<path d="M3 20l6.5-11 4 6 2.5-3.5L21 20z"/>');
const PASOS = svg('<path d="M8 3.5c1.5 0 2.5 1.8 2.5 4S9.5 11 8 11 5.5 9.7 5.5 7.5 6.5 3.5 8 3.5zM6 13.5h4v1.5a2 2 0 0 1-4 0zM16 7.5c1.5 0 2.5 1.8 2.5 4S17.5 15 16 15s-2.5-1.3-2.5-3.5 1-4 2.5-4zM14 17.5h4v1a2 2 0 0 1-4 0z"/>');
const BICI = svg('<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7M10 9l3 7M13.5 5.5H16"/>');
const YOGA = svg('<circle cx="12" cy="5.5" r="2"/><path d="M4 14c3 0 5-2.5 8-2.5s5 2.5 8 2.5M8 20l4-4 4 4"/>');

// Nombre, ícono y cuánto cansa una hora si el reloj no midió calorías.
const ACTIVIDADES = {
  caminar: { nombre: 'Caminata', plural: 'Caminatas', icono: PASOS, porHora: 0.3 },
  correr: { nombre: 'Carrera', icono: PULSO, porHora: 1.3 },
  escalada: { nombre: 'Escalada', icono: MONTANA, porHora: 1.2 },
  trekking: { nombre: 'Trekking', icono: MONTANA, porHora: 0.9 },
  bicicleta: { nombre: 'Bicicleta', icono: BICI, porHora: 1 },
  yoga: { nombre: 'Yoga', icono: YOGA, porHora: 0.4 },
  hiit: { nombre: 'HIIT', icono: PULSO, porHora: 1.4 },
  fuerza: { nombre: 'Fuerza', icono: ICONO_TIPO.gym, porHora: 1 },
  pesas: { nombre: 'Pesas', icono: ICONO_TIPO.gym, porHora: 1 },
  patinaje: { nombre: 'Patinaje', icono: ICONO_TIPO.derby, porHora: 1.4 },
  natacion: { nombre: 'Natación', icono: PULSO, porHora: 1.2 },
  baile: { nombre: 'Baile', icono: PULSO, porHora: 0.9 },
  futbol: { nombre: 'Fútbol', icono: PULSO, porHora: 1.3 },
  clase: { nombre: 'Clase', icono: ICONO_TIPO.clase, porHora: 1 },
  otro: { nombre: 'Otro', icono: PULSO, porHora: 1 },
};

// Lo que se puede elegir al agendar «Otro», con los tipos del reloj que le corresponden.
export const OTROS = [
  ['caminar', ['caminar', 'trekking']],
  ['correr', ['correr', 'tipo_57']],
  ['bicicleta', ['bicicleta', 'tipo_9']],
  ['escalada', ['escalada']],
  ['trekking', ['trekking', 'caminar']],
  ['natacion', ['tipo_73', 'tipo_74']],
  ['patinaje', ['patinaje', 'tipo_52', 'tipo_60', 'tipo_0']],
  ['yoga', ['yoga', 'tipo_48', 'tipo_71']],
  ['hiit', ['hiit', 'tipo_36', 'tipo_0']],
  ['baile', ['tipo_16']],
  ['futbol', ['tipo_64']],
  ['clase', null],
  ['otro', null],
].map(([clave, reloj]) => ({ clave, reloj, ...ACTIVIDADES[clave] }));

/** Carga estimada de un evento «Otro» de una hora (si el reloj no lo registró). */
export const cargaOtro = (ev) => ACTIVIDADES[ev.actividad]?.porHora ?? 1;
// Lo que el reloj manda con un número (tipos de Health Connect que la app aún no nombra).
const POR_CODIGO = {
  0: { nombre: 'Otro entreno', icono: PULSO, porHora: 1 },
  5: { nombre: 'Básquet', icono: PULSO, porHora: 1.2 },
  9: { nombre: 'Bici fija', icono: BICI, porHora: 1 },
  11: { nombre: 'Boxeo', icono: PULSO, porHora: 1.4 },
  13: { nombre: 'Calistenia', icono: ICONO_TIPO.gym, porHora: 1 },
  16: { nombre: 'Baile', icono: PULSO, porHora: 0.9 },
  25: { nombre: 'Elíptica', icono: PULSO, porHora: 1 },
  26: { nombre: 'Clase', icono: ICONO_TIPO.clase, porHora: 1 },
  44: { nombre: 'Artes marciales', icono: PULSO, porHora: 1.3 },
  48: { nombre: 'Pilates', icono: YOGA, porHora: 0.6 },
  52: { nombre: 'Patinaje', icono: ICONO_TIPO.derby, porHora: 1.4 },
  54: { nombre: 'Remo', icono: PULSO, porHora: 1.2 },
  57: { nombre: 'Cinta', icono: PULSO, porHora: 1.2 },
  60: { nombre: 'Patinaje', icono: ICONO_TIPO.derby, porHora: 1.4 },
  64: { nombre: 'Fútbol', icono: PULSO, porHora: 1.3 },
  68: { nombre: 'Escaleras', icono: PULSO, porHora: 1 },
  69: { nombre: 'Escaladora', icono: PULSO, porHora: 1 },
  71: { nombre: 'Estiramiento', icono: YOGA, porHora: 0.2 },
  74: { nombre: 'Natación', icono: PULSO, porHora: 1.2 },
  73: { nombre: 'Natación', icono: PULSO, porHora: 1.2 },
  76: { nombre: 'Tenis', icono: PULSO, porHora: 1.1 },
  78: { nombre: 'Vóley', icono: PULSO, porHora: 1 },
};

export function actividad(tipo) {
  const t = String(tipo ?? '');
  const cod = t.startsWith('tipo_') ? Number(t.slice(5)) : null;
  return ACTIVIDADES[t] ?? POR_CODIGO[cod] ?? { nombre: 'Entreno', icono: PULSO, porHora: 1 };
}

export const minutos = (s) => (s.inicio && s.fin ? Math.max(0, Math.round((new Date(s.fin) - new Date(s.inicio)) / 60000)) : 0);

/** Carga de un entreno del reloj: por calorías (350 kcal ≈ 1 punto); si no hay, por duración y tipo. */
export function cargaSesion(s) {
  if (s.calorias) return s.calorias / 350;
  return (minutos(s) / 60) * actividad(s.tipo).porHora;
}

// Qué tipos del reloj pueden ser cada evento agendado.
const COMPATIBLES = {
  gym: ['fuerza', 'pesas', 'hiit', 'tipo_0', 'tipo_13', 'tipo_36', 'tipo_70', 'tipo_81'],
  derby: ['patinaje', 'tipo_0', 'tipo_52', 'tipo_60', 'hiit', 'tipo_36'],
  clase: null, // cualquiera menos caminar
};
// «Otro entreno» genérico del reloj (tipo_0 o un número que la app no conoce): puede ser cualquier cosa,
// hasta eSports o yoga suave. Solo cuenta como entreno agendado si hubo esfuerzo de verdad.
const generico = (tipo) => tipo === 'tipo_0' || (/^tipo_\d+$/.test(tipo) && !CONOCIDOS.has(tipo));
const CONOCIDOS = new Set(['tipo_13', 'tipo_36', 'tipo_52', 'tipo_60', 'tipo_70', 'tipo_81']);
/** ¿Hubo esfuerzo? Pulso promedio ≥ 95, o al menos 2,5 kcal por minuto según el reloj. */
export function conEsfuerzo(s) {
  const min = Math.max(1, minutos(s));
  if (Number(s.fc_promedio) >= 95) return true;
  if (s.calorias && !s.calorias_estimadas && s.calorias / min >= 2.5) return true;
  return false;
}
const compatible = (ev, s) => {
  if (ev.tipo === 'descanso' || !s.tipo) return false;
  if (generico(s.tipo) && !conEsfuerzo(s)) return false;
  // «Otro»: lo que corresponde a su actividad; si es una clase u otra cosa, cualquiera menos caminar.
  const lista = ev.tipo === 'otro'
    ? (OTROS.find((o) => o.clave === ev.actividad)?.reloj ?? null)
    : COMPATIBLES[ev.tipo];
  return lista === null ? s.tipo !== 'caminar' : (lista ?? []).includes(s.tipo);
};

/**
 * Empareja eventos agendados con entrenos del reloj del mismo día.
 * Si el evento tiene hora, gana el entreno que empezó más cerca (hasta 3 h de diferencia).
 * @returns {{ pares: Map<object, object>, sueltas: Array }} pares evento → sesión, y sesiones sin evento
 */
export function emparejar(eventos, sesiones) {
  const libres = [...sesiones];
  const pares = new Map();
  // Primero los más exigentes: si el reloj registró un solo entreno largo, es el derby.
  const PESO = { derby: 3, otro: 2, clase: 2, gym: 1 };
  for (const ev of [...eventos].sort((a, b) => (PESO[b.tipo] ?? 0) - (PESO[a.tipo] ?? 0))) {
    const candidatas = libres.filter((s) => compatible(ev, s));
    if (!candidatas.length) continue;
    let elegida = candidatas[0];
    if (ev.hora_inicio && ev.fecha) {
      const objetivo = new Date(`${ev.fecha}T${ev.hora_inicio.slice(0, 5)}:00`).getTime();
      const dist = (s) => Math.abs(new Date(s.inicio).getTime() - objetivo);
      elegida = candidatas.sort((a, b) => dist(a) - dist(b))[0];
      if (dist(elegida) > 3 * 3600e3) continue;
    } else {
      // Sin hora: la más larga (un derby o un gym, no un trote corto).
      elegida = candidatas.sort((a, b) => cargaSesion(b) - cargaSesion(a))[0];
    }
    pares.set(ev, elegida);
    libres.splice(libres.indexOf(elegida), 1);
  }
  return { pares, sueltas: libres };
}

/** «caminata, escalada» → nombres en minúscula para los motivos, sin repetir. */
export function nombresSesiones(sesiones) {
  return [...new Set(sesiones.map((s) => actividad(s.tipo).nombre.toLowerCase()))];
}

// ---------- Entrenos individuales (derby, otros): cada uno va o no por su cuenta ----------
// El gym se hace juntos y se registra en la app; el derby y los «otro» los registra el reloj de cada uno.
export const esIndividual = (ev) => ['derby', 'otro', 'clase'].includes(ev?.tipo);
const DURACION_MIN = { derby: 120, otro: 60, clase: 60 };

/** Cuándo termina (aprox.) un evento: su hora + duración típica; sin hora, al final del día. */
export function finEvento(ev) {
  if (!ev.hora_inicio) return new Date(`${ev.fecha}T23:59:59`);
  return new Date(new Date(`${ev.fecha}T${ev.hora_inicio.slice(0, 5)}:00`).getTime() + (DURACION_MIN[ev.tipo] ?? 60) * 60000);
}

/**
 * ¿Fue esta persona a un entreno individual?
 * 'fue' si su reloj tiene un entreno que coincide; 'no_fue' si el día ya pasó, o si su reloj sincronizó
 * más de una hora después del final y no hay nada; si no, 'pendiente'.
 */
export function asistenciaIndividual(ev, sesion, ultimoSync, ahora = new Date()) {
  if (sesion) return 'fue';
  const fin = finEvento(ev);
  if (ahora < fin) return 'pendiente';
  const diaPasado = new Date(`${ev.fecha}T23:59:59`) < ahora;
  if (diaPasado) return 'no_fue';
  if (ultimoSync && new Date(ultimoSync).getTime() > fin.getTime() + 3600e3) return 'no_fue';
  return 'pendiente';
}
