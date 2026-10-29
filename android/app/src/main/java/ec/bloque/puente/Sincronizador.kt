package ec.bloque.puente

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.BasalMetabolicRateRecord
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.BodyWaterMassRecord
import androidx.health.connect.client.records.BoneMassRecord
import androidx.health.connect.client.records.LeanBodyMassRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.units.Mass
import androidx.health.connect.client.units.Percentage
import androidx.health.connect.client.units.Power
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import kotlin.reflect.KClass

/** Una vuelta completa: leer de Health Connect, mandar a Bloque y escribir lo pendiente. */
object Sincronizador {

    suspend fun sincronizar(context: Context): String = withContext(Dispatchers.IO) {
        val ajustes = Ajustes(context)
        val codigo = ajustes.codigo ?: return@withContext "Falta vincular el teléfono."
        if (HealthConnectClient.getSdkStatus(context) != HealthConnectClient.SDK_AVAILABLE) {
            return@withContext "Health Connect no está disponible en este teléfono."
        }
        val hc = HealthConnectClient.getOrCreate(context)
        val permisos = hc.permissionController.getGrantedPermissions()
        if (permisos.intersect(Permisos.lectura).isEmpty()) {
            return@withContext "Faltan los permisos de Health Connect."
        }

        val zona = ZoneId.systemDefault()
        val hoy = LocalDate.now(zona)
        val diasAtras = if (ajustes.primeraHecha) 3L else 30L
        val desdeDia = hoy.minusDays(diasAtras)
        val desde = desdeDia.atStartOfDay(zona).toInstant()
        val ahora = Instant.now()

        val lector = Lector(context, hc, permisos)
        val sesiones = lector.sesiones(desde, ahora)
        val cuerpo = JSONObject()
            .put("dias", lector.dias(desdeDia, hoy))
            .put("sesiones", sesiones)
            .put("mediciones", lector.mediciones(desde.minus(4, ChronoUnit.DAYS), ahora))

        val respuesta = Api.sincronizar(codigo, cuerpo)
        respuesta.optString("nombre").takeIf { it.isNotEmpty() }?.let { ajustes.nombre = it }

        // Mediciones cargadas en Bloque que faltan en Health Connect.
        val escritas = escribirPendientes(context, hc, permisos, respuesta.optJSONArray("pendientes") ?: JSONArray())
        if (escritas.length() > 0) Api.sincronizar(codigo, JSONObject().put("escritas", escritas))

        // ¿Grabaste fuerza en el reloj sin abrir el entreno en Bloque? Se ofrece anotar las series.
        try { Avisos.alSincronizar(context, sesiones) } catch (e: Exception) { }
        // ¿Ya te despertaste? Una hora después se pregunta cómo amaneciste; y se guarda lo de hoy para los recordatorios.
        try { Bienestar.alSincronizar(context, cuerpo.getJSONArray("dias"), respuesta.optJSONObject("hoy")) } catch (e: Exception) { }

        ajustes.primeraHecha = true
        ajustes.ultimaSync = System.currentTimeMillis()
        val r = respuesta.optJSONObject("resumen") ?: JSONObject()
        fun cuenta(n: Int, uno: String, varios: String) = "$n ${if (n == 1) uno else varios}"
        val texto = buildList {
            add(cuenta(r.optInt("dias"), "día", "días"))
            add(cuenta(r.optInt("sesiones"), "entreno", "entrenos"))
            if (r.optInt("mediciones") > 0) add(cuenta(r.optInt("mediciones"), "medición", "mediciones"))
            if (escritas.length() > 0) add("${cuenta(escritas.length(), "medición", "mediciones")} a Health Connect")
        }.joinToString(" · ")
        ajustes.ultimoResultado = texto
        texto
    }

    private suspend fun escribirPendientes(
        context: Context,
        hc: HealthConnectClient,
        permisos: Set<String>,
        pendientes: JSONArray,
    ): JSONArray {
        val hechas = JSONArray()
        fun puede(c: KClass<out Record>) = HealthPermission.getWritePermission(c) in permisos
        val zona = ZoneId.systemDefault()

        for (i in 0 until pendientes.length()) {
            val m = pendientes.getJSONObject(i)
            val id = m.getString("id")
            val hora = OffsetDateTime.parse(m.getString("medido_en")).toInstant()
            val offset = zona.rules.getOffset(hora)
            // El mismo identificador en cada intento: si se repite, Health Connect lo reemplaza en vez de duplicar.
            fun meta(sufijo: String) = Metadata.manualEntry(clientRecordId = "bloque-$id-$sufijo", clientRecordVersion = 1L)
            fun dato(nombre: String): Double? = if (m.isNull(nombre)) null else m.optDouble(nombre).takeIf { !it.isNaN() }

            val registros = mutableListOf<Record>()
            val peso = dato("peso_kg")
            if (peso != null && puede(WeightRecord::class)) {
                registros += WeightRecord(time = hora, zoneOffset = offset, weight = Mass.kilograms(peso), metadata = meta("peso"))
            }
            dato("grasa_pct")?.takeIf { puede(BodyFatRecord::class) }?.let {
                registros += BodyFatRecord(time = hora, zoneOffset = offset, percentage = Percentage(it), metadata = meta("grasa"))
            }
            dato("masa_magra_kg")?.takeIf { puede(LeanBodyMassRecord::class) }?.let {
                registros += LeanBodyMassRecord(time = hora, zoneOffset = offset, mass = Mass.kilograms(it), metadata = meta("magra"))
            }
            dato("masa_osea_kg")?.takeIf { puede(BoneMassRecord::class) }?.let {
                registros += BoneMassRecord(time = hora, zoneOffset = offset, mass = Mass.kilograms(it), metadata = meta("osea"))
            }
            val agua = dato("agua_pct")
            if (agua != null && peso != null && puede(BodyWaterMassRecord::class)) {
                registros += BodyWaterMassRecord(time = hora, zoneOffset = offset, mass = Mass.kilograms(peso * agua / 100), metadata = meta("agua"))
            }
            dato("metabolismo_basal_kcal")?.takeIf { puede(BasalMetabolicRateRecord::class) }?.let {
                registros += BasalMetabolicRateRecord(time = hora, zoneOffset = offset, basalMetabolicRate = Power.kilocaloriesPerDay(it), metadata = meta("basal"))
            }

            if (registros.isEmpty()) {
                // Nada que Health Connect pueda guardar (por ejemplo, solo grasa visceral): se marca igual.
                hechas.put(JSONObject().put("id", id))
                continue
            }
            try {
                val ids = hc.insertRecords(registros).recordIdsList
                hechas.put(JSONObject().put("id", id).put("hc_record_id", ids.firstOrNull()))
            } catch (e: Exception) {
                // Se reintenta en la próxima sincronización.
            }
        }
        return hechas
    }
}
