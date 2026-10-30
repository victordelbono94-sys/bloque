// IA del plato que se está registrando: una sola conversación. Entiende comida nueva («2 huevos y pan»),
// órdenes sobre el plato («quita el arroz», «eran 150 g», «esto es para los dos», «la ensalada es de Sant»)
// y preguntas («¿me falta proteína?»). Devuelve los cambios a aplicar, la respuesta y sugerencias opcionales.
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

const PORCIONES = `Porciones típicas en Ecuador si no dicen gramos: 1 huevo 50 g, 1 clara 33 g, 1 taza de café 240 g,
1 vaso de leche 250 g, 1 taza de leche 240 g, 1 pan 50 g, 1 rebanada de pan de molde 30 g, 1 banana 120 g,
1 manzana 180 g, 1 cucharada de azúcar 12 g, 1 cucharadita de azúcar 4 g, 1 cucharada de aceite 13 g,
1 taza de arroz cocido 160 g, 1 plato de arroz 200 g, 1 porción de pollo 150 g, 1 yogur 170 g, 1 scoop de proteína 30 g,
1 lata de atún escurrido 120 g, 1 cucharada de queso rallado 6 g, 1 vaso de agua 250 g, 1 botella de agua 500 g, 1 taza de verduras 90 g.`;

const INSTRUCCIONES = `Eres nutricionista deportivo y ayudas a registrar UNA comida en una app (Ecuador). Hablas en español de Ecuador, breve y directo
(1 a 3 frases). El contexto trae el plato tal como está ahora (alimentos con gramos y de quién es cada uno: "compartido" o un nombre),
quién come, cómo se reparte, quién escribe, y para cada persona del hogar su objetivo y lo que le queda del día.

Lee el mensaje y decide:
1) Si cuenta comida o pide agregar algo ("2 huevos", "agrégale 100 g de queso", "también un café con leche"): ponlo en cambios.agregar
   con gramos y valores por 100 g. Si dice de quién es ("para Sant", "lo mío"), pon persona con el nombre exacto del hogar (o el de quien escribe).
2) Si corrige o quita ("quita el arroz", "eran 150 g de pollo", "el arroz era 200"): cambios.quitar (nombre exacto del plato)
   o cambios.ajustar (nombre exacto del plato y los gramos nuevos).
3) Si dice quién comió o cómo ("esto es para los dos", "comimos los dos", "solo yo", "cada uno su plato", "lo compartimos",
   "la ensalada es de Sant"): pon quien (nombres exactos del hogar; "yo" = quien escribe) y reparto
   ("compartido" se divide en partes iguales, "cada_uno" un plato igual por persona, "distinto" cada cosa a su dueño con cambios.asignar).
4) Si pregunta ("¿me falta proteína?", "está bien así", "qué le agrego") o pide revisar: responde con números frente a la meta de esta comida,
   mirando proteína, carbohidratos, grasas y verduras o fibra. Si falta algo, ofrece 1 a 3 "sugerencias" concretas (NO las agregues tú:
   la persona las toca para sumarlas). Si conviene repartir distinto entre el hogar, ponlo en reparto_sugerido.
Puede ser una mezcla (agregar y preguntar a la vez). Para líquidos gramos ≈ ml; el agua va como "Agua" con 0 kcal.
"Café con leche" = café y leche por separado. Nombres simples en español ("Arroz blanco cocido", "Pechuga de pollo a la plancha").
En "respuesta" di qué cambiaste y/o responde la pregunta. Nunca inventes alimentos que no dijo.
${PORCIONES}`;

const NUT = {
  kcal_100g: { type: "NUMBER" }, proteina_100g: { type: "NUMBER" }, carbohidratos_100g: { type: "NUMBER" }, grasas_100g: { type: "NUMBER" },
};
const REQ_NUT = ["kcal_100g", "proteina_100g", "carbohidratos_100g", "grasas_100g"];
const ESQUEMA = {
  type: "OBJECT",
  properties: {
    respuesta: { type: "STRING" },
    agregar: { type: "ARRAY", items: { type: "OBJECT", properties: { nombre: { type: "STRING" }, gramos: { type: "NUMBER" }, persona: { type: "STRING" }, cantidad: { type: "STRING" }, ...NUT }, required: ["nombre", "gramos", ...REQ_NUT] } },
    quitar: { type: "ARRAY", items: { type: "OBJECT", properties: { nombre: { type: "STRING" }, persona: { type: "STRING" } }, required: ["nombre"] } },
    ajustar: { type: "ARRAY", items: { type: "OBJECT", properties: { nombre: { type: "STRING" }, gramos: { type: "NUMBER" }, persona: { type: "STRING" } }, required: ["nombre", "gramos"] } },
    asignar: { type: "ARRAY", items: { type: "OBJECT", properties: { alimento: { type: "STRING" }, persona: { type: "STRING" }, gramos: { type: "NUMBER" } }, required: ["alimento", "persona", "gramos"] } },
    quien: { type: "ARRAY", items: { type: "STRING" } },
    reparto: { type: "STRING", enum: ["", "compartido", "cada_uno", "distinto"] },
    momento: { type: "STRING", enum: ["", "desayuno", "almuerzo", "merienda", "cena", "snack", "pre_entreno", "post_entreno"] },
    sugerencias: { type: "ARRAY", items: { type: "OBJECT", properties: { nombre: { type: "STRING" }, gramos: { type: "NUMBER" }, cantidad: { type: "STRING" }, ...NUT }, required: ["nombre", "gramos", ...REQ_NUT] } },
    reparto_sugerido: { type: "ARRAY", items: { type: "OBJECT", properties: { alimento: { type: "STRING" }, persona: { type: "STRING" }, gramos: { type: "NUMBER" } }, required: ["alimento", "persona", "gramos"] } },
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

const nut = (a: Record<string, unknown>) => ({
  kcal: Math.max(0, Math.min(950, Number(a.kcal_100g) || 0)),
  proteina_g: Math.max(0, Math.min(100, Number(a.proteina_100g) || 0)),
  carbohidratos_g: Math.max(0, Math.min(100, Number(a.carbohidratos_100g) || 0)),
  grasas_g: Math.max(0, Math.min(100, Number(a.grasas_100g) || 0)),
});
const alimento = (a: Record<string, unknown>) => ({
  nombre: texto(a.nombre, 120), gramos: num(a.gramos, 1, 3000, 100), persona: texto(a.persona, 60) || null, cantidad: texto(a.cantidad, 40) || null, ...nut(a),
});
const par = (a: Record<string, unknown>) => ({ alimento: texto(a.alimento, 120), persona: texto(a.persona, 60), gramos: num(a.gramos, 0, 3000, 0) });

function limpiar(d: Record<string, unknown>) {
  return {
    respuesta: texto(d.respuesta, 600),
    agregar: lista(d.agregar, 16).map(alimento).filter((a) => a.nombre),
    quitar: lista(d.quitar, 16).map((a) => ({ nombre: texto(a.nombre, 120), persona: texto(a.persona, 60) || null })).filter((a) => a.nombre),
    ajustar: lista(d.ajustar, 16).map((a) => ({ nombre: texto(a.nombre, 120), gramos: num(a.gramos, 1, 3000, 100), persona: texto(a.persona, 60) || null })).filter((a) => a.nombre),
    asignar: lista(d.asignar, 24).map(par).filter((a) => a.alimento && a.persona),
    quien: (Array.isArray(d.quien) ? d.quien : []).map((x) => texto(x, 60)).filter(Boolean).slice(0, 8),
    reparto: ["compartido", "cada_uno", "distinto"].includes(String(d.reparto)) ? d.reparto : null,
    momento: ["desayuno", "almuerzo", "merienda", "cena", "snack", "pre_entreno", "post_entreno"].includes(String(d.momento)) ? d.momento : null,
    sugerencias: lista(d.sugerencias, 3).map(alimento).filter((a) => a.nombre),
    reparto_sugerido: lista(d.reparto_sugerido, 24).map(par).filter((a) => a.alimento && a.persona),
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

  const historial = lista(cuerpo.historial, 8).map((h) => ({ role: h.rol === "ia" ? "model" : "user", parts: [{ text: texto(h.texto, 800) }] }))
    .filter((h) => h.parts[0].text);
  const contents = [
    ...historial,
    { role: "user", parts: [{ text: `${INSTRUCCIONES}\n\nContexto (el plato AHORA): ${JSON.stringify(cuerpo.contexto ?? {}).slice(0, 9000)}\n\nMensaje: ${mensaje}` }] },
  ];
  const pedido = { contents, generationConfig: { responseMimeType: "application/json", responseSchema: ESQUEMA, temperature: 0.3 } };

  let ultimoError = "";
  const limite = Date.now() + 55000;
  for (const modelo of MODELOS) {
    if (Date.now() > limite - 3000) break;
    const llamar = (c: unknown) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": clave },
      body: JSON.stringify(c),
      signal: AbortSignal.timeout(Math.max(3000, Math.min(30000, limite - Date.now()))),
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
