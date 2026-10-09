package dev.podtalk.audio

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import kotlin.math.sqrt

/** Captures the listener's spoken question: 16 kHz mono float PCM, stops on ~1.2 s of trailing silence. */
class Recorder {
    @Volatile var stopRequested = false

    @SuppressLint("MissingPermission")
    suspend fun record(maxSeconds: Int = 20, onLevel: (Float) -> Unit = {}): FloatArray = withContext(Dispatchers.IO) {
        stopRequested = false
        val rate = 16_000
        val minBuf = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT)
        val rec = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT, maxOf(minBuf, rate))
        check(rec.state == AudioRecord.STATE_INITIALIZED) { "mic unavailable" }
        val out = ArrayList<Float>(rate * 10)
        val buf = FloatArray(rate / 10) // 100 ms
        var silentMs = 0
        var heardSpeech = false
        rec.startRecording()
        try {
            while (isActive && !stopRequested && out.size < rate * maxSeconds) {
                val n = rec.read(buf, 0, buf.size, AudioRecord.READ_BLOCKING)
                if (n <= 0) continue
                var acc = 0f; for (i in 0 until n) acc += buf[i] * buf[i]
                val rms = sqrt(acc / n)
                onLevel(rms)
                for (i in 0 until n) out.add(buf[i])
                if (rms > 0.015f) { heardSpeech = true; silentMs = 0 } else silentMs += 100
                if (heardSpeech && silentMs >= 1200) break
                if (!heardSpeech && out.size > rate * 6) break // nothing said
            }
        } finally {
            rec.stop(); rec.release()
        }
        FloatArray(out.size) { out[it] }
    }
}
