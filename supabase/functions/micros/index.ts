// Micronutrientes de los alimentos (por 100 g): potasio, magnesio, sodio, calcio, hierro, zinc, vitaminas C, D y B12,
// omega-3 (EPA+DHA) y fibra. Recibe ids de alimentos, lee con la sesión del usuario (así solo ve los suyos o el catálogo base),
// estima los que faltan con Gemini y los guarda con la service role (el catálogo base no lo puede editar el usuario).
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

const CAMPOS: Record<string, [number, number]> = {
  potasio_mg: [0, 6000], magnesio_mg: [0, 800], sodio_mg: [0, 40000], calcio_mg: [0, 2000], hierro_mg: [0, 60],
  zinc_mg: [0, 80], vitamina_c_mg: [0, 2000], vitamina_d_ug: [0, 300], b12_ug: [0, 100], omega3_mg: [0, 30000], fibra_g: [0, 90],
};

const INSTRUCCIONES = `Eres nutricionista. Para cada alimento de la lista (comidas de Ecuador, tal como se comen: cocido si dice cocido,
frito si dice frito, bebida preparada si es bebida), estima su contenido POR 100 g usando tablas de composición (USDA, tabla del INCAP/Ecuador).
Campos: potasio_mg, magnesio_mg, sodio_mg (incluye la sal típica de la preparación casera si es un plato salado), calcio_mg, hierro_mg, zinc_mg,
vitamina_c_mg, vitamina_d_ug (microgramos), b12_ug (microgramos), omega3_mg (solo EPA+DHA, de pescados y mariscos; 0 en vegetales), fibra_g.
Si es agua o café negro, casi todo 0. Usa los macros que vienen como pista del tipo de alimento. Devuelve "i" igual al índice que viene.`;

const ESQUEMA = {
  type: "OBJECT",
  properties: {
    alimentos: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { i: { type: "NUMBER" }, ...Object.fromEntries(Object.keys(CAMPOS).map((k) => [k, { type: "NUMBER" }])) },
        required: ["i", ...Object.keys(CAMPOS)],
      },
    },
  },
  required: ["alimentos"],
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "metodo" }, 405);
  let cuerpo: { ids?: unknown };
  try { cuerpo = await req.json(); } catch { return json({ error: "formato" }, 400); }
  if (!esUsuario(req)) return json({ error: "sesion" }, 401);
  const ids = (Array.isArray(cuerpo.ids) ? cuerpo.ids : []).map(String).filter((x) => UUID.test(x)).slice(0, 30);
  if (!ids.length) return json({ micros: {} });

  const url = Deno.env.get("SUPABASE_URL")!, servicio = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anon = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  // Con la sesión del usuario: RLS deja ver solo el catálogo base y los alimentos de su hogar.
  const r = await fetch(`${url}/rest/v1/alimentos?select=id,nombre,marca,kcal,proteina_g,carbohidratos_g,grasas_g,micros&id=in.(${ids.join(",")})`, {
    headers: { apikey: anon, Authorization: req.headers.get("Authorization") ?? "" },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return json({ error: "lectura", detalle: (await r.text()).slice(0, 200) }, 502);
  const filas = await r.json() as Record<string, unknown>[];
  const listos: Record<string, unknown> = {};
  for (const f of filas) if (f.micros) listos[f.id as string] = f.micros;
  const faltan = filas.filter((f) => !f.micros);
  if (!faltan.length) return json({ micros: listos });

  const clave = await leerClave().catch(() => null);
  if (!clave) return json({ error: "sin_clave" }, 503);
  const lista = faltan.map((f, i) => ({ i, nombre: f.nombre, marca: f.marca ?? undefined, kcal: f.kcal, prot: f.proteina_g, carb: f.carbohidratos_g, grasa: f.grasas_g }));
  const pedido = {
    contents: [{ role: "user", parts: [{ text: INSTRUCCIONES }, { text: `Alimentos: ${JSON.stringify(lista)}` }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: ESQUEMA, temperature: 0.1 },
  };
  let ultimoError = "";
  const limite = Date.now() + 50000;
  for (const modelo of MODELOS) {
    if (Date.now() > limite - 3000) break;
    const llamar = (c: unknown) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": clave },
      body: JSON.stringify(c),
      signal: AbortSignal.timeout(Math.max(3000, Math.min(35000, limite - Date.now()))),
    }).catch((e) => new Response(String(e), { status: 599 }));
    let g = await llamar({ ...pedido, generationConfig: { ...pedido.generationConfig, thinkingConfig: { thinkingLevel: "low" } } });
    if (g.status === 400 && (await g.clone().text()).toLowerCase().includes("thinking")) g = await llamar(pedido);
    if (g.status === 429) return json({ error: "limite", micros: listos }, 429);
    if (!g.ok) { ultimoError = `${modelo}: ${g.status}`; continue; }
    const j = await g.json();
    const salida = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    let datos: { alimentos?: Record<string, unknown>[] };
    try { datos = JSON.parse(salida); } catch { ultimoError = "respuesta"; continue; }
    for (const a of datos.alimentos ?? []) {
      const f = faltan[Number(a.i)];
      if (!f) continue;
      const m: Record<string, number> = {};
      for (const [k, [min, max]] of Object.entries(CAMPOS)) {
        const n = Number(a[k]);
        m[k] = Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n)) * 10) / 10 : 0;
      }
      const w = await fetch(`${url}/rest/v1/alimentos?id=eq.${f.id}`, {
        method: "PATCH",
        headers: { apikey: servicio, Authorization: `Bearer ${servicio}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ micros: m }),
      });
      if (w.ok) listos[f.id as string] = m;
    }
    return json({ modelo, micros: listos });
  }
  return json({ error: "gemini", detalle: ultimoError, micros: listos }, 502);
});
