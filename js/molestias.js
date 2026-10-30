// Molestias o lesiones: marcas una zona que duele y la app cuida esa zona en los entrenos
// (avisa en los ejercicios que la cargan, la IA adapta la rutina) y propone ejercicios suaves de recuperación.
import { IC } from './iconos.js';
import { sb, estado, datos } from './db.js';
import { esc, aviso, avisoError, abrirDialogo, grupoChips, valorChips } from './ui.js';
import { hoyISO } from './fechas.js';

export const ZONAS = {
  rodilla: {
    nombre: 'Rodilla',
    carga: /sentadilla|prensa|extensi[oó]n de cu[aá]driceps|zancada|b[uú]lgara|salto|pliom|step|hack|lunge/i,
    grupos: /cu[aá]driceps|piernas/i,
    suaves: [
      ['Isométrico de cuádriceps', 'Sentado con la pierna estirada y una toalla bajo la rodilla: aprieta la rodilla contra la toalla 5 s. 3 × 10.'],
      ['Elevación de pierna recta', 'Acostado, una pierna doblada; sube la otra estirada hasta la altura de la rodilla contraria. 3 × 10.'],
      ['Puente de glúteo', 'Boca arriba, rodillas dobladas; sube la cadera apretando glúteos, 2 s arriba. 3 × 12.'],
    ],
  },
  hombro: {
    nombre: 'Hombro',
    carga: /press|fondos|dominadas|elevaciones laterales|militar|aperturas|pec deck|cruce|pullover|jal[oó]n/i,
    grupos: /hombro|pecho/i,
    suaves: [
      ['Péndulo', 'Inclinado apoyado en una mesa, deja colgar el brazo y haz círculos pequeños y relajados. 2 × 30 s.'],
      ['Rotación externa con banda', 'Codo pegado al cuerpo a 90°, lleva la mano hacia afuera contra una banda suave. 3 × 12.'],
      ['Retracción escapular', 'Junta los omóplatos hacia atrás y abajo, 3 s, y suelta. 3 × 10.'],
    ],
  },
  espalda_baja: {
    nombre: 'Espalda baja',
    carga: /peso muerto|buenos d[ií]as|sentadilla|remo con barra|lumbar|hiperextensi|superman|hip thrust con barra/i,
    grupos: /lumbar/i,
    suaves: [
      ['Gato-vaca', 'En cuatro apoyos, arquea y redondea la espalda despacio, sin forzar. 2 × 10.'],
      ['Bird dog', 'En cuatro apoyos, estira brazo y pierna contrarios sin mover la cadera, 3 s. 3 × 8 por lado.'],
      ['Rodillas al pecho', 'Acostado, abraza las rodillas y balancea suave. 2 × 30 s.'],
    ],
  },
  muneca: {
    nombre: 'Muñeca',
    carga: /curl de mu[nñ]eca|press|flexiones|plancha|fondos|agarre|granjero/i,
    grupos: /antebrazo|agarre/i,
    suaves: [
      ['Círculos de muñeca', 'Despacio, hacia un lado y al otro, sin dolor. 2 × 10.'],
      ['Flexión y extensión suave', 'Antebrazo apoyado en una mesa, mano afuera: sube y baja la mano sin peso. 2 × 15.'],
      ['Apretar una pelota blanda', 'Aprieta 3 s y suelta. 3 × 10.'],
    ],
  },
  tobillo: {
    nombre: 'Tobillo',
    carga: /salto|pliom|pantorrilla|zancada|b[uú]lgara|step|equilibrio/i,
    grupos: /pantorrilla/i,
    suaves: [
      ['Alfabeto con el pie', 'Sentado, dibuja las letras del abecedario con la punta del pie. 1 vez por pie.'],
      ['Elevación de talones sentado', 'Sentado, sube y baja los talones despacio. 3 × 15.'],
      ['Equilibrio apoyado', 'De pie junto a la pared, sostente en el pie afectado si no duele. 3 × 20 s.'],
    ],
  },
  codo: {
    nombre: 'Codo',
    carga: /curl|tr[ií]ceps|fondos|press|dominadas|extensi[oó]n de tr/i,
    grupos: /b[ií]ceps|tr[ií]ceps|antebrazo/i,
    suaves: [
      ['Estiramiento de antebrazo', 'Brazo estirado al frente, con la otra mano lleva los dedos hacia ti, y al revés. 3 × 20 s.'],
      ['Extensión de muñeca lenta', 'Con una botella de agua, baja la mano despacio en 3 s. 3 × 10.'],
    ],
  },
  cuello: {
    nombre: 'Cuello',
    carga: /encogimientos|militar|press de hombros|face pull|granjero/i,
    grupos: /trapecio/i,
    suaves: [
      ['Retracción de mentón', 'Lleva el mentón hacia atrás (doble mentón), 3 s. 2 × 10.'],
      ['Inclinación lateral suave', 'Oreja al hombro sin forzar, 20 s por lado.'],
    ],
  },
  cadera: {
    nombre: 'Cadera / ingle',
    carga: /aductor|abductor|zancada|b[uú]lgara|sentadilla|hip thrust|empuje de cadera|patada/i,
    grupos: /aductor|gl[uú]teo/i,
    suaves: [
      ['Almeja (clamshell)', 'Acostado de lado, rodillas dobladas: abre la rodilla de arriba sin mover la cadera. 3 × 12.'],
      ['Puente de glúteo', 'Boca arriba, sube la cadera apretando glúteos, 2 s arriba. 3 × 12.'],
      ['Flexor de cadera suave', 'Rodilla atrás en el piso, lleva la cadera adelante sin dolor. 30 s por lado.'],
    ],
  },
};
const INTENSIDAD = { 1: 'Leve', 2: 'Molesta', 3: 'Duele' };

export async function cargarMolestias(personaId = estado.yo.id) {
  try {
    return datos(await sb.from('molestias').select('*').eq('persona_id', personaId).is('hasta', null).order('creada_en', { ascending: false }));
  } catch { return []; }
}

/** ¿Este ejercicio carga una zona con molestia? Devuelve la molestia (la más intensa) o null. */
export function molestiaDe(ejercicio, molestias) {
  let peor = null;
  for (const m of molestias ?? []) {
    const z = ZONAS[m.zona];
    if (!z) continue;
    if (z.carga.test(ejercicio?.nombre ?? '') || z.grupos.test(ejercicio?.grupo_muscular ?? '')) {
      if (!peor || m.intensidad > peor.intensidad) peor = m;
    }
  }
  return peor;
}

export const nombreZona = (z) => ZONAS[z]?.nombre ?? z;
export const textoIntensidad = (n) => INTENSIDAD[n] ?? '';

export function dialogoMolestia(alGuardar = () => {}) {
  const d = abrirDialogo(`
    <form class="dialogo" novalidate>
      <h2 class="tarjeta__titulo">¿Dónde te molesta?</h2>
      <div class="chips" id="m-zona">${Object.entries(ZONAS).map(([k, z]) => `<button type="button" class="chip" data-valor="${k}">${esc(z.nombre)}</button>`).join('')}</div>
      <fieldset class="campo"><legend>¿Cuánto?</legend>
        <div class="chips" id="m-int">${Object.entries(INTENSIDAD).map(([k, t]) => `<button type="button" class="chip" data-valor="${k}" aria-pressed="${k === '2'}">${t}</button>`).join('')}</div>
      </fieldset>
      <div class="campo"><label for="m-nota">Nota (opcional)</label><input id="m-nota" maxlength="200" placeholder="Ej.: me caí en el derby, duele al flexionar"></div>
      <p class="ayuda" style="margin:0">Mientras dure, Bloq te avisa en los ejercicios que cargan esa zona y la IA puede adaptar la rutina. Si el dolor es fuerte, punzante, hay hinchazón o no mejora en 1–2 semanas, consulta a un fisioterapeuta o médico.</p>
      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
        <button type="submit" class="boton">Guardar</button>
      </div>
    </form>`, 'Molestia');
  grupoChips(d.querySelector('#m-zona'));
  grupoChips(d.querySelector('#m-int'));
  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const zona = valorChips(d.querySelector('#m-zona'));
    if (!zona) return aviso('Elige la zona.', 'error');
    try {
      datos(await sb.from('molestias').insert({
        persona_id: estado.yo.id, zona, intensidad: Number(valorChips(d.querySelector('#m-int')) ?? 2),
        nota: d.querySelector('#m-nota').value.trim() || null, desde: hoyISO(),
      }).select('id'));
      d.close();
      aviso(`Anotado: cuidaremos tu ${nombreZona(zona).toLowerCase()}.`);
      alGuardar();
    } catch (err) { avisoError(err); }
  });
}

export async function terminarMolestia(id) {
  datos(await sb.from('molestias').update({ hasta: hoyISO() }).eq('id', id).select('id'));
}

/** Tarjeta con las molestias activas: días, ejercicios suaves y «Ya estoy bien». */
export function htmlMolestias(lista, { propio = true, agregar = true } = {}) {
  if (!lista.length) return propio && agregar ? '<button type="button" class="enlace-boton molestia-agregar" id="molestia-nueva">+ Tengo una molestia o lesión</button>' : '';
  return `<section class="molestias">${lista.map((m) => {
    const z = ZONAS[m.zona];
    const dias = Math.max(0, Math.round((new Date(`${hoyISO()}T12:00`) - new Date(`${m.desde}T12:00`)) / 864e5));
    return `<article class="molestia molestia--${m.intensidad}">
      <div class="molestia__cabeza"><span class="molestia__icono" aria-hidden="true">${IC.curita}</span>
        <span><strong>${esc(z?.nombre ?? m.zona)} · ${esc(INTENSIDAD[m.intensidad] ?? '')}</strong><span class="quieto">${dias ? `hace ${dias} día${dias === 1 ? '' : 's'}` : 'desde hoy'}${m.nota ? ` · ${esc(m.nota)}` : ''}</span></span></div>
      ${dias >= 14 ? '<p class="ayuda molestia__fisio">Lleva más de 2 semanas: conviene que la vea un fisioterapeuta.</p>' : ''}
      ${z?.suaves?.length ? `<details class="molestia__suaves"><summary>Ejercicios suaves para recuperar</summary><ul>${z.suaves.map(([n, t]) => `<li><strong>${esc(n)}</strong> ${esc(t)}</li>`).join('')}</ul><p class="ayuda" style="margin:6px 0 0">Siempre sin dolor. Si alguno duele, déjalo.</p></details>` : ''}
      ${propio ? `<button type="button" class="boton boton--sec boton--chico" data-molestia-fin="${esc(m.id)}">Ya estoy bien</button>` : ''}
    </article>`;
  }).join('')}${propio && agregar ? '<button type="button" class="enlace-boton molestia-agregar" id="molestia-nueva">+ Otra molestia</button>' : ''}</section>`;
}

export function conectarMolestias(cont, alCambiar) {
  cont.querySelector('#molestia-nueva')?.addEventListener('click', () => dialogoMolestia(alCambiar));
  cont.querySelectorAll('[data-molestia-fin]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await terminarMolestia(b.dataset.molestiaFin); aviso('¡Bien! Vuelves a la rutina normal.'); alCambiar(); } catch (e) { avisoError(e); b.disabled = false; }
  }));
}
