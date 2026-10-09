package dev.podtalk.audio

import android.util.Log
import dev.podtalk.data.QueueItem
import dev.podtalk.data.Store
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import kotlin.coroutines.coroutineContext

/**
 * Resumable HTTP download to a `.part` file: on retry it sends `Range: bytes=<have>-` and
 * appends when the server answers 206, otherwise starts over. Up to [ATTEMPTS] tries per call.
 */
object ResumableDownload {
    const val ATTEMPTS = 3

    suspend fun fetch(http: OkHttpClient, url: String, part: File, dest: File, userAgent: String? = null, onProgress: (Float) -> Unit): File {
        var lastError: Exception? = null
        for (attempt in 1..ATTEMPTS) {
            coroutineContext.ensureActive()
            try {
                stream(http, url, part, userAgent, onProgress)
                if (!part.renameTo(dest)) throw IOException("could not move ${part.name} into place")
                onProgress(1f)
                return dest
            } catch (e: IOException) {
                lastError = e
                Log.w("Download", "attempt $attempt/$ATTEMPTS failed for $url: $e")
                if (attempt < ATTEMPTS) delay(1500L * attempt)
            }
        }
        throw lastError ?: IOException("download failed")
    }

    private suspend fun stream(http: OkHttpClient, url: String, part: File, userAgent: String?, onProgress: (Float) -> Unit) {
        val have = if (part.exists()) part.length() else 0L
        val b = Request.Builder().url(url)
        userAgent?.let { b.header("User-Agent", it) }
        if (have > 0) b.header("Range", "bytes=$have-")
        http.newCall(b.build()).execute().use { r ->
            val resume = r.code == 206 && have > 0
            if (!r.isSuccessful) throw IOException("HTTP ${r.code}")
            val body = r.body ?: throw IOException("empty body")
            val total = if (resume) have + body.contentLength() else body.contentLength()
            var done = if (resume) have else 0L
            body.byteStream().use { inp ->
                FileOutputStream(part, resume).use { out ->
                    val buf = ByteArray(128 * 1024)
                    var lastReport = done
                    while (true) {
                        coroutineContext.ensureActive()
                        val n = inp.read(buf); if (n < 0) break
                        out.write(buf, 0, n); done += n
                        if (total > 0 && done - lastReport >= total / 100) { lastReport = done; onProgress((done.toFloat() / total).coerceAtMost(0.999f)) }
                    }
                }
            }
            if (total > 0 && done < total) throw IOException("connection closed at $done of $total bytes")
        }
    }
}

/** Streams an episode to app storage with progress. */
class Downloader(private val http: OkHttpClient, private val store: Store) {
    suspend fun download(item: QueueItem, onProgress: (Float) -> Unit): File = withContext(Dispatchers.IO) {
        val dest = store.audioFile(item)
        if (dest.exists() && dest.length() > 0) return@withContext dest
        ResumableDownload.fetch(http, item.audioUrl, store.partFile(item), dest, "PodTalk/0.1 (Android)", onProgress)
    }
}
