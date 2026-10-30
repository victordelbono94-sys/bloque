// Cliente de Supabase y estado compartido de la sesión.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_CLAVE_PUBLICA } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_CLAVE_PUBLICA, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// Estado de la sesión: quién soy, mi equipo y sus personas. (En la base, el equipo es la tabla «hogares».)
export const estado = {
  usuario: null,   // auth.users
  yo: null,        // fila de personas
  personas: [],    // personas del equipo, yo primero
  equipo: null,    // fila de hogares: nombre, codigo, admin_id, personal, deporte
};

export function otraPersona() {
  return estado.personas.find((p) => p.id !== estado.yo?.id) ?? null;
}

export function nombrePersona(id) {
  return estado.personas.find((p) => p.id === id)?.nombre ?? '';
}

// Lanza el error de Supabase para que lo maneje quien llama.
export function datos({ data, error }) {
  if (error) throw error;
  return data;
}

export async function cargarPersonas() {
  const { data: { user } } = await sb.auth.getUser();
  estado.usuario = user;
  if (!user) return;

  const yo = datos(await sb.from('personas').select('*').eq('id', user.id).maybeSingle());
  estado.yo = yo;
  if (!yo) { estado.personas = []; estado.equipo = null; return; }
  const [todas, equipo] = await Promise.all([
    sb.from('personas').select('*').eq('hogar_id', yo.hogar_id).order('nombre').then(datos),
    sb.from('hogares').select('*').eq('id', yo.hogar_id).maybeSingle().then(datos),
  ]);
  estado.equipo = equipo;
  estado.personas = [yo, ...todas.filter((p) => p.id !== yo.id)];
}

/** Al crear la cuenta (una sola vez): la foto de Google como foto de perfil. */
export async function fotoInicialDeGoogle() {
  const m = estado.usuario?.user_metadata ?? {};
  const url = m.avatar_url ?? m.picture;
  if (!estado.yo || estado.yo.avatar_url || !url?.startsWith('https://')) return;
  const { error } = await sb.from('personas').update({ avatar_url: url }).eq('id', estado.yo.id);
  if (!error) estado.yo.avatar_url = url;
}

/**
 * ¿Ya te despertaste hoy? Si el reloj sincronizó el sueño de esta noche, el día de la app pasa a hoy
 * (antes de eso, lo que comes de madrugada sigue contando para ayer). Devuelve true si el día cambió.
 */
export async function revisarDespertar() {
  if (!estado.yo) return false;
  const { hoyISO, calendarioISO, sumarDias } = await import('./fechas.js');
  const antes = hoyISO();
  const hoyCal = calendarioISO();
  try {
    const { data } = await sb.from('actividad_diaria').select('fecha, sueno_min').eq('persona_id', estado.yo.id)
      .gte('fecha', sumarDias(hoyCal, -7)).not('sueno_min', 'is', null);
    const usaReloj = (data ?? []).some((d) => Number(d.sueno_min) > 0);
    const desperto = (data ?? []).some((d) => d.fecha === hoyCal && Number(d.sueno_min) > 0);
    localStorage.setItem('bloque-reloj-sueno', usaReloj ? '1' : '0');
    if (desperto) localStorage.setItem('bloque-desperto', hoyCal);
  } catch { /* sin conexión: se queda con lo que sabía */ }
  return hoyISO() !== antes;
}
