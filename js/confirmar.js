// Entrenos genéricos del reloj («otro entreno»: el patinaje del derby, eSports, lo que sea):
// en vez de asumir qué fueron, la app pregunta. Se responde desde la notificación o desde Hoy.
import { sb, estado, datos } from './db.js';
import { esc, abrirDialogo, aviso, avisoError } from './ui.js';
import { porConfirmar, minutos, confirmadoComo } from './actividades.js';
import { LISTA, GRUPOS, deporte } from './deportes.js';
import { hoyISO, sumarDias, diaCorto } from './fechas.js';
import { incluyeA } from './eventos.js';

const RELOJ = '<svg class="icono" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6l1-3h4l1 3M9 18l1 3h4l1-3M12 9.5V12l1.5 1.5"/></svg>';
// Lo que no es un deporte de la lista pero aparece seguido.
const ESPECIALES = [
  { clave: 'caminar', nombre: 'Caminata' },
  { clave: 'esports', nombre: 'eSports / videojuegos' },
  { clave: 'nada', nombre: 'No fue ejercicio' },
];

const fechaLocal = (iso) => {
  const f = new Date(iso);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
};
const horaDe = (iso) => new Date(iso).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false });
const normal = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Opciones habituales para un entreno: lo agendado ese día, tu deporte y el gym. */
export function opcionesPara(s, eventos) {
  const fecha = fechaLocal(s.inicio);
  const t = new Date(s.inicio).getTime();
  const delDia = eventos
    .filter((e) => e.fecha === fecha && ['gym', 'derby', 'otro', 'clase'].includes(e.tipo) && incluyeA(e, estado.yo.id))
    .sort((a, b) => {
      const d = (e) => (e.hora_inicio ? Math.abs(new Date(`${e.fecha}T${e.hora_inicio.slice(0, 5)}:00`).getTime() - t) : 6 * 3600e3);
      return d(a) - d(b);
    });
  const ops = [];
  const sumar = (como) => {
    const info = confirmadoComo(como);
    if (info && !ops.some((o) => o.como === como || (o.nombre === info.nombre))) ops.push({ como, nombre: info.nombre });
  };
  for (const e of delDia) {
    if (e.tipo === 'gym') sumar('gym');
    else if (e.tipo === 'derby') sumar('derby');
    else if (e.actividad && !['otro', 'clase'].includes(e.actividad)) sumar(e.actividad);
  }
  const dep = estado.equipo?.deporte;
  if (dep) sumar(dep === 'roller_derby' ? 'derby' : dep);
  sumar('gym');
  return ops.slice(0, 3);
}

/** Entrenos míos de los últimos 3 días que esperan respuesta, con sus opciones. */
export async function cargarPorConfirmar() {
  const hoy = hoyISO();
  const desde = sumarDias(hoy, -2);
  const [sesiones, eventos] = await Promise.all([
    sb.from('sesiones_banda').select('id, tipo, inicio, fin, calorias, calorias_estimadas, fc_promedio, confirmado')
      .eq('persona_id', estado.yo.id).is('confirmado', null)
      .gte('inicio', new Date(`${desde}T00:00:00`).toISOString()).order('inicio', { ascending: false }).then(datos),
    sb.from('calendario').select('*').eq('hogar_id', estado.yo.hogar_id).gte('fecha', desde).lte('fecha', hoy).then(datos),
  ]);
  return sesiones.filter(porConfirmar).map((s) => ({ ...s, opciones: opcionesPara(s, eventos) }));
}

function detalle(s) {
  const f = fechaLocal(s.inicio);
  const dia = f === hoyISO() ? 'Hoy' : f === sumarDias(hoyISO(), -1) ? 'Ayer' : diaCorto(f);
  return [`${dia} ${horaDe(s.inicio)}`, `${minutos(s)} min`,
    s.calorias ? `${s.calorias_estimadas ? '≈' : ''}${s.calorias} kcal` : null,
    s.fc_promedio ? `${s.fc_promedio} ppm` : null].filter(Boolean).join(' · ');
}

export function htmlPorConfirmar(lista) {
  return lista.slice(0, 3).map((s) => `
    <section class="tarjeta confirmar" data-sesion="${esc(s.id)}">
      <div class="confirmar__cabeza">
        <span class="confirmar__icono">${RELOJ}</span>
        <span><strong>¿Qué fue este entreno?</strong><span class="quieto">${esc(detalle(s))}</span></span>
      </div>
      <p class="ayuda confirmar__ayuda">Tu reloj lo guardó como «otro entreno». Dime qué fue y lo cuento donde corresponde.</p>
      <div class="chips">
        ${s.opciones.map((o) => `<button type="button" class="chip" data-como="${esc(o.como)}">${esc(o.nombre)}</button>`).join('')}
        <button type="button" class="chip chip--sec" data-otro>Otro…</button>
      </div>
    </section>`).join('');
}

export async function confirmar(id, como) {
  datos(await sb.from('sesiones_banda').update({ confirmado: como, confirmado_en: new Date().toISOString() }).eq('id', id).select('id'));
  aviso(como === 'nada' ? 'Listo: no cuenta como ejercicio.' : `Anotado: ${confirmadoComo(como)?.nombre ?? como} ✓`);
}

/** Conecta las tarjetas de Hoy. */
export function conectarPorConfirmar(cont, lista, alListo) {
  cont.querySelectorAll('[data-sesion]').forEach((t) => {
    const id = t.dataset.sesion;
    const listo = async (como) => {
      try {
        await confirmar(id, como);
        t.classList.add('confirmar--sale');
        setTimeout(alListo, 280);
      } catch (e) { avisoError(e); }
    };
    t.querySelectorAll('[data-como]').forEach((b) => b.addEventListener('click', () => listo(b.dataset.como)));
    t.querySelector('[data-otro]')?.addEventListener('click', () => elegirOtro(lista.find((s) => s.id === id), listo));
  });
  // Si se llegó desde la notificación («Otro…»), se abre directo la lista.
  let pedido = null;
  try { pedido = sessionStorage.getItem('bloque-confirmar'); sessionStorage.removeItem('bloque-confirmar'); } catch { /* nada */ }
  const s = pedido && lista.find((x) => x.id === pedido);
  if (s) {
    const t = cont.querySelector(`[data-sesion="${s.id}"]`);
    elegirOtro(s, async (como) => {
      try { await confirmar(s.id, como); t?.classList.add('confirmar--sale'); setTimeout(alListo, 280); } catch (e) { avisoError(e); }
    });
  }
}

/** Lista de deportes y disciplinas con buscador. */
export function elegirOtro(s, alElegir) {
  const item = (x) => `<button type="button" class="chip" data-elegir="${esc(x.clave)}" data-busca="${esc(normal(x.nombre))}">${esc(x.nombre)}</button>`;
  const habituales = s?.opciones ?? [];
  const d = abrirDialogo(`
    <div class="dialogo elegir-deporte">
      <h2 class="tarjeta__titulo">¿Qué hiciste?</h2>
      ${s ? `<p class="quieto" style="margin:-8px 0 0">${esc(detalle(s))}</p>` : ''}
      <input type="search" class="selector-deporte__buscar elegir-deporte__buscar" id="ed-buscar" placeholder="Buscar: fútbol, yoga, escalada…" autocomplete="off">
      <div class="elegir-deporte__lista" id="ed-lista">
        ${habituales.length ? `<div class="elegir-deporte__grupo" data-grupo><p class="selector-deporte__titulo">Lo de siempre</p><div class="chips">${habituales.map((o) => item({ clave: o.como, nombre: o.nombre })).join('')}</div></div>` : ''}
        <div class="elegir-deporte__grupo" data-grupo><p class="selector-deporte__titulo">Rápido</p><div class="chips">${ESPECIALES.map(item).join('')}</div></div>
        ${GRUPOS.map((g) => `<div class="elegir-deporte__grupo" data-grupo><p class="selector-deporte__titulo">${esc(g.nombre)}</p><div class="chips">${LISTA.filter((x) => x.grupo === g.clave).map(item).join('')}</div></div>`).join('')}
        <p class="vacio" id="ed-nada" hidden>No encontré eso. Prueba con otra palabra.</p>
      </div>
    </div>`, 'Elegir deporte', { pantalla: true });
  const buscar = d.querySelector('#ed-buscar');
  buscar.addEventListener('input', () => {
    const q = normal(buscar.value.trim());
    let alguno = false;
    d.querySelectorAll('.elegir-deporte__grupo').forEach((g) => {
      let visibles = 0;
      g.querySelectorAll('[data-elegir]').forEach((b) => { const ok = !q || b.dataset.busca.includes(q); b.hidden = !ok; if (ok) visibles++; });
      g.hidden = !visibles;
      if (visibles) alguno = true;
    });
    d.querySelector('#ed-nada').hidden = alguno;
  });
  d.querySelectorAll('[data-elegir]').forEach((b) => b.addEventListener('click', () => {
    const como = b.dataset.elegir === 'roller_derby' ? 'derby' : b.dataset.elegir;
    d.close();
    alElegir(como);
  }));
  return d;
}

export { deporte };
