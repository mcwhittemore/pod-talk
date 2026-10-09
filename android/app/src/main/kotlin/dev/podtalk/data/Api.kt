package dev.podtalk.data

import dev.podtalk.core.PodTalkCore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class ApiException(val code: Int, message: String) : Exception(message)

/** Thin client for the Pod Talk server (see progress/01-plan-and-api-contract.md). */
class Api(private val settings: Settings) {
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()

    private val json = "application/json; charset=utf-8".toMediaType()

    private suspend fun call(method: String, path: String, body: JSONObject? = null): JSONObject = withContext(Dispatchers.IO) {
        val base = settings.serverUrl.trimEnd('/')
        val b = Request.Builder().url("$base/api$path").header("Authorization", "Bearer ${settings.token}")
        when (method) {
            "GET" -> b.get()
            "DELETE" -> b.delete()
            else -> b.method(method, (body ?: JSONObject()).toString().toRequestBody(json))
        }
        http.newCall(b.build()).execute().use { r ->
            val text = r.body?.string() ?: ""
            if (!r.isSuccessful) throw ApiException(r.code, "HTTP ${r.code} $path: ${text.take(200)}")
            if (text.isBlank()) JSONObject() else JSONObject(text)
        }
    }

    suspend fun health(): Boolean = runCatching { call("GET", "/health"); true }.getOrDefault(false)

    suspend fun queue(): List<QueueItem> {
        val a: JSONArray = call("GET", "/queue").optJSONArray("items") ?: JSONArray()
        return (0 until a.length()).map { QueueItem.fromJson(a.getJSONObject(it)) }
    }

    suspend fun patchQueue(id: String, status: String? = null, durationMs: Long? = null) {
        val o = JSONObject(); status?.let { o.put("status", it) }; durationMs?.let { o.put("duration_ms", it) }
        call("PATCH", "/queue/$id", o)
    }

    suspend fun putTranscript(id: String, t: LocalTranscript) {
        call("PUT", "/queue/$id/transcript", JSONObject()
            .put("engine", t.engine).put("duration_ms", t.durationMs)
            .put("segments", PodTalkCore.Segment.listToJson(t.segments)))
    }

    suspend fun getTranscript(id: String): LocalTranscript? = try {
        val o = call("GET", "/queue/$id/transcript")
        LocalTranscript(o.optString("engine", "server"), o.optLong("duration_ms"), PodTalkCore.Segment.listFromJson(o.getJSONArray("segments")), 0, 0, true)
    } catch (e: ApiException) { if (e.code == 404) null else throw e }

    suspend fun startConversation(queueItemId: String, positionMs: Long): String =
        call("POST", "/conversations", JSONObject().put("queue_item_id", queueItemId).put("audio_position_ms", positionMs)).getString("id")

    suspend fun conversationEvent(id: String, type: String, positionMs: Long) {
        call("POST", "/conversations/$id/events", JSONObject().put("type", type).put("audio_position_ms", positionMs))
    }

    suspend fun postTurn(id: String, t: Turn) {
        call("POST", "/conversations/$id/turns", JSONObject()
            .put("role", t.role).put("text", t.text).put("audio_position_ms", t.audioPositionMs)
            .put("segment_start_ms", t.segmentStartMs).put("segment_end_ms", t.segmentEndMs)
            .put("context_excerpt", t.contextExcerpt).put("engine", t.engine).put("client_ts", t.createdAt))
    }

    /** Returns null when the server has no LLM configured (503 no_llm) so the caller falls back to on-device. */
    suspend fun answer(question: String, context: String, title: String, positionMs: Long): String? = try {
        call("POST", "/answer", JSONObject().put("question", question).put("context", context).put("title", title).put("audio_position_ms", positionMs)).getString("answer")
    } catch (e: ApiException) { if (e.code == 503) null else throw e }
}
