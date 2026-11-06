import java.util.Properties
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
val signingFile = providers.environmentVariable("ART_ANDROID_SIGNING_PROPERTIES").orNull?.let(::File)
val signing = signingFile?.takeIf { it.isFile }?.let { Properties().apply { it.inputStream().use(::load) } }
android {
    namespace = "xyz.catdad.artmanager"
    compileSdk = 36
    defaultConfig {
        applicationId = "xyz.catdad.artmanager"
        minSdk = 28
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "SITE_URL", "\"https://art.10xcatdad.xyz\"")
    }
    buildFeatures { compose = true; buildConfig = true }
    signingConfigs {
        getByName("debug") { storeFile = rootProject.file(".gradle/art-debug.keystore") }
        if (signing != null) create("release") {
            storeFile = signingFile!!.parentFile.resolve(signing.getProperty("storeFile"))
            storePassword = signing.getProperty("storePassword")
            keyAlias = signing.getProperty("keyAlias")
            keyPassword = signing.getProperty("keyPassword")
        }
    }
    buildTypes {
        debug {
            applicationIdSuffix = ".debug"; versionNameSuffix = "-debug"
            providers.gradleProperty("artTestSite").orNull?.let {
                require(it.matches(Regex("http://127\\.0\\.0\\.1:[0-9]{4,5}")))
                buildConfigField("String", "SITE_URL", "\"$it\"")
            }
        }
        release {
            if (signing != null) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}
kotlin { jvmToolchain(17) }
val prepareDebugKey by tasks.registering(Exec::class) {
    val output = rootProject.file(".gradle/art-debug.keystore")
    outputs.file(output)
    onlyIf { !output.exists() }
    doFirst { output.parentFile.mkdirs() }
    commandLine("${System.getProperty("java.home")}/bin/keytool", "-genkeypair", "-keystore", output.path,
        "-storepass", "android", "-keypass", "android", "-alias", "androiddebugkey", "-keyalg", "RSA", "-keysize", "2048",
        "-validity", "10000", "-dname", "CN=Android Debug,O=10xCatDad,C=US")
}
tasks.configureEach { if (name.startsWith("validateSigningDebug")) dependsOn(prepareDebugKey) }
dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.06.01"))
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-compose:1.12.4")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.10.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
}
