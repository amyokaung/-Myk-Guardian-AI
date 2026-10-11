package com.myk.guardianai.accessibility

import android.content.Intent
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "AccessibilityBridge")
class AccessibilityBridgePlugin : Plugin() {
    @PluginMethod
    fun isEnabled(call: PluginCall) {
        val result = JSObject()
        result.put("enabled", MyAccessibilityService.instance() != null)
        call.resolve(result)
    }

    @PluginMethod
    fun openAccessibilitySettings(call: PluginCall) {
        try {
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve()
        } catch (error: Exception) {
            call.reject("Could not open Accessibility settings: ${error.message}", error)
        }
    }

    @PluginMethod
    fun back(call: PluginCall) = runAction(call, "Back") { it.back() }

    @PluginMethod
    fun home(call: PluginCall) = runAction(call, "Home") { it.home() }

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
            val result = JSObject()
            result.put("success", clicked)
            if (clicked) call.resolve(result)
            else call.reject("No visible clickable element matched: $text")
        } catch (error: Exception) {
            call.reject("Text click failed: ${error.message}", error)
        }
    }

    private inline fun runAction(call: PluginCall, label: String, action: (MyAccessibilityService) -> Boolean) {
        val service = MyAccessibilityService.instance()
        if (service == null) {
            call.reject("Accessibility service is not enabled. Enable Myk Guardian AI in Android Accessibility settings.")
            return
        }
        try {
            if (action(service)) {
                val result = JSObject()
                result.put("success", true)
                call.resolve(result)
            } else call.reject("Android did not perform the $label action.")
        } catch (error: Exception) {
            call.reject("$label action failed: ${error.message}", error)
        }
    }
}
