// Puente con la app Android de Bloque. Dentro de la app existe window.BloqueNativo;
// en el navegador no, y todo esto queda inactivo.
import { sb, estado, datos } from './db.js';

const puente = window.BloqueNativo ?? null;
export const enApp = !!puente;
export const APK = 'https://github.com/victordelbono94-sys/bloque/releases/download/app/bloque.apk';
export const REGRESO_LOGIN = 'ec.bloque.puente://auth';

// La app avisa con window.bloqueNativoEvento(tipo, datos); se reparte como evento del documento.
window.bloqueNativoEvento = (tipo, datosEvento) => {
  document.dispatchEvent(new CustomEvent('bloque-nativo', { detail: { tipo, datos: datosEvento } }));
};

export function alEventoNativo(tipo, fn) {
  const manejador = (e) => { if (e.detail.tipo === tipo) fn(e.detail.datos); };
  document.addEventListener('bloque-nativo', manejador);
  return () => document.removeEventListener('bloque-nativo', manejador);
}

export function estadoNativo() {
  if (!puente) return null;
  try { return JSON.parse(puente.estado()); } catch { return null; }
}

export const pedirPermisos = () => puente?.pedirPermisos();
export const sincronizarAhora = () => puente?.sincronizar();
export const abrirExterno = (url) => (puente ? puente.abrirExterno(url) : window.open(url, '_blank', 'noopener'));
export const desvincular = () => puente?.desvincular();
export const buscarActualizacion = () => puente?.buscarActualizacion?.();

export function guardarArchivo(nombre, contenido, tipo) {
  if (!puente) return false;
  puente.guardarArchivo(nombre, contenido, tipo);
  return true;
}

// Login con Google: Google no deja iniciar sesión dentro de la app, así que se abre
// en Chrome y vuelve a la app con la sesión.
export async function loginEnApp() {
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: REGRESO_LOGIN, skipBrowserRedirect: true },
  });
  if (error) throw error;
  puente.abrirLogin(data.url);
}

// Conecta este teléfono con la cuenta que inició sesión (una sola vez por cuenta).
// Crea un código, guarda en Bloque solo su hash y le da el código a la app.
export async function asegurarVinculo() {
  if (!puente || !estado.yo) return;
  const e = estadoNativo();
  if (!e) return;
  if (!e.vinculado || e.personaId !== estado.yo.id) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const codigo = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codigo)))]
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    const modelo = /Android[^;]*;\s*([^;)]+)/.exec(navigator.userAgent)?.[1]?.trim();
    datos(await sb.from('dispositivos').insert({
      persona_id: estado.yo.id,
      token_hash: hash,
      nombre: modelo && modelo !== 'K' ? modelo : 'Mi teléfono',
    }));
    puente.vincular(codigo, estado.yo.id);
  }
  // La primera vez se piden los permisos de Health Connect solos; después, desde Perfil.
  const clave = `bloque-permisos-pedidos-${estado.yo.id}`;
  let yaPedidos = false;
  try { yaPedidos = localStorage.getItem(clave) === '1'; } catch { /* sin almacenamiento */ }
  if (e.hcDisponible && !e.permisosLectura && !yaPedidos) {
    try { localStorage.setItem(clave, '1'); } catch { /* sin almacenamiento */ }
    setTimeout(() => puente.pedirPermisos(), 800);
  }
}
