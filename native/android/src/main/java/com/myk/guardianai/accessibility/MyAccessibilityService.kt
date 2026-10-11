package com.myk.guardianai.accessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.lang.ref.WeakReference

/**
 * User-enabled accessibility bridge for explicit screen actions requested by the app.
 * Android requires the user to enable this service in system Accessibility settings.
 */
class MyAccessibilityService : AccessibilityService() {
    override fun onServiceConnected() {
        super.onServiceConnected()
        activeService = WeakReference(this)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit

    override fun onDestroy() {
        if (activeService?.get() === this) activeService = null
        super.onDestroy()
    }

    fun back(): Boolean = performGlobalAction(GLOBAL_ACTION_BACK)
    fun home(): Boolean = performGlobalAction(GLOBAL_ACTION_HOME)

    fun clickText(searchText: String, exact: Boolean): Boolean {
        val root = rootInActiveWindow ?: return false
        return try {
            val candidates = root.findAccessibilityNodeInfosByText(searchText).orEmpty()
            val target = candidates.firstOrNull { node ->
                val text = node.text?.toString()
                val description = node.contentDescription?.toString()
                val matches = listOfNotNull(text, description).any {
                    if (exact) it.equals(searchText, ignoreCase = true)
                    else it.contains(searchText, ignoreCase = true)
                }
                matches && node.isVisibleToUser && node.isEnabled
            } ?: return false
            clickNodeOrParent(target)
        } finally {
            root.recycleSafely()
        }
    }

    private fun clickNodeOrParent(node: AccessibilityNodeInfo): Boolean {
        var current: AccessibilityNodeInfo? = AccessibilityNodeInfo.obtain(node)
        try {
            repeat(8) {
                val item = current ?: return false
                if (item.isClickable && item.isEnabled) {
                    return item.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                }
                val parent = item.parent
                item.recycleSafely()
                current = parent
            }
            return false
        } finally {
            current?.recycleSafely()
        }
    }

    private fun AccessibilityNodeInfo.recycleSafely() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            @Suppress("DEPRECATION")
            recycle()
        }
    }

    companion object {
        @Volatile private var activeService: WeakReference<MyAccessibilityService>? = null
        fun instance(): MyAccessibilityService? = activeService?.get()
    }
}
