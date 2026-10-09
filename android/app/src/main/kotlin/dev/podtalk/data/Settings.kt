package dev.podtalk.data

import android.content.Context
import dev.podtalk.BuildConfig

class Settings(ctx: Context) {
    private val p = ctx.getSharedPreferences("podtalk", Context.MODE_PRIVATE)
    var serverUrl: String
        get() = p.getString("server", BuildConfig.DEFAULT_SERVER) ?: BuildConfig.DEFAULT_SERVER
        set(v) = p.edit().putString("server", v.trim()).apply()
    var token: String
        get() = p.getString("token", "") ?: ""
        set(v) = p.edit().putString("token", v.trim()).apply()
    var model: String
        get() = p.getString("model", "tiny.en") ?: "tiny.en"
        set(v) = p.edit().putString("model", v).apply()
    val configured: Boolean get() = token.isNotBlank() && serverUrl.isNotBlank()
}
