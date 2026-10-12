package com.myk.guardianai.accessibility

import android.content.Intent
import android.content.ComponentName
import android.media.AudioManager
import android.view.KeyEvent
import android.provider.Settings
import android.content.pm.PackageManager
import android.app.NotificationManager
import android.os.Build
import com.getcapacitor.JSObject
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
        val expectedService = ComponentName(context, MyAccessibilityService::class.java).flattenToString()
        val enabledInSettings = enabledServices.split(':').any { it.equals(expectedService, ignoreCase = true) }
        result.put("accessibilityEnabled", enabledInSettings)
        result.put("serviceConnected", MyAccessibilityService.instance() != null)
        val notificationsEnabled = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()
        } else true
        result.put("notificationEnabled", notificationsEnabled)
        call.resolve(result)
    }

    @PluginMethod
    fun openAccessibilitySettings(call: PluginCall) {
        openSettings(call, Settings.ACTION_ACCESSIBILITY_SETTINGS)
    }

    @PluginMethod
    fun openNotificationSettings(call: PluginCall) {
        openSettings(call, Settings.ACTION_APP_NOTIFICATION_SETTINGS, "android.provider.extra.APP_PACKAGE", context.packageName)
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
    fun back(call: PluginCall) = runAccessibilityAction(call, "Back") { it.back() }

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
                    if (!service.back()) throw IllegalStateException("Android က Back action ကို မလုပ်ဆောင်နိုင်ပါ။")
                    "Back action လုပ်ပြီးပါပြီ။"
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
