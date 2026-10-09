package dev.podtalk.audio

import dev.podtalk.data.QueueItem
import dev.podtalk.data.Store
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import kotlin.coroutines.coroutineContext

/** Streams an episode to app storage with progress. */
class Downloader(private val http: OkHttpClient, private val store: Store) {
    suspend fun download(item: QueueItem, onProgress: (Float) -> Unit): File = withContext(Dispatchers.IO) {
        val dest = store.audioFile(item)
        if (dest.exists() && dest.length() > 0) return@withContext dest
        val part = store.partFile(item)
        val req = Request.Builder().url(item.audioUrl).header("User-Agent", "PodTalk/0.1 (Android)").build()
        http.newCall(req).execute().use { r ->
            if (!r.isSuccessful) throw IllegalStateException("download failed: HTTP ${r.code}")
            val body = r.body ?: throw IllegalStateException("empty body")
            val total = body.contentLength()
            body.byteStream().use { inp ->
                part.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    var done = 0L
                    var lastReport = 0L
                    while (true) {
                        coroutineContext.ensureActive()
                        val n = inp.read(buf); if (n < 0) break
                        out.write(buf, 0, n); done += n
                        if (total > 0 && done - lastReport > total / 100) { lastReport = done; onProgress(done.toFloat() / total) }
                    }
                }
            }
        }
        if (!part.renameTo(dest)) throw IllegalStateException("rename failed")
        onProgress(1f)
        dest
    }
}
