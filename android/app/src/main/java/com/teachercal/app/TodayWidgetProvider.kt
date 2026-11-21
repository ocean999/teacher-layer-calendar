package com.teachercal.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import org.json.JSONObject

class TodayWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        refreshAll(context, appWidgetManager, appWidgetIds)
    }

    companion object {
        fun refreshAll(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
            val prefs = context.getSharedPreferences("teacher_layer_cal", Context.MODE_PRIVATE)
            val raw = prefs.getString("widget_summary", "") ?: ""
            var header = "今日课表与干活"
            val lines = StringBuilder()

            if (raw.isNotEmpty()) {
                try {
                    val obj = JSONObject(raw)
                    val date = obj.optString("date", "")
                    if (date.isNotEmpty()) header = "双图层日历 · $date"
                    val arr = obj.optJSONArray("items")
                    if (arr != null && arr.length() > 0) {
                        val max = minOf(arr.length(), 7)
                        for (i in 0 until max) {
                            val it = arr.getJSONObject(i)
                            val tag = if (it.optString("kind") == "course") "📚" else "📌"
                            lines.append("$tag ${it.optString("start")}-${it.optString("end")}  ${it.optString("title")}\n")
                        }
                    } else {
                        lines.append("今日暂无排课或待办，点击打开添加")
                    }
                } catch (_: Exception) {
                    lines.append("点击打开双图层日历")
                }
            } else {
                lines.append("点击打开双图层日历并同步坚果云")
            }

            val intent = Intent(context, MainActivity::class.java)
            val pi = PendingIntent.getActivity(
                context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            for (id in appWidgetIds) {
                val views = RemoteViews(context.packageName, R.layout.widget_today)
                views.setTextViewText(R.id.widget_title, header)
                views.setTextViewText(R.id.widget_body, lines.toString().trim())
                views.setOnClickPendingIntent(R.id.widget_root, pi)
                manager.updateAppWidget(id, views)
            }
        }
    }
}
