package ec.bloque.puente

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class NoVinculado : Exception("El teléfono ya no está vinculado")

object Api {
    private const val URL_SYNC = "https://bdfycibpmutvpyobperj.supabase.co/functions/v1/sync-health"

    /** Manda lo leído y devuelve la respuesta (nombre, resumen y mediciones pendientes). */
    fun sincronizar(codigo: String, cuerpo: JSONObject): JSONObject {
        val con = URL(URL_SYNC).openConnection() as HttpURLConnection
        try {
            con.requestMethod = "POST"
            con.connectTimeout = 15_000
            con.readTimeout = 30_000
            con.doOutput = true
            con.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            con.setRequestProperty("Authorization", "Bearer $codigo")
            con.outputStream.use { it.write(cuerpo.toString().toByteArray(Charsets.UTF_8)) }
            val estado = con.responseCode
            val texto = (if (estado in 200..299) con.inputStream else con.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: "{}"
            if (estado == 401) throw NoVinculado()
            if (estado !in 200..299) throw Exception("Bloq respondió $estado: $texto")
            return JSONObject(texto)
        } finally {
            con.disconnect()
        }
    }
}
