package dev.podtalk.audio

import dev.podtalk.core.PodTalkCore
import dev.podtalk.data.LocalTranscript
import dev.podtalk.data.Store
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import java.io.File

/**
 * Whole-episode transcription with whisper.cpp (via the Rust core). Stands in
 * for desert-ant Voz, which has no Android build. Models are fetched from
 * Hugging Face on first use, like the desert-ant SDKs do.
 */
class Transcriber(private val http: OkHttpClient, private val store: Store) {
    companion object {
        val MODELS = mapOf(
            "tiny.en" to "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
            "base.en" to "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
        )
    }

    fun modelReady(name: String) = store.modelFile(name).let { it.exists() && it.length() > 1_000_000 }

    suspend fun ensureModel(name: String, onProgress: (Float) -> Unit): File = withContext(Dispatchers.IO) {
        val f = store.modelFile(name)
        if (modelReady(name)) return@withContext f
        // Dev convenience: a model pushed to /sdcard/Download is picked up without a network fetch.
        val sideloaded = File("/sdcard/Download/ggml-$name.bin")
        if (sideloaded.canRead() && sideloaded.length() > 1_000_000) { sideloaded.copyTo(f, overwrite = true); return@withContext f }
        val url = MODELS[name] ?: error("unknown model $name")
        ResumableDownload.fetch(http, url, File(f.path + ".part"), f, onProgress = onProgress)
        if (!modelReady(name)) { f.delete(); error("model download incomplete") }
        f
    }

    suspend fun transcribe(modelName: String, audio: File, onProgress: (Float) -> Unit): LocalTranscript = withContext(Dispatchers.Default) {
        val model = store.modelFile(modelName)
        val threads = (Runtime.getRuntime().availableProcessors() - 2).coerceIn(1, 6)
        val t = PodTalkCore.transcribeFile(model.path, audio.path, threads) { done, total -> if (total > 0) onProgress(done.toFloat() / total) }
        LocalTranscript(t.engine, t.durationMs, t.segments, t.fillersRemoved.size, t.processingMs, synced = false)
    }
}
