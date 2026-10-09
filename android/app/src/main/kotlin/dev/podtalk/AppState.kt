package dev.podtalk

import android.app.Application
import android.content.ComponentName
import android.content.Context
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
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
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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
    val coreVersion: String by lazy { runCatching { PodTalkCore.version() }.getOrElse { "core unavailable: $it" } }
    val busy = MutableStateFlow(false)

    /**
     * The player lives in [PlaybackService] (foreground while playing) and is driven through a
     * MediaController; it is null for the few ms until the controller connects.
     */
    @Volatile private var controller: MediaController? = null
    private val exo: Player? get() = controller
    /** Media item queued before the controller connected, applied once it does. */
    private var pendingOpen: MediaItem? = null
    private var ticker: Job? = null
    /** One download/transcription at a time: the Rust progress callback is a single static, and the phone has one whisper budget. */
    private val prepareMutex = Mutex()
    private val inFlight = HashSet<String>()

    init {
        companion.init()
        val token = SessionToken(app, ComponentName(app, PlaybackService::class.java))
        val future = MediaController.Builder(app, token).buildAsync()
        future.addListener({
            val c = runCatching { future.get() }.onFailure { Log.e("AppState", "MediaController failed", it) }.getOrNull() ?: return@addListener
            c.addListener(object : Player.Listener {
                override fun onIsPlayingChanged(isPlaying: Boolean) { player.update { it.copy(playing = isPlaying) } }
            })
            controller = c
            pendingOpen?.let { item -> pendingOpen = null; c.setMediaItem(item); c.prepare() }
        }, ContextCompat.getMainExecutor(app))
        scope.launch {
            modelReady.value = withContext(Dispatchers.IO) { transcriber.modelReady(settings.model) }
            refresh()
            enhancer.warmUp()
        }
        ticker = scope.launch {
            while (isActive) {
                exo?.let { p -> if (p.isPlaying) player.update { it.copy(positionMs = p.currentPosition, durationMs = p.duration.coerceAtLeast(0)) } }
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
            // Disk reads off the main thread; transcripts for long episodes are big.
            val fromDisk = withContext(Dispatchers.IO) {
                val cur = local.value
                items.associate { q ->
                    val f = store.audioFile(q)
                    q.id to ((cur[q.id]?.transcript ?: store.loadTranscript(q.id)) to (f.exists() && f.length() > 0))
                }
            }
            local.update { m ->
                items.associate { q ->
                    val existing = m[q.id]
                    val (t, hasAudio) = fromDisk[q.id] ?: (null to false)
                    val st = when {
                        existing?.state == LocalState.DOWNLOADING || existing?.state == LocalState.TRANSCRIBING -> existing.state
                        t != null -> LocalState.READY
                        hasAudio -> LocalState.DOWNLOADED
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
            modelReady.value = withContext(Dispatchers.IO) { transcriber.modelReady(settings.model) }
            if (!modelReady.value) error("model file missing after download")
        } catch (e: Exception) { Log.e("AppState", "model", e) } finally { modelProgress.value = null }
    }

    /** Download, then transcribe on-device, then sync the transcript to the server. */
    fun prepare(item: QueueItem) = scope.launch {
        // Guard synchronously (we are on Main) so a double tap cannot start two downloads of the same file.
        if (!inFlight.add(item.id)) return@launch
        try {
            val hadAudio = withContext(Dispatchers.IO) { store.audioFile(item).let { it.exists() && it.length() > 0 } }
            setLocal(item.id) { it.copy(state = if (hadAudio) LocalState.DOWNLOADED else LocalState.DOWNLOADING, progress = 0f, error = null) }
            if (!modelReady.value) ensureModel().join()
            if (!modelReady.value) error("whisper model is not downloaded")
            prepareMutex.withLock {
                val f = store.audioFile(item)
                if (!(f.exists() && f.length() > 0)) {
                    setLocal(item.id) { it.copy(state = LocalState.DOWNLOADING, progress = 0f) }
                    downloader.download(item) { p -> setLocal(item.id) { it.copy(progress = p) } }
                    runCatching { api.patchQueue(item.id, status = "downloaded") }
                }
                if (withContext(Dispatchers.IO) { store.loadTranscript(item.id) } == null) {
                    setLocal(item.id) { it.copy(state = LocalState.TRANSCRIBING, progress = 0f) }
                    val t = transcriber.transcribe(settings.model, f) { p -> setLocal(item.id) { it.copy(progress = p) } }
                    withContext(Dispatchers.IO) { store.saveTranscript(item.id, t) }
                    setLocal(item.id) { it.copy(transcript = t) }
                    val synced = runCatching { api.putTranscript(item.id, t); true }.getOrDefault(false)
                    val t2 = t.copy(synced = synced)
                    withContext(Dispatchers.IO) { store.saveTranscript(item.id, t2) }
                    setLocal(item.id) { it.copy(state = LocalState.READY, transcript = t2, progress = 1f) }
                } else setLocal(item.id) { it.copy(state = LocalState.READY, progress = 1f) }
            }
            refresh()
        } catch (e: Exception) {
            Log.e("AppState", "prepare failed", e)
            val hasAudio = withContext(Dispatchers.IO) { store.audioFile(item).exists() }
            setLocal(item.id) { it.copy(state = if (hasAudio) LocalState.DOWNLOADED else LocalState.NOT_DOWNLOADED, error = e.message) }
        } finally {
            inFlight.remove(item.id)
        }
    }

    fun open(item: QueueItem) {
        val f = store.audioFile(item)
        val src = if (f.exists() && f.length() > 0) android.net.Uri.fromFile(f) else android.net.Uri.parse(item.audioUrl)
        val media = MediaItem.Builder().setUri(src).setMediaId(item.id)
            .setRequestMetadata(MediaItem.RequestMetadata.Builder().setMediaUri(src).build())
            .setMediaMetadata(androidx.media3.common.MediaMetadata.Builder().setTitle(item.title).setArtist(item.feedTitle ?: "Pod Talk").build())
            .build()
        // Leaving a different episode mid-conversation ends that conversation first.
        val prev = player.value
        if (prev.item != null && prev.item.id != item.id) endConversationAsync(prev.conversationId, exo?.currentPosition ?: 0)
        val c = exo
        if (c != null) { c.setMediaItem(media); c.prepare() } else pendingOpen = media
        player.value = PlayerState(item = item, turns = emptyList())
    }

    fun closePlayer() {
        val st = player.value
        val pos = exo?.currentPosition ?: 0
        exo?.stop()
        player.value = PlayerState()
        endConversationAsync(st.conversationId, pos)
    }

    private fun endConversationAsync(conversationId: String?, positionMs: Long) {
        val id = conversationId ?: return
        scope.launch { runCatching { api.conversationEvent(id, "ended", positionMs) }.onFailure { Log.w("AppState", "end conversation failed: $it") } }
    }

    fun togglePlay() { exo?.let { if (it.isPlaying) it.pause() else it.play() } }
    fun seekBy(ms: Long) {
        val p = exo ?: return
        val target = p.currentPosition + ms
        // Before the duration is known (streaming, still buffering) clamping to 0..0 would jump to the start.
        p.seekTo(if (p.duration == C.TIME_UNSET) target.coerceAtLeast(0) else target.coerceIn(0, p.duration.coerceAtLeast(0)))
    }
    fun seekTo(ms: Long) { exo?.seekTo(ms) }
    fun setError(msg: String?) = player.update { it.copy(error = msg) }

    private suspend fun ensureConversation(): String? {
        val st = player.value
        val item = st.item ?: return null
        st.conversationId?.let { return it }
        return runCatching { api.startConversation(item.id, exo?.currentPosition ?: 0) }
            .onSuccess { id -> player.update { it.copy(conversationId = id) } }
            .onFailure { Log.w("AppState", "startConversation failed: $it") }.getOrNull()
    }

    /** Tap Ask: pause, listen, answer, resume. `clip` runs the same pipeline on the bundled sample (self-test). */
    fun ask(clip: FloatArray? = null, typed: String? = null) = scope.launch {
        val item = player.value.item ?: return@launch
        if (busy.value) return@launch
        busy.value = true
        val p = exo
        val wasPlaying = p?.isPlaying == true
        val pos = p?.currentPosition ?: 0
        try {
            p?.pause()
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
            val ex = companion.answer(item, transcript, convo, question, pos, { ph -> player.update { it.copy(phase = ph) } }, questionEngine = if (typed != null) "typed" else "whisper.cpp")
            player.update { it.copy(turns = it.turns + ex.question + ex.answer) }
        } catch (e: Exception) {
            Log.e("AppState", "ask failed", e)
            player.update { it.copy(error = e.message ?: e.toString()) }
        } finally {
            player.update { it.copy(phase = TalkCompanion.Phase.Idle, micLevel = 0f) }
            // Only resume if the listener is still on this episode (Back during an Ask stops the player).
            if (player.value.item?.id == item.id) {
                player.value.conversationId?.let { id -> runCatching { api.conversationEvent(id, "resumed", pos) } }
                if (wasPlaying) p?.play()
            }
            busy.value = false
        }
    }

    /** Self-test: push the bundled clip through the mic pipeline. Never falls back to the live mic. */
    fun askWithSampleClip() = scope.launch {
        val clip = withContext(Dispatchers.Default) { companion.sampleClip() }
        if (clip == null) { setError("Could not decode the bundled sample clip."); return@launch }
        ask(clip = clip)
    }

    private data class Quad(val a: String, val b: String, val c: Boolean, val d: Int)

    fun stopListening() = companion.stopListening()

    fun delete(item: QueueItem) { store.delete(item); setLocal(item.id) { ItemLocal() } }

    companion object {
        @Volatile private var instance: AppState? = null
        fun get(ctx: Context): AppState = instance ?: synchronized(this) { instance ?: AppState(ctx.applicationContext as Application).also { instance = it } }
    }
}
