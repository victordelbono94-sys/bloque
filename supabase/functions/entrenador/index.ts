// Entrenador IA de Bloque: arma o ajusta rutinas de gym conversando.
// Sabe el deporte del hogar (para no sumar fatiga donde el deporte ya carga), el objetivo de cada uno,
// el catálogo de ejercicios del gym y las rutinas que ya tienen. Devuelve la respuesta y las rutinas propuestas.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { pedirIA, errorIA, usuarioDe, type Contenido } from "../_shared/ia.ts";

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

MOLESTIAS Y LESIONES: si alguien tiene "molestias_activas", no le pongas ejercicios que carguen esa zona (o cámbialos por versiones
sin dolor: máquina guiada, rango corto, menos peso) y suma al final 1 o 2 ejercicios suaves de recuperación para esa zona
(isométricos, movilidad, banda elástica), con unidad y series livianas. Nunca diagnostiques; si dice "duele" o lleva más de 2 semanas,
recomiéndale ver a un fisioterapeuta en la respuesta.

VARIEDAD Y PROGRESIÓN (la app ya lo hace sola, respétalo):
- Los ejercicios básicos (press de pecho/banca, press de hombros, jalón/dominadas, remos, prensa/sentadilla, peso muerto rumano,
  hip thrust) se mantienen 4 semanas para poder subir peso. Los accesorios (aperturas, laterales, tríceps, curls, core, trapecios,
  antebrazos) la app los rota cada semana dentro de su familia. En el catálogo, cada ejercicio trae [familia: músculo].
- Mira "historial_ultimas_3_semanas" y "rutina_esta_semana": si te piden variar o una rutina nueva, NO repitas los accesorios
  de la semana anterior; cambia por otro de la misma familia o del mismo músculo con otro ángulo. Los básicos solo cámbialos si lo piden.

CAMBIAR UN EJERCICIO ("otro del mismo grupo", "la máquina está ocupada", "no hay esta máquina"):
- El reemplazo trabaja EL MISMO músculo principal y, si se puede, el mismo movimiento (misma familia). Nunca cambies a otro músculo
  (ej. remo alto → face pull está bien, remo alto → curl no; curl martillo → curl invertido está bien, curl → tríceps no).
- Nunca propongas algo que ya está en la rutina ni algo de "entreno_en_curso.ya_hechos_hoy", ni una variante casi igual de lo ya hecho
  hoy (si ya hizo curl en máquina y curl martillo, otro curl de pie no suma: ofrece un ángulo distinto o di que el músculo ya está cubierto).
- Si piden "agregar uno más" de un músculo que ya tiene 2 o más ejercicios hoy, dilo y sugiere solo uno con un ángulo distinto.
- Si "entreno_en_curso" no es null, están entrenando ahora: cambios cortos, sin rehacer toda la rutina, y en "respuesta" aclara que
  el cambio queda guardado en la rutina.

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
          descanso_seg: e.descanso_seg == null ? null : num(e.descanso_seg, 0, 300, 90), unidad, por_lado: e.por_lado === true, nota: texto(e.nota, 200) || null,
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
  if (!usuarioDe(req)) return json({ error: "sesion" }, 401);
  const mensaje = texto(cuerpo.mensaje, 1200);
  if (!mensaje) return json({ error: "texto" }, 400);

  const historial = lista(cuerpo.historial, 10).map((h) => ({
    role: h.rol === "ia" ? "model" : "user",
    parts: [{ text: texto(h.texto, 1500) }],
  })).filter((h) => h.parts[0].text);
  const contents: Contenido[] = [
    { role: "user", parts: [{ text: `${INSTRUCCIONES}\n\nContexto: ${JSON.stringify(cuerpo.contexto ?? {}).slice(0, 20000)}` }] },
    { role: "model", parts: [{ text: '{"respuesta":"Listo, conozco su contexto. ¿Qué ajustamos?","rutinas":[]}' }] },
    ...historial,
    { role: "user", parts: [{ text: mensaje }] },
  ];
  const r = await pedirIA({ req, funcion: "entrenador", contents, esquema: ESQUEMA, temperatura: 0.4 });
  if (!r.ok) { const e = errorIA(r); return json({ ...e.cuerpo }, e.estado); }
  return json({ modelo: r.modelo, proveedor: r.proveedor, ...limpiar(r.datos) });
});
