// Gemini (capa gratis) para la sección Comida. Modos:
//   foto     → qué hay en el plato de la foto, con gramos estimados (y lo que agrega el texto)
//   texto    → interpreta "3 huevos y un café con leche"
//   despensa → productos de un texto de compras o de una foto (bolsas, alacena, ticket)
//   ideas    → 3 comidas con lo que hay en la despensa y lo que le falta a la persona
//   consejo  → cuánto le falta a esta comida para su meta y qué agregar o cambiar según el objetivo
// La clave de Gemini vive solo en el servidor (secreto GEMINI_API_KEY o la tabla
// privado.secretos) y solo responde a usuarios con sesión.
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
1 lata de atún escurrido 120 g, 1 cucharada de queso rallado 6 g, 1 vaso de agua 250 g, 1 botella de agua 500 g, 1 termo 750 g.`;

const NUTRIENTES = {
  kcal_100g: { type: "NUMBER" }, proteina_100g: { type: "NUMBER" },
  carbohidratos_100g: { type: "NUMBER" }, grasas_100g: { type: "NUMBER" },
};
const REQ_NUT = ["kcal_100g", "proteina_100g", "carbohidratos_100g", "grasas_100g"];
const ESQ_ALIMENTOS = {
  type: "OBJECT",
  properties: {
    descripcion: { type: "STRING" },
    alimentos: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { nombre: { type: "STRING" }, gramos: { type: "NUMBER" }, cantidad: { type: "STRING" }, ...NUTRIENTES },
        required: ["nombre", "gramos", ...REQ_NUT],
      },
    },
  },
  required: ["alimentos"],
};
const ESQ_TEXTO = {
  type: "OBJECT",
  properties: {
    alimentos: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          nombre: { type: "STRING" }, cantidad_yo: { type: "STRING" }, cantidad_otro: { type: "STRING" },
          gramos_yo: { type: "NUMBER" }, gramos_otro: { type: "NUMBER" }, ...NUTRIENTES,
        },
        required: ["nombre", "gramos_yo", "gramos_otro", ...REQ_NUT],
      },
    },
    momento: { type: "STRING" },
  },
  required: ["alimentos"],
};
const ESQ_DESPENSA = {
  type: "OBJECT",
  properties: {
    productos: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          nombre: { type: "STRING" }, marca: { type: "STRING" },
          gramos_envase: { type: "NUMBER" }, envases: { type: "NUMBER" }, ...NUTRIENTES,
        },
        required: ["nombre", "gramos_envase", "envases", ...REQ_NUT],
      },
    },
  },
  required: ["productos"],
};
const ESQ_IDEAS = {
  type: "OBJECT",
  properties: {
    ideas: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          titulo: { type: "STRING" },
          por_que: { type: "STRING" },
          pasos: { type: "STRING" },
          ingredientes: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { nombre: { type: "STRING" }, gramos: { type: "NUMBER" }, de_despensa: { type: "BOOLEAN" }, ...NUTRIENTES },
              required: ["nombre", "gramos", ...REQ_NUT],
            },
          },
        },
        required: ["titulo", "por_que", "ingredientes"],
      },
    },
  },
  required: ["ideas"],
};

const INSTRUCCIONES: Record<string, string> = {
  foto: `Eres nutricionista. Mira la foto de la comida (en Ecuador, puede ser comida casera ecuatoriana).
Identifica cada alimento por separado y estima los gramos que se ven (si hay varios platos, suma todo).
Da valores nutricionales por 100 g tal como está servido. Nombres simples en español
("Arroz blanco cocido", "Pechuga de pollo cocida", "Plátano maduro frito"). En "cantidad" pon algo legible
("1 plato", "2 presas"). Si no ves comida, lista vacía.
Si ves bebidas (agua, jugo, café, leche), inclúyelas como alimentos aparte; para líquidos, gramos ≈ ml (agua con 0 kcal).
Si viene un texto, es lo que la persona agregó o aclara del plato (ej. "le puse 100 g de mozzarella y 2 cucharadas de aceite"):
súmalo como alimentos aparte o corrige lo que ves (si dice "es arroz integral", cámbialo). Lo que dice el texto manda sobre la foto.
${PORCIONES}`,
  texto: `Eres nutricionista. Interpreta lo que comieron o tomaron, en Ecuador. Puede ser una sola persona o dos.
Separa cada alimento y di cuántos gramos comió CADA persona: gramos_yo (quien escribe) y gramos_otro (la otra persona);
pon 0 si esa persona no lo comió. "Yo", "mi", "me" = quien escribe. "Él", "ella" o el nombre de la otra persona = la otra.
"Ambos", "los dos" o "comimos" sin separar = los dos; si dan un total compartido (ej. "6 huevos entre los dos") repártelo
en partes iguales salvo que digan otra cosa. Si solo habla de una persona, la otra va en 0.
Incluye también lo que tomaron (agua, café, jugo, leche, batidos, bebidas): para líquidos, gramos ≈ ml; el agua va como "Agua" con 0 kcal
(ej. "tomé un litro de agua en el gym" = Agua 1000 g).
Si dice "en tortilla" o "revuelto", agrega aceite aparte (5-10 g por persona). "Café con leche" = café y leche por separado.
En cantidad_yo / cantidad_otro pon lo que corresponde en palabras ("3 huevos", "1 taza"). Valores por 100 g tal como se comió.
En "momento" pon desayuno, almuerzo, merienda, cena, snack, pre_entreno o post_entreno si el texto lo dice
("desayunamos", "de almuerzo", "en la cena", "antes del gym", "después del derby"); si no lo dice, déjalo vacío.
${PORCIONES}`,
  despensa: `Eres asistente de cocina en Ecuador. Del texto o la foto (compras, alacena, refrigeradora o ticket),
lista los productos de comida. Para cada uno: nombre genérico en español (ej. "Fideos secos (pasta)",
"Arroz blanco crudo", "Avena en hojuelas", "Huevo entero", "Leche entera"), la marca si se ve,
gramos de UN envase (para huevos: 50 g por huevo y envases = número de huevos; para leche 1 litro ≈ 1030 g),
cuántos envases, y valores por 100 g del producto crudo/como viene. Ignora lo que no es comida.`,
  ideas: `Eres nutricionista deportivo. Propón 3 comidas concretas, ricas y fáciles, para la persona del contexto,
usando sobre todo lo que hay en su despensa (marca de_despensa=true en esos ingredientes) y básicos comunes
(sal, especias, aceite). Cada idea debe acercarse a lo que le falta del día para su objetivo y respetar la hora
y los entrenos (antes de entrenar: carbohidratos fáciles y poca grasa; después: proteína y carbohidratos).
Da gramos de cada ingrediente para UNA persona y valores por 100 g. "por_que" en una línea; "pasos" en dos o tres frases.
Todo en español de Ecuador.`,
  consejo: `Eres nutricionista deportivo y hablas en español de Ecuador, directo y breve (máximo 4 frases).
Ayudas a una persona a armar ESTA comida (desayuno, almuerzo, cena…) según su objetivo. El contexto trae la meta de esta comida
(una parte de su día), lo que tiene el plato, lo que le queda del día, sus entrenos de hoy y lo que hay en su despensa.
Juzga la comida, no el día: si a esta comida le faltan calorías o proteína, di cuánto y qué agregar; si ya está bien, dilo.
Adapta a su objetivo y propone cambios concretos, no solo agregados: para ganar peso y músculo, más densidad (pan blanco o
integral con mantequilla de maní, leche en vez de agua en el café o la avena, aceite de oliva, más arroz o pasta, una porción de proteína);
para bajar grasa, más proteína y fibra sin pasarse (integral, claras, pollo, verduras). Si antes de entrenar, carbohidratos fáciles;
si después, proteína y carbohidratos.
Si hace una pregunta ("¿si agrego una lata de atún alcanza?", "¿pan blanco o integral?"), respóndela con números frente a la meta de esta comida.
En "sugerencias" pon 1 a 3 alimentos concretos para agregar o cambiar (de la despensa si se puede), con gramos para UNA persona
y valores por 100 g. Si preguntó por algo concreto, inclúyelo. Si la comida ya está bien, sugerencias vacía.
Responde lo que pregunta sobre cualquier macro (calorías, proteína, carbohidratos, grasas) con números frente a su meta.
HOGAR: si el contexto trae "hogar", son las personas de la casa con su objetivo, la meta de esta comida y lo que le queda del día
a cada una SIN contar este plato. Si el plato se comparte o conviene pasarle comida a otra persona (a quien pregunta le sobra
y a la otra le falta, o al revés), dilo con nombres y gramos: "Sí, te pasas de carbohidratos: quédate con 150 g de arroz y que Vic coma
los 250 g que quedan, a él le faltan ~600 kcal". Usa los nombres tal cual vienen en "hogar" ("tú" para quien pregunta en la respuesta).
En "reparto" pon, por cada alimento del plato que propones repartir, cuántos gramos come cada persona: alimento = nombre exacto de
esta_comida, persona = nombre exacto de hogar, gramos = lo que come esa persona (la suma puede ser menor si propones dejar algo).
Si no hay hogar o no hace falta repartir distinto, reparto vacío.
${PORCIONES}`,
};
const ESQ_CONSEJO = {
  type: "OBJECT",
  properties: {
    respuesta: { type: "STRING" },
    sugerencias: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { nombre: { type: "STRING" }, gramos: { type: "NUMBER" }, cantidad: { type: "STRING" }, ...NUTRIENTES },
        required: ["nombre", "gramos", ...REQ_NUT],
      },
    },
    reparto: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { alimento: { type: "STRING" }, persona: { type: "STRING" }, gramos: { type: "NUMBER" } },
        required: ["alimento", "persona", "gramos"],
      },
    },
  },
  required: ["respuesta"],
};
const ESQUEMAS: Record<string, unknown> = { foto: ESQ_ALIMENTOS, texto: ESQ_TEXTO, despensa: ESQ_DESPENSA, ideas: ESQ_IDEAS, consejo: ESQ_CONSEJO };

// La clave: primero el secreto de la función; si no está, la tabla privada (solo service role).
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

// La firma del token ya la verificó Supabase (verify_jwt); acá se mira que sea un usuario.
function esUsuario(req: Request): boolean {
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const datos = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return datos.role === "authenticated" && typeof datos.sub === "string";
  } catch {
    return false;
  }
}

const num = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n)) * 10) / 10 : min;
};
const texto = (v: unknown, largo: number) => String(v ?? "").trim().slice(0, largo);
const nutrientes = (a: Record<string, unknown>) => ({
  kcal: num(a.kcal_100g, 0, 950),
  proteina_g: num(a.proteina_100g, 0, 100),
  carbohidratos_g: num(a.carbohidratos_100g, 0, 100),
  grasas_g: num(a.grasas_100g, 0, 100),
});

function limpiar(modo: string, d: Record<string, unknown>) {
  const lista = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n) : []) as Record<string, unknown>[];
  if (modo === "despensa") {
    return {
      productos: lista(d.productos, 25).map((p) => ({
        nombre: texto(p.nombre, 120) || "Producto", marca: texto(p.marca, 80) || null,
        gramos_envase: num(p.gramos_envase, 1, 20000), envases: Math.round(num(p.envases, 1, 60)), ...nutrientes(p),
      })),
    };
  }
  if (modo === "ideas") {
    return {
      ideas: lista(d.ideas, 3).map((i) => ({
        titulo: texto(i.titulo, 80), por_que: texto(i.por_que, 200), pasos: texto(i.pasos, 400),
        ingredientes: lista(i.ingredientes, 10).map((a) => ({
          nombre: texto(a.nombre, 120), gramos: num(a.gramos, 1, 1500), de_despensa: a.de_despensa === true, ...nutrientes(a),
        })),
      })),
    };
  }
  if (modo === "consejo") {
    return {
      respuesta: texto(d.respuesta, 500),
      sugerencias: lista(d.sugerencias, 3).map((a) => ({
        nombre: texto(a.nombre, 120) || "Alimento", gramos: num(a.gramos, 1, 1000), cantidad: texto(a.cantidad, 40) || null, ...nutrientes(a),
      })),
      reparto: lista(d.reparto, 24).map((a) => ({
        alimento: texto(a.alimento, 120), persona: texto(a.persona, 60), gramos: num(a.gramos, 0, 3000),
      })).filter((a) => a.alimento && a.persona),
    };
  }
  if (modo === "texto") {
    const momentos = ["desayuno", "almuerzo", "merienda", "cena", "snack", "pre_entreno", "post_entreno"];
    return {
      momento: momentos.includes(String(d.momento)) ? d.momento : null,
      alimentos: lista(d.alimentos, 16).map((a) => ({
        nombre: texto(a.nombre, 120) || "Alimento",
        gramos_yo: num(a.gramos_yo, 0, 3000), gramos_otro: num(a.gramos_otro, 0, 3000),
        ...nutrientes(a),
      })).filter((a) => a.gramos_yo > 0 || a.gramos_otro > 0),
    };
  }
  return {
    descripcion: texto(d.descripcion, 200),
    alimentos: lista(d.alimentos, 12).map((a) => ({
      nombre: texto(a.nombre, 120) || "Alimento", gramos: num(a.gramos, 1, 3000), cantidad: texto(a.cantidad, 40) || null, ...nutrientes(a),
    })),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "metodo" }, 405);

  let cuerpo: { modo?: string; imagen?: string; tipo?: string; texto?: string; contexto?: unknown; nota?: string; personas?: { yo?: string; otro?: string } };
  try { cuerpo = await req.json(); } catch { return json({ error: "formato" }, 400); }
  if (!esUsuario(req)) return json({ error: "sesion" }, 401);

  const clave = await leerClave().catch(() => null);
  if (!clave) return json({ error: "sin_clave" }, 503);

  const modo = ["foto", "texto", "despensa", "ideas", "consejo"].includes(cuerpo.modo ?? "") ? cuerpo.modo! : "foto";
  const partes: Record<string, unknown>[] = [{ text: INSTRUCCIONES[modo] }];
  const imagen = cuerpo.imagen ?? "";
  if (imagen) {
    if (imagen.length > 2_800_000 || !/^[A-Za-z0-9+/=]+$/.test(imagen)) return json({ error: "imagen" }, 400);
    const tipo = /^image\/(jpeg|png|webp)$/.test(cuerpo.tipo ?? "") ? cuerpo.tipo! : "image/jpeg";
    partes.push({ inline_data: { mime_type: tipo, data: imagen } });
  }
  const escrito = texto(cuerpo.texto ?? cuerpo.nota, 1500);
  if (modo === "texto") {
    const yo = texto(cuerpo.personas?.yo, 40) || "quien escribe", otro = texto(cuerpo.personas?.otro, 40);
    partes.push({ text: otro ? `Quien escribe se llama ${yo}. La otra persona se llama ${otro}.` : `Quien escribe se llama ${yo}. No hay otra persona: gramos_otro siempre 0.` });
  }
  if (escrito) partes.push({ text: `${modo === "texto" ? "Lo que comieron" : modo === "consejo" ? "Pregunta" : modo === "foto" ? "Lo que agregó o aclara del plato" : "Texto"}: ${escrito}` });
  if (modo === "ideas" || modo === "consejo") partes.push({ text: `Contexto: ${JSON.stringify(cuerpo.contexto ?? {}).slice(0, 6000)}` });
  if (modo === "foto" && !imagen) return json({ error: "imagen" }, 400);
  if (modo === "texto" && !escrito) return json({ error: "texto" }, 400);
  if (modo === "despensa" && !imagen && !escrito) return json({ error: "texto" }, 400);

  const pedido = {
    contents: [{ role: "user", parts: partes }],
    generationConfig: { responseMimeType: "application/json", responseSchema: ESQUEMAS[modo], temperature: modo === "ideas" ? 0.7 : modo === "consejo" ? 0.4 : 0.2 },
  };

  let ultimoError = "";
  const limite = Date.now() + 55000;
  const llamar = (modelo: string, cuerpo: unknown) => {
    const resta = Math.max(3000, Math.min(modo === "foto" ? 30000 : 22000, limite - Date.now()));
    return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": clave },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(resta),
    }).catch((e) => new Response(String(e), { status: 599 }));
  };
  for (const modelo of MODELOS) {
    if (Date.now() > limite - 3000) break;
    // Poco "pensar": para leer una comida no hace falta, y responde mucho más rápido.
    const conPensar = { ...pedido, generationConfig: { ...pedido.generationConfig, thinkingConfig: { thinkingLevel: "low" } } };
    let r = await llamar(modelo, conPensar);
    if (r.status === 400 && (await r.clone().text()).toLowerCase().includes("thinking")) r = await llamar(modelo, pedido);
    if (r.status === 429) return json({ error: "limite" }, 429);
    if (!r.ok) {
      // Modelo saturado o que ya no existe: se prueba con el siguiente.
      ultimoError = `${modelo}: ${r.status} ${(await r.text()).slice(0, 160)}`;
      console.log("gemini", ultimoError);
      continue;
    }
    const j = await r.json();
    const salida = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    try {
      return json({ modelo, ...limpiar(modo, JSON.parse(salida)) });
    } catch {
      ultimoError = "respuesta";
    }
  }
  return json({ error: "gemini", detalle: ultimoError }, 502);
});
