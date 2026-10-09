package dev.podtalk

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import dev.podtalk.ui.PodTalkApp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // RECORD_AUDIO is requested when the listener first taps Ask (see PlayerScreen), where a denial can be explained.
        val state = AppState.get(this)
        setContent { PodTalkApp(state) }
    }
}
