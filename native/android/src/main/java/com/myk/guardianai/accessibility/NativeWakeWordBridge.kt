package com.myk.guardianai.accessibility

/** JNI bridge to LiveKit's on-device mel -> embedding -> ONNX classifier pipeline. */
class NativeWakeWordBridge {
    external fun nativeCreate(modelPath: String, sampleRate: Int): Long
    external fun nativePredict(handle: Long, audio: ShortArray): Float
    external fun nativeDestroy(handle: Long)

    companion object {
        init {
            System.loadLibrary("amara_wakeword_jni")
        }
    }
}
