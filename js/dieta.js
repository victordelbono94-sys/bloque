// Cómo come cada persona: tipo de dieta, restricciones y lo que no le gusta. Bloq no asume que comes carne:
// pregunta una vez y con eso la IA, las ideas, los snacks y las fuentes de vitaminas se adaptan.
// Si la dieta deja afuera un grupo de alimentos, avisa qué conviene cuidar (y cuándo consultar un suplemento).
import { sb, estado, datos, cargarPersonas } from './db.js';
import { esc, aviso, avisoError, abrirDialogo } from './ui.js';

export const TIPOS = {
  omnivora: 'Como de todo',
  flexitariana: 'Como poca carne',
  pescetariana: 'Pescetariana',
  vegetariana: 'Vegetariana',
  vegana: 'Vegana',
  keto: 'Keto / baja en carbohidratos',
  mediterranea: 'Mediterránea',
};
export const RESTRICCIONES = {
  sin_gluten: 'Sin gluten', sin_lactosa: 'Sin lactosa', sin_lacteos: 'Sin lácteos', sin_huevo: 'Sin huevo',
  sin_mariscos: 'Sin mariscos', sin_frutos_secos: 'Sin frutos secos / maní', sin_cerdo: 'Sin cerdo', sin_frutas: 'No como frutas',
  sin_verduras: 'Casi no como verduras', sin_azucar: 'Sin azúcar',
};

// Las etiquetas hablan en primera persona («No como frutas»); a la IA se le cuenta en tercera.
const PARA_IA = { omnivora: 'come de todo', flexitariana: 'come poca carne', sin_frutas: 'no come frutas', sin_verduras: 'casi no come verduras' };

export const dietaDe = (p = estado.yo) => p?.dieta ?? null;
export const tieneDieta = (p = estado.yo) => !!dietaDe(p)?.tipo;
const sinCarne = (d) => ['vegetariana', 'vegana'].includes(d?.tipo);
const tiene = (d, r) => d?.restricciones?.includes(r);

/** Para la IA: cómo come, en palabras simples. */
export function dietaParaIA(p = estado.yo) {
  const d = dietaDe(p);
  if (!d?.tipo) return 'no la dijo todavía: no asumas que come carne; sugiere opciones variadas y, si viene al caso, pregúntale';
  return [PARA_IA[d.tipo] ?? TIPOS[d.tipo] ?? d.tipo, ...(d.restricciones ?? []).map((r) => PARA_IA[r] ?? RESTRICCIONES[r] ?? r), d.no_le_gusta ? `no le gusta: ${d.no_le_gusta}` : null, d.nota].filter(Boolean).join(' · ');
}

/** Fuentes de proteína que encajan con su dieta (para textos y sugerencias). */
export function fuentesProteina(p = estado.yo) {
  const d = dietaDe(p);
  let f = ['huevos', 'pollo', 'atún', 'yogur griego', 'queso fresco', 'lenteja o fréjol', 'tofu', 'proteína en polvo'];
  if (d?.tipo === 'vegana') f = ['tofu o tempeh', 'lenteja, fréjol o garbanzo', 'chochos', 'quinua', 'proteína vegetal en polvo', 'maní'];
  else if (d?.tipo === 'vegetariana') f = ['huevos', 'yogur griego', 'queso fresco', 'chochos', 'lenteja o fréjol', 'tofu', 'proteína en polvo'];
  else if (d?.tipo === 'pescetariana') f = ['huevos', 'atún o sardina', 'pescado', 'yogur griego', 'chochos', 'lenteja o fréjol'];
  if (!d?.tipo) f = ['huevos', 'yogur griego', 'pollo o atún', 'chochos', 'lenteja o fréjol', 'tofu'];
  if (tiene(d, 'sin_huevo')) f = f.filter((x) => !/huevo/.test(x));
  if (tiene(d, 'sin_lacteos')) f = f.filter((x) => !/yogur|queso/.test(x));
  if (tiene(d, 'sin_mariscos')) f = f.filter((x) => !/marisco|camar/.test(x));
  if (tiene(d, 'sin_frutos_secos')) f = f.filter((x) => !/maní|almendr/.test(x));
  return f;
}

/** ¿Este alimento choca con su dieta? (para filtrar listas de sugerencias fijas). */
export function encaja(texto, p = estado.yo) {
  const d = dietaDe(p);
  if (!d) return true;
  const t = texto.toLowerCase();
  if (sinCarne(d) && /(carne|pollo|res|cerdo|hígado|menudencia|atún|sardina|salmón|trucha|pescado|caballa|camar|marisco)/.test(t)) return false;
  if (d.tipo === 'pescetariana' && /(carne|pollo|res|cerdo|hígado|menudencia)/.test(t)) return false;
  if (d.tipo === 'vegana' && /(huevo|leche|yogur|queso|lácteo)/.test(t)) return false;
  if (tiene(d, 'sin_huevo') && /huevo/.test(t)) return false;
  if ((tiene(d, 'sin_lacteos') || tiene(d, 'sin_lactosa')) && /(leche|yogur|queso)/.test(t)) return false;
  if (tiene(d, 'sin_mariscos') && /(camar|marisco)/.test(t)) return false;
  if (tiene(d, 'sin_cerdo') && /cerdo/.test(t)) return false;
  if (tiene(d, 'sin_frutos_secos') && /(maní|almendr|nuez|frutos secos)/.test(t)) return false;
  if (tiene(d, 'sin_gluten') && /(pan |pan$|avena|trigo|fideo|pasta)/.test(t)) return false;
  if (tiene(d, 'sin_frutas') && /(guineo|plátano maduro|naranja|mandarina|guayaba|tomate de árbol|naranjilla|maracuyá|fruta)/.test(t)) return false;
  return true;
}

/** Qué cuidar según lo que deja afuera su dieta (sin dosis; los suplementos se confirman con un profesional). */
export function cuidados(p = estado.yo) {
  const d = dietaDe(p);
  if (!d?.tipo) return [];
  const c = [];
  if (d.tipo === 'vegana') c.push(['Vitamina B12', 'Solo viene de alimentos animales: en una dieta vegana se suplementa siempre. Consulta la forma y dosis con un profesional.']);
  if (sinCarne(d)) c.push(['Hierro y zinc', 'Come legumbres, chochos y quinua con algo de vitamina C (limón, naranja) para absorber mejor el hierro. Vale la pena un examen de sangre de vez en cuando.']);
  if (sinCarne(d) || d.tipo === 'keto') c.push(['Omega-3', sinCarne(d) ? 'Sin pescado, el omega-3 de algas es la opción vegetal; la chía y la linaza ayudan menos.' : 'Suma pescado azul 2 veces por semana o pregunta por omega-3.']);
  if (d.tipo === 'vegana' || tiene(d, 'sin_lacteos')) c.push(['Calcio y vitamina D', 'Sin lácteos, busca bebidas vegetales fortificadas, tofu con calcio, chochos y brócoli; y algo de sol cada día.']);
  if (tiene(d, 'sin_frutas')) c.push(['Vitamina C y fibra', 'Sin frutas, que no falten pimiento, brócoli, tomate y verduras de hoja. Si cuesta llegar, pregunta por un multivitamínico.']);
  if (tiene(d, 'sin_verduras')) c.push(['Fibra, potasio y magnesio', 'Suma legumbres, avena, papa con cáscara, aguacate y frutas; si cuesta, pregunta por un multivitamínico.']);
  if (d.tipo === 'keto') c.push(['Fibra y electrolitos', 'En keto se pierde más sodio y potasio: aguacate, verduras verdes y sal en el agua los días de entreno.']);
  if (tiene(d, 'sin_gluten')) c.push(['Fibra y vitaminas B', 'Cambia el trigo por quinua, arroz integral, papa y avena certificada sin gluten.']);
  return c;
}

/** Tarjeta compacta (como las de Hoy) para preguntar la dieta, si todavía no está. */
export function htmlPedirDieta() {
  if (tieneDieta()) return '';
  try { const h = localStorage.getItem(`bloque-dieta-pospuesta-${estado.yo.id}`); if (h && h > new Date().toISOString().slice(0, 10)) return ''; } catch { /* nada */ }
  return `
    <section class="tarjeta cuerpo-pendiente pedir-dieta" id="pedir-dieta">
      <div class="pendiente pendiente--resp">
        <span class="pendiente__texto"><strong>¿Sigues alguna dieta o tienes restricciones?</strong>
        <span class="quieto">Vegetariana, keto, sin gluten, no comes frutas… Así Bloq te sugiere comidas que sí comes y te avisa qué cuidar.</span></span>
        <div class="resp-fila">
          <button type="button" class="boton boton--chico" id="pdi-abrir">Dile a Bloq</button>
          <button type="button" class="boton boton--texto boton--chico" id="pdi-omni">Como de todo</button>
          <button type="button" class="boton boton--texto boton--chico" id="pdi-ignorar">Ignorar</button>
        </div>
      </div>
    </section>`;
}
export function conectarPedirDieta(cont, alGuardar) {
  const caja = cont.querySelector('#pedir-dieta');
  if (!caja) return;
  const quitar = () => { caja.classList.add('pedir-despensa--sale'); setTimeout(() => caja.remove(), 320); };
  caja.querySelector('#pdi-abrir').addEventListener('click', () => dialogoDieta(alGuardar));
  caja.querySelector('#pdi-omni').addEventListener('click', async () => { await guardarDieta({ tipo: 'omnivora', restricciones: [] }); quitar(); aviso('Anotado: comes de todo.'); alGuardar?.(); });
  caja.querySelector('#pdi-ignorar').addEventListener('click', () => {
    try { const f = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10); localStorage.setItem(`bloque-dieta-pospuesta-${estado.yo.id}`, f); } catch { /* nada */ }
    quitar();
  });
}

export async function guardarDieta(d) {
  try {
    datos(await sb.from('personas').update({ dieta: d }).eq('id', estado.yo.id).select('id'));
    estado.yo.dieta = d;
    const p = estado.personas.find((x) => x.id === estado.yo.id);
    if (p) p.dieta = d;
    import('./micros.js').then((M) => M.olvidarMicros?.()).catch(() => {});
    cargarPersonas().catch(() => {});
  } catch (e) { avisoError(e); throw e; }
}

/** Hoja para elegir la dieta y las restricciones. */
export function dialogoDieta(alGuardar) {
  const d = dietaDe() ?? { tipo: null, restricciones: [] };
  const dlg = abrirDialogo(`
    <form class="dialogo" novalidate>
      <h2 class="tarjeta__titulo">Mi alimentación</h2>
      <p class="ayuda" style="margin:0">Bloq no asume que comes carne: con esto la IA te sugiere solo comidas que sí comes.</p>
      <fieldset class="campo"><legend>¿Cómo comes?</legend>
        <div class="chips" id="di-tipo">${Object.entries(TIPOS).map(([k, t]) => `<button type="button" class="chip" data-valor="${k}" aria-pressed="${d.tipo === k}">${t}</button>`).join('')}</div>
      </fieldset>
      <fieldset class="campo"><legend>Restricciones o alergias</legend>
        <div class="chips" id="di-restr">${Object.entries(RESTRICCIONES).map(([k, t]) => `<button type="button" class="chip" data-valor="${k}" aria-pressed="${!!d.restricciones?.includes(k)}">${t}</button>`).join('')}</div>
      </fieldset>
      <div class="campo"><label for="di-nogusta">Lo que no te gusta (opcional)</label><input id="di-nogusta" maxlength="200" value="${esc(d.no_le_gusta ?? '')}" placeholder="Ej.: hígado, brócoli"></div>
      <div class="campo"><label for="di-nota">Algo más (opcional)</label><input id="di-nota" maxlength="200" value="${esc(d.nota ?? '')}" placeholder="Ej.: ayuno hasta las 12, alergia a la piña"></div>
      <div class="dialogo__pie">
        <button type="button" class="boton boton--sec" data-cerrar>Cancelar</button>
        <button type="submit" class="boton">Guardar</button>
      </div>
    </form>`, 'Mi alimentación');
  let tipo = d.tipo;
  dlg.querySelectorAll('#di-tipo .chip').forEach((b) => b.addEventListener('click', () => {
    tipo = b.dataset.valor;
    dlg.querySelectorAll('#di-tipo .chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  dlg.querySelectorAll('#di-restr .chip').forEach((b) => b.addEventListener('click', () => b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'))));
  dlg.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!tipo) return aviso('Elige cómo comes.', 'error');
    const nueva = {
      tipo, restricciones: [...dlg.querySelectorAll('#di-restr .chip[aria-pressed="true"]')].map((b) => b.dataset.valor),
      no_le_gusta: dlg.querySelector('#di-nogusta').value.trim() || null, nota: dlg.querySelector('#di-nota').value.trim() || null,
    };
    try {
      await guardarDieta(nueva);
      dlg.close();
      const c = cuidados();
      aviso(c.length ? `Guardado. Ojo con: ${c.map((x) => x[0].toLowerCase()).join(', ')}.` : 'Guardado: Bloq ya lo tiene en cuenta.');
      alGuardar?.();
    } catch { /* ya avisó */ }
  });
  return dlg;
}

/** Tarjeta con lo que conviene cuidar por la dieta (en Alimentación). */
export function htmlCuidados() {
  const c = cuidados();
  if (!c.length) return '';
  return `
    <details class="tarjeta cuidados-dieta">
      <summary><strong>Por tu dieta, cuida esto</strong><span class="quieto">${esc(c.map((x) => x[0]).join(' · '))}</span></summary>
      <ul>${c.map(([t, x]) => `<li><strong>${esc(t)}:</strong> ${esc(x)}</li>`).join('')}</ul>
      <p class="ayuda" style="margin:6px 0 0">Bloq no reemplaza a un profesional: los suplementos y sus dosis se confirman con tu médico o nutricionista.</p>
    </details>`;
}
