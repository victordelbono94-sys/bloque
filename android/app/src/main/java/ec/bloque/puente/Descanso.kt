package ec.bloque.puente

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Descanso entre series con la app en segundo plano: avisa cuando quedan 10 s, cuando quedan 5 s
 * (y vibra una vez por segundo hasta el final) y cuando termina. Con la app abierta, avisa la web.
 * Mientras dura el descanso se mantiene despierta la CPU (con tope) para que los avisos lleguen a tiempo.
 */
object Descanso {
    private const val CANAL = "descanso"
    private const val ID = 7600
    private val manejador = Handler(Looper.getMainLooper())
    private var pendientes = mutableListOf<Runnable>()
    private var bloqueo: PowerManager.WakeLock? = null

    @Volatile var enPrimerPlano = true

    fun programar(c: Context, finMs: Long, titulo: String) {
        cancelar(c)
        val app = c.applicationContext
        val ahora = System.currentTimeMillis()
        val resta = finMs - ahora
        if (resta <= 0 || resta > 15 * 60_000) return
        try {
            bloqueo = (app.getSystemService(Context.POWER_SERVICE) as PowerManager)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "bloque:descanso").apply { acquire(resta + 15_000) }
        } catch (e: Exception) { }
        fun en(ms: Long, accion: () -> Unit) {
            val r = Runnable { accion() }
            pendientes += r
            manejador.postDelayed(r, (ms - ahora).coerceAtLeast(0))
        }
        if (resta > 11_000) en(finMs - 10_000) { avisar(app, "Quedan 10 s de descanso", titulo, vibrar = false) }
        if (resta > 6_000) en(finMs - 5_000) {
            avisar(app, "Quedan 5 s ⏱", titulo, vibrar = false)
            vibrarCuentaRegresiva(app)
        }
        en(finMs) {
            avisar(app, "¡A la siguiente serie!", titulo, vibrar = true)
            soltar()
        }
    }

    fun cancelar(c: Context) {
        pendientes.forEach { manejador.removeCallbacks(it) }
        pendientes.clear()
        soltar()
        try { NotificationManagerCompat.from(c).cancel(ID) } catch (e: Exception) { }
        vibrador(c)?.cancel()
    }

    /** Al volver a la app: los avisos ya no hacen falta (la web muestra el descanso). */
    fun alVolver(c: Context) {
        enPrimerPlano = true
        try { NotificationManagerCompat.from(c).cancel(ID) } catch (e: Exception) { }
    }

    private fun soltar() {
        try { bloqueo?.takeIf { it.isHeld }?.release() } catch (e: Exception) { }
        bloqueo = null
    }

    @SuppressLint("MissingPermission")
    private fun avisar(c: Context, texto: String, titulo: String, vibrar: Boolean) {
        if (enPrimerPlano) return
        if (!NotificationManagerCompat.from(c).areNotificationsEnabled()) return
        crearCanal(c)
        val abrir = PendingIntent.getActivity(
            c, 760,
            Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(c, CANAL)
            .setSmallIcon(R.drawable.ic_aviso)
            .setColor(Color.parseColor("#C6F432"))
            .setContentTitle(texto)
            .setContentText(titulo)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setOnlyAlertOnce(false)
            .setContentIntent(abrir)
            .setAutoCancel(true)
            .setTimeoutAfter(60_000)
            .build()
        try { NotificationManagerCompat.from(c).notify(ID, n) } catch (e: SecurityException) { }
        if (vibrar) vibrador(c)?.let { v ->
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 400, 150, 400), -1))
            else @Suppress("DEPRECATION") v.vibrate(longArrayOf(0, 400, 150, 400), -1)
        }
    }

    /** 5, 4, 3, 2, 1: un pulso por segundo. */
    private fun vibrarCuentaRegresiva(c: Context) {
        if (enPrimerPlano) return
        val patron = longArrayOf(0, 220, 780, 220, 780, 220, 780, 220, 780, 220)
        vibrador(c)?.let { v ->
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(patron, -1))
            else @Suppress("DEPRECATION") v.vibrate(patron, -1)
        }
    }

    private fun vibrador(c: Context): Vibrator? = try {
        if (Build.VERSION.SDK_INT >= 31) (c.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        else @Suppress("DEPRECATION") c.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    } catch (e: Exception) { null }

    private fun crearCanal(c: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = c.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CANAL) != null) return
        nm.createNotificationChannel(NotificationChannel(CANAL, "Descanso entre series", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Avisa cuando se acaba el descanso del gym con la app cerrada"
            enableVibration(false) // la vibración la maneja Bloque (cuenta regresiva)
            setSound(null, null)
        })
    }
}
