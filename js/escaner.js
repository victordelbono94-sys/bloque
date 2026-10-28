// Escanear el código de barras de un producto con la cámara. Si el teléfono no
// puede leer códigos (o no hay permiso de cámara), se escribe el número a mano.
import { abrirDialogo } from './ui.js';

const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

async function puedeEscanear() {
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) return false;
  try {
    const f = await window.BarcodeDetector.getSupportedFormats();
    return FORMATOS.some((x) => f.includes(x));
  } catch { return false; }
}

/** Devuelve el código leído o escrito, o null si se canceló. */
export function escanearCodigo() {
  return new Promise(async (resolver) => {
    let resuelto = false;
    const fin = (v) => { if (!resuelto) { resuelto = true; resolver(v); } };
    const camara = await puedeEscanear();
    const d = abrirDialogo(`
      <form class="dialogo" novalidate>
        <h2 class="tarjeta__titulo">Código de barras</h2>
        ${camara ? `
          <div class="escaner"><video playsinline muted></video><span class="escaner__linea" aria-hidden="true"></span></div>
          <p class="ayuda" style="margin:0">Apunta al código. Se lee solo.</p>` : ''}
        <div class="campo">
          <label for="codigo">${camara ? 'O escríbelo' : 'Escribe los números del código'}</label>
          <input id="codigo" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="14" placeholder="7861234567890">
        </div>
        <div class="dialogo__pie">
          <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
          <button type="submit" class="boton">Buscar</button>
        </div>
      </form>`, 'Código de barras');
    let flujo = null, vuelta = null;
    const parar = () => { cancelAnimationFrame(vuelta); flujo?.getTracks().forEach((t) => t.stop()); };
    d.addEventListener('close', () => { parar(); fin(null); });
    d.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = d.querySelector('#codigo').value.replace(/\D/g, '');
      if (v.length < 6) return;
      parar(); fin(v); d.close();
    });
    if (!camara) return;
    try {
      flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      const video = d.querySelector('video');
      video.srcObject = flujo;
      await video.play();
      const detector = new window.BarcodeDetector({ formats: FORMATOS });
      const mirar = async () => {
        if (resuelto) return;
        try {
          const [c] = await detector.detect(video);
          if (c?.rawValue && /^[0-9]{6,14}$/.test(c.rawValue)) {
            navigator.vibrate?.(60);
            parar(); fin(c.rawValue); d.close();
            return;
          }
        } catch { /* sigue mirando */ }
        vuelta = requestAnimationFrame(mirar);
      };
      mirar();
    } catch {
      d.querySelector('.escaner')?.remove();
      d.querySelector('label[for="codigo"]').textContent = 'Sin acceso a la cámara: escribe los números del código';
    }
  });
}
