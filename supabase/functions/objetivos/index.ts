// IA de objetivos: la persona cuenta un cambio en su vida deportiva («no hago derby esta semana», «voy a ir 2 veces al gym»,
// «cambio a crossfit», «ahora quiero ganar músculo») y la IA lo traduce en acciones sobre su plan, que la persona confirma.
// La dieta y los entrenos se readaptan solos porque salen de la agenda, el objetivo y el deporte.
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

const INSTRUCCIONES = `Eres el coach de una app de entrenamiento y nutrición; hablas en español de Ecuador, cercano y breve (1 a 3 frases).
La persona te cuenta un cambio en su plan y tú lo conviertes en "acciones" que la app aplica cuando la persona confirma.
El contexto trae su deporte, su objetivo corporal, su experiencia, qué días va al gym y al deporte, la agenda de las próximas semanas,
los cambios que ya hizo, la lista de deportes posibles (clave y nombre) y las personas del hogar (los entrenos "juntos" son de todos).

Acciones posibles (pon solo las que correspondan):
- "pausa": no va a hacer una actividad entre dos fechas. actividad = "deporte" (su deporte, ej. derby), "gym" o "todo".
  desde/hasta en AAAA-MM-DD (hoy viene en el contexto; "una semana" = desde hoy 7 días; "este finde" = sábado y domingo).
- "frecuencia_gym": cambia cuántos días va al gym. dias = días de la semana (0 domingo … 6 sábado). Si dice solo un número
  ("2 veces"), elige días repartidos y que no caigan el mismo día o el día antes del deporte; dilo en la respuesta.
- "objetivo": foco = recomposicion (bajar grasa y ganar músculo), masa_muscular (ganar peso y músculo), perder_grasa, mantenimiento o cardio.
- "deporte": cambia de deporte; deporte = la clave exacta de la lista.
- "experiencia": principiante, intermedio o avanzado.
"quien": "yo" si es solo para quien escribe, "todos" si es para todo el hogar. Si hay más de una persona en el hogar y no queda claro
si el cambio es solo suyo o de todos (ej. "no vamos a derby" = todos; "no voy a derby" = yo), y la acción toca entrenos juntos, pregúntalo:
pon la pregunta en "duda", 2 opciones en "opciones" y no pongas acciones todavía.
En "resumen" de cada acción, una frase corta de lo que va a pasar ("Sin derby del 3 al 9 de noviembre").
En la respuesta di cómo se readapta lo demás: la dieta baja o sube calorías sola según los entrenos, y si cambia el deporte o la
frecuencia conviene ajustar las rutinas (la app lo ofrece). Si solo pregunta algo, responde y deja acciones vacío.`;

const ESQUEMA = {
  type: "OBJECT",
  properties: {
    respuesta: { type: "STRING" },
    duda: { type: "STRING" },
    opciones: { type: "ARRAY", items: { type: "STRING" } },
    acciones: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          tipo: { type: "STRING", enum: ["pausa", "frecuencia_gym", "objetivo", "deporte", "experiencia"] },
          actividad: { type: "STRING", enum: ["deporte", "gym", "todo"] },
          desde: { type: "STRING" }, hasta: { type: "STRING" },
          dias: { type: "ARRAY", items: { type: "NUMBER" } },
          foco: { type: "STRING", enum: ["recomposicion", "masa_muscular", "perder_grasa", "mantenimiento", "cardio"] },
          deporte: { type: "STRING" },
          experiencia: { type: "STRING", enum: ["principiante", "intermedio", "avanzado"] },
          quien: { type: "STRING", enum: ["yo", "todos"] },
          resumen: { type: "STRING" },
        },
        required: ["tipo", "resumen"],
      },
    },
  },
  required: ["respuesta"],
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
const fecha = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : null);

function limpiar(d: Record<string, unknown>) {
  return {
    respuesta: texto(d.respuesta, 700),
    duda: texto(d.duda, 200) || null,
    opciones: (Array.isArray(d.opciones) ? d.opciones : []).map((x) => texto(x, 60)).filter(Boolean).slice(0, 4),
    acciones: lista(d.acciones, 5).map((a) => ({
      tipo: String(a.tipo), actividad: ["deporte", "gym", "todo"].includes(String(a.actividad)) ? a.actividad : null,
      desde: fecha(a.desde), hasta: fecha(a.hasta),
      dias: [...new Set((Array.isArray(a.dias) ? a.dias : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))],
      foco: a.foco ?? null, deporte: /^[a-z_]{2,30}$/.test(String(a.deporte ?? "")) ? a.deporte : null,
      experiencia: a.experiencia ?? null, quien: a.quien === "todos" ? "todos" : "yo", resumen: texto(a.resumen, 160),
    })).filter((a) => ["pausa", "frecuencia_gym", "objetivo", "deporte", "experiencia"].includes(a.tipo)),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "metodo" }, 405);
  let cuerpo: { mensaje?: string; contexto?: unknown; historial?: { rol?: string; texto?: string }[] };
  try { cuerpo = await req.json(); } catch { return json({ error: "formato" }, 400); }
  if (!esUsuario(req)) return json({ error: "sesion" }, 401);
  const mensaje = texto(cuerpo.mensaje, 1000);
  if (!mensaje) return json({ error: "texto" }, 400);
  const clave = await leerClave().catch(() => null);
  if (!clave) return json({ error: "sin_clave" }, 503);
  const historial = lista(cuerpo.historial, 8).map((h) => ({ role: h.rol === "ia" ? "model" : "user", parts: [{ text: texto(h.texto, 800) }] }))
    .filter((h) => h.parts[0].text);
  const pedido = {
    contents: [...historial, { role: "user", parts: [{ text: `${INSTRUCCIONES}\n\nContexto: ${JSON.stringify(cuerpo.contexto ?? {}).slice(0, 12000)}\n\nMensaje: ${mensaje}` }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: ESQUEMA, temperature: 0.2 },
  };
  let ultimoError = "";
  const limite = Date.now() + 55000;
  for (const modelo of MODELOS) {
    if (Date.now() > limite - 3000) break;
    const llamar = (c: unknown) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": clave },
      body: JSON.stringify(c),
      signal: AbortSignal.timeout(Math.max(3000, Math.min(35000, limite - Date.now()))),
    }).catch((e) => new Response(String(e), { status: 599 }));
    let r = await llamar({ ...pedido, generationConfig: { ...pedido.generationConfig, thinkingConfig: { thinkingLevel: "low" } } });
    if (r.status === 400 && (await r.clone().text()).toLowerCase().includes("thinking")) r = await llamar(pedido);
    if (r.status === 429) return json({ error: "limite" }, 429);
    if (!r.ok) { ultimoError = `${modelo}: ${r.status}`; continue; }
    const j = await r.json();
    const salida = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    try { return json({ modelo, ...limpiar(JSON.parse(salida)) }); } catch { ultimoError = "respuesta"; }
  }
  return json({ error: "gemini", detalle: ultimoError }, 502);
});
