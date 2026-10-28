// Pantalla Semana: calendario compartido de gym, derby, clases y descanso.
// Cada evento va para los dos por defecto ("Sant y yo"); "Solo" indica quién va.
import { sb, estado, datos, otraPersona } from '../db.js';
import { esc, aviso, avisoError, abrirDialogo, grupoChips, valorChips } from '../ui.js';
import { hoyISO, sumarDias, inicioSemana, rangoSemana, diaCorto, numeroDia, diaLargo, hora } from '../fechas.js';
import { TIPOS, htmlEvento, textoJuntos, horaEfectiva } from '../eventos.js';

export async function vistaSemana(app) {
  const param = location.hash.split('/')[2];
  const lunes = inicioSemana(/^\d{4}-\d{2}-\d{2}$/.test(param ?? '') ? param : hoyISO());
  const domingo = sumarDias(lunes, 6);
  const hoy = hoyISO();

  const [eventos, rutinas] = await Promise.all([
    sb.from('calendario').select('*')
      .eq('hogar_id', estado.yo.hogar_id).gte('fecha', lunes).lte('fecha', domingo)
      .order('fecha').order('hora_inicio', { nullsFirst: true }).then(datos),
    sb.from('rutinas').select('id, nombre').eq('hogar_id', estado.yo.hogar_id).order('creada_en').then(datos),
  ]);
  // Sin hora, el gym (de mañana) va antes que el derby.
  const ORDEN_TIPO = { gym: 0, clase: 1, derby: 2, descanso: 3 };
  eventos.sort((a, b) => a.fecha.localeCompare(b.fecha)
    || horaEfectiva(a).localeCompare(horaEfectiva(b))
    || ORDEN_TIPO[a.tipo] - ORDEN_TIPO[b.tipo]);
  const nombreRutina = (id) => rutinas.find((r) => r.id === id)?.nombre;

  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));

  app.innerHTML = `
    <header class="encabezado">
      <div>
        <h1 class="titulo">Semana</h1>
        <p class="subtitulo">${esc(rangoSemana(lunes))}</p>
      </div>
      <div class="fila" style="gap:4px">
        <a class="boton boton--sec boton--chico" href="#/semana/${sumarDias(lunes, -7)}" aria-label="Semana anterior">‹</a>
        ${lunes !== inicioSemana(hoy) ? `<a class="boton boton--sec boton--chico" href="#/semana">Hoy</a>` : ''}
        <a class="boton boton--sec boton--chico" href="#/semana/${sumarDias(lunes, 7)}" aria-label="Semana siguiente">›</a>
      </div>
    </header>

    <section class="tarjeta" aria-label="Días de la semana">
      ${dias.map((d) => {
        const delDia = eventos.filter((e) => e.fecha === d);
        return `
          <div class="dia ${d === hoy ? 'dia--hoy' : ''}">
            <div class="dia__fecha">
              <span class="dia__nombre">${esc(diaCorto(d))}</span>
              <span class="dia__numero">${numeroDia(d)}</span>
            </div>
            <div class="pila" style="gap:4px">
              ${delDia.map((e) => `
                <button type="button" class="evento evento--boton" data-editar="${esc(e.id)}" aria-label="Editar ${esc(TIPOS[e.tipo])}">
                  ${htmlEvento(e)}
                  ${nombreRutina(e.rutina_id) ? `<span class="evento__rutina">${esc(nombreRutina(e.rutina_id))}</span>` : ''}
                </button>`).join('')}
              <button type="button" class="boton boton--texto" style="justify-content:flex-start" data-agregar="${d}">+ Agregar</button>
            </div>
          </div>`;
      }).join('')}
    </section>

    <button type="button" class="boton boton--sec boton--bloque" style="margin-top:16px" id="copiar" ${eventos.length ? '' : 'disabled'}>
      Repetir esta semana en la siguiente
    </button>`;

  const recargar = () => vistaSemana(app);

  app.querySelectorAll('[data-agregar]').forEach((b) =>
    b.addEventListener('click', () => dialogoEvento({ fecha: b.dataset.agregar }, rutinas, recargar)));
  app.querySelectorAll('[data-editar]').forEach((b) =>
    b.addEventListener('click', () => dialogoEvento(eventos.find((e) => e.id === b.dataset.editar), rutinas, recargar)));
  app.querySelector('#copiar').addEventListener('click', () => copiarSemana(eventos, lunes));
}

function dialogoEvento(ev, rutinas, alGuardar) {
  const nuevo = !ev.id;
  const otro = otraPersona();
  const asistenciaActual = ev.asistencia === 'solo' ? ev.persona_id : 'juntos';
  const tipoActual = ev.tipo ?? 'gym';

  const d = abrirDialogo(`
    <form class="dialogo" method="dialog">
      <h2 class="tarjeta__titulo">${nuevo ? 'Agregar' : 'Editar'} · ${esc(diaLargo(ev.fecha))}</h2>

      <fieldset class="campo" aria-label="Tipo de actividad">
        <div class="chips" id="tipo">
          ${Object.entries(TIPOS).map(([v, t]) => `<button type="button" class="chip" data-valor="${v}" aria-pressed="${v === tipoActual}">${t}</button>`).join('')}
        </div>
      </fieldset>

      <div class="campo" id="campo-rutina">
        <label for="rutina">Rutina</label>
        <select id="rutina">
          <option value="">Sin rutina</option>
          ${rutinas.map((r) => `<option value="${esc(r.id)}" ${r.id === ev.rutina_id ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')}
        </select>
      </div>

      <div class="campo">
        <label for="hora">Hora</label>
        <input id="hora" type="time" value="${esc(hora(ev.hora_inicio))}">
      </div>

      <fieldset class="campo" id="campo-asistencia">
        <legend>Quién va</legend>
        <div class="chips" id="asistencia">
          <button type="button" class="chip" data-valor="juntos" aria-pressed="${asistenciaActual === 'juntos'}">${esc(textoJuntos())}</button>
          <button type="button" class="chip" data-valor="${esc(estado.yo.id)}" aria-pressed="${asistenciaActual === estado.yo.id}">Solo yo</button>
          ${otro ? `<button type="button" class="chip" data-valor="${esc(otro.id)}" aria-pressed="${asistenciaActual === otro.id}">Solo ${esc(otro.nombre)}</button>` : ''}
        </div>
      </fieldset>

      <div class="campo">
        <label for="notas">Notas</label>
        <input id="notas" type="text" maxlength="120" placeholder="Opcional" value="${esc(ev.notas ?? '')}">
      </div>

      <div class="dialogo__pie">
        ${nuevo ? '' : '<button type="button" class="boton boton--peligro" id="borrar" style="margin-right:auto">Eliminar</button>'}
        <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
        <button type="submit" class="boton" id="guardar">Guardar</button>
      </div>
    </form>`, nuevo ? 'Agregar al calendario' : 'Editar evento');

  const tipo = d.querySelector('#tipo');
  const asistencia = d.querySelector('#asistencia');
  const campoAsistencia = d.querySelector('#campo-asistencia');
  const campoRutina = d.querySelector('#campo-rutina');
  const mostrarAsistencia = (t) => { campoAsistencia.hidden = t === 'descanso'; campoRutina.hidden = t !== 'gym'; };
  grupoChips(tipo, mostrarAsistencia);
  grupoChips(asistencia);
  mostrarAsistencia(tipoActual);

  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = valorChips(tipo);
    const a = t === 'descanso' ? 'juntos' : valorChips(asistencia);
    const fila = {
      hogar_id: estado.yo.hogar_id,
      fecha: ev.fecha,
      tipo: t,
      hora_inicio: d.querySelector('#hora').value || null,
      asistencia: a === 'juntos' ? 'juntos' : 'solo',
      persona_id: a === 'juntos' ? null : a,
      notas: d.querySelector('#notas').value.trim() || null,
      rutina_id: t === 'gym' ? d.querySelector('#rutina').value || null : null,
    };
    const boton = d.querySelector('#guardar');
    boton.disabled = true;
    try {
      if (nuevo) datos(await sb.from('calendario').insert(fila));
      else datos(await sb.from('calendario').update(fila).eq('id', ev.id));
      d.close();
      aviso('Calendario actualizado.');
      alGuardar();
    } catch (err) {
      avisoError(err);
      boton.disabled = false;
    }
  });

  d.querySelector('#borrar')?.addEventListener('click', async () => {
    try {
      datos(await sb.from('calendario').delete().eq('id', ev.id));
      d.close();
      aviso('Eliminado.');
      alGuardar();
    } catch (err) {
      avisoError(err);
    }
  });
}

function copiarSemana(eventos, lunes) {
  const siguiente = sumarDias(lunes, 7);
  const d = abrirDialogo(`
    <div class="dialogo">
      <h2 class="tarjeta__titulo">Repetir la semana</h2>
      <p>Se copian los ${eventos.length} eventos de esta semana a la del ${esc(rangoSemana(siguiente))}. Lo que ya esté agendado allá se mantiene.</p>
      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
        <button type="button" class="boton" id="confirmar">Repetir</button>
      </div>
    </div>`, 'Repetir la semana');

  const confirmar = d.querySelector('#confirmar');
  confirmar.addEventListener('click', async () => {
    confirmar.disabled = true;
    try {
      const existentes = await sb.from('calendario').select('fecha, tipo, hora_inicio')
        .eq('hogar_id', estado.yo.hogar_id).gte('fecha', siguiente).lte('fecha', sumarDias(siguiente, 6)).then(datos);
      const clave = (x) => `${x.fecha}|${x.tipo}|${x.hora_inicio ?? ''}`;
      const ya = new Set(existentes.map(clave));
      const copias = eventos
        .map(({ id, ...resto }) => ({ ...resto, fecha: sumarDias(resto.fecha, 7) }))
        .filter((x) => !ya.has(clave(x)));
      if (copias.length) datos(await sb.from('calendario').insert(copias));
      d.close();
      aviso(copias.length ? `Listo: ${copias.length} eventos copiados.` : 'La semana siguiente ya tenía todo.');
      location.hash = `#/semana/${siguiente}`; // la navegación vuelve a cargar la vista
    } catch (err) {
      avisoError(err);
      confirmar.disabled = false;
    }
  });
}
