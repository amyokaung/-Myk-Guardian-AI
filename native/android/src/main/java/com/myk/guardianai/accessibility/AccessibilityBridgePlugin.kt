package com.myk.guardianai.accessibility

import android.content.Intent
import android.content.ContentValues
import android.provider.MediaStore
import java.io.OutputStream
import android.net.Uri
import android.content.ComponentName
import android.media.AudioManager
import android.view.KeyEvent
import android.provider.Settings
import android.content.pm.PackageManager
import android.location.Geocoder
import android.provider.AlarmClock
import java.util.Locale
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSObject
import com.getcapacitor.JSArray
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

// IMPORTANT: This name must match registerPlugin('MykAccessibility') in src/main.ts
// and src/native-actions.ts.
@CapacitorPlugin(
    name = "MykAccessibility",
    permissions = [
        Permission(alias = "media", strings = [
            android.Manifest.permission.READ_MEDIA_IMAGES,
            android.Manifest.permission.READ_MEDIA_VIDEO,
            "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
            android.Manifest.permission.READ_EXTERNAL_STORAGE
        ]),
        Permission(alias = "callLog", strings = [android.Manifest.permission.READ_CALL_LOG]),
        Permission(alias = "sms", strings = [android.Manifest.permission.READ_SMS])
    ]
)
class AccessibilityBridgePlugin : Plugin() {
    @PluginMethod
    fun saveTextFile(call: PluginCall) {
        val fileName = call.getString("fileName")?.trim().orEmpty()
        val content = call.getString("content").orEmpty()
        val mimeType = call.getString("mimeType")?.trim().orEmpty().ifBlank { "text/plain" }
        if (fileName.isBlank() || fileName.contains("/") || fileName.contains("\\\\")) {
            call.reject("ဖိုင်အမည် မမှန်ပါ။")
            return
        }
        try {
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    put(MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS)
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
            }
            val collection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                MediaStore.Downloads.EXTERNAL_CONTENT_URI
            else MediaStore.Files.getContentUri("external")
            val uri = resolver.insert(collection, values)
                ?: throw IllegalStateException("Downloads ဖိုလ်ဒါထဲ ဖိုင်အသစ် မဖန်တီးနိုင်ပါ။")
            try {
                resolver.openOutputStream(uri, "w").use { stream ->
                    if (stream == null) throw IllegalStateException("ဖိုင်ရေးရန် မဖွင့်နိုင်ပါ။")
                    stream.write(content.toByteArray(Charsets.UTF_8))
                    stream.flush()
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val ready = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
                    resolver.update(uri, ready, null, null)
                }
            } catch (error: Exception) {
                resolver.delete(uri, null, null)
                throw error
            }
            val result = JSObject()
            result.put("success", true)
            result.put("fileName", fileName)
            result.put("uri", uri.toString())
            result.put("location", "Downloads/$fileName")
            call.resolve(result)
        } catch (error: Exception) {
            call.reject("ဖိုင်သိမ်းမရပါ: ${error.message ?: "Android storage error"}", error)
        }
    }

    @PluginMethod
    fun writeBrainBackup(call: PluginCall) {
        val content = call.getString("content") ?: run {
            call.reject("Brain JSON အကြောင်းအရာ မပါပါ။")
            return
        }
        try {
            val directory = java.io.File(context.filesDir, "myk-guardian")
            if (!directory.exists() && !directory.mkdirs()) throw IllegalStateException("Brain ဖိုလ်ဒါ မဖန်တီးနိုင်ပါ။")
            val file = java.io.File(directory, "myk_personal_memory.json")
            file.writeText(content, Charsets.UTF_8)
            val result = JSObject()
            result.put("success", true)
            result.put("location", file.absolutePath)
            result.put("sizeBytes", file.length())
            call.resolve(result)
        } catch (error: Exception) {
            call.reject("Brain JSON သိမ်းမရပါ: ${error.message ?: "Storage error"}", error)
        }
    }

    @PluginMethod
    fun readBrainBackup(call: PluginCall) {
        try {
            val file = java.io.File(java.io.File(context.filesDir, "myk-guardian"), "myk_personal_memory.json")
            val result = JSObject()
            result.put("found", file.isFile)
            result.put("content", if (file.isFile) file.readText(Charsets.UTF_8) else "")
            result.put("location", file.absolutePath)
            call.resolve(result)
        } catch (error: Exception) {
            call.reject("Brain JSON ဖတ်မရပါ: ${error.message ?: "Storage error"}", error)
        }
    }

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
        val appOps = context.getSystemService(android.content.Context.APP_OPS_SERVICE) as android.app.AppOpsManager
        @Suppress("DEPRECATION")
        val usageMode = appOps.checkOpNoThrow("android:get_usage_stats", android.os.Process.myUid(), context.packageName)
        result.put("usageAccessGranted", usageMode == android.app.AppOpsManager.MODE_ALLOWED)
        val mediaReadGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.checkSelfPermission(android.Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED ||
                context.checkSelfPermission("android.permission.READ_MEDIA_VISUAL_USER_SELECTED") == PackageManager.PERMISSION_GRANTED
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            context.checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        } else true
        result.put("mediaReadGranted", mediaReadGranted)
        val callLogGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            context.checkSelfPermission(android.Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED
        result.put("callLogGranted", callLogGranted)
        call.resolve(result)
    }

    @PluginMethod
    fun requestPersonalPermissions(call: PluginCall) {
        requestPermissionForAliases(arrayOf("media", "callLog", "sms"), call, "personalPermissionsCallback")
    }

    @PermissionCallback
    private fun personalPermissionsCallback(call: PluginCall) {
        val result = JSObject()
        fun granted(permission: String): Boolean =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
                context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
        val mediaGranted = if (Build.VERSION.SDK_INT >= 34) {
            granted(android.Manifest.permission.READ_MEDIA_IMAGES) ||
                granted(android.Manifest.permission.READ_MEDIA_VIDEO) ||
                granted("android.permission.READ_MEDIA_VISUAL_USER_SELECTED")
        } else if (Build.VERSION.SDK_INT >= 33) {
            granted(android.Manifest.permission.READ_MEDIA_IMAGES) ||
                granted(android.Manifest.permission.READ_MEDIA_VIDEO)
        } else granted(android.Manifest.permission.READ_EXTERNAL_STORAGE)
        result.put("mediaGranted", mediaGranted)
        result.put("callLogGranted", granted(android.Manifest.permission.READ_CALL_LOG))
        result.put("smsGranted", granted(android.Manifest.permission.READ_SMS))
        call.resolve(result)
    }

    @PluginMethod
    fun openAllFilesAccessSettings(call: PluginCall) {
        try {
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    Uri.parse("package:" + context.packageName))
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", context.packageName, null))
            }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve()
        } catch (error: Exception) {
            call.reject("ဖိုင်ခွင့်ပြုချက် Settings မဖွင့်နိုင်ပါ: " + error.message, error)
        }
    }

    @PluginMethod
    fun scanPersonalDeviceData(call: PluginCall) {
        Thread {
            try {
                val pm = context.packageManager
                val apps = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    pm.getInstalledApplications(PackageManager.ApplicationInfoFlags.of(0L))
                } else {
                    @Suppress("DEPRECATION")
                    pm.getInstalledApplications(0)
                }
                val appArray = JSArray()
                apps.filter { pm.getLaunchIntentForPackage(it.packageName) != null }
                    .sortedBy { pm.getApplicationLabel(it).toString().lowercase(Locale.ROOT) }
                    .forEach { info ->
                        val item = JSObject()
                        item.put("name", pm.getApplicationLabel(info).toString())
                        item.put("packageName", info.packageName)
                        appArray.put(item)
                    }

                fun countMedia(uri: Uri, projection: Array<String>): Int {
                    return try {
                        context.contentResolver.query(uri, projection, null, null, null)?.use { cursor -> cursor.count } ?: 0
                    } catch (_: Exception) { 0 }
                }
                val mediaReadGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    context.checkSelfPermission(android.Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED ||
                        context.checkSelfPermission("android.permission.READ_MEDIA_VISUAL_USER_SELECTED") == PackageManager.PERMISSION_GRANTED
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    context.checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
                } else true
                val images = countMedia(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, arrayOf(android.provider.MediaStore.Images.Media._ID))
                val videos = countMedia(android.provider.MediaStore.Video.Media.EXTERNAL_CONTENT_URI, arrayOf(android.provider.MediaStore.Video.Media._ID))

                val appOps = context.getSystemService(android.content.Context.APP_OPS_SERVICE) as android.app.AppOpsManager
                @Suppress("DEPRECATION")
                val usageMode = appOps.checkOpNoThrow("android:get_usage_stats", android.os.Process.myUid(), context.packageName)
                val usageAllowed = usageMode == android.app.AppOpsManager.MODE_ALLOWED
                val usageArray = JSArray()
                if (usageAllowed) {
                    val manager = context.getSystemService(android.content.Context.USAGE_STATS_SERVICE) as android.app.usage.UsageStatsManager
                    val end = System.currentTimeMillis()
                    val start = end - 7L * 24 * 60 * 60 * 1000
                    manager.queryUsageStats(android.app.usage.UsageStatsManager.INTERVAL_DAILY, start, end)
                        .filter { it.totalTimeInForeground > 0 }
                        .sortedByDescending { it.totalTimeInForeground }
                        .take(30).forEach { stat ->
                            val item = JSObject()
                            item.put("packageName", stat.packageName)
                            item.put("foregroundMs7Days", stat.totalTimeInForeground)
                            try { item.put("appName", pm.getApplicationLabel(pm.getApplicationInfo(stat.packageName, 0)).toString()) }
                            catch (_: Exception) { item.put("appName", stat.packageName) }
                            usageArray.put(item)
                        }
                }

                val callsArray = JSArray()
                val callLogAllowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
                    context.checkSelfPermission(android.Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED
                if (callLogAllowed) {
                    try {
                        context.contentResolver.query(android.provider.CallLog.Calls.CONTENT_URI,
                            arrayOf(android.provider.CallLog.Calls.TYPE, android.provider.CallLog.Calls.DATE, android.provider.CallLog.Calls.DURATION),
                            null, null, android.provider.CallLog.Calls.DATE + " DESC")?.use { cursor ->
                            var n = 0
                            while (cursor.moveToNext() && n < 30) {
                                val item = JSObject()
                                item.put("type", cursor.getInt(0))
                                item.put("date", cursor.getLong(1))
                                item.put("durationSeconds", cursor.getLong(2))
                                callsArray.put(item); n++
                            }
                        }
                    } catch (_: SecurityException) { }
                }

                val smsArray = JSArray()
                val smsAllowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
                    context.checkSelfPermission(android.Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED
                if (smsAllowed) {
                    try {
                        context.contentResolver.query(
                            Uri.parse("content://sms/inbox"),
                            arrayOf("_id", "address", "body", "date", "type"),
                            null, null, "date DESC"
                        )?.use { cursor ->
                            var n = 0
                            while (cursor.moveToNext() && n < 50) {
                                val item = JSObject()
                                item.put("address", cursor.getString(1).orEmpty())
                                item.put("body", cursor.getString(2).orEmpty().take(2000))
                                item.put("date", cursor.getLong(3))
                                item.put("type", cursor.getInt(4))
                                smsArray.put(item)
                                n++
                            }
                        }
                    } catch (_: SecurityException) { }
                }

                val allFilesAccessGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.R || Environment.isExternalStorageManager()
                val sharedFiles = JSArray()
                if (allFilesAccessGranted) {
                    val root = Environment.getExternalStorageDirectory()
                    val queue = java.util.ArrayDeque<Pair<java.io.File, Int>>()
                    queue.add(root to 0)
                    var fileCount = 0
                    while (queue.isNotEmpty() && fileCount < 200) {
                        val (folder, depth) = queue.removeFirst()
                        val children = try { folder.listFiles() } catch (_: Exception) { null } ?: continue
                        for (child in children) {
                            if (fileCount >= 200) break
                            if (child.isDirectory) {
                                if (depth < 3 && child.name != "Android") queue.add(child to depth + 1)
                            } else if (child.isFile && child.canRead()) {
                                val item = JSObject()
                                item.put("name", child.name)
                                item.put("path", child.absolutePath)
                                item.put("sizeBytes", child.length())
                                item.put("modifiedAt", child.lastModified())
                                sharedFiles.put(item)
                                fileCount++
                            }
                        }
                    }
                }

                val result = JSObject()
                result.put("installedApps", appArray)
                result.put("imageCount", images)
                result.put("videoCount", videos)
                result.put("mediaReadGranted", mediaReadGranted)
                result.put("allFilesAccessGranted", allFilesAccessGranted)
                result.put("sharedFiles", sharedFiles)
                result.put("usageAccessGranted", usageAllowed)
                result.put("usageLast7Days", usageArray)
                result.put("callLogPermissionGranted", callLogAllowed)
                result.put("recentCalls", callsArray)
                result.put("smsPermissionGranted", smsAllowed)
                result.put("recentSms", smsArray)
                result.put("scannedAt", System.currentTimeMillis())
                call.resolve(result)
            } catch (error: Exception) {
                call.reject("ဖုန်း Data ကို scan မလုပ်နိုင်ပါ: ${error.message}", error)
            }
        }.start()
    }

    @PluginMethod
    fun openUsageAccessSettings(call: PluginCall) {
        openSettings(call, Settings.ACTION_USAGE_ACCESS_SETTINGS)
    }

    @PluginMethod
    fun openMykAppSettings(call: PluginCall) {
        try {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", context.packageName, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve()
        } catch (error: Exception) {
            call.reject("Myk App Permission Settings မဖွင့်နိုင်ပါ: ${error.message}", error)
        }
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
    fun reverseGeocode(call: PluginCall) {
        val latitude = call.getDouble("latitude")
        val longitude = call.getDouble("longitude")
        if (latitude == null || longitude == null) {
            call.reject("Latitude နဲ့ longitude လိုအပ်ပါတယ်။")
            return
        }
        Thread {
            val result = JSObject()
            try {
                val geocoder = Geocoder(context, Locale.getDefault())
                @Suppress("DEPRECATION")
                val addresses = geocoder.getFromLocation(latitude, longitude, 1)
                val address = addresses?.firstOrNull()
                val line = address?.getAddressLine(0).orEmpty().ifBlank {
                    listOfNotNull(address?.subLocality, address?.locality, address?.subAdminArea, address?.adminArea, address?.countryName)
                        .distinct().joinToString(", ")
                }
                result.put("address", line)
            } catch (_: Exception) {
                result.put("address", "")
            }
            call.resolve(result)
        }.start()
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

    @PluginMethod
    fun startVedariWakeListening(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Wake word နားထောင်ရန် Microphone permission လိုအပ်ပါတယ်။ အရင် Allow လုပ်ပါ။")
            return
        }
        try {
            context.getSharedPreferences(VedariWakeService.PREFS, android.content.Context.MODE_PRIVATE)
                .edit().putBoolean(VedariWakeService.ENABLED, true).apply()
            val intent = Intent(context, VedariWakeService::class.java).setAction(VedariWakeService.ACTION_START)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
            val result = JSObject()
            result.put("success", true)
            result.put("message", "ဗေဒါရီ Wake Word နားထောင်မှု စတင်လိုက်ပါပြီ။ Notification မှာ Stop လုပ်နိုင်ပါတယ်။")
            call.resolve(result)
        } catch (error: Exception) {
            call.reject("Wake Word စတင်မရပါ: ${error.message}", error)
        }
    }

    @PluginMethod
    fun stopVedariWakeListening(call: PluginCall) {
        try {
            context.getSharedPreferences(VedariWakeService.PREFS, android.content.Context.MODE_PRIVATE)
                .edit().putBoolean(VedariWakeService.ENABLED, false).apply()
            context.startService(Intent(context, VedariWakeService::class.java).setAction(VedariWakeService.ACTION_STOP))
            val result = JSObject()
            result.put("success", true)
            result.put("message", "ဗေဒါရီ Wake Word နားထောင်မှု ရပ်လိုက်ပါပြီ။")
            call.resolve(result)
        } catch (error: Exception) {
            call.reject("Wake Word ရပ်မရပါ: ${error.message}", error)
        }
    }

    @PluginMethod
    fun getPendingWakeCommand(call: PluginCall) {
        val prefs = context.getSharedPreferences(VedariWakeService.PREFS, android.content.Context.MODE_PRIVATE)
        val command = prefs.getString(VedariWakeService.PENDING_COMMAND, "").orEmpty()
        val at = prefs.getLong(VedariWakeService.PENDING_AT, 0L)
        val fresh = command.isNotBlank() && System.currentTimeMillis() - at < 60_000L
        if (fresh) prefs.edit().remove(VedariWakeService.PENDING_COMMAND).remove(VedariWakeService.PENDING_AT).apply()
        val result = JSObject()
        result.put("command", if (fresh) command else "")
        result.put("listening", prefs.getBoolean(VedariWakeService.ENABLED, false))
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
            call.reject("Accessibility service is not enabled. Enable AMARA AI in Android Accessibility settings.")
            return
        }
        try {
            if (!performBackWithFallback(service)) {
                call.reject("Android က Back action ကို လက်မခံပါ။ Accessibility Service ကို Off/On ပြန်လုပ်ပါ။")
                return
            }
            val result = JSObject()
            result.put("success", true)
            result.put("message", "အမရာကို နောက်ခံသို့ ရွှေ့ပြီး ယခင် App ပေါ်တွင် Back action လုပ်ပါမည်။")
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
        // WebView access (including obtaining bridge.webView, canGoBack and goBack)
        // must happen on Android's main thread, never on CapacitorPlugins.
        Handler(Looper.getMainLooper()).post {
            val hostActivity = activity
            if (!hostActivity.isFinishing && !hostActivity.isDestroyed) {
                val isAmaraForeground = service.activeWindowPackageName() == context.packageName
                if (isAmaraForeground) {
                    val webView = bridge?.webView
                    if (webView != null && webView.canGoBack()) {
                        webView.goBack()
                        return@post
                    }
                    // No WebView history: do not exit the app. Keep the current page.
                    return@post
                }
            }
            // Another app is foreground: use Android's global Back action.
            service.back()
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
            call.reject("Accessibility service is not enabled. Enable AMARA AI in Android Accessibility settings.")
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
            val match = apps.asSequence()
                .filter { info ->
                    val label = pm.getApplicationLabel(info).toString()
                    label.equals(requested, ignoreCase = true) || label.contains(requested, ignoreCase = true)
                }
                .sortedBy { info ->
                    if (pm.getApplicationLabel(info).toString().equals(requested, ignoreCase = true)) 0 else 1
                }
                .firstOrNull { pm.getLaunchIntentForPackage(it.packageName) != null } ?: run {
                    val found = apps.map { pm.getApplicationLabel(it).toString() }
                        .filter { it.contains(requested, ignoreCase = true) }
                        .take(5).joinToString(", ")
                    val detail = if (found.isNotBlank()) " ဆင်တူအမည်များ: $found" else ""
                    call.reject("ဖွင့်နိုင်သော App အမည် “$requested” ကို မတွေ့ပါ။$detail")
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
                    "Back action ပို့ပြီးပါပြီ။ App မပြောင်းပါက အမရာကို နောက်ခံသို့ ရွှေ့ပေးပါမည်။"
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
                "searchPlaces" -> {
                    val query = call.getString("text")?.trim().orEmpty()
                    if (query.isEmpty()) throw IllegalArgumentException("ရှာဖွေမည့်နေရာအမည်ကို ပေးပါ။")
                    val geo = Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(query)))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    try {
                        context.startActivity(geo)
                    } catch (_: Exception) {
                        val url = "https://www.google.com/maps/search/?api=1&query=" + Uri.encode(query)
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                    "Maps မှာ “$query” ကို ရှာဖွေဖွင့်ပေးလိုက်ပါပြီ။ လမ်းကြောင်းစတင်ရန် Maps ထဲက Directions ကိုနှိပ်ပါ။"
                }
                "setAlarm" -> {
                    val hour = call.getInt("hour") ?: throw IllegalArgumentException("Alarm နာရီ မပါပါ။")
                    val minute = call.getInt("minute") ?: 0
                    val label = call.getString("label")?.trim().orEmpty().ifBlank { "AMARA AI" }
                    if (hour !in 0..23 || minute !in 0..59) throw IllegalArgumentException("Alarm အချိန် မမှန်ပါ။")
                    val alarm = Intent(AlarmClock.ACTION_SET_ALARM)
                        .putExtra(AlarmClock.EXTRA_HOUR, hour)
                        .putExtra(AlarmClock.EXTRA_MINUTES, minute)
                        .putExtra(AlarmClock.EXTRA_MESSAGE, label)
                        .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    try {
                        context.startActivity(alarm)
                    } catch (_: Exception) {
                        alarm.putExtra(AlarmClock.EXTRA_SKIP_UI, false)
                        context.startActivity(alarm)
                    }
                    "Android Clock သို့ ${String.format(Locale.getDefault(), "%02d:%02d", hour, minute)} Alarm သတ်မှတ်ရန် ပို့ပြီးပါပြီ။ Clock app ထဲမှာ Alarm သိမ်းထားကြောင်း စစ်ဆေးပါ။"
                }
                "searchYouTube" -> {
                    val query = call.getString("text")?.trim().orEmpty()
                    if (query.isEmpty()) throw IllegalArgumentException("ရှာဖွေမည့် သီချင်းအမည်နှင့် အဆိုတော်ကို ပေးပါ။")
                    val url = "https://www.youtube.com/results?search_query=" + Uri.encode(query)
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    Handler(Looper.getMainLooper()).postDelayed({
                        val selected = MyAccessibilityService.instance()?.clickFirstYouTubeResult() == true
                        val result = JSObject()
                        result.put("success", true)
                        result.put("message", if (selected) "YouTube ရှာဖွေမှုရလဒ်ထဲက ဗီဒီယိုတစ်ခုကို ရွေးပြီးပါပြီ။ Playback ကို စစ်ဆေးပါ။" else "YouTube မှာ “$query” ရလဒ်ကို ဖွင့်ထားပါတယ်။ UI ကို ဖတ်မရလို့ ဗီဒီယိုကို အလိုအလျောက် မရွေးနိုင်သေးပါ။")
                        call.resolve(result)
                    }, 2600L)
                    return
                }
                "openPhone", "callPhone" -> {
                    val number = call.getString("number")?.trim().orEmpty()
                    val dialUri = if (number.isNotEmpty()) Uri.parse("tel:$number") else Uri.parse("tel:")
                    val dialIntent = Intent(Intent.ACTION_DIAL, dialUri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    try {
                        context.startActivity(dialIntent)
                    } catch (firstError: Exception) {
                        context.startActivity(Intent(Intent.ACTION_VIEW, dialUri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                    if (number.isNotEmpty()) "ဖုန်းနံပါတ်ကို Dialer ထဲ ထည့်ပေးထားပါပြီ။ သင်ကိုယ်တိုင် Call ခလုတ်ကို နှိပ်မှသာ ခေါ်ဆိုပါမည်။"
                    else "ဖုန်းခေါ်ရန် Dialer ကို ဖွင့်လိုက်ပါပြီ။ Contact သို့မဟုတ် နံပါတ်ကို ရွေးပြီး Call ကို ကိုယ်တိုင်နှိပ်ပါ။"
                }
                "setText" -> {
                    val text = call.getString("text")?.trim().orEmpty()
                    if (text.isEmpty()) throw IllegalArgumentException("ရေးမည့် စာသား မပါပါ။")
                    val service = MyAccessibilityService.instance() ?: throw IllegalStateException("စာသားထည့်ရန် Accessibility Service ဖွင့်ထားရပါမည်။")
                    if (!service.setText(text)) throw IllegalStateException("လက်ရှိမျက်နှာပြင်မှာ စာရိုက်နိုင်တဲ့ input field မတွေ့ပါ။")
                    "စာသားကို လက်ရှိ input field ထဲ ထည့်လိုက်ပါပြီ။"
                }
                "writeNote" -> {
                    val noteText = call.getString("text")?.trim().orEmpty()
                    if (noteText.isEmpty()) throw IllegalArgumentException("မှတ်စုစာသား မပါပါ။")
                    val pm = context.packageManager
                    // Prefer the user's explicitly named "Notes" app. The generic CREATE_NOTE
                    // intent may route to an unrelated handler or report success without opening
                    // the actual Notes launcher, so use it only if no Notes app can be found.
                    val apps = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) pm.getInstalledApplications(PackageManager.ApplicationInfoFlags.of(0L)) else {
                        @Suppress("DEPRECATION")
                        pm.getInstalledApplications(0)
                    }
                    val noteKeywords = listOf("notes", "note", "notepad", "memo", "keep", "colornote", "color note", "quick memo", "notebook", "joplin", "evernote", "onenote", "မှတ်စု", "メモ", "笔记", "노트")
                    val candidates = apps.filter { info ->
                        if (info.packageName == context.packageName) false else {
                            val label = pm.getApplicationLabel(info).toString().lowercase()
                            val packageName = info.packageName.lowercase()
                            noteKeywords.any { label.contains(it) || packageName.contains(it.replace(" ", "")) }
                        }
                    }.sortedBy { info ->
                        val label = pm.getApplicationLabel(info).toString().lowercase()
                        if (label == "notes" || label == "note" || label == "notepad" || label == "memo" || label == "မှတ်စု") 0 else 1
                    }
                    val noteApp = candidates.firstOrNull { pm.getApplicationLabel(it).toString().equals("Notes", ignoreCase = true) && pm.getLaunchIntentForPackage(it.packageName) != null }
                        ?: candidates.firstOrNull { pm.getLaunchIntentForPackage(it.packageName) != null }
                    if (noteApp == null) {
                        val createNote = Intent("android.intent.action.CREATE_NOTE")
                            .putExtra(Intent.EXTRA_TEXT, noteText)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        val createNoteHandler = try { createNote.resolveActivity(pm) } catch (_: Exception) { null }
                        if (createNoteHandler != null) {
                            context.startActivity(createNote)
                            val result = JSObject()
                            result.put("success", true)
                            result.put("message", "Notes ကို ဖွင့်ပေးလိုက်ပါပြီ။ မှတ်စုစာသား ပါဝင်မှုကို စစ်ဆေးပါ။")
                            call.resolve(result)
                            return
                        }
                        val foundLabels = candidates.take(6).joinToString(", ") { pm.getApplicationLabel(it).toString() }
                        val detail = if (foundLabels.isNotBlank()) " တွေ့တဲ့ app: $foundLabels" else " ဖုန်းထဲက Notes app ကို မတွေ့ပါ။"
                        throw IllegalStateException("Notes app ကို မဖွင့်နိုင်သေးပါ။$detail")
                    }
                    val launch = pm.getLaunchIntentForPackage(noteApp.packageName)
                        ?: throw IllegalStateException("Notes app (${pm.getApplicationLabel(noteApp)}) အတွက် ဖွင့်ရန် launcher မရှိပါ။")
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(launch)
                    Handler(Looper.getMainLooper()).postDelayed({
                        val service = MyAccessibilityService.instance()
                        // Prefer the explicit New Note control so text is not accidentally placed in a search field.
                        val openedEditor = service?.clickNewNoteAction() == true
                        var typed = !openedEditor && service?.setText(noteText) == true
                        Handler(Looper.getMainLooper()).postDelayed({
                            typed = typed || MyAccessibilityService.instance()?.setText(noteText) == true
                            if (typed) {
                                val result = JSObject()
                                result.put("success", true)
                                result.put("message", "Note app ထဲမှာ စာသားထည့်လိုက်ပါပြီ။ Auto-save ရှိမရှိကို Note app မှာ စစ်ပါ။")
                                call.resolve(result)
                            } else {
                                call.reject(if (!openedEditor) "Note app ကို ဖွင့်ထားပါတယ်၊ ဒါပေမဲ့ New note ခလုတ် သို့မဟုတ် စာရေးနိုင်တဲ့နေရာကို မတွေ့ပါ။" else "Note editor ကို ဖွင့်ထားပေမဲ့ စာသားထည့်မရပါ။")
                            }
                        }, 650L)
                    }, 1800L)
                    return
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
            call.reject("Accessibility service is not enabled. Enable AMARA AI in Android Accessibility settings.")
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
