plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// La firma viene del entorno de compilación (GitHub Actions) para que cada
// versión nueva se instale encima de la anterior sin desinstalar.
val firmaArchivo = System.getenv("FIRMA_ARCHIVO")

android {
    namespace = "ec.bloque.puente"
    compileSdk = 36

    defaultConfig {
        applicationId = "ec.bloque.puente"
        minSdk = 28
        targetSdk = 35
        versionCode = (System.getenv("VERSION_CODE") ?: "1").toInt()
        versionName = "1.0." + (System.getenv("VERSION_CODE") ?: "1")
    }

    signingConfigs {
        create("bloque") {
            if (firmaArchivo != null) {
                storeFile = file(firmaArchivo)
                storePassword = System.getenv("FIRMA_CLAVE")
                keyAlias = System.getenv("FIRMA_ALIAS")
                keyPassword = System.getenv("FIRMA_CLAVE")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (firmaArchivo != null) signingConfigs.getByName("bloque") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.health.connect:connect-client:1.1.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("androidx.browser:browser:1.8.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
