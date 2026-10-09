package dev.podtalk.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.podtalk.AppState
import dev.podtalk.ItemLocal
import dev.podtalk.data.LocalState
import dev.podtalk.data.QueueItem
import dev.podtalk.data.Turn
import dev.podtalk.data.mmss
import dev.podtalk.talk.TalkCompanion

private val Blue = Color(0xFF1D4ED8)
private val Ink = Color(0xFF0F172A)
private val Paper = Color(0xFFF8FAFC)
private val Line = Color(0xFFE2E8F0)
private val Muted = Color(0xFF64748B)

@Composable
fun PodTalkApp(state: AppState) {
    MaterialTheme(colorScheme = lightColorScheme(primary = Blue, background = Paper, surface = Color.White, onBackground = Ink, onSurface = Ink)) {
        var showSettings by remember { mutableStateOf(!state.settings.configured) }
        val player by state.player.collectAsStateWithLifecycle()
        Surface(Modifier.fillMaxSize(), color = Paper) {
            when {
                showSettings -> SettingsScreen(state) { showSettings = false; state.refresh() }
                player.item != null -> PlayerScreen(state)
                else -> QueueScreen(state) { showSettings = true }
            }
        }
    }
}

@Composable
fun SettingsScreen(state: AppState, onDone: () -> Unit) {
    var url by remember { mutableStateOf(state.settings.serverUrl) }
    var token by remember { mutableStateOf(state.settings.token) }
    var model by remember { mutableStateOf(state.settings.model) }
    Column(Modifier.fillMaxSize().statusBarsPadding().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Pod Talk", fontSize = 32.sp, fontWeight = FontWeight.Bold)
        Text("Connect to your Pod Talk server. The token is the POD_TALK_TOKEN you set on Vercel.", color = Muted)
        OutlinedTextField(url, { url = it }, label = { Text("Server URL") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(token, { token = it }, label = { Text("API token") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Text("Transcription model (whisper.cpp, on-device)", fontWeight = FontWeight.SemiBold)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("tiny.en" to "tiny.en · 75 MB · fastest", "base.en" to "base.en · 142 MB · better").forEach { (k, label) ->
                FilterChip(selected = model == k, onClick = { model = k }, label = { Text(label) })
            }
        }
        Button(onClick = { state.settings.serverUrl = url; state.settings.token = token; state.settings.model = model; state.modelReady.value = state.transcriber.modelReady(model); onDone() }, modifier = Modifier.fillMaxWidth()) { Text("Save") }
        Spacer(Modifier.weight(1f))
        Text(state.coreVersion, color = Muted, fontSize = 12.sp)
        Text("Speech cleanup: desert-ant Clear · Filler removal + answers: podtalk-core (Rust)", color = Muted, fontSize = 12.sp)
    }
}

@Composable
fun QueueScreen(state: AppState, onSettings: () -> Unit) {
    val queue by state.queue.collectAsStateWithLifecycle()
    val local by state.local.collectAsStateWithLifecycle()
    val serverOk by state.serverOk.collectAsStateWithLifecycle()
    val modelReady by state.modelReady.collectAsStateWithLifecycle()
    val modelProgress by state.modelProgress.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(20.dp, 16.dp, 12.dp, 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Listen queue", fontSize = 28.sp, fontWeight = FontWeight.Bold)
                Text(when (serverOk) { true -> "Synced with ${state.settings.serverUrl.removePrefix("https://").removePrefix("http://")}"; false -> "Server unreachable"; null -> "Not connected" }, color = if (serverOk == false) Color(0xFFB91C1C) else Muted, fontSize = 13.sp)
            }
            IconButton(onClick = { state.refresh() }) { Icon(Icons.Default.Refresh, "Refresh") }
            IconButton(onClick = onSettings) { Icon(Icons.Default.Settings, "Settings") }
        }
        if (!modelReady) {
            Card(Modifier.padding(16.dp, 4.dp).fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color(0xFFFEF3C7))) {
                Column(Modifier.padding(14.dp)) {
                    Text("Whisper model not downloaded", fontWeight = FontWeight.SemiBold)
                    Text("Needed to transcribe episodes and your questions on-device.", fontSize = 13.sp, color = Muted)
                    Spacer(Modifier.height(8.dp))
                    if (modelProgress != null) LinearProgressIndicator(progress = { modelProgress ?: 0f }, modifier = Modifier.fillMaxWidth())
                    else Button(onClick = { state.ensureModel() }) { Text("Download ${state.settings.model}") }
                }
            }
        }
        if (queue.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Nothing queued.\nAdd episodes from a feed or upload audio on the web app.", color = Muted, modifier = Modifier.padding(32.dp))
            }
        } else LazyColumn(contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 32.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(queue, key = { it.id }) { item -> QueueRow(item, local[item.id] ?: ItemLocal(), state) }
        }
    }
}

@Composable
private fun QueueRow(item: QueueItem, l: ItemLocal, state: AppState) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color.White), border = androidx.compose.foundation.BorderStroke(1.dp, Line)) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)).background(if (item.source == "upload") Color(0xFF7C3AED) else Blue), contentAlignment = Alignment.Center) {
                    Icon(if (item.source == "upload") Icons.Default.UploadFile else Icons.Default.Podcasts, null, tint = Color.White)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(item.title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(listOfNotNull(item.feedTitle, item.durationMs?.mmss()).joinToString(" · ").ifBlank { item.source }, color = Muted, fontSize = 12.sp)
                }
            }
            Spacer(Modifier.height(10.dp))
            val badge = when (l.state) {
                LocalState.NOT_DOWNLOADED -> "Not downloaded" to Muted
                LocalState.DOWNLOADING -> "Downloading ${(l.progress * 100).toInt()}%" to Blue
                LocalState.DOWNLOADED -> "Downloaded" to Color(0xFF0E7490)
                LocalState.TRANSCRIBING -> "Transcribing ${(l.progress * 100).toInt()}%" to Color(0xFFB45309)
                LocalState.READY -> (if (l.transcript?.synced == true) "Transcribed · synced" else "Transcribed") to Color(0xFF15803D)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(badge.first, color = badge.second, fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                when (l.state) {
                    LocalState.NOT_DOWNLOADED, LocalState.DOWNLOADED -> TextButton(onClick = { state.prepare(item) }) { Text(if (l.state == LocalState.NOT_DOWNLOADED) "Download + transcribe" else "Transcribe") }
                    LocalState.READY -> TextButton(onClick = { state.delete(item) }) { Text("Clear local") }
                    else -> {}
                }
                Button(onClick = { state.open(item) }, contentPadding = PaddingValues(14.dp, 6.dp)) { Icon(Icons.Default.PlayArrow, null); Text("Listen") }
            }
            if (l.state == LocalState.DOWNLOADING || l.state == LocalState.TRANSCRIBING) {
                Spacer(Modifier.height(6.dp)); LinearProgressIndicator(progress = { l.progress }, modifier = Modifier.fillMaxWidth())
            }
            l.transcript?.let { t ->
                Text("${t.segments.size} segments · ${t.engine} · ${t.processingMs / 1000}s", color = Muted, fontSize = 12.sp)
            }
            l.error?.let { Text(it, color = Color(0xFFB91C1C), fontSize = 12.sp) }
        }
    }
}

@Composable
fun PlayerScreen(state: AppState) {
    val p by state.player.collectAsStateWithLifecycle()
    val local by state.local.collectAsStateWithLifecycle()
    val busy by state.busy.collectAsStateWithLifecycle()
    val item = p.item ?: return
    val transcript = local[item.id]?.transcript
    var typed by remember { mutableStateOf("") }
    var showTyped by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(8.dp, 8.dp, 16.dp, 0.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { state.closePlayer() }) { Icon(Icons.Default.ArrowBack, "Back") }
            Text("Now playing", color = Muted, fontSize = 13.sp)
        }
        Column(Modifier.padding(20.dp, 4.dp)) {
            Text(item.title, fontSize = 20.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(item.feedTitle ?: item.source, color = Muted, fontSize = 13.sp)
        }
        // Current transcript line
        val current = transcript?.segments?.lastOrNull { it.startMs <= p.positionMs }
        Box(Modifier.padding(20.dp, 10.dp).fillMaxWidth().heightIn(min = 56.dp).clip(RoundedCornerShape(12.dp)).background(Color.White).padding(12.dp)) {
            Text(current?.text ?: (if (transcript == null) "No on-device transcript yet. Download + transcribe from the queue for better answers." else "…"), fontSize = 15.sp, color = if (current == null) Muted else Ink)
        }
        // Transport
        val dur = p.durationMs.coerceAtLeast(1)
        Slider(value = (p.positionMs.toFloat() / dur).coerceIn(0f, 1f), onValueChange = { state.seekTo((it * dur).toLong()) }, modifier = Modifier.padding(horizontal = 16.dp))
        Row(Modifier.fillMaxWidth().padding(horizontal = 24.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(p.positionMs.mmss(), color = Muted, fontSize = 12.sp); Text(p.durationMs.mmss(), color = Muted, fontSize = 12.sp)
        }
        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { state.seekBy(-15_000) }) { Icon(Icons.Default.Replay10, "Back 15s", Modifier.size(32.dp)) }
            Spacer(Modifier.width(20.dp))
            FilledIconButton(onClick = { state.togglePlay() }, modifier = Modifier.size(64.dp)) { Icon(if (p.playing) Icons.Default.Pause else Icons.Default.PlayArrow, "Play/Pause", Modifier.size(36.dp)) }
            Spacer(Modifier.width(20.dp))
            IconButton(onClick = { state.seekBy(30_000) }) { Icon(Icons.Default.Forward30, "Forward 30s", Modifier.size(32.dp)) }
        }
        // Ask
        val listening = p.phase is TalkCompanion.Phase.Listening
        Column(Modifier.fillMaxWidth().padding(20.dp, 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Button(
                onClick = { if (listening) state.stopListening() else state.ask() },
                enabled = !busy || listening,
                colors = ButtonDefaults.buttonColors(containerColor = if (listening) Color(0xFFDC2626) else Blue),
                modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(26.dp),
            ) {
                Icon(if (listening) Icons.Default.Stop else Icons.Default.Mic, null); Spacer(Modifier.width(8.dp))
                Text(if (listening) "Done talking" else if (busy) p.phase.label.ifBlank { "Working…" } else "Ask or comment", fontSize = 16.sp)
            }
            if (listening) {
                Spacer(Modifier.height(8.dp))
                Box(Modifier.size((24 + (p.micLevel * 600).coerceAtMost(40f)).dp).clip(CircleShape).background(Color(0xFFDC2626).copy(alpha = 0.6f)))
            } else if (busy) { Spacer(Modifier.height(8.dp)); LinearProgressIndicator(Modifier.fillMaxWidth(0.6f)) }
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(onClick = { showTyped = !showTyped }, enabled = !busy) { Text("Type instead") }
                TextButton(onClick = { state.ask(clip = state.companion.sampleClip()) }, enabled = !busy) { Text("Mic pipeline self-test") }
            }
            if (showTyped) Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(typed, { typed = it }, modifier = Modifier.weight(1f), singleLine = true, placeholder = { Text("Ask about what you just heard") })
                IconButton(onClick = { if (typed.isNotBlank()) { state.ask(typed = typed); typed = "" } }, enabled = !busy) { Icon(Icons.Default.Send, "Send") }
            }
            p.error?.let { Text(it, color = Color(0xFFB91C1C), fontSize = 12.sp) }
        }
        // Conversation
        LazyColumn(Modifier.fillMaxWidth().weight(1f), contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp), reverseLayout = true) {
            items(p.turns.reversed()) { t -> TurnBubble(t) }
            if (p.lastQuestionRaw != null) item {
                Text(buildString {
                    append("heard: \"${p.lastQuestionRaw}\"")
                    append(" · Clear: ${if (p.lastEnhanced == true) "on" else "bypassed"}")
                    if (p.lastFillers > 0) append(" · ${p.lastFillers} filler${if (p.lastFillers > 1) "s" else ""} removed")
                }, color = Muted, fontSize = 11.sp)
            }
            if (p.turns.isEmpty()) item { Text("Interrupt any time. Your questions and the replies are kept with the moment in the episode they were about, and synced to the server.", color = Muted, fontSize = 13.sp) }
        }
    }
}

@Composable
private fun TurnBubble(t: Turn) {
    val user = t.role == "user"
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (user) Arrangement.End else Arrangement.Start) {
        Column(Modifier.widthIn(max = 320.dp).clip(RoundedCornerShape(14.dp)).background(if (user) Blue else Color.White).padding(12.dp, 8.dp)) {
            Text(t.text, color = if (user) Color.White else Ink, fontSize = 15.sp)
            Text(buildString {
                append("at ${t.audioPositionMs.mmss()}")
                if (t.segmentStartMs != null && t.segmentEndMs != null) append(" · about ${t.segmentStartMs.mmss()}–${t.segmentEndMs.mmss()}")
                t.engine?.let { append(" · $it") }
            }, color = if (user) Color.White.copy(alpha = 0.8f) else Muted, fontSize = 11.sp)
        }
    }
}
