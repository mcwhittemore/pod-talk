package dev.podtalk

import android.app.Application
import android.content.Context
import android.util.Log
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import dev.podtalk.audio.Downloader
import dev.podtalk.audio.Enhancer
import dev.podtalk.audio.Recorder
import dev.podtalk.audio.Transcriber
import dev.podtalk.core.PodTalkCore
import dev.podtalk.data.Api
import dev.podtalk.data.LocalState
import dev.podtalk.data.LocalTranscript
import dev.podtalk.data.QueueItem
import dev.podtalk.data.Settings
import dev.podtalk.data.Store
import dev.podtalk.data.Turn
import dev.podtalk.talk.TalkCompanion
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class ItemLocal(val state: LocalState = LocalState.NOT_DOWNLOADED, val progress: Float = 0f, val transcript: LocalTranscript? = null, val error: String? = null)

data class PlayerState(
    val item: QueueItem? = null,
    val playing: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val conversationId: String? = null,
    val turns: List<Turn> = emptyList(),
    val phase: TalkCompanion.Phase = TalkCompanion.Phase.Idle,
    val micLevel: Float = 0f,
    val lastQuestionRaw: String? = null,
    val lastEnhanced: Boolean? = null,
    val lastFillers: Int = 0,
    val error: String? = null,
)

/** Single app-wide state holder (kept simple on purpose). */
class AppState(private val app: Application) {
    val settings = Settings(app)
    val store = Store(app)
    val api = Api(settings)
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val downloader = Downloader(api.http, store)
    val transcriber = Transcriber(api.http, store)
    private val enhancer = Enhancer(app)
    val companion = TalkCompanion(app, api, enhancer, Recorder())

    val queue = MutableStateFlow<List<QueueItem>>(emptyList())
    val local = MutableStateFlow<Map<String, ItemLocal>>(emptyMap())
    val player = MutableStateFlow(PlayerState())
    val serverOk = MutableStateFlow<Boolean?>(null)
    val modelProgress = MutableStateFlow<Float?>(null)
    val modelReady = MutableStateFlow(false)
    val coreVersion = runCatching { PodTalkCore.version() }.getOrDefault("core unavailable")
    val busy = MutableStateFlow(false)

    val exo: ExoPlayer = ExoPlayer.Builder(app).build().apply {
        addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) { player.update { it.copy(playing = isPlaying) } }
        })
    }
    private var ticker: Job? = null

    init {
        companion.init()
        scope.launch {
            modelReady.value = transcriber.modelReady(settings.model)
            refresh()
            enhancer.warmUp()
        }
        ticker = scope.launch {
            while (isActive) {
                if (exo.isPlaying) player.update { it.copy(positionMs = exo.currentPosition, durationMs = exo.duration.coerceAtLeast(0)) }
                delay(500)
            }
        }
    }

    fun refresh() = scope.launch {
        if (!settings.configured) { serverOk.value = null; return@launch }
        try {
            val items = api.queue()
            queue.value = items
            serverOk.value = true
            local.update { m ->
                items.associate { q ->
                    val existing = m[q.id]
                    val t = existing?.transcript ?: store.loadTranscript(q.id)
                    val f = store.audioFile(q)
                    val st = when {
                        existing?.state == LocalState.DOWNLOADING || existing?.state == LocalState.TRANSCRIBING -> existing.state
                        t != null -> LocalState.READY
                        f.exists() && f.length() > 0 -> LocalState.DOWNLOADED
                        else -> LocalState.NOT_DOWNLOADED
                    }
                    q.id to (existing?.copy(state = st, transcript = t) ?: ItemLocal(st, 0f, t))
                }
            }
        } catch (e: Exception) {
            Log.w("AppState", "refresh failed", e); serverOk.value = false
        }
    }

    private fun setLocal(id: String, f: (ItemLocal) -> ItemLocal) = local.update { m -> m + (id to f(m[id] ?: ItemLocal())) }

    fun ensureModel() = scope.launch {
        if (modelReady.value) return@launch
        try {
            modelProgress.value = 0f
            transcriber.ensureModel(settings.model) { p -> modelProgress.value = p }
            modelReady.value = true
        } catch (e: Exception) { Log.e("AppState", "model", e) } finally { modelProgress.value = null }
    }

    /** Download, then transcribe on-device, then sync the transcript to the server. */
    fun prepare(item: QueueItem) = scope.launch {
        try {
            if (!modelReady.value) ensureModel().join()
            val f = store.audioFile(item)
            if (!(f.exists() && f.length() > 0)) {
                setLocal(item.id) { it.copy(state = LocalState.DOWNLOADING, progress = 0f, error = null) }
                downloader.download(item) { p -> setLocal(item.id) { it.copy(progress = p) } }
                runCatching { api.patchQueue(item.id, status = "downloaded") }
            }
            if (store.loadTranscript(item.id) == null) {
                setLocal(item.id) { it.copy(state = LocalState.TRANSCRIBING, progress = 0f) }
                val t = transcriber.transcribe(settings.model, f) { p -> setLocal(item.id) { it.copy(progress = p) } }
                store.saveTranscript(item.id, t)
                setLocal(item.id) { it.copy(transcript = t) }
                val synced = runCatching { api.putTranscript(item.id, t); true }.getOrDefault(false)
                val t2 = t.copy(synced = synced); store.saveTranscript(item.id, t2)
                setLocal(item.id) { it.copy(state = LocalState.READY, transcript = t2, progress = 1f) }
            } else setLocal(item.id) { it.copy(state = LocalState.READY, progress = 1f) }
            refresh()
        } catch (e: Exception) {
            Log.e("AppState", "prepare failed", e)
            setLocal(item.id) { it.copy(state = if (store.audioFile(item).exists()) LocalState.DOWNLOADED else LocalState.NOT_DOWNLOADED, error = e.message) }
        }
    }

    fun open(item: QueueItem) {
        val f = store.audioFile(item)
        val src = if (f.exists() && f.length() > 0) android.net.Uri.fromFile(f) else android.net.Uri.parse(item.audioUrl)
        exo.setMediaItem(MediaItem.fromUri(src)); exo.prepare()
        player.value = PlayerState(item = item, turns = emptyList())
    }

    fun closePlayer() {
        scope.launch { endConversation() }
        exo.stop(); player.value = PlayerState()
    }

    fun togglePlay() { if (exo.isPlaying) exo.pause() else exo.play() }
    fun seekBy(ms: Long) { exo.seekTo((exo.currentPosition + ms).coerceIn(0, exo.duration.coerceAtLeast(0))) }
    fun seekTo(ms: Long) { exo.seekTo(ms) }

    private suspend fun ensureConversation(): String? {
        val st = player.value
        val item = st.item ?: return null
        st.conversationId?.let { return it }
        return runCatching { api.startConversation(item.id, exo.currentPosition) }
            .onSuccess { id -> player.update { it.copy(conversationId = id) } }
            .onFailure { Log.w("AppState", "startConversation failed: $it") }.getOrNull()
    }

    suspend fun endConversation() {
        val st = player.value
        st.conversationId?.let { id -> runCatching { api.conversationEvent(id, "ended", exo.currentPosition) } }
        player.update { it.copy(conversationId = null) }
    }

    /** Tap Ask: pause, listen, answer, resume. `clip` runs the same pipeline on the bundled sample (self-test). */
    fun ask(clip: FloatArray? = null, typed: String? = null) = scope.launch {
        val item = player.value.item ?: return@launch
        if (busy.value) return@launch
        busy.value = true
        val wasPlaying = exo.isPlaying
        val pos = exo.currentPosition
        try {
            exo.pause()
            val convo = ensureConversation()
            convo?.let { runCatching { api.conversationEvent(it, "paused", pos) } }
            val transcript = local.value[item.id]?.transcript
            val (question, raw, enhanced, fillers) = if (typed != null) {
                Quad(typed, typed, false, 0)
            } else {
                val model = store.modelFile(settings.model).path
                val (t, enh) = companion.captureQuestion(model, { ph -> player.update { it.copy(phase = ph) } }, { lv -> player.update { it.copy(micLevel = lv) } }, clip)
                val q = t.text.trim()
                val rawText = (t.segments.joinToString(" ") { it.text } + if (t.fillersRemoved.isNotEmpty()) "  (removed: ${t.fillersRemoved.joinToString(", ") { it.word }})" else "")
                Quad(q, rawText, enh, t.fillersRemoved.size)
            }
            if (question.isBlank()) {
                player.update { it.copy(phase = TalkCompanion.Phase.Idle, error = "I didn't catch anything.", lastEnhanced = enhanced) }
                return@launch
            }
            player.update { it.copy(lastQuestionRaw = raw, lastEnhanced = enhanced, lastFillers = fillers, error = null) }
            val ex = companion.answer(item, transcript, convo, question, pos, { ph -> player.update { it.copy(phase = ph) } })
            player.update { it.copy(turns = it.turns + ex.question + ex.answer) }
        } catch (e: Exception) {
            Log.e("AppState", "ask failed", e)
            player.update { it.copy(error = e.message ?: e.toString()) }
        } finally {
            player.update { it.copy(phase = TalkCompanion.Phase.Idle, micLevel = 0f) }
            player.value.conversationId?.let { id -> runCatching { api.conversationEvent(id, "resumed", pos) } }
            if (wasPlaying) exo.play()
            busy.value = false
        }
    }

    private data class Quad(val a: String, val b: String, val c: Boolean, val d: Int)

    fun stopListening() = companion.stopListening()

    fun delete(item: QueueItem) { store.delete(item); setLocal(item.id) { ItemLocal() } }

    companion object {
        @Volatile private var instance: AppState? = null
        fun get(ctx: Context): AppState = instance ?: synchronized(this) { instance ?: AppState(ctx.applicationContext as Application).also { instance = it } }
    }
}
