// Cliente de Supabase y estado compartido de la sesión.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_CLAVE_PUBLICA } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_CLAVE_PUBLICA, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// Estado de la sesión: quién soy, mi hogar y las personas del hogar.
export const estado = {
  usuario: null,   // auth.users
  yo: null,        // fila de personas
  personas: [],    // personas del hogar, yo primero
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
  if (!yo) { estado.personas = []; return; }

  const todas = datos(await sb.from('personas').select('*').eq('hogar_id', yo.hogar_id).order('nombre'));
  estado.personas = [yo, ...todas.filter((p) => p.id !== yo.id)];
}
