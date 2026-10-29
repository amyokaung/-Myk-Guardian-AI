package com.myk.guardianai.accessibility

import android.app.Service
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Small user-controlled overlay. It never takes focus from the foreground app;
 * tapping the bubble expands the panel, and the chat button is an explicit action.
 */
class FloatingWidgetService : Service() {
    private var windowManager: WindowManager? = null
    private var bubble: TextView? = null
    private var panel: LinearLayout? = null
    private var statusText: TextView? = null
    private var params: WindowManager.LayoutParams? = null
    private var expanded = false

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_HIDE) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (!Settings.canDrawOverlays(this)) {
            getSharedPreferences(VedariWakeService.PREFS, MODE_PRIVATE).edit()
                .putString(VedariWakeService.LAST_STATUS, "Overlay ခွင့်ပြုချက်လိုအပ်သည်")
                .putString(VedariWakeService.LAST_DETAIL, "Android Settings > Display over other apps မှ AMARA AI ကို ခွင့်ပြုပါ။")
                .putLong(VedariWakeService.LAST_EVENT_AT, System.currentTimeMillis()).apply()
            stopSelf()
            return START_NOT_STICKY
        }
        val incomingStatus = intent?.getStringExtra(EXTRA_STATUS)
        val incomingDetail = intent?.getStringExtra(EXTRA_DETAIL)
        if (bubble == null) createOverlay()
        if (!incomingStatus.isNullOrBlank()) updateStatus(incomingStatus, incomingDetail.orEmpty())
        return START_STICKY
    }

    private fun createOverlay() {
        val wm = windowManager ?: return
        val overlayType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE
        params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            x = dp(12)
            y = dp(160)
        }

        bubble = TextView(this).apply {
            text = "A"
            textSize = 20f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setBackgroundColor(Color.rgb(94, 53, 177))
            elevation = dp(8).toFloat()
            contentDescription = "AMARA AI floating assistant"
            setOnClickListener { togglePanel() }
            setOnTouchListener(object : View.OnTouchListener {
                private var downX = 0f
                private var downY = 0f
                private var startX = 0
                private var startY = 0
                private var dragged = false
                override fun onTouch(v: View, event: MotionEvent): Boolean {
                    val p = params ?: return false
                    when (event.action) {
                        MotionEvent.ACTION_DOWN -> {
                            downX = event.rawX; downY = event.rawY
                            startX = p.x; startY = p.y; dragged = false
                            return true
                        }
                        MotionEvent.ACTION_MOVE -> {
                            val dx = (event.rawX - downX).toInt()
                            val dy = (event.rawY - downY).toInt()
                            if (kotlin.math.abs(dx) > dp(5) || kotlin.math.abs(dy) > dp(5)) dragged = true
                            if (dragged) {
                                p.x = (startX - dx).coerceAtLeast(0)
                                p.y = (startY + dy).coerceAtLeast(0)
                                try { wm.updateViewLayout(bubble, p) } catch (_: Exception) {}
                            }
                            return true
                        }
                        MotionEvent.ACTION_UP -> {
                            if (!dragged) v.performClick()
                            return true
                        }
                    }
                    return false
                }
            })
        }
        val size = dp(52)
        bubble?.layoutParams = LinearLayout.LayoutParams(size, size)
        try { wm.addView(bubble, params) } catch (_: Exception) { bubble = null; stopSelf(); return }

        panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(12))
            setBackgroundColor(Color.rgb(29, 25, 43))
            elevation = dp(10).toFloat()
            visibility = View.GONE
        }
        val title = TextView(this).apply {
            text = "AMARA AI"
            textSize = 16f
            setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
        }
        statusText = TextView(this).apply {
            text = "အမရာ အသင့်ရှိပါတယ်။"
            textSize = 13f
            setTextColor(Color.WHITE)
            setPadding(0, dp(8), 0, dp(8))
        }
        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val chat = Button(this).apply {
            text = "Chat ဖွင့်ရန်"
            setOnClickListener {
                val launch = packageManager.getLaunchIntentForPackage(packageName)
                if (launch != null) {
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    launch.putExtra(VedariWakeService.EXTRA_WAKE_COMMAND, getSharedPreferences(VedariWakeService.PREFS, MODE_PRIVATE).getString(VedariWakeService.PENDING_COMMAND, ""))
                    startActivity(launch)
                }
            }
        }
        val hide = Button(this).apply { text = "ပိတ်"; setOnClickListener { stopSelf() } }
        buttons.addView(chat)
        buttons.addView(hide)
        panel?.addView(title)
        panel?.addView(statusText)
        panel?.addView(buttons)
        val panelParams = WindowManager.LayoutParams(
            dp(270), WindowManager.LayoutParams.WRAP_CONTENT, overlayType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.TOP or Gravity.END; x = dp(12); y = dp(220) }
        try { wm.addView(panel, panelParams) } catch (_: Exception) { panel = null }
    }

    private fun togglePanel() {
        expanded = !expanded
        panel?.visibility = if (expanded) View.VISIBLE else View.GONE
    }

    private fun updateStatus(status: String, detail: String) {
        statusText?.text = if (detail.isBlank()) status else "$status\n$detail"
        bubble?.text = if (status.contains("အမိန့်ရရှိ") || status.contains("တုံ့ပြန်")) "…" else "A"
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        val wm = windowManager
        try { bubble?.let { wm?.removeView(it) } } catch (_: Exception) {}
        try { panel?.let { wm?.removeView(it) } } catch (_: Exception) {}
        bubble = null; panel = null; statusText = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_SHOW = "com.myk.guardianai.OVERLAY_SHOW"
        const val ACTION_HIDE = "com.myk.guardianai.OVERLAY_HIDE"
        const val EXTRA_STATUS = "overlay_status"
        const val EXTRA_DETAIL = "overlay_detail"
    }
}
