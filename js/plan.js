// Plan inicial: con los días de gym, el objetivo, la experiencia y el deporte, arma las rutinas
// (con los ejercicios del catálogo del equipo) y agenda las próximas 4 semanas.
import { sb, estado, datos } from './db.js';
import { hoyISO, sumarDias } from './fechas.js';
import { deporte as datosDeporte } from './deportes.js';
import { CARGA_CUADRICEPS } from './entrenador.js';

// Ejercicios por bloque, del más básico al más específico (nombres del catálogo).
const B = {
  pecho: ['Press de pecho en máquina', 'Press inclinado con mancuernas', 'Aperturas en pec deck', 'Press de banca con mancuernas', 'Cruce de poleas'],
  espalda: ['Jalón al pecho', 'Remo sentado en máquina', 'Remo con mancuerna', 'Pullover en polea', 'Dominadas asistidas'],
  hombros: ['Press de hombros en máquina', 'Elevaciones laterales con mancuernas', 'Face pull en polea', 'Pájaros con mancuernas', 'Press militar con mancuernas'],
  biceps: ['Curl con mancuernas', 'Curl martillo', 'Curl de bíceps en máquina'],
  triceps: ['Extensión de tríceps en polea', 'Fondos asistidos', 'Extensión de tríceps en máquina'],
  cuadriceps: ['Prensa de piernas', 'Sentadilla en Multipower', 'Extensión de cuádriceps', 'Sentadilla búlgara con mancuernas'],
  femoral: ['Curl femoral en máquina', 'Peso muerto rumano con mancuernas'],
  gluteos: ['Hip thrust con barra', 'Empuje de cadera en máquina', 'Abductores en máquina'],
  pantorrillas: ['Pantorrillas en prensa'],
  core: ['Plancha', 'Pallof press en polea', 'Abdominal en máquina', 'Plancha lateral', 'Bird dog', 'Rotación de tronco en máquina', 'Crunch en colchoneta'],
  trapecios: ['Encogimientos con mancuernas', 'Encogimientos en Multipower'],
  antebrazos: ['Curl de muñeca con mancuerna', 'Curl invertido en polea', 'Agarre isométrico con discos', 'Caminata de granjero'],
  lumbar: ['Lumbar en máquina', 'Superman en colchoneta'],
  equilibrio: ['Equilibrio a una pierna'],
};

// Rutinas: nombre y qué bloques lleva ([bloque, cuántos, desde cuál]).
const R = {
  fullA: { nombre: 'Cuerpo completo A', b: [['cuadriceps', 1], ['pecho', 1], ['espalda', 1], ['hombros', 1], ['femoral', 1], ['core', 1]] },
  fullB: { nombre: 'Cuerpo completo B', b: [['gluteos', 1], ['espalda', 1, 1], ['pecho', 1, 1], ['cuadriceps', 1, 1], ['hombros', 1, 1], ['core', 1, 1]] },
  fullC: { nombre: 'Cuerpo completo C', b: [['cuadriceps', 1, 2], ['espalda', 1, 2], ['pecho', 1, 3], ['femoral', 1, 1], ['biceps', 1], ['triceps', 1]] },
  empuje: { nombre: 'Pecho, hombros y tríceps', b: [['pecho', 3], ['hombros', 2], ['triceps', 1]] },
  tiron: { nombre: 'Espalda y bíceps', b: [['espalda', 3], ['hombros', 1, 3], ['biceps', 2]] },
  piernas: { nombre: 'Piernas y glúteos', b: [['cuadriceps', 2], ['femoral', 1], ['gluteos', 2], ['pantorrillas', 1]] },
  torsoA: { nombre: 'Torso A', b: [['pecho', 2], ['espalda', 2], ['hombros', 1], ['triceps', 1]] },
  torsoB: { nombre: 'Torso B', b: [['espalda', 2, 2], ['pecho', 2, 2], ['hombros', 1, 1], ['biceps', 1]] },
  piernasA: { nombre: 'Piernas (cuádriceps)', b: [['cuadriceps', 3], ['femoral', 1], ['pantorrillas', 1], ['core', 1]] },
  piernasB: { nombre: 'Piernas (glúteos y femorales)', b: [['gluteos', 2], ['femoral', 2], ['cuadriceps', 1, 3], ['core', 1, 1]] },
  hombrosCore: { nombre: 'Hombros y core', b: [['hombros', 3, 1], ['core', 3]] },
};
const SPLITS = {
  1: ['fullA'],
  2: ['fullA', 'fullB'],
  3: ['empuje', 'tiron', 'piernas'],
  4: ['torsoA', 'piernasA', 'torsoB', 'piernasB'],
  5: ['empuje', 'tiron', 'piernas', 'hombrosCore', 'piernasB'],
  6: ['empuje', 'tiron', 'piernas', 'empuje', 'tiron', 'piernas'],
  7: ['empuje', 'tiron', 'piernas', 'hombrosCore', 'empuje', 'tiron', 'piernas'],
};

// Zonas que pide el deporte → bloque de gym que las cubre.
const ZONA_BLOQUE = {
  piernas: 'cuadriceps', gluteos: 'gluteos', core: 'core', trapecios: 'trapecios', cuello: 'trapecios',
  antebrazos: 'antebrazos', agarre: 'antebrazos', espalda: 'espalda', hombros: 'hombros', isquios: 'femoral',
  pantorrillas: 'pantorrillas', tobillos: 'equilibrio', pecho: 'pecho',
};

// Deporte → cómo se agenda (derby tiene tipo propio; el resto es «otro» con su actividad).
const ACTIVIDAD_DEPORTE = {
  running: 'correr', trail: 'correr', ciclismo: 'bicicleta', mtb: 'bicicleta', escalada: 'escalada',
  senderismo: 'trekking', andinismo: 'trekking', natacion: 'natacion', triatlon: 'natacion', patinaje: 'patinaje',
  hockey: 'patinaje', yoga: 'yoga', pilates: 'yoga', crossfit: 'hiit', hyrox: 'hiit', danza: 'baile',
  futbol: 'futbol', futsal: 'futbol',
};

const FOCO_RUTINA = { masa_muscular: 'masa_muscular', perder_grasa: 'perder_grasa', recomposicion: 'mixto', mantenimiento: 'mixto', cardio: 'cardio' };

/** Qué le falta a una persona para tener la app completa. */
export async function queFalta(persona = estado.yo) {
  const [med, obj, rutinas, proximos] = await Promise.all([
    sb.from('mediciones_corporales').select('id').eq('persona_id', persona.id).not('peso_kg', 'is', null).limit(1).then(datos),
    sb.from('objetivos').select('id').eq('persona_id', persona.id).limit(1).then(datos),
    sb.from('rutinas').select('id').eq('hogar_id', persona.hogar_id).limit(1).then(datos),
    sb.from('calendario').select('id').eq('hogar_id', persona.hogar_id).gte('fecha', hoyISO()).limit(1).then(datos),
  ]);
  const falta = [];
  if (!persona.sexo || !persona.fecha_nacimiento || !persona.altura_cm || !med.length) falta.push('cuerpo');
  if (!obj.length) falta.push('objetivo');
  if (!rutinas.length || !proximos.length) falta.push('plan');
  return falta;
}

/**
 * Arma y guarda el plan. dias* son días de la semana de JS (0 = domingo).
 * @returns {{ rutinas: number, eventos: number }}
 */
export async function armarPlan({ objetivo, experiencia, diasGym, horaGym, diasDeporte = [], horaDeporte }) {
  const hogar = estado.yo.hogar_id;
  const dep = datosDeporte(estado.equipo?.deporte ?? 'gym');
  await sb.rpc('copiar_catalogo');
  const catalogo = datos(await sb.from('ejercicios').select('id, nombre, unidad').eq('hogar_id', hogar));
  const porNombre = Object.fromEntries(catalogo.map((e) => [e.nombre, e]));

  const series = experiencia === 'avanzado' ? 4 : 3;
  const reps = objetivo === 'perder_grasa' || objetivo === 'cardio' ? 12 : 10;
  const descanso = objetivo === 'perder_grasa' || objetivo === 'cardio' ? 60 : experiencia === 'avanzado' ? 120 : 90;
  const segundos = experiencia === 'principiante' ? 20 : 30;
  const extras = [...new Set(dep.zonas.map((z) => ZONA_BLOQUE[z]).filter(Boolean)
    .map((b) => (b === 'cuadriceps' && CARGA_CUADRICEPS.has(dep.clave) ? 'gluteos' : b)))];

  // Días de gym que coinciden con el deporte: rutina liviana (si es un deporte exigente y quedan otros días para lo pesado).
  const gym = [...diasGym].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // lunes primero
  const livianos = dep.liviano ? gym.filter((d) => diasDeporte.includes(d)) : [];
  const pesados = gym.length - livianos.length >= 1 ? gym.filter((d) => !livianos.includes(d)) : gym;
  const conLiviano = pesados.length < gym.length;

  // Deportes que ya cargan mucho los cuádriceps (derby, patinaje, ciclismo…): las piernas del gym van a glúteos y
  // femorales, con un solo ejercicio de cuádriceps compuesto y sin aislamiento, para no sumar fatiga.
  const cuadCargado = CARGA_CUADRICEPS.has(dep.clave);
  const bloques = (t) => {
    if (!cuadCargado) return t.b;
    let cuad = 0;
    return t.b.flatMap(([bloque, n, desde = 0]) => {
      if (bloque !== 'cuadriceps') return [[bloque, n, desde]];
      const queda = Math.max(0, Math.min(n, 1 - cuad));
      cuad += queda;
      const resto = n - queda;
      return [...(queda ? [[bloque, queda, desde]] : []), ...(resto ? [['gluteos', Math.ceil(resto / 2), 1], ['femoral', Math.floor(resto / 2), 1]] : [])]
        .filter(([, k]) => k > 0);
    });
  };
  const usados = new Set();
  const elegir = (bloque, cuantos, desde = 0) => {
    const lista = (B[bloque] ?? []).filter((n) => !(cuadCargado && n === 'Extensión de cuádriceps'));
    const out = [];
    for (let k = 0; out.length < cuantos && k < lista.length * 2; k++) {
      const nombre = lista[(desde + k) % lista.length];
      if (porNombre[nombre] && !out.includes(nombre)) out.push(nombre);
    }
    return out;
  };

  const crearRutina = async (nombre, nombres, foco, notas = null) => {
    const r = datos(await sb.from('rutinas').insert({ hogar_id: hogar, nombre, foco, autor: 'claude', creada_por: estado.yo.id, notas }).select('id').single());
    const filas = nombres.map((n, i) => {
      const ej = porNombre[n];
      usados.add(n);
      return {
        rutina_id: r.id, ejercicio_id: ej.id, orden: i + 1,
        series_base: foco === 'recuperacion' ? 2 : series,
        reps_base: ej.unidad === 'segundos' ? segundos : reps,
        descanso_base: foco === 'recuperacion' ? 45 : descanso,
      };
    });
    if (filas.length) datos(await sb.from('rutina_ejercicios').insert(filas));
    return r.id;
  };

  // Rutinas principales, con un ejercicio extra de lo que pide el deporte.
  const claves = SPLITS[Math.min(7, Math.max(1, pesados.length))].slice(0, pesados.length);
  const plantilla = experiencia === 'principiante' && pesados.length === 3 ? ['fullA', 'fullB', 'fullC'] : claves;
  const idPorClave = {};
  for (const [i, clave] of plantilla.entries()) {
    if (idPorClave[clave]) continue;
    const t = R[clave];
    let nombres = bloques(t).flatMap(([bloque, n, desde = 0]) => elegir(bloque, n, desde));
    const extra = extras[i % Math.max(1, extras.length)];
    if (extra && !t.b.some(([b]) => b === extra)) nombres = [...nombres.slice(0, 6), ...elegir(extra, 1, i)].filter((v, k, a) => a.indexOf(v) === k);
    idPorClave[clave] = await crearRutina(t.nombre, nombres, FOCO_RUTINA[objetivo] ?? 'mixto');
  }
  let idLiviano = null;
  if (conLiviano) {
    const zonas = extras.filter((b) => !['cuadriceps', 'gluteos', 'femoral', 'espalda', 'pecho'].includes(b));
    const nombres = [...elegir('core', 3, 1), ...zonas.flatMap((z, i) => elegir(z, 1, i + 1)), ...elegir('equilibrio', 1), ...elegir('lumbar', 1, 1)].slice(0, 6);
    idLiviano = await crearRutina(`Core y estabilidad · día de ${dep.nombre.toLowerCase()}`, nombres, 'recuperacion', `Liviana: el mismo día hay ${dep.nombre.toLowerCase()}.`);
  }

  // Agenda de las próximas 4 semanas (desde hoy).
  const hoy = hoyISO();
  const existentes = datos(await sb.from('calendario').select('fecha, tipo').eq('hogar_id', hogar).gte('fecha', hoy));
  const ya = new Set(existentes.map((e) => `${e.fecha}|${e.tipo}`));
  const eventos = [];
  for (let i = 0; i < 28; i++) {
    const fecha = sumarDias(hoy, i);
    const dia = new Date(`${fecha}T12:00`).getDay();
    if (diasDeporte.includes(dep.clave === 'gym' ? -1 : dia)) {
      const tipo = dep.clave === 'roller_derby' ? 'derby' : 'otro';
      if (!ya.has(`${fecha}|${tipo}`)) {
        eventos.push({
          hogar_id: hogar, fecha, tipo, hora_inicio: horaDeporte || null, asistencia: 'juntos',
          actividad: tipo === 'otro' ? (ACTIVIDAD_DEPORTE[dep.clave] ?? 'otro') : null,
          notas: tipo === 'otro' && !ACTIVIDAD_DEPORTE[dep.clave] ? dep.nombre : null,
        });
      }
    }
    if (gym.includes(dia) && !ya.has(`${fecha}|gym`)) {
      const k = pesados.indexOf(dia);
      const rutina = k >= 0 ? idPorClave[plantilla[k]] : idLiviano;
      eventos.push({ hogar_id: hogar, fecha, tipo: 'gym', hora_inicio: horaGym || null, asistencia: 'juntos', rutina_id: rutina ?? null });
    }
  }
  if (eventos.length) datos(await sb.from('calendario').insert(eventos));
  return { rutinas: Object.keys(idPorClave).length + (idLiviano ? 1 : 0), eventos: eventos.length };
}
