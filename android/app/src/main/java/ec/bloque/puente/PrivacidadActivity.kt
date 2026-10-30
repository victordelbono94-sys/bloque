package ec.bloque.puente

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.util.TypedValue
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity

/** Lo que Health Connect muestra cuando alguien pregunta cómo usa Bloq los datos. */
class PrivacidadActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()
        val tiza = Color.parseColor("#F4F2EC")

        val contenido = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(28), dp(20), dp(28))
        }
        contenido.addView(TextView(this).apply {
            text = "Cómo usa Bloq tus datos"
            setTextColor(tiza); textSize = 24f; typeface = Typeface.DEFAULT_BOLD
            setPadding(0, 0, 0, dp(16))
        })
        contenido.addView(TextView(this).apply {
            text = "Bloq lee de Health Connect tus pasos, calorías, sueño, frecuencia cardiaca, " +
                "entrenos y mediciones corporales, y los guarda en tu cuenta privada de Bloq " +
                "para planificar tus entrenamientos y cuidar tu recuperación.\n\n" +
                "También escribe en Health Connect las mediciones que cargas en Bloq " +
                "(peso, grasa, masa magra, masa ósea, agua y metabolismo basal).\n\n" +
                "Solo tú y las personas de tu hogar en Bloq ven estos datos. No se venden ni se " +
                "comparten con nadie más. Puedes quitar los permisos o cerrar sesión cuando quieras."
            setTextColor(tiza); textSize = 16f; setLineSpacing(0f, 1.25f)
            background = GradientDrawable().apply { setColor(Color.parseColor("#2A2D35")); cornerRadius = dp(16).toFloat() }
            setPadding(dp(18), dp(18), dp(18), dp(18))
        })
        setContentView(ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#15171C"))
            addView(contenido)
        })
    }
}
