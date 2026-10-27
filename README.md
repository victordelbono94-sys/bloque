# Bloque

App de entrenamiento de Victor y Sant: calendario compartido de gym y derby, rutinas con metas por persona, datos de la Xiaomi Smart Band 10 vía Health Connect, peso y bioimpedancia, dieta y un asistente con Gemini.

## Stack

- PWA en JavaScript, publicada en GitHub Pages
- Supabase: Postgres con seguridad por filas, Edge Functions, Auth con Google, pg_cron
- App puente Android (Kotlin) para leer y escribir Health Connect
- OneSignal para notificaciones push
- Gemini (capa gratuita) para el chat; Claude como planificador semanal

## Estructura

- `supabase/migrations/` — esquema de la base de datos, en orden
- `index.html`, `css/`, `js/` — la PWA (sin paso de compilación)
- `icons/` — íconos de la app, generados con la tipografía de la marca

## Publicación

GitHub Pages sirve la rama `main` desde la raíz. La app usa la clave publicable de Supabase; lo que cada persona puede ver o cambiar lo decide la seguridad por filas de la base de datos.

## Alta del hogar

Después de que cada uno entra por primera vez con Google, se crea el hogar y se une a las dos personas (una sola vez):

```sql
insert into public.hogares (nombre) values ('Victor y Sant') returning id;
insert into public.personas (id, hogar_id, nombre) values
  ('<uuid de Victor en auth.users>', '<id del hogar>', 'Victor'),
  ('<uuid de Sant en auth.users>',   '<id del hogar>', 'Sant');
```
