package ec.bloque.puente

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** Sincroniza cada 30 minutos en segundo plano, cuando hay conexión (así el sueño llega al rato de despertar). */
class TrabajoSync(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = try {
        Sincronizador.sincronizar(applicationContext)
        Result.success()
    } catch (e: NoVinculado) {
        Ajustes(applicationContext).desvincular()
        Result.success()
    } catch (e: SecurityException) {
        // Sin permiso de lectura en segundo plano: se sincroniza al abrir la app.
        Result.success()
    } catch (e: Exception) {
        if (runAttemptCount < 3) Result.retry() else Result.success()
    }

    companion object {
        private const val NOMBRE = "bloque-sync"

        fun programar(context: Context) {
            val pedido = PeriodicWorkRequestBuilder<TrabajoSync>(30, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NOMBRE, ExistingPeriodicWorkPolicy.UPDATE, pedido)
        }

        fun cancelar(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(NOMBRE)
        }
    }
}
