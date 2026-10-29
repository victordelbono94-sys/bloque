// Bloque · sincronización con la app puente de Health Connect.
//
// La app puente manda lo que leyó del teléfono y recibe las mediciones que se
// cargaron en Bloque y todavía no se escribieron en Health Connect.
// No usa el login de Supabase: se identifica con el código del teléfono
// (Authorization: Bearer <código>), que acá se compara por su SHA-256.
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function responder(cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function sha256(texto: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Validación ----------

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const esFechaHora = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
function numero(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
function entero(v: unknown, min: number, max: number): number | null {
  const n = numero(v, min, max);
  return n === null ? null : Math.round(n);
}
function texto(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;
}
function lista(v: unknown, max: number): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object').slice(0, max) : [];
}

// ---------- Función ----------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder({ error: 'método no permitido' }, 405);

  const codigo = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (codigo.length < 32 || codigo.length > 200) return responder({ error: 'teléfono no vinculado' }, 401);

  const { data: dispositivo } = await sb.from('dispositivos')
    .select('id, persona_id, personas(nombre)')
    .eq('token_hash', await sha256(codigo))
    .maybeSingle();
  if (!dispositivo) return responder({ error: 'teléfono no vinculado' }, 401);
  const persona = dispositivo.persona_id as string;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await req.json();
  } catch {
    return responder({ error: 'cuerpo inválido' }, 400);
  }

  const resumen = { dias: 0, sesiones: 0, mediciones: 0, escritas: 0 };

  // Respuesta desde la notificación «¿Cómo amaneciste?»: se guarda el cansancio del día
  // (el semáforo se recalcula cuando se abre Hoy).
  const checkin = cuerpo.checkin as Record<string, unknown> | undefined;
  if (checkin && typeof checkin.fecha === 'string' && FECHA.test(checkin.fecha)) {
    const cansancio = entero(checkin.cansancio, 1, 5);
    if (cansancio !== null) {
      await sb.from('estado_diario').upsert({ persona_id: persona, fecha: checkin.fecha, cansancio }, { onConflict: 'persona_id,fecha' });
    }
    return responder({ ok: true });
  }

  // Resumen por día: pasos, calorías, sueño, frecuencia cardiaca en reposo.
  const dias = lista(cuerpo.dias, 400)
    .filter((d) => typeof d.fecha === 'string' && FECHA.test(d.fecha))
    .map((d) => ({
      persona_id: persona,
      fecha: d.fecha as string,
      pasos: entero(d.pasos, 0, 200000),
      calorias_activas: entero(d.calorias_activas, 0, 20000),
      calorias_totales: entero(d.calorias_totales, 0, 30000),
      sueno_min: entero(d.sueno_min, 0, 1440),
      fc_reposo: entero(d.fc_reposo, 20, 200),
      importado_en: new Date().toISOString(),
    }));
  if (dias.length) {
    const { error } = await sb.from('actividad_diaria').upsert(dias, { onConflict: 'persona_id,fecha' });
    if (error) return responder({ error: 'no se pudieron guardar los días', detalle: error.message }, 500);
    resumen.dias = dias.length;
  }

  // Sesiones de ejercicio registradas por la banda.
  const sesiones = lista(cuerpo.sesiones, 500)
    .filter((s) => texto(s.hc_record_id, 200) && esFechaHora(s.inicio) && esFechaHora(s.fin))
    .map((s) => ({
      persona_id: persona,
      hc_record_id: texto(s.hc_record_id, 200)!,
      inicio: s.inicio as string,
      fin: s.fin as string,
      tipo: texto(s.tipo, 60) ?? 'otro',
      calorias: entero(s.calorias, 0, 10000),
      fc_promedio: entero(s.fc_promedio, 20, 250),
      fc_max: entero(s.fc_max, 20, 250),
      importado_en: new Date().toISOString(),
    }));
  if (sesiones.length) {
    const { error } = await sb.from('sesiones_banda').upsert(sesiones, { onConflict: 'hc_record_id' });
    if (error) return responder({ error: 'no se pudieron guardar las sesiones', detalle: error.message }, 500);
    resumen.sesiones = sesiones.length;
  }

  // Mediciones que otras apps escribieron en Health Connect (balanza, Mi Fitness).
  const mediciones = lista(cuerpo.mediciones, 500)
    .filter((m) => texto(m.hc_record_id, 200) && esFechaHora(m.medido_en))
    .map((m) => ({
      persona_id: persona,
      hc_record_id: texto(m.hc_record_id, 200)!,
      medido_en: m.medido_en as string,
      peso_kg: numero(m.peso_kg, 20, 400),
      grasa_pct: numero(m.grasa_pct, 1, 80),
      masa_magra_kg: numero(m.masa_magra_kg, 5, 200),
      masa_osea_kg: numero(m.masa_osea_kg, 0.3, 15),
      agua_pct: numero(m.agua_pct, 10, 90),
      metabolismo_basal_kcal: entero(m.metabolismo_basal_kcal, 400, 6000),
      origen: 'health_connect',
      hc_sincronizado_en: new Date().toISOString(),
    }))
    .filter((m) => m.peso_kg !== null || m.grasa_pct !== null || m.masa_magra_kg !== null || m.metabolismo_basal_kcal !== null);
  if (mediciones.length) {
    const { error } = await sb.from('mediciones_corporales').upsert(mediciones, { onConflict: 'hc_record_id' });
    if (error) return responder({ error: 'no se pudieron guardar las mediciones', detalle: error.message }, 500);
    resumen.mediciones = mediciones.length;
  }

  // Confirmaciones: mediciones de Bloque que el teléfono ya escribió en Health Connect.
  for (const e of lista(cuerpo.escritas, 200)) {
    const id = texto(e.id, 64);
    if (!id) continue;
    const { error } = await sb.from('mediciones_corporales')
      .update({ hc_sincronizado_en: new Date().toISOString(), hc_record_id: texto(e.hc_record_id, 200) })
      .eq('id', id).eq('persona_id', persona).neq('origen', 'health_connect');
    if (!error) resumen.escritas++;
  }

  // Lo que falta escribir en Health Connect.
  const { data: pendientes } = await sb.from('mediciones_corporales')
    .select('id, medido_en, peso_kg, grasa_pct, masa_magra_kg, masa_osea_kg, agua_pct, metabolismo_basal_kcal')
    .eq('persona_id', persona)
    .neq('origen', 'health_connect')
    .is('hc_sincronizado_en', null)
    .order('medido_en')
    .limit(100);

  await sb.from('dispositivos').update({ ultimo_sync: new Date().toISOString() }).eq('id', dispositivo.id);

  // Lo de hoy, para los recordatorios del teléfono: qué comidas ya registró y cuánta agua lleva.
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date());
  let hoyInfo: Record<string, unknown> | null = null;
  try {
    const { data: per } = await sb.from('personas').select('hogar_id').eq('id', persona).single();
    const [{ data: comidas }, { data: agua }, { data: med }, { data: entrenos }] = await Promise.all([
      sb.from('comidas').select('momento, comida_items(gramos, persona_id, alimento:alimentos(nombre)), porciones(persona_id, fraccion)')
        .eq('hogar_id', per!.hogar_id).eq('fecha', hoy),
      sb.from('hidratacion').select('ml').eq('persona_id', persona).eq('fecha', hoy),
      sb.from('mediciones_corporales').select('peso_kg').eq('persona_id', persona).not('peso_kg', 'is', null).order('medido_en', { ascending: false }).limit(1),
      sb.from('sesiones_banda').select('calorias').eq('persona_id', persona).gte('inicio', `${hoy}T05:00:00Z`),
    ]);
    const liquido = /^(agua|caf[eé]|t[eé]\b|infusi|leche|jugo|zumo|batido|smoothie|bebida|gaseosa|cola|soda|limonada|isot[oó]nic|electrol|caldo|sopa|colada)/i;
    let ml = (agua ?? []).reduce((a, x) => a + Number(x.ml), 0);
    const momentos = new Set<string>();
    for (const c of comidas ?? []) {
      // deno-lint-ignore no-explicit-any
      const parte = (c.porciones as any[]).find((x) => x.persona_id === persona);
      if (parte) momentos.add(c.momento as string);
      // deno-lint-ignore no-explicit-any
      for (const it of c.comida_items as any[]) {
        if (!liquido.test(it.alimento?.nombre ?? '')) continue;
        if (it.persona_id) { if (it.persona_id === persona) ml += Number(it.gramos); } else if (parte) ml += Number(it.gramos) * Number(parte.fraccion ?? 1);
      }
    }
    const peso = Number(med?.[0]?.peso_kg ?? 0);
    const ejercicio = (entrenos ?? []).reduce((a, x) => a + Number(x.calorias ?? 0), 0);
    hoyInfo = {
      fecha: hoy, momentos: [...momentos], agua_ml: Math.round(ml),
      agua_meta: peso ? Math.round((peso * 35 + Math.min(1500, ejercicio * 0.8)) / 50) * 50 : 0,
    };
  } catch { /* sin «hoy»: los recordatorios avisan igual */ }

  return responder({
    // deno-lint-ignore no-explicit-any
    nombre: (dispositivo as any).personas?.nombre ?? null,
    resumen,
    pendientes: pendientes ?? [],
    hoy: hoyInfo,
  });
});
