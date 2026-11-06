// Privacidad, términos de uso y aviso de salud de la IA: los textos, el paso de consentimiento al entrar,
// Perfil → Privacidad (interruptores de IA, uso de IA, documentos) y el recordatorio mensual en los chats de IA.
// Se guarda qué aceptó cada persona y en qué versión (tabla consentimientos). Si cambia la versión, se vuelve a pedir.
import { sb, estado, datos } from './db.js';
import { esc, aviso, avisoError, abrirDialogo } from './ui.js';

export const VERSION_LEGAL = '2026-11-05';
const CLAVE_RECORDATORIO = 'bloque-aviso-ia-visto';

export const AVISO_SALUD = 'El agente de IA de Bloq no reemplaza una dieta ni una consulta con un profesional de la salud. '
  + 'Lo que sugiere o registra es solo orientativo. Tu salud siempre es lo primero. Usa las funciones de IA con responsabilidad.';
export const AVISO_CORTO = 'Orientativo: no reemplaza a un profesional de la salud.';

const MENSAJES = [
  ['Tus datos están cifrados', 'Viajan y se guardan cifrados. Solo tú y tu hogar (según lo que compartas) los ven en la app.'],
  ['Bloq nunca vende tus datos', 'No los vende, no los monetiza y no los comparte más allá de lo necesario para que la app funcione.'],
  ['Sin anuncios, solo donaciones', 'Bloq no tiene publicidad. Se mantiene con donaciones voluntarias, que pagan el servidor y nuevas funciones.'],
];

/** Funciones de IA que se pueden apagar (clave = la que respeta el servidor). */
export const FUNCIONES_IA = [
  ['comida', 'Registrar comida con foto o texto', 'Lee tus fotos y lo que escribes para armar la comida.'],
  ['ideas', 'Ideas y consejos de comida', 'Propone comidas con tu despensa y revisa lo que comes.'],
  ['cuerpo', 'Leer la balanza o el PDF de tu medición', 'Lee fotos o PDFs de bioimpedancia.'],
  ['entrenador', 'Coach de entrenos y Mis objetivos', 'Arma rutinas y cambia tu plan conversando.'],
  ['micros', 'Vitaminas y minerales automáticos', 'Estima las vitaminas de los alimentos nuevos.'],
];

const POLITICA = `
<h3>Qué guarda Bloq</h3>
<p>Tu perfil (nombre, fecha de nacimiento, altura, sexo), peso y composición corporal, comidas, agua, entrenos y series, molestias,
los datos de tu pulsera que llegan por Health Connect (pasos, calorías, sueño, entrenos) solo si lo conectas, la ubicación de tu gym
solo si la guardas, y un registro técnico de errores de la app (sin datos de salud).</p>
<h3>Qué sabe la IA</h3>
<p>Solo lo necesario para cada consulta (la foto o el texto, tu meta, tu dieta, tu peso) y solo si usas esa función. Puedes apagar
cada función de IA en Perfil → Privacidad; el servidor la rechaza si está apagada. Sin IA, todo se puede cargar a mano.</p>
<p>Bloq no entrena modelos de IA. En los planes gratis de Google (Gemini) y Groq, esas empresas <strong>pueden</strong> usar lo que se
les envía para mejorar sus servicios. Bloq guarda qué IA respondió cada consulta, sin el contenido.</p>
<h3>Dónde se guarda y quién lo ve</h3>
<p>En Supabase (servidores en EE. UU.), cifrado al viajar y al guardarse. Lo ve tu hogar según lo que compartas. Como en cualquier
servicio en la nube, el administrador del servidor técnicamente puede acceder a los datos; no lo hace salvo para resolver un problema
que le pidas.</p>
<h3>Qué empresas reciben algo</h3>
<ul><li>Supabase: el servidor y la base de datos.</li><li>Google: si entras con Google o usas la IA (Gemini).</li>
<li>Groq: respaldo de la IA cuando Gemini no responde.</li><li>La app de tu pulsera, vía Health Connect: solo si lo conectas.</li></ul>
<h3>Lo que Bloq nunca hace</h3>
<p>Nunca vende ni monetiza tus datos personales. No tiene publicidad. Se mantiene con donaciones voluntarias.</p>
<h3>Tus derechos</h3>
<p>Puedes ver, corregir, descargar (Perfil → Descargar todo) y borrar tus datos (Perfil → Eliminar mi cuenta) cuando quieras.
Puedes cambiar lo que compartes y lo que usa la IA en Perfil → Privacidad.</p>
<h3>Consentimiento y cambios</h3>
<p>Guardamos qué aceptaste y cuándo. Si este texto cambia, te lo volvemos a mostrar. Versión ${VERSION_LEGAL}.</p>`;

const TERMINOS = `
<h3>No es un servicio médico</h3>
<p>Bloq y su IA son herramientas informativas y orientativas. No reemplazan a un médico, nutricionista, deportólogo, fisioterapeuta,
entrenador certificado ni a ningún profesional de la salud, ni dan diagnósticos o tratamientos.</p>
<h3>Consulta antes de empezar</h3>
<p>Te recomendamos ver a un profesional antes de iniciar o cambiar una dieta o un plan de ejercicio, sobre todo si tienes lesiones,
enfermedades, estás embarazada, tomas medicación o tienes o tuviste un trastorno de la conducta alimentaria.</p>
<h3>Tu responsabilidad</h3>
<p>Tú decides qué haces con la información. Entrenas y comes bajo tu propio riesgo y eres responsable de tu salud y de escuchar a tu
cuerpo (para ante dolor, mareo o malestar). Las metas de peso, calorías y cargas son sugerencias: tú decides cuánto subir y revisas
lo que la IA guarda (se puede editar o borrar).</p>
<h3>Los números pueden fallar</h3>
<p>Calorías, macros, lecturas de fotos, balanzas y pulseras, metas, descansos, ejercicios alternativos y sugerencias de la IA pueden
tener errores.</p>
<h3>Limitación de responsabilidad</h3>
<p>En la máxima medida que permita la ley aplicable, Bloq y sus desarrolladores no son responsables de lesiones, problemas de salud,
muerte, daños o pérdidas derivados del uso de la app o de la IA. La app se ofrece "tal cual", sin garantías: puede tener fallos,
caídas o perder datos, y puede cambiar o dejar de existir.</p>
<h3>Edad mínima</h3>
<p>Para usar Bloq tienes que tener <strong>18 años o más</strong>. Al aceptar estos términos declaras que es así.</p>
<h3>Uso aceptable y donaciones</h3>
<p>No uses la app para fines ilegales ni abuses de la IA. Las donaciones son voluntarias, no compran funciones ni garantías.</p>
<h3>Cambios, ley y contacto</h3>
<p>Si estos términos cambian, te los volvemos a mostrar. Se rigen por las leyes de Ecuador, sin perjuicio de los derechos que te dé la
ley de tu país. Si una cláusula no vale en algún lugar, el resto sigue vigente. Versión ${VERSION_LEGAL}.</p>`;

/** Abre la política, los términos o el aviso de salud. */
export function verDocumento(cual) {
  const t = { privacidad: ['Política de privacidad', POLITICA], terminos: ['Términos de uso', TERMINOS], salud: ['Aviso de salud', `<p>${esc(AVISO_SALUD)}</p>`] }[cual];
  abrirDialogo(`<div class="dialogo legal"><h2 class="tarjeta__titulo">${t[0]}</h2><div class="legal__texto">${t[1]}</div>
    <div class="dialogo__pie"><button type="button" class="boton" data-cerrar>Cerrar</button></div></div>`, t[0]);
}

async function aceptados() {
  try {
    const filas = datos(await sb.from('consentimientos').select('documento, version').eq('persona_id', estado.yo.id));
    return new Set(filas.filter((f) => f.version === VERSION_LEGAL).map((f) => f.documento));
  } catch { return null; } // si la tabla no responde, no se bloquea la app
}

/**
 * Paso de privacidad: se muestra si la persona no aceptó la versión actual. Una pantalla: los tres mensajes,
 * qué guarda Bloq y qué ve la IA, los interruptores de IA y la casilla de términos (con la edad mínima).
 */
export async function pedirConsentimiento() {
  if (!estado.yo?.id) return;
  const ok = await aceptados();
  if (!ok || ['terminos', 'privacidad', 'aviso_salud_ia'].every((d) => ok.has(d))) return;
  return new Promise((listo) => {
    const d = abrirDialogo(`
      <div class="dialogo legal">
        <h2 class="tarjeta__titulo">Tu privacidad en Bloq</h2>
        <div class="legal__mensajes">${MENSAJES.map(([t, x]) => `<div class="legal__msj"><strong>${esc(t)}</strong><span>${esc(x)}</span></div>`).join('')}</div>
        <p class="quieto" style="margin:0"><strong>Qué guarda:</strong> tu perfil, peso, comidas, entrenos, molestias y, si lo conectas, tu pulsera.
          <strong>La IA</strong> solo ve lo necesario para cada consulta, y la puedes apagar por función ahora o después.</p>
        <p class="aviso-salud">${esc(AVISO_SALUD)}</p>
        <details class="legal__ia"><summary>Elegir qué funciones de IA usar</summary>
          ${FUNCIONES_IA.map(([k, t]) => `<label class="aviso-fila"><span>${esc(t)}</span><input type="checkbox" class="interruptor" data-ia="${k}" ${estado.yo.ia_funciones?.[k] === false ? '' : 'checked'}></label>`).join('')}
        </details>
        <label class="legal__acepto"><input type="checkbox" id="lg-acepto">
          <span>Tengo 18 años o más y acepto los <button type="button" class="enlace-boton" data-doc="terminos">términos de uso</button>
          y la <button type="button" class="enlace-boton" data-doc="privacidad">política de privacidad</button>.</span></label>
        <div class="dialogo__pie"><button type="button" class="boton boton--bloque" id="lg-ok" disabled>Continuar</button></div>
      </div>`, 'Privacidad');
    d.descartar = () => {}; // no se cierra sin aceptar (atrás, tocar afuera o deslizar)
    d.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); verDocumento(b.dataset.doc); }));
    const acepto = d.querySelector('#lg-acepto'), boton = d.querySelector('#lg-ok');
    acepto.addEventListener('change', () => { boton.disabled = !acepto.checked; });
    boton.addEventListener('click', async () => {
      boton.disabled = true;
      try {
        const ia = { ...(estado.yo.ia_funciones ?? {}) };
        d.querySelectorAll('[data-ia]').forEach((c) => { if (c.checked) delete ia[c.dataset.ia]; else ia[c.dataset.ia] = false; });
        datos(await sb.from('personas').update({ ia_funciones: ia }).eq('id', estado.yo.id).select('id'));
        estado.yo.ia_funciones = ia;
        datos(await sb.from('consentimientos').insert(['terminos', 'privacidad', 'aviso_salud_ia']
          .map((documento) => ({ persona_id: estado.yo.id, documento, version: VERSION_LEGAL }))).select('id'));
        try { localStorage.setItem(CLAVE_RECORDATORIO, String(Date.now())); } catch { /* sin almacenamiento */ }
        d.close();
        listo();
      } catch (err) { avisoError(err); boton.disabled = false; }
    });
  });
}

/** Recordatorio del aviso de salud para quien usa la IA seguido: una vez al mes, al abrir un chat de IA. */
export function recordarAvisoIA() {
  let ultimo = 0;
  try { ultimo = Number(localStorage.getItem(CLAVE_RECORDATORIO)) || 0; } catch { return; }
  if (Date.now() - ultimo < 30 * 864e5) return;
  try { localStorage.setItem(CLAVE_RECORDATORIO, String(Date.now())); } catch { /* nada */ }
  if (!ultimo) return; // la primera vez ya lo vio al aceptar
  abrirDialogo(`<div class="dialogo legal"><h2 class="tarjeta__titulo">Un recordatorio</h2><p class="aviso-salud">${esc(AVISO_SALUD)}</p>
    <div class="dialogo__pie"><button type="button" class="boton" data-cerrar>Entiendo</button></div></div>`, 'Aviso de salud');
}

/** Perfil → Privacidad. */
export async function dialogoPrivacidad() {
  const yo = estado.yo;
  const desde = new Date(); desde.setDate(1); desde.setHours(0, 0, 0, 0);
  let uso = [];
  try { uso = datos(await sb.from('uso_ia').select('proveedor, ok').eq('usuario', yo.id).gte('creado_en', desde.toISOString())); } catch { /* sin datos */ }
  const conIA = uso.filter((u) => u.ok && u.proveedor !== 'local');
  const porProv = ['gemini', 'groq', 'mistral'].map((p) => [p, conIA.filter((u) => u.proveedor === p).length]).filter(([, n]) => n);
  const sinIA = uso.filter((u) => u.proveedor === 'local').length;
  const d = abrirDialogo(`
    <div class="dialogo legal">
      <h2 class="tarjeta__titulo">Privacidad</h2>
      <div class="legal__mensajes">${MENSAJES.map(([t, x]) => `<div class="legal__msj"><strong>${esc(t)}</strong><span>${esc(x)}</span></div>`).join('')}</div>
      <h3 class="seccion__titulo" style="margin:8px 0 0">Funciones de IA</h3>
      <p class="quieto" style="margin:0">Lo que apagues se carga a mano. El servidor respeta lo que elijas.</p>
      ${FUNCIONES_IA.map(([k, t, x]) => `<label class="aviso-fila"><span><strong>${esc(t)}</strong><small>${esc(x)}</small></span><input type="checkbox" class="interruptor" data-ia="${k}" ${yo.ia_funciones?.[k] === false ? '' : 'checked'}></label>`).join('')}
      <h3 class="seccion__titulo" style="margin:8px 0 0">Tu uso de IA este mes</h3>
      <p class="quieto" style="margin:0">${conIA.length} consulta${conIA.length === 1 ? '' : 's'} con IA${porProv.length ? ` (${porProv.map(([p, n]) => `${p[0].toUpperCase()}${p.slice(1)} ${n}`).join(', ')})` : ''}
        · ${sinIA} resuelta${sinIA === 1 ? '' : 's'} sin IA.</p>
      <p class="quieto" style="margin:0">Empresas que reciben datos hoy: Supabase (servidor)${conIA.length || FUNCIONES_IA.some(([k]) => yo.ia_funciones?.[k] !== false) ? ', Google y Groq (IA)' : ''}.</p>
      <p class="aviso-salud">${esc(AVISO_SALUD)}</p>
      <div class="pila" style="gap:6px">
        <button type="button" class="enlace-boton" data-doc="privacidad">Leer la política de privacidad</button>
        <button type="button" class="enlace-boton" data-doc="terminos">Leer los términos de uso</button>
      </div>
      <div class="dialogo__pie"><button type="button" class="boton" data-cerrar>Listo</button></div>
    </div>`, 'Privacidad');
  d.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', () => verDocumento(b.dataset.doc)));
  d.querySelectorAll('[data-ia]').forEach((c) => c.addEventListener('change', async () => {
    const ia = { ...(yo.ia_funciones ?? {}) };
    if (c.checked) delete ia[c.dataset.ia]; else ia[c.dataset.ia] = false;
    try {
      datos(await sb.from('personas').update({ ia_funciones: ia }).eq('id', yo.id).select('id'));
      yo.ia_funciones = ia;
      aviso(c.checked ? 'Función de IA encendida.' : 'Función de IA apagada: se carga a mano.');
    } catch (err) { avisoError(err); c.checked = !c.checked; }
  }));
}
