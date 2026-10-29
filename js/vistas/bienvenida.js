// Primera vez en Bloque: tu nombre, cómo vas a usar la app (hogar nuevo, unirte o solo)
// y tu deporte. Si llegaste con un link de invitación, va directo a unirte.
import { estado } from '../db.js';
import { esc, aviso, avisoError } from '../ui.js';
import { selectorDeporte, conectarDeporte, crearEquipo, unirmeEquipo, invitacionPendiente, olvidarInvitacion } from '../equipo.js';

const PUNTOS = (paso, total) => `<div class="pasos" aria-hidden="true">${Array.from({ length: total }, (_, i) => `<span class="${i <= paso ? 'on' : ''}"></span>`).join('')}</div>`;

export function pantallaBienvenida(app, alTerminar, alSalir) {
  const meta = estado.usuario?.user_metadata ?? {};
  const s = {
    nombre: (meta.given_name || meta.full_name || meta.name || '').split(' ')[0],
    modo: invitacionPendiente() ? 'unirme' : null,
    codigo: invitacionPendiente() ?? '',
    equipo: '',
    deporte: null,
  };
  let paso = 0;

  const pintar = () => {
    const total = s.modo === 'unirme' ? 2 : 3;
    if (paso === 0) {
      app.innerHTML = `
        <section class="bienvenida">
          ${PUNTOS(0, total)}
          <span class="wordmark" aria-label="bloque">bl<span class="wordmark__bloque" aria-hidden="true"></span>que</span>
          <h1 class="titulo">Hola 👋</h1>
          <p class="subtitulo">Bloque arma tus entrenos, tu semana y tu comida según tu deporte y tus objetivos. Empecemos por lo básico.</p>
          <div class="campo">
            <label for="b-nombre">¿Cómo te llamas?</label>
            <input id="b-nombre" type="text" maxlength="40" autocomplete="given-name" value="${esc(s.nombre)}" placeholder="Tu nombre">
          </div>
          <button type="button" class="boton boton--bloque" id="b-seguir">Seguir</button>
          <button type="button" class="boton boton--texto" id="b-salir">Usar otra cuenta</button>
        </section>`;
      const input = app.querySelector('#b-nombre');
      const seguir = () => {
        s.nombre = input.value.trim();
        if (!s.nombre) { input.focus(); return aviso('Escribe tu nombre.', 'error'); }
        paso = 1; pintar();
      };
      app.querySelector('#b-seguir').addEventListener('click', seguir);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') seguir(); });
      app.querySelector('#b-salir').addEventListener('click', alSalir);
      return;
    }

    if (paso === 1) {
      app.innerHTML = `
        <section class="bienvenida">
          ${PUNTOS(1, total)}
          <h1 class="titulo">¿Cómo vas a usar Bloque?</h1>
          <div class="opciones">
            ${opcion('equipo', '👥', 'Crear un hogar', 'Vives o entrenas con otras personas (tu pareja, familia, amigos). Comparten la semana, las rutinas y la comida.')}
            ${opcion('unirme', '🔑', 'Unirme a un hogar', 'Alguien ya creó el hogar y te pasó un código.')}
            ${opcion('solo', '🙋', 'Solo para mí', 'Un espacio personal. Más adelante puedes crear un hogar desde Perfil.')}
          </div>
          <div class="campo" id="b-campo-codigo" ${s.modo === 'unirme' ? '' : 'hidden'}>
            <label for="b-codigo">Código del hogar</label>
            <input id="b-codigo" class="input-codigo" type="text" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC123" value="${esc(s.codigo)}">
          </div>
          <div class="campo" id="b-campo-equipo" ${s.modo === 'equipo' ? '' : 'hidden'}>
            <label for="b-equipo">Nombre del hogar</label>
            <input id="b-equipo" type="text" maxlength="40" placeholder="Ej. Casa Del Bono" value="${esc(s.equipo)}">
          </div>
          <div class="fila" style="gap:10px;width:100%">
            <button type="button" class="boton boton--sec" id="b-atras">Atrás</button>
            <button type="button" class="boton" style="flex:1" id="b-seguir" ${s.modo ? '' : 'disabled'}>${s.modo === 'unirme' ? 'Unirme' : 'Seguir'}</button>
          </div>
        </section>`;
      app.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
        s.modo = b.dataset.modo;
        app.querySelectorAll('[data-modo]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        app.querySelector('#b-campo-codigo').hidden = s.modo !== 'unirme';
        app.querySelector('#b-campo-equipo').hidden = s.modo !== 'equipo';
        const seguir = app.querySelector('#b-seguir');
        seguir.disabled = false;
        seguir.textContent = s.modo === 'unirme' ? 'Unirme' : 'Seguir';
        app.querySelector(s.modo === 'unirme' ? '#b-codigo' : '#b-equipo')?.focus();
      }));
      const codigo = app.querySelector('#b-codigo');
      codigo.addEventListener('input', () => { codigo.value = codigo.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
      app.querySelector('#b-atras').addEventListener('click', () => { paso = 0; pintar(); });
      app.querySelector('#b-seguir').addEventListener('click', async (e) => {
        s.codigo = codigo.value.trim();
        s.equipo = app.querySelector('#b-equipo').value.trim();
        if (s.modo !== 'unirme') { paso = 2; return pintar(); }
        if (s.codigo.length !== 6) { codigo.focus(); return aviso('El código tiene 6 letras o números.', 'error'); }
        const boton = e.currentTarget;
        boton.disabled = true;
        try {
          await unirmeEquipo(s.codigo, s.nombre);
          olvidarInvitacion();
          await alTerminar('¡Listo! Ya estás en el hogar.');
        } catch (err) {
          avisoError(err);
          boton.disabled = false;
        }
      });
      return;
    }

    // Paso 2: deporte (hogar nuevo o solo).
    app.innerHTML = `
      <section class="bienvenida">
        ${PUNTOS(2, 3)}
        <h1 class="titulo">${s.modo === 'equipo' ? '¿Qué deporte hacen?' : '¿Qué deporte haces?'}</h1>
        <p class="subtitulo">Con esto se arman los entrenos de gym que lo complementan y los días más livianos.</p>
        ${selectorDeporte(s.deporte)}
        <div class="fila bienvenida__pie">
          <button type="button" class="boton boton--sec" id="b-atras">Atrás</button>
          <button type="button" class="boton" style="flex:1" id="b-crear" ${s.deporte ? '' : 'disabled'}>${s.modo === 'equipo' ? 'Crear hogar' : 'Empezar'}</button>
        </div>
      </section>`;
    const leer = conectarDeporte(app, (v) => { s.deporte = v; app.querySelector('#b-crear').disabled = false; });
    app.querySelector('#b-atras').addEventListener('click', () => { paso = 1; pintar(); });
    app.querySelector('#b-crear').addEventListener('click', async (e) => {
      const boton = e.currentTarget;
      boton.disabled = true;
      try {
        await crearEquipo(s.nombre, { nombre: s.equipo || null, personal: s.modo === 'solo', deporte: leer() ?? 'otro' });
        olvidarInvitacion();
        await alTerminar(s.modo === 'equipo' ? 'Hogar creado. Invita a los demás desde Perfil.' : '¡Listo! Bienvenido a Bloque.');
      } catch (err) {
        avisoError(err);
        boton.disabled = false;
      }
    });
  };

  const opcion = (modo, icono, titulo, texto) => `
    <button type="button" class="opcion" data-modo="${modo}" aria-pressed="${s.modo === modo}">
      <span class="opcion__icono" aria-hidden="true">${icono}</span>
      <span class="opcion__texto"><strong>${titulo}</strong><span>${texto}</span></span>
    </button>`;

  // Con link de invitación y nombre de Google, se salta directo a confirmar el código.
  if (s.modo === 'unirme' && s.nombre) paso = 1;
  pintar();
}

// Link de invitación abierto por alguien que ya usa Bloque: confirmar antes de cambiar de equipo.
export async function vistaUnirme(app) {
  const codigo = (location.hash.split('/')[2] ?? '').toUpperCase();
  olvidarInvitacion();
  const yaEstoy = estado.equipo?.codigo === codigo;
  const conOtros = !estado.equipo?.personal && estado.personas.length > 1;
  app.innerHTML = `
    <section class="bienvenida">
      <h1 class="titulo">${yaEstoy ? 'Ya estás en este hogar' : 'Te invitaron a un hogar'}</h1>
      <p class="input-codigo input-codigo--grande">${esc(codigo)}</p>
      ${yaEstoy ? '' : `<p class="subtitulo">${conOtros
        ? `Vas a salir de «${esc(estado.equipo.nombre)}». Tus mediciones y entrenos van contigo.`
        : 'Tus mediciones, entrenos y comidas van contigo al hogar nuevo.'}</p>`}
      <div class="fila" style="gap:10px;width:100%">
        <a class="boton boton--sec" href="#/hoy" style="${yaEstoy ? 'flex:1' : ''}">${yaEstoy ? 'Ir a Hoy' : 'Ahora no'}</a>
        ${yaEstoy ? '' : '<button type="button" class="boton" style="flex:1" id="u-unirme">Unirme</button>'}
      </div>
    </section>`;
  app.querySelector('#u-unirme')?.addEventListener('click', async (e) => {
    const boton = e.currentTarget;
    boton.disabled = true;
    try {
      await unirmeEquipo(codigo);
      location.replace('#/hoy');
      location.reload();
    } catch (err) {
      avisoError(err);
      boton.disabled = false;
    }
  });
}
