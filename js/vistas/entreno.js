// Pantalla Entreno: las rutinas del hogar y las metas de cada uno.
import { sb, estado, datos } from '../db.js';
import { esc, aviso, avisoError, abrirDialogo } from '../ui.js';
import { hoyISO, diaCorto, numeroDia } from '../fechas.js';
import { FOCOS, cargarRutina, textoMeta, textoDescanso, resumenRutinas } from '../rutinas.js';
import { mapaCuerpo, chipsZonas, zonasDe } from '../iconos.js';
import { abrirFicha, miniatura } from '../ficha.js';

export async function vistaEntreno(app) {
  const id = location.hash.split('/')[2];
  if (id) return detalle(app, id);
  return lista(app);
}

async function lista(app) {
  const hogar = estado.yo.hogar_id;
  const hoy = hoyISO();
  const [rutinas, proximos] = await Promise.all([
    sb.from('rutinas').select('*').eq('hogar_id', hogar).order('creada_en').then(datos),
    sb.from('calendario').select('fecha, rutina_id, asistencia, persona_id').eq('hogar_id', hogar)
      .gte('fecha', hoy).not('rutina_id', 'is', null).order('fecha').then(datos),
  ]);
  const resumen = await resumenRutinas(rutinas.map((r) => r.id));
  // La de hoy va primero y resaltada.
  const deHoy = new Set(proximos.filter((p) => p.fecha === hoy).map((p) => p.rutina_id));
  rutinas.sort((a, b) => deHoy.has(b.id) - deHoy.has(a.id));

  app.innerHTML = `
    <header class="encabezado">
      <div>
        <h1 class="titulo">Entreno</h1>
        <p class="subtitulo">Rutinas de la semana</p>
      </div>
    </header>
    <div class="pila">
      ${rutinas.map((r) => {
        const { cuantos = 0, zonas = [] } = resumen[r.id] ?? {};
        const esHoy = deHoy.has(r.id);
        const prox = proximos.find((p) => p.rutina_id === r.id && p.fecha > hoy);
        return `
          <a class="tarjeta tarjeta--enlace rutina-tarjeta ${esHoy ? 'rutina-tarjeta--hoy' : ''}" href="#/entreno/${esc(r.id)}">
            <div class="rutina-tarjeta__texto">
              ${esHoy ? '<span class="sello-hoy"><span class="sello-hoy__punto" aria-hidden="true"></span>Hoy toca</span>' : ''}
              <h2 class="tarjeta__titulo">${esc(r.nombre)}</h2>
              <p class="quieto" style="margin:4px 0 0">${esc(FOCOS[r.foco] ?? '')} · ${cuantos} ejercicios</p>
              ${zonas.length ? chipsZonas(zonas) : ''}
              ${!esHoy && prox ? `<p class="quieto rutina-tarjeta__prox">Próxima: ${esc(diaCorto(prox.fecha))} ${numeroDia(prox.fecha)}</p>` : ''}
            </div>
            ${zonas.length ? mapaCuerpo(zonas, { alto: esHoy ? 96 : 76 }) : ''}
          </a>`;
      }).join('') || '<p class="vacio">Todavía no hay rutinas.</p>'}
    </div>`;
}

async function detalle(app, rutinaId) {
  const { rutina, items } = await cargarRutina(rutinaId);
  const personas = estado.personas;
  const zonas = zonasDe(items.map((it) => it.ejercicio.grupo_muscular));

  app.innerHTML = `
    <header class="encabezado">
      <div>
        <a href="#/entreno" class="boton boton--texto" style="padding:0;min-height:32px">‹ Rutinas</a>
        <h1 class="titulo">${esc(rutina.nombre)}</h1>
        <p class="subtitulo">${esc(FOCOS[rutina.foco] ?? '')}${rutina.notas ? ` · ${esc(rutina.notas)}` : ''}</p>
      </div>
    </header>
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

