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
