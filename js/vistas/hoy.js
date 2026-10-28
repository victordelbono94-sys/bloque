// Pantalla Hoy: qué toca, cómo está cada uno y su última medición.
import { sb, estado, datos } from '../db.js';
import { esc, num, aviso, avisoError, grupoChips, valorChips } from '../ui.js';
import { hoyISO, sumarDias, diaLargo, diaCorto, numeroDia, fechaCorta } from '../fechas.js';
import { htmlEvento } from '../eventos.js';

const SEMAFORO = {
  verde: 'Entrenar normal',
  ambar: 'Bajar intensidad',
  rojo: 'Descansar',
};

export async function vistaHoy(app) {
  const hoy = hoyISO();
  const hogar = estado.yo.hogar_id;
  const ids = estado.personas.map((p) => p.id);

  const [eventos, estados, mediciones] = await Promise.all([
    sb.from('calendario').select('*').eq('hogar_id', hogar)
      .gte('fecha', hoy).lte('fecha', sumarDias(hoy, 7))
      .order('fecha').order('hora_inicio', { nullsFirst: true }).then(datos),
    sb.from('estado_diario').select('*').in('persona_id', ids).eq('fecha', hoy).then(datos),
    sb.from('mediciones_corporales').select('persona_id, medido_en, peso_kg, grasa_pct, masa_muscular_kg')
      .in('persona_id', ids).order('medido_en', { ascending: false }).limit(40).then(datos),
  ]);

  const deHoy = eventos.filter((e) => e.fecha === hoy);
  const proximo = eventos.find((e) => e.fecha > hoy && e.tipo !== 'descanso');

  app.innerHTML = `
    <header class="encabezado">
      <div>
        <h1 class="titulo">Hoy</h1>
        <p class="subtitulo">${esc(diaLargo(hoy))}</p>
      </div>
      <span class="wordmark" aria-hidden="true">b<span class="wordmark__bloque"></span></span>
    </header>

    <section class="tarjeta" aria-labelledby="plan-hoy">
      <h2 class="seccion__titulo" id="plan-hoy">Plan de hoy</h2>
      ${deHoy.length
        ? `<div class="pila">${deHoy.map((e) => `<div class="evento">${htmlEvento(e)}</div>`).join('')}</div>`
        : `<p class="vacio">No hay nada agendado hoy.</p>`}
      ${proximo ? `<p class="quieto" style="margin:12px 0 0">Próximo: ${esc(diaCorto(proximo.fecha))} ${numeroDia(proximo.fecha)} · ${esc(htmlTextoPlano(proximo))}</p>` : ''}
      <a class="boton boton--sec boton--chico" style="margin-top:14px" href="#/semana">Ver la semana</a>
    </section>

    ${estado.personas.map((p, i) => `
      <section class="seccion" aria-labelledby="como-${i}">
        <h2 class="seccion__titulo" id="como-${i}">${p.id === estado.yo.id ? 'Cómo estoy' : `Cómo está ${esc(p.nombre)}`}</h2>
        ${tarjetaPersona(p, estados.find((e) => e.persona_id === p.id), mediciones.find((m) => m.persona_id === p.id))}
      </section>`).join('')}`;

  conectarCheckIn(app, hoy, estados.find((e) => e.persona_id === estado.yo.id));
}

function htmlTextoPlano(ev) {
  const div = document.createElement('div');
  div.innerHTML = htmlEvento(ev);
  return div.textContent.replace(/\s+/g, ' ').trim();
}

function tarjetaPersona(p, est, med) {
  const soyYo = p.id === estado.yo.id;
  const sem = est?.semaforo;
  return `
    <article class="tarjeta">
      <div class="fila fila--entre">
        <h3 class="tarjeta__titulo">${esc(p.nombre)}</h3>
        <span class="fila" style="gap:8px">
          <span class="punto ${sem ? `punto--${sem}` : ''}" aria-hidden="true"></span>
          <span class="quieto">${sem ? esc(SEMAFORO[sem]) : 'Sin semáforo aún'}</span>
        </span>
      </div>
      ${est?.motivo ? `<p class="quieto" style="margin:6px 0 0">${esc(est.motivo)}</p>` : ''}

      <div class="grilla-2" style="margin-top:14px">
        <div>
          <p class="quieto" style="margin:0 0 4px">Peso</p>
          ${med?.peso_kg != null ? `<span class="dato-grande">${num(med.peso_kg)}</span><span class="dato-unidad">kg</span>` : '<span class="quieto">—</span>'}
        </div>
        <div>
          <p class="quieto" style="margin:0 0 4px">Grasa</p>
          ${med?.grasa_pct != null ? `<span class="dato-grande">${num(med.grasa_pct)}</span><span class="dato-unidad">%</span>` : '<span class="quieto">—</span>'}
        </div>
      </div>
      ${med ? `<p class="quieto" style="margin:8px 0 0">Última medición: ${esc(fechaCorta(med.medido_en))}</p>` : ''}

      ${soyYo ? formularioCheckIn(est) : resumenCheckIn(est)}
    </article>`;
}

function chips(nombre, actual) {
  return [1, 2, 3, 4, 5].map((n) =>
    `<button type="button" class="chip" data-valor="${n}" aria-pressed="${actual === n}" aria-label="${nombre} ${n} de 5">${n}</button>`
  ).join('');
}

function formularioCheckIn(est) {
  return `
    <div class="pila" style="margin-top:18px" id="checkin">
      <fieldset class="campo">
        <legend>Cansancio (1 = fresco, 5 = agotado)</legend>
        <div class="chips" id="cansancio">${chips('Cansancio', est?.cansancio ?? null)}</div>
      </fieldset>
      <fieldset class="campo">
        <legend>Dolor muscular (1 = nada, 5 = mucho)</legend>
        <div class="chips" id="dolor">${chips('Dolor muscular', est?.dolor_muscular ?? null)}</div>
      </fieldset>
      <button type="button" class="boton boton--chico" id="guardar-checkin">${est ? 'Actualizar cómo me siento' : 'Guardar cómo me siento'}</button>
    </div>`;
}

function resumenCheckIn(est) {
  if (!est || (est.cansancio == null && est.dolor_muscular == null)) {
    return '<p class="quieto" style="margin:14px 0 0">Todavía no registró cómo se siente hoy.</p>';
  }
  return `<p class="quieto" style="margin:14px 0 0">Cansancio ${est.cansancio ?? '—'}/5 · Dolor muscular ${est.dolor_muscular ?? '—'}/5</p>`;
}

function conectarCheckIn(app, hoy, est) {
  const cont = app.querySelector('#checkin');
  if (!cont) return;
  const cansancio = cont.querySelector('#cansancio');
  const dolor = cont.querySelector('#dolor');
  grupoChips(cansancio);
  grupoChips(dolor);
  const boton = cont.querySelector('#guardar-checkin');
  boton.addEventListener('click', async () => {
    const c = valorChips(cansancio), d = valorChips(dolor);
    if (!c && !d) return aviso('Elige al menos un valor.');
    boton.disabled = true;
    try {
      datos(await sb.from('estado_diario').upsert({
        persona_id: estado.yo.id,
        fecha: hoy,
        cansancio: c ? Number(c) : est?.cansancio ?? null,
        dolor_muscular: d ? Number(d) : est?.dolor_muscular ?? null,
      }, { onConflict: 'persona_id,fecha' }));
      aviso('Guardado.');
      await vistaHoy(app);
    } catch (err) {
      avisoError(err);
      boton.disabled = false;
    }
  });
}
