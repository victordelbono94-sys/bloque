package ec.bloque.puente

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.aggregate.AggregateMetric
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.BasalMetabolicRateRecord
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.BodyWaterMassRecord
import androidx.health.connect.client.records.BoneMassRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.LeanBodyMassRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.Period
import java.time.ZoneId
import kotlin.reflect.KClass

/** Lee de Health Connect lo que Bloque necesita. Salta lo que no tiene permiso. */
class Lector(private val context: Context, private val hc: HealthConnectClient, private val permisos: Set<String>) {
    private val zona: ZoneId = ZoneId.systemDefault()

    private fun puede(clase: KClass<out Record>) = HealthPermission.getReadPermission(clase) in permisos

    // ---------- Resumen por día ----------

    suspend fun dias(desde: LocalDate, hasta: LocalDate): JSONArray {
        val porDia = sortedMapOf<LocalDate, JSONObject>()
        fun dia(f: LocalDate) = porDia.getOrPut(f) { JSONObject().put("fecha", f.toString()) }

        val metricas = mutableSetOf<AggregateMetric<*>>()
        if (puede(StepsRecord::class)) metricas += StepsRecord.COUNT_TOTAL
        if (puede(ActiveCaloriesBurnedRecord::class)) metricas += ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL
        if (puede(TotalCaloriesBurnedRecord::class)) metricas += TotalCaloriesBurnedRecord.ENERGY_TOTAL
        if (puede(RestingHeartRateRecord::class)) metricas += RestingHeartRateRecord.BPM_AVG

        if (metricas.isNotEmpty()) {
            val grupos = hc.aggregateGroupByPeriod(
                AggregateGroupByPeriodRequest(
                    metrics = metricas,
                    timeRangeFilter = TimeRangeFilter.between(desde.atStartOfDay(), hasta.plusDays(1).atStartOfDay()),
                    timeRangeSlicer = Period.ofDays(1),
                )
            )
            for (g in grupos) {
                val d = dia(g.startTime.toLocalDate())
                g.result[StepsRecord.COUNT_TOTAL]?.let { d.put("pasos", it) }
                g.result[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.let { d.put("calorias_activas", it.inKilocalories.toInt()) }
                g.result[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.let { d.put("calorias_totales", it.inKilocalories.toInt()) }
                g.result[RestingHeartRateRecord.BPM_AVG]?.let { d.put("fc_reposo", it) }
            }
        }

        // El sueño cuenta para el día en que termina (la noche del martes al miércoles es del miércoles).
        if (puede(SleepSessionRecord::class)) {
            val inicio = desde.minusDays(1).atStartOfDay(zona).toInstant()
            val fin = hasta.plusDays(1).atStartOfDay(zona).toInstant()
            val minutos = mutableMapOf<LocalDate, Long>()
            val despertar = mutableMapOf<LocalDate, java.time.Instant>()
            for (s in leerTodo(SleepSessionRecord::class, inicio, fin)) {
                val f = s.endTime.atZone(zona).toLocalDate()
                if (f < desde || f > hasta) continue
                minutos[f] = (minutos[f] ?: 0L) + Duration.between(s.startTime, s.endTime).toMinutes()
                // A qué hora te despertaste (el final del último sueño del día): para el aviso de «cómo amaneciste».
                if (despertar[f]?.isBefore(s.endTime) != false) despertar[f] = s.endTime
            }
            for ((f, m) in minutos) dia(f).put("sueno_min", m.coerceAtMost(1440))
            for ((f, t) in despertar) dia(f).put("despertar", t.toString())
        }

        return JSONArray(porDia.values.filter { it.length() > 1 })
    }

    // ---------- Sesiones de ejercicio ----------

    suspend fun sesiones(desde: Instant, hasta: Instant): JSONArray {
        val lista = JSONArray()
        if (!puede(ExerciseSessionRecord::class)) return lista
        for (s in leerTodo(ExerciseSessionRecord::class, desde, hasta)) {
            val o = JSONObject()
                .put("hc_record_id", s.metadata.id)
                .put("inicio", s.startTime.toString())
                .put("fin", s.endTime.toString())
                .put("tipo", tipoEjercicio(s.exerciseType))
            val metricas = mutableSetOf<AggregateMetric<*>>()
            if (puede(HeartRateRecord::class)) { metricas += HeartRateRecord.BPM_AVG; metricas += HeartRateRecord.BPM_MAX }
            if (puede(ActiveCaloriesBurnedRecord::class)) metricas += ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL
            if (puede(TotalCaloriesBurnedRecord::class)) metricas += TotalCaloriesBurnedRecord.ENERGY_TOTAL
            if (metricas.isNotEmpty()) {
                val r = hc.aggregate(AggregateRequest(metricas, TimeRangeFilter.between(s.startTime, s.endTime)))
                r[HeartRateRecord.BPM_AVG]?.let { o.put("fc_promedio", it) }
                r[HeartRateRecord.BPM_MAX]?.let { o.put("fc_max", it) }
                val kcal = r[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL] ?: r[TotalCaloriesBurnedRecord.ENERGY_TOTAL]
                kcal?.let { o.put("calorias", it.inKilocalories.toInt()) }
            }
            lista.put(o)
        }
        return lista
    }

    private fun tipoEjercicio(t: Int): String = when (t) {
        ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING -> "fuerza"
        ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING -> "pesas"
        ExerciseSessionRecord.EXERCISE_TYPE_SKATING -> "patinaje"
        ExerciseSessionRecord.EXERCISE_TYPE_ROCK_CLIMBING -> "escalada"
        ExerciseSessionRecord.EXERCISE_TYPE_HIKING -> "trekking"
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING -> "correr"
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING -> "caminar"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING -> "bicicleta"
        ExerciseSessionRecord.EXERCISE_TYPE_YOGA -> "yoga"
        ExerciseSessionRecord.EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING -> "hiit"
        else -> "tipo_$t"
    }

    // ---------- Mediciones de otras apps (balanza, Mi Fitness) ----------

    suspend fun mediciones(desde: Instant, hasta: Instant): JSONArray {
        val lista = JSONArray()
        if (!puede(WeightRecord::class)) return lista
        val propio = context.packageName
        val pesos = leerTodo(WeightRecord::class, desde, hasta).filter { it.metadata.dataOrigin.packageName != propio }
        if (pesos.isEmpty()) return lista

        val grasas = if (puede(BodyFatRecord::class)) leerTodo(BodyFatRecord::class, desde, hasta) else emptyList()
        val magras = if (puede(LeanBodyMassRecord::class)) leerTodo(LeanBodyMassRecord::class, desde, hasta) else emptyList()
        val oseas = if (puede(BoneMassRecord::class)) leerTodo(BoneMassRecord::class, desde, hasta) else emptyList()
        val aguas = if (puede(BodyWaterMassRecord::class)) leerTodo(BodyWaterMassRecord::class, desde, hasta) else emptyList()
        val basales = if (puede(BasalMetabolicRateRecord::class)) leerTodo(BasalMetabolicRateRecord::class, desde, hasta) else emptyList()

        // Las balanzas guardan cada dato por separado pero al mismo tiempo: se juntan por cercanía (±10 min).
        fun <T> cerca(lista: List<T>, hora: Instant, t: (T) -> Instant) =
            lista.firstOrNull { Duration.between(t(it), hora).abs() <= Duration.ofMinutes(10) }

        for (p in pesos) {
            val kg = p.weight.inKilograms
            val o = JSONObject()
                .put("hc_record_id", p.metadata.id)
                .put("medido_en", p.time.toString())
                .put("peso_kg", redondear(kg, 2))
            cerca(grasas, p.time) { it.time }?.let { o.put("grasa_pct", redondear(it.percentage.value, 1)) }
            cerca(magras, p.time) { it.time }?.let { o.put("masa_magra_kg", redondear(it.mass.inKilograms, 2)) }
            cerca(oseas, p.time) { it.time }?.let { o.put("masa_osea_kg", redondear(it.mass.inKilograms, 2)) }
            cerca(aguas, p.time) { it.time }?.let { if (kg > 0) o.put("agua_pct", redondear(it.mass.inKilograms / kg * 100, 1)) }
            cerca(basales, p.time) { it.time }?.let { o.put("metabolismo_basal_kcal", it.basalMetabolicRate.inKilocaloriesPerDay.toInt()) }
            lista.put(o)
        }
        return lista
    }

    // ---------- Utilidades ----------

    private suspend fun <T : Record> leerTodo(clase: KClass<T>, desde: Instant, hasta: Instant): List<T> {
        val todo = mutableListOf<T>()
        var pagina: String? = null
        do {
            val r = hc.readRecords(
                ReadRecordsRequest(
                    recordType = clase,
                    timeRangeFilter = TimeRangeFilter.between(desde, hasta),
                    pageSize = 1000,
                    pageToken = pagina,
                )
            )
            todo += r.records
            pagina = r.pageToken
        } while (!pagina.isNullOrEmpty() && todo.size < 20_000)
        return todo
    }

    private fun redondear(v: Double, decimales: Int): Double {
        var f = 1.0
        repeat(decimales) { f *= 10 }
        return Math.round(v * f) / f
    }
}
