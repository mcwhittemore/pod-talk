package dev.podtalk.audio

import android.content.Context
import android.util.Log
import ai.desertant.clear.Clear
import ai.desertant.clear.Mastering
import ai.desertant.clear.Options
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * desert-ant Clear: on-device denoise/dereverb/loudness for the listener's
 * question before it goes to whisper. Falls back to the raw audio if the model
 * is unavailable (e.g. no network for the first download).
 */
class Enhancer(private val ctx: Context) {
    data class Result(val pcm: FloatArray, val enhanced: Boolean, val processingSec: Double)

    @Volatile var clear: Clear? = null

    private fun resample(input: FloatArray, from: Double, to: Double): FloatArray {
        val ratio = from / to
        val n = (input.size / ratio).toInt()
        return FloatArray(n) { i ->
            val pos = i * ratio; val idx = pos.toInt().coerceAtMost(input.size - 1); val frac = (pos - idx).toFloat()
            val a = input[idx]; val b = input[(idx + 1).coerceAtMost(input.size - 1)]
            a + (b - a) * frac
        }
    }

    suspend fun warmUp() = withContext(Dispatchers.IO) { runCatching { (clear ?: Clear(ctx).also { clear = it }).download() }.onFailure { Log.w("Enhancer", "Clear download failed: $it") } }

    suspend fun enhance(pcm16k: FloatArray): Result = withContext(Dispatchers.Default) {
        try {
            val c = clear ?: Clear(ctx).also { clear = it }
            val r = c.enhance(pcm16k, 16_000.0, Options(sampleRate = 16_000.0, mastering = Mastering()))
            val out = if (r.sampleRate != 16_000.0) resample(r.samples, r.sampleRate, 16_000.0) else r.samples
            Log.i("Enhancer", "Clear: in=${pcm16k.size} out=${r.samples.size}@${r.sampleRate} -> ${out.size}@16k, ${r.processingSec}s")
            Result(out, true, r.processingSec)
        } catch (t: Throwable) {
            Log.w("Enhancer", "Clear unavailable, using raw audio: $t")
            Result(pcm16k, false, 0.0)
        }
    }
}
