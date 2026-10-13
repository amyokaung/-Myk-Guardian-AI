package com.myk.guardianai.accessibility

import android.content.Intent
import android.net.Uri
import android.content.ComponentName
import android.media.AudioManager
import android.view.KeyEvent
import android.provider.Settings
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSObject
import com.getcapacitor.JSArray
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

// IMPORTANT: This name must match registerPlugin('MykAccessibility') in src/main.ts
// and src/native-actions.ts.
@CapacitorPlugin(name = "MykAccessibility")
class AccessibilityBridgePlugin : Plugin() {
    @PluginMethod
    fun getStatus(call: PluginCall) {
        val result = JSObject()
        val enabledServices = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
        val expectedService = ComponentName(context, MyAccessibilityService::class.java)
        val enabledInSettings = enabledServices.split(':').any { entry ->
            val component = ComponentName.unflattenFromString(entry.trim())
            component != null && component.packageName == expectedService.packageName &&
                component.className == expectedService.className
        }
        val connected = MyAccessibilityService.instance() != null
        result.put("accessibilityEnabled", enabledInSettings)
        result.put("serviceConnected", connected)
        val enabledListeners = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners").orEmpty()
        val expectedListener = ComponentName(context, MyNotificationListenerService::class.java)
        val notificationAccessEnabled = enabledListeners.split(':').any { entry ->
            val component = ComponentName.unflattenFromString(entry.trim())
            component != null && component.packageName == expectedListener.packageName &&
                component.className == expectedListener.className
        }
        result.put("notificationEnabled", notificationAccessEnabled)
        val microphoneGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val locationGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            (context.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
             context.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED)
        result.put("microphoneGranted", microphoneGranted)
        result.put("locationGranted", locationGranted)
        call.resolve(result)
    }

    @PluginMethod
    fun openAccessibilitySettings(call: PluginCall) {
        openSettings(call, Settings.ACTION_ACCESSIBILITY_SETTINGS)
    }

    @PluginMethod
    fun openNotificationSettings(call: PluginCall) {
        openSettings(call, Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
    }

    @PluginMethod
    fun getRecentNotifications(call: PluginCall) {
        val result = JSObject()
        val items = JSArray()
        MyNotificationListenerService.snapshot().take(20).forEach { item ->
            val row = JSObject()
            row.put("packageName", item.packageName)
            row.put("title", item.title)
            row.put("text", item.text)
            row.put("postTime", item.postTime)
            items.put(row)
        }
        result.put("notifications", items)
        call.resolve(result)
    }

    private fun openSettings(call: PluginCall, action: String, extra: String? = null, value: String? = null) {
        try {
            val intent = Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (extra != null && value != null) intent.putExtra(extra, value)
            context.startActivity(intent)
            call.resolve()
        } catch (error: Exception) {
            call.reject("Could not open Android settings: ${error.message}", error)
        }
    }

    @PluginMethod
    fun back(call: PluginCall) {
        val service = MyAccessibilityService.instance()
        if (service == null) {
            call.reject("Accessibility service is not enabled. Enable Myk Guardian AI in Android Accessibility settings.")
            return
        }
        try {
            if (!performBackWithFallback(service)) {
                call.reject("Android က Back action ကို လက်မခံပါ။ Accessibility Service ကို Off/On ပြန်လုပ်ပါ။")
                return
            }
            val result = JSObject()
            result.put("success", true)
            result.put("message", "Myk ကို နောက်ခံသို့ ရွှေ့ပြီး ယခင် App ပေါ်တွင် Back action လုပ်ပါမည်။")
            call.resolve(result)
        } catch (error: Exception) {
            call.reject("Back action မအောင်မြင်ပါ: ${error.message}", error)
        }
    }

    /**
     * The Back button lives inside Myk, so dispatching GLOBAL_ACTION_BACK before
     * leaving Myk only navigates Myk itself. Background Myk first, then dispatch
     * Back again after the previous app has become foreground.
     */
    private fun performBackWithFallback(service: MyAccessibilityService): Boolean {
        val hostActivity = activity
        Handler(Looper.getMainLooper()).post {
            if (!hostActivity.isFinishing && !hostActivity.isDestroyed) {
                hostActivity.moveTaskToBack(true)
                Handler(Looper.getMainLooper()).postDelayed({
                    MyAccessibilityService.instance()?.back()
                }, 250L)
            } else {
                service.back()
            }
        }
        return true
    }

    @PluginMethod
    fun home(call: PluginCall) = runAccessibilityAction(call, "Home") { it.home() }

    @PluginMethod
    fun clickText(call: PluginCall) {
        val text = call.getString("text")?.trim()
        if (text.isNullOrEmpty()) {
            call.reject("A non-empty text value is required.")
            return
        }
        val exact = call.getBoolean("exact", false) ?: false
        val service = MyAccessibilityService.instance()
        if (service == null) {
            call.reject("Accessibility service is not enabled. Enable Myk Guardian AI in Android Accessibility settings.")
            return
        }
        try {
            val clicked = service.clickText(text, exact)
            if (clicked) {
                val result = JSObject()
                result.put("success", true)
                call.resolve(result)
            } else call.reject("No visible clickable element matched: $text")
        } catch (error: Exception) {
            call.reject("Text click failed: ${error.message}", error)
        }
    }

    @PluginMethod
    fun launchApp(call: PluginCall) {
        val requested = call.getString("app")?.trim().orEmpty()
        if (requested.isEmpty()) {
            call.reject("A non-empty app name is required.")
            return
        }
        try {
            val pm = context.packageManager
            val apps = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getInstalledApplications(PackageManager.ApplicationInfoFlags.of(0L))
            } else {
                @Suppress("DEPRECATION")
                pm.getInstalledApplications(0)
            }
            val match = apps.firstOrNull { info ->
                val label = pm.getApplicationLabel(info).toString()
                label.equals(requested, ignoreCase = true) ||
                    label.contains(requested, ignoreCase = true)
            } ?: run {
                call.reject("မတွေ့သော App: $requested")
                return
            }
            val intent = pm.getLaunchIntentForPackage(match.packageName)
            if (intent == null) {
                call.reject("ဒီ App ကို ဖွင့်ရန် launch intent မရှိပါ။")
                return
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            val result = JSObject()
            result.put("success", true)
            result.put("message", "${pm.getApplicationLabel(match)} ကို ဖွင့်လိုက်ပါပြီ။")
            call.resolve(result)
        } catch (error: Exception) {
            call.reject("App ဖွင့်မရပါ: ${error.message}", error)
        }
    }

    @PluginMethod
    fun performAction(call: PluginCall) {
        val action = call.getString("action")?.trim().orEmpty()
        try {
            val message = when (action) {
                "back" -> {
                    val service = MyAccessibilityService.instance()
                        ?: throw IllegalStateException("Accessibility permission ကို Android Settings မှာ ဖွင့်ပါ။")
                    if (!performBackWithFallback(service)) throw IllegalStateException("Android က Back action ကို မလုပ်ဆောင်နိုင်ပါ။")
                    "Back action ပို့ပြီးပါပြီ။ App မပြောင်းပါက Myk ကို နောက်ခံသို့ ရွှေ့ပေးပါမည်။"
                }
                "home" -> {
                    val service = MyAccessibilityService.instance()
                        ?: throw IllegalStateException("Accessibility permission ကို Android Settings မှာ ဖွင့်ပါ။")
                    if (!service.home()) throw IllegalStateException("Android က Home action ကို မလုပ်ဆောင်နိုင်ပါ။")
                    "Home action လုပ်ပြီးပါပြီ။"
                }
                "mediaNext" -> sendMediaKey(KeyEvent.KEYCODE_MEDIA_NEXT)
                "mediaPrevious" -> sendMediaKey(KeyEvent.KEYCODE_MEDIA_PREVIOUS)
                "mediaPlayPause" -> sendMediaKey(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
                "searchYouTube" -> {
                    val query = call.getString("text")?.trim().orEmpty()
                    if (query.isEmpty()) throw IllegalArgumentException("ရှာဖွေမည့် သီချင်းအမည်နှင့် အဆိုတော်ကို ပေးပါ။")
                    val url = "https://www.youtube.com/results?search_query=" + Uri.encode(query)
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(intent)
                    "YouTube မှာ “$query” ကို ရှာဖွေထားတဲ့ ရလဒ်စာမျက်နှာကို ဖွင့်လိုက်ပါပြီ။ သီချင်းဖွင့်ရန် မှန်ကန်တဲ့ရလဒ်ကို ရွေးပါ။"
                }
                "volumeUp" -> changeVolume(AudioManager.ADJUST_RAISE)
                "volumeDown" -> changeVolume(AudioManager.ADJUST_LOWER)
                "openSettings" -> {
                    context.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    "Android Settings ကို ဖွင့်လိုက်ပါပြီ။"
                }
                "clickText" -> {
                    val text = call.getString("text")?.trim().orEmpty()
                    if (text.isEmpty()) throw IllegalArgumentException("နှိပ်မည့် စာသား မပါပါ။")
                    val service = MyAccessibilityService.instance() ?: throw IllegalStateException("Accessibility permission ကို Android Settings မှာ ဖွင့်ပါ။")
                    val exact = call.getBoolean("exact", false) ?: false
                    if (!service.clickText(text, exact)) throw IllegalStateException("မျက်နှာပြင်ပေါ်မှာ နှိပ်နိုင်တဲ့ စာသား မတွေ့ပါ: $text")
                    "$text ကို နှိပ်ပြီးပါပြီ။"
                }
                else -> throw IllegalArgumentException("မပံ့ပိုးသော Android action: $action")
            }
            val result = JSObject()
            result.put("success", true)
            result.put("message", message)
            call.resolve(result)
        } catch (error: Exception) {
            call.reject(error.message ?: "Android action မအောင်မြင်ပါ။", error)
        }
    }

    private fun sendMediaKey(keyCode: Int): String {
        val audio = context.getSystemService(AudioManager::class.java)
        val down = KeyEvent(KeyEvent.ACTION_DOWN, keyCode)
        val up = KeyEvent(KeyEvent.ACTION_UP, keyCode)
        audio.dispatchMediaKeyEvent(down)
        audio.dispatchMediaKeyEvent(up)
        return "Media action ပို့ပြီးပါပြီ။ Player က လက်ခံမှသာ သီချင်းပြောင်းပါမည်။"
    }

    private fun changeVolume(direction: Int): String {
        val audio = context.getSystemService(AudioManager::class.java)
        audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI)
        return "အသံအတိုးအကျယ် ပြောင်းပြီးပါပြီ။"
    }

    private inline fun runAccessibilityAction(call: PluginCall, label: String, action: (MyAccessibilityService) -> Boolean) {
        val service = MyAccessibilityService.instance()
        if (service == null) {
            call.reject("Accessibility service is not enabled. Enable Myk Guardian AI in Android Accessibility settings.")
            return
        }
        try {
            if (action(service)) {
                val result = JSObject()
                result.put("success", true)
                result.put("message", "$label action လုပ်ပြီးပါပြီ။")
                call.resolve(result)
            } else call.reject("Android က $label action ကို မလုပ်ဆောင်နိုင်ပါ။")
        } catch (error: Exception) {
            call.reject("$label action failed: ${error.message}", error)
        }
    }
}
