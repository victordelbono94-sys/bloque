package ec.bloque.puente

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.util.concurrent.TimeUnit

/**
 * Avisos de bienestar:
 *  - Al despertar (una hora después de que la banda cerró el sueño): cuánto dormiste y cómo amaneciste.
 *    Se responde desde la notificación (fresco / normal / cansado) sin abrir la app.
 *  - Recordatorios de agua y de comidas (si no registraste el almuerzo o la cena).
 */
object Bienestar {
    private const val CANAL = "bienestar"
    private const val ID_CANSANCIO = 7001
    private const val ID_ENTRENO = 7400
    private val HORAS_AGUA = listOf(LocalTime.of(10, 30), LocalTime.of(13, 30), LocalTime.of(16, 30), LocalTime.of(19, 30))
    private val HORAS_COMIDA = mapOf("almuerzo" to LocalTime.of(14, 30), "cena" to LocalTime.of(21, 0))

    private fun prefs(c: Context) = c.getSharedPreferences("bloque_bienestar", Context.MODE_PRIVATE)

    // ---------- Después de cada sincronización ----------

    /** Con los días leídos de Health Connect y lo que Bloque sabe de hoy (comidas, agua). */
    fun alSincronizar(c: Context, dias: JSONArray, hoyServidor: JSONObject?) {
        hoyServidor?.let { prefs(c).edit().putString("hoy", it.put("guardado", LocalDate.now().toString()).toString()).apply() }
        if (!Avisos.config(c).optBoolean("despertar", true)) return
        val hoy = LocalDate.now().toString()
        if (prefs(c).getString("cansancio_avisado", null) == hoy) return
        var dia: JSONObject? = null
        for (i in 0 until dias.length()) dias.optJSONObject(i)?.takeIf { it.optString("fecha") == hoy }?.let { dia = it }
        val d = dia ?: return
        val despertar = try { Instant.parse(d.optString("despertar")) } catch (e: Exception) { return }
        val minutos = d.optInt("sueno_min", 0)
        if (minutos < 120) return
        val cuando = despertar.plus(Duration.ofHours(1))
        val ahora = Instant.now()
        when {
            ahora.isBefore(cuando) -> programar(c, "cansancio", Duration.between(ahora, cuando), workDataOf("sueno" to minutos))
            ahora.isBefore(despertar.plus(Duration.ofHours(8))) -> avisarCansancio(c, minutos)
        }
    }

    // ---------- Al despertar: cómo amaneciste ----------

    @SuppressLint("MissingPermission")
    fun avisarCansancio(c: Context, suenoMin: Int) {
        if (!notificacionesPermitidas(c)) return
        val hoy = LocalDate.now().toString()
        if (prefs(c).getString("cansancio_avisado", null) == hoy) return
        prefs(c).edit().putString("cansancio_avisado", hoy).apply()
        crearCanal(c)
        val h = suenoMin / 60
        val m = suenoMin % 60
        val dormiste = "Dormiste $h h ${"%02d".format(m)}"
        val consejo = when {
            suenoMin < 300 -> "Es poco: hoy conviene algo suave o descansar."
            suenoMin < 360 -> "Un poco corto: entrena, pero sin ir al límite."
            else -> "Buen descanso."
        } + (if (LocalDate.now().dayOfWeek.value in listOf(1, 4)) " Hoy toca pesarte: en ayunas, después del baño." else "")
        fun respuesta(valor: Int): PendingIntent = PendingIntent.getBroadcast(
            c, 900 + valor,
            Intent(c, CheckinReceiver::class.java).putExtra("cansancio", valor).putExtra("fecha", hoy),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(c, CANAL)
            .setSmallIcon(R.drawable.ic_aviso)
            .setColor(Color.parseColor("#C6F432"))
            .setContentTitle("$dormiste. ¿Cómo amaneciste?")
            .setContentText("$consejo Marca tu cansancio y se actualiza el semáforo.")
            .setStyle(NotificationCompat.BigTextStyle().bigText("$consejo Marca tu cansancio y se actualiza el semáforo."))
            .setContentIntent(abrirApp(c, "hoy", 0))
            .addAction(0, "😀 Fresco", respuesta(2))
            .addAction(0, "😐 Normal", respuesta(3))
            .addAction(0, "😫 Cansado", respuesta(4))
            .setAutoCancel(true)
            .build()
        try { NotificationManagerCompat.from(c).notify(ID_CANSANCIO, n) } catch (e: SecurityException) { }
    }

    @SuppressLint("MissingPermission")
    fun confirmarCansancio(c: Context, ok: Boolean, valor: Int) {
        val texto = if (ok) "Anotado: ${mapOf(2 to "fresco", 3 to "normal", 4 to "cansado")[valor]}. Tu semáforo se actualiza al abrir Bloque."
        else "No se pudo anotar (sin conexión). Ábrela y márcalo en Hoy."
        val n = NotificationCompat.Builder(c, CANAL)
            .setSmallIcon(R.drawable.ic_aviso)
            .setColor(Color.parseColor("#C6F432"))
            .setContentTitle(if (ok) "Listo ✓" else "Ups")
            .setContentText(texto)
            .setContentIntent(abrirApp(c, "hoy", 1))
            .setAutoCancel(true)
            .setTimeoutAfter(if (ok) 15_000 else 0)
            .build()
        try { NotificationManagerCompat.from(c).notify(ID_CANSANCIO, n) } catch (e: SecurityException) { }
    }

    // ---------- ¿Qué fue este entreno? ----------

    /** Entrenos genéricos del reloj que Bloque no sabe qué fueron: se pregunta una vez por cada uno. */
    @SuppressLint("MissingPermission")
    fun preguntarEntrenos(c: Context, lista: JSONArray?) {
        if (lista == null || lista.length() == 0) return
        if (!Avisos.config(c).optBoolean("confirmar", true) || !notificacionesPermitidas(c)) return
        val p = prefs(c)
        val avisados = (p.getStringSet("entrenos_preguntados", emptySet()) ?: emptySet()).toMutableSet()
        crearCanal(c)
        for (i in 0 until minOf(lista.length(), 3)) {
            val e = lista.optJSONObject(i) ?: continue
            val id = e.optString("id").takeIf { Regex("^[0-9a-f-]{36}$").matches(it) } ?: continue
            if (id in avisados) continue
            avisados += id
            val notifId = ID_ENTRENO + (id.hashCode() and 0x3ff)
            val partes = buildList {
                add(e.optString("hora"))
                add("${e.optInt("minutos")} min")
                if (!e.isNull("calorias") && e.optInt("calorias") > 0) add("${e.optInt("calorias")} kcal")
                if (!e.isNull("fc_promedio")) add("${e.optInt("fc_promedio")} ppm")
            }.filter { it.isNotBlank() }.joinToString(" · ")
            val b = NotificationCompat.Builder(c, CANAL)
                .setSmallIcon(R.drawable.ic_aviso)
                .setColor(Color.parseColor("#C6F432"))
                .setContentTitle("Parece que hiciste ejercicio. ¿Qué fue?")
                .setContentText("$partes. Elige y lo registro donde corresponde.")
                .setStyle(NotificationCompat.BigTextStyle().bigText("Tu reloj guardó un entreno ($partes). ¿Lo registro como…?"))
                .setContentIntent(abrirApp(c, "confirmar/$id", 300 + (notifId % 100)))
                .setAutoCancel(true)
            val ops = e.optJSONArray("opciones") ?: JSONArray()
            for (k in 0 until minOf(ops.length(), 2)) {
                val o = ops.optJSONObject(k) ?: continue
                val como = o.optString("como").takeIf { Regex("^[a-z0-9_]{2,40}$").matches(it) } ?: continue
                val pi = PendingIntent.getBroadcast(
                    c, notifId * 4 + k,
                    Intent(c, ConfirmarReceiver::class.java).putExtra("id", id).putExtra("como", como)
                        .putExtra("nombre", o.optString("nombre")).putExtra("notif", notifId),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
                b.addAction(0, o.optString("nombre"), pi)
            }
            b.addAction(0, "Otro…", abrirApp(c, "confirmar/$id", 400 + (notifId % 100)))
            try { NotificationManagerCompat.from(c).notify(notifId, b.build()) } catch (ex: SecurityException) { }
        }
        // Solo se recuerdan los últimos para que la lista no crezca sin fin.
        p.edit().putStringSet("entrenos_preguntados", avisados.toList().takeLast(40).toSet()).apply()
    }

    @SuppressLint("MissingPermission")
    fun confirmarEntreno(c: Context, notifId: Int, ok: Boolean, nombre: String) {
        val n = NotificationCompat.Builder(c, CANAL)
            .setSmallIcon(R.drawable.ic_aviso)
            .setColor(Color.parseColor("#C6F432"))
            .setContentTitle(if (ok) "Anotado: $nombre ✓" else "Ups")
            .setContentText(if (ok) "Se cuenta en tu día al abrir Bloque." else "No se pudo anotar (sin conexión). Ábrela y elígelo en Hoy.")
            .setContentIntent(abrirApp(c, "hoy", 2))
            .setAutoCancel(true)
            .setTimeoutAfter(if (ok) 10_000 else 0)
            .build()
        try { NotificationManagerCompat.from(c).notify(notifId, n) } catch (e: SecurityException) { }
    }

    // ---------- Recordatorios de agua y comidas ----------

    /** Programa el próximo recordatorio de cada tipo activado (se reprograman solos al sonar). */
    fun programarRecordatorios(c: Context) {
        val cfg = Avisos.config(c)
        val wm = WorkManager.getInstance(c)
        if (cfg.optBoolean("agua")) programar(c, "agua", hastaProxima(HORAS_AGUA), workDataOf()) else wm.cancelUniqueWork("bienestar-agua")
        if (cfg.optBoolean("comidas")) {
            for ((momento, hora) in HORAS_COMIDA) programar(c, "comida-$momento", hastaProxima(listOf(hora)), workDataOf("momento" to momento))
        } else HORAS_COMIDA.keys.forEach { wm.cancelUniqueWork("bienestar-comida-$it") }
    }

    fun alSonar(c: Context, tipo: String, datos: androidx.work.Data) {
        val cfg = Avisos.config(c)
        when {
            tipo == "cansancio" -> avisarCansancio(c, datos.getInt("sueno", 0))
            tipo == "agua" && cfg.optBoolean("agua") -> {
                val hoy = hoyGuardado(c)
                val ml = hoy?.optInt("agua_ml", -1) ?: -1
                val meta = hoy?.optInt("agua_meta", 0) ?: 0
                if (!(meta > 0 && ml >= meta)) {
                    val texto = if (ml >= 0 && meta > 0) "Llevas ${"%.1f".format(ml / 1000.0)} de ${"%.1f".format(meta / 1000.0)} L hoy." else "Un vaso ahora te deja al día."
                    simple(c, 7100, "💧 Hora de tomar agua", texto, "comida")
                }
                programar(c, "agua", hastaProxima(HORAS_AGUA), workDataOf())
            }
            tipo.startsWith("comida-") && cfg.optBoolean("comidas") -> {
                val momento = datos.getString("momento") ?: "almuerzo"
                val ya = hoyGuardado(c)?.optJSONArray("momentos")?.let { a -> (0 until a.length()).any { a.optString(it) == momento } } ?: false
                if (!ya) simple(c, if (momento == "cena") 7202 else 7201, "¿Registramos ${if (momento == "cena") "la cena" else "el almuerzo"}?",
                    "Toma 10 segundos con una foto: así tus calorías de hoy quedan bien.", "comida")
                programar(c, tipo, hastaProxima(listOf(HORAS_COMIDA[momento] ?: LocalTime.NOON)), workDataOf("momento" to momento))
            }
        }
    }

    // ---------- Utilidades ----------

    private fun hoyGuardado(c: Context): JSONObject? {
        val texto = prefs(c).getString("hoy", null) ?: return null
        return try {
            JSONObject(texto).takeIf { it.optString("guardado") == LocalDate.now().toString() }
        } catch (e: Exception) { null }
    }

    private fun hastaProxima(horas: List<LocalTime>): Duration {
        val ahora = LocalDateTime.now()
        val proxima = horas.map { ahora.toLocalDate().atTime(it) }.firstOrNull { it.isAfter(ahora.plusMinutes(1)) }
            ?: ahora.toLocalDate().plusDays(1).atTime(horas.first())
        return Duration.between(ahora, proxima)
    }

    private fun programar(c: Context, tipo: String, espera: Duration, datos: androidx.work.Data) {
        val pedido = OneTimeWorkRequestBuilder<TrabajoBienestar>()
            .setInitialDelay(espera.toMillis().coerceAtLeast(0), TimeUnit.MILLISECONDS)
            .setInputData(androidx.work.Data.Builder().putAll(datos).putString("tipo", tipo).build())
            .build()
        WorkManager.getInstance(c).enqueueUniqueWork("bienestar-$tipo", ExistingWorkPolicy.REPLACE, pedido)
    }

    private fun abrirApp(c: Context, ruta: String, codigo: Int): PendingIntent = PendingIntent.getActivity(
        c, 800 + codigo,
        Intent(c, MainActivity::class.java).putExtra(MainActivity.EXTRA_RUTA, ruta)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    @SuppressLint("MissingPermission")
    private fun simple(c: Context, id: Int, titulo: String, texto: String, ruta: String) {
        if (!notificacionesPermitidas(c)) return
        crearCanal(c)
        val n = NotificationCompat.Builder(c, CANAL)
            .setSmallIcon(R.drawable.ic_aviso)
            .setColor(Color.parseColor("#C6F432"))
            .setContentTitle(titulo)
            .setContentText(texto)
            .setContentIntent(abrirApp(c, ruta, id % 100))
            .setAutoCancel(true)
            .build()
        try { NotificationManagerCompat.from(c).notify(id, n) } catch (e: SecurityException) { }
    }

    private fun notificacionesPermitidas(c: Context) = NotificationManagerCompat.from(c).areNotificationsEnabled()

    private fun crearCanal(c: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = c.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CANAL) != null) return
        nm.createNotificationChannel(NotificationChannel(CANAL, "Bienestar", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Cómo amaneciste, agua y comidas"
        })
    }
}

/** Respuesta desde la notificación («Fresco / Normal / Cansado»): se manda a Bloque sin abrir la app. */
class CheckinReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val valor = intent.getIntExtra("cansancio", 0).takeIf { it in 1..5 } ?: return
        val fecha = intent.getStringExtra("fecha") ?: LocalDate.now().toString()
        val codigo = Ajustes(context).codigo ?: return
        val pendiente = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            val ok = try {
                Api.sincronizar(codigo, JSONObject().put("checkin", JSONObject().put("fecha", fecha).put("cansancio", valor)))
                true
            } catch (e: Exception) { false }
            Bienestar.confirmarCansancio(context, ok, valor)
            pendiente.finish()
        }
    }
}

/** Respuesta desde «¿Qué fue este entreno?» (Derby / Gym…): se manda a Bloque sin abrir la app. */
class ConfirmarReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra("id") ?: return
        val como = intent.getStringExtra("como") ?: return
        val nombre = intent.getStringExtra("nombre") ?: como
        val notif = intent.getIntExtra("notif", 7400)
        val codigo = Ajustes(context).codigo ?: return
        val pendiente = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            val ok = try {
                Api.sincronizar(codigo, JSONObject().put("confirmar", JSONObject().put("id", id).put("como", como)))
                true
            } catch (e: Exception) { false }
            Bienestar.confirmarEntreno(context, notif, ok, nombre)
            pendiente.finish()
        }
    }
}

class TrabajoBienestar(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val tipo = inputData.getString("tipo") ?: return Result.success()
        try { Bienestar.alSonar(applicationContext, tipo, inputData) } catch (e: Exception) { }
        return Result.success()
    }
}
