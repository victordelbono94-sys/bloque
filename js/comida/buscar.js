// Buscar un alimento: despensa, catálogo, Open Food Facts, código de barras o a mano.
import { esc, aviso, avisoError } from '../ui.js';
import { buscarEnCatalogo, buscarEnOFF, porCodigo, guardarAlimento } from '../alimentos.js';
import { escanearCodigo } from '../escaner.js';
import { kc, g } from './comun.js';

/**
 * Panel de búsqueda dentro de un diálogo.
 * @param {HTMLElement} cont
 * @param {{ despensa?: Array, alElegir: (alimento, paquete) => void, placeholder?: string }} op
 */
export function panelBuscar(cont, { despensa = [], alElegir, placeholder = 'Buscar: arroz, huevo, avena Quaker…' }) {
  cont.innerHTML = `
    <div class="ba">
      <div class="ba__fila">
        <input type="search" id="ba-q" autocomplete="off" placeholder="${esc(placeholder)}" aria-label="Buscar alimento">
        <button type="button" class="boton boton--sec boton--icono" id="ba-escanear" aria-label="Escanear código de barras">
          <svg class="icono" viewBox="0 0 24 24" style="width:22px;height:22px"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M7 8v8M10 8v8M13 8v8M16.5 8v8"/></svg>
        </button>
      </div>
      <div class="ba__res" id="ba-res"></div>
      <button type="button" class="boton boton--texto boton--chico" id="ba-crear" style="align-self:flex-start;padding:0">No está: crear con la etiqueta</button>
      <div id="ba-form" hidden></div>
    </div>`;
  const q = cont.querySelector('#ba-q');
  const res = cont.querySelector('#ba-res');
  let pedido = 0, espera = null, offLista = [];

  const fila = (a, i, origen, extra = '') => `
    <button type="button" class="ba__item" data-origen="${origen}" data-i="${i}">
      <span><strong>${esc(a.nombre)}</strong>${a.marca ? ` <span class="quieto">· ${esc(a.marca)}</span>` : ''}</span>
      <span class="quieto">${extra || `${kc(a.kcal)} kcal · P ${Math.round(a.proteina_g)} · C ${Math.round(a.carbohidratos_g)} · G ${Math.round(a.grasas_g)} por 100 g`}</span>
    </button>`;

  let enDespensa = [], enCatalogo = [];
  const pintar = (cargandoOFF = false) => {
    res.innerHTML = [
      enDespensa.length ? `<p class="ba__grupo">En la despensa</p>${enDespensa.map((x, i) => fila(x.alimento, i, 'despensa', `Quedan ${g(x.gramos_restantes)}`)).join('')}` : '',
      enCatalogo.length ? `<p class="ba__grupo">Alimentos</p>${enCatalogo.map((a, i) => fila(a, i, 'catalogo')).join('')}` : '',
      offLista.length ? `<p class="ba__grupo">Productos (Open Food Facts)</p>${offLista.map((a, i) => fila(a, i, 'off')).join('')}` : '',
      cargandoOFF ? '<p class="quieto ba__vacio">Buscando productos con marca…</p>' : '',
      !cargandoOFF && q.value.trim().length >= 2 && !enDespensa.length && !enCatalogo.length && !offLista.length
        ? '<p class="quieto ba__vacio">No encontré nada. Escanea el código o créalo con la etiqueta.</p>' : '',
    ].join('');
  };
  const filtrarDespensa = (t) => {
    const n = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return despensa.filter((x) => !n || x.alimento.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(n));
  };
  enDespensa = filtrarDespensa('');
  pintar();

  q.addEventListener('input', () => {
    clearTimeout(espera);
    const t = q.value.trim();
    const turno = ++pedido;
    offLista = [];
    enDespensa = filtrarDespensa(t);
    buscarEnCatalogo(t).then((l) => { if (turno === pedido) { enCatalogo = l; pintar(t.length >= 3); } });
    if (t.length < 3) { enCatalogo = t ? enCatalogo : []; pintar(); return; }
    espera = setTimeout(async () => {
      try {
        const l = await buscarEnOFF(t);
        if (turno !== pedido) return;
        const propios = new Set(enCatalogo.map((a) => a.codigo_barras).filter(Boolean));
        offLista = l.filter((a) => !a.codigo_barras || !propios.has(a.codigo_barras));
      } catch { offLista = []; }
      if (turno === pedido) pintar();
    }, 600);
  });

  const elegir = async (a, paquete = null) => {
    try {
      const guardado = await guardarAlimento(a);
      alElegir(guardado, paquete);
    } catch (err) { avisoError(err); }
  };
  res.addEventListener('click', (e) => {
    const b = e.target.closest('.ba__item');
    if (!b) return;
    const i = Number(b.dataset.i);
    if (b.dataset.origen === 'despensa') elegir(enDespensa[i].alimento, enDespensa[i]);
    else if (b.dataset.origen === 'catalogo') elegir(enCatalogo[i]);
    else elegir(offLista[i]);
  });

  const formulario = (codigo = '', nombre = '') => {
    const f = cont.querySelector('#ba-form');
    f.hidden = false;
    f.innerHTML = `
      <div class="ba__manual pila" style="gap:10px">
        <p class="seccion__titulo" style="margin:0">Nuevo alimento · valores por 100 g</p>
        <div class="campo"><label for="m-nombre">Nombre</label><input id="m-nombre" maxlength="120" value="${esc(nombre)}"></div>
        <div class="grilla-2">
          <div class="campo"><label for="m-kcal">Calorías</label><input id="m-kcal" type="number" inputmode="decimal" min="0" max="950" step="0.1"></div>
          <div class="campo"><label for="m-prot">Proteína (g)</label><input id="m-prot" type="number" inputmode="decimal" min="0" max="100" step="0.1"></div>
          <div class="campo"><label for="m-carb">Carbohidratos (g)</label><input id="m-carb" type="number" inputmode="decimal" min="0" max="100" step="0.1"></div>
          <div class="campo"><label for="m-gras">Grasas (g)</label><input id="m-gras" type="number" inputmode="decimal" min="0" max="100" step="0.1"></div>
        </div>
        <div class="grilla-2">
          <div class="campo"><label for="m-paquete">El paquete trae (g)</label><input id="m-paquete" type="number" inputmode="decimal" min="1" placeholder="Opcional"></div>
          <div class="campo"><label for="m-codigo">Código de barras</label><input id="m-codigo" inputmode="numeric" maxlength="14" value="${esc(codigo)}" placeholder="Opcional"></div>
        </div>
        <p class="ayuda">Si la etiqueta da los valores por porción, divide por los gramos de la porción y multiplica por 100.</p>
        <button type="button" class="boton boton--chico" id="m-guardar">Guardar y usar</button>
      </div>`;
    f.querySelector('#m-guardar').addEventListener('click', () => {
      const v = (id) => f.querySelector(`#${id}`).value.trim();
      const n = (id) => (v(id) === '' ? null : Number(v(id)));
      if (!v('m-nombre')) return aviso('Ponle un nombre.', 'error');
      if (n('m-kcal') == null || n('m-kcal') > 950) return aviso('Revisa las calorías por 100 g.', 'error');
      const cod = v('m-codigo').replace(/\D/g, '');
      elegir({
        nombre: v('m-nombre'), kcal: n('m-kcal'), proteina_g: n('m-prot') ?? 0, carbohidratos_g: n('m-carb') ?? 0,
        grasas_g: n('m-gras') ?? 0, paquete_g: n('m-paquete'), codigo_barras: cod.length >= 6 ? cod : null, origen: 'manual',
      });
    });
    f.querySelector('#m-nombre').focus();
  };
  cont.querySelector('#ba-crear').addEventListener('click', () => formulario('', q.value.trim()));

  cont.querySelector('#ba-escanear').addEventListener('click', async () => {
    const codigo = await escanearCodigo();
    if (!codigo) return;
    try {
      const a = await porCodigo(codigo);
      if (a) return elegir(a);
      aviso('Ese producto no está en Open Food Facts: cárgalo con la etiqueta.');
      formulario(codigo, '');
    } catch (err) { avisoError(err); }
  });
  return { enfocar: () => q.focus() };
}

