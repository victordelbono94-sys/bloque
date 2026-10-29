// Asistente para completar el perfil: cuerpo, reloj, objetivo, deporte y gym. Al final arma el plan
// (rutinas y agenda) si el hogar todavía no tiene uno. Se abre al crear la cuenta o desde el aviso de Hoy.
import { sb, estado, datos, cargarPersonas } from '../db.js';
import { esc, aviso, avisoError } from '../ui.js';
import { hoyISO } from '../fechas.js';
import { OBJETIVOS } from '../nutricion.js';
import { deporte as datosDeporte } from '../deportes.js';
import { enApp, APK, pedirPermisos, estadoNativo } from '../nativo.js';
import { armarPlan } from '../plan.js';

const DIAS = [[1, 'L'], [2, 'M'], [3, 'X'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']];
const NOMBRE_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const OBJ_TEXTO = {
  masa_muscular: 'Subir de peso con músculo, sin perder lo que ya tienes.',
  recomposicion: 'Perder grasa mientras ganas músculo.',
  perder_grasa: 'Bajar de peso cuidando el músculo.',
  mantenimiento: 'Quedarte como estás y rendir mejor.',
  cardio: 'Aguantar más en el deporte.',
};

export async function vistaCompletar(app) {
  const yo = estado.yo;
  const [med, obj, rutinas, proximos] = await Promise.all([
    sb.from('mediciones_corporales').select('peso_kg, grasa_pct').eq('persona_id', yo.id).not('peso_kg', 'is', null).order('medido_en', { ascending: false }).limit(1).then(datos),
    sb.from('objetivos').select('foco').eq('persona_id', yo.id).order('desde', { ascending: false }).limit(1).then(datos),
    sb.from('rutinas').select('id').eq('hogar_id', yo.hogar_id).limit(1).then(datos),
    sb.from('calendario').select('fecha, tipo, hora_inicio').eq('hogar_id', yo.hogar_id).gte('fecha', hoyISO()).limit(60).then(datos),
  ]);
  const dep = datosDeporte(estado.equipo?.deporte ?? 'gym');
  const tienePlan = rutinas.length > 0 && proximos.some((e) => e.tipo === 'gym');
  const tieneDeporte = proximos.some((e) => e.tipo === 'derby' || e.tipo === 'otro');
  const s = {
    sexo: yo.sexo ?? null, nacimiento: yo.fecha_nacimiento ?? '', altura: yo.altura_cm ?? '',
    peso: med[0]?.peso_kg ?? '', grasa: med[0]?.grasa_pct ?? '',
    reloj: enApp && estadoNativo()?.permisosLectura ? 'si' : null,
    objetivo: obj[0]?.foco ?? null, experiencia: yo.experiencia ?? null,
    diasDeporte: [], horaDeporte: '', diasGym: [], horaGym: '',
  };
  const pasos = ['cuerpo', 'reloj', 'objetivo',
    ...(dep.clave !== 'gym' && !tieneDeporte ? ['deporte'] : []),
    ...(!tienePlan ? ['gym'] : []), 'listo'];
  let i = 0;

  const chipsDias = (id, elegidos) => `<div class="chips dias-semana" id="${id}">${DIAS.map(([d, t]) =>
    `<button type="button" class="chip" data-dia="${d}" aria-pressed="${elegidos.includes(d)}" aria-label="${NOMBRE_DIA[d]}">${t}</button>`).join('')}</div>`;
  const conectarDias = (id, lista) => app.querySelectorAll(`#${id} [data-dia]`).forEach((b) => b.addEventListener('click', () => {
    const d = Number(b.dataset.dia);
    const k = lista.indexOf(d);
    if (k >= 0) lista.splice(k, 1); else lista.push(d);
    b.setAttribute('aria-pressed', String(k < 0));
  }));
  const opcion = (grupo, valor, titulo, texto, actual) => `
    <button type="button" class="opcion" data-${grupo}="${valor}" aria-pressed="${actual === valor}">
      <span class="opcion__texto"><strong>${esc(titulo)}</strong>${texto ? `<span>${esc(texto)}</span>` : ''}</span>
    </button>`;
  const elegirUno = (grupo, alElegir) => app.querySelectorAll(`[data-${grupo}]`).forEach((b) => b.addEventListener('click', () => {
    app.querySelectorAll(`[data-${grupo}]`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    alElegir(b.dataset[grupo]);
  }));

  const pintar = () => {
    const paso = pasos[i];
    const puntos = `<div class="pasos" aria-hidden="true">${pasos.map((_, k) => `<span class="${k <= i ? 'on' : ''}"></span>`).join('')}</div>`;
    let cuerpo = '';
    if (paso === 'cuerpo') {
      cuerpo = `
        <h1 class="titulo">Tu cuerpo</h1>
        <p class="subtitulo">Con esto se calculan tus calorías, tu proteína y lo que quemas entrenando.</p>
        <div class="chips">
          <button type="button" class="chip" data-sexo="m" aria-pressed="${s.sexo === 'm'}">Hombre</button>
          <button type="button" class="chip" data-sexo="f" aria-pressed="${s.sexo === 'f'}">Mujer</button>
        </div>
        <div class="grilla-2">
          <div class="campo"><label for="c-nac">Nacimiento</label><input id="c-nac" type="date" max="${hoyISO()}" value="${esc(s.nacimiento)}"></div>
          <div class="campo"><label for="c-alt">Altura (cm)</label><input id="c-alt" type="number" inputmode="decimal" min="100" max="250" value="${esc(s.altura)}"></div>
          <div class="campo"><label for="c-peso">Peso (kg)</label><input id="c-peso" type="number" inputmode="decimal" min="25" max="300" step="0.1" value="${esc(s.peso)}"></div>
          <div class="campo"><label for="c-grasa">% de grasa <span class="quieto">· opcional</span></label><input id="c-grasa" type="number" inputmode="decimal" min="3" max="60" step="0.1" value="${esc(s.grasa)}"></div>
        </div>`;
    } else if (paso === 'reloj') {
      const hc = enApp ? estadoNativo() : null;
      cuerpo = `
        <h1 class="titulo">¿Usas reloj o pulsera?</h1>
        <p class="subtitulo">Si lo conectas, Bloque sabe cuánto dormiste, cuánto quemaste y marca solo los entrenos que hiciste.</p>
        <div class="opciones">
          ${opcion('reloj', 'si', 'Sí, uso uno', 'Xiaomi, Samsung, Garmin, Fitbit… (vía Health Connect)', s.reloj)}
          ${opcion('reloj', 'no', 'No', 'Igual funciona: los entrenos se marcan desde la app.', s.reloj)}
        </div>
        <div id="c-reloj-extra" ${s.reloj === 'si' ? '' : 'hidden'}>
          ${enApp
            ? (hc?.permisosLectura
              ? '<p class="hecho" style="margin:0">✓ Health Connect conectado</p>'
              : '<button type="button" class="boton boton--sec boton--bloque" id="c-hc">Conectar Health Connect</button><p class="ayuda" style="margin:8px 0 0">En tu reloj, activa que su app comparta datos con Health Connect.</p>')
            : `<a class="boton boton--sec boton--bloque" href="${APK}">Descargar la app para Android</a><p class="ayuda" style="margin:8px 0 0">El reloj se conecta desde la app de Android. Puedes hacerlo después en Perfil.</p>`}
        </div>`;
    } else if (paso === 'objetivo') {
      cuerpo = `
        <h1 class="titulo">¿Qué quieres lograr?</h1>
        <div class="opciones">${Object.entries(OBJETIVOS).map(([k, o]) => opcion('objetivo', k, o.nombre, OBJ_TEXTO[k], s.objetivo)).join('')}</div>
        <p class="seccion__titulo" style="margin:8px 0 0">Tu experiencia en el gym</p>
        <div class="chips">
          ${[['principiante', 'Recién empiezo'], ['intermedio', 'Algo de experiencia'], ['avanzado', 'Entreno hace años']].map(([v, t]) =>
            `<button type="button" class="chip" data-experiencia="${v}" aria-pressed="${s.experiencia === v}">${t}</button>`).join('')}
        </div>`;
    } else if (paso === 'deporte') {
      cuerpo = `
        <h1 class="titulo">${esc(dep.nombre)}</h1>
        <p class="subtitulo">¿Qué días entrenas${estado.personas.length > 1 ? ' (o entrenan en el hogar)' : ''} y a qué hora?</p>
        ${chipsDias('c-dias-dep', s.diasDeporte)}
        <div class="campo"><label for="c-hora-dep">Hora</label><input id="c-hora-dep" type="time" value="${esc(s.horaDeporte)}"></div>
        <p class="ayuda" style="margin:0">Esos días el gym va a ser más liviano${dep.liviano ? '' : ' si hace falta'}.</p>`;
    } else if (paso === 'gym') {
      cuerpo = `
        <h1 class="titulo">Gym</h1>
        <p class="subtitulo">¿Qué días puedes ir? Con eso armo las rutinas${dep.clave !== 'gym' ? ` que complementan ${esc(dep.nombre.toLowerCase())}` : ''}.</p>
        ${chipsDias('c-dias-gym', s.diasGym)}
        <div class="campo"><label for="c-hora-gym">Hora <span class="quieto">· opcional</span></label><input id="c-hora-gym" type="time" value="${esc(s.horaGym)}"></div>
        <p class="ayuda" style="margin:0">Lo ideal son 3 o 4 días. Después puedes mover todo desde Entrenos.</p>`;
    } else {
      const obj = OBJETIVOS[s.objetivo]?.nombre ?? '';
      cuerpo = `
        <h1 class="titulo">Todo listo</h1>
        <ul class="resumen-plan">
          <li><span>Objetivo</span><strong>${esc(obj)}</strong></li>
          ${pasos.includes('deporte') ? `<li><span>${esc(dep.nombre)}</span><strong>${esc(s.diasDeporte.map((d) => NOMBRE_DIA[d]).join(', ') || 'sin días')}</strong></li>` : ''}
          ${pasos.includes('gym') ? `<li><span>Gym</span><strong>${s.diasGym.length} días: ${esc(s.diasGym.map((d) => NOMBRE_DIA[d].slice(0, 3)).join(', '))}</strong></li>` : '<li><span>Gym</span><strong>El plan de tu hogar</strong></li>'}
        </ul>
        <p class="subtitulo">${pasos.includes('gym') ? 'Armo tus rutinas con ejercicios del gym, las agendo por 4 semanas y calculo tus calorías.' : 'Te sumas a las rutinas de tu hogar y calculo tus calorías.'}</p>`;
    }
    app.innerHTML = `
      <section class="bienvenida asistente">
        ${puntos}
        ${cuerpo}
        <div class="fila bienvenida__pie">
          ${i > 0 ? '<button type="button" class="boton boton--sec" id="c-atras">Atrás</button>' : '<a class="boton boton--sec" href="#/hoy">Después</a>'}
          <button type="button" class="boton" style="flex:1" id="c-seguir">${paso === 'listo' ? (pasos.includes('gym') ? 'Armar mi plan' : 'Terminar') : 'Seguir'}</button>
        </div>
      </section>`;
    conectar(paso);
  };

  const leer = (id) => app.querySelector(id)?.value ?? '';
  const conectar = (paso) => {
    app.querySelector('#c-atras')?.addEventListener('click', () => { i--; pintar(); });
    if (paso === 'cuerpo') elegirUno('sexo', (v) => { s.sexo = v; });
    if (paso === 'reloj') {
      elegirUno('reloj', (v) => { s.reloj = v; app.querySelector('#c-reloj-extra').hidden = v !== 'si'; });
      app.querySelector('#c-hc')?.addEventListener('click', () => pedirPermisos());
    }
    if (paso === 'objetivo') {
      elegirUno('objetivo', (v) => { s.objetivo = v; });
      elegirUno('experiencia', (v) => { s.experiencia = v; });
    }
    if (paso === 'deporte') conectarDias('c-dias-dep', s.diasDeporte);
    if (paso === 'gym') conectarDias('c-dias-gym', s.diasGym);

    app.querySelector('#c-seguir').addEventListener('click', async (e) => {
      if (paso === 'cuerpo') {
        Object.assign(s, { nacimiento: leer('#c-nac'), altura: leer('#c-alt'), peso: leer('#c-peso'), grasa: leer('#c-grasa') });
        if (!s.sexo) return aviso('Elige hombre o mujer (cambia las fórmulas de calorías).', 'error');
        if (!s.nacimiento) return aviso('Falta tu fecha de nacimiento.', 'error');
        if (!(Number(s.altura) >= 100 && Number(s.altura) <= 250)) return aviso('Revisa la altura (en cm).', 'error');
        if (!(Number(s.peso) >= 25 && Number(s.peso) <= 300)) return aviso('Revisa el peso (en kg).', 'error');
      }
      if (paso === 'reloj' && !s.reloj) return aviso('Elige una opción.', 'error');
      if (paso === 'objetivo' && (!s.objetivo || !s.experiencia)) return aviso('Elige tu objetivo y tu experiencia.', 'error');
      if (paso === 'deporte') {
        s.horaDeporte = leer('#c-hora-dep');
        if (!s.diasDeporte.length) return aviso(`Elige al menos un día de ${dep.nombre.toLowerCase()}.`, 'error');
      }
      if (paso === 'gym') {
        s.horaGym = leer('#c-hora-gym');
        if (!s.diasGym.length) return aviso('Elige al menos un día de gym.', 'error');
      }
      if (paso !== 'listo') { i++; return pintar(); }
      const boton = e.currentTarget;
      boton.disabled = true;
      boton.textContent = 'Armando tu plan…';
      try {
        await guardar(s, pasos.includes('gym'));
        await cargarPersonas();
        aviso(pasos.includes('gym') ? '¡Tu plan está listo! Míralo en Entrenos.' : '¡Listo! Ya tienes todo completo.');
        location.hash = '#/hoy';
      } catch (err) {
        avisoError(err);
        boton.disabled = false;
        boton.textContent = 'Armar mi plan';
      }
    });
  };
  pintar();
}

async function guardar(s, conPlan) {
  const yo = estado.yo;
  datos(await sb.from('personas').update({
    sexo: s.sexo, fecha_nacimiento: s.nacimiento, altura_cm: Number(s.altura), experiencia: s.experiencia,
  }).eq('id', yo.id));
  const pesoAntes = datos(await sb.from('mediciones_corporales').select('peso_kg').eq('persona_id', yo.id).not('peso_kg', 'is', null)
    .order('medido_en', { ascending: false }).limit(1))[0]?.peso_kg;
  if (Number(pesoAntes) !== Number(s.peso)) {
    datos(await sb.from('mediciones_corporales').insert({
      persona_id: yo.id, peso_kg: Number(s.peso), grasa_pct: s.grasa === '' ? null : Number(s.grasa), origen: 'manual',
    }));
  }
  const objAntes = datos(await sb.from('objetivos').select('foco').eq('persona_id', yo.id).order('desde', { ascending: false }).limit(1))[0]?.foco;
  if (objAntes !== s.objetivo) datos(await sb.from('objetivos').insert({ persona_id: yo.id, foco: s.objetivo }));
  if (conPlan) {
    await armarPlan({
      objetivo: s.objetivo, experiencia: s.experiencia,
      diasGym: s.diasGym, horaGym: s.horaGym, diasDeporte: s.diasDeporte, horaDeporte: s.horaDeporte,
    });
  } else if (s.diasDeporte.length) {
    await armarPlan({ objetivo: s.objetivo, experiencia: s.experiencia, diasGym: [], diasDeporte: s.diasDeporte, horaDeporte: s.horaDeporte });
  }
}
