package ec.bloque.puente

import android.Manifest
import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.view.ViewGroup
import android.view.WindowInsets
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.FileProvider
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
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
        const val EXTRA_RUTA = "ruta"
        private val RUTA_VALIDA = Regex("^((comenzar|confirmar)/[0-9a-f-]{36}|hoy|comida)$")
    }

    private val asfalto = Color.parseColor("#15171C")
    private lateinit var web: WebView
    private lateinit var ajustes: Ajustes
    private lateinit var pedirPermisos: ActivityResultLauncher<Set<String>>
    private var concedidos: Set<String> = emptySet()
    private var hcDisponible = false
    private var sincronizando = false
    private lateinit var actualizador: Actualizador
    private lateinit var pedirNotificaciones: ActivityResultLauncher<String>
    private lateinit var pedirUbicacion: ActivityResultLauncher<Array<String>>
    private lateinit var pedirUbicacionFondo: ActivityResultLauncher<String>
    private var ubicacionPendiente = false
    private lateinit var pedirCamara: ActivityResultLauncher<String>
    private lateinit var elegirArchivo: ActivityResultLauncher<Intent>
    private var permisoWebPendiente: PermissionRequest? = null
    private var archivoPendiente: ValueCallback<Array<Uri>>? = null
    private var fotoCamara: Uri? = null
    private var camaraParaFoto: Intent? = null  // galería de respaldo mientras se pide el permiso de cámara

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ajustes = Ajustes(this)
        actualizador = Actualizador(this, versionApp())
        hcDisponible = HealthConnectClient.getSdkStatus(this) == HealthConnectClient.SDK_AVAILABLE

        pedirPermisos = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) {
            refrescarPermisos(despues = { if (it.isNotEmpty()) sincronizar() })
        }
        pedirNotificaciones = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            // Si los avisos al llegar están activos, después de las notificaciones va la ubicación.
            if (Avisos.config(this).optBoolean("llegada") && Avisos.estadoUbicacion(this) != "siempre") pedirUbicacionPrecisa()
            else alCambiarAvisos()
        }
        pedirUbicacion = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            val estado = Avisos.estadoUbicacion(this)
            if (ubicacionPendiente) { ubicacionPendiente = false; leerUbicacion() }
            else if (estado == "en_uso" && Avisos.config(this).optBoolean("llegada") && Build.VERSION.SDK_INT >= 29) {
                // Android pide «todo el tiempo» en un segundo paso.
                pedirUbicacionFondo.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            }
            alCambiarAvisos()
        }
        pedirUbicacionFondo = registerForActivityResult(ActivityResultContracts.RequestPermission()) { alCambiarAvisos() }
        pedirCamara = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
            permisoWebPendiente?.let { if (ok) it.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else it.deny() }
            permisoWebPendiente = null
            // Foto de comida pedida con la cámara: con permiso se abre la cámara; sin él, la galería.
            camaraParaFoto?.let { galeria ->
                camaraParaFoto = null
                val intent = if (ok) intentCamara() ?: galeria else galeria
                try { elegirArchivo.launch(intent) } catch (e: Exception) { archivoPendiente?.onReceiveValue(null); archivoPendiente = null }
            }
        }
        elegirArchivo = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
            var uris = WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data)
            // Foto sacada con la cámara: no vuelve en el intent, quedó en el archivo que le pasamos.
            if (uris == null && r.resultCode == RESULT_OK && fotoCamara != null) uris = arrayOf(fotoCamara!!)
            archivoPendiente?.onReceiveValue(uris)
            archivoPendiente = null
            fotoCamara = null
        }

        web = WebView(this).apply {
            setBackgroundColor(asfalto)
            // Sin el "estirón" de Android al tirar desde arriba o abajo: el menú no se mueve.
            overScrollMode = android.view.View.OVER_SCROLL_NEVER
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = true
            settings.setSupportMultipleWindows(false)
            settings.userAgentString = settings.userAgentString + " BloqueApp/" + versionApp()
            addJavascriptInterface(Puente(), "BloqueNativo")
            webViewClient = Cliente()
            webChromeClient = Navegador()
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
                // Primero la web: si hay una hoja abierta, la cierra ella y no se navega.
                web.evaluateJavascript("window.bloqueAtras ? window.bloqueAtras() : false") { r ->
                    if (r != "true") { if (web.canGoBack()) web.goBack() else finish() }
                }
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        if (!recibirLogin(intent)) web.loadUrl(rutaDe(intent)?.let { "$SITIO#/$it" } ?: SITIO)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (!recibirLogin(intent)) rutaDe(intent)?.let { web.loadUrl("$SITIO#/$it") }
    }

    override fun onResume() {
        super.onResume()
        Avisos.aplicar(this) // por si cambió un permiso en Ajustes
        actualizador.alVolver()
        actualizador.revisar()
        refrescarPermisos(despues = {
            val vieja = System.currentTimeMillis() - ajustes.ultimaSync > SYNC_AL_ABRIR_MS
            if (ajustes.codigo != null && tieneLectura() && vieja) sincronizar()
        })
    }

    /** Una notificación de Bloque abre una pantalla concreta (solo rutas conocidas). */
    private fun rutaDe(intent: Intent?): String? =
        intent?.getStringExtra(EXTRA_RUTA)?.takeIf { RUTA_VALIDA.matches(it) }

    // ---------- Avisos y ubicación ----------

    private fun alCambiarAvisos() {
        Avisos.aplicar(this)
        emitir("estado", estadoJson())
    }

    private fun pedirUbicacionPrecisa() {
        pedirUbicacion.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
    }

    @SuppressLint("MissingPermission")
    private fun leerUbicacion() {
        if (Avisos.estadoUbicacion(this) == "no") {
            emitir("ubicacion", JSONObject().put("error", "permiso"))
            return
        }
        try {
            LocationServices.getFusedLocationProviderClient(this)
                .getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, CancellationTokenSource().token)
                .addOnSuccessListener { loc ->
                    if (loc == null) emitir("ubicacion", JSONObject().put("error", "sin_senal"))
                    else emitir("ubicacion", JSONObject().put("lat", loc.latitude).put("lng", loc.longitude).put("precision", loc.accuracy.toInt()))
                }
                .addOnFailureListener { emitir("ubicacion", JSONObject().put("error", "sin_senal")) }
        } catch (e: Exception) {
            emitir("ubicacion", JSONObject().put("error", "sin_senal"))
        }
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
        .put("avisos", Avisos.estado(this))

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

    // ---------- Cámara y archivos para la web ----------
    // La web pide la cámara para leer códigos de barras, y elige fotos de comidas.

    private inner class Navegador : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest) {
            runOnUiThread {
                val nuestra = request.origin?.host == HOST
                if (!nuestra || PermissionRequest.RESOURCE_VIDEO_CAPTURE !in request.resources) { request.deny(); return@runOnUiThread }
                if (checkSelfPermission(Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                } else {
                    permisoWebPendiente?.deny()
                    permisoWebPendiente = request
                    pedirCamara.launch(Manifest.permission.CAMERA)
                }
            }
        }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            archivoPendiente?.onReceiveValue(null)
            archivoPendiente = callback
            val galeria = params.createIntent()
            val imagenes = params.acceptTypes.any { it.startsWith("image") }
            // «Sacar foto» (input con capture): directo a la cámara, pidiendo el permiso si hace falta.
            if (imagenes && params.isCaptureEnabled) {
                val conPermiso = checkSelfPermission(Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED
                if (!conPermiso) {
                    camaraParaFoto = galeria
                    pedirCamara.launch(Manifest.permission.CAMERA)
                    return true
                }
                return try { elegirArchivo.launch(intentCamara() ?: galeria); true } catch (e: Exception) { archivoPendiente = null; false }
            }
            val intent = if (imagenes) {
                // Galería o cámara, a elección.
                // Android no deja abrir la cámara si Bloque declara el permiso y no lo tiene concedido.
                val conPermiso = checkSelfPermission(Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED
                val camara = if (!conPermiso) null else try {
                    val dir = File(cacheDir, "fotos").apply { mkdirs() }
                    val archivo = File(dir, "comida-${System.currentTimeMillis()}.jpg")
                    fotoCamara = FileProvider.getUriForFile(this@MainActivity, "$packageName.archivos", archivo)
                    Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).putExtra(android.provider.MediaStore.EXTRA_OUTPUT, fotoCamara)
                        .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                } catch (e: Exception) { null }
                Intent.createChooser(galeria, "Foto de la comida").apply {
                    if (camara != null) putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(camara))
                }
            } else galeria
            return try {
                elegirArchivo.launch(intent)
                true
            } catch (e: Exception) {
                archivoPendiente = null
                false
            }
        }
    }

    /** Cámara del teléfono guardando la foto en un archivo propio (la web la recibe al volver). */
    private fun intentCamara(): Intent? = try {
        val dir = File(cacheDir, "fotos").apply { mkdirs() }
        val archivo = File(dir, "comida-${System.currentTimeMillis()}.jpg")
        fotoCamara = FileProvider.getUriForFile(this, "$packageName.archivos", archivo)
        Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).putExtra(android.provider.MediaStore.EXTRA_OUTPUT, fotoCamara)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    } catch (e: Exception) { null }

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
            Avisos.limpiar(this@MainActivity)
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
        fun buscarActualizacion() {
            runOnUiThread { actualizador.revisar(forzar = true) }
        }

        @JavascriptInterface
        fun programarAgenda(json: String) {
            try { Avisos.guardarAgenda(this@MainActivity, json) } catch (e: Exception) { }
        }

        @JavascriptInterface
        fun configurarAvisos(json: String) {
            try { Avisos.guardarConfig(this@MainActivity, json) } catch (e: Exception) { }
            emitir("estado", estadoJson())
        }

        @JavascriptInterface
        fun pedirNotificaciones() {
            runOnUiThread {
                if (Build.VERSION.SDK_INT >= 33 && !Avisos.notificacionesPermitidas(this@MainActivity) &&
                    checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
                ) {
                    this@MainActivity.pedirNotificaciones.launch(Manifest.permission.POST_NOTIFICATIONS)
                } else if (!Avisos.notificacionesPermitidas(this@MainActivity)) {
                    // Ya se negó antes o están apagadas: se cambian en Ajustes.
                    startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
                } else if (Avisos.config(this@MainActivity).optBoolean("llegada") && Avisos.estadoUbicacion(this@MainActivity) != "siempre") {
                    pedirUbicacionPrecisa()
                }
            }
        }

        @JavascriptInterface
        fun pedirUbicacion() {
            runOnUiThread {
                when (Avisos.estadoUbicacion(this@MainActivity)) {
                    "en_uso" -> if (Build.VERSION.SDK_INT >= 29) pedirUbicacionFondo.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                    "siempre" -> alCambiarAvisos()
                    else -> pedirUbicacionPrecisa()
                }
            }
        }

        @JavascriptInterface
        fun ubicacionActual() {
            runOnUiThread {
                if (Avisos.estadoUbicacion(this@MainActivity) == "no") { ubicacionPendiente = true; pedirUbicacionPrecisa() }
                else leerUbicacion()
            }
        }

        @JavascriptInterface
        fun abrirAjustesApp() {
            runOnUiThread {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
            }
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
