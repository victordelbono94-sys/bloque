package ec.bloque.puente

import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Actualizaciones de la parte nativa. Bloq no viene de Play Store, así que revisa
 * la última versión publicada en GitHub, la descarga y abre el instalador de Android.
 */
class Actualizador(private val activity: ComponentActivity, private val versionActual: Long) {

    companion object {
        private const val BASE = "https://github.com/victordelbono94-sys/bloque/releases/download/app/"
        private const val CADA_MS = 60 * 60 * 1000L
    }

    private val prefs = activity.getSharedPreferences("bloque_actualizacion", Context.MODE_PRIVATE)
    private val apk get() = File(File(activity.cacheDir, "actualizacion").apply { mkdirs() }, "bloque.apk")
    private var instalarAlVolver = false
    private var dialogoAbierto = false

    /** Revisa si hay versión nueva (como máximo cada hora, salvo que se fuerce). Actualizar es obligatorio. */
    fun revisar(forzar: Boolean = false) {
        val ahora = System.currentTimeMillis()
        if (!forzar && ahora - prefs.getLong("ultima_revision", 0L) < CADA_MS) return
        prefs.edit().putLong("ultima_revision", ahora).apply()
        activity.lifecycleScope.launch {
            val remota = withContext(Dispatchers.IO) { leerVersionRemota() } ?: return@launch
            val codigo = remota.optLong("versionCode", 0L)
            if (codigo > versionActual && !dialogoAbierto && !activity.isFinishing) ofrecer(remota)
        }
    }

    /** Al volver de Ajustes (permiso para instalar apps): se sigue con la instalación. */
    fun alVolver() {
        if (instalarAlVolver && puedeInstalar()) {
            instalarAlVolver = false
            instalar()
        }
    }

    private fun leerVersionRemota(): JSONObject? = try {
        val con = URL(BASE + "version.json").openConnection() as HttpURLConnection
        con.connectTimeout = 10_000
        con.readTimeout = 10_000
        con.instanceFollowRedirects = true
        try {
            if (con.responseCode == 200) JSONObject(con.inputStream.bufferedReader().use { it.readText() }) else null
        } finally {
            con.disconnect()
        }
    } catch (e: Exception) {
        null
    }

    private fun ofrecer(remota: JSONObject) {
        dialogoAbierto = true
        val novedades = remota.optString("novedades").takeIf { it.isNotBlank() }
        AlertDialog.Builder(activity, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Hay una actualización de Bloq")
            .setMessage(
                (novedades?.let { "$it\n\n" } ?: "") +
                    "Hace falta instalarla para seguir usando Bloq. Se instala encima de la actual: no se pierde nada."
            )
            .setCancelable(false)
            .setPositiveButton("Actualizar") { _, _ -> descargar() }
            .setOnDismissListener { dialogoAbierto = false }
            .show()
    }

    private fun descargar() {
        val barra = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100 }
        val texto = TextView(activity).apply { text = "Descargando…"; setPadding(0, 0, 0, 24) }
        val caja = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(64, 32, 64, 16)
            addView(texto)
            addView(barra)
        }
        val dialogo = AlertDialog.Builder(activity, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Actualizando Bloq")
            .setView(caja)
            .setCancelable(false)
            .show()

        activity.lifecycleScope.launch {
            val ok = withContext(Dispatchers.IO) {
                try {
                    val destino = apk
                    val parcial = File(destino.parentFile, "bloque.apk.parcial")
                    val con = URL(BASE + "bloque.apk").openConnection() as HttpURLConnection
                    con.connectTimeout = 15_000
                    con.readTimeout = 30_000
                    con.instanceFollowRedirects = true
                    try {
                        if (con.responseCode != 200) return@withContext false
                        val total = con.contentLengthLong
                        var leidos = 0L
                        con.inputStream.use { entrada ->
                            parcial.outputStream().use { salida ->
                                val buffer = ByteArray(64 * 1024)
                                while (true) {
                                    val n = entrada.read(buffer)
                                    if (n < 0) break
                                    salida.write(buffer, 0, n)
                                    leidos += n
                                    if (total > 0) {
                                        val pct = (leidos * 100 / total).toInt()
                                        activity.runOnUiThread { barra.progress = pct; texto.text = "Descargando… $pct %" }
                                    }
                                }
                            }
                        }
                    } finally {
                        con.disconnect()
                    }
                    destino.delete()
                    parcial.renameTo(destino)
                } catch (e: Exception) {
                    false
                }
            }
            dialogo.dismiss()
            if (!ok) {
                AlertDialog.Builder(activity, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                    .setTitle("No se pudo descargar")
                    .setMessage("Revisa la conexión e intenta de nuevo.")
                    .setPositiveButton("Reintentar") { _, _ -> descargar() }
                    .setNegativeButton("Cerrar", null)
                    .show()
                return@launch
            }
            if (puedeInstalar()) instalar() else pedirPermisoInstalar()
        }
    }

    private fun puedeInstalar(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || activity.packageManager.canRequestPackageInstalls()

    // Android pide una vez permitir que Bloq instale sus propias actualizaciones.
    private fun pedirPermisoInstalar() {
        AlertDialog.Builder(activity, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Un permiso, una sola vez")
            .setMessage("Android va a pedir que permitas a Bloq instalar actualizaciones. Activa «Permitir de esta fuente» y vuelve atrás.")
            .setPositiveButton("Continuar") { _, _ ->
                instalarAlVolver = true
                activity.startActivity(
                    Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
                )
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun instalar() {
        val archivo = apk
        if (!archivo.exists()) return
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.archivos", archivo)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        activity.startActivity(intent)
    }
}
