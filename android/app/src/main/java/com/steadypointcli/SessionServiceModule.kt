package com.steadypointcli

import android.content.Intent
import android.media.AudioManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

/**
 * FIFTY-FIFTH follow-up: JS access to SessionForegroundService, as
 * NativeModules.SteadyPointSession.start(text) / .stop(). Both resolve
 * true/false and never reject — a session must not fail because the service
 * couldn't start.
 *
 * FIFTY-EIGHTH follow-up: call monitor. startCallMonitor() / stopCallMonitor()
 * watch the phone's audio mode (Android 12+: AudioManager.OnModeChangedListener,
 * no permission needed and no effect on other apps' audio — they keep mixing
 * with SteadyPoint's sound). Any mode other than NORMAL — ringing, a phone
 * call, a video/VoIP call — counts as "in a call". Changes are sent to JS as
 * the event "SteadyPointCallState" { inCall, mode }; JS quiets the sound and
 * pauses the guide track until the call ends. Below Android 12 it does
 * nothing (sound keeps playing during calls, as before).
 */
@ReactModule(name = SessionServiceModule.NAME)
class SessionServiceModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  companion object {
    const val NAME = "SteadyPointSession"
    const val CALL_STATE_EVENT = "SteadyPointCallState"
    private const val TAG = "SteadyPointSession"
  }

  private var modeListener: Any? = null // AudioManager.OnModeChangedListener (API 31+)
  private var lastInCall: Boolean? = null

  override fun getName(): String = NAME

  @ReactMethod
  fun start(text: String, promise: Promise) {
    try {
      val intent =
          Intent(context, SessionForegroundService::class.java)
              .putExtra(SessionForegroundService.EXTRA_TEXT, text)
      ContextCompat.startForegroundService(context, intent)
      promise.resolve(true)
    } catch (e: Exception) {
      Log.w(TAG, "start failed: ${e.message}")
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      context.stopService(Intent(context, SessionForegroundService::class.java))
      promise.resolve(true)
    } catch (e: Exception) {
      Log.w(TAG, "stop failed: ${e.message}")
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun startCallMonitor(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      promise.resolve(false)
      return
    }
    try {
      val am = context.getSystemService(AudioManager::class.java)
      if (am == null) {
        promise.resolve(false)
        return
      }
      if (modeListener == null) {
        val listener = AudioManager.OnModeChangedListener { mode -> report(mode) }
        am.addOnModeChangedListener(ContextCompat.getMainExecutor(context), listener)
        modeListener = listener
      }
      lastInCall = null
      report(am.mode) // a session can start mid-call
      promise.resolve(true)
    } catch (e: Exception) {
      Log.w(TAG, "startCallMonitor failed: ${e.message}")
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun stopCallMonitor(promise: Promise) {
    removeModeListener()
    promise.resolve(true)
  }

  // Required by NativeEventEmitter on Android.
  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Double) {}

  override fun invalidate() {
    removeModeListener()
    super.invalidate()
  }

  private fun removeModeListener() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    val listener = modeListener as? AudioManager.OnModeChangedListener ?: return
    try {
      context.getSystemService(AudioManager::class.java)?.removeOnModeChangedListener(listener)
    } catch (e: Exception) {
      Log.w(TAG, "removeOnModeChangedListener failed: ${e.message}")
    }
    modeListener = null
    lastInCall = null
  }

  private fun report(mode: Int) {
    val inCall = mode != AudioManager.MODE_NORMAL
    if (inCall == lastInCall) return
    lastInCall = inCall
    Log.i(TAG, "audio mode $mode -> inCall=$inCall")
    if (!context.hasActiveReactInstance()) return
    val data =
        Arguments.createMap().apply {
          putBoolean("inCall", inCall)
          putInt("mode", mode)
        }
    context.emitDeviceEvent(CALL_STATE_EVENT, data)
  }
}
