package com.myk.guardianai.accessibility

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.os.Build
import java.util.concurrent.CopyOnWriteArrayList

/** Runs only after the owner explicitly grants Android Notification Access. */
class MyNotificationListenerService : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        val extras = sbn.notification.extras
        val title = extras.getCharSequence("android.title")?.toString().orEmpty()
        val text = (extras.getCharSequence("android.text") ?: extras.getCharSequence("android.bigText"))?.toString().orEmpty()
        if (title.isBlank() && text.isBlank()) return
        val item = NotificationItem(sbn.packageName, title, text, sbn.postTime)
        synchronized(recent) {
            recent.removeAll { it.packageName == item.packageName && it.title == item.title && it.text == item.text }
            recent.add(0, item)
            while (recent.size > 30) recent.removeAt(recent.lastIndex)
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) = Unit

    data class NotificationItem(val packageName: String, val title: String, val text: String, val postTime: Long)

    companion object {
        private val recent = CopyOnWriteArrayList<NotificationItem>()
        fun snapshot(): List<NotificationItem> = synchronized(recent) { recent.toList() }
    }
}
