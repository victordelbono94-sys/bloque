package ec.bloque.puente

import android.content.Context

// Lo que el teléfono recuerda: el código de vinculación y cómo fue la última sincronización.
class Ajustes(context: Context) {
    private val prefs = context.getSharedPreferences("bloque_puente", Context.MODE_PRIVATE)

    var codigo: String?
        get() = prefs.getString("codigo", null)
        set(v) = prefs.edit().putString("codigo", v).apply()

    /** La persona de Bloque dueña de este vínculo (para cambiar de cuenta en el mismo teléfono). */
    var personaId: String?
        get() = prefs.getString("persona_id", null)
        set(v) = prefs.edit().putString("persona_id", v).apply()

    var nombre: String?
        get() = prefs.getString("nombre", null)
        set(v) = prefs.edit().putString("nombre", v).apply()

    var ultimaSync: Long
        get() = prefs.getLong("ultima_sync", 0L)
        set(v) = prefs.edit().putLong("ultima_sync", v).apply()

    var ultimoResultado: String?
        get() = prefs.getString("ultimo_resultado", null)
        set(v) = prefs.edit().putString("ultimo_resultado", v).apply()

    /** La primera sincronización trae 30 días; después, solo los últimos días. */
    var primeraHecha: Boolean
        get() = prefs.getBoolean("primera_hecha", false)
        set(v) = prefs.edit().putBoolean("primera_hecha", v).apply()

    fun desvincular() {
        prefs.edit().clear().apply()
    }
}
