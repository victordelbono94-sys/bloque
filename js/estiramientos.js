// Estiramientos después del gym, según los músculos trabajados.
// Si hay derby (u otro entreno exigente) en poco tiempo, va una versión corta y suave: estirar mucho
// justo antes resta fuerza y reacción; se suelta lo trabajado y se guarda lo demás para después.
import { esc, abrirDialogo, aviso } from './ui.js';
import { NOMBRE_ZONA } from './iconos.js';

// img: carpeta en img/estiramientos (fotos de free-exercise-db, dominio público): 0 = posición inicial, 1 = final.
const E = (nombre, segundos, como, porLado = false, img = null) => ({ nombre, segundos, como, porLado, img });
const POR_ZONA = {
  pecho: [E('Pecho y hombro adelante', 30, 'Toma un palo o una toalla con las manos separadas y llévalo por encima y detrás de la cabeza, sacando pecho.', false, 'Chest_And_Front_Of_Shoulder_Stretch')],
  hombros: [E('Brazo cruzado al pecho', 30, 'Lleva el brazo estirado al otro hombro y sujétalo con la otra mano por encima del codo.', true, 'Shoulder_Stretch')],
  triceps: [E('Tríceps por detrás de la cabeza', 30, 'Codo hacia el techo, la mano baja por la espalda; empuja suave el codo con la otra mano.', true, 'Triceps_Stretch')],
  biceps: [E('Bíceps con manos atrás', 30, 'Entrelaza las manos detrás de la espalda, brazos estirados, y súbelas un poco sacando pecho.', false, 'Standing_Biceps_Stretch')],
  antebrazos: [E('Antebrazos en cuatro apoyos', 30, 'De rodillas, palmas en el piso con los dedos hacia tus rodillas; lleva la cadera atrás despacio.', false, 'Kneeling_Forearm_Stretch')],
  trapecios: [E('Cuello y trapecio', 30, 'Lleva la oreja al hombro y deja caer el hombro contrario; la mano sobre la cabeza solo acompaña.', true, 'Side_Neck_Stretch')],
  espalda: [E('Postura del niño', 40, 'De rodillas, siéntate en los talones y estira los brazos al frente apoyando el pecho.', false, 'Childs_Pose'),
    E('Dorsal en la pared', 30, 'Mano alta en la pared y el cuerpo de costado; empuja la cadera hacia afuera y siente el costado.', true, 'One_Arm_Against_Wall')],
  lumbar: [E('Rodillas al pecho', 40, 'Acostado boca arriba, abraza las rodillas y balancea suave de lado a lado.', false, 'Hug_Knees_To_Chest')],
  core: [E('Cobra', 30, 'Boca abajo, manos bajo los hombros; sube el pecho sin despegar la cadera.', false, 'Lower_Back_Curl')],
  gluteos: [E('Figura 4', 40, 'Boca arriba, tobillo sobre la rodilla contraria; tira de la pierna de abajo hacia el pecho.', true, 'Ankle_On_The_Knee')],
  cuadriceps: [E('Cuádriceps de costado', 30, 'Acostado de lado, toma el empeine de la pierna de arriba y lleva el talón al glúteo, rodillas juntas.', true, 'On_Your_Side_Quad_Stretch'),
    E('Flexor de cadera en zancada', 30, 'Rodilla atrás en el piso, empuja la cadera hacia adelante con el tronco recto.', true, 'Kneeling_Hip_Flexor')],
  isquios: [E('Isquiotibiales sentado', 40, 'Pierna estirada, la otra doblada; inclínate desde la cadera con la espalda larga.', true, 'Seated_Floor_Hamstring_Stretch')],
  pantorrillas: [E('Pantorrilla en la pared', 30, 'Manos en la pared, una pierna atrás con el talón en el piso y la rodilla estirada.', true, 'Calf_Stretch_Hands_Against_Wall')],
};
// Antes del derby: movilidad suave y corta.
const CORTA = {
  pecho: E('Círculos de brazos', 20, 'Brazos abiertos a los lados: círculos grandes y lentos, hacia adelante y hacia atrás.', false, 'Arm_Circles'),
  hombros: E('Círculos de brazos', 20, 'Brazos abiertos a los lados: círculos grandes y lentos, hacia adelante y hacia atrás.', false, 'Arm_Circles'),
  espalda: E('Gato-vaca', 20, 'En cuatro apoyos, arquea y redondea la espalda despacio.', false, 'Cat_Stretch'),
  lumbar: E('Gato-vaca', 20, 'En cuatro apoyos, arquea y redondea la espalda despacio.', false, 'Cat_Stretch'),
  cuadriceps: E('Balanceo de piernas', 20, 'Apoyado en una silla o la pared, balancea la pierna adelante y atrás sin forzar.', true, 'Front_Leg_Raises'),
  isquios: E('Balanceo de piernas', 20, 'Apoyado en una silla o la pared, balancea la pierna adelante y atrás sin forzar.', true, 'Front_Leg_Raises'),
  gluteos: E('Círculos de cadera', 20, 'De pie, sube la rodilla y dibuja círculos amplios con ella, hacia afuera y hacia adentro.', true, 'Standing_Hip_Circles'),
  antebrazos: E('Muñecas en círculos', 15, 'Brazos al frente, gira las muñecas en círculos hacia un lado y al otro.', false, 'Wrist_Circles'),
  trapecios: E('Hombros arriba y abajo', 15, 'Sube los hombros a las orejas y suéltalos.', false, 'Shoulder_Raise'),
  core: E('Rotaciones de tronco', 20, 'De pie, brazos al frente (con o sin balón), gira el tronco a un lado y al otro.', false, 'Torso_Rotation'),
  biceps: E('Círculos de brazos', 20, 'Brazos abiertos a los lados: círculos grandes y lentos, hacia adelante y hacia atrás.', false, 'Arm_Circles'),
  triceps: E('Círculos de brazos', 20, 'Brazos abiertos a los lados: círculos grandes y lentos, hacia adelante y hacia atrás.', false, 'Arm_Circles'),
  pantorrillas: E('Tobillos en círculos', 15, 'Apoyado en una pierna, gira el tobillo de la otra.', true, 'Ankle_Circles'),
};
// Para completar la versión corta (las piernas siempre se mueven antes del derby).
const RELLENO_CORTA = [CORTA.cuadriceps, CORTA.espalda, CORTA.gluteos, CORTA.pecho];

/** Arma la lista de estiramientos para las zonas trabajadas. */
export function planEstiramiento(zonas, { corta = false } = {}) {
  const lista = [];
  const visto = new Set();
  for (const z of zonas) {
    const opciones = corta ? [CORTA[z]].filter(Boolean) : POR_ZONA[z] ?? [];
    for (const e of opciones) if (!visto.has(e.nombre)) { visto.add(e.nombre); lista.push({ ...e, zona: z }); }
  }
  if (!corta && !visto.has('Postura del niño')) lista.push({ ...POR_ZONA.espalda[0], zona: 'espalda' }); // siempre cierra soltando la espalda
  if (corta) for (const e of RELLENO_CORTA) if (lista.length < 4 && !visto.has(e.nombre)) { visto.add(e.nombre); lista.push({ ...e }); }
  return lista.slice(0, corta ? 4 : 8);
}

const duracion = (lista) => lista.reduce((a, e) => a + e.segundos * (e.porLado ? 2 : 1) + 5, 0);

const foto = (e, n) => (e?.img ? `img/estiramientos/${e.img}/${n}.webp` : null);
const PREPARAR = 6; // segundos para acomodarse antes de cada estiramiento
const CAMBIO = 5;   // segundos para cambiar de lado

/**
 * Ofrece y guía los estiramientos al terminar el gym: cada uno con fotos de cómo se hace (inicio y final,
 * alternando), unos segundos para acomodarse antes de que corra el tiempo, pausa y siguiente.
 * @param {string[]} zonas zonas trabajadas (de zonasDe)
 * @param {{ corta?: boolean, motivo?: string, alTerminar?: Function }} op
 */
export function ofrecerEstiramientos(zonas, { corta = false, motivo = '', alTerminar = () => {} } = {}) {
  const lista = planEstiramiento(zonas, { corta });
  if (!lista.length) return alTerminar();
  const min = Math.max(1, Math.round((duracion(lista) + lista.length * PREPARAR) / 60));
  const d = abrirDialogo(`
    <div class="dialogo estirar">
      <h2 class="tarjeta__titulo">${corta ? 'Movilidad corta' : 'Estiramientos'} · ${min} min</h2>
      <p class="quieto" style="margin:-8px 0 0">${corta ? esc(motivo || 'Tienes derby pronto: suelta lo trabajado sin estirar a fondo.') : `Para ${esc(zonas.slice(0, 4).map((z) => NOMBRE_ZONA[z]?.toLowerCase()).filter(Boolean).join(', '))}: ayuda a recuperar y a moverte mejor mañana.`}</p>
      <div class="estirar__actual" id="e-actual" data-fase="vista">
        <div class="estirar__foto" id="e-foto">
          <img id="e-img0" alt=""><img id="e-img1" alt="">
        </div>
        <span class="estirar__lado" id="e-lado"></span>
        <strong class="estirar__nombre" id="e-nombre"></strong>
        <span class="estirar__tiempo" id="e-tiempo"></span>
        <div class="crono__barra"><span id="e-barra"></span></div>
        <p class="estirar__como" id="e-como"></p>
      </div>
      <ol class="estirar__lista" id="e-lista">
        ${lista.map((e, i) => `<li data-i="${i}">
          ${foto(e, 1) ? `<img class="estirar__mini" src="${foto(e, 1)}" alt="" loading="lazy">` : '<span class="estirar__mini"></span>'}
          <strong>${esc(e.nombre)}</strong><span class="quieto">${e.segundos} s${e.porLado ? ' por lado' : ''}</span></li>`).join('')}
      </ol>
      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" id="e-saltar">Ahora no</button>
        <button type="button" class="boton boton--sec" id="e-pausa" hidden>Pausa</button>
        <button type="button" class="boton" id="e-ir">▶ Empezar</button>
      </div>
    </div>`, 'Estiramientos', { pantalla: true });

  let pasos = [], k = 0, inicio = 0, intervalo = null, bloqueo = null, pausado = false, restaPausa = 0, alterna = null;
  const $ = (q) => d.querySelector(q);
  const vibrar = (p) => { try { navigator.vibrate?.(p); } catch { /* nada */ } };

  // Las dos fotos se alternan: así se ve el movimiento (de dónde sales y adónde llegas).
  const mostrarFotos = (e) => {
    clearInterval(alterna);
    const caja = $('#e-foto');
    caja.hidden = !e.img;
    if (!e.img) return;
    $('#e-img0').src = foto(e, 0);
    $('#e-img1').src = foto(e, 1);
    let cual = 1;
    caja.dataset.cual = '1';
    alterna = setInterval(() => { cual = 1 - cual; caja.dataset.cual = String(cual); }, 1700);
  };
  const marcarLista = (i) => {
    d.querySelectorAll('#e-lista li').forEach((li) => {
      li.classList.toggle('activo', Number(li.dataset.i) === i);
      li.classList.toggle('hecho', intervalo != null && Number(li.dataset.i) < i);
    });
  };
  // Antes de empezar: tocar uno de la lista lo muestra arriba para ver cómo es.
  const vistaPrevia = (i) => {
    const e = lista[i];
    $('#e-actual').dataset.fase = 'vista';
    $('#e-lado').textContent = `${i + 1} de ${lista.length}`;
    $('#e-nombre').textContent = e.nombre;
    $('#e-tiempo').textContent = `${e.segundos} s${e.porLado ? ' por lado' : ''}`;
    $('#e-como').textContent = e.como;
    $('#e-barra').style.transform = 'scaleX(1)';
    mostrarFotos(e);
    marcarLista(i);
  };
  vistaPrevia(0);
  d.querySelectorAll('#e-lista li').forEach((li) => li.addEventListener('click', () => {
    const i = Number(li.dataset.i);
    if (intervalo == null) return vistaPrevia(i);
    k = pasos.findIndex((p) => p.i === i); // durante la rutina: saltar a ese
    mostrar();
  }));

  const armar = () => {
    pasos = lista.flatMap((e, i) => [
      { ...e, i, fase: 'preparar', lado: 'Prepárate', segundos: PREPARAR },
      ...(e.porLado
        ? [{ ...e, i, fase: 'trabajo', lado: 'Lado derecho' }, { ...e, i, fase: 'cambio', lado: 'Cambia de lado', segundos: CAMBIO }, { ...e, i, fase: 'trabajo', lado: 'Lado izquierdo' }]
        : [{ ...e, i, fase: 'trabajo', lado: `${i + 1} de ${lista.length}` }]),
    ]);
  };
  const mostrar = () => {
    const p = pasos[k];
    $('#e-actual').dataset.fase = p.fase;
    $('#e-lado').textContent = p.fase === 'preparar' ? `Prepárate · ${p.i + 1} de ${lista.length}` : p.lado;
    $('#e-nombre').textContent = p.nombre;
    $('#e-como').textContent = p.fase === 'cambio' ? 'Suelta despacio y acomódate para el otro lado.' : p.como;
    if (p.fase !== 'cambio' || !$('#e-img0').src.includes(p.img ?? '·')) mostrarFotos(p);
    marcarLista(p.i);
    if (p.fase === 'trabajo') vibrar(120);
    inicio = Date.now();
    pintar();
  };
  const pintar = () => {
    const p = pasos[k];
    const resta = pausado ? restaPausa : p.segundos - (Date.now() - inicio) / 1000;
    $('#e-tiempo').textContent = p.fase === 'trabajo' ? `${Math.max(0, Math.ceil(resta))} s` : `${Math.max(0, Math.ceil(resta))}`;
    $('#e-barra').style.transform = `scaleX(${Math.max(0, resta / p.segundos)})`;
    return resta;
  };
  const tic = () => {
    if (pausado) return;
    if (pintar() <= 0) {
      if (pasos[k].fase === 'trabajo') vibrar([150]);
      k++;
      if (k >= pasos.length) return fin(true);
      mostrar();
    }
  };
  const fin = (completo) => {
    clearInterval(intervalo); intervalo = null;
    clearInterval(alterna);
    bloqueo?.release?.().catch(() => {});
    if (completo) { vibrar([200, 100, 200]); aviso('¡Listo! Buen estiramiento.'); }
    d.close();
  };
  $('#e-ir').addEventListener('click', async () => {
    if (intervalo) { // «Siguiente»: salta al próximo estiramiento (no al otro lado)
      const actualI = pasos[k].i;
      while (k < pasos.length && pasos[k].i === actualI) k++;
      if (k >= pasos.length) return fin(true);
      pausado = false; $('#e-pausa').textContent = 'Pausa';
      return mostrar();
    }
    armar(); k = 0;
    try { bloqueo = await navigator.wakeLock?.request('screen'); } catch { /* nada */ }
    $('#e-ir').textContent = 'Siguiente ›';
    $('#e-saltar').textContent = 'Terminar';
    $('#e-pausa').hidden = false;
    intervalo = setInterval(tic, 200);
    mostrar();
    d.querySelector('.estirar')?.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('#e-pausa').addEventListener('click', () => {
    if (!intervalo) return;
    if (!pausado) { restaPausa = pintar(); pausado = true; $('#e-pausa').textContent = 'Continuar'; $('#e-actual').classList.add('estirar__actual--pausa'); }
    else { pausado = false; inicio = Date.now() - (pasos[k].segundos - restaPausa) * 1000; $('#e-pausa').textContent = 'Pausa'; $('#e-actual').classList.remove('estirar__actual--pausa'); }
  });
  $('#e-saltar').addEventListener('click', () => fin(false));
  d.addEventListener('close', () => { clearInterval(intervalo); clearInterval(alterna); bloqueo?.release?.().catch(() => {}); alTerminar(); });
}
