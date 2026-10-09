package dev.podtalk.audio

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import kotlin.math.sqrt

/**
 * Captures the listener's spoken question: 16 kHz mono float PCM, stops on ~1.2 s of trailing
 * silence. Returns an empty array when nothing above the speech gate was heard, so the caller
 * does not hand room noise to whisper (which hallucinates text from it).
 */
class Recorder {
    @Volatile var stopRequested = false

    @SuppressLint("MissingPermission")
    suspend fun record(maxSeconds: Int = 20, onLevel: (Float) -> Unit = {}): FloatArray = withContext(Dispatchers.IO) {
        stopRequested = false
        val rate = 16_000
        val minBuf = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT)
        val rec = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT, maxOf(minBuf, rate))
        val out = ArrayList<Float>(rate * 10)
        val buf = FloatArray(rate / 10) // 100 ms
        var silentMs = 0
        var heardSpeech = false
        try {
            // Inside the try so the native AudioRecord is released even when init or start fails (e.g. permission denied).
            check(rec.state == AudioRecord.STATE_INITIALIZED) { "Microphone unavailable (is the permission granted?)" }
            rec.startRecording()
            while (isActive && !stopRequested && out.size < rate * maxSeconds) {
                val n = rec.read(buf, 0, buf.size, AudioRecord.READ_BLOCKING)
                if (n <= 0) continue
                var acc = 0f; for (i in 0 until n) acc += buf[i] * buf[i]
                val rms = sqrt(acc / n)
                onLevel(rms)
                for (i in 0 until n) out.add(buf[i])
                if (rms > 0.015f) { heardSpeech = true; silentMs = 0 } else silentMs += n * 1000 / rate
                if (heardSpeech && silentMs >= 1200) break
                if (!heardSpeech && out.size > rate * 6) break // nothing said
            }
        } finally {
            if (rec.recordingState == AudioRecord.RECORDSTATE_RECORDING) runCatching { rec.stop() }
            rec.release()
        }
        if (!heardSpeech) FloatArray(0) else FloatArray(out.size) { out[it] }
    }
}
