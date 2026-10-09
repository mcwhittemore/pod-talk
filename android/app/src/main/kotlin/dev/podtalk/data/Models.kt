package dev.podtalk.data

import dev.podtalk.core.PodTalkCore
import org.json.JSONObject

enum class LocalState { NOT_DOWNLOADED, DOWNLOADING, DOWNLOADED, TRANSCRIBING, READY }

data class QueueItem(
    val id: String,
    val title: String,
    val audioUrl: String,
    val source: String,
    val status: String,
    val position: Int,
    val durationMs: Long?,
    val hasTranscript: Boolean,
    val feedTitle: String?,
    val imageUrl: String?,
) {
    companion object {
        fun fromJson(o: JSONObject): QueueItem {
            val ep = o.optJSONObject("episode")
            return QueueItem(
                id = o.getString("id"),
                title = o.getString("title"),
                audioUrl = o.getString("audio_url"),
                source = o.optString("source", "feed"),
                status = o.optString("status", "queued"),
                position = o.optInt("position", 0),
                durationMs = if (o.isNull("duration_ms")) null else o.optLong("duration_ms"),
                hasTranscript = o.optBoolean("has_transcript", false),
                feedTitle = ep?.optString("feed_title")?.takeIf { it.isNotBlank() },
                imageUrl = ep?.optString("image_url")?.takeIf { it.isNotBlank() },
            )
        }
    }
}

data class Turn(
    val role: String,
    val text: String,
    val audioPositionMs: Long,
    val segmentStartMs: Long?,
    val segmentEndMs: Long?,
    val contextExcerpt: String?,
    val engine: String?,
    val createdAt: Long = System.currentTimeMillis(),
)

data class Conversation(val id: String, val queueItemId: String, val startedAtPositionMs: Long, val turns: List<Turn>, val status: String)

data class LocalTranscript(val engine: String, val durationMs: Long, val segments: List<PodTalkCore.Segment>, val fillersRemoved: Int, val processingMs: Long, val synced: Boolean)

fun Long.mmss(): String {
    val s = this / 1000
    return "%d:%02d".format(s / 60, s % 60)
}
