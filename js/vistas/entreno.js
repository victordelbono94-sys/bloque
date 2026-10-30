// Detalle de una rutina: ejercicios, mapa del cuerpo y metas de cada uno.
// La lista (semana + rutinas) vive en Entrenos (semana.js).
import { IC } from '../iconos.js';
import { sb, estado, datos } from '../db.js';
import { esc, aviso, avisoError, abrirDialogo } from '../ui.js';
import { FOCOS, cargarRutina, textoMeta, textoDescanso } from '../rutinas.js';
import { mapaCuerpo, chipsZonas, zonasDe } from '../iconos.js';
import { abrirFicha, miniatura } from '../ficha.js';
import { vistaSemana } from './semana.js';
import { abrirEntrenador, sobraCuadriceps } from '../entrenador.js';
import { deporte } from '../deportes.js';
import { mejorSerie } from '../logros.js';

export async function vistaEntreno(app) {
  const id = location.hash.split('/')[2];
  if (id) return detalle(app, id);
  return vistaSemana(app);
}

async function detalle(app, rutinaId) {
  const { rutina, items } = await cargarRutina(rutinaId);
  const personas = estado.personas;
  const zonas = zonasDe(items.map((it) => it.ejercicio.grupo_muscular));
  // Tu mejor marca en cada ejercicio (la serie con más fuerza estimada).
  const ejIds = items.map((it) => it.ejercicio.id);
  const historial = ejIds.length ? datos(await sb.from('series').select('ejercicio_id, reps, peso_kg, hecha_en').eq('persona_id', estado.yo.id)
    .in('ejercicio_id', ejIds).not('peso_kg', 'is', null).order('hecha_en', { ascending: false }).limit(600)) : [];
  const mejor = Object.fromEntries(ejIds.map((id) => [id, mejorSerie(historial.filter((x) => x.ejercicio_id === id))]));

  app.innerHTML = `
    <header class="encabezado encabezado--fijo">
      <div>
        <a href="#/semana" class="boton boton--texto" style="padding:0;min-height:32px">‹ Entrenos</a>
        <h1 class="titulo">${esc(rutina.nombre)}</h1>
        <p class="subtitulo">${esc(FOCOS[rutina.foco] ?? '')}${rutina.notas ? ` · ${esc(rutina.notas)}` : ''}</p>
      </div>
      <button type="button" class="boton boton--ia boton--chico" id="ajustar-ia">✦ Ajustar con IA</button>
    </header>
    ${sobraCuadriceps(items) ? `
      <section class="tarjeta aviso-deporte">
        <p style="margin:0"><strong>El ${esc(deporte(estado.equipo?.deporte)?.nombre.toLowerCase() ?? 'deporte')} ya carga mucho los cuádriceps.</strong> Esta rutina suma más. ¿La enfoco en glúteos y femorales para no llegar fundidos?</p>
        <button type="button" class="boton boton--ia boton--chico" id="ajustar-deporte" style="margin-top:10px">✦ Ajustarla para mi deporte</button>
      </section>` : ''}
    ${zonas.length ? `
      <section class="tarjeta rutina-mapa">
        ${mapaCuerpo(zonas, { alto: 110 })}
        <div>
          <p class="seccion__titulo" style="margin:0 0 8px">Qué trabajas</p>
          ${chipsZonas(zonas, 6)}
          <p class="quieto" style="margin:10px 0 0">${items.length} ejercicios</p>
        </div>
      </section>` : ''}
    <div class="pila">
      ${items.map((it, i) => `
        <article class="tarjeta">
          <button type="button" class="ejercicio__cabeza" data-ficha="${esc(it.id)}" aria-label="Cómo se hace ${esc(it.ejercicio.nombre)}">
            ${miniatura(it.ejercicio, 64)}
            <span style="min-width:0;flex:1">
              <span class="fila" style="gap:8px;align-items:baseline">
                <span class="numero-ejercicio">${i + 1}</span>
                <span class="ejercicio__nombre">${esc(it.ejercicio.nombre)}</span>
              </span>
              <span class="quieto" style="display:block;margin:4px 0 0">${esc(it.ejercicio.grupo_muscular)}${it.ejercicio.maquina ? ` · ${esc(it.ejercicio.maquina.nombre)}` : ''}</span>
              ${mejor[it.ejercicio.id] ? `<span class="mejor-marca">${IC.trofeo} Tu mejor: ${Number(mejor[it.ejercicio.id].peso_kg).toLocaleString('es-EC')} kg × ${mejor[it.ejercicio.id].reps}</span>` : ''}
              <span class="ejercicio__como">Cómo se hace ›</span>
            </span>
          </button>
          <div class="pila" style="gap:6px;margin-top:12px">
            ${personas.map((p) => {
              const m = it.metas[p.id];
              return `
                <div class="meta-fila">
                  <span class="meta-fila__nombre">${esc(p.id === estado.yo.id ? 'Yo' : p.nombre)}</span>
                  <span class="meta-fila__valor">${esc(textoMeta(m, it.ejercicio.unidad))}${m && m.peso_kg == null && it.ejercicio.unidad === 'reps' ? ' · peso a definir' : ''}</span>
                  ${m ? `<button type="button" class="boton boton--texto boton--chico" data-meta="${esc(m.id)}" aria-label="Editar meta de ${esc(p.nombre)} en ${esc(it.ejercicio.nombre)}">Editar</button>` : ''}
                </div>`;
            }).join('')}
          </div>
          ${it.alternativas.length ? `<p class="ayuda" style="margin-top:10px">Si está ocupada: ${it.alternativas.map((a) => esc(a.nombre)).join(' · ')} (en «Cómo se hace» ves cada una)</p>` : ''}
        </article>`).join('')}
    </div>
    <p class="ayuda" style="margin-top:16px">Las metas sin peso se completan solas con lo que registren en el primer entreno. Después se ajustan según cómo les vaya.</p>`;

  const recargar = () => detalle(app, rutinaId);
  app.querySelector('#ajustar-ia').addEventListener('click', () => abrirEntrenador({ rutinaId, alAplicar: recargar }));
  app.querySelector('#ajustar-deporte')?.addEventListener('click', () => abrirEntrenador({
    rutinaId, alAplicar: recargar,
    mensaje: `Ajusta esta rutina para ${deporte(estado.equipo?.deporte)?.nombre.toLowerCase() ?? 'mi deporte'}: menos cuádriceps, más glúteos y femorales.`,
  }));
  app.querySelectorAll('[data-ficha]').forEach((b) => b.addEventListener('click', () => {
    const it = items.find((x) => x.id === b.dataset.ficha);
    abrirFicha(it.ejercicio, { alternativas: it.alternativas });
  }));
  app.querySelectorAll('[data-meta]').forEach((b) => b.addEventListener('click', () => {
    const it = items.find((x) => Object.values(x.metas).some((m) => m.id === b.dataset.meta));
    const meta = Object.values(it.metas).find((m) => m.id === b.dataset.meta);
    editarMeta(meta, it, () => detalle(app, rutinaId));
  }));
}

function editarMeta(meta, it, alGuardar) {
  const segundos = it.ejercicio.unidad === 'segundos';
  const persona = estado.personas.find((p) => p.id === meta.persona_id);
  const d = abrirDialogo(`
    <form class="dialogo" novalidate>
      <h2 class="tarjeta__titulo">${esc(it.ejercicio.nombre)}</h2>
      <p class="quieto" style="margin:-8px 0 0">Meta de ${esc(persona?.nombre ?? '')}</p>
      <div class="grilla-2">
        <div class="campo"><label for="series">Series</label><input id="series" type="number" inputmode="numeric" min="1" max="10" value="${meta.series}"></div>
        <div class="campo"><label for="reps">${segundos ? 'Segundos' : 'Repeticiones'}</label><input id="reps" type="number" inputmode="numeric" min="1" max="${segundos ? 300 : 50}" value="${meta.reps}"></div>
        <div class="campo"><label for="peso">Peso (kg)</label><input id="peso" type="number" inputmode="decimal" min="0" max="500" step="0.5" placeholder="${segundos ? 'Opcional' : 'A definir'}" value="${meta.peso_kg ?? ''}"></div>
        <div class="campo"><label for="descanso">Descanso (s)</label><input id="descanso" type="number" inputmode="numeric" min="0" max="600" step="15" value="${meta.descanso_seg ?? ''}"></div>
      </div>
      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
        <button type="submit" class="boton" id="guardar">Guardar</button>
      </div>
    </form>`, 'Editar meta');

  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const leer = (id) => d.querySelector(`#${id}`).value;
    const series = Number(leer('series')), reps = Number(leer('reps'));
    if (!(series >= 1 && series <= 10)) return aviso('Series: entre 1 y 10.', 'error');
    if (!(reps >= 1 && reps <= (segundos ? 300 : 50))) return aviso('Revisa las repeticiones.', 'error');
    const peso = leer('peso') === '' ? null : Number(leer('peso'));
    if (peso != null && !(peso >= 0 && peso <= 500)) return aviso('Revisa el peso.', 'error');
    const descanso = leer('descanso') === '' ? null : Number(leer('descanso'));
    const boton = d.querySelector('#guardar');
    boton.disabled = true;
    try {
      datos(await sb.from('metas_ejercicio').update({ series, reps, peso_kg: peso, descanso_seg: descanso }).eq('id', meta.id));
      d.close();
      aviso(`Meta actualizada · descanso ${textoDescanso(descanso)}.`);
      alGuardar();
    } catch (err) {
      avisoError(err);
      boton.disabled = false;
    }
  });
}

