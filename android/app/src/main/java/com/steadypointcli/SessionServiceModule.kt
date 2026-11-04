package com.steadypointcli

import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
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
 */
@ReactModule(name = SessionServiceModule.NAME)
class SessionServiceModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  companion object {
    const val NAME = "SteadyPointSession"
    private const val TAG = "SteadyPointSession"
  }

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
}
