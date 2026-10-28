package com.myk.guardianai.accessibility

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.io.File
import java.nio.FloatBuffer
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max

/**
 * LiveKit WakeWord classifier runner.
 *
 * Training-compatible preprocessing:
 * 16 kHz mono PCM16 -> float32 / 32768 -> mel ONNX (output / 10 + 2)
 * -> 76-frame mel windows at stride 8 -> 96-D speech embeddings
 * -> last 16 embeddings -> Amara classifier score.
 */
internal class AmaraOnnxWakeDetector(
    private val context: Context,
    private val onDetected: (Float) -> Unit,
    private val onStatus: (String, String) -> Unit
) {
    companion object {
        private const val TAG = "AmaraWakeONNX"
        private const val SAMPLE_RATE = 16000
        private const val WINDOW_SAMPLES = 32000
        private const val STEP_SAMPLES = 1280
        private const val MEL_BANDS = 32
        private const val MEL_WINDOW = 76
        private const val MEL_STRIDE = 8
        private const val EMBEDDING_SIZE = 96
        private const val THRESHOLD = 0.50f
        private const val DEBOUNCE_MS = 2200L
    }

    private val running = AtomicBoolean(false)
    @Volatile private var worker: Thread? = null
    @Volatile private var lastDetectionAt = 0L
    private var env: OrtEnvironment? = null
    private var melSession: OrtSession? = null
    private var embeddingSession: OrtSession? = null
    private var classifierSession: OrtSession? = null

    fun start() {
        if (!running.compareAndSet(false, true)) return
        worker = Thread({ runLoop() }, "amara-onnx-wake").apply { isDaemon = true; start() }
    }

    fun stop() {
        running.set(false)
        worker?.interrupt()
        worker = null
        closeSessions()
    }

    private fun runLoop() {
        var recorder: AudioRecord? = null
        try {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                throw SecurityException("RECORD_AUDIO permission is not granted")
            }
            onStatus("ONNX model စတင်ဖွင့်နေသည်", "Audio preprocessing + classifier ကို စစ်ဆေးနေသည်")
            loadSessions()
            val minBuffer = AudioRecord.getMinBufferSize(
                SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
            )
            if (minBuffer <= 0) throw IllegalStateException("AudioRecord buffer size မရပါ: $minBuffer")
            recorder = AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                max(minBuffer, WINDOW_SAMPLES * 2)
            )
            if (recorder.state != AudioRecord.STATE_INITIALIZED) throw IllegalStateException("16 kHz AudioRecord ကို စတင်မရပါ")
            recorder.startRecording()
            onStatus("ONNX Wake Word နားထောင်နေသည်", "16 kHz mono PCM · threshold=$THRESHOLD")
            val ring = ShortArray(WINDOW_SAMPLES)
            val incoming = ShortArray(STEP_SAMPLES)
            var filled = 0
            while (running.get()) {
                var count = 0
                while (count < incoming.size && running.get()) {
                    val read = recorder.read(incoming, count, incoming.size - count, AudioRecord.READ_BLOCKING)
                    if (read < 0) throw IllegalStateException("AudioRecord read error: $read")
                    if (read == 0) continue
                    count += read
                }
                if (!running.get() || count == 0) break
                if (filled < WINDOW_SAMPLES) {
                    val copyCount = minOf(count, WINDOW_SAMPLES - filled)
                    System.arraycopy(incoming, 0, ring, filled, copyCount)
                    filled += copyCount
                    if (copyCount < count) {
                        val remainder = count - copyCount
                        System.arraycopy(ring, remainder, ring, 0, WINDOW_SAMPLES - remainder)
                        System.arraycopy(incoming, copyCount, ring, WINDOW_SAMPLES - remainder, remainder)
                    }
                } else {
                    System.arraycopy(ring, count, ring, 0, WINDOW_SAMPLES - count)
                    System.arraycopy(incoming, 0, ring, WINDOW_SAMPLES - count, count)
                }
                if (filled == WINDOW_SAMPLES) {
                    val score = score(ring)
                    if (score >= THRESHOLD && System.currentTimeMillis() - lastDetectionAt >= DEBOUNCE_MS) {
                        lastDetectionAt = System.currentTimeMillis()
                        onStatus("ONNX Wake word တွေ့ပြီ", "confidence=%.3f".format(score))
                        running.set(false)
                        Handler(Looper.getMainLooper()).post { onDetected(score) }
                    }
                }
            }
        } catch (error: Exception) {
            if (running.get()) {
                Log.e(TAG, "Wake detector failed", error)
                onStatus("ONNX Wake Word error", error.message ?: error.javaClass.simpleName)
            }
        } finally {
            try { recorder?.stop() } catch (_: Exception) {}
            try { recorder?.release() } catch (_: Exception) {}
            closeSessions()
            running.set(false)
        }
    }

    private fun loadSessions() {
        val assets = context.assets
        val directory = File(context.codeCacheDir, "amara-wakeword").apply { mkdirs() }
        fun asset(name: String): String {
            val destination = File(directory, name)
            if (!destination.exists() || destination.length() == 0L) {
                assets.open("wakeword/$name").use { input -> destination.outputStream().use(input::copyTo) }
            }
            return destination.absolutePath
        }
        val environment = OrtEnvironment.getEnvironment()
        val options = OrtSession.SessionOptions().apply {
            setIntraOpNumThreads(2)
            setInterOpNumThreads(1)
            setOptimizationLevel(OrtSession.SessionOptions.OptLevel.BASIC_OPT)
        }
        env = environment
        melSession = environment.createSession(asset("melspectrogram.onnx"), options)
        embeddingSession = environment.createSession(asset("embedding_model.onnx"), options)
        classifierSession = environment.createSession(asset("amara_ye_burmese.onnx"), options)
        options.close()
    }

    private fun score(pcm: ShortArray): Float {
        val environment = env ?: error("ONNX environment မရှိပါ")
        val mel = melSession ?: error("Mel model မရှိပါ")
        val embed = embeddingSession ?: error("Embedding model မရှိပါ")
        val classifier = classifierSession ?: error("Classifier model မရှိပါ")
        val audio = FloatArray(pcm.size) { pcm[it].toFloat() / 32768.0f }
        val melInputName = mel.inputNames.first()
        val melTensor = OnnxTensor.createTensor(environment, FloatBuffer.wrap(audio), longArrayOf(1, audio.size.toLong()))
        val melResult = mel.run(mapOf(melInputName to melTensor))
        val melOutput = melResult[0].value
        melResult.close()
        melTensor.close()
        val melValues = flattenFloatArray(melOutput)
        if (melValues.size < MEL_WINDOW * MEL_BANDS) return 0f
        val frameCount = melValues.size / MEL_BANDS
        val windows = max(0, (frameCount - MEL_WINDOW) / MEL_STRIDE + 1)
        if (windows < 16) return 0f
        val embeddings = ArrayList<FloatArray>(windows)
        val embedInputName = embed.inputNames.first()
        for (w in 0 until windows) {
            val input = FloatArray(MEL_WINDOW * MEL_BANDS)
            val offset = w * MEL_STRIDE * MEL_BANDS
            for (i in input.indices) input[i] = melValues[offset + i] / 10.0f + 2.0f
            val tensor = OnnxTensor.createTensor(
                environment, FloatBuffer.wrap(input),
                longArrayOf(1, MEL_WINDOW.toLong(), MEL_BANDS.toLong(), 1)
            )
            val result = embed.run(mapOf(embedInputName to tensor))
            val vector = flattenFloatArray(result[0].value)
            result.close()
            tensor.close()
            if (vector.size < EMBEDDING_SIZE) return 0f
            embeddings.add(vector.copyOfRange(0, EMBEDDING_SIZE))
        }
        val last = embeddings.takeLast(16)
        val flat = FloatArray(16 * EMBEDDING_SIZE)
        for (t in last.indices) System.arraycopy(last[t], 0, flat, t * EMBEDDING_SIZE, EMBEDDING_SIZE)
        val inputName = classifier.inputNames.first()
        val inputTensor = OnnxTensor.createTensor(
            environment, FloatBuffer.wrap(flat), longArrayOf(1, 16, EMBEDDING_SIZE.toLong())
        )
        val result = classifier.run(mapOf(inputName to inputTensor))
        val output = flattenFloatArray(result[0].value)
        result.close()
        inputTensor.close()
        return output.firstOrNull()?.coerceIn(0f, 1f) ?: 0f
    }

    private fun flattenFloatArray(value: Any): FloatArray {
        val values = ArrayList<Float>()
        fun visit(item: Any?) {
            when (item) {
                is FloatArray -> item.forEach(values::add)
                is Array<*> -> item.forEach(::visit)
                is Number -> values.add(item.toFloat())
            }
        }
        visit(value)
        // Mel ONNX emits dB; apply LiveKit's matching normalization after removing batch/channel axes.
        return values.toFloatArray()
    }

    private fun closeSessions() {
        try { classifierSession?.close() } catch (_: Exception) {}
        try { embeddingSession?.close() } catch (_: Exception) {}
        try { melSession?.close() } catch (_: Exception) {}
        classifierSession = null
        embeddingSession = null
        melSession = null
        env = null
    }
}
