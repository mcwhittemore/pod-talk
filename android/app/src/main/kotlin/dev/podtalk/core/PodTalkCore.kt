package dev.podtalk.core

import org.json.JSONArray
import org.json.JSONObject

/** Kotlin face of the Rust crate `podtalk-core` (libpodtalk_core.so). */
object PodTalkCore {
    init {
        System.loadLibrary("podtalk_core")
        nativeInit()
    }

    data class Segment(val startMs: Long, val endMs: Long, val text: String) {
        fun toJson(): JSONObject = JSONObject().put("start_ms", startMs).put("end_ms", endMs).put("text", text)
        companion object {
            fun fromJson(o: JSONObject) = Segment(o.getLong("start_ms"), o.getLong("end_ms"), o.getString("text"))
            fun listFromJson(a: JSONArray): List<Segment> = (0 until a.length()).map { fromJson(a.getJSONObject(it)) }
            fun listToJson(l: List<Segment>): JSONArray = JSONArray().also { a -> l.forEach { a.put(it.toJson()) } }
        }
    }

    data class FillerSpan(val startMs: Long, val endMs: Long, val word: String)

    data class Transcript(
        val engine: String,
        val durationMs: Long,
        val segments: List<Segment>,
        val fillersRemoved: List<FillerSpan>,
        val processingMs: Long,
    ) {
        val text: String get() = segments.joinToString(" ") { it.text }
    }

    data class LocalAnswer(val text: String, val segmentStartMs: Long, val segmentEndMs: Long, val excerpt: String, val score: Double, val engine: String)

    @Volatile var progressListener: ((doneMs: Long, totalMs: Long) -> Unit)? = null

    /** Called from Rust during whole-file transcription. */
    @JvmStatic fun onProgress(doneMs: Long, totalMs: Long) { progressListener?.invoke(doneMs, totalMs) }

    fun version(): String = nativeVersion() ?: "podtalk-core (version unavailable)"

    /** Decode any audio file to 16 kHz mono PCM. */
    fun decode(path: String): FloatArray? = nativeDecode(path)

    fun trimSilence(pcm: FloatArray, rate: Int = 16000, maxGapMs: Int = 400): FloatArray =
        nativeTrimSilence(pcm, rate, maxGapMs) ?: throw RuntimeException("podtalk-core: trimSilence failed (out of memory?)")

    fun transcribePcm(modelPath: String, pcm: FloatArray, threads: Int = 4, stripFillers: Boolean = true, language: String = "en"): Transcript =
        parseTranscript(nativeTranscribePcm(modelPath, pcm, threads, stripFillers, language) ?: error("podtalk-core returned null"))

    fun transcribeFile(modelPath: String, audioPath: String, threads: Int = 4, language: String = "en", onProgress: ((Long, Long) -> Unit)? = null): Transcript {
        progressListener = onProgress
        try {
            return parseTranscript(nativeTranscribeFile(modelPath, audioPath, threads, language) ?: error("podtalk-core returned null"))
        } finally {
            progressListener = null
        }
    }

    fun answer(question: String, segments: List<Segment>, positionMs: Long): LocalAnswer {
        val o = JSONObject(nativeAnswer(question, Segment.listToJson(segments).toString(), positionMs) ?: error("podtalk-core returned null"))
        return LocalAnswer(o.getString("text"), o.getLong("segment_start_ms"), o.getLong("segment_end_ms"), o.getString("excerpt"), o.getDouble("score"), o.getString("engine"))
    }

    data class Excerpt(val text: String, val startMs: Long, val endMs: Long)

    fun excerpt(segments: List<Segment>, positionMs: Long, windowMs: Long = 90_000): Excerpt {
        val o = JSONObject(nativeExcerpt(Segment.listToJson(segments).toString(), positionMs, windowMs) ?: error("podtalk-core returned null"))
        return Excerpt(o.getString("text"), o.getLong("start_ms"), o.getLong("end_ms"))
    }

    fun stripFillers(text: String): String = nativeStripFillers(text) ?: text

    private fun parseTranscript(json: String): Transcript {
        val o = JSONObject(json)
        if (o.has("error")) throw RuntimeException("podtalk-core: " + o.getString("error"))
        val fr = o.optJSONArray("fillers_removed") ?: JSONArray()
        return Transcript(
            engine = o.getString("engine"),
            durationMs = o.getLong("duration_ms"),
            segments = Segment.listFromJson(o.getJSONArray("segments")),
            fillersRemoved = (0 until fr.length()).map { fr.getJSONObject(it) }.map { FillerSpan(it.getLong("start_ms"), it.getLong("end_ms"), it.getString("word")) },
            processingMs = o.getLong("processing_ms"),
        )
    }

    @JvmStatic private external fun nativeInit()
    // All natives may return null when the JNI allocation fails (OOM); the wrappers above turn that into an exception.
    @JvmStatic private external fun nativeVersion(): String?
    @JvmStatic private external fun nativeDecode(path: String): FloatArray?
    @JvmStatic private external fun nativeTrimSilence(pcm: FloatArray, rate: Int, maxGapMs: Int): FloatArray?
    @JvmStatic private external fun nativeTranscribePcm(model: String, pcm: FloatArray, threads: Int, stripFillers: Boolean, language: String): String?
    @JvmStatic private external fun nativeTranscribeFile(model: String, audio: String, threads: Int, language: String): String?
    @JvmStatic private external fun nativeAnswer(question: String, segmentsJson: String, positionMs: Long): String?
    @JvmStatic private external fun nativeExcerpt(segmentsJson: String, positionMs: Long, windowMs: Long): String?
    @JvmStatic private external fun nativeStripFillers(text: String): String?
}
