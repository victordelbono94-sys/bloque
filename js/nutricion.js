// Nutrición: metas del día de cada persona, snacks alrededor de los entrenos y
// tendencia del peso. Funciones puras (sin navegador) para poder probarlas.
//
// Cómo se calcula la meta del día:
//   metabolismo basal (Katch-McArdle si hay % de grasa, si no Mifflin-St Jeor)
//   × 1,3 por la vida diaria
//   + lo que gastan los entrenos de ese día (lo que midió el reloj o, si todavía
//     no pasó, una estimación por tipo de entreno)
//   ajustado según el objetivo (déficit, superávit o mantenimiento).
// Proteína alta para cuidar el músculo, grasas mínimas sanas, y el resto
// carbohidratos: por eso los días de derby o piernas piden más carbohidratos.

const ACTIVIDAD_DIARIA = 1.3;

// Gasto extra estimado de cada entreno: MET y duración típica.
const ENTRENO = {
  derby: { met: 6.5, horas: 2, nombre: 'derby' },
  gym: { met: 5, horas: 1, nombre: 'gym' },
  gym_liviano: { met: 3.5, horas: 1, nombre: 'gym liviano' },
};
// Cuánto cansa una hora de «Otro», relativo a ~350 kcal en 70 kg (igual que el semáforo).
const OTRO_POR_HORA = { caminar: 0.3, correr: 1.3, escalada: 1.2, trekking: 0.9, bicicleta: 1, yoga: 0.4, hiit: 1.4, patinaje: 1.4, natacion: 1.2, baile: 0.9, futbol: 1.3, clase: 1, otro: 1 };

export const OBJETIVOS = {
  recomposicion: { nombre: 'Bajar grasa y ganar músculo', factor: 0.88, proteinaKg: 2.2 },
  masa_muscular: { nombre: 'Ganar peso y músculo', factor: 1.1, proteinaKg: 2 },
  perder_grasa: { nombre: 'Bajar de peso', factor: 0.8, proteinaKg: 2.3 },
  mantenimiento: { nombre: 'Mantener', factor: 1, proteinaKg: 1.6 },
  cardio: { nombre: 'Mejorar cardio', factor: 1, proteinaKg: 1.6 },
};

export function edad(fechaNacimiento, hoy = new Date()) {
  if (!fechaNacimiento) return null;
  const n = new Date(`${fechaNacimiento}T12:00:00`);
  let a = hoy.getFullYear() - n.getFullYear();
  if (hoy.getMonth() < n.getMonth() || (hoy.getMonth() === n.getMonth() && hoy.getDate() < n.getDate())) a--;
  return a;
}

/** Kcal extra de un evento del calendario (estimación, sin reloj). */
export function gastoEvento(ev, pesoKg) {
  if (ev.tipo === 'otro' || ev.tipo === 'clase') {
    return Math.round((OTRO_POR_HORA[ev.actividad ?? 'clase'] ?? 1) * 350 * (pesoKg / 70));
  }
  const e = ev.tipo === 'gym' ? (ev.liviana ? ENTRENO.gym_liviano : ENTRENO.gym) : ENTRENO[ev.tipo];
  if (!e) return 0;
  return Math.round((e.met - 1) * pesoKg * e.horas);
}

/**
 * Metas del día.
 * @param {object} p
 * @param {object} p.persona { sexo, fecha_nacimiento, altura_cm }
 * @param {object|null} p.medicion { peso_kg, grasa_pct, masa_magra_kg }
 * @param {string} [p.foco] clave de OBJETIVOS
 * @param {Array} [p.eventos] eventos de hoy de esta persona ({ tipo, actividad, liviana })
 * @param {Array} [p.entrenosReloj] entrenos de hoy que registró el reloj ({ calorias })
 */
export function calcularMetas({ persona, medicion, foco = 'recomposicion', eventos = [], entrenosReloj = [], hoy = new Date() }) {
  const falta = [];
  const peso = medicion?.peso_kg != null ? Number(medicion.peso_kg) : null;
  if (peso == null) falta.push('un peso');
  const grasa = medicion?.grasa_pct != null ? Number(medicion.grasa_pct) : null;
  const magra = medicion?.masa_magra_kg != null ? Number(medicion.masa_magra_kg) : (peso != null && grasa != null ? peso * (1 - grasa / 100) : null);
  const anios = edad(persona?.fecha_nacimiento, hoy);
  const altura = persona?.altura_cm != null ? Number(persona.altura_cm) : null;
  if (magra == null) {
    if (!persona?.sexo) falta.push('el sexo');
    if (anios == null) falta.push('la fecha de nacimiento');
    if (altura == null) falta.push('la altura');
  }
  if (falta.length) return { ok: false, falta };

  const basal = magra != null
    ? 370 + 21.6 * magra
    : 10 * peso + 6.25 * altura - 5 * anios + (persona.sexo === 'f' ? -161 : 5);
  const base = basal * ACTIVIDAD_DIARIA;

  const estimado = eventos.filter((e) => e.tipo !== 'descanso').reduce((a, e) => a + gastoEvento(e, peso), 0);
  const medido = entrenosReloj.reduce((a, s) => a + (s.calorias ?? 0), 0);
  const ejercicio = Math.max(estimado, medido);

  const obj = OBJETIVOS[foco] ?? OBJETIVOS.recomposicion;
  // Muy magro: con poca grasa, un déficit come músculo. Se come a mantenimiento o un poco más.
  const imc = altura ? peso / (altura / 100) ** 2 : null;
  const magro = grasa != null
    ? (persona?.sexo === 'f' ? grasa <= 20 : grasa <= 12)
    : imc != null && imc < 20;
  let factor = obj.factor;
  const notas = [];
  if (magro && factor < 1) {
    factor = 1.05;
    notas.push(grasa != null
      ? `Con ${String(grasa).replace('.', ',')}% de grasa no conviene déficit: comer un poco por encima del gasto ayuda a ganar músculo sin perderlo.`
      : 'Con tu peso para tu altura no conviene déficit: comer un poco por encima del gasto ayuda a ganar músculo.');
  }

  const kcalDe = (gasto) => Math.round((base + gasto) * factor / 10) * 10;
  const kcal = kcalDe(ejercicio);
  const proteina = Math.round(Math.min(obj.proteinaKg * peso, magra != null ? 2.7 * magra : Infinity));
  const grasas = Math.round(Math.max(0.8 * peso, (0.25 * kcal) / 9));
  const carbos = Math.max(0, Math.round((kcal - proteina * 4 - grasas * 9) / 4));

  // Cuánto más (en carbohidratos) que un día de descanso.
  const kcalDescanso = kcalDe(0);
  const extraCarbos = Math.round((kcal - kcalDescanso) / 4);
  const nombres = [...new Set(eventos.filter((e) => e.tipo !== 'descanso').map((e) =>
    e.tipo === 'otro' ? 'entreno' : e.tipo === 'gym' && e.liviana ? 'gym liviano' : e.tipo))];
  if (extraCarbos >= 25 && nombres.length) {
    notas.unshift(`Día de ${nombres.join(' y ')}: ${extraCarbos} g más de carbohidratos que un día de descanso.`);
  }
  if (medido > estimado + 150) {
    notas.unshift(`Tu reloj registró ${Math.round(medido)} kcal en entrenos, más de lo previsto: la meta ya lo suma.`);
  }

  return {
    ok: true, foco, magro, basal: Math.round(basal), base: Math.round(base), ejercicio: Math.round(ejercicio),
    medido: Math.round(medido), gasto: Math.round(base + ejercicio), kcal, proteina, carbos, grasas, extraCarbos, notas, peso,
  };
}

/** Consejos según lo que llevas comido y la hora. */
/**
 * Diagnóstico del día: UNA sola fuente para lo que dice la app (el resumen, el registro de comidas y la IA).
 * Las calorías se juzgan según el objetivo: pasarse un poco es bueno para ganar masa, poco para mantener
 * y casi nada para bajar de peso. Los macros se explican en relación a eso (sin contradecir las calorías).
 * @returns {{ estado: 'falta'|'justo'|'pasado', tono: 'ok'|'ojo'|'info', exceso: number, tolerancia: number, kcal: string, notas: string[] }}
 */
export function diagnosticoDia({ metas, comido, foco = metas?.foco, hora = new Date().getHours() }) {
  if (!metas?.ok) return { estado: 'falta', tono: 'info', exceso: 0, tolerancia: 0, kcal: '', notas: [] };
  const ganar = foco === 'masa_muscular' || metas.magro;
  const bajar = foco === 'perder_grasa';
  const tolerancia = Math.round(metas.kcal * (ganar ? 0.15 : bajar ? 0.03 : 0.06));
  const exceso = Math.round(comido.kcal - metas.kcal);
  const r = (n) => Math.round(n).toLocaleString('es-EC');
  let estado, tono, kcal;
  if (exceso > tolerancia) {
    estado = 'pasado'; tono = 'ojo';
    kcal = ganar ? `Te pasaste ~${r(exceso)} kcal: es mucho incluso para ganar masa. Mañana sigue normal.`
      : bajar ? `Te pasaste ~${r(exceso)} kcal de tu déficit. No pasa nada por un día: mañana sigue normal.`
      : `Te pasaste ~${r(exceso)} kcal. No pasa nada por un día: mañana sigue normal.`;
  } else if (exceso > 0) {
    estado = 'justo'; tono = 'ok';
    kcal = ganar ? `Pasaste tu meta por ~${r(exceso)} kcal: para ganar masa está bien ✓` : 'Calorías del día cubiertas ✓';
  } else if (exceso >= -metas.kcal * 0.08) {
    estado = 'justo'; tono = 'ok'; kcal = 'Calorías del día cubiertas ✓';
  } else {
    estado = 'falta'; tono = hora >= 20 && -exceso > 500 ? 'ojo' : 'info';
    kcal = `Te quedan ~${r(-exceso)} kcal${hora >= 20 && -exceso > 500 ? ': comer muy poco seguido frena la recuperación muscular' : ''}.`;
  }
  const notas = [];
  // Solo se habla del día cuando ya hay algo comido o se pasó; el «te quedan» ya lo dice el número grande.
  if (estado !== 'falta' || tono === 'ojo') notas.push(kcal);
  const faltaP = metas.proteina - comido.proteina;
  const faltaC = metas.carbos - comido.carbos;
  if (faltaP > Math.max(20, metas.proteina * 0.15) && (hora >= 17 || estado !== 'falta')) {
    notas.push(`Te faltan ~${r(faltaP)} g de proteína${estado === 'falta' ? ': una pechuga, un batido o un yogur griego con huevos ayudan a cerrar el día' : ' aunque ya cubriste las calorías: la próxima vez cambia algo de grasa o carbohidrato por proteína'}.`);
  }
  if (faltaC > Math.max(30, metas.carbos * 0.2) && (hora >= 14 || estado !== 'falta')) {
    notas.push(estado === 'falta'
      ? `Para lo que queda, prioriza carbohidratos: te faltan ~${r(faltaC)} g (arroz, papa, fruta, pan).`
      : `Los carbohidratos quedaron ~${r(faltaC)} g por debajo porque cubriste las calorías con proteína y grasa: no hace falta sumar más.`);
  }
  return { estado, tono, exceso, tolerancia, kcal, notas };
}

/** Consejos para el resumen del día (vienen del mismo diagnóstico que usa el registro y la IA). */
export function consejosDelDia(metas, comido, hora = new Date().getHours()) {
  return diagnosticoDia({ metas, comido, hora }).notas;
}

// ---------- Snacks alrededor de los entrenos ----------

// Valores por 100 g de lo que usan los snacks (iguales al catálogo base).
const A = {
  banana: ['1 banana', 120, 89, 1.1, 22.8, 0.3],
  yogurGriego: ['1 yogur griego', 170, 97, 9, 3.6, 5],
  pan: ['1 pan', 50, 265, 9, 49, 3.2],
  miel: ['1 cda de miel', 21, 304, 0.3, 82.4, 0],
  quesoFresco: ['1 tajada de queso fresco', 30, 264, 18, 3, 20],
  avena: ['½ taza de avena', 40, 389, 16.9, 66.3, 6.9],
  leche: ['1 vaso de leche descremada', 250, 34, 3.4, 5, 0.1],
  galletasArroz: ['3 galletas de arroz', 27, 387, 8.2, 81.5, 2.8],
  mani: ['1 cda de mantequilla de maní', 16, 588, 25, 20, 50],
  whey: ['1 scoop de proteína', 30, 400, 80, 8, 6],
  pollo: ['150 g de pollo', 150, 165, 31, 0, 3.6],
  arroz: ['1 taza y media de arroz', 240, 130, 2.7, 28.2, 0.3],
  huevos: ['2 huevos', 100, 143, 12.6, 0.7, 9.5],
  claras: ['2 claras', 66, 52, 10.9, 0.7, 0.2],
  panIntegral: ['2 rebanadas de pan integral', 60, 247, 13, 41, 3.4],
  naranja: ['1 naranja', 140, 47, 0.9, 11.8, 0.1],
  atun: ['1 lata de atún', 120, 116, 25.5, 0, 0.8],
  papa: ['2 papas', 300, 87, 1.9, 20.1, 0.1],
  bebida: ['500 ml de bebida deportiva', 500, 26, 0, 6.4, 0],
};
const ANTES = [['banana', 'yogurGriego'], ['pan', 'miel', 'quesoFresco'], ['avena', 'leche', 'banana'], ['galletasArroz', 'mani', 'banana']];
const DESPUES = [['whey', 'banana', 'leche'], ['pollo', 'arroz'], ['huevos', 'claras', 'panIntegral', 'naranja'], ['atun', 'papa']];

function combo(claves) {
  let p = 0, c = 0, k = 0;
  for (const clave of claves) {
    const [, g, kc, pr, ca] = A[clave];
    k += (kc * g) / 100; p += (pr * g) / 100; c += (ca * g) / 100;
  }
  return { texto: claves.map((x) => A[x][0]).join(' + '), kcal: Math.round(k), proteina: Math.round(p), carbos: Math.round(c) };
}

const aMinutos = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const aHora = (min) => `${String(Math.floor(((min % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((min % 60) + 60) % 60).padStart(2, '0')}`;
const HORA_TIPICA = { gym: '07:00', derby: '19:00', otro: '12:00', clase: '12:00' };
const DURACION = { derby: 120, gym: 60, otro: 60, clase: 60 };

/**
 * Snacks para los entrenos de hoy que todavía no pasaron (o terminaron hace poco).
 * @returns {Array<{ cuando, hora, titulo, detalle, opciones }>}
 */
export function snacksDelDia(eventos, pesoKg, ahora = new Date()) {
  if (!pesoKg) return [];
  const minAhora = ahora.getHours() * 60 + ahora.getMinutes();
  const lista = [];
  for (const ev of eventos) {
    if (!['derby', 'gym', 'otro', 'clase'].includes(ev.tipo)) continue;
    if (ev.tipo === 'otro' && ['caminar', 'yoga'].includes(ev.actividad)) continue;
    const inicio = aMinutos((ev.hora_inicio ?? HORA_TIPICA[ev.tipo]).slice(0, 5));
    const fin = inicio + DURACION[ev.tipo];
    const intenso = ev.tipo === 'derby' || (ev.tipo === 'gym' && !ev.liviana) || ev.tipo === 'otro';
    const nombre = ev.tipo === 'derby' ? 'derby' : ev.tipo === 'gym' ? 'gym' : 'entreno';
    const carbosAntes = Math.round(pesoKg * (ev.tipo === 'derby' ? 0.8 : 0.5));
    if (minAhora < inicio - 30) {
      lista.push({
        cuando: 'antes', hora: aHora(inicio - 75), titulo: `Antes del ${nombre}`,
        detalle: `Entre 60 y 90 minutos antes: unos ${carbosAntes} g de carbohidratos fáciles, algo de proteína y poca grasa o fibra.`,
        opciones: ANTES.map(combo),
      });
    }
    if (ev.tipo === 'derby' && minAhora < fin) {
      lista.push({
        cuando: 'durante', hora: aHora(inicio), titulo: 'Durante el derby',
        detalle: 'Agua en cada pausa. Si es intenso y pasa de una hora, 30 a 40 g de carbohidratos por hora.',
        opciones: [combo(['bebida']), combo(['banana'])],
      });
    }
    if (minAhora < fin + 180 && intenso) {
      const prot = Math.round(pesoKg * 0.4);
      const carb = Math.round(pesoKg * (ev.tipo === 'derby' ? 1 : 0.7));
      lista.push({
        cuando: 'despues', hora: aHora(fin + 30), titulo: `Después del ${nombre}`,
        detalle: `Dentro de las 2 horas: unos ${prot} g de proteína y ${carb} g de carbohidratos para recuperar el músculo y la energía.`,
        opciones: DESPUES.map(combo),
      });
    }
  }
  return lista.sort((a, b) => a.hora.localeCompare(b.hora));
}

// ---------- Peso ----------

/** Tendencia de las últimas 4 semanas: kg por semana (regresión lineal). */
export function tendenciaPeso(mediciones, foco = 'recomposicion', ahora = new Date()) {
  const desde = ahora.getTime() - 28 * 864e5;
  const puntos = mediciones
    .filter((m) => m.peso_kg != null && new Date(m.medido_en).getTime() >= desde)
    .map((m) => ({ x: new Date(m.medido_en).getTime() / (7 * 864e5), y: Number(m.peso_kg) }));
  if (puntos.length < 3) return null;
  const xs = puntos.map((p) => p.x);
  if (Math.max(...xs) - Math.min(...xs) < 1) return null; // menos de una semana de datos
  const mx = xs.reduce((a, b) => a + b, 0) / puntos.length;
  const my = puntos.reduce((a, p) => a + p.y, 0) / puntos.length;
  const pendiente = puntos.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / puntos.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  const kgSemana = Math.round(pendiente * 100) / 100;
  let nota = null;
  if (kgSemana < -0.01 * my) nota = `Bajas ${Math.abs(kgSemana).toLocaleString('es-EC')} kg por semana: es rápido y puede costar músculo. Suma unas 200 kcal al día.`;
  else if (foco === 'recomposicion' && kgSemana > 0.3) nota = `Subes ${kgSemana.toLocaleString('es-EC')} kg por semana: para bajar grasa conviene restar unas 150 kcal al día.`;
  else if (foco === 'masa_muscular' && kgSemana < 0.05) nota = 'El peso no sube: para ganar músculo suma unas 150 kcal al día.';
  return { kgSemana, nota, n: puntos.length };
}
