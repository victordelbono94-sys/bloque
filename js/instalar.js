// Bloque se usa instalada, como app, con su ícono y a pantalla completa.
// Abierta en el navegador del teléfono, solo muestra cómo instalarla.
import { esc } from './ui.js';
import { APK } from './nativo.js';

const ua = navigator.userAgent;
const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const android = /Android/.test(ua);
const movil = ios || android;
const iosSafari = ios && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
const CLAVE_NAVEGADOR = 'bloque-usar-en-navegador';

export function estaInstalada() {
  if (/BloqueApp\//.test(ua)) return true; // dentro de la app Android de Bloque
  return matchMedia('(display-mode: standalone)').matches
    || matchMedia('(display-mode: fullscreen)').matches
    || matchMedia('(display-mode: minimal-ui)').matches
    || navigator.standalone === true
    || document.referrer.startsWith('android-app://');
}

// En la computadora se puede seguir en el navegador; en el teléfono, no.
export function puedeSeguirEnNavegador() {
  if (movil) return false;
  try { return localStorage.getItem(CLAVE_NAVEGADOR) === '1'; } catch { return false; }
}

const ICONO = '<img src="icons/icon-192.png" width="96" height="96" alt="" class="icono-app">';
const COMPARTIR = '<svg class="icono-linea" viewBox="0 0 24 24" aria-label="Compartir"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11v9h12v-9"/></svg>';

function pasos() {
  if (iosSafari) {
    return {
      titulo: 'Instálala desde Safari',
      lista: [`Toca ${COMPARTIR} <strong>Compartir</strong> abajo en la pantalla.`, 'Elige <strong>Agregar a pantalla de inicio</strong>.', 'Abre <strong>Bloque</strong> desde el ícono nuevo.'],
    };
  }
  if (ios) {
    return {
      titulo: 'Ábrela en Safari',
      lista: ['En iPhone, solo Safari instala apps web.', 'Copia el enlace y ábrelo en <strong>Safari</strong>.', `Ahí toca ${COMPARTIR} <strong>Compartir</strong> → <strong>Agregar a pantalla de inicio</strong>.`],
      copiar: true,
    };
  }
  if (android) {
    return {
      titulo: 'Instala la app Bloque',
      lista: ['Toca <strong>Descargar Bloque</strong> y abre el archivo.', 'Si Android lo pide, permite instalar apps desde el navegador y toca <strong>Instalar</strong>.', 'Abre <strong>Bloque</strong> desde el ícono nuevo y entra con Google.'],
      apk: true,
    };
  }
  return {
    titulo: 'Instálala en la computadora',
    lista: ['En Chrome o Edge, toca el ícono de instalar al final de la barra de direcciones.', 'O abre el menú del navegador y elige <strong>Instalar Bloque</strong>.'],
  };
}

export function pantallaInstalar(app, alContinuar) {
  const pintar = (instalada = false) => {
    const p = pasos();
    const boton = !instalada && !android && window.__instalar;
    app.innerHTML = `
      <section class="pantalla-centro instalar">
        ${ICONO}
        <span class="wordmark" aria-label="bloque">bl<span class="wordmark__bloque" aria-hidden="true"></span>que</span>
        ${instalada ? `
          <h1 class="titulo">Lista</h1>
          <p class="subtitulo">Bloque quedó instalada. Ábrela desde el ícono en tu pantalla de inicio.</p>
        ` : `
          <p class="subtitulo">Bloque se usa como app, con su ícono y a pantalla completa.</p>
          ${boton ? `
            <button type="button" class="boton boton--bloque" id="instalar">Instalar Bloque</button>
          ` : `
            <div class="tarjeta pasos-instalar">
              <h2 class="seccion__titulo" style="margin:0 0 10px">${esc(p.titulo)}</h2>
              <ol>${p.lista.map((x) => `<li>${x}</li>`).join('')}</ol>
              ${p.copiar ? '<button type="button" class="boton boton--sec boton--bloque" id="copiar-enlace">Copiar enlace</button>' : ''}
              ${p.apk ? `<a class="boton boton--bloque" href="${APK}">Descargar Bloque</a>` : ''}
            </div>
            <p class="ayuda">${p.apk ? 'Si ya instalaste Bloque desde el navegador antes, puedes quitar ese acceso: la app lo reemplaza.' : 'Si ya la instalaste, ábrela desde el ícono de Bloque.'}</p>
          `}
          ${!movil ? '<button type="button" class="boton boton--texto" id="seguir">Seguir en el navegador</button>' : ''}
        `}
      </section>`;

    app.querySelector('#instalar')?.addEventListener('click', async () => {
      const evento = window.__instalar;
      if (!evento) return pintar();
      evento.prompt();
      const { outcome } = await evento.userChoice;
      window.__instalar = null;
      pintar(outcome === 'accepted');
    });
    app.querySelector('#copiar-enlace')?.addEventListener('click', async (e) => {
      const enlace = location.origin + location.pathname;
      try { await navigator.clipboard.writeText(enlace); e.currentTarget.textContent = 'Enlace copiado'; }
      catch { e.currentTarget.textContent = enlace; }
    });
    app.querySelector('#seguir')?.addEventListener('click', () => {
      try { localStorage.setItem(CLAVE_NAVEGADOR, '1'); } catch { /* sin almacenamiento */ }
      alContinuar();
    });
  };

  pintar();
  window.addEventListener('bloque-instalable', () => pintar(), { once: true });
  window.addEventListener('appinstalled', () => pintar(true), { once: true });
}
