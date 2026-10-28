// Textos compartidos para los eventos del calendario.
import { esc } from './ui.js';
import { estado, nombrePersona, otraPersona } from './db.js';
import { hora } from './fechas.js';

export const TIPOS = {
  gym: 'Gym',
  derby: 'Derby',
  clase: 'Clase',
  descanso: 'Descanso',
};

// "Sant y yo" (o "Victor y yo" para Sant).
export function textoJuntos() {
  const otro = otraPersona();
  return otro ? `${otro.nombre} y yo` : 'Juntos';
}

export function textoAsistencia(ev) {
  if (ev.tipo === 'descanso') return '';
  if (ev.asistencia === 'juntos') return textoJuntos();
  return ev.persona_id === estado.yo?.id ? 'Solo tú' : `Solo ${nombrePersona(ev.persona_id)}`;
}

export function htmlEvento(ev) {
  const detalle = [hora(ev.hora_inicio), textoAsistencia(ev), ev.notas].filter(Boolean).join(' · ');
  return `
    <span class="etiqueta etiqueta--${esc(ev.tipo)}">${esc(TIPOS[ev.tipo] ?? ev.tipo)}</span>
    ${detalle ? `<span class="evento__detalle">${esc(detalle)}</span>` : ''}`;
}

// ¿Este evento incluye a la persona?
export function incluyeA(ev, personaId) {
  return ev.asistencia === 'juntos' || ev.persona_id === personaId;
}
