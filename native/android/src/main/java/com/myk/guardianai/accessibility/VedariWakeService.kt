package com.myk.guardianai.accessibility

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.app.NotificationCompat
import java.io.File
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

/**
 * On-device Amara wake-word listener. A LiveKit wake-word pipeline (mel spectrogram,
 * speech embeddings and the trained ONNX classifier) runs on raw microphone PCM.
 * Android SpeechRecognizer is used only AFTER the local model detects the wake word,
 * to transcribe the user's follow-up command.
 */
class VedariWakeService : Service() {
    private val running = AtomicBoolean(false)
    private var audioThread: Thread? = null
    private var recorder: AudioRecord? = null
    private var detector: NativeWakeWordBridge? = null
    private var detectorHandle: Long = 0L
    private var commandRecognizer: SpeechRecognizer? = null
    private var awaitingCommand = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, buildNotification(),
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
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
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(ENABLED, true).apply()
                startOnDeviceDetection()
                return START_STICKY
            }
        }
    }

    private fun startOnDeviceDetection() {
        if (running.get()) return
        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            failAndStop("မိုက်ခွင့်ပြုချက် မရရှိပါ။")
            return
        }
        try {
            val modelFile = copyClassifierFromAssets()
            val bridge = NativeWakeWordBridge()
            val handle = bridge.nativeCreate(modelFile.absolutePath, SAMPLE_RATE)
            if (handle == 0L) throw IllegalStateException("ONNX wake model load failed")
            detector = bridge
            detectorHandle = handle
            val minimum = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_IN, AUDIO_FORMAT)
            if (minimum <= 0) throw IllegalStateException("AudioRecord buffer configuration unsupported")
            val audioRecord = AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE,
                CHANNEL_IN, AUDIO_FORMAT, maxOf(minimum, WINDOW_SAMPLES * 2))
            if (audioRecord.state != AudioRecord.STATE_INITIALIZED) {
                audioRecord.release()
                throw IllegalStateException("Microphone initialization failed")
            }
            recorder = audioRecord
            running.set(true)
            audioRecord.startRecording()
            audioThread = Thread({ listenLoop(audioRecord, bridge, handle) }, "AmaraWakeWord")
                .apply { isDaemon = true; start() }
        } catch (error: Exception) {
            failAndStop("Wake model မစတင်နိုင်ပါ: ${error.message ?: "unknown error"}")
        }
    }

    private fun copyClassifierFromAssets(): File {
        val target = File(filesDir, "amara_ye_burmese.onnx")
        if (!target.isFile || target.length() == 0L) {
            assets.open("amara_ye_burmese.onnx").use { input ->
                target.outputStream().use { output -> input.copyTo(output) }
            }
        }
        if (target.length() == 0L) throw IllegalStateException("ONNX classifier asset is empty")
        return target
    }

    private fun listenLoop(audioRecord: AudioRecord, bridge: NativeWakeWordBridge, handle: Long) {
        val hop = ShortArray(HOP_SAMPLES)
        var window = ShortArray(WINDOW_SAMPLES)
        var filled = 0
        while (running.get()) {
            val count = try { audioRecord.read(hop, 0, hop.size, AudioRecord.READ_BLOCKING) }
                catch (_: Exception) { -1 }
            if (count <= 0) {
                if (running.get()) android.os.Handler(mainLooper).post { failAndStop("မိုက်မှ အသံမဖတ်နိုင်ပါ။") }
                break
            }
            if (count < hop.size) continue
            if (filled < WINDOW_SAMPLES) {
                val take = minOf(count, WINDOW_SAMPLES - filled)
                System.arraycopy(hop, 0, window, filled, take)
                filled += take
                if (take < count) {
                    val rest = count - take
                    System.arraycopy(hop, take, window, 0, rest)
                    filled = rest
                }
            } else {
                System.arraycopy(window, HOP_SAMPLES, window, 0, WINDOW_SAMPLES - HOP_SAMPLES)
                System.arraycopy(hop, 0, window, WINDOW_SAMPLES - HOP_SAMPLES, HOP_SAMPLES)
            }
            if (filled >= WINDOW_SAMPLES) {
                val score = try { bridge.nativePredict(handle, window) } catch (_: Exception) { 0f }
                if (score >= WAKE_THRESHOLD && running.get()) {
                    android.os.Handler(mainLooper).post { onWakeDetected(score) }
                    break
                }
            }
        }
    }

    private fun onWakeDetected(score: Float) {
        if (!running.get()) return
        stopAudioCaptureOnly()
        awaitingCommand = true
        savePendingCommand(WAKE_ONLY_SENTINEL)
        wakeScreenBriefly()
        openAppWithCommand(WAKE_ONLY_SENTINEL)
        startCommandRecognition()
    }

    private fun startCommandRecognition() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            awaitingCommand = false
            startOnDeviceDetection()
            return
        }
        try {
            commandRecognizer?.destroy()
            commandRecognizer = SpeechRecognizer.createSpeechRecognizer(applicationContext).also { speech ->
                speech.setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: android.os.Bundle?) = Unit
                    override fun onBeginningOfSpeech() = Unit
                    override fun onRmsChanged(rmsdB: Float) = Unit
                    override fun onBufferReceived(buffer: ByteArray?) = Unit
                    override fun onEndOfSpeech() = Unit
                    override fun onError(error: Int) {
                        awaitingCommand = false
                        destroyCommandRecognizer()
                        android.os.Handler(mainLooper).postDelayed({ if (isEnabled()) startOnDeviceDetection() }, 700L)
                    }
                    override fun onResults(results: android.os.Bundle?) {
                        val candidates = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
                        val heard = candidates.firstOrNull().orEmpty().trim()
                        if (heard.isNotBlank()) {
                            savePendingCommand(heard)
                            openAppWithCommand(heard)
                        }
                        awaitingCommand = false
                        destroyCommandRecognizer()
                        android.os.Handler(mainLooper).postDelayed({ if (isEnabled()) startOnDeviceDetection() }, 700L)
                    }
                    override fun onPartialResults(partialResults: android.os.Bundle?) = Unit
                    override fun onEvent(eventType: Int, params: android.os.Bundle?) = Unit
                })
            }
            val request = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "my-MM")
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "my-MM")
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
            }
            commandRecognizer?.startListening(request)
        } catch (_: Exception) {
            awaitingCommand = false
            destroyCommandRecognizer()
            android.os.Handler(mainLooper).postDelayed({ if (isEnabled()) startOnDeviceDetection() }, 700L)
        }
    }

    private fun destroyCommandRecognizer() {
        try { commandRecognizer?.cancel() } catch (_: Exception) {}
        try { commandRecognizer?.destroy() } catch (_: Exception) {}
        commandRecognizer = null
    }

    private fun stopAudioCaptureOnly() {
        running.set(false)
        try { recorder?.stop() } catch (_: Exception) {}
        try { recorder?.release() } catch (_: Exception) {}
        recorder = null
        audioThread = null
        val bridge = detector
        val handle = detectorHandle
        detector = null
        detectorHandle = 0L
        if (bridge != null && handle != 0L) {
            try { bridge.nativeDestroy(handle) } catch (_: Exception) {}
        }
    }

    private fun isEnabled(): Boolean =
        getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(ENABLED, false)

    private fun failAndStop(message: String) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(ENABLED, false).apply()
        stopAudioCaptureOnly()
        destroyCommandRecognizer()
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("အမရာ Voice Assistant")
            .setContentText(message.take(100))
            .setOngoing(false).build())
        android.os.Handler(mainLooper).postDelayed({
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }, 1_500L)
    }

    private fun savePendingCommand(command: String) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString(PENDING_COMMAND, command)
            .putLong(PENDING_AT, System.currentTimeMillis())
            .apply()
    }

    private fun openAppWithCommand(command: String) {
        val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        launch.putExtra(EXTRA_WAKE_COMMAND, command)
        try { startActivity(launch) } catch (_: Exception) {
            // The command remains in preferences and is consumed when the app returns.
        }
    }

    private fun wakeScreenBriefly() {
        try {
            val manager = getSystemService(POWER_SERVICE) as PowerManager
            @Suppress("DEPRECATION")
            val lock = manager.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
                "AmaraAI:WakeWord")
            lock.acquire(3_000L)
        } catch (_: Exception) {}
    }

    private fun stopRecognition() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(ENABLED, false).apply()
        stopAudioCaptureOnly()
        destroyCommandRecognizer()
    }

    private fun buildNotification(): Notification {
        val stopIntent = Intent(this, VedariWakeService::class.java).setAction(ACTION_STOP)
        val pending = PendingIntent.getService(this, 2, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("အမရာ Voice Assistant")
            .setContentText("စက်အတွင်း Wake Word model ဖြင့် နားထောင်နေသည်။ ရပ်ရန် Stop ကိုနှိပ်ပါ။")
            .setOngoing(true)
            .addAction(0, "Stop", pending)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "အမရာ Voice Assistant", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        stopAudioCaptureOnly()
        destroyCommandRecognizer()
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
        const val WAKE_ONLY_SENTINEL = "__AMARA_WAKE_ONLY__"
        const val PENDING_AT = "pending_wake_at"
        const val CHANNEL_ID = "vedari_wake_channel"
        const val NOTIFICATION_ID = 8402
        const val SAMPLE_RATE = 16000
        const val WINDOW_SAMPLES = 32000
        const val HOP_SAMPLES = 16000
        const val CHANNEL_IN = AudioFormat.CHANNEL_IN_MONO
        const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT
        const val WAKE_THRESHOLD = 0.5f
    }
}
