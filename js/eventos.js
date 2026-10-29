// Textos compartidos para los eventos del calendario.
import { esc } from './ui.js';
import { estado, nombrePersona, otraPersona } from './db.js';
import { hora } from './fechas.js';
import { iconoTipo } from './iconos.js';
import { actividad } from './actividades.js';

export const TIPOS = {
  gym: 'Gym',
  derby: 'Derby',
  otro: 'Otro',
  descanso: 'Descanso',
};

// «Otro» se muestra con su actividad (Caminata, Escalada…).
export function nombreEvento(ev) {
  if (ev.tipo === 'otro') {
    // Un deporte sin actividad propia (rugby, boxeo…) se muestra con su nombre, guardado en las notas.
    if ((!ev.actividad || ev.actividad === 'otro') && ev.notas) return ev.notas;
    return ev.actividad ? actividad(ev.actividad).nombre : 'Otro';
  }
  return TIPOS[ev.tipo] ?? ev.tipo;
}
export function iconoEvento(ev) {
  return ev.tipo === 'otro' && ev.actividad ? actividad(ev.actividad).icono : iconoTipo(ev.tipo);
}

// Para ordenar el día: sin hora, el gym va de mañana, el derby de noche.
const HORA_TIPICA = { gym: '07:00', clase: '12:00', otro: '12:00', derby: '19:00', descanso: '23:59' };
export function horaEfectiva(ev) {
  return (ev.hora_inicio ?? HORA_TIPICA[ev.tipo] ?? '12:00').slice(0, 5);
}

// "Sant y yo" (o "Victor y yo" para Sant).
export function textoJuntos() {
  const otros = estado.personas.filter((p) => p.id !== estado.yo?.id);
  if (!otros.length) return '';
  return otros.length === 1 ? `${otros[0].nombre} y yo` : 'Todo el equipo';
}

export function textoAsistencia(ev) {
  if (ev.tipo === 'descanso') return '';
  if (ev.asistencia === 'juntos') return textoJuntos();
  return ev.persona_id === estado.yo?.id ? 'Solo yo' : `Solo ${nombrePersona(ev.persona_id)}`;
}

export function htmlEvento(ev) {
  const detalle = [hora(ev.hora_inicio), textoAsistencia(ev), ev.notas].filter(Boolean).join(' · ');
  return `
    <span class="etiqueta etiqueta--${esc(ev.tipo)}">${iconoEvento(ev)}${esc(nombreEvento(ev))}</span>
    ${detalle ? `<span class="evento__detalle">${esc(detalle)}</span>` : ''}`;
}

// ¿Este evento incluye a la persona?
export function incluyeA(ev, personaId) {
  return ev.asistencia === 'juntos' || ev.persona_id === personaId;
}
