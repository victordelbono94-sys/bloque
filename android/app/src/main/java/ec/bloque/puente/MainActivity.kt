package ec.bloque.puente

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.text.format.DateUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val asfalto = Color.parseColor("#15171C")
    private val grafito = Color.parseColor("#2A2D35")
    private val tiza = Color.parseColor("#F4F2EC")
    private val gris = Color.parseColor("#A9ADB8")
    private val volt = Color.parseColor("#C6F432")
    private val rojo = Color.parseColor("#FF8A80")

    private lateinit var ajustes: Ajustes
    private lateinit var contenido: LinearLayout
    private lateinit var pedirPermisos: ActivityResultLauncher<Set<String>>
    private var sincronizando = false
    private var mensaje: Pair<String, Boolean>? = null // texto, es error

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ajustes = Ajustes(this)
        pedirPermisos = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) {
            pintar()
            if (it.isNotEmpty()) sincronizarAhora()
        }

        contenido = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(28), dp(20), dp(28))
        }
        setContentView(ScrollView(this).apply {
            setBackgroundColor(asfalto)
            isFillViewport = true
            addView(contenido)
        })

        if (intent?.action == "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" ||
            intent?.action == "android.intent.action.VIEW_PERMISSION_USAGE") {
            pintarPrivacidad()
            return
        }
        recibirEnlace(intent)
        pintar()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        recibirEnlace(intent)
        pintar()
    }

    override fun onResume() {
        super.onResume()
        if (ajustes.codigo != null && !sincronizando) pintar()
    }

    // bloque-puente://vincular?c=<código>
    private fun recibirEnlace(intent: Intent?) {
        val uri: Uri = intent?.data ?: return
        if (uri.scheme != "bloque-puente") return
        val codigo = uri.getQueryParameter("c")?.trim()
        if (codigo.isNullOrEmpty() || codigo.length < 32) {
            mensaje = "El enlace no tiene un código válido. Genera uno nuevo en Bloque." to true
            return
        }
        vincular(codigo)
    }

    private fun vincular(codigo: String) {
        ajustes.desvincular()
        ajustes.codigo = codigo
        mensaje = "Teléfono vinculado. Ahora da los permisos de Health Connect." to false
        TrabajoSync.programar(this)
    }

    // ---------- Pantallas ----------

    private fun pintar() {
        contenido.removeAllViews()
        contenido.addView(marca())

        if (HealthConnectClient.getSdkStatus(this) != HealthConnectClient.SDK_AVAILABLE) {
            contenido.addView(tarjeta(
                titulo("Health Connect no está disponible"),
                texto("Actualiza el teléfono o instala Health Connect desde Play Store y vuelve a abrir esta app."),
            ))
            return
        }

        mensaje?.let { (t, error) -> contenido.addView(aviso(t, error)) }

        val codigo = ajustes.codigo
        if (codigo == null) {
            pintarSinVincular()
            return
        }

        lifecycleScope.launch {
            val hc = HealthConnectClient.getOrCreate(this@MainActivity)
            val concedidos = hc.permissionController.getGrantedPermissions()
            val faltan = Permisos.todos - concedidos
            pintarVinculado(concedidos.intersect(Permisos.lectura).isNotEmpty(), faltan.isNotEmpty())
        }
    }

    private fun pintarSinVincular() {
        contenido.addView(tarjeta(
            titulo("Vincula este teléfono"),
            texto("1. Abre Bloque → Perfil.\n2. Toca «Vincular teléfono».\n3. Se abre esta app ya vinculada a tu cuenta."),
        ))
        val campo = EditText(this).apply {
            hint = "O pega el código acá"
            setHintTextColor(gris)
            setTextColor(tiza)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            background = redondeado(grafito, 12)
            setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        contenido.addView(espacio(16))
        contenido.addView(campo, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        contenido.addView(espacio(10))
        contenido.addView(boton("Vincular con el código", principal = false) {
            val c = campo.text.toString().trim()
            if (c.length < 32) {
                mensaje = "Ese código está incompleto." to true
            } else {
                vincular(c)
            }
            pintar()
        })
    }

    private fun pintarVinculado(tieneLectura: Boolean, faltanPermisos: Boolean) {
        contenido.removeAllViews()
        contenido.addView(marca())
        mensaje?.let { (t, error) -> contenido.addView(aviso(t, error)) }

        val nombre = ajustes.nombre
        val ultima = ajustes.ultimaSync
        contenido.addView(tarjeta(
            titulo(if (nombre != null) "Hola, $nombre" else "Teléfono vinculado"),
            texto(
                if (ultima > 0) "Última sincronización: ${DateUtils.getRelativeTimeSpanString(ultima)}" +
                    (ajustes.ultimoResultado?.let { "\n$it" } ?: "")
                else "Todavía no sincronizó."
            ),
            texto("Se sincroniza sola cada hora, aunque la app esté cerrada.", gris, 14f),
        ))
        contenido.addView(espacio(16))

        if (!tieneLectura || faltanPermisos) {
            contenido.addView(tarjeta(
                titulo(if (!tieneLectura) "Falta dar permisos" else "Faltan algunos permisos"),
                texto(
                    if (!tieneLectura) "Bloque necesita leer pasos, sueño, frecuencia cardiaca, entrenos y peso."
                    else "Activa todos, incluido «Acceder a datos en segundo plano», para que se sincronice sola."
                ),
            ))
            contenido.addView(espacio(10))
            contenido.addView(boton("Dar permisos de Health Connect") { pedirPermisos.launch(Permisos.todos) })
            contenido.addView(espacio(10))
        }

        if (tieneLectura) {
            contenido.addView(boton(if (sincronizando) "Sincronizando…" else "Sincronizar ahora", principal = faltanPermisos.not()) {
                sincronizarAhora()
            }.apply { isEnabled = !sincronizando })
        }

        contenido.addView(espacio(28))
        contenido.addView(boton("Desvincular este teléfono", principal = false, peligro = true) {
            TrabajoSync.cancelar(this)
            ajustes.desvincular()
            mensaje = "Teléfono desvinculado." to false
            pintar()
        })
    }

    private fun sincronizarAhora() {
        if (sincronizando) return
        sincronizando = true
        mensaje = null
        pintar()
        lifecycleScope.launch {
            mensaje = try {
                val r = Sincronizador.sincronizar(this@MainActivity)
                "Listo: $r" to false
            } catch (e: NoVinculado) {
                ajustes.desvincular()
                TrabajoSync.cancelar(this@MainActivity)
                "Este teléfono ya no está vinculado. Vincúlalo de nuevo desde Bloque." to true
            } catch (e: SecurityException) {
                "Falta algún permiso de Health Connect." to true
            } catch (e: Exception) {
                "No se pudo sincronizar. Revisa la conexión e intenta de nuevo." to true
            }
            sincronizando = false
            pintar()
        }
    }

    private fun pintarPrivacidad() {
        contenido.removeAllViews()
        contenido.addView(marca())
        contenido.addView(tarjeta(
            titulo("Cómo usa Bloque tus datos"),
            texto(
                "Bloque Puente lee de Health Connect tus pasos, calorías, sueño, frecuencia cardiaca, " +
                    "entrenos y mediciones corporales, y los guarda en tu cuenta privada de Bloque " +
                    "para planificar tus entrenamientos.\n\n" +
                    "También escribe en Health Connect las mediciones que cargas en Bloque.\n\n" +
                    "Solo tú y las personas de tu hogar en Bloque ven estos datos. No se venden ni se comparten con nadie más. " +
                    "Puedes desvincular el teléfono o quitar los permisos cuando quieras."
            ),
        ))
    }

    // ---------- Piezas de interfaz ----------

    private fun marca() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(0, 0, 0, dp(24))
        addView(TextView(this@MainActivity).apply {
            text = "bl"
            setTextColor(tiza); textSize = 34f; typeface = Typeface.create("sans-serif-black", Typeface.BOLD)
        })
        addView(View(this@MainActivity).apply { background = redondeado(volt, 4) }, LinearLayout.LayoutParams(dp(18), dp(18)).apply {
            setMargins(dp(2), dp(8), dp(2), 0)
        })
        addView(TextView(this@MainActivity).apply {
            text = "que"
            setTextColor(tiza); textSize = 34f; typeface = Typeface.create("sans-serif-black", Typeface.BOLD)
        })
        addView(TextView(this@MainActivity).apply {
            text = "  puente"
            setTextColor(gris); textSize = 18f
        })
    }

    private fun tarjeta(vararg hijos: View) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = redondeado(grafito, 16)
        setPadding(dp(18), dp(18), dp(18), dp(18))
        hijos.forEachIndexed { i, v -> if (i > 0) addView(espacio(8)); addView(v) }
    }

    private fun titulo(t: String) = TextView(this).apply {
        text = t; setTextColor(tiza); textSize = 20f; typeface = Typeface.DEFAULT_BOLD
    }

    private fun texto(t: String, color: Int = tiza, tam: Float = 16f) = TextView(this).apply {
        text = t; setTextColor(color); textSize = tam; setLineSpacing(0f, 1.2f)
    }

    private fun aviso(t: String, error: Boolean) = TextView(this).apply {
        text = t
        setTextColor(asfalto); textSize = 15f
        background = redondeado(if (error) rojo else volt, 12)
        setPadding(dp(14), dp(12), dp(14), dp(12))
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            bottomMargin = dp(16)
        }
    }

    private fun boton(t: String, principal: Boolean = true, peligro: Boolean = false, alTocar: () -> Unit) = Button(this).apply {
        text = t
        isAllCaps = false
        textSize = 16f
        typeface = Typeface.DEFAULT_BOLD
        stateListAnimator = null
        setTextColor(when { peligro -> rojo; principal -> asfalto; else -> tiza })
        background = redondeado(when { peligro -> asfalto; principal -> volt; else -> grafito }, 14)
        minHeight = dp(52)
        setOnClickListener { alTocar() }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
    }

    private fun espacio(alto: Int) = View(this).apply {
        layoutParams = LinearLayout.LayoutParams(1, dp(alto))
    }

    private fun redondeado(color: Int, radio: Int) = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(radio).toFloat()
    }

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()
}
