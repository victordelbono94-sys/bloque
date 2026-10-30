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

// ---------- Gimnasio y avisos (app 1.0.N con avisos) ----------
export const soportaAvisos = !!puente?.configurarAvisos;
export const configurarAvisos = (c) => puente?.configurarAvisos?.(JSON.stringify(c));
export const pedirNotificaciones = () => puente?.pedirNotificaciones?.();
export const pedirUbicacion = () => puente?.pedirUbicacion?.();
export const abrirAjustesApp = () => puente?.abrirAjustesApp?.();
// Descanso entre series con la app en segundo plano (app 1.0.114+): avisos a los 10 s, 5 s y al terminar.
export const programarDescansoNativo = (finMs, titulo) => { try { puente?.programarDescanso?.(finMs, titulo); } catch { /* app vieja */ } };
export const cancelarDescansoNativo = () => { try { puente?.cancelarDescanso?.(); } catch { /* app vieja */ } };

/** Ubicación actual: en la app la da Android; en el navegador, la web. */
export function ubicacionActual() {
  return new Promise((resolver, rechazar) => {
    if (puente?.ubicacionActual) {
      const quitar = alEventoNativo('ubicacion', (u) => {
        quitar();
        if (u?.lat != null) resolver(u);
        else rechazar(new Error(u?.error === 'permiso' ? 'Falta el permiso de ubicación.' : 'No se pudo obtener la ubicación.'));
      });
      puente.ubicacionActual();
      return;
    }
    if (!navigator.geolocation) return rechazar(new Error('Este navegador no da la ubicación.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolver({ lat: p.coords.latitude, lng: p.coords.longitude, precision: Math.round(p.coords.accuracy) }),
      () => rechazar(new Error('No se pudo obtener la ubicación. Revisa el permiso.')),
      { enableHighAccuracy: true, timeout: 20000 },
    );
  });
}

/**
 * Le pasa a la app los próximos gyms de esta persona y el lugar del gimnasio, para
 * que avise al llegar, a la hora o cuando el reloj registre el entreno.
 */
export async function sincronizarAgenda() {
  if (!puente?.programarAgenda || !estado.yo) return;
  const hoy = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hasta = new Date(hoy); hasta.setDate(hasta.getDate() + 14);
  const [eventos, lugares] = await Promise.all([
    sb.from('calendario').select('id, fecha, hora_inicio, tipo, asistencia, persona_id, rutina_id')
      .eq('hogar_id', estado.yo.hogar_id).eq('tipo', 'gym').gte('fecha', iso(hoy)).lte('fecha', iso(hasta)).then(datos),
    sb.from('lugares').select('nombre, lat, lng, radio_m').eq('hogar_id', estado.yo.hogar_id).eq('tipo', 'gimnasio').limit(1).then(datos),
  ]);
  const mios = eventos.filter((e) => e.asistencia === 'juntos' || e.persona_id === estado.yo.id);
  const rutinaIds = [...new Set(mios.map((e) => e.rutina_id).filter(Boolean))];
  const [rutinas, sesiones] = await Promise.all([
    rutinaIds.length ? sb.from('rutinas').select('id, nombre').in('id', rutinaIds).then(datos) : [],
    mios.length ? sb.from('sesiones').select('calendario_id').in('calendario_id', mios.map((e) => e.id)).then(datos) : [],
  ]);
  const agenda = mios.map((e) => ({
    id: e.id,
    fecha: e.fecha,
    hora: e.hora_inicio ? e.hora_inicio.slice(0, 5) : null,
    titulo: rutinas.find((r) => r.id === e.rutina_id)?.nombre ?? 'Gym',
    empezada: sesiones.some((s) => s.calendario_id === e.id),
  }));
  const l = lugares[0];
  puente.programarAgenda(JSON.stringify({
    agenda,
    lugar: l ? { nombre: l.nombre, lat: l.lat, lng: l.lng, radio: l.radio_m } : null,
  }));
}
