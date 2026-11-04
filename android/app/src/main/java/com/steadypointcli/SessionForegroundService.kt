package com.steadypointcli

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * FIFTY-FIFTH follow-up: keeps SteadyPoint running while a session is active,
 * so the M5Stick's readings, the session clock and the sound keep going with
 * the screen off or another app open. Android (Samsung especially) otherwise
 * pauses or stops a background app after a while. Started and stopped from JS
 * (src/services/sessionService.js) through SessionServiceModule.
 *
 * Shows an ongoing "SteadyPoint session in progress" notification (tapping it
 * opens the app) and holds a CPU wake lock until the session ends. Types:
 * connectedDevice (the M5Stick over Bluetooth) + mediaPlayback (sonification
 * and guide tracks), as Android 14+ requires.
 */
class SessionForegroundService : Service() {

  companion object {
    const val EXTRA_TEXT = "text"
    private const val CHANNEL_ID = "steadypoint_session"
    private const val NOTIFICATION_ID = 4201
    private const val TAG = "SteadyPointSession"
    private const val WAKE_LOCK_TAG = "SteadyPoint:session"
    // Safety cap only — the lock is released when the session ends.
    private const val WAKE_LOCK_MAX_MS = 12L * 60 * 60 * 1000
  }

  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Session running"
    ensureChannel()
    if (!startInForeground(buildNotification(text))) {
      stopSelf()
      return START_NOT_STICKY
    }
    acquireWakeLock()
    // Not restarted by the system if the app process dies: the session's
    // checkpoint is recovered at the next launch instead.
    return START_NOT_STICKY
  }

  // App swiped away from recents: end the service with it. A session in
  // progress is saved from its checkpoint at the next launch, as before.
  override fun onTaskRemoved(rootIntent: Intent?) {
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    releaseWakeLock()
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun startInForeground(notification: Notification): Boolean {
    // connectedDevice needs Bluetooth permission (granted when the M5Stick
    // was connected); mediaPlayback has no extra requirement, so it is the
    // fallback if the combined start is refused.
    val types =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
            listOf(
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE or
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        else listOf(0)
    for (type in types) {
      try {
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
        return true
      } catch (e: Exception) {
        Log.w(TAG, "startForeground(type=$type) failed: ${e.message}")
      }
    }
    return false
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel =
        NotificationChannel(CHANNEL_ID, "Sessions", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shown while a SteadyPoint session is running"
          setShowBadge(false)
        }
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(text: String): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent =
        launch?.let {
          PendingIntent.getActivity(
              this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
    return NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_stat_session)
        .setContentTitle("SteadyPoint session in progress")
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .setContentIntent(contentIntent)
        .build()
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val pm = getSystemService(POWER_SERVICE) as PowerManager
    wakeLock =
        pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG).apply {
          setReferenceCounted(false)
          acquire(WAKE_LOCK_MAX_MS)
        }
  }

  private fun releaseWakeLock() {
    try {
      wakeLock?.let { if (it.isHeld) it.release() }
    } catch (e: Exception) {
      Log.w(TAG, "wake lock release failed: ${e.message}")
    }
    wakeLock = null
  }
}
