// Equipos: deportes, invitaciones y las acciones del admin. En la base el hogar es la tabla "hogares".
import { sb, estado, datos } from './db.js';
import { esc, aviso } from './ui.js';
import { enApp, APK, abrirExterno } from './nativo.js';
import { GRUPOS, LISTA, nombreDeporte } from './deportes.js';

export { nombreDeporte };

const WEB = 'https://victordelbono94-sys.github.io/bloque/';
export const linkInvitacion = (codigo) => `${WEB}#/unirme/${codigo}`;

// Guardar el código de un link de invitación mientras la persona inicia sesión.
const CLAVE = 'bloque.invitacion';
export function recordarInvitacion() {
  const m = /^#\/unirme\/([A-Za-z0-9]{6})/.exec(location.hash);
  if (m) try { localStorage.setItem(CLAVE, m[1].toUpperCase()); } catch { /* sin almacenamiento */ }
}
export function invitacionPendiente() {
  try { return localStorage.getItem(CLAVE); } catch { return null; }
}
export function olvidarInvitacion() {
  try { localStorage.removeItem(CLAVE); } catch { /* nada */ }
}

// Selector de deporte: buscador + chips por grupo. Devuelve el HTML; conectarDeporte() lo activa.
export function selectorDeporte(elegido) {
  return `
    <div class="selector-deporte">
      <input type="search" class="selector-deporte__buscar" placeholder="Buscar deporte…" aria-label="Buscar deporte" autocomplete="off">
      ${GRUPOS.map((gr) => `
        <div class="selector-deporte__grupo" data-grupo="${gr.clave}">
          <p class="selector-deporte__titulo">${esc(gr.nombre)}</p>
          <div class="chips">
            ${LISTA.filter((x) => x.grupo === gr.clave).map((x) => `<button type="button" class="chip" data-valor="${x.clave}" data-buscar="${esc(normal(x.nombre))}" aria-pressed="${x.clave === elegido}">${esc(x.nombre)}</button>`).join('')}
          </div>
        </div>`).join('')}
      <p class="quieto selector-deporte__nada" hidden>No está en la lista: elige «Otro».</p>
    </div>`;
}
const normal = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Activa el selector (opción única entre todos los grupos). Devuelve una función que lee el elegido. */
export function conectarDeporte(cont, alCambiar) {
  const chips = [...cont.querySelectorAll('.selector-deporte .chip')];
  chips.forEach((c) => c.addEventListener('click', () => {
    chips.forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
    alCambiar?.(c.dataset.valor);
  }));
  const buscar = cont.querySelector('.selector-deporte__buscar');
  buscar.addEventListener('input', () => {
    const q = normal(buscar.value.trim());
    let alguno = false;
    cont.querySelectorAll('.selector-deporte__grupo').forEach((g) => {
      let visibles = 0;
      g.querySelectorAll('.chip').forEach((c) => { const ver = !q || c.dataset.buscar.includes(q); c.hidden = !ver; visibles += ver; });
      g.hidden = !visibles;
      alguno ||= visibles > 0;
    });
    cont.querySelector('.selector-deporte__nada').hidden = alguno;
  });
  return () => chips.find((c) => c.getAttribute('aria-pressed') === 'true')?.dataset.valor ?? null;
}

export function textoInvitacion(equipo) {
  return `Únete a «${equipo.nombre}» en Bloq 💪\n\n`
    + `1. Instala la app: ${APK}\n`
    + `2. Entra con Google y elige «Unirme a un hogar»\n`
    + `3. Usa el código ${equipo.codigo}\n\n`
    + `O abre este link: ${linkInvitacion(equipo.codigo)}`;
}

/** Comparte la invitación: menú del teléfono si existe; si no, WhatsApp. */
export async function compartirInvitacion(equipo) {
  const texto = textoInvitacion(equipo);
  if (!enApp && navigator.share) {
    try { await navigator.share({ text: texto }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  abrirExterno(`https://wa.me/?text=${encodeURIComponent(texto)}`);
}

export async function copiar(texto, mensaje = 'Copiado.') {
  try {
    await navigator.clipboard.writeText(texto);
    aviso(mensaje);
  } catch {
    aviso('No se pudo copiar. Mantén presionado el código para copiarlo.', 'error');
  }
}

// Llamadas a la base (todas validan quién puede hacer qué del lado del servidor).
const rpc = async (fn, args) => datos(await sb.rpc(fn, args));
export const crearEquipo = (miNombre, { nombre = null, personal = false, deporte = 'gym' } = {}) =>
  rpc('crear_equipo', { p_mi_nombre: miNombre, p_equipo: nombre, p_personal: personal, p_deporte: deporte });
export const unirmeEquipo = (codigo, miNombre = null) => rpc('unirme_equipo', { p_codigo: codigo, p_mi_nombre: miNombre });
export const salirDelEquipo = () => rpc('salir_del_equipo');
export const quitarDelEquipo = (personaId) => rpc('quitar_del_equipo', { p_persona: personaId });
export const editarEquipo = ({ nombre = null, nuevoCodigo = false, admin = null, deporte = null } = {}) =>
  rpc('editar_equipo', { p_nombre: nombre, p_nuevo_codigo: nuevoCodigo, p_admin: admin, p_deporte: deporte });
export const convertirEnEquipo = (nombre) => rpc('convertir_en_equipo', { p_nombre: nombre });

export const soyAdmin = () => estado.equipo?.admin_id === estado.yo?.id;
