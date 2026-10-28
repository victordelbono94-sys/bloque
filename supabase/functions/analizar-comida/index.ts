// Analiza la foto de una comida con Gemini (capa gratis) y devuelve qué hay en el
// plato, cuántos gramos aproximados y sus valores por 100 g. La clave de Gemini vive
// solo aquí (secreto GEMINI_API_KEY), nunca en la app.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MODELOS = (Deno.env.get("GEMINI_MODELO") ?? "gemini-flash-latest,gemini-3-flash-preview,gemini-3.1-flash-lite")
  .split(",").map((m) => m.trim()).filter(Boolean);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });

const INSTRUCCION = `Eres nutricionista. Mira la foto de la comida (en Ecuador, puede ser comida casera ecuatoriana).
Identifica cada alimento por separado y estima los gramos que se ven en el plato o los platos
(si hay dos platos, suma ambos). Para cada alimento da sus valores nutricionales por 100 g tal como está
servido (cocido, frito, etc.). Usa nombres simples en español: "Arroz blanco cocido", "Pechuga de pollo cocida",
"Plátano maduro frito", "Aguacate". Si no ves comida, devuelve la lista vacía.`;

const ESQUEMA = {
  type: "OBJECT",
  properties: {
    descripcion: { type: "STRING" },
    alimentos: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          nombre: { type: "STRING" },
          gramos: { type: "NUMBER" },
          kcal_100g: { type: "NUMBER" },
          proteina_100g: { type: "NUMBER" },
          carbohidratos_100g: { type: "NUMBER" },
          grasas_100g: { type: "NUMBER" },
        },
        required: ["nombre", "gramos", "kcal_100g", "proteina_100g", "carbohidratos_100g", "grasas_100g"],
      },
    },
  },
  required: ["alimentos"],
};

const limitar = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n)) * 10) / 10 : min;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "metodo" }, 405);

  const clave = Deno.env.get("GEMINI_API_KEY");
  if (!clave) return json({ error: "sin_clave" }, 503);

  let cuerpo: { imagen?: string; tipo?: string; nota?: string };
  try { cuerpo = await req.json(); } catch { return json({ error: "formato" }, 400); }
  const imagen = cuerpo.imagen ?? "";
  const tipo = /^image\/(jpeg|png|webp)$/.test(cuerpo.tipo ?? "") ? cuerpo.tipo! : "image/jpeg";
  if (!imagen || imagen.length > 2_800_000 || !/^[A-Za-z0-9+/=]+$/.test(imagen)) return json({ error: "imagen" }, 400);
  const nota = (cuerpo.nota ?? "").slice(0, 200);

  const pedido = {
    contents: [{
      role: "user",
      parts: [
        { text: INSTRUCCION + (nota ? `\nDato de quien comió: ${nota}` : "") },
        { inline_data: { mime_type: tipo, data: imagen } },
      ],
    }],
    generationConfig: { responseMimeType: "application/json", responseSchema: ESQUEMA, temperature: 0.2 },
  };

  let ultimoError = "";
  for (const modelo of MODELOS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": clave },
      body: JSON.stringify(pedido),
    });
    if (r.status === 429) return json({ error: "limite" }, 429);
    if (!r.ok) {
      // Modelo que ya no existe u otro error: se prueba con el siguiente.
      ultimoError = `${modelo}: ${r.status} ${(await r.text()).slice(0, 160)}`;
      continue;
    }
    const j = await r.json();
    const texto = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    try {
      const datos = JSON.parse(texto);
      const alimentos = (Array.isArray(datos.alimentos) ? datos.alimentos : []).slice(0, 12).map((a: Record<string, unknown>) => ({
        nombre: String(a.nombre ?? "Alimento").slice(0, 120),
        gramos: limitar(a.gramos, 1, 2000),
        kcal: limitar(a.kcal_100g, 0, 950),
        proteina_g: limitar(a.proteina_100g, 0, 100),
        carbohidratos_g: limitar(a.carbohidratos_100g, 0, 100),
        grasas_g: limitar(a.grasas_100g, 0, 100),
      }));
      return json({ modelo, descripcion: String(datos.descripcion ?? "").slice(0, 200), alimentos });
    } catch {
      ultimoError = "respuesta";
    }
  }
  return json({ error: "gemini", detalle: ultimoError }, 502);
});
