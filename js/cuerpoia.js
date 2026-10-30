// IA del cuerpo: cargar una medición escribiéndola, con una foto de la balanza o el PDF de la bioimpedancia,
// y conversar sobre cómo vas (la IA explica con tus números, reajusta el ritmo si lo pides y anota lo que aprende de ti).
import { sb, estado, datos } from './db.js';
import { esc, aviso, avisoError, abrirDialogo, num } from './ui.js';
import { htmlCabecera, htmlCompositor, conectarCompositor, burbujaPensando, bajar, htmlBienvenida } from './chatia.js';
import { fotoBase64 } from './comida/comun.js';
import { deporte } from './deportes.js';
import { OBJETIVOS, edad } from './nutricion.js';
import { IC } from './iconos.js';

const CAMPOS = {
  peso_kg: ['Peso', 'kg'], grasa_pct: ['Grasa', '%'], masa_muscular_kg: ['Músculo', 'kg'], masa_magra_kg: ['Masa magra', 'kg'],
  agua_pct: ['Agua', '%'], grasa_visceral: ['Grasa visceral', ''], masa_osea_kg: ['Masa ósea', 'kg'], metabolismo_basal_kcal: ['Metabolismo basal', 'kcal'],
  masa_grasa_kg: ['Masa grasa', 'kg'], musculo_esqueletico_kg: ['Músculo esquelético', 'kg'], agua_intracelular_l: ['Agua intracelular', 'L'],
  agua_extracelular_l: ['Agua extracelular', 'L'], angulo_fase: ['Ángulo de fase', '°'],
};
const ORIGEN = { manual: 'escrita', balanza: 'de la balanza', hospital: 'de la hoja de resultados' };

const leerArchivo = (f) => new Promise((ok, no) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1]);
  r.onerror = () => no(new Error('No se pudo leer el archivo.'));
  r.readAsDataURL(f);
});

async function contexto(semana) {
  const yo = estado.yo;
  const [meds, notas, obj] = await Promise.all([
    sb.from('mediciones_corporales').select('*')
      .eq('persona_id', yo.id).order('medido_en', { ascending: false }).limit(12).then(datos),
    sb.from('notas_cuerpo').select('tipo, texto, valor, creada_en').eq('persona_id', yo.id).order('creada_en', { ascending: false }).limit(10).then(datos).catch(() => []),
    sb.from('objetivos').select('foco').eq('persona_id', yo.id).order('desde', { ascending: false }).limit(1).then(datos).catch(() => []),
  ]);
  const s = semana;
  return {
    hoy: new Date().toISOString().slice(0, 10),
    persona: { nombre: yo.nombre, sexo: yo.sexo ?? null, edad: edad(yo.fecha_nacimiento), altura_cm: yo.altura_cm ?? null, deporte: deporte(estado.equipo?.deporte)?.nombre ?? null },
    objetivo: OBJETIVOS[obj[0]?.foco ?? 'recomposicion']?.nombre,
    mediciones: meds.map((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v != null))),
    ...(s ? {
      ritmo_ideal_kg_semana: { min: s.ritmo.min, max: s.ritmo.max, elegido_por_la_persona: s.ritmo.elegido },
      ritmo_real_kg_semana: s.tendencia?.kgSemana ?? null,
      proyeccion_4_semanas: s.proyeccion,
      gasto_real_aprendido: s.gasto?.listo ? { kcal_dia: s.gasto.kcal, comido_promedio: s.gasto.comido, dias: s.gasto.diasRegistrados, pesajes: s.gasto.pesajes } : 'todavía aprendiendo',
      gasto_estimado_por_la_app: s.gastoEstimado ? Math.round(s.gastoEstimado) : null,
      semana: {
        dias_registrados: s.registrados, dias_en_meta: s.enMeta, dias_con_proteina: s.protOk,
        kcal_promedio: s.kcalComida ? Math.round(s.kcalComida) : null, meta_kcal_promedio: s.kcalMeta ? Math.round(s.kcalMeta) : null,
        entrenos: `${s.hechos}/${s.agendados}`, sueno_h: s.suenoProm ? Math.round(s.suenoProm / 6) / 10 : null,
      },
    } : {}),
    lo_que_ya_aprendiste: notas.filter((n) => n.tipo === 'aprendizaje').map((n) => n.texto),
  };
}

/**
 * @param {{ alGuardar?: Function, manual?: Function }} op
 */
export function abrirCuerpoIA({ alGuardar = () => {}, manual = null } = {}) {
  const d = abrirDialogo(`
    <div class="reg chatia">
      ${htmlCabecera({ titulo: 'Tu cuerpo', sub: 'Mediciones y progreso con la IA' })}
      <div class="chatia__cuerpo" id="cu-chat" aria-live="polite">
        <div id="cu-hola">${htmlBienvenida({
          titulo: 'Nueva medición',
          texto: 'Escribe tu peso, o mándame una foto de la balanza o el PDF de tu bioimpedancia. También puedes contarme cómo vas y reajusto tu proyección.',
          sugerencias: [
            { icono: IC.camara, texto: 'Foto de la balanza' },
            { icono: IC.documento, texto: 'PDF o foto de la bioimpedancia' },
            { icono: IC.grafico, texto: '¿Cómo voy con mi objetivo?' },
            ...(manual ? [{ icono: IC.mano, texto: 'Cargar a mano' }] : []),
          ],
        })}</div>
      </div>
      <footer class="chatia__pie">
        ${htmlCompositor({ id: 'cu', placeholder: 'Ej.: peso 78,4 y grasa 24 %', ids: { texto: 'cu-texto', enviar: 'cu-enviar', camara: 'cu-camara', galeria: 'cu-archivo', foto: 'cu-foto', quitar: 'cu-foto-quitar', estado: 'cu-estado' } })}
      </footer>
    </div>`, 'Tu cuerpo', { pantalla: true });
  const $ = (q) => d.querySelector(q);
  const chat = $('#cu-chat');
  $('#cu-archivo').setAttribute('accept', 'image/*,application/pdf');
  const historial = [];
  let adjunto = null; // { archivo, tipo, nombre }
  let semana = null;
  import('./semanal.js').then((S) => S.calcularSemana(estado.yo)).then((s) => { semana = s; }).catch(() => {});
  d.proteger = () => !!$('#cu-texto').value.trim() || !!adjunto;

  const burbuja = (rol, html) => {
    $('#cu-hola')?.remove();
    chat.insertAdjacentHTML('beforeend', `<div class="chatia__msg chatia__msg--${rol}">${html}</div>`);
    bajar(chat.lastElementChild);
    return chat.lastElementChild;
  };
  const mostrarAdjunto = () => {
    const caja = $('#cu-foto');
    caja.hidden = !adjunto;
    if (!adjunto) return;
    caja.classList.toggle('chatia__adjunto--pdf', adjunto.tipo === 'application/pdf');
    if (adjunto.tipo === 'application/pdf') { caja.querySelector('img').removeAttribute('src'); caja.dataset.nombre = adjunto.nombre; } else caja.querySelector('img').src = URL.createObjectURL(adjunto.archivo);
    compositor.actualizar();
  };

  const guardarMedicion = async (m, boton) => {
    boton.disabled = true;
    try {
      const fila = { persona_id: estado.yo.id, origen: m.origen ?? 'manual', es_referencia: m.origen === 'hospital' };
      for (const k of Object.keys(CAMPOS)) if (m[k] != null) fila[k] = m[k];
      fila.medido_en = m.medido_en ? new Date(`${m.medido_en}T08:00:00`).toISOString() : new Date().toISOString();
      datos(await sb.from('mediciones_corporales').insert(fila));
      boton.closest('.medicion-ia').querySelector('.medicion-ia__acciones').innerHTML = '<p class="propuesta__hecho">✓ Medición guardada</p>';
      aviso('Medición guardada. Tus metas se recalculan.');
      alGuardar();
    } catch (e) { avisoError(e); boton.disabled = false; }
  };
  const htmlMedicion = (m) => `
    <div class="medicion-ia">
      <p class="medicion-ia__titulo">Medición ${esc(ORIGEN[m.origen] ?? '')}${m.medido_en ? ` · ${esc(m.medido_en.split('-').reverse().join('/'))}` : ''}</p>
      <div class="medicion-ia__datos">${Object.entries(CAMPOS).filter(([k]) => m[k] != null).map(([k, [n, u]]) => `<span><small>${n}</small><strong>${num(m[k], k === 'metabolismo_basal_kcal' ? 0 : 1)}${u ? ` ${u}` : ''}</strong></span>`).join('')}</div>
      <div class="medicion-ia__acciones">
        <button type="button" class="chatia__seguir" data-guardar>Guardar</button>
        ${manual ? '<button type="button" class="boton boton--texto boton--chico" data-corregir>Corregir a mano</button>' : ''}
      </div>
    </div>`;

  const enviar = async () => {
    const texto = $('#cu-texto').value.trim();
    if (!texto && !adjunto) return $('#cu-texto').focus();
    const archivo = adjunto;
    adjunto = null; mostrarAdjunto(); compositor.limpiar();
    burbuja('yo', `${archivo ? (archivo.tipo === 'application/pdf' ? `<span class="chatia__pdf">📄 ${esc(archivo.nombre)}</span>` : `<img class="chatia__foto" src="${URL.createObjectURL(archivo.archivo)}" alt="Foto">`) : ''}${texto ? `<span>${esc(texto)}</span>` : ''}`);
    const pensando = burbujaPensando(chat, archivo
      ? [archivo.tipo === 'application/pdf' ? 'Leyendo el PDF…' : 'Mirando la foto…', 'Buscando tus datos…', 'Comparando con tu última medición…']
      : ['Pensando…', 'Mirando tu progreso…', 'Revisando tu ritmo…']);
    $('#cu-enviar').disabled = true;
    try {
      const cuerpo = { mensaje: texto, historial: historial.slice(-8), contexto: await contexto(semana) };
      if (archivo) {
        cuerpo.tipo = archivo.tipo === 'application/pdf' ? 'application/pdf' : 'image/jpeg';
        cuerpo.archivo = archivo.tipo === 'application/pdf' ? await leerArchivo(archivo.archivo) : await fotoBase64(archivo.archivo);
      }
      const espera = new Promise((_, no) => setTimeout(() => no(new Error('La IA tardó demasiado. Prueba de nuevo.')), 70000));
      const { data: r, error } = await Promise.race([sb.functions.invoke('cuerpo', { body: cuerpo }), espera]);
      if (error) {
        let codigo = null;
        try { codigo = (await error.context?.json?.())?.error; } catch { /* nada */ }
        throw new Error({ limite: 'La IA llegó al límite gratis por ahora. Prueba en un minuto.', imagen: 'El archivo es muy pesado o no se pudo leer.', gemini: 'La IA está saturada. Prueba en un rato.' }[codigo] ?? 'No se pudo conectar con la IA. Revisa la conexión.');
      }
      historial.push({ rol: 'yo', texto: texto || (archivo ? `Te mandé ${archivo.tipo === 'application/pdf' ? 'un PDF' : 'una foto'} de mi medición.` : '') }, { rol: 'ia', texto: r.respuesta });
      pensando.terminar(`<span>${esc(r.respuesta || 'Listo.')}</span>`);
      if (r.medicion) {
        const t = burbuja('propuesta', htmlMedicion(r.medicion));
        t.querySelector('[data-guardar]').addEventListener('click', (e) => guardarMedicion(r.medicion, e.currentTarget));
        t.querySelector('[data-corregir]')?.addEventListener('click', () => manual?.(r.medicion));
      }
      if (r.ritmo_kg_semana != null) {
        const v = r.ritmo_kg_semana;
        const t = burbuja('propuesta', `<div class="medicion-ia"><p class="medicion-ia__titulo">Nuevo ritmo</p><p style="margin:0 0 10px"><strong>${v < 0 ? 'Bajar' : 'Subir'} ${num(Math.abs(v), 2)} kg por semana</strong></p><div class="medicion-ia__acciones"><button type="button" class="chatia__seguir" data-ritmo>Usar este ritmo</button></div></div>`);
        t.querySelector('[data-ritmo]').addEventListener('click', async (e) => {
          e.currentTarget.disabled = true;
          try {
            datos(await sb.from('notas_cuerpo').insert({ persona_id: estado.yo.id, tipo: 'ritmo', valor: v, texto: texto.slice(0, 300) || null }).select('id'));
            e.currentTarget.parentElement.innerHTML = '<p class="propuesta__hecho">✓ Proyección reajustada</p>';
            alGuardar();
          } catch (err) { avisoError(err); e.currentTarget.disabled = false; }
        });
      }
      if (r.aprendizaje) {
        sb.from('notas_cuerpo').insert({ persona_id: estado.yo.id, tipo: 'aprendizaje', texto: r.aprendizaje }).then(() => {}, () => {});
        burbuja('nota', `${IC.nota} Anotado para la próxima: ${esc(r.aprendizaje)}`);
      }
    } catch (e) {
      pensando.terminar(`<span class="quieto">${esc(e.message)}</span>`);
    } finally { $('#cu-enviar').disabled = false; }
  };

  const compositor = conectarCompositor(d, { texto: '#cu-texto', enviar: '#cu-enviar', alEnviar: enviar, hayAdjunto: () => !!adjunto });
  for (const id of ['#cu-camara', '#cu-archivo']) {
    $(id).addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      if (f.size > 6.5e6 && f.type === 'application/pdf') return aviso('El PDF es muy pesado (máximo ~6 MB).', 'error');
      adjunto = { archivo: f, tipo: f.type || 'image/jpeg', nombre: f.name };
      mostrarAdjunto();
      if (!$('#cu-texto').value.trim()) enviar(); // con un archivo solo, se manda directo
    });
  }
  $('#cu-foto-quitar').addEventListener('click', () => { adjunto = null; mostrarAdjunto(); });
  d.querySelectorAll('[data-sugerencia]').forEach((b) => b.addEventListener('click', () => {
    const k = Number(b.dataset.sugerencia);
    if (k === 0) return $('#cu-camara').click();
    if (k === 1) return $('#cu-archivo').click();
    if (k === 2) { $('#cu-texto').value = '¿Cómo voy con mi objetivo?'; return enviar(); }
    if (k === 3 && manual) { d.close(); manual(); }
  }));
  return d;
}
