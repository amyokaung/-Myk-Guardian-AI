package com.myk.guardianai.accessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.os.Bundle
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

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null || !isScreenLearningEnabled()) return
        val now = System.currentTimeMillis()
        if (now - lastCaptureAt < 650L) return
        lastCaptureAt = now
        captureVisibleScreen()
    }

    private fun isScreenLearningEnabled(): Boolean =
        getSharedPreferences("amara_screen_learning", MODE_PRIVATE).getBoolean("enabled", false)

    private fun captureVisibleScreen() {
        val root = rootInActiveWindow ?: return
        try {
            val packageName = root.packageName?.toString().orEmpty()
            if (packageName == applicationContext.packageName) return
            val lines = mutableListOf<String>()
            collectSafeText(root, lines, 0)
            latestScreenContext = if (lines.isEmpty()) "" else
                "App: $packageName\\n" + lines.distinct().take(45).joinToString("\\n").take(4500)
            latestScreenCapturedAt = System.currentTimeMillis()
        } finally {
            root.recycleSafely()
        }
    }

    private fun collectSafeText(node: AccessibilityNodeInfo, out: MutableList<String>, depth: Int) {
        if (depth > 18 || out.size >= 60) return
        // Never collect password fields or text from explicitly sensitive input controls.
        val className = node.className?.toString().orEmpty()
        val viewId = node.viewIdResourceName.orEmpty()
        val sensitive = node.isPassword || className.contains("password", true) ||
            viewId.contains("password", true) || viewId.contains("otp", true) ||
            viewId.contains("pin", true) || viewId.contains("cvv", true)
        if (!sensitive && node.isVisibleToUser) {
            val candidates = listOfNotNull(node.text?.toString(), node.contentDescription?.toString())
            candidates.forEach { raw ->
                val value = raw.replace(Regex("\\s+"), " ").trim()
                if (value.length in 2..240 && !looksSensitive(value) && !out.contains(value)) out.add(value)
            }
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            try { collectSafeText(child, out, depth + 1) } finally { child.recycleSafely() }
        }
    }

    private fun looksSensitive(value: String): Boolean {
        val lower = value.lowercase()
        return Regex("\\b\\d{4,8}\\b").containsMatchIn(value) ||
            lower.contains("password") || lower.contains("passcode") ||
            lower.contains("one-time code") || lower.contains("verification code") ||
            lower.contains("otp") || lower.contains("cvv") ||
            lower.contains("credit card") || lower.contains("bank account")
    }

    fun readScreenContext(): String {
        if (!isScreenLearningEnabled()) return ""
        captureVisibleScreen()
        return latestScreenContext
    }
    override fun onInterrupt() = Unit

    override fun onDestroy() {
        if (activeService?.get() === this) activeService = null
        super.onDestroy()
    }

    fun activeWindowPackageName(): String? = rootInActiveWindow?.let { root -> try { root.packageName?.toString() } finally { root.recycleSafely() } }

    fun back(): Boolean = performGlobalAction(GLOBAL_ACTION_BACK)
    fun home(): Boolean = performGlobalAction(GLOBAL_ACTION_HOME)

    fun clickText(searchText: String, exact: Boolean): Boolean {
        val root = rootInActiveWindow ?: return false
        return try {
            val target = findMatchingNode(root, searchText, exact, 0) ?: return false
            try { clickNodeOrParent(target) } finally { target.recycleSafely() }
        } finally {
            root.recycleSafely()
        }
    }

    private fun findMatchingNode(node: AccessibilityNodeInfo, searchText: String, exact: Boolean, depth: Int): AccessibilityNodeInfo? {
        if (depth > 18) return null
        val labels = listOfNotNull(node.text?.toString(), node.contentDescription?.toString())
        val matches = labels.any {
            if (exact) it.equals(searchText, ignoreCase = true)
            else it.contains(searchText, ignoreCase = true)
        }
        if (matches && node.isVisibleToUser && node.isEnabled) return AccessibilityNodeInfo.obtain(node)
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = try { findMatchingNode(child, searchText, exact, depth + 1) } finally { child.recycleSafely() }
            if (found != null) return found
        }
        return null
    }

    fun setText(text: String): Boolean {
        val root = rootInActiveWindow ?: return false
        return try {
            val focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            val target = focused ?: findEditable(root)
            if (target == null) return false
            try {
                val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
                target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
            } finally {
                if (focused != null) focused.recycleSafely() else target.recycleSafely()
            }
        } finally { root.recycleSafely() }
    }

    fun clickNewNoteAction(): Boolean {
        val labels = listOf("New note", "Add note", "Create note", "New", "Create", "Compose", "Add a note", "Create new", "Start writing", "Take a note", "New memo", "မှတ်စုအသစ်", "မှတ်စုရေး", "အသစ်", "ရေးသား", "မှတ်စုထည့်")
        if (labels.any { clickText(it, exact = false) }) return true
        val root = rootInActiveWindow ?: return false
        return try { clickLikelyAddButton(root, 0) } finally { root.recycleSafely() }
    }

    private fun clickLikelyAddButton(node: AccessibilityNodeInfo, depth: Int): Boolean {
        if (depth > 16) return false
        val label = listOfNotNull(node.text?.toString(), node.contentDescription?.toString(), node.viewIdResourceName).joinToString(" ").lowercase()
        val likelyAdd = listOf("add", "new", "create", "compose", "fab", "plus", "မှတ်စုအသစ်", "မှတ်စုထည့်").any { label.contains(it) }
        if (likelyAdd && node.isClickable && node.isVisibleToUser && node.isEnabled) {
            if (node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val clicked = try { clickLikelyAddButton(child, depth + 1) } finally { child.recycleSafely() }
            if (clicked) return true
        }
        return false
    }

    fun clickFirstYouTubeResult(): Boolean {
        val root = rootInActiveWindow ?: return false
        return try {
            val candidates = mutableListOf<AccessibilityNodeInfo>()
            collectYouTubeCandidates(root, candidates, 0)
            try { candidates.firstOrNull()?.performAction(AccessibilityNodeInfo.ACTION_CLICK) ?: false }
            finally { candidates.forEach { it.recycleSafely() } }
        } finally { root.recycleSafely() }
    }

    private fun collectYouTubeCandidates(node: AccessibilityNodeInfo, out: MutableList<AccessibilityNodeInfo>, depth: Int) {
        if (depth > 14) return
        val label = listOfNotNull(node.text?.toString(), node.contentDescription?.toString()).joinToString(" ").lowercase()
        val editable = node.isEditable || node.className?.toString()?.contains("EditText", ignoreCase = true) == true
        val video = label.contains("video:") || label.contains("video ") || label.contains("ဗီဒီယို") || label.contains("play video")
        if (!editable && video && node.isClickable && node.isVisibleToUser && node.isEnabled) out.add(AccessibilityNodeInfo.obtain(node))
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            try { collectYouTubeCandidates(child, out, depth + 1) } finally { child.recycleSafely() }
        }
    }

    private fun findEditable(node: AccessibilityNodeInfo, depth: Int = 0): AccessibilityNodeInfo? {
        if (depth > 14) return null
        if (node.isEditable && node.isVisibleToUser && node.isEnabled) return AccessibilityNodeInfo.obtain(node)
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = try { findEditable(child, depth + 1) } finally { child.recycleSafely() }
            if (found != null) return found
        }
        return null
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
        @Volatile private var latestScreenContext: String = ""
        @Volatile private var latestScreenCapturedAt: Long = 0L
        @Volatile private var lastCaptureAt: Long = 0L
        fun instance(): MyAccessibilityService? = activeService?.get()
    }
}
