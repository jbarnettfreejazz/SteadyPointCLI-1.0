package com.steadypointcli

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** FIFTY-FIFTH follow-up: registers SessionServiceModule (added in MainApplication). */
class SessionServicePackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
      if (name == SessionServiceModule.NAME) SessionServiceModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
        SessionServiceModule.NAME to
            // name, className, canOverrideExistingModule, needsEagerInit, isCxxModule, isTurboModule
            ReactModuleInfo(
                SessionServiceModule.NAME,
                SessionServiceModule::class.java.name,
                false,
                false,
                false,
                false))
  }
}
