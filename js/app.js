// Arranque de Bloque: sesión, equipo y navegación entre pantallas.
import { sb, estado, cargarPersonas, fotoInicialDeGoogle } from './db.js';
import { aviso, avisoError } from './ui.js';
import { vistaHoy } from './vistas/hoy.js';
import { vistaSemana } from './vistas/semana.js';
import { vistaCuerpo } from './vistas/cuerpo.js';
import { vistaEntreno } from './vistas/entreno.js';
import { vistaSesion, vistaComenzar } from './vistas/sesion.js';
import { vistaPerfil } from './vistas/perfil.js';
import { vistaComida } from './vistas/comida.js';
import { pantallaBienvenida, vistaUnirme } from './vistas/bienvenida.js';
import { vistaCompletar } from './vistas/completar.js';
import { recordarInvitacion, invitacionPendiente } from './equipo.js';
import { vigilarActualizaciones } from './actualizar.js';
import { estaInstalada, puedeSeguirEnNavegador, pantallaInstalar } from './instalar.js';
import { enApp, loginEnApp, asegurarVinculo, desvincular, alEventoNativo, sincronizarAgenda } from './nativo.js';

const app = document.getElementById('app');
const nav = document.getElementById('nav');

const RUTAS = {
  hoy: vistaHoy,
  semana: vistaSemana,
  entreno: vistaEntreno,
  sesion: vistaSesion,
  comenzar: vistaComenzar,
  cuerpo: vistaCuerpo,
  perfil: vistaPerfil,
  comida: vistaComida,
  unirme: vistaUnirme,
  completar: vistaCompletar,
};

// Un link de invitación (#/unirme/CODIGO) se recuerda antes de iniciar sesión.
recordarInvitacion();

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
    try {
      if (enApp) return await loginEnApp(); // en la app, Google se abre en Chrome y vuelve
      const vuelta = location.origin + location.pathname;
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: vuelta } });
      if (error) throw error;
    } catch (e) {
      avisoError(e);
    }
  });
}

function pantallaPrimeraVez() {
  nav.hidden = true;
  pantallaBienvenida(app, async (mensaje) => {
    // Recién creada la cuenta: directo al asistente para completar el perfil y armar el plan.
    history.replaceState(null, '', location.pathname + '#/completar');
    await cargarPersonas();
    await fotoInicialDeGoogle().catch(() => {});
    await mostrarRuta();
    aviso(mensaje);
  }, async () => { await sb.auth.signOut(); });
}

const ORDEN = ['hoy', 'semana', 'entreno', 'sesion', 'comida', 'cuerpo', 'perfil'];
let rutaAnterior = null;
let navegacion = 0;
let quitarAnimacion;

// Hacia dónde entra la pantalla nueva: desde la derecha si avanzas en el menú
// (o a una semana posterior), desde la izquierda si retrocedes.
function direccion(nombre, param) {
  if (!rutaAnterior) return 'fade';
  if (rutaAnterior.nombre === nombre) {
    if (nombre === 'semana' && param && rutaAnterior.param) return param > rutaAnterior.param ? 'der' : 'izq';
    if (nombre === 'semana' && param !== rutaAnterior.param) return param ? 'der' : 'izq';
    return 'fade';
  }
  return ORDEN.indexOf(nombre) > ORDEN.indexOf(rutaAnterior.nombre) ? 'der' : 'izq';
}

const ESQUELETO = `
  <div class="esqueleto" style="height:34px;width:45%;margin:8px 0 6px"></div>
  <div class="esqueleto" style="height:16px;width:30%;margin-bottom:24px"></div>
  <div class="esqueleto" style="height:150px;border-radius:16px;margin-bottom:12px"></div>
  <div class="esqueleto" style="height:220px;border-radius:16px"></div>`;

async function mostrarRuta() {
  if (!estado.yo) return;
  // Al cambiar de pantalla, las hojas abiertas se cierran (no quedan flotando sobre otra sección).
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  const [nombreRuta, param] = location.hash.replace(/^#\/?/, '').split('/');
  const nombre = RUTAS[nombreRuta] ? nombreRuta : 'hoy';
  const vista = RUTAS[nombre];
  if (nav.hidden) {
    // Solo la primera vez que aparece sube desde abajo; al cambiar de sección no se mueve.
    nav.hidden = false;
    nav.classList.add('nav--entra');
    setTimeout(() => nav.classList.remove('nav--entra'), 450);
  }
  nav.querySelectorAll('.nav__item').forEach((a) => {
    if (a.dataset.ruta === (['sesion', 'comenzar', 'entreno'].includes(nombre) ? 'semana' : nombre)) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  const dir = direccion(nombre, param);
  rutaAnterior = { nombre, param };
  const turno = ++navegacion;

  // Mientras llegan los datos, la pantalla actual se queda quieta y se atenúa.
  // Si tardan, la reemplaza un esqueleto. No se anima nada todavía.
  clearTimeout(quitarAnimacion);
  delete app.dataset.anim;
  app.classList.add('vista-saliendo');
  const esperar = setTimeout(() => {
    if (turno !== navegacion) return;
    app.innerHTML = ESQUELETO;
    app.classList.remove('vista-saliendo');
  }, 250);

  // Cada pantalla se arma en su propio contenedor y solo se muestra si
  // sigue siendo la elegida (si tocaste otra sección, se descarta).
  const lienzo = document.createElement('div');
  lienzo.className = 'vista';
  try {
    await vista(lienzo);
  } catch (e) {
    if (turno === navegacion) avisoError(e);
    lienzo.innerHTML = '<p class="vacio">No se pudo cargar. Revisa tu conexión e intenta de nuevo.</p>';
  }
  clearTimeout(esperar);
  if (turno !== navegacion) return;

  // El contenido nuevo entra una sola vez, ya completo.
  app.classList.remove('vista-saliendo');
  app.replaceChildren(lienzo);
  app.scrollTop = 0; // #app es lo único que se desplaza: el menú no se mueve nunca
  app.dataset.anim = dir;
  quitarAnimacion = setTimeout(() => { delete app.dataset.anim; }, 700);
}

let iniciando = null;
function iniciar() {
  // Evita dos arranques a la vez (carga inicial + evento de inicio de sesión).
  iniciando ??= arrancar().finally(() => { iniciando = null; });
  return iniciando;
}

async function arrancar() {
  // En el teléfono, Bloque solo funciona instalada como app.
  if (!estaInstalada() && !puedeSeguirEnNavegador()) {
    nav.hidden = true;
    return pantallaInstalar(app, iniciar);
  }
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return pantallaIngreso();
    await cargarPersonas();
    if (!estado.yo) return pantallaPrimeraVez();
    // Limpia los restos del inicio de sesión en la URL.
    if (location.search || /access_token/.test(location.hash)) history.replaceState(null, '', location.pathname + '#/hoy');
    // Llegó con un link de invitación y ya tiene cuenta: confirmar el cambio de equipo.
    const invitacion = invitacionPendiente();
    if (invitacion && !location.hash.startsWith('#/unirme/')) history.replaceState(null, '', `${location.pathname}#/unirme/${invitacion}`);
    await mostrarRuta();
    // En la app: conectar este teléfono con la cuenta para traer los datos de la banda.
    if (enApp) {
      asegurarVinculo().catch((e) => console.error('vínculo con la app', e));
      sincronizarAgenda().catch((e) => console.error('agenda para avisos', e));
    }
  } catch (e) {
    avisoError(e);
    pantallaIngreso();
  }
}

window.addEventListener('hashchange', mostrarRuta);
sb.auth.onAuthStateChange((evento) => {
  if (evento === 'SIGNED_IN' && !estado.yo) iniciar();
  if (evento === 'SIGNED_OUT') { estado.yo = null; estado.personas = []; desvincular(); pantallaIngreso(); }
});

// Cuando la app termina de sincronizar con Health Connect, se refrescan las pantallas que lo muestran.
alEventoNativo('sync', (r) => {
  const ruta = location.hash.replace(/^#\/?/, '').split('/')[0] || 'hoy';
  if (r?.ok && estado.yo && ['hoy', 'cuerpo'].includes(ruta) && !document.querySelector('dialog[open]')) mostrarRuta();
});

iniciar();
vigilarActualizaciones();
