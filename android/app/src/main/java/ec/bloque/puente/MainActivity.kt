package ec.bloque.puente

import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.ViewGroup
import android.view.WindowInsets
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File

/**
 * Bloque como app: muestra la web de Bloque a pantalla completa y le suma lo que
 * una web no puede hacer: leer y escribir Health Connect, en primer y segundo plano.
 */
class MainActivity : ComponentActivity() {

    companion object {
        const val SITIO = "https://victordelbono94-sys.github.io/bloque/"
        private const val HOST = "victordelbono94-sys.github.io"
        private const val RUTA = "/bloque"
        private const val REGRESO_LOGIN = "ec.bloque.puente"
        private const val SYNC_AL_ABRIR_MS = 15 * 60 * 1000L
    }

    private val asfalto = Color.parseColor("#15171C")
    private lateinit var web: WebView
    private lateinit var ajustes: Ajustes
    private lateinit var pedirPermisos: ActivityResultLauncher<Set<String>>
    private var concedidos: Set<String> = emptySet()
    private var hcDisponible = false
    private var sincronizando = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ajustes = Ajustes(this)
        hcDisponible = HealthConnectClient.getSdkStatus(this) == HealthConnectClient.SDK_AVAILABLE

        pedirPermisos = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) {
            refrescarPermisos(despues = { if (it.isNotEmpty()) sincronizar() })
        }

        web = WebView(this).apply {
            setBackgroundColor(asfalto)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = true
            settings.setSupportMultipleWindows(false)
            settings.userAgentString = settings.userAgentString + " BloqueApp/" + versionApp()
            addJavascriptInterface(Puente(), "BloqueNativo")
            webViewClient = Cliente()
        }

        // Android 15 dibuja detrás de las barras del sistema: se deja el espacio que ocupan.
        val marco = FrameLayout(this).apply {
            setBackgroundColor(asfalto)
            addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            marco.setOnApplyWindowInsetsListener { v, insets ->
                val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                v.setPadding(b.left, b.top, b.right, b.bottom)
                WindowInsets.CONSUMED
            }
        }
        setContentView(marco)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        if (!recibirLogin(intent)) web.loadUrl(SITIO)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        recibirLogin(intent)
    }

    override fun onResume() {
        super.onResume()
        refrescarPermisos(despues = {
            val vieja = System.currentTimeMillis() - ajustes.ultimaSync > SYNC_AL_ABRIR_MS
            if (ajustes.codigo != null && tieneLectura() && vieja) sincronizar()
        })
    }

    // ---------- Login con Google ----------
    // Google no deja iniciar sesión dentro de una WebView: se abre en Chrome y vuelve
    // por ec.bloque.puente://auth#access_token=…, que se le pasa a la web para que guarde la sesión.

    private fun recibirLogin(intent: Intent?): Boolean {
        val uri = intent?.data ?: return false
        if (uri.scheme != REGRESO_LOGIN || uri.host != "auth") return false
        val fragmento = uri.encodedFragment ?: uri.encodedQuery ?: ""
        web.loadUrl("${SITIO}?auth=${System.currentTimeMillis()}#$fragmento")
        return true
    }

    private fun abrirEnChrome(url: String) {
        try {
            CustomTabsIntent.Builder()
                .setDefaultColorSchemeParams(CustomTabColorSchemeParams.Builder().setToolbarColor(asfalto).build())
                .setShowTitle(true)
                .build()
                .launchUrl(this, Uri.parse(url))
        } catch (e: Exception) {
            abrirAfuera(url)
        }
    }

    private fun abrirAfuera(url: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (e: Exception) {
            Toast.makeText(this, "No se pudo abrir el enlace", Toast.LENGTH_SHORT).show()
        }
    }

    // ---------- Health Connect ----------

    private fun tieneLectura() = concedidos.intersect(Permisos.lectura).isNotEmpty()

    private fun refrescarPermisos(despues: (() -> Unit)? = null) {
        if (!hcDisponible) { emitir("estado", estadoJson()); despues?.invoke(); return }
        lifecycleScope.launch {
            concedidos = try {
                HealthConnectClient.getOrCreate(this@MainActivity).permissionController.getGrantedPermissions()
            } catch (e: Exception) {
                emptySet()
            }
            emitir("estado", estadoJson())
            despues?.invoke()
        }
    }

    private fun sincronizar() {
        if (sincronizando || ajustes.codigo == null) return
        sincronizando = true
        emitir("estado", estadoJson())
        lifecycleScope.launch {
            val r = JSONObject()
            try {
                r.put("ok", true).put("resumen", Sincronizador.sincronizar(this@MainActivity))
            } catch (e: NoVinculado) {
                ajustes.desvincular()
                TrabajoSync.cancelar(this@MainActivity)
                r.put("ok", false).put("error", "no_vinculado")
            } catch (e: SecurityException) {
                r.put("ok", false).put("error", "permisos")
            } catch (e: Exception) {
                r.put("ok", false).put("error", "conexion")
            }
            sincronizando = false
            emitir("sync", r)
            emitir("estado", estadoJson())
        }
    }

    private fun estadoJson(): JSONObject = JSONObject()
        .put("hcDisponible", hcDisponible)
        .put("vinculado", ajustes.codigo != null)
        .put("personaId", ajustes.personaId ?: JSONObject.NULL)
        .put("permisosLectura", tieneLectura())
        .put("faltanPermisos", (Permisos.todos - concedidos).isNotEmpty())
        .put("segundoPlano", HealthPermissionConstantes.SEGUNDO_PLANO in concedidos)
        .put("ultimaSync", if (ajustes.ultimaSync > 0) ajustes.ultimaSync else JSONObject.NULL)
        .put("ultimoResultado", ajustes.ultimoResultado ?: JSONObject.NULL)
        .put("sincronizando", sincronizando)
        .put("version", versionApp())

    /** Avisa a la web: window.bloqueNativoEvento(tipo, datos). */
    private fun emitir(tipo: String, datos: JSONObject) {
        val js = "window.bloqueNativoEvento && window.bloqueNativoEvento(${JSONObject.quote(tipo)}, ${datos})"
        runOnUiThread { if (::web.isInitialized) web.evaluateJavascript(js, null) }
    }

    private fun versionApp(): Long = try {
        val info = packageManager.getPackageInfo(packageName, 0)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
    } catch (e: Exception) { 0L }

    // ---------- Archivos (exportar datos) ----------

    private fun guardarDescarga(nombre: String, contenido: String, tipo: String) {
        try {
            val bytes = contenido.toByteArray(Charsets.UTF_8)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val valores = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, nombre)
                    put(MediaStore.Downloads.MIME_TYPE, tipo)
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, valores) ?: throw Exception()
                contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                valores.clear(); valores.put(MediaStore.Downloads.IS_PENDING, 0)
                contentResolver.update(uri, valores, null, null)
            } else {
                val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: filesDir
                File(dir, nombre).writeBytes(bytes)
            }
            runOnUiThread { Toast.makeText(this, "Guardado en Descargas: $nombre", Toast.LENGTH_LONG).show() }
        } catch (e: Exception) {
            runOnUiThread { Toast.makeText(this, "No se pudo guardar el archivo", Toast.LENGTH_LONG).show() }
        }
    }

    // ---------- Navegación ----------

    private fun esNuestro(uri: Uri) = uri.scheme == "https" && uri.host == HOST && (uri.path ?: "").startsWith(RUTA)

    private inner class Cliente : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            if (esNuestro(uri)) return false
            if (uri.scheme == REGRESO_LOGIN) { recibirLogin(Intent(Intent.ACTION_VIEW, uri)); return true }
            // Todo lo demás (login, GitHub, enlaces externos) se abre fuera de la app.
            if (uri.host?.endsWith("supabase.co") == true || uri.host?.contains("google") == true) abrirEnChrome(uri.toString())
            else abrirAfuera(uri.toString())
            return true
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            view.loadDataWithBaseURL(
                null,
                """<html><body style="margin:0;background:#15171C;color:#F4F2EC;font-family:sans-serif;display:flex;
                   flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center;padding:24px">
                   <h2>Sin conexión</h2><p style="color:#A9ADB8">Bloque necesita internet para abrir la primera vez.</p>
                   <a href="$SITIO" style="margin-top:16px;background:#C6F432;color:#15171C;padding:14px 22px;border-radius:14px;
                   text-decoration:none;font-weight:bold">Reintentar</a></body></html>""",
                "text/html", "utf-8", null,
            )
        }
    }

    // ---------- Lo que la web puede pedirle a la app ----------
    // Solo la web de Bloque se carga en esta WebView (lo demás se abre afuera),
    // así que solo ella llega a estos métodos.

    private inner class Puente {
        @JavascriptInterface
        fun estado(): String = estadoJson().toString()

        @JavascriptInterface
        fun vincular(codigo: String, personaId: String) {
            if (codigo.length < 32) return
            ajustes.desvincular()
            ajustes.codigo = codigo
            ajustes.personaId = personaId
            TrabajoSync.programar(this@MainActivity)
            runOnUiThread { refrescarPermisos(despues = { if (tieneLectura()) sincronizar() }) }
        }

        @JavascriptInterface
        fun desvincular() {
            TrabajoSync.cancelar(this@MainActivity)
            ajustes.desvincular()
            emitir("estado", estadoJson())
        }

        @JavascriptInterface
        fun pedirPermisos() {
            runOnUiThread {
                if (!hcDisponible) {
                    abrirAfuera("https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata")
                } else {
                    this@MainActivity.pedirPermisos.launch(Permisos.todos)
                }
            }
        }

        @JavascriptInterface
        fun sincronizar() {
            runOnUiThread { this@MainActivity.sincronizar() }
        }

        @JavascriptInterface
        fun abrirLogin(url: String) {
            val uri = Uri.parse(url)
            if (uri.scheme == "https") runOnUiThread { abrirEnChrome(url) }
        }

        @JavascriptInterface
        fun abrirExterno(url: String) {
            val uri = Uri.parse(url)
            if (uri.scheme == "https") runOnUiThread { abrirAfuera(url) }
        }

        @JavascriptInterface
        fun guardarArchivo(nombre: String, contenido: String, tipo: String) {
            val limpio = nombre.replace(Regex("[^A-Za-z0-9._-]"), "_").take(80)
            guardarDescarga(limpio, contenido, tipo)
        }
    }
}

private object HealthPermissionConstantes {
    val SEGUNDO_PLANO = androidx.health.connect.client.permission.HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND
}
