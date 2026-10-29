// Actualización obligatoria. Dos partes:
// - La web: si se publicó una versión nueva mientras la app estaba abierta, se pide recargar.
// - La app de Android: si hay un APK más nuevo en GitHub, se bloquea hasta actualizar.
import { enApp, estadoNativo, buscarActualizacion } from './nativo.js';

let versionWeb = null;
let mostrando = false;

const leerVersionWeb = async () => {
  const r = await fetch(`./sw.js?v=${Date.now()}`, { cache: 'no-store' });
  return /VERSION = '([^']+)'/.exec(await r.text())?.[1] ?? null;
};

// Última versión del APK publicada (la release "app" lleva "versionCode: N" en su texto). Se consulta como mucho cada hora.
async function versionApkPublicada() {
  try {
    const guardada = JSON.parse(localStorage.getItem('bloque-apk-remota') || 'null');
    if (guardada && Date.now() - guardada.t < 3600e3) return guardada.v;
  } catch { /* nada */ }
  const r = await fetch('https://api.github.com/repos/victordelbono94-sys/bloque/releases/tags/app', { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) return null;
  const v = Number(/versionCode:\s*(\d+)/.exec((await r.json()).body ?? '')?.[1]) || null;
  try { localStorage.setItem('bloque-apk-remota', JSON.stringify({ t: Date.now(), v })); } catch { /* nada */ }
  return v;
}

function bloquear({ titulo, texto, boton, accion, ayuda }) {
  if (mostrando) return;
  mostrando = true;
  const capa = document.createElement('div');
  capa.className = 'actualizar';
  capa.setAttribute('role', 'alertdialog');
  capa.setAttribute('aria-modal', 'true');
  capa.innerHTML = `
    <div class="actualizar__caja">
      <span class="wordmark" aria-label="bloque">bl<span class="wordmark__bloque" aria-hidden="true"></span>que</span>
      <h2 class="titulo">${titulo}</h2>
      <p class="subtitulo">${texto}</p>
      <button type="button" class="boton boton--bloque" id="actualizar-ya">${boton}</button>
      ${ayuda ? `<p class="ayuda" style="margin:0">${ayuda}</p>` : ''}
    </div>`;
  document.body.appendChild(capa);
  capa.querySelector('#actualizar-ya').addEventListener('click', accion);
}

async function revisar() {
  if (mostrando || document.hidden) return;
  try {
    const actual = await leerVersionWeb();
    if (versionWeb && actual && actual !== versionWeb) {
      return bloquear({
        titulo: 'Hay una versión nueva',
        texto: 'Bloque se actualizó con mejoras. Tócala para cargarla: no se pierde nada.',
        boton: 'Actualizar ahora',
        accion: () => location.reload(),
      });
    }
    versionWeb ??= actual;
  } catch { /* sin conexión: se revisa más tarde */ }

  if (!enApp) return;
  try {
    const instalada = Number(estadoNativo()?.version) || 0;
    const publicada = await versionApkPublicada();
    if (instalada && publicada && publicada > instalada) {
      bloquear({
        titulo: 'Actualiza la app',
        texto: 'Hay una versión nueva de la app Bloque para Android. Hace falta instalarla para seguir.',
        boton: 'Descargar e instalar',
        accion: () => buscarActualizacion(),
        ayuda: 'Se instala encima de la actual: no se pierde nada. Si Android lo pide, permite instalar apps de Bloque.',
      });
    }
  } catch { /* se revisa más tarde */ }
}

export function vigilarActualizaciones() {
  revisar();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revisar(); });
  setInterval(revisar, 30 * 60000);
}
