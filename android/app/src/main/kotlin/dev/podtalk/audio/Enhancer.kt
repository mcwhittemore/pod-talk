package dev.podtalk.audio

import android.content.Context
import android.util.Log
import ai.desertant.clear.Clear
import ai.desertant.clear.Mastering
import ai.desertant.clear.Options

/**
 * desert-ant Clear: on-device denoise/dereverb/loudness for the listener's
 * question before it goes to whisper. Falls back to the raw audio if the model
 * is unavailable (e.g. no network for the first download).
 */
class Enhancer(private val ctx: Context) {
    data class Result(val pcm: FloatArray, val enhanced: Boolean, val processingSec: Double)

    @Volatile var clear: Clear? = null

    suspend fun warmUp() { runCatching { (clear ?: Clear(ctx).also { clear = it }).download() }.onFailure { Log.w("Enhancer", "Clear download failed: $it") } }

    suspend fun enhance(pcm16k: FloatArray): Result {
        return try {
            val c = clear ?: Clear(ctx).also { clear = it }
            val r = c.enhance(pcm16k, 16_000.0, Options(sampleRate = 16_000.0, mastering = Mastering()))
            Result(r.samples, true, r.processingSec)
        } catch (t: Throwable) {
            Log.w("Enhancer", "Clear unavailable, using raw audio: $t")
            Result(pcm16k, false, 0.0)
        }
    }
}
