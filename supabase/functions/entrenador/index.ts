// Entrenador IA de Bloque: arma o ajusta rutinas de gym conversando.
// Sabe el deporte del hogar (para no sumar fatiga donde el deporte ya carga), el objetivo de cada uno,
// el catálogo de ejercicios del gym y las rutinas que ya tienen. Devuelve la respuesta y las rutinas propuestas.
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

const INSTRUCCIONES = `Eres entrenador personal y preparador físico de deportistas, hablas en español de Ecuador, cercano y directo.
Armas y ajustas rutinas de gimnasio (Smart Fit: máquinas, poleas, mancuernas, Multipower, colchonetas) para las personas del contexto.

REGLAS DEL DEPORTE (lo más importante): el gym complementa el deporte, no le suma fatiga innecesaria.
- Roller derby, patinaje, hockey, ciclismo, esquí: el deporte ya carga muchísimo los cuádriceps (posición flexionada todo el rato).
  En piernas prioriza glúteos (hip thrust, empuje de cadera, abducción, patada de glúteo) e isquiotibiales (peso muerto rumano,
  curl femoral, buenos días), estabilidad a una pierna y core antirrotación. Cuádriceps: como mucho un ejercicio compuesto moderado
  (prensa con pies altos o sentadilla búlgara), nada de extensión de cuádriceps salvo que lo pidan.
- Para derby suma potencia y prevención: pliometría lateral (saltos de patinador, saltos laterales al cajón), aductores, tobillos,
  cuello y trapecios por los choques. Pliometría al inicio, cuando están frescos, 3 series cortas.
- Fútbol y deportes de carrera: isquios y prevención de rodilla; deportes de combate: cuello, agarre y core.
- No pongas piernas pesadas el día antes ni el mismo día del deporte; si la rutina es para un día de deporte, que sea liviana.

CÓMO RESPONDER:
- "respuesta": 1 a 4 frases explicando qué cambias y por qué, sin listas largas (la rutina ya se muestra aparte).
- Si piden cambiar una rutina existente, devuelve en "rutinas" esa rutina completa ya cambiada con accion "editar"
  y nombre_original igual al nombre que tiene. Si piden una nueva (o no tienen), accion "crear". Puedes devolver varias si piden una semana.
- Ejercicios: usa EXACTAMENTE los nombres del catálogo cuando exista algo equivalente. Solo inventa uno nuevo si de verdad hace falta
  (ej. pliometría), con un nombre claro en español y su grupo muscular; en "nota" una línea de cómo se hace.
- unidad "segundos" para isométricos (plancha) y "reps" para el resto; por_lado true si se hace con una pierna o brazo a la vez.
- Entre 4 y 8 ejercicios por rutina, series 2-5, reps 6-20 (o 20-60 s), descanso 45-150 s según objetivo.
- Si solo hacen una pregunta o charlan, responde y deja "rutinas" vacío.`;

const ESQUEMA = {
  type: "OBJECT",
  properties: {
    respuesta: { type: "STRING" },
    rutinas: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          accion: { type: "STRING", enum: ["editar", "crear"] },
          nombre_original: { type: "STRING" },
          nombre: { type: "STRING" },
          foco: { type: "STRING", enum: ["masa_muscular", "perder_grasa", "cardio", "fuerza", "recuperacion", "mixto"] },
          notas: { type: "STRING" },
          ejercicios: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                nombre: { type: "STRING" }, grupo_muscular: { type: "STRING" },
                series: { type: "NUMBER" }, reps: { type: "NUMBER" }, descanso_seg: { type: "NUMBER" },
                unidad: { type: "STRING", enum: ["reps", "segundos"] }, por_lado: { type: "BOOLEAN" }, nota: { type: "STRING" },
              },
              required: ["nombre", "grupo_muscular", "series", "reps"],
            },
          },
        },
        required: ["accion", "nombre", "ejercicios"],
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

const num = (v: unknown, min: number, max: number, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n))) : def;
};
const texto = (v: unknown, largo: number) => String(v ?? "").trim().slice(0, largo);
const lista = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n) : []) as Record<string, unknown>[];

function limpiar(d: Record<string, unknown>) {
  return {
    respuesta: texto(d.respuesta, 800),
    rutinas: lista(d.rutinas, 6).map((r) => ({
      accion: r.accion === "editar" ? "editar" : "crear",
      nombre_original: texto(r.nombre_original, 80) || null,
      nombre: texto(r.nombre, 80) || "Rutina",
      foco: ["masa_muscular", "perder_grasa", "cardio", "fuerza", "recuperacion", "mixto"].includes(String(r.foco)) ? r.foco : "mixto",
      notas: texto(r.notas, 200) || null,
      ejercicios: lista(r.ejercicios, 12).map((e) => {
        const unidad = e.unidad === "segundos" ? "segundos" : "reps";
        return {
          nombre: texto(e.nombre, 80), grupo_muscular: texto(e.grupo_muscular, 40) || "General",
          series: num(e.series, 1, 8, 3), reps: unidad === "segundos" ? num(e.reps, 10, 180, 30) : num(e.reps, 1, 50, 10),
          descanso_seg: num(e.descanso_seg, 0, 300, 90), unidad, por_lado: e.por_lado === true, nota: texto(e.nota, 200) || null,
        };
      }).filter((e) => e.nombre),
    })).filter((r) => r.ejercicios.length),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "metodo" }, 405);
  let cuerpo: { mensaje?: string; contexto?: unknown; historial?: { rol?: string; texto?: string }[] };
  try { cuerpo = await req.json(); } catch { return json({ error: "formato" }, 400); }
  if (!esUsuario(req)) return json({ error: "sesion" }, 401);
  const mensaje = texto(cuerpo.mensaje, 1200);
  if (!mensaje) return json({ error: "texto" }, 400);
  const clave = await leerClave().catch(() => null);
  if (!clave) return json({ error: "sin_clave" }, 503);

  const historial = lista(cuerpo.historial, 10).map((h) => ({
    role: h.rol === "ia" ? "model" : "user",
    parts: [{ text: texto(h.texto, 1500) }],
  })).filter((h) => h.parts[0].text);
  const contents = [
    { role: "user", parts: [{ text: `${INSTRUCCIONES}\n\nContexto: ${JSON.stringify(cuerpo.contexto ?? {}).slice(0, 14000)}` }] },
    { role: "model", parts: [{ text: '{"respuesta":"Listo, conozco su contexto. ¿Qué ajustamos?","rutinas":[]}' }] },
    ...historial,
    { role: "user", parts: [{ text: mensaje }] },
  ];
  const pedido = { contents, generationConfig: { responseMimeType: "application/json", responseSchema: ESQUEMA, temperature: 0.4 } };

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
