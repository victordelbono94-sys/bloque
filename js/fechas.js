// Fechas en hora local (Quito). Las fechas sin hora se guardan como 'AAAA-MM-DD'.

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function aISO(fecha) {
  const a = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${a}-${m}-${d}`;
}

export function desdeISO(iso) {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(a, m - 1, d);
}

export function hoyISO() {
  return aISO(new Date());
}

export function sumarDias(iso, n) {
  const f = desdeISO(iso);
  f.setDate(f.getDate() + n);
  return aISO(f);
}

// Lunes de la semana de esa fecha.
export function inicioSemana(iso) {
  const f = desdeISO(iso);
  const dia = (f.getDay() + 6) % 7; // lunes = 0
  f.setDate(f.getDate() - dia);
  return aISO(f);
}

export function diaLargo(iso) {
  const f = desdeISO(iso);
  return `${capitalizar(DIAS[f.getDay()])} ${f.getDate()} de ${MESES[f.getMonth()]}`;
}

export function diaCorto(iso) {
  return DIAS_CORTOS[desdeISO(iso).getDay()];
}

export function numeroDia(iso) {
  return desdeISO(iso).getDate();
}

export function fechaCorta(fechaHora) {
  const f = new Date(fechaHora);
  return `${f.getDate()} ${MESES_CORTOS[f.getMonth()]} ${f.getFullYear()}`;
}

export function rangoSemana(lunesISO) {
  const a = desdeISO(lunesISO);
  const b = desdeISO(sumarDias(lunesISO, 6));
  const mismoMes = a.getMonth() === b.getMonth();
  return mismoMes
    ? `${a.getDate()} al ${b.getDate()} de ${MESES[b.getMonth()]}`
    : `${a.getDate()} de ${MESES[a.getMonth()]} al ${b.getDate()} de ${MESES[b.getMonth()]}`;
}

export function hora(horaTexto) {
  return horaTexto ? horaTexto.slice(0, 5) : '';
}

// Valor para <input type="datetime-local"> en hora local.
export function ahoraLocalInput() {
  const f = new Date();
  f.setMinutes(f.getMinutes() - f.getTimezoneOffset());
  return f.toISOString().slice(0, 16);
}

function capitalizar(t) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}
