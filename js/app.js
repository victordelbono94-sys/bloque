// Arranque de Bloque: sesión, acceso al hogar y navegación entre pantallas.
import { sb, estado, cargarPersonas } from './db.js';
import { esc, avisoError } from './ui.js';
import { vistaHoy } from './vistas/hoy.js';
import { vistaSemana } from './vistas/semana.js';
import { vistaCuerpo } from './vistas/cuerpo.js';
import { vistaPerfil } from './vistas/perfil.js';

const app = document.getElementById('app');
const nav = document.getElementById('nav');

const RUTAS = {
  hoy: vistaHoy,
  semana: vistaSemana,
  cuerpo: vistaCuerpo,
  perfil: vistaPerfil,
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

function pantallaIngreso() {
  nav.hidden = true;
  app.innerHTML = `
    <section class="pantalla-centro">
      <span class="wordmark wordmark--grande" aria-label="bloque">bl<span class="wordmark__bloque" aria-hidden="true"></span>que</span>
      <p class="subtitulo">Entrenamiento, cuerpo y comidas, juntos.</p>
      <button class="boton boton--bloque" id="entrar" type="button">Entrar con Google</button>
    </section>`;
  document.getElementById('entrar').addEventListener('click', async () => {
    const vuelta = location.origin + location.pathname;
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: vuelta } });
    if (error) avisoError(error);
  });
}

function pantallaEspera() {
  nav.hidden = true;
  const u = estado.usuario;
  app.innerHTML = `
    <section class="pantalla-centro">
      <span class="wordmark" aria-label="bloque">bl<span class="wordmark__bloque" aria-hidden="true"></span>que</span>
      <h1 class="titulo">Ya casi</h1>
      <p class="subtitulo">Tu cuenta todavía no está unida al hogar. Pide que te agreguen con este correo:</p>
      <p class="tarjeta" style="width:100%;word-break:break-all"><strong>${esc(u.email)}</strong></p>
      <button class="boton boton--sec boton--bloque" id="reintentar" type="button">Ya me agregaron</button>
      <button class="boton boton--texto" id="salir" type="button">Cerrar sesión</button>
    </section>`;
  document.getElementById('reintentar').addEventListener('click', iniciar);
  document.getElementById('salir').addEventListener('click', async () => { await sb.auth.signOut(); iniciar(); });
}

async function mostrarRuta() {
  if (!estado.yo) return;
  const nombre = (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'hoy';
  const vista = RUTAS[nombre] ?? vistaHoy;
  nav.hidden = false;
  nav.querySelectorAll('.nav__item').forEach((a) => {
    if (a.dataset.ruta === nombre) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  app.innerHTML = '<p class="cargando">Cargando…</p>';
  try {
    await vista(app);
  } catch (e) {
    avisoError(e);
    app.innerHTML = '<p class="vacio">No se pudo cargar. Revisa tu conexión e intenta de nuevo.</p>';
  }
  window.scrollTo(0, 0);
}

let iniciando = null;
function iniciar() {
  // Evita dos arranques a la vez (carga inicial + evento de inicio de sesión).
  iniciando ??= arrancar().finally(() => { iniciando = null; });
  return iniciando;
}

async function arrancar() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return pantallaIngreso();
    await cargarPersonas();
    if (!estado.yo) return pantallaEspera();
    // Limpia los restos del inicio de sesión en la URL.
    if (location.search || /access_token/.test(location.hash)) history.replaceState(null, '', location.pathname + '#/hoy');
    await mostrarRuta();
  } catch (e) {
    avisoError(e);
    pantallaIngreso();
  }
}

window.addEventListener('hashchange', mostrarRuta);
sb.auth.onAuthStateChange((evento) => {
  if (evento === 'SIGNED_IN' && !estado.yo) iniciar();
  if (evento === 'SIGNED_OUT') { estado.yo = null; estado.personas = []; pantallaIngreso(); }
});

iniciar();
