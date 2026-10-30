// IA del cuerpo: carga mediciones (texto, foto de la balanza o PDF de la bioimpedancia) y conversa sobre el progreso.
// Con el contexto (mediciones, objetivo, ritmo de peso, gasto real aprendido, comidas y entrenos de la semana y lo que
// ya aprendió antes) explica cómo vas, reajusta la proyección si la persona lo pide y anota lo que aprende.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MODELOS = (Deno.env.get("GEMINI_MODELO") ?? "gemini-3.1-flash-lite,gemini-3-flash-preview,gemini-flash-latest")
  .split(",").map((m) => m.trim()).filter(Boolean);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });

const INSTRUCCIONES = `Eres nutricionista deportivo y entrenador; hablas en español de Ecuador, cercano, claro y breve (1 a 4 frases).
Ayudas a una persona con su cuerpo: peso, % de grasa, masa muscular, agua, grasa visceral, y su progreso frente a su objetivo.
El contexto trae sus últimas mediciones, su objetivo, el ritmo de peso esperado y el real, la proyección, su gasto real aprendido
(de sus comidas registradas y sus pesajes), la semana (comidas, entrenos, sueño) y lo que ya aprendiste de ella antes.

1) MEDICIONES: si escribe datos ("peso 78,4", "grasa 24 %") o manda una foto de la balanza o un PDF/hoja de bioimpedancia,
   léelos y ponlos en "medicion" (solo los que aparecen; no inventes). Una hoja de bioimpedancia puede traer: peso, % de grasa, masa grasa (kg),
   grasa visceral, masa muscular, músculo esquelético (SMM), masa magra / libre de grasa, agua corporal total (% ; si viene en litros,
   conviértela a % del peso), agua intracelular y extracelular (L), masa ósea / minerales, metabolismo basal (TMB) y ángulo de fase (°). Si la hoja trae fecha, ponla en medido_en (AAAA-MM-DD).
   origen: "balanza" para foto de balanza, "hospital" para hojas o PDFs de laboratorio/centro deportivo, "manual" si lo escribe.
   En la respuesta di qué leíste y compáralo con su medición anterior en una frase. La persona confirma antes de guardar.
   Si la foto no se lee bien o hay un número dudoso, pregúntalo en vez de adivinar.
2) PROGRESO: si pregunta cómo va o cuenta cómo se siente ("no bajo", "me siento hinchada", "comí mal el finde", "entrené menos"),
   explícalo con los números del contexto (ritmo real vs esperado, gasto real vs comido) y da 1 o 2 ajustes concretos.
   Recuerda que el peso varía por agua, sal, carbohidratos y ciclo; mira la tendencia de semanas, no un día.
3) RITMO: si pide ir más rápido o más lento, o con lo que cuenta conviene otro ritmo, pon "ritmo_kg_semana" (negativo para bajar,
   positivo para subir) dentro de un rango sano: bajar como máximo 1 % del peso por semana, subir como máximo 0,5 %.
4) APRENDIZAJE: si de lo que cuenta o de los datos sale algo útil para la próxima vez sobre cómo responde su cuerpo
   (ej. "retiene líquido después del derby", "los fines de semana come ~500 kcal más", "su gasto real es ~200 kcal más alto que lo estimado"),
   ponlo en "aprendizaje" en una frase corta. Si no hay nada nuevo, déjalo vacío.
Nunca diagnostiques ni hables de enfermedades; si algo suena médico, sugiere consultarlo. No recomiendes suplementos con dosis.`;

const NUM = { type: "NUMBER" };
const ESQUEMA = {
  type: "OBJECT",
  properties: {
    respuesta: { type: "STRING" },
    medicion: {
      type: "OBJECT",
      properties: {
        peso_kg: NUM, grasa_pct: NUM, masa_muscular_kg: NUM, masa_magra_kg: NUM, agua_pct: NUM,
        grasa_visceral: NUM, masa_osea_kg: NUM, metabolismo_basal_kcal: NUM,
        masa_grasa_kg: NUM, musculo_esqueletico_kg: NUM, agua_intracelular_l: NUM, agua_extracelular_l: NUM, angulo_fase: NUM,
        medido_en: { type: "STRING" }, origen: { type: "STRING", enum: ["manual", "balanza", "hospital"] },
      },
    },
    ritmo_kg_semana: NUM,
    aprendizaje: { type: "STRING" },
  },
  required: ["respuesta"],
};

const RANGOS: Record<string, [number, number]> = {
  peso_kg: [30, 250], grasa_pct: [2, 70], masa_muscular_kg: [5, 120], masa_magra_kg: [10, 150], agua_pct: [20, 80],
  grasa_visceral: [1, 60], masa_osea_kg: [0.5, 10], metabolismo_basal_kcal: [600, 4500],
  masa_grasa_kg: [1, 200], musculo_esqueletico_kg: [5, 100], agua_intracelular_l: [5, 60], agua_extracelular_l: [3, 40], angulo_fase: [1, 15],
};

async function leerClave(): Promise<string | null> {
  const env = Deno.env.get("GEMINI_API_KEY");
  if (env) return env;
  const url = Deno.env.get("SUPABASE_URL"), servicio = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !servicio) return null;
  const r = await fetch(`${url}/rest/v1/rpc/secreto_servidor`, {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/json", apikey: servicio, Authorization: `Bearer ${servicio}` },
    body: JSON.stringify({ p_nombre: "GEMINI_API_KEY" }),
  });
  if (!r.ok) return null;
  const v = await r.json();
  return typeof v === "string" && v ? v : null;
}

function esUsuario(req: Request): boolean {
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const datos = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return datos.role === "authenticated" && typeof datos.sub === "string";
  } catch {
    return false;
  }
}

const texto = (v: unknown, largo: number) => String(v ?? "").trim().slice(0, largo);
const lista = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n) : []) as Record<string, unknown>[];

function limpiar(d: Record<string, unknown>) {
  const m = (d.medicion ?? {}) as Record<string, unknown>;
  const medicion: Record<string, unknown> = {};
  for (const [k, [min, max]] of Object.entries(RANGOS)) {
    const n = Number(m[k]);
    if (Number.isFinite(n) && n >= min && n <= max) medicion[k] = Math.round(n * 100) / 100;
  }
  const hayDatos = Object.keys(medicion).length > 0;
  if (hayDatos) {
    medicion.origen = ["manual", "balanza", "hospital"].includes(String(m.origen)) ? m.origen : "manual";
    if (/^\d{4}-\d{2}-\d{2}/.test(String(m.medido_en ?? ""))) medicion.medido_en = String(m.medido_en).slice(0, 10);
  }
  const ritmo = Number(d.ritmo_kg_semana);
  return {
    respuesta: texto(d.respuesta, 900),
    medicion: hayDatos ? medicion : null,
    ritmo_kg_semana: Number.isFinite(ritmo) && ritmo !== 0 ? Math.max(-1.5, Math.min(0.8, Math.round(ritmo * 100) / 100)) : null,
    aprendizaje: texto(d.aprendizaje, 300) || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "metodo" }, 405);
  let cuerpo: { mensaje?: string; contexto?: unknown; historial?: { rol?: string; texto?: string }[]; archivo?: string; tipo?: string };
  try { cuerpo = await req.json(); } catch { return json({ error: "formato" }, 400); }
  if (!esUsuario(req)) return json({ error: "sesion" }, 401);
  const mensaje = texto(cuerpo.mensaje, 1200);
  const archivo = cuerpo.archivo ?? "";
  if (!mensaje && !archivo) return json({ error: "texto" }, 400);
  if (archivo && (archivo.length > 9_000_000 || !/^[A-Za-z0-9+/=]+$/.test(archivo))) return json({ error: "imagen" }, 400);
  const tipo = /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(cuerpo.tipo ?? "") ? cuerpo.tipo! : "image/jpeg";
  const clave = await leerClave().catch(() => null);
  if (!clave) return json({ error: "sin_clave" }, 503);

  const historial = lista(cuerpo.historial, 10).map((h) => ({ role: h.rol === "ia" ? "model" : "user", parts: [{ text: texto(h.texto, 1000) }] }))
    .filter((h) => h.parts[0].text);
  const partes: Record<string, unknown>[] = [{ text: `${INSTRUCCIONES}\n\nContexto: ${JSON.stringify(cuerpo.contexto ?? {}).slice(0, 12000)}` }];
  if (archivo) partes.push({ inline_data: { mime_type: tipo, data: archivo } });
  partes.push({ text: `Mensaje: ${mensaje || (tipo === "application/pdf" ? "Te mando el PDF de mi medición." : "Te mando la foto de mi medición.")}` });
  const pedido = {
    contents: [...historial, { role: "user", parts: partes }],
    generationConfig: { responseMimeType: "application/json", responseSchema: ESQUEMA, temperature: 0.3 },
  };

  let ultimoError = "";
  const limite = Date.now() + 55000;
  for (const modelo of MODELOS) {
    if (Date.now() > limite - 3000) break;
    const llamar = (c: unknown) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": clave },
      body: JSON.stringify(c),
      signal: AbortSignal.timeout(Math.max(3000, Math.min(40000, limite - Date.now()))),
    }).catch((e) => new Response(String(e), { status: 599 }));
    let r = await llamar({ ...pedido, generationConfig: { ...pedido.generationConfig, thinkingConfig: { thinkingLevel: "low" } } });
    if (r.status === 400 && (await r.clone().text()).toLowerCase().includes("thinking")) r = await llamar(pedido);
    if (r.status === 429) return json({ error: "limite" }, 429);
    if (!r.ok) { ultimoError = `${modelo}: ${r.status} ${(await r.text()).slice(0, 160)}`; console.log("gemini", ultimoError); continue; }
    const j = await r.json();
    const salida = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    try { return json({ modelo, ...limpiar(JSON.parse(salida)) }); } catch { ultimoError = "respuesta"; }
  }
  return json({ error: "gemini", detalle: ultimoError }, 502);
});
