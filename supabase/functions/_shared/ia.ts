// IA con respaldo: Gemini (principal, la mejor con fotos) → Groq → Mistral.
// Todas las funciones de Bloq piden con el formato de Gemini (contents + esquema) y este módulo
// lo traduce para los otros proveedores. Las claves se leen de privado.secretos (nunca del cliente).
// Cada consulta queda anotada en public.uso_ia (quién, función, proveedor, si salió bien, cuánto tardó).

type Parte = { text?: string; inline_data?: { mime_type: string; data: string } };
export type Contenido = { role: string; parts: Parte[] };

export type Resultado =
  | { ok: true; datos: Record<string, unknown>; texto: string; proveedor: string; modelo: string }
  | { ok: false; error: "sin_clave" | "limite" | "ia" | "apagada"; detalle: string };

/** Respuesta de error estándar para las funciones (la app la entiende igual en todas). */
export function errorIA(r: { error: string; detalle: string }) {
  return { cuerpo: { error: r.error === "ia" ? "gemini" : r.error, detalle: r.detalle },
    estado: r.error === "limite" ? 429 : r.error === "apagada" ? 403 : r.error === "sin_clave" ? 503 : 502 };
}

const URL_SB = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Qué interruptor de Ajustes apaga cada función (personas.ia_funciones: {"comida": false, ...}).
const INTERRUPTOR: Record<string, string> = {
  plato: "comida", comida_foto: "comida", comida_texto: "comida", comida_despensa: "comida",
  comida_ideas: "ideas", comida_consejo: "ideas", cuerpo: "cuerpo", entrenador: "entrenador", objetivos: "entrenador", micros: "micros",
};
async function apagada(usuario: string | null, funcion: string): Promise<boolean> {
  const k = INTERRUPTOR[funcion];
  if (!k || !usuario || !URL_SB || !SERVICIO) return false;
  try {
    const r = await fetch(`${URL_SB}/rest/v1/personas?id=eq.${usuario}&select=ia_funciones`, {
      signal: AbortSignal.timeout(5000), headers: { apikey: SERVICIO, Authorization: `Bearer ${SERVICIO}` },
    });
    if (!r.ok) return false;
    const [p] = await r.json();
    return p?.ia_funciones?.[k] === false;
  } catch { return false; }
}


const GEMINI = (Deno.env.get("GEMINI_MODELO") ?? "gemini-3.1-flash-lite,gemini-3-flash-preview,gemini-flash-latest,gemini-2.5-flash,gemini-2.5-flash-lite")
  .split(",").map((m) => m.trim()).filter(Boolean);
const GROQ_TEXTO = Deno.env.get("GROQ_MODELO") ?? "openai/gpt-oss-120b";
const GROQ_FOTO = Deno.env.get("GROQ_MODELO_FOTO") ?? "qwen/qwen3.8-27b";
const MISTRAL = Deno.env.get("MISTRAL_MODELO") ?? "mistral-small-latest";

const claves = new Map<string, string>();
async function clave(nombre: string): Promise<string | null> {
  if (claves.has(nombre)) return claves.get(nombre)!;
  let v: string | null = Deno.env.get(nombre) ?? null;
  if (!v && URL_SB && SERVICIO) {
    try {
      const r = await fetch(`${URL_SB}/rest/v1/rpc/secreto_servidor`, {
        method: "POST", signal: AbortSignal.timeout(8000),
        headers: { "Content-Type": "application/json", apikey: SERVICIO, Authorization: `Bearer ${SERVICIO}` },
        body: JSON.stringify({ p_nombre: nombre }),
      });
      if (r.ok) { const j = await r.json(); v = typeof j === "string" && j ? j : null; }
    } catch { v = null; }
  }
  if (v) claves.set(nombre, v); // lo que falta se vuelve a buscar (por si se carga la clave después)
  return v;
}

/** Usuario (sub del JWT) si la petición viene de una sesión iniciada. */
export function usuarioDe(req: Request): string | null {
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const d = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return d.role === "authenticated" && typeof d.sub === "string" ? d.sub : null;
  } catch { return null; }
}

function anotar(usuario: string | null, funcion: string, proveedor: string, modelo: string, ok: boolean, ms: number, detalle = "") {
  if (!URL_SB || !SERVICIO) return Promise.resolve();
  return fetch(`${URL_SB}/rest/v1/uso_ia`, {
    method: "POST", signal: AbortSignal.timeout(5000),
    headers: { "Content-Type": "application/json", apikey: SERVICIO, Authorization: `Bearer ${SERVICIO}`, Prefer: "return=minimal" },
    body: JSON.stringify({ usuario, funcion, proveedor, modelo, ok, ms, detalle: detalle.slice(0, 200) || null }),
  }).then(() => {}, () => {});
}

// ---------- Esquema de Gemini → JSON Schema (para pedírselo en texto a Groq y Mistral) ----------
// deno-lint-ignore no-explicit-any
function aJsonSchema(s: any): any {
  if (!s || typeof s !== "object") return s;
  // deno-lint-ignore no-explicit-any
  const o: any = {};
  if (s.type) o.type = String(s.type).toLowerCase();
  if (s.enum) o.enum = s.enum;
  if (s.properties) o.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, aJsonSchema(v)]));
  if (s.items) o.items = aJsonSchema(s.items);
  if (s.required) o.required = s.required;
  if (s.description) o.description = s.description;
  return o;
}

/** Saca el primer objeto JSON de un texto (algunos modelos agregan texto o razonamiento alrededor). */
function sacarJson(t: string): Record<string, unknown> | null {
  const limpio = t.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "");
  try { const v = JSON.parse(limpio); if (v && typeof v === "object" && !Array.isArray(v)) return v; } catch { /* sigue */ }
  const a = limpio.indexOf("{"), b = limpio.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { const v = JSON.parse(limpio.slice(a, b + 1)); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
}

// Reglas que valen para todas las IA de Bloq (se agregan a cada consulta).
export const REGLAS_COMUNES = `Reglas de Bloq (siempre): eres orientativo y no reemplazas a un médico, nutricionista ni otro profesional de la salud. `
  + `Si el tema es una lesión o dolor, suplementos, una dieta muy restrictiva, bajar de peso rápido, embarazo, una enfermedad o medicación, `
  + `recomienda en una frase consultar a un profesional. Nunca sugieras déficits muy grandes, ayunos largos ni dosis de suplementos. `
  + `Si el objetivo de la persona es ganar masa muscular o subir de peso, su meta de calorías es un MÍNIMO: pasarse no es malo y no se la reta; `
  + `anímala a llegar, con proteína suficiente y grasas de calidad (aceite de oliva, frutos secos, palta), sin culpa por algo menos sano de vez en cuando. `
  + `No digas "lo anoto", "guardado" ni "listo, registrado": la app confirma por su cuenta lo que se guarda.`;

const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

type Intento = { estado: number; texto?: string; error?: string };

// ---------- Gemini ----------
async function gemini(modelo: string, k: string, contents: Contenido[], esquema: unknown, temperatura: number, ms: number): Promise<Intento> {
  const config = { responseMimeType: "application/json", responseSchema: esquema, temperature: temperatura };
  const llamar = (generationConfig: unknown) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
    method: "POST", signal: AbortSignal.timeout(ms),
    headers: { "Content-Type": "application/json", "x-goog-api-key": k },
    body: JSON.stringify({ contents, generationConfig }),
  }).catch((e) => new Response(String(e), { status: 599 }));
  let r = await llamar({ ...config, thinkingConfig: { thinkingLevel: "low" } });
  if (r.status === 400 && (await r.clone().text()).toLowerCase().includes("thinking")) r = await llamar(config);
  if (!r.ok) return { estado: r.status, error: (await r.text()).slice(0, 160) };
  const j = await r.json();
  const texto = j?.candidates?.[0]?.content?.parts?.map((p: Parte) => p.text ?? "").join("") ?? "";
  return { estado: 200, texto };
}

// ---------- Groq y Mistral (formato OpenAI) ----------
function aMensajes(contents: Contenido[], esquema: unknown, conFotos: boolean) {
  const sistema = `Responde SOLO con un objeto JSON válido (sin texto antes ni después, sin markdown) que cumpla este JSON Schema. `
    + `Usa exactamente esos nombres de campos y, en los campos con "enum", solo esos valores. Escribe los textos en español.\n${JSON.stringify(aJsonSchema(esquema))}`;
  return [
    { role: "system", content: sistema },
    ...contents.map((c) => {
      const role = c.role === "model" ? "assistant" : "user";
      const texto = c.parts.map((p) => p.text ?? "").filter(Boolean).join("\n");
      const fotos = conFotos && role === "user" ? c.parts.filter((p) => p.inline_data?.mime_type?.startsWith("image/")) : [];
      if (!fotos.length) return { role, content: texto };
      return { role, content: [
        { type: "text", text: texto },
        ...fotos.map((p) => ({ type: "image_url", image_url: { url: `data:${p.inline_data!.mime_type};base64,${p.inline_data!.data}` } })),
      ] };
    }),
  ];
}

async function openai(url: string, k: string, modelo: string, mensajes: unknown, temperatura: number, ms: number): Promise<Intento> {
  const r = await fetch(url, {
    method: "POST", signal: AbortSignal.timeout(ms),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` },
    body: JSON.stringify({ model: modelo, messages: mensajes, temperature: temperatura, response_format: { type: "json_object" }, max_tokens: 4096 }),
  }).catch((e) => new Response(String(e), { status: 599 }));
  if (!r.ok) return { estado: r.status, error: (await r.text()).slice(0, 160) };
  const j = await r.json();
  return { estado: 200, texto: String(j?.choices?.[0]?.message?.content ?? "") };
}

/**
 * Pide una respuesta JSON a la IA, con respaldo entre proveedores.
 * - contents: formato de Gemini (role user/model; parts con text o inline_data).
 * - esquema: responseSchema de Gemini (también se le pasa como JSON Schema a Groq y Mistral).
 * - valido(datos): si devuelve false, la respuesta se descarta y se prueba con el siguiente.
 */
export async function pedirIA(o: {
  req: Request; funcion: string; contents: Contenido[]; esquema: unknown; temperatura?: number; limiteMs?: number;
  valido?: (d: Record<string, unknown>) => boolean;
}): Promise<Resultado> {
  const usuario = usuarioDe(o.req);
  // Las reglas comunes van al principio del primer mensaje del usuario.
  const i0 = o.contents.findIndex((c) => c.role === "user");
  if (i0 >= 0) o = { ...o, contents: o.contents.map((c, i) => (i === i0 ? { ...c, parts: [{ text: REGLAS_COMUNES }, ...c.parts] } : c)) };
  const temperatura = o.temperatura ?? 0.3;
  const fin = Date.now() + (o.limiteMs ?? 55000);
  const queda = (max: number) => Math.max(3000, Math.min(max, fin - Date.now()));
  const partes = o.contents.flatMap((c) => c.parts);
  const conImagen = partes.some((p) => p.inline_data?.mime_type?.startsWith("image/"));
  const conOtroArchivo = partes.some((p) => p.inline_data && !p.inline_data.mime_type.startsWith("image/"));
  let limites = 0;
  const errores: string[] = [];

  const probar = async (proveedor: string, modelo: string, intento: () => Promise<Intento>): Promise<Resultado | null> => {
    const t0 = Date.now();
    let r = await intento();
    // Saturado o caído un momento: un reintento corto antes de pasar al siguiente.
    if ((r.estado === 503 || r.estado === 500 || r.estado === 599) && fin - Date.now() > 15000) { await espera(1200); r = await intento(); }
    if (r.estado === 200 && r.texto) {
      const datos = sacarJson(r.texto);
      if (datos && (!o.valido || o.valido(datos))) {
        anotar(usuario, o.funcion, proveedor, modelo, true, Date.now() - t0);
        return { ok: true, datos, texto: JSON.stringify(datos), proveedor, modelo };
      }
      r = { estado: 422, error: "respuesta no válida" };
    }
    if (r.estado === 429) limites++;
    errores.push(`${proveedor}/${modelo}: ${r.estado}`);
    anotar(usuario, o.funcion, proveedor, modelo, false, Date.now() - t0, `${r.estado} ${r.error ?? ""}`);
    console.log("ia", proveedor, modelo, r.estado, r.error ?? "");
    return null;
  };

  if (await apagada(usuario, o.funcion)) return { ok: false, error: "apagada", detalle: "" };
  const kG = await clave("GEMINI_API_KEY"), kQ = await clave("GROQ_API_KEY"), kM = await clave("MISTRAL_API_KEY");
  if (!kG && !kQ && !kM) return { ok: false, error: "sin_clave", detalle: "" };

  // 1) Gemini: se prueban sus modelos, pero sin gastar todo el tiempo (deja ~20 s para los respaldos).
  if (kG) {
    for (const modelo of GEMINI) {
      if (fin - Date.now() < 22000 && (kQ || kM) && !conOtroArchivo) break;
      if (fin - Date.now() < 4000) break;
      const r = await probar("gemini", modelo, () => gemini(modelo, kG, o.contents, o.esquema, temperatura, queda(25000)));
      if (r) return r;
    }
  }
  // Groq y Mistral no leen PDF: si hay un PDF, solo Gemini sirve.
  if (!conOtroArchivo) {
    // 2) Groq
    if (kQ && fin - Date.now() > 4000) {
      const modelo = conImagen ? GROQ_FOTO : GROQ_TEXTO;
      const r = await probar("groq", modelo, () => openai("https://api.groq.com/openai/v1/chat/completions", kQ, modelo,
        aMensajes(o.contents, o.esquema, conImagen), temperatura, queda(20000)));
      if (r) return r;
    }
    // 3) Mistral
    if (kM && fin - Date.now() > 4000) {
      const r = await probar("mistral", MISTRAL, () => openai("https://api.mistral.ai/v1/chat/completions", kM, MISTRAL,
        aMensajes(o.contents, o.esquema, conImagen), temperatura, queda(20000)));
      if (r) return r;
    }
  }
  const total = errores.length;
  return { ok: false, error: total && limites === total ? "limite" : "ia", detalle: errores.join(" · ") };
}

/** Anota una acción que se resolvió sin IA (para el contador de ahorro). */
export const anotarUso = anotar;
