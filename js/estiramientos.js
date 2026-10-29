// Estiramientos después del gym, según los músculos trabajados.
// Si hay derby (u otro entreno exigente) en poco tiempo, va una versión corta y suave: estirar mucho
// justo antes resta fuerza y reacción; se suelta lo trabajado y se guarda lo demás para después.
import { esc, abrirDialogo, aviso } from './ui.js';
import { NOMBRE_ZONA } from './iconos.js';

const E = (nombre, segundos, como, porLado = false) => ({ nombre, segundos, como, porLado });
const POR_ZONA = {
  pecho: [E('Pecho en el marco de la puerta', 30, 'Antebrazo apoyado en el marco a la altura del hombro; gira el cuerpo hacia el otro lado.', true)],
  hombros: [E('Brazo cruzado al pecho', 30, 'Lleva el brazo estirado al otro hombro y sujétalo con la otra mano por encima del codo.', true)],
  triceps: [E('Tríceps por detrás de la cabeza', 30, 'Codo hacia el techo, la mano baja por la espalda; empuja suave el codo con la otra mano.', true)],
  biceps: [E('Bíceps contra la pared', 30, 'Palma apoyada en la pared, brazo estirado detrás; gira el pecho hacia afuera.', true)],
  antebrazos: [E('Antebrazos: muñeca hacia atrás', 30, 'Brazo estirado al frente, palma hacia afuera; con la otra mano tira los dedos hacia ti. Luego al revés.', true)],
  trapecios: [E('Cuello y trapecio', 30, 'Lleva la oreja al hombro y deja caer el hombro contrario; la mano sobre la cabeza solo acompaña.', true)],
  espalda: [E('Postura del niño', 40, 'De rodillas, siéntate en los talones y estira los brazos al frente apoyando el pecho.'),
    E('Dorsal colgado o en la pared', 30, 'Manos en una barra o la pared, cadera hacia atrás, deja que la espalda se alargue.')],
  lumbar: [E('Rodillas al pecho', 40, 'Acostado boca arriba, abraza las rodillas y balancea suave de lado a lado.')],
  core: [E('Cobra', 30, 'Boca abajo, manos bajo los hombros; sube el pecho sin despegar la cadera.')],
  gluteos: [E('Figura 4', 40, 'Boca arriba, tobillo sobre la rodilla contraria; tira de la pierna de abajo hacia el pecho.', true)],
  cuadriceps: [E('Cuádriceps de pie', 30, 'Lleva el talón al glúteo, rodillas juntas y cadera adelante; apóyate si hace falta.', true),
    E('Flexor de cadera en zancada', 30, 'Rodilla atrás en el piso, empuja la cadera hacia adelante con el tronco recto.', true)],
  isquios: [E('Isquiotibiales sentado', 40, 'Pierna estirada, la otra doblada; inclínate desde la cadera con la espalda larga.', true)],
  pantorrillas: [E('Pantorrilla en la pared', 30, 'Manos en la pared, una pierna atrás con el talón en el piso y la rodilla estirada.', true)],
};
// Antes del derby: movilidad suave y corta.
const CORTA = {
  pecho: E('Círculos de brazos', 20, 'Grandes y lentos, hacia adelante y hacia atrás.'),
  hombros: E('Círculos de brazos', 20, 'Grandes y lentos, hacia adelante y hacia atrás.'),
  espalda: E('Gato-vaca', 20, 'En cuatro apoyos, arquea y redondea la espalda despacio.'),
  lumbar: E('Gato-vaca', 20, 'En cuatro apoyos, arquea y redondea la espalda despacio.'),
  cuadriceps: E('Balanceo de piernas', 20, 'Apoyado en la pared, balancea la pierna adelante y atrás sin forzar.', true),
  isquios: E('Balanceo de piernas', 20, 'Apoyado en la pared, balancea la pierna adelante y atrás sin forzar.', true),
  gluteos: E('Círculos de cadera', 20, 'Manos en la cintura, círculos amplios hacia un lado y al otro.'),
  antebrazos: E('Muñecas en círculos', 15, 'Entrelaza los dedos y gira las muñecas.'),
  trapecios: E('Hombros arriba y abajo', 15, 'Sube los hombros a las orejas y suéltalos.'),
  core: E('Rotaciones de tronco', 20, 'De pie, brazos sueltos, gira el tronco a un lado y al otro.'),
  biceps: E('Círculos de brazos', 20, 'Grandes y lentos, hacia adelante y hacia atrás.'),
  triceps: E('Círculos de brazos', 20, 'Grandes y lentos, hacia adelante y hacia atrás.'),
  pantorrillas: E('Tobillos en círculos', 15, 'Apoyado en una pierna, gira el tobillo de la otra.', true),
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

/**
 * Ofrece y guía los estiramientos al terminar el gym.
 * @param {string[]} zonas zonas trabajadas (de zonasDe)
 * @param {{ corta?: boolean, motivo?: string, alTerminar?: Function }} op
 */
export function ofrecerEstiramientos(zonas, { corta = false, motivo = '', alTerminar = () => {} } = {}) {
  const lista = planEstiramiento(zonas, { corta });
  if (!lista.length) return alTerminar();
  const min = Math.max(1, Math.round(duracion(lista) / 60));
  const d = abrirDialogo(`
    <div class="dialogo estirar">
      <h2 class="tarjeta__titulo">${corta ? 'Movilidad corta' : 'Estiramientos'} · ${min} min</h2>
      <p class="quieto" style="margin:-8px 0 0">${corta ? esc(motivo || 'Tienes derby pronto: suelta lo trabajado sin estirar a fondo.') : `Para ${esc(zonas.slice(0, 4).map((z) => NOMBRE_ZONA[z]?.toLowerCase()).filter(Boolean).join(', '))}: ayuda a recuperar y a moverte mejor mañana.`}</p>
      <div class="estirar__actual" id="e-actual" hidden>
        <span class="estirar__lado" id="e-lado"></span>
        <strong class="estirar__nombre" id="e-nombre"></strong>
        <span class="estirar__tiempo" id="e-tiempo"></span>
        <div class="crono__barra"><span id="e-barra"></span></div>
        <p class="estirar__como" id="e-como"></p>
      </div>
      <ol class="estirar__lista" id="e-lista">
        ${lista.map((e, i) => `<li data-i="${i}"><strong>${esc(e.nombre)}</strong><span class="quieto">${e.segundos} s${e.porLado ? ' por lado' : ''}</span></li>`).join('')}
      </ol>
      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" id="e-saltar">Ahora no</button>
        <button type="button" class="boton" id="e-ir">▶ Empezar</button>
      </div>
    </div>`, 'Estiramientos', { pantalla: true });

  let pasos = [], k = 0, inicio = 0, intervalo = null, bloqueo = null;
  const $ = (q) => d.querySelector(q);
  const vibrar = (p) => { try { navigator.vibrate?.(p); } catch { /* nada */ } };
  const armar = () => {
    pasos = lista.flatMap((e, i) => (e.porLado
      ? [{ ...e, i, lado: 'Lado derecho' }, { ...e, i, lado: 'Cambia de lado', cambio: true, segundos: 5 }, { ...e, i, lado: 'Lado izquierdo' }]
      : [{ ...e, i }]));
  };
  const mostrar = () => {
    const p = pasos[k];
    $('#e-actual').hidden = false;
    $('#e-lado').textContent = p.lado ?? `${k + 1} de ${pasos.length}`;
    $('#e-nombre').textContent = p.nombre;
    $('#e-como').textContent = p.cambio ? 'Cambia de lado.' : p.como;
    $('#e-actual').dataset.fase = p.cambio ? 'cambio' : 'trabajo';
    d.querySelectorAll('#e-lista li').forEach((li) => li.classList.toggle('activo', Number(li.dataset.i) === p.i));
    d.querySelectorAll('#e-lista li').forEach((li) => li.classList.toggle('hecho', Number(li.dataset.i) < p.i));
    inicio = Date.now();
  };
  const tic = () => {
    const p = pasos[k];
    const resta = p.segundos - (Date.now() - inicio) / 1000;
    $('#e-tiempo').textContent = `${Math.max(0, Math.ceil(resta))} s`;
    $('#e-barra').style.transform = `scaleX(${Math.max(0, resta / p.segundos)})`;
    if (resta <= 0) {
      vibrar([150]);
      k++;
      if (k >= pasos.length) return fin(true);
      mostrar();
    }
  };
  const fin = (completo) => {
    clearInterval(intervalo); intervalo = null;
    bloqueo?.release?.().catch(() => {});
    if (completo) { vibrar([200, 100, 200]); aviso('¡Listo! Buen estiramiento.'); }
    d.close();
  };
  $('#e-ir').addEventListener('click', async () => {
    if (intervalo) { k++; if (k >= pasos.length) return fin(true); return mostrar(); } // «Siguiente»
    armar(); k = 0;
    try { bloqueo = await navigator.wakeLock?.request('screen'); } catch { /* nada */ }
    $('#e-ir').textContent = 'Siguiente ›';
    $('#e-saltar').textContent = 'Terminar';
    mostrar();
    intervalo = setInterval(tic, 200);
  });
  $('#e-saltar').addEventListener('click', () => fin(false));
  d.addEventListener('close', () => { clearInterval(intervalo); bloqueo?.release?.().catch(() => {}); alTerminar(); });
}
