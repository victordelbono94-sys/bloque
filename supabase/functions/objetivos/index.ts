// IA de objetivos: la persona cuenta un cambio en su vida deportiva («no hago derby esta semana», «voy a ir 2 veces al gym»,
// «cambio a crossfit», «ahora quiero ganar músculo») y la IA lo traduce en acciones sobre su plan, que la persona confirma.
// La dieta y los entrenos se readaptan solos porque salen de la agenda, el objetivo y el deporte.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { pedirIA, errorIA, usuarioDe } from "../_shared/ia.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });

const INSTRUCCIONES = `Eres el coach de una app de entrenamiento y nutrición; hablas en español de Ecuador, cercano y breve (1 a 3 frases).
La persona te cuenta un cambio en su plan y tú lo conviertes en "acciones" que la app aplica cuando la persona confirma.
El contexto trae su deporte, su objetivo corporal, su experiencia, qué días va al gym y al deporte, la agenda de las próximas semanas
(con la rutina de cada gym), las rutinas del hogar,
los cambios que ya hizo, la lista de deportes posibles (clave y nombre) y las personas del hogar (los entrenos "juntos" son de todos).

Acciones posibles (pon solo las que correspondan):
- "pausa": no va a hacer una actividad entre dos fechas. actividad = "deporte" (su deporte, ej. derby), "gym" o "todo".
  desde/hasta en AAAA-MM-DD (hoy viene en el contexto; "una semana" = desde hoy 7 días; "este finde" = sábado y domingo).
- "frecuencia_gym": cambia cuántos días va al gym. dias = días de la semana (0 domingo … 6 sábado). Si dice solo un número
  ("2 veces"), elige días repartidos y que no caigan el mismo día o el día antes del deporte; dilo en la respuesta.
- "objetivo": foco = recomposicion (bajar grasa y ganar músculo), masa_muscular (ganar peso y músculo), perder_grasa, mantenimiento o cardio.
- "deporte": cambia de deporte; deporte = la clave exacta de la lista.
- "experiencia": principiante, intermedio o avanzado.
- "cambiar_dia": un día puntual cambia un entreno por otro ("el sábado en vez de derby vamos al gym a hacer pliometría",
  "mañana no voy al gym, mejor descanso", "el jueves cambio el gym por derby"). fecha = ese día en AAAA-MM-DD (usa hoy y
  dia_de_hoy del contexto; "el sábado" = el próximo sábado, hoy incluido si hoy es sábado). de = lo que había: "deporte", "gym"
  u "otro" ("cualquiera" si no lo dice). a = lo que hará: "gym", "deporte", "descanso" u "otro".
  Si a = "gym": si una de rutinas_del_hogar encaja con lo que pide, pon su nombre EXACTO en rutina; si pide algo que no existe
  (ej. pliometría y no hay rutina de pliometría), deja rutina vacío y pon en crear_rutina qué rutina armar en pocas palabras
  ("pliometría para derby"): la app ofrece armarla con el entrenador. Si no dice qué hará en el gym, usa la rutina que tocaba
  ese día o la que sigue en la rotación. hora = "HH:MM" solo si la dice (si no, se usa la del entreno que reemplaza).
  Ejemplo de resumen: "Sábado 31: gym (pliometría) en vez de derby".
"quien": "yo" si es solo para quien escribe, "todos" si es para todo el hogar. Si hay más de una persona en el hogar y no queda claro
si el cambio es solo suyo o de todos (ej. "no vamos a derby" = todos; "no voy a derby" = yo), y la acción toca entrenos juntos, pregúntalo:
pon la pregunta en "duda", 2 opciones en "opciones" y no pongas acciones todavía.
En "resumen" de cada acción, una frase corta de lo que va a pasar ("Sin derby del 3 al 9 de noviembre").
Si cancela un entreno puntual ("hoy no voy al gym", "mañana no hay derby"), pon un "cambiar_dia" a "descanso" para ese día y nada más
para el resto de la semana: la app le ofrece sola, con botones, mover la rutina que se salta al próximo día libre o dejarla perderse.
Dilo en una frase ("Te ofrezco mover la rutina de hoy"). Un día lleva una sola rutina: si pide juntar dos, elige la principal y dile que
sume lo otro al final del entreno.
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
          tipo: { type: "STRING", enum: ["pausa", "frecuencia_gym", "objetivo", "deporte", "experiencia", "cambiar_dia"] },
          fecha: { type: "STRING" },
          de: { type: "STRING", enum: ["deporte", "gym", "otro", "cualquiera"] },
          a: { type: "STRING", enum: ["gym", "deporte", "descanso", "otro"] },
          rutina: { type: "STRING" }, crear_rutina: { type: "STRING" }, hora: { type: "STRING" },
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

const texto = (v: unknown, largo: number) => String(v ?? "").trim().slice(0, largo);
const lista = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n) : []) as Record<string, unknown>[];
// Acepta «2026-11-02», «2026-11-02T00:00» o «2026/11/02» (antes una fecha con hora hacía que el cambio se descartara sin aviso).
const fecha = (v: unknown) => { const m = String(v ?? "").match(/^(\d{4})[-/](\d{2})[-/](\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const SINONIMOS: Record<string, string> = { gimnasio: "gym", gim: "gym", descansar: "descanso", libre: "descanso", nada: "descanso", derby: "deporte", roller_derby: "deporte" };
const norm = (v: unknown) => { const t = String(v ?? "").toLowerCase().trim(); return SINONIMOS[t] ?? t; };

function limpiar(d: Record<string, unknown>) {
  const todas = lista(d.acciones, 5);
  const r = {
    respuesta: texto(d.respuesta, 700),
    duda: texto(d.duda, 200) || null,
    opciones: (Array.isArray(d.opciones) ? d.opciones : []).map((x) => texto(x, 60)).filter(Boolean).slice(0, 4),
    acciones: todas.map((a) => ({
      tipo: String(a.tipo), actividad: ["deporte", "gym", "todo"].includes(String(a.actividad)) ? a.actividad : null,
      desde: fecha(a.desde), hasta: fecha(a.hasta),
      dias: [...new Set((Array.isArray(a.dias) ? a.dias : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))],
      foco: a.foco ?? null, deporte: /^[a-z_]{2,30}$/.test(String(a.deporte ?? "")) ? a.deporte : null,
      experiencia: a.experiencia ?? null, quien: a.quien === "todos" ? "todos" : "yo", resumen: texto(a.resumen, 160),
      fecha: fecha(a.fecha),
      de: ["deporte", "gym", "otro", "cualquiera"].includes(norm(a.de)) ? norm(a.de) : "cualquiera",
      a: ["gym", "deporte", "descanso", "otro"].includes(norm(a.a)) ? norm(a.a) : null,
      rutina: texto(a.rutina, 80) || null, crear_rutina: texto(a.crear_rutina, 120) || null,
      hora: /^\d{2}:\d{2}$/.test(String(a.hora ?? "")) ? a.hora : null,
    })).filter((a) => ["pausa", "frecuencia_gym", "objetivo", "deporte", "experiencia", "cambiar_dia"].includes(a.tipo)
      && (a.tipo !== "cambiar_dia" || (a.fecha && a.a))),
    descartadas: 0,
  };
  // Si alguna acción vino incompleta, la app lo dice en vez de mostrar menos cambios sin explicación.
  r.descartadas = todas.length - r.acciones.length;
  return r;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "metodo" }, 405);
  let cuerpo: { mensaje?: string; contexto?: unknown; historial?: { rol?: string; texto?: string }[] };
  try { cuerpo = await req.json(); } catch { return json({ error: "formato" }, 400); }
  if (!usuarioDe(req)) return json({ error: "sesion" }, 401);
  const mensaje = texto(cuerpo.mensaje, 1000);
  if (!mensaje) return json({ error: "texto" }, 400);
  const historial = lista(cuerpo.historial, 8).map((h) => ({ role: h.rol === "ia" ? "model" : "user", parts: [{ text: texto(h.texto, 800) }] }))
    .filter((h) => h.parts[0].text);
  const contents = [...historial, { role: "user", parts: [{ text: `${INSTRUCCIONES}\n\nContexto: ${JSON.stringify(cuerpo.contexto ?? {}).slice(0, 12000)}\n\nMensaje: ${mensaje}` }] }];
  const r = await pedirIA({ req, funcion: "objetivos", contents, esquema: ESQUEMA, temperatura: 0.2 });
  if (!r.ok) { const e = errorIA(r); return json({ ...e.cuerpo }, e.estado); }
  return json({ modelo: r.modelo, proveedor: r.proveedor, ...limpiar(r.datos) });
});
