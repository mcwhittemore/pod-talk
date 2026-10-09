package dev.podtalk.data

import android.content.Context
import dev.podtalk.core.PodTalkCore
import org.json.JSONObject
import java.io.File

/** On-device files: downloaded audio, transcripts, whisper models. */
class Store(ctx: Context) {
    val audioDir: File = File(ctx.filesDir, "audio").apply { mkdirs() }
    val transcriptDir: File = File(ctx.filesDir, "transcripts").apply { mkdirs() }
    val modelDir: File = File(ctx.filesDir, "models").apply { mkdirs() }

    fun audioFile(item: QueueItem): File = File(audioDir, "${item.id}.${audioExt(item.audioUrl)}")

    companion object {
        private val KNOWN_EXT = setOf("mp3", "m4a", "aac", "mp4", "wav", "ogg", "oga", "opus", "flac", "webm")

        /** Extension of the URL's last path segment, never the host; falls back to mp3 for unknown/absent ones. */
        fun audioExt(url: String): String {
            val seg = runCatching { android.net.Uri.parse(url).lastPathSegment }.getOrNull() ?: ""
            val ext = seg.substringAfterLast('.', "").lowercase()
            return if (ext in KNOWN_EXT) ext else "mp3"
        }
    }
    fun partFile(item: QueueItem): File = File(audioDir, "${item.id}.part")

    fun transcriptFile(id: String) = File(transcriptDir, "$id.json")

    fun loadTranscript(id: String): LocalTranscript? {
        val f = transcriptFile(id)
        if (!f.exists()) return null
        return runCatching {
            val o = JSONObject(f.readText())
            LocalTranscript(o.getString("engine"), o.getLong("duration_ms"), PodTalkCore.Segment.listFromJson(o.getJSONArray("segments")), o.optInt("fillers_removed"), o.optLong("processing_ms"), o.optBoolean("synced"))
        }.getOrNull()
    }

    fun saveTranscript(id: String, t: LocalTranscript) {
        transcriptFile(id).writeText(JSONObject()
            .put("engine", t.engine).put("duration_ms", t.durationMs)
            .put("segments", PodTalkCore.Segment.listToJson(t.segments))
            .put("fillers_removed", t.fillersRemoved).put("processing_ms", t.processingMs).put("synced", t.synced).toString())
    }

    fun modelFile(name: String) = File(modelDir, "ggml-$name.bin")

    fun delete(item: QueueItem) { audioFile(item).delete(); partFile(item).delete(); transcriptFile(item.id).delete() }
}
