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
2) Si quita algo ("quita el arroz", "no comí la papa"): cambios.quitar (nombre exacto del plato).
   Si corrige la cantidad ("eran 150 g de pollo", "el arroz era 200"): cambios.ajustar (nombre exacto y gramos nuevos).
   Si corrige QUÉ alimento era ("no era yuca, eran papas fritas", "era arroz con lenteja, no con menestra", "cámbialo por…"):
   es un REEMPLAZO: pon el viejo en cambios.quitar Y el nuevo en cambios.agregar, con los mismos gramos que tenía el viejo
   (o los que diga) y los valores por 100 g del alimento nuevo. Nunca quites sin agregar el reemplazo.
3) Si dice quién comió o cómo ("esto es para los dos", "comimos los dos", "solo yo", "cada uno su plato", "lo compartimos",
   "la ensalada es de Sant"): pon quien (nombres exactos del hogar; "yo" = quien escribe) y reparto
   ("compartido" se divide en partes iguales, "cada_uno" un plato igual por persona, "distinto" cada cosa a su dueño con cambios.asignar).
   OJO con "cada_uno": significa que CADA persona come el plato ENTERO tal como está. Si el plato tiene 2 pizzas y dicen
   "una pizza cada uno", eso es repartir el plato entre los dos ("compartido"), NO "cada_uno" (que serían 2 pizzas para cada uno).
4) Si pregunta ("¿me falta proteína?", "está bien así", "qué le agrego") o pide revisar: responde con números frente a la meta de esta comida,
   mirando proteína, carbohidratos, grasas y verduras o fibra. Si falta algo, ofrece 1 a 3 "sugerencias" concretas (NO las agregues tú:
   la persona las toca para sumarlas). Si conviene repartir distinto entre el hogar, ponlo en reparto_sugerido.
NO ASUMAS: si algo es ambiguo y cambia los números, pregunta antes en vez de adivinar, y NO apliques esa parte todavía
(sí aplica lo que esté claro). Ejemplos de dudas: "la foto era para los dos" (¿un plato compartido o uno igual para cada uno?),
"come Sant también" sin decir cuánto, "agrega arroz" sin cantidad cuando no hay forma razonable de estimarla, a quién le toca algo.
Pon la duda en "duda" (una pregunta corta) y 2 a 4 respuestas posibles en "opciones" (frases cortas que la persona pueda tocar,
ej. "Un plato para compartir", "Un plato igual para cada uno"). Si no hay dudas, deja "duda" vacío y "opciones" vacío.
Usa el historial: si la persona responde a tu duda, aplica lo que corresponde.
AGUA: lo que se toma cuenta para la hidratación del día. Bebidas aparte (agua, café, jugo, leche…). Sopas, caldos, ramen, locro,
encebollado, sancocho, consomé, crema: sepáralos en el líquido con nombre que empiece por "Caldo de …" o "Sopa de …" (gramos ≈ ml,
con sus kcal; un plato hondo de caldo ≈ 350-450 ml) y lo sólido aparte (fideos, carne, huevo, verduras). Si en el plato ya hay una sopa
o un ramen como un solo alimento, corrígelo así (quitar + agregar). Cuando sumes líquido, dilo en la respuesta ("el caldo suma ~400 ml de agua").
Puede ser una mezcla (agregar y preguntar a la vez). Para líquidos gramos ≈ ml; el agua va como "Agua" con 0 kcal.
"Café con leche" = café y leche por separado. Nombres simples en español ("Arroz blanco cocido", "Pechuga de pollo a la plancha").
En "respuesta" di qué cambiaste y/o responde la pregunta. Nunca inventes alimentos que no dijo.
DIETA: el contexto trae "dieta" (cómo come la persona). Respétala siempre: si es vegetariana o vegana no sugieras carne ni pescado
(ni lácteos o huevo si es vegana), respeta restricciones y alergias, y evita lo que no le gusta. Si dice que no la dijo todavía,
no asumas que come carne: sugiere opciones variadas (huevos, legumbres, lácteos, pollo o pescado) y deja que elija.
VITAMINAS Y MINERALES: si el contexto trae "vitaminas_minerales_bajos_esta_semana", al sugerir o revisar prefiere alimentos que los aporten
(usa la lista que viene, adaptada a lo que hay en la despensa) y dilo en una frase corta ("súmale aguacate: esta semana vas bajo en potasio").
No lo menciones si no viene al caso. Nunca recomiendes suplementos con dosis; para hierro, vitamina D o B12 sugiere confirmarlo con un examen.
LOS NÚMEROS DE VERDAD: diagnostico_de_la_app y le_toca_de_este_plato_ahora son del plato ANTES de lo que cambies en este mensaje.
Si cambias el plato, quién come o el reparto, calcula cuánto le toca a CADA persona con lo nuevo y compáralo con
le_quedan_en_el_dia_sin_este_plato de cada uno (en hogar). Nunca digas "está bien" sin hacer esa cuenta para cada uno.
MUCHA COMIDA: si a alguien su parte le pasa claramente de lo que le queda en el día (más de ~400 kcal si su objetivo es ganar masa,
~200 si es recomposición, ~100 si es bajar de peso), díselo con números y propone cuánto comer cada uno y cuánto guardar para
otro día como sobra (ej. "Coman una pizza entre los dos y guarden la otra para el almuerzo de mañana"). Ofrécelo en "opciones"
(ej. "Sí, guardar 1 pizza para mañana") y NO lo apliques hasta que acepte. Cuando acepte o lo pida ("guarda la mitad para mañana",
"lo que sobre es para mañana"), pon en guardar_sobras el nombre exacto del alimento del plato y cuántos gramos se guardan
(la app los saca del plato y los guarda como sobra), y ajusta quién come y el reparto de lo que queda.
SOBRAS: el contexto trae "sobras" (comida ya hecha que guardaron). Si dice "las sobras", "lo que sobró de anoche", "la pizza de ayer",
agrégalo con despensa = el nombre exacto de la sobra y gramos = lo que quede (o lo que diga), y valores por 100 g iguales a los de la sobra.
Si hay varias sobras y no queda claro cuál, pregunta en "duda" con una opción por sobra.
DESPENSA: el contexto trae "despensa" (lo que hay en casa, con su nombre exacto y cuánto queda). Si la persona dice que lo cocinó o lo sacó
de la despensa ("lo hice con lo de la despensa", "usé el arroz de la casa", "todo de la despensa", "los huevos son de la despensa"),
en cada alimento de agregar que salga de un producto de la despensa pon despensa = el nombre EXACTO de ese producto y
gramos_despensa = cuánto se gasta de ese producto tal como está guardado (si está crudo y el plato va cocido, conviértelo:
200 g de arroz cocido ≈ 70 g de arroz crudo, 150 g de fideos cocidos ≈ 60 g secos, 1 taza de lenteja cocida ≈ 70 g secas).
Si eso aplica a lo que YA está en el plato, ponlo en cambios.de_despensa (nombre del plato, producto de la despensa y gramos_despensa).
Si no lo dice, no asumas que salió de la despensa.
GUARDAR EN LA DESPENSA: si dice que algo NO lo come ahora sino que es para guardar en casa ("esta docena de huevos es para la despensa",
"compré 1 kg de arroz", "guarda esto en la despensa", "lo demás es para la casa"), NO lo pongas en agregar: ponlo en a_despensa con
envases (cuántos) y gramos_envase (cuánto pesa cada uno: 1 huevo 50 g, una docena = 12 × 50 g, 1 funda de arroz 1000 g, 1 litro de leche 1000 g)
y sus valores por 100 g. Si ese alimento ya estaba en el plato, ponlo también en quitar. En la respuesta di que queda para la despensa.
DEPORTE: adapta lo que sugieres al deporte del contexto y a los entrenos del día (deportes largos o de mucho sudor: carbohidratos, líquidos y sal/electrolitos;
fuerza: proteína repartida).
${PORCIONES}`;

const NUT = {
  kcal_100g: { type: "NUMBER" }, proteina_100g: { type: "NUMBER" }, carbohidratos_100g: { type: "NUMBER" }, grasas_100g: { type: "NUMBER" },
};
const REQ_NUT = ["kcal_100g", "proteina_100g", "carbohidratos_100g", "grasas_100g"];
const ESQUEMA = {
  type: "OBJECT",
  properties: {
    respuesta: { type: "STRING" },
    agregar: { type: "ARRAY", items: { type: "OBJECT", properties: { nombre: { type: "STRING" }, gramos: { type: "NUMBER" }, persona: { type: "STRING" }, cantidad: { type: "STRING" }, despensa: { type: "STRING" }, gramos_despensa: { type: "NUMBER" }, ...NUT }, required: ["nombre", "gramos", ...REQ_NUT] } },
    de_despensa: { type: "ARRAY", items: { type: "OBJECT", properties: { nombre: { type: "STRING" }, despensa: { type: "STRING" }, gramos_despensa: { type: "NUMBER" } }, required: ["nombre", "despensa"] } },
    guardar_sobras: { type: "ARRAY", items: { type: "OBJECT", properties: { nombre: { type: "STRING" }, gramos: { type: "NUMBER" } }, required: ["nombre", "gramos"] } },
    a_despensa: { type: "ARRAY", items: { type: "OBJECT", properties: { nombre: { type: "STRING" }, envases: { type: "NUMBER" }, gramos_envase: { type: "NUMBER" }, ...NUT }, required: ["nombre", "envases", "gramos_envase", ...REQ_NUT] } },
    quitar: { type: "ARRAY", items: { type: "OBJECT", properties: { nombre: { type: "STRING" }, persona: { type: "STRING" } }, required: ["nombre"] } },
    ajustar: { type: "ARRAY", items: { type: "OBJECT", properties: { nombre: { type: "STRING" }, gramos: { type: "NUMBER" }, persona: { type: "STRING" } }, required: ["nombre", "gramos"] } },
    asignar: { type: "ARRAY", items: { type: "OBJECT", properties: { alimento: { type: "STRING" }, persona: { type: "STRING" }, gramos: { type: "NUMBER" } }, required: ["alimento", "persona", "gramos"] } },
    quien: { type: "ARRAY", items: { type: "STRING" } },
    reparto: { type: "STRING", enum: ["sin_cambio", "compartido", "cada_uno", "distinto"] },
    momento: { type: "STRING", enum: ["sin_cambio", "desayuno", "almuerzo", "merienda", "cena", "snack", "pre_entreno", "post_entreno"] },
    sugerencias: { type: "ARRAY", items: { type: "OBJECT", properties: { nombre: { type: "STRING" }, gramos: { type: "NUMBER" }, cantidad: { type: "STRING" }, ...NUT }, required: ["nombre", "gramos", ...REQ_NUT] } },
    reparto_sugerido: { type: "ARRAY", items: { type: "OBJECT", properties: { alimento: { type: "STRING" }, persona: { type: "STRING" }, gramos: { type: "NUMBER" } }, required: ["alimento", "persona", "gramos"] } },
    duda: { type: "STRING" },
    opciones: { type: "ARRAY", items: { type: "STRING" } },
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
  despensa: texto(a.despensa, 120) || null, gramos_despensa: a.gramos_despensa != null ? num(a.gramos_despensa, 1, 5000, 0) || null : null,
});
const par = (a: Record<string, unknown>) => ({ alimento: texto(a.alimento, 120), persona: texto(a.persona, 60), gramos: num(a.gramos, 0, 3000, 0) });

// «no era yuca, eran papas», «era con lenteja», «cámbialo por…» (y no «quita…», «no comí…»).
const esReemplazo = (m: string) => /\b(no\s+(era|eran|es|son)|era|eran|en\s+vez|en\s+lugar|c[aá]mbi\w*|reemplaz\w*|confund\w*|sino|por|son|es)\b/i.test(m)
  && !/\b(quita|quítale|saca|sácale|elimina|borra|no\s+(lo|la|los|las)?\s*com[ií])\b/i.test(m);

function limpiar(d: Record<string, unknown>) {
  return {
    respuesta: texto(d.respuesta, 600),
    agregar: lista(d.agregar, 16).map(alimento).filter((a) => a.nombre),
    quitar: lista(d.quitar, 16).map((a) => ({ nombre: texto(a.nombre, 120), persona: texto(a.persona, 60) || null })).filter((a) => a.nombre),
    ajustar: lista(d.ajustar, 16).map((a) => ({ nombre: texto(a.nombre, 120), gramos: num(a.gramos, 1, 3000, 100), persona: texto(a.persona, 60) || null })).filter((a) => a.nombre),
    asignar: lista(d.asignar, 24).map(par).filter((a) => a.alimento && a.persona),
    de_despensa: lista(d.de_despensa, 16).map((a) => ({ nombre: texto(a.nombre, 120), despensa: texto(a.despensa, 120),
      gramos_despensa: a.gramos_despensa != null ? num(a.gramos_despensa, 1, 5000, 0) || null : null })).filter((a) => a.nombre && a.despensa),
    guardar_sobras: lista(d.guardar_sobras, 8).map((a) => ({ nombre: texto(a.nombre, 120), gramos: num(a.gramos, 1, 5000, 0) })).filter((a) => a.nombre && a.gramos),
    a_despensa: lista(d.a_despensa, 16).map((a) => ({ nombre: texto(a.nombre, 120), envases: num(a.envases, 1, 60, 1),
      gramos_envase: num(a.gramos_envase, 1, 10000, 100), ...nut(a) })).filter((a) => a.nombre),
    quien: (Array.isArray(d.quien) ? d.quien : []).map((x) => texto(x, 60)).filter(Boolean).slice(0, 8),
    reparto: ["compartido", "cada_uno", "distinto"].includes(String(d.reparto)) ? d.reparto : null,
    momento: ["desayuno", "almuerzo", "merienda", "cena", "snack", "pre_entreno", "post_entreno"].includes(String(d.momento)) ? d.momento : null,
    sugerencias: lista(d.sugerencias, 3).map(alimento).filter((a) => a.nombre),
    reparto_sugerido: lista(d.reparto_sugerido, 24).map(par).filter((a) => a.alimento && a.persona),
    duda: texto(d.duda, 200) || null,
    opciones: (Array.isArray(d.opciones) ? d.opciones : []).map((x) => texto(x, 60)).filter(Boolean).slice(0, 4),
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
    let res;
    try { res = limpiar(JSON.parse(salida)); } catch { ultimoError = "respuesta"; continue; }
    // Un reemplazo («no era yuca, eran papas») a veces vuelve solo con «quitar»: se le pide una vez que agregue el nuevo.
    if (res.quitar.length && !res.agregar.length && !res.a_despensa.length && !res.guardar_sobras.length && !res.duda && esReemplazo(mensaje) && Date.now() < limite - 8000) {
      const otra = await llamar({ ...pedido, contents: [...contents,
        { role: "model", parts: [{ text: salida }] },
        { role: "user", parts: [{ text: `Quitaste ${res.quitar.map((q) => q.nombre).join(", ")} pero no agregaste el alimento correcto. Es un reemplazo: responde de nuevo el JSON completo con quitar Y agregar (el alimento nuevo, con los mismos gramos que tenía el viejo y sus valores por 100 g).` }] }] });
      if (otra.ok) {
        try {
          const j2 = await otra.json();
          const s2 = j2?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
          const r2 = limpiar(JSON.parse(s2));
          if (r2.agregar.length) res = r2;
        } catch { /* se queda con la primera */ }
      }
    }
    return json({ modelo, ...res });
  }
  return json({ error: "gemini", detalle: ultimoError }, 502);
});
