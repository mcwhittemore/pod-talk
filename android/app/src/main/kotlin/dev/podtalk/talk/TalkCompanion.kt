package dev.podtalk.talk

import android.content.Context
import android.speech.tts.TextToSpeech
import android.util.Log
import dev.podtalk.audio.Enhancer
import dev.podtalk.audio.Recorder
import dev.podtalk.core.PodTalkCore
import dev.podtalk.data.Api
import dev.podtalk.data.LocalTranscript
import dev.podtalk.data.QueueItem
import dev.podtalk.data.Turn
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Locale
import kotlin.coroutines.resume

/**
 * The interrupt flow. While an episode plays, the listener taps Ask (or just
 * starts talking after tapping): playback pauses, we record, run desert-ant
 * Clear, trim silence, transcribe with whisper (filler words stripped using
 * token timestamps), answer (server LLM, else on-device BM25 over the
 * transcript), speak the reply with TTS, sync both turns, resume playback.
 */
class TalkCompanion(
    private val ctx: Context,
    private val api: Api,
    private val enhancer: Enhancer,
    private val recorder: Recorder,
) {
    sealed class Phase(val label: String) {
        object Idle : Phase("")
        object Listening : Phase("Listening…")
        object Cleaning : Phase("Cleaning audio (desert-ant Clear)…")
        object Transcribing : Phase("Transcribing (whisper)…")
        object Thinking : Phase("Thinking…")
        object Speaking : Phase("Speaking…")
    }

    data class Exchange(val question: Turn, val answer: Turn, val questionRaw: String, val enhanced: Boolean, val fillersRemoved: Int)

    private var tts: TextToSpeech? = null
    @Volatile var speaking = false

    fun init() {
        tts = TextToSpeech(ctx) { status -> if (status == TextToSpeech.SUCCESS) tts?.language = Locale.US }
    }

    fun stopSpeaking() { tts?.stop() }

    fun stopListening() { recorder.stopRequested = true }

    /** Record from the mic, or transcribe a prepared PCM clip (used by the self-test). */
    suspend fun captureQuestion(modelPath: String, onPhase: (Phase) -> Unit, onLevel: (Float) -> Unit, clip: FloatArray? = null): Pair<PodTalkCore.Transcript, Boolean> {
        onPhase(Phase.Listening)
        val raw = clip ?: recorder.record(onLevel = onLevel)
        onPhase(Phase.Cleaning)
        val cleaned = enhancer.enhance(raw)
        val trimmed = PodTalkCore.trimSilence(cleaned.pcm)
        onPhase(Phase.Transcribing)
        val t = withContext(Dispatchers.Default) { PodTalkCore.transcribePcm(modelPath, trimmed, threads = 4, stripFillers = true) }
        return t to cleaned.enhanced
    }

    suspend fun answer(
        item: QueueItem,
        transcript: LocalTranscript?,
        conversationId: String?,
        question: String,
        positionMs: Long,
        onPhase: (Phase) -> Unit,
        speak: Boolean = true,
    ): Exchange {
        onPhase(Phase.Thinking)
        val segments = transcript?.segments ?: emptyList()
        val ex = PodTalkCore.excerpt(segments, positionMs)
        val qTurn = Turn("user", question, positionMs, ex.startMs, ex.endMs, ex.text.take(600), "whisper.cpp")
        if (conversationId != null) runCatching { api.postTurn(conversationId, qTurn) }.onFailure { Log.w("Companion", "sync question failed: $it") }

        var engine = "claude"
        var answerText = runCatching { api.answer(question, ex.text, item.title, positionMs) }.getOrNull()
        var segStart = ex.startMs; var segEnd = ex.endMs; var excerpt = ex.text
        if (answerText == null) {
            val local = PodTalkCore.answer(question, segments, positionMs)
            answerText = local.text; engine = local.engine; segStart = local.segmentStartMs; segEnd = local.segmentEndMs; excerpt = local.excerpt
        }
        val aTurn = Turn("assistant", answerText, positionMs, segStart, segEnd, excerpt.take(600), engine)
        if (conversationId != null) runCatching { api.postTurn(conversationId, aTurn) }.onFailure { Log.w("Companion", "sync answer failed: $it") }
        if (speak) { onPhase(Phase.Speaking); say(answerText) }
        return Exchange(qTurn, aTurn, question, false, 0)
    }

    suspend fun say(text: String) {
        val t = tts ?: return
        speaking = true
        try {
            suspendCancellableCoroutine<Unit> { cont ->
                val id = "pt-" + System.nanoTime()
                t.setOnUtteranceProgressListener(object : android.speech.tts.UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {}
                    override fun onDone(utteranceId: String?) { if (cont.isActive) cont.resume(Unit) }
                    @Deprecated("Deprecated in Java") override fun onError(utteranceId: String?) { if (cont.isActive) cont.resume(Unit) }
                })
                val r = t.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
                if (r != TextToSpeech.SUCCESS && cont.isActive) cont.resume(Unit)
                cont.invokeOnCancellation { t.stop() }
            }
        } finally { speaking = false }
    }

    /** Self-test clip bundled as res/raw/sample_question.wav, decoded through the same Rust path. */
    fun sampleClip(): FloatArray? {
        val f = File(ctx.cacheDir, "sample_question.wav")
        if (!f.exists()) ctx.resources.openRawResource(dev.podtalk.R.raw.sample_question).use { i -> f.outputStream().use { i.copyTo(it) } }
        return PodTalkCore.decode(f.path)
    }
}
