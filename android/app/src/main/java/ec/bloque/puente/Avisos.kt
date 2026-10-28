package ec.bloque.puente

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.util.concurrent.TimeUnit

/**
 * Avisos del gym: al llegar al gimnasio (geocerca), a la hora agendada y cuando el
 * reloj registra un entreno de fuerza. La web le pasa a la app los próximos gyms
 * (agenda) y dónde queda el gimnasio; cada teléfono decide qué avisos quiere.
 */
object Avisos {
    private const val CANAL = "gym"
    private const val GEOCERCA = "gimnasio"
    private const val TAG_HORA = "aviso-hora"
    private val TIPOS_FUERZA = setOf("fuerza", "pesas", "hiit", "tipo_0", "tipo_13", "tipo_36", "tipo_70", "tipo_81")

    data class Evento(val id: String, val fecha: LocalDate, val hora: LocalTime?, val titulo: String, val empezada: Boolean)

    private fun prefs(c: Context) = c.getSharedPreferences("bloque_avisos", Context.MODE_PRIVATE)

    // ---------- Configuración y agenda ----------

    fun config(c: Context): JSONObject = try {
        JSONObject(prefs(c).getString("config", null) ?: "{}")
    } catch (e: Exception) { JSONObject() }

    fun guardarConfig(c: Context, json: String) {
        val o = JSONObject(json)
        val limpio = JSONObject()
            .put("llegada", o.optBoolean("llegada"))
            .put("hora", o.optBoolean("hora"))
            .put("reloj", o.optBoolean("reloj"))
            .put("minutosAntes", o.optInt("minutosAntes", 10).coerceIn(0, 120))
        prefs(c).edit().putString("config", limpio.toString()).apply()
        aplicar(c)
    }

    fun guardarAgenda(c: Context, json: String) {
        val o = JSONObject(json)
        prefs(c).edit()
            .putString("agenda", (o.optJSONArray("agenda") ?: JSONArray()).toString())
            .putString("lugar", o.optJSONObject("lugar")?.toString())
            .apply()
        aplicar(c)
    }

    fun agenda(c: Context): List<Evento> = try {
        val a = JSONArray(prefs(c).getString("agenda", null) ?: "[]")
        (0 until a.length()).mapNotNull { i ->
            val e = a.getJSONObject(i)
            val id = e.optString("id")
            if (!Regex("^[0-9a-f-]{36}$").matches(id)) return@mapNotNull null
            Evento(
                id = id,
                fecha = LocalDate.parse(e.getString("fecha")),
                hora = if (e.isNull("hora")) null else LocalTime.parse(e.getString("hora")),
                titulo = e.optString("titulo", "Gym").take(80),
                empezada = e.optBoolean("empezada"),
            )
        }
    } catch (e: Exception) { emptyList() }

    private fun lugar(c: Context): JSONObject? = prefs(c).getString("lugar", null)?.let {
        try { JSONObject(it) } catch (e: Exception) { null }
    }

    fun limpiar(c: Context) {
        quitarGeocerca(c)
        WorkManager.getInstance(c).cancelAllWorkByTag(TAG_HORA)
        prefs(c).edit().clear().apply()
    }

    // ---------- Permisos ----------

    fun notificacionesPermitidas(c: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        return NotificationManagerCompat.from(c).areNotificationsEnabled()
    }

    private fun tiene(c: Context, p: String) = ContextCompat.checkSelfPermission(c, p) == PackageManager.PERMISSION_GRANTED

    /** "no", "aproximada", "en_uso" o "siempre". */
    fun estadoUbicacion(c: Context): String {
        val precisa = tiene(c, Manifest.permission.ACCESS_FINE_LOCATION)
        if (!precisa) return if (tiene(c, Manifest.permission.ACCESS_COARSE_LOCATION)) "aproximada" else "no"
        val fondo = Build.VERSION.SDK_INT < 29 || tiene(c, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        return if (fondo) "siempre" else "en_uso"
    }

    private fun hayServiciosGoogle(c: Context) =
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(c) == ConnectionResult.SUCCESS

    fun estado(c: Context): JSONObject {
        val cfg = config(c)
        return JSONObject()
            .put("notificaciones", notificacionesPermitidas(c))
            .put("ubicacion", estadoUbicacion(c))
            .put("playServices", hayServiciosGoogle(c))
            .put("lugar", lugar(c) != null)
            .put("llegada", cfg.optBoolean("llegada"))
            .put("hora", cfg.optBoolean("hora"))
            .put("reloj", cfg.optBoolean("reloj"))
            .put("minutosAntes", cfg.optInt("minutosAntes", 10))
    }

    // ---------- Programar ----------

    /** Deja la geocerca y los recordatorios como pide la configuración. */
    fun aplicar(c: Context) {
        val cfg = config(c)
        if (cfg.optBoolean("llegada")) registrarGeocerca(c) else quitarGeocerca(c)
        programarRecordatorios(c, if (cfg.optBoolean("hora")) cfg.optInt("minutosAntes", 10) else null)
    }

    private fun pendienteGeocerca(c: Context): PendingIntent {
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
        return PendingIntent.getBroadcast(c, 0, Intent(c, GeocercaReceiver::class.java), flags)
    }

    @SuppressLint("MissingPermission")
    private fun registrarGeocerca(c: Context) {
        val l = lugar(c) ?: return quitarGeocerca(c)
        if (estadoUbicacion(c) != "siempre" || !hayServiciosGoogle(c)) return
        val firma = "${l.optDouble("lat")},${l.optDouble("lng")},${l.optInt("radio", 150)}"
        val geocerca = Geofence.Builder()
            .setRequestId(GEOCERCA)
            .setCircularRegion(l.optDouble("lat"), l.optDouble("lng"), l.optInt("radio", 150).coerceIn(50, 1000).toFloat())
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            // Avisa después de 2 minutos adentro: pasar por la puerta no cuenta.
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_DWELL)
            .setLoiteringDelay(2 * 60 * 1000)
            .build()
        val pedido = GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_DWELL)
            .addGeofence(geocerca)
            .build()
        try {
            LocationServices.getGeofencingClient(c).addGeofences(pedido, pendienteGeocerca(c))
                .addOnSuccessListener { prefs(c).edit().putString("geocerca", firma).apply() }
        } catch (e: SecurityException) {
            // Sin permiso: se vuelve a intentar al abrir la app.
        }
    }

    private fun quitarGeocerca(c: Context) {
        if (prefs(c).getString("geocerca", null) == null) return
        try {
            LocationServices.getGeofencingClient(c).removeGeofences(listOf(GEOCERCA))
        } catch (e: Exception) { }
        prefs(c).edit().remove("geocerca").apply()
    }

    private fun programarRecordatorios(c: Context, minutosAntes: Int?) {
        val wm = WorkManager.getInstance(c)
        wm.cancelAllWorkByTag(TAG_HORA)
        if (minutosAntes == null) return
        val zona = ZoneId.systemDefault()
        val ahora = Instant.now()
        for (e in agenda(c)) {
            val hora = e.hora ?: continue
            if (e.empezada) continue
            val cuando = LocalDateTime.of(e.fecha, hora).minusMinutes(minutosAntes.toLong()).atZone(zona).toInstant()
            val espera = Duration.between(ahora, cuando)
            if (espera.isNegative || espera.toDays() > 8) continue
            val pedido = OneTimeWorkRequestBuilder<TrabajoAviso>()
                .setInitialDelay(espera.toMillis(), TimeUnit.MILLISECONDS)
                .setInputData(workDataOf("id" to e.id))
                .addTag(TAG_HORA)
                .build()
            wm.enqueueUniqueWork("aviso-hora-${e.id}", ExistingWorkPolicy.REPLACE, pedido)
        }
    }

    // ---------- Disparadores ----------

    /** El gym de hoy que todavía no empezó; con hora, solo si estás cerca de esa hora. */
    private fun gymDeHoy(c: Context, margenHoras: Long?): Evento? {
        val zona = ZoneId.systemDefault()
        val hoy = LocalDate.now(zona)
        val ahora = LocalTime.now(zona)
        return agenda(c)
            .filter { it.fecha == hoy && !it.empezada }
            .filter { e ->
                val h = e.hora
                margenHoras == null || h == null ||
                    (ahora.isAfter(h.minusHours(margenHoras)) && ahora.isBefore(h.plusHours(margenHoras)))
            }
            .minByOrNull { e -> e.hora?.let { Math.abs(Duration.between(it, ahora).toMinutes()) } ?: 0L }
    }

    fun alLlegar(c: Context) {
        if (!config(c).optBoolean("llegada")) return
        val e = gymDeHoy(c, margenHoras = 3) ?: return
        notificar(c, e, "llegada", "Llegaste al gym", "Hoy toca ${e.titulo}. ¿Comenzamos?", "Comenzar")
    }

    fun alaHora(c: Context, id: String) {
        if (!config(c).optBoolean("hora")) return
        val e = agenda(c).firstOrNull { it.id == id && !it.empezada } ?: return
        val cuando = e.hora?.let { " a las $it" } ?: ""
        notificar(c, e, "hora", "Hoy toca gym$cuando", e.titulo, "Comenzar")
    }

    /** Después de sincronizar: un entreno de fuerza del reloj sin entreno abierto en Bloque. */
    fun alSincronizar(c: Context, sesiones: JSONArray) {
        if (!config(c).optBoolean("reloj")) return
        val zona = ZoneId.systemDefault()
        val hoy = LocalDate.now(zona)
        val hace6h = Instant.now().minus(Duration.ofHours(6))
        for (i in 0 until sesiones.length()) {
            val s = sesiones.optJSONObject(i) ?: continue
            if (s.optString("tipo") !in TIPOS_FUERZA) continue
            val inicio = try { Instant.parse(s.getString("inicio")) } catch (e: Exception) { continue }
            val fin = try { Instant.parse(s.getString("fin")) } catch (e: Exception) { continue }
            if (inicio.atZone(zona).toLocalDate() != hoy || fin.isBefore(hace6h)) continue
            val minutos = Duration.between(inicio, fin).toMinutes()
            if (minutos < 15) continue
            val e = gymDeHoy(c, margenHoras = null) ?: return
            val kcal = if (s.has("calorias")) " · ${s.optInt("calorias")} kcal" else ""
            notificar(c, e, "reloj-${s.optString("hc_record_id")}",
                "Tu reloj registró $minutos min de fuerza$kcal", "¿Anotamos las series de ${e.titulo}?", "Anotar series")
            return
        }
    }

    // ---------- Notificación ----------

    private fun crearCanal(c: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = c.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CANAL) != null) return
        nm.createNotificationChannel(
            NotificationChannel(CANAL, "Gym", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Al llegar al gimnasio, a la hora del gym y cuando el reloj registra un entreno"
            }
        )
    }

    /** Una vez por día y por motivo; todos los avisos de un mismo gym usan la misma notificación. */
    @SuppressLint("MissingPermission")
    private fun notificar(c: Context, e: Evento, motivo: String, titulo: String, texto: String, accion: String) {
        if (!notificacionesPermitidas(c)) return
        val p = prefs(c)
        val hoy = LocalDate.now().toString()
        val clave = "$hoy|${e.id}|$motivo"
        val avisados = (p.getStringSet("avisados", emptySet()) ?: emptySet()).filter { it.startsWith(hoy) }.toMutableSet()
        if (clave in avisados) return
        avisados += clave
        p.edit().putStringSet("avisados", avisados).apply()

        crearCanal(c)
        val abrir = Intent(c, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_RUTA, "comenzar/${e.id}")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pendiente = PendingIntent.getActivity(
            c, e.id.hashCode(), abrir, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(c, CANAL)
            .setSmallIcon(R.drawable.ic_aviso)
            .setColor(Color.parseColor("#C6F432"))
            .setContentTitle(titulo)
            .setContentText(texto)
            .setStyle(NotificationCompat.BigTextStyle().bigText(texto))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setContentIntent(pendiente)
            .addAction(0, accion, pendiente)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(c).notify(e.id.hashCode(), n)
        } catch (ex: SecurityException) { }
    }
}

/** Android avisa que pasaste 2 minutos dentro del gimnasio. */
class GeocercaReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val evento = GeofencingEvent.fromIntent(intent) ?: return
        if (evento.hasError()) return
        val t = evento.geofenceTransition
        if (t == Geofence.GEOFENCE_TRANSITION_DWELL || t == Geofence.GEOFENCE_TRANSITION_ENTER) Avisos.alLlegar(context)
    }
}

/** Las geocercas se borran al reiniciar el teléfono o actualizar la app: se vuelven a poner. */
class ArranqueReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            Avisos.aplicar(context)
        }
    }
}

/** Recordatorio a la hora del gym. */
class TrabajoAviso(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        inputData.getString("id")?.let { Avisos.alaHora(applicationContext, it) }
        return Result.success()
    }
}
