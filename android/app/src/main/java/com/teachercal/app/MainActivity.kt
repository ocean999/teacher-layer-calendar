package com.teachercal.app

import android.annotation.SuppressLint
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.graphics.Color
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import okhttp3.Credentials
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.parseColor("#0F172A")

        webView = WebView(this)
        setContentView(webView)

        val settings: WebSettings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.databaseEnabled = true

        webView.webViewClient = WebViewClient()
        webView.addJavascriptInterface(AndroidBridge(this), "AndroidBridge")
        webView.loadUrl("file:///android_asset/web/index.html")
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    inner class AndroidBridge(private val ctx: Context) {
        private val prefs = ctx.getSharedPreferences("teacher_layer_cal", Context.MODE_PRIVATE)

        @JavascriptInterface
        fun loadState(): String {
            return prefs.getString("state_json", "") ?: ""
        }

        @JavascriptInterface
        fun saveState(json: String) {
            prefs.edit().putString("state_json", json).apply()
        }

        @JavascriptInterface
        fun updateWidgetData(summaryJson: String) {
            prefs.edit().putString("widget_summary", summaryJson).apply()
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, TodayWidgetProvider::class.java))
            if (ids.isNotEmpty()) {
                TodayWidgetProvider.refreshAll(ctx, mgr, ids)
            }
        }

        @JavascriptInterface
        fun webdavRequest(
            url: String,
            method: String,
            username: String,
            password: String,
            bodyStr: String
        ): String {
            val out = JSONObject()
            try {
                val builder = Request.Builder()
                    .url(url)
                    .header("Authorization", Credentials.basic(username, password, Charsets.UTF_8))

                val upper = method.uppercase()
                if (upper == "PROPFIND") {
                    builder.header("Depth", "0")
                    builder.method("PROPFIND", "".toRequestBody("text/xml; charset=utf-8".toMediaType()))
                } else if (upper == "MKCOL") {
                    builder.method("MKCOL", null)
                } else if (upper == "PUT") {
                    builder.put(bodyStr.toRequestBody("application/json; charset=utf-8".toMediaType()))
                } else {
                    builder.get()
                }

                httpClient.newCall(builder.build()).execute().use { resp ->
                    out.put("status", resp.code)
                    out.put("body", resp.body?.string() ?: "")
                }
            } catch (e: Exception) {
                out.put("status", 0)
                out.put("error", e.message ?: "网络请求异常")
            }
            return out.toString()
        }
    }
}
