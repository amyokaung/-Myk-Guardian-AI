package com.myk.guardianai.accessibility

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import androidx.core.app.NotificationCompat
import java.util.Locale

/**
 * User-started foreground wake-word listener.
 *
 * This phase detects the spoken wake phrase only. It is NOT speaker verification:
 * voice identity must be added with a real speaker-embedding model before any
 * security-sensitive action is allowed to rely on the speaker's identity.
 */
class VedariWakeService : Service() {
    private var recognizer: SpeechRecognizer? = null
    private var restarting = false
    private var awaitingCommand = false
    private var textToSpeech: TextToSpeech? = null
    private var ttsReady = false
    private var pendingWakeAck = false
    private var onnxDetector: AmaraOnnxWakeDetector? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        textToSpeech = TextToSpeech(applicationContext) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) {
                // Prefer Burmese when the installed engine supports it. Otherwise select
                // the best-quality installed English voice instead of accepting an arbitrary default.
                val result = textToSpeech?.setLanguage(Locale.forLanguageTag("my-MM"))
                if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                    val englishResult = textToSpeech?.setLanguage(Locale.US)
                    if (englishResult == TextToSpeech.LANG_MISSING_DATA || englishResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                        ttsReady = false
                        recordDiagnostic("TTS voice မရရှိပါ", "Install/enable an English Text-to-Speech voice in Android settings.")
                    } else {
                        try {
                            val bestEnglishVoice = textToSpeech?.voices
                                ?.filter { it.locale.language == "en" && !it.isNetworkConnectionRequired }
                                ?.maxByOrNull { it.quality }
                            if (bestEnglishVoice != null) textToSpeech?.voice = bestEnglishVoice
                        } catch (_: Exception) { /* Keep the engine's supported English default. */ }
                    }
                }
                // Slightly slower, neutral-pitch delivery sounds less clipped on common Android TTS engines.
                textToSpeech?.setSpeechRate(0.90f)
                textToSpeech?.setPitch(1.0f)
                if (ttsReady && pendingWakeAck) {
                    pendingWakeAck = false
                    acknowledgeWake()
                }
            } else {
                recordDiagnostic("TTS engine မစတင်နိုင်ပါ", "Android Text-to-Speech engine ကို စစ်ဆေးပါ။")
            }
        }
        // Android 10+ supports an explicit foreground-service type. On Android 14
        // this must match the manifest's microphone type and granted RECORD_AUDIO.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                buildNotification(),
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            )
        } else {
            startForeground(NOTIFICATION_ID, buildNotification())
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopRecognition()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                startRecognition()
                return START_STICKY
            }
        }
    }

    private fun startRecognition() {
        if (onnxDetector != null) return
        onnxDetector = AmaraOnnxWakeDetector(
            context = applicationContext,
            onDetected = { confidence ->
                onnxDetector = null
                awaitingCommand = true
                recordDiagnostic("ONNX Wake word တွေ့ပြီ — တုံ့ပြန်နေသည်", "confidence=%.3f".format(confidence))
                showFloatingOverlay("အမရာ နားထောင်နေပါတယ်", "အမိန့်ကို ပြောပါနော်။")
                // Wake acknowledgement must not steal the user's current screen.
                // Keep the current app visible and listen for the actual command.
                wakeScreenBriefly()
                acknowledgeWake()
                android.os.Handler(mainLooper).postDelayed({ startCommandRecognition() }, 900L)
            },
            onStatus = { status, detail ->
                recordDiagnostic(status, detail)
                if (status.contains("error", ignoreCase = true)) {
                    onnxDetector = null
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(ENABLED, false).apply()
                    android.os.Handler(mainLooper).post {
                        stopForeground(STOP_FOREGROUND_REMOVE)
                        stopSelf()
                    }
                }
            }
        ).also { it.start() }
    }

    private fun startCommandRecognition() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(ENABLED, false).apply()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return
        }
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(applicationContext).also { speech ->
                speech.setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: android.os.Bundle?) {
                        restarting = false
                        recordDiagnostic("နားထောင်နေသည်", "")
                    }
                    override fun onBeginningOfSpeech() {
                        recordDiagnostic("အသံရရှိနေသည်", "")
                    }
                    override fun onRmsChanged(rmsdB: Float) = Unit
                    override fun onBufferReceived(buffer: ByteArray?) = Unit
                    override fun onEndOfSpeech() {
                        recordDiagnostic("အသံပြီးဆုံးသည်", "")
                    }
                    override fun onError(error: Int) {
                        recordDiagnostic("SpeechRecognizer error", recognitionErrorName(error))
                        scheduleRestart()
                    }
                    override fun onResults(results: android.os.Bundle?) {
                        val candidates = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
                            .map { it.trim() }.filter { it.isNotBlank() }
                        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
                        prefs.edit()
                            .putString(LAST_HEARD, candidates.joinToString(" / ").take(240))
                            .putLong(LAST_EVENT_AT, System.currentTimeMillis())
                            .apply()
                        // The ONNX model detects the wake phrase. SpeechRecognizer is now
                        // command-only, so it cannot accidentally replace ONNX detection.
                        // Try all ASR alternatives. The first Burmese transcript can be
                        // phonetically wrong even when a later candidate contains the app name.
                        val command = candidates.firstOrNull().orEmpty()
                        awaitingCommand = false
                        if (command.isNotBlank()) {
                            savePendingCommand(command)
                            recordDiagnostic("အမိန့်ရရှိပြီး", candidates.joinToString(" / ").take(240))
                            showFloatingOverlay("အမိန့်ရရှိပြီး", command)
                            // Device-level commands must execute in the currently visible app;
                            // they must not be routed back into AMARA's chat screen.
                            if (candidates.any { isBackCommand(it) }) {
                                val service = MyAccessibilityService.instance()
                                if (service?.back() == true) {
                                    recordDiagnostic("Back Action အောင်မြင်သည်", candidates.joinToString(" / ").take(180))
                                } else {
                                    recordDiagnostic("Back Action မအောင်မြင်ပါ", "Accessibility Service ချိတ်ဆက်မှုကို စစ်ဆေးပါ။")
                                }
                            } else {
                                val targetApp = candidates.firstNotNullOfOrNull { requestedAppName(it) }
                                if (targetApp != null) {
                                    launchRequestedApp(targetApp)
                                } else if (MyAccessibilityService.instance()?.activeWindowPackageName() == packageName) {
                                    openAppWithCommand(command)
                                } else {
                                    recordDiagnostic("အမိန့်ကို ကြားပြီးပါပြီ", "လက်ရှိ app မပြောင်းဘဲ command ကို သိမ်းထားသည်: $command")
                                }
                            }
                        } else {
                            recordDiagnostic("အမိန့်မကြားရ", "နောက်တစ်ကြိမ် ပြောပါ")
                        }
                        scheduleRestart()
                    }
                    override fun onPartialResults(partialResults: android.os.Bundle?) = Unit
                    override fun onEvent(eventType: Int, params: android.os.Bundle?) = Unit
                })
            }
        }
        try {
            val request = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "my-MM")
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "my-MM")
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
            }
            recognizer?.startListening(request)
        } catch (_: Exception) {
            scheduleRestart()
        }
    }

    private fun acknowledgeWake() {
        try {
            if (!ttsReady || textToSpeech == null) {
                // TTS initializes asynchronously; queue the acknowledgement rather than losing it.
                pendingWakeAck = true
                recordDiagnostic("Wake word တွေ့ပြီ — အသံစနစ် အဆင်သင့်ဖြစ်ရန် စောင့်နေသည်", "TTS initialization pending")
                return
            }
            val language = textToSpeech?.voice?.locale
            val usingEnglishFallback = language?.language != "my"
            val phrase = if (usingEnglishFallback) {
                "Yes, Amara is here. Please speak."
            } else {
                "ဟုတ်ကဲ့၊ အမရာ ဒီမှာရှိပါတယ်။ ပြောပါနော်။"
            }
            val utteranceId = "amara-wake-ack-" + System.currentTimeMillis()
            val result = textToSpeech?.speak(phrase, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
            if (result == TextToSpeech.ERROR) {
                recordDiagnostic("Wake word တွေ့ပြီ — TTS အသံထွက်မအောင်မြင်", "Check Android Text-to-Speech engine and installed voice data.")
            } else {
                getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                    .putString(LAST_STATUS, "Wake word ကို သိရှိပြီး အသံဖြင့် တုံ့ပြန်နေသည်")
                    .putString(LAST_DETAIL, phrase)
                    .putLong(LAST_EVENT_AT, System.currentTimeMillis())
                    .apply()
            }
        } catch (error: Exception) {
            recordDiagnostic("Wake word တွေ့ပြီ — အသံဖြင့်တုံ့ပြန်မရ", error.message ?: "TextToSpeech error")
        }
    }

    private fun recordDiagnostic(status: String, detail: String) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString(LAST_STATUS, status)
            .putString(LAST_DETAIL, detail.take(240))
            .putLong(LAST_EVENT_AT, System.currentTimeMillis())
            .apply()
    }

    private fun recognitionErrorName(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_AUDIO -> "AUDIO"
        SpeechRecognizer.ERROR_CLIENT -> "CLIENT"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "PERMISSION"
        SpeechRecognizer.ERROR_NETWORK -> "NETWORK"
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "NETWORK_TIMEOUT"
        SpeechRecognizer.ERROR_NO_MATCH -> "NO_MATCH"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "BUSY"
        SpeechRecognizer.ERROR_SERVER -> "SERVER"
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "SPEECH_TIMEOUT"
        else -> "ERROR_$error"
    }

    private fun savePendingCommand(command: String) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString(PENDING_COMMAND, command)
            .putLong(PENDING_AT, System.currentTimeMillis())
            .apply()
    }

    private fun isWakeCommand(value: String): Boolean {
        val normalized = value.lowercase(Locale.ROOT)
            .replace(Regex("[\\s\\u200B\\uFEFF၊,။.!?]+"), "")
        return listOf("အမရာရေ", "အမရာ", "အမရာလေး", "amara", "amarahey", "ဗေဒါရီရေ", "ဗေဒါရီ", "ဗေဒါရီလေး")
            .any { normalized.contains(it.lowercase(Locale.ROOT).replace(Regex("[\\s\\u200B\\uFEFF၊,။.!?]+"), "")) }
    }

    private fun removeWakePhrase(value: String): String {
        return Regex("(?:အမရာ\\s*(?:ရေ|လေး)?|amara\\s*(?:hey)?|ဗေဒါရီ\\s*(?:ရေ|လေး)?)[\\s၊,။.!?]*", RegexOption.IGNORE_CASE)
            .replace(value, "").trim()
    }

    private fun scheduleRestart() {
        if (restarting) return
        restarting = true
        android.os.Handler(mainLooper).postDelayed({
            restarting = false
            if (getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(ENABLED, false)) {
                if (awaitingCommand) startCommandRecognition() else startRecognition()
            } else stopSelf()
        }, RESTART_DELAY_MS)
    }

    private fun isBackCommand(command: String): Boolean {
        val normalized = command.lowercase(Locale.ROOT)
            .replace(Regex("[\\s\\u200B\\uFEFF၊,။.!?]+"), "")
        val phrases = listOf(
            "back", "go back", "နောက်ပြန်", "နောက်ကိုပြန်", "ပြန်သွား",
            "အရင်စာမျက်နှာ", "အရင်နေရာ", "နောက်တစ်ဆင့်ပြန်", "ပြန်ထွက်",
            "နောက်သို့ပြန်", "ပြန်သွားပေး"
        )
        return phrases.any { phrase ->
            normalized.contains(phrase.lowercase(Locale.ROOT).replace(Regex("[\\s\\u200B\\uFEFF၊,။.!?]+"), ""))
        }
    }

    private fun requestedAppName(command: String): String? {
        val normalized = command.lowercase(Locale.ROOT)
            .replace(Regex("[\\u200B\\uFEFF၊,။.!?]+"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()

        // Require an explicit launch verb. This prevents ordinary conversation
        // mentioning an app from unexpectedly switching the foreground screen.
        val openingVerbs = listOf(
            "ဖွင့်", "ဖွင္", "ဖွင့်", "ဖွင့်ပေး", "ဖွင့်လိုက်", "ဖွင့်ပါ",
            "ဖွင့်ပေးပါ", "ဖွင့်ပေးနော်", "ဖွင့်ပေး", "ဖွင့်ပေးပါ",
            "open", "launch", "start"
        )
        if (openingVerbs.none { normalized.contains(it) }) return null

        // First preserve common spoken aliases, then resolve any other installed
        // launcher app from Android's actual app list (not a hard-coded allowlist).
        val known = when {
            normalized.contains("youtube") || normalized.contains("ယူကျု") || normalized.contains("ယူကျူး") || normalized.contains("ယူကျူ") -> "YouTube"
            normalized.contains("tiktok") || normalized.contains("tik tok") || normalized.contains("သစ်တော့") || normalized.contains("တစ်တော့") || normalized.contains("တစ်တောက်") -> "TikTok"
            normalized.contains("facebook") || normalized.contains("ဖေ့စ်ဘွတ်") -> "Facebook"
            normalized.contains("messenger") || normalized.contains("မက်ဆင်ဂျာ") -> "Messenger"
            normalized.contains("chrome") || normalized.contains("ဘရောက်ဇာ") -> "Chrome"
            normalized.contains("maps") || normalized.contains("map") || normalized.contains("မြေပုံ") -> "Maps"
            normalized.contains("settings") || normalized.contains("ဆက်တင်") -> "Settings"
            normalized.contains("camera") || normalized.contains("ကင်မရာ") -> "Camera"
            normalized.contains("phone") || normalized.contains("ဖုန်းခေါ်") -> "Phone"
            else -> null
        }
        if (known != null) return known

        val target = normalized
            .replace(Regex("^(?:အမရာ(?:ရေ|လေး)?|amara)[၊,\\s]*"), "")
            .replace(Regex("^(?:ကျေးဇူးပြု၍|ကျေးဇူးပြုပြီး|please|ငါ့ကို|ကျွန်တော့်ကို|ကျွန်မကို)[\\s]*"), "")
            .replace(Regex("(?:ဖွင့်ပေးပါ|ဖွင့်ပေးနော်|ဖွင့်ပေး|ဖွင့်လိုက်ပါ|ဖွင့်လိုက်|ဖွင့်ပါ|ဖွင့်|ဖွင့်ပေးပါ|ဖွင့်ပေး|ဖွင့်|open|launch|start)[\\s။.!?]*$"), "")
            .replace(Regex("^(?:app|အက်ပ်)\\s+"), "")
            .trim()
        if (target.isBlank()) return null

        return try {
            val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val matches = packageManager.queryIntentActivities(launcherIntent, 0)
            val apps = matches.mapNotNull { resolve ->
                val label = packageManager.getApplicationLabel(resolve.activityInfo.applicationInfo).toString().trim()
                if (label.isBlank() || resolve.activityInfo.packageName == packageName) null else label
            }.distinct()

            fun compact(value: String) = value.lowercase(Locale.ROOT)
                .replace(Regex("[\\s\\p{Punct}_-]+"), "")
            val targetKey = compact(target)
            apps.firstOrNull { compact(it) == targetKey }
                ?: apps.firstOrNull {
                    val labelKey = compact(it)
                    labelKey.length >= 2 && (targetKey.contains(labelKey) || labelKey.contains(targetKey))
                }
        } catch (error: Exception) {
            recordDiagnostic("App စာရင်းဖတ်မရပါ", error.message ?: "PackageManager error")
            null
        }
    }

    private fun launchRequestedApp(appName: String) {
        try {
            val pm = packageManager
            val knownPackage = when (appName) {
                "YouTube" -> "com.google.android.youtube"
                "Facebook" -> "com.facebook.katana"
                "Messenger" -> "com.facebook.orca"
                "Chrome" -> "com.android.chrome"
                "Maps" -> "com.google.android.apps.maps"
                "TikTok" -> "com.zhiliaoapp.musically"
                else -> null
            }
            val knownIntent = knownPackage?.let { pm.getLaunchIntentForPackage(it) }
            if (knownIntent != null) {
                knownIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(knownIntent)
                recordDiagnostic("App ဖွင့်လိုက်ပါပြီ", appName)
                return
            }
            val intent = when (appName) {
                "Settings" -> Intent(android.provider.Settings.ACTION_SETTINGS)
                "Camera" -> Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE)
                else -> {
                    val matches = pm.queryIntentActivities(
                        Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0
                    )
                    val match = matches.firstOrNull {
                        val label = pm.getApplicationLabel(it.activityInfo.applicationInfo).toString()
                        label.equals(appName, ignoreCase = true) ||
                            label.contains(appName, ignoreCase = true)
                    }
                    match?.let { Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                        .setClassName(it.activityInfo.packageName, it.activityInfo.name) }
                }
            } ?: run {
                recordDiagnostic("App မတွေ့ပါ", "$appName ကို ဖုန်းထဲမှာ မတွေ့ပါ။")
                return
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
            recordDiagnostic("App ဖွင့်လိုက်ပါပြီ", appName)
        } catch (error: Exception) {
            recordDiagnostic("App ဖွင့်မရပါ", error.message ?: appName)
        }
    }

    private fun showFloatingOverlay(status: String, detail: String) {
        try {
            val overlay = Intent(this, FloatingWidgetService::class.java)
                .setAction(FloatingWidgetService.ACTION_SHOW)
                .putExtra(FloatingWidgetService.EXTRA_STATUS, status)
                .putExtra(FloatingWidgetService.EXTRA_DETAIL, detail)
            startService(overlay)
        } catch (error: Exception) {
            recordDiagnostic(status, "$detail (Overlay မဖွင့်နိုင်ပါ: ${error.message})")
        }
    }

    private fun openAppWithCommand(command: String) {
        val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return
        launch.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_CLEAR_TOP
        )
        launch.putExtra(EXTRA_WAKE_COMMAND, command)
        try {
            startActivity(launch)
        } catch (_: Exception) {
            // Android/OEM policy may block launching an Activity from the background.
            // The command remains saved and will be consumed when the user returns to Myk.
        }
    }

    private fun wakeScreenBriefly() {
        try {
            val manager = getSystemService(POWER_SERVICE) as PowerManager
            @Suppress("DEPRECATION")
            val lock = manager.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
                "MykGuardian:VedariWake"
            )
            lock.acquire(3_000L)
        } catch (_: Exception) { /* Wake screen is best effort and never bypasses device lock. */ }
    }

    private fun stopRecognition() {
        onnxDetector?.stop()
        onnxDetector = null
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(ENABLED, false).apply()
        try { recognizer?.cancel() } catch (_: Exception) {}
        try { recognizer?.destroy() } catch (_: Exception) {}
        recognizer = null
    }

    private fun buildNotification(): Notification {
        val stopIntent = Intent(this, VedariWakeService::class.java).setAction(ACTION_STOP)
        val pending = PendingIntent.getService(this, 2, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("AMARA AI Voice Assistant")
            .setContentText("“အမရာရေ” လို့ခေါ်ပါ။ ရပ်ရန် Stop ကိုနှိပ်ပါ။")
            .setOngoing(true)
            .addAction(0, "Stop", pending)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "AMARA AI Voice Assistant", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        onnxDetector?.stop()
        onnxDetector = null
        try { recognizer?.cancel() } catch (_: Exception) {}
        try { recognizer?.destroy() } catch (_: Exception) {}
        recognizer = null
        try { textToSpeech?.stop(); textToSpeech?.shutdown() } catch (_: Exception) {}
        textToSpeech = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_START = "com.myk.guardianai.VEDARI_START"
        const val ACTION_STOP = "com.myk.guardianai.VEDARI_STOP"
        const val EXTRA_WAKE_COMMAND = "com.myk.guardianai.WAKE_COMMAND"
        const val PREFS = "vedari_wake_preferences"
        const val ENABLED = "wake_enabled"
        const val PENDING_COMMAND = "pending_wake_command"
        const val WAKE_ONLY_SENTINEL = "__VEDARI_WAKE_ONLY__"
        const val PENDING_AT = "pending_wake_at"
        const val LAST_STATUS = "last_wake_status"
        const val LAST_DETAIL = "last_wake_detail"
        const val LAST_HEARD = "last_wake_heard"
        const val LAST_EVENT_AT = "last_wake_event_at"
        const val CHANNEL_ID = "vedari_wake_channel"
        const val NOTIFICATION_ID = 8402
        const val RESTART_DELAY_MS = 900L
    }
}
