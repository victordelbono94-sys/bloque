// Lo común a todas las IA del lado del teléfono: llamar a una función con tope de espera, traducir los errores
// a un mensaje claro (y siempre con el camino manual) y anotar lo que se resolvió sin IA (contador de ahorro).
import { sb, estado } from './db.js';

const MENSAJES = {
  sin_clave: 'La IA no está disponible ahora.',
  limite: 'La IA llegó al límite gratis por ahora (Gemini, Groq y Mistral). Prueba en un rato.',
  gemini: 'Las IA están saturadas en este momento (probé Gemini, Groq y Mistral). Prueba en un rato.',
  apagada: 'Tienes apagada esta función de IA en Perfil → Privacidad.',
  imagen: 'La foto o el archivo es muy pesado o no se pudo leer.',
  texto: 'Escribe qué quieres hacer.',
  sesion: 'Tu sesión se venció: vuelve a entrar a Bloq.',
};

/** Error de una función de IA con su código (err.codigo) y un mensaje para mostrar. */
export async function errorDeIA(error, manual = '') {
  let codigo = null;
  try { codigo = (await error?.context?.json?.())?.error ?? null; } catch { /* sin detalle */ }
  const base = MENSAJES[codigo] ?? 'No se pudo conectar con la IA. Revisa la conexión.';
  const e = new Error(manual ? `${base} ${manual}` : base);
  e.codigo = codigo;
  return e;
}

/** Llama a una función de IA con tope de espera. Lanza un Error con mensaje claro si falla. */
export async function llamarIA(funcion, cuerpo, { espera = 70000, manual = '' } = {}) {
  const tope = new Promise((_, no) => setTimeout(() => no(Object.assign(new Error(`La IA tardó demasiado. Prueba de nuevo.${manual ? ` ${manual}` : ''}`), { codigo: 'tiempo' })), espera));
  const { data, error } = await Promise.race([sb.functions.invoke(funcion, { body: cuerpo }), tope]);
  if (error) throw await errorDeIA(error, manual);
  return data;
}

/** Anota algo que se resolvió sin IA (peso, agua, comida conocida, plato guardado). No frena nada si falla. */
export function anotarSinIA(funcion) {
  if (!estado.yo?.id) return;
  sb.from('uso_ia').insert({ usuario: estado.yo.id, funcion, proveedor: 'local', ok: true })
    .then(({ error }) => { if (error) console.warn('uso_ia:', error.message); }, () => {});
}

/** Si una función de IA está apagada por la persona (Perfil → Privacidad). */
export const iaApagada = (clave) => estado.yo?.ia_funciones?.[clave] === false;
