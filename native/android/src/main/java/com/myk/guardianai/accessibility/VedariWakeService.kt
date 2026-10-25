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

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        textToSpeech = TextToSpeech(applicationContext) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) {
                // Prefer Burmese, but deliberately fall back to English if Burmese voice data is missing.
                val result = textToSpeech?.setLanguage(Locale.forLanguageTag("my-MM"))
                if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                    val englishResult = textToSpeech?.setLanguage(Locale.US)
                    if (englishResult == TextToSpeech.LANG_MISSING_DATA || englishResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                        ttsReady = false
                        recordDiagnostic("TTS voice မရရှိပါ", "Install/enable an English Text-to-Speech voice in Android settings.")
                    }
                }
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
                        // Search all alternatives. Burmese ASR often puts the best wake phrase
                        // in candidate 2 or 3 rather than candidate 1.
                        val wakeCandidate = candidates.firstOrNull { isWakeCommand(it) }
                        if (awaitingCommand) {
                            val command = candidates.firstOrNull().orEmpty()
                            awaitingCommand = false
                            if (command.isNotBlank()) {
                                savePendingCommand(command)
                                recordDiagnostic("အမိန့်ရရှိပြီး", command)
                                wakeScreenBriefly()
                                openAppWithCommand(command)
                            } else {
                                recordDiagnostic("အမိန့်မကြားရ", "နောက်တစ်ကြိမ် ပြောပါ")
                            }
                        } else if (wakeCandidate != null) {
                            val command = removeWakePhrase(wakeCandidate)
                            wakeScreenBriefly()
                            if (command.isBlank()) {
                                // Wake phrase alone: acknowledge, then listen for the next utterance.
                                awaitingCommand = true
                                savePendingCommand(WAKE_ONLY_SENTINEL)
                                recordDiagnostic("Wake word တွေ့ပြီ — တုံ့ပြန်နေသည်", wakeCandidate)
                                acknowledgeWake()
                                openAppWithCommand(WAKE_ONLY_SENTINEL)
                            } else {
                                savePendingCommand(command)
                                recordDiagnostic("Wake word + အမိန့်တွေ့ပြီ", command)
                                openAppWithCommand(command)
                            }
                        } else {
                            recordDiagnostic("Wake word မတွေ့ပါ", candidates.firstOrNull().orEmpty())
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
            if (getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(ENABLED, false)) startRecognition()
            else stopSelf()
        }, RESTART_DELAY_MS)
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
